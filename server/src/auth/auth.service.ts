import { HttpStatus, Injectable, Logger, Optional } from "@nestjs/common";
import { loadAppConfig, type AppConfig } from "../config/app-config.js";
import { ApiError } from "../common/api-error.js";
import { PrismaService } from "../database/prisma.service.js";
import { AccountStatus, AccountTokenPurpose, RoleType } from "../generated/prisma/enums.js";
import { AccountMailService } from "../mail/account-mail.service.js";
import {
  OAuthClient,
  OAuthComponentError,
  type OAuthIdentity,
  type OAuthProviderName,
} from "../components/oauth/index.js";
import type { AuthResult, CurrentUser, PublicRole, SignupResult } from "./auth.types.js";
import { generateAccountToken, hashAccountToken } from "./account-token.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateSessionToken, hashSessionToken } from "./session-cookie.js";
import {
  createPkceChallenge,
  generateOAuthSecret,
  hashOAuthSecret,
  normalizeReturnTo,
} from "./oauth-flow.js";

type UserWithRoles = {
  id: string;
  email: string | null;
  displayName: string;
  status: AccountStatus;
  passwordHash: string | null;
  emailVerifiedAt?: Date | null;
  roles: Array<{ role: RoleType }>;
};

type SignupInput = {
  email: string;
  password: string;
  displayName: string;
  role: RoleType;
};

const PUBLIC_ROLES = new Map<string, RoleType>([
  ["student", RoleType.STUDENT],
  ["guardian", RoleType.GUARDIAN],
]);

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateSignup(body: unknown): SignupInput {
  if (!body || typeof body !== "object") {
    throw new ApiError("INVALID_SIGNUP", "회원가입 정보를 확인해 주세요.", HttpStatus.BAD_REQUEST);
  }

  const data = body as Record<string, unknown>;
  const email = readString(data.email).toLowerCase();
  const password = typeof data.password === "string" ? data.password : "";
  const displayName = readString(data.displayName);
  const roleName = readString(data.role).toLowerCase() || "student";
  const role = PUBLIC_ROLES.get(roleName);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ApiError("INVALID_EMAIL", "올바른 이메일 주소를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  if (password.length < 10 || password.length > 128) {
    throw new ApiError("INVALID_PASSWORD", "비밀번호는 10자 이상 128자 이하로 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  if (displayName.length < 2 || displayName.length > 40) {
    throw new ApiError("INVALID_DISPLAY_NAME", "이름은 2자 이상 40자 이하로 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  if (!role) {
    throw new ApiError("INVALID_ROLE", "공개 가입은 학생 또는 보호자 역할만 선택할 수 있습니다.", HttpStatus.BAD_REQUEST);
  }

  return { email, password, displayName, role };
}

function validateLogin(body: unknown): { email: string; password: string } {
  if (!body || typeof body !== "object") {
    throw new ApiError("INVALID_LOGIN", "이메일과 비밀번호를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  const data = body as Record<string, unknown>;
  const email = readString(data.email).toLowerCase();
  const password = typeof data.password === "string" ? data.password : "";
  if (!email || !password) {
    throw new ApiError("INVALID_LOGIN", "이메일과 비밀번호를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return { email, password };
}

function validateEmail(body: unknown): string {
  const email = body && typeof body === "object"
    ? readString((body as Record<string, unknown>).email).toLowerCase()
    : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ApiError("INVALID_EMAIL", "올바른 이메일 주소를 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return email;
}

function validateToken(body: unknown): string {
  const token = body && typeof body === "object"
    ? readString((body as Record<string, unknown>).token)
    : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new ApiError("ACCOUNT_TOKEN_INVALID", "인증 링크가 만료되었거나 유효하지 않습니다.", HttpStatus.BAD_REQUEST);
  }
  return token;
}

function validatePasswordReset(body: unknown): { token: string; password: string } {
  const token = validateToken(body);
  const password = body && typeof body === "object"
    ? (body as Record<string, unknown>).password
    : "";
  if (typeof password !== "string" || password.length < 10 || password.length > 128) {
    throw new ApiError("INVALID_PASSWORD", "비밀번호는 10자 이상 128자 이하로 입력해 주세요.", HttpStatus.BAD_REQUEST);
  }
  return { token, password };
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002");
}

@Injectable()
export class AuthService {
  private readonly config: AppConfig;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly accountMail?: AccountMailService,
    @Optional() private readonly oauthClient?: OAuthClient,
  ) {
    this.config = loadAppConfig();
  }

  async signup(body: unknown, requestId?: string): Promise<SignupResult> {
    const input = validateSignup(body);
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ApiError("EMAIL_ALREADY_EXISTS", "이미 가입된 이메일입니다.", HttpStatus.CONFLICT);
    }

    const passwordHash = await hashPassword(input.password);
    const sessionToken = generateSessionToken();
    const sessionTokenHash = hashSessionToken(sessionToken);
    const expiresAt = this.sessionExpiry();
    const verificationToken = generateAccountToken();
    const verificationExpiresAt = this.emailVerificationExpiry();

    const user = await (async () => {
      try {
        return await this.prisma.$transaction(async (transaction) => {
          const created = await transaction.user.create({
            data: {
              email: input.email,
              displayName: input.displayName,
              passwordHash,
              roles: { create: [{ role: input.role }] },
            },
            include: { roles: true },
          });
          await transaction.session.create({
            data: { userId: created.id, tokenHash: sessionTokenHash, expiresAt },
          });
          await transaction.accountToken.create({
            data: {
              userId: created.id,
              purpose: AccountTokenPurpose.EMAIL_VERIFICATION,
              tokenHash: hashAccountToken(verificationToken),
              expiresAt: verificationExpiresAt,
            },
          });
          await transaction.auditLog.create({
            data: {
              actorId: created.id,
              action: "auth.signup",
              resourceType: "User",
              resourceId: created.id,
              requestId: requestId ?? null,
            },
          });
          return created;
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new ApiError("EMAIL_ALREADY_EXISTS", "이미 가입된 이메일입니다.", HttpStatus.CONFLICT);
        }
        throw error;
      }
    })();

    this.queueAccountMail(
      "email_verification",
      user.id,
      requestId,
      () => this.accountMail!.sendEmailVerification({
        email: input.email,
        displayName: input.displayName,
        token: verificationToken,
      }),
    );

    return {
      user: this.toCurrentUser(user),
      sessionToken,
      expiresAt,
      ...(this.config.nodeEnv === "production"
        ? {}
        : { developmentVerificationToken: verificationToken }),
    };
  }

  async requestPasswordReset(body: unknown, requestId?: string): Promise<{
    accepted: true;
    developmentToken?: string;
  }> {
    const email = validateEmail(body);
    const token = generateAccountToken();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (user?.passwordHash && user.status === AccountStatus.ACTIVE) {
      const now = new Date();
      await this.prisma.$transaction(async (transaction) => {
        await transaction.accountToken.updateMany({
          where: {
            userId: user.id,
            purpose: AccountTokenPurpose.PASSWORD_RESET,
            consumedAt: null,
          },
          data: { consumedAt: now },
        });
        await transaction.accountToken.create({
          data: {
            userId: user.id,
            purpose: AccountTokenPurpose.PASSWORD_RESET,
            tokenHash: hashAccountToken(token),
            expiresAt: this.passwordResetExpiry(),
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: user.id,
            action: "auth.password_reset.requested",
            resourceType: "User",
            resourceId: user.id,
            requestId: requestId ?? null,
          },
        });
      });
      this.queueAccountMail(
        "password_reset",
        user.id,
        requestId,
        () => this.accountMail!.sendPasswordReset({
          email,
          displayName: user.displayName,
          token,
        }),
      );
    }

    return {
      accepted: true,
      ...(this.config.nodeEnv === "production" ? {} : { developmentToken: token }),
    };
  }

  async confirmPasswordReset(body: unknown, requestId?: string): Promise<{ reset: true }> {
    const input = validatePasswordReset(body);
    const accountToken = await this.prisma.accountToken.findUnique({
      where: { tokenHash: hashAccountToken(input.token) },
      include: { user: true },
    });
    const now = new Date();
    if (
      !accountToken
      || accountToken.purpose !== AccountTokenPurpose.PASSWORD_RESET
      || accountToken.consumedAt
      || accountToken.expiresAt.getTime() <= now.getTime()
      || accountToken.user.status !== AccountStatus.ACTIVE
      || !accountToken.user.passwordHash
    ) {
      throw new ApiError("PASSWORD_RESET_TOKEN_INVALID", "재설정 링크가 만료되었거나 유효하지 않습니다.", HttpStatus.BAD_REQUEST);
    }

    const passwordHash = await hashPassword(input.password);
    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.accountToken.updateMany({
        where: {
          id: accountToken.id,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new ApiError("PASSWORD_RESET_TOKEN_INVALID", "재설정 링크가 만료되었거나 유효하지 않습니다.", HttpStatus.BAD_REQUEST);
      }
      await transaction.user.update({
        where: { id: accountToken.userId },
        data: { passwordHash },
      });
      await transaction.accountToken.updateMany({
        where: {
          userId: accountToken.userId,
          purpose: AccountTokenPurpose.PASSWORD_RESET,
          consumedAt: null,
        },
        data: { consumedAt: now },
      });
      await transaction.session.updateMany({
        where: { userId: accountToken.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.auditLog.create({
        data: {
          actorId: accountToken.userId,
          action: "auth.password_reset.completed",
          resourceType: "User",
          resourceId: accountToken.userId,
          requestId: requestId ?? null,
        },
      });
    });
    return { reset: true };
  }

  async requestEmailVerification(user: CurrentUser, requestId?: string): Promise<{
    accepted: true;
    alreadyVerified: boolean;
    developmentToken?: string;
  }> {
    const account = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (!account || account.status !== AccountStatus.ACTIVE || !account.email) {
      throw new ApiError("ACCOUNT_UNAVAILABLE", "이메일 인증을 사용할 수 없는 계정입니다.", HttpStatus.BAD_REQUEST);
    }
    if (account.emailVerifiedAt) return { accepted: true, alreadyVerified: true };

    const token = generateAccountToken();
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.accountToken.updateMany({
        where: {
          userId: account.id,
          purpose: AccountTokenPurpose.EMAIL_VERIFICATION,
          consumedAt: null,
        },
        data: { consumedAt: now },
      });
      await transaction.accountToken.create({
        data: {
          userId: account.id,
          purpose: AccountTokenPurpose.EMAIL_VERIFICATION,
          tokenHash: hashAccountToken(token),
          expiresAt: this.emailVerificationExpiry(),
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: account.id,
          action: "auth.email_verification.requested",
          resourceType: "User",
          resourceId: account.id,
          requestId: requestId ?? null,
        },
      });
    });

    this.queueAccountMail(
      "email_verification",
      account.id,
      requestId,
      () => this.accountMail!.sendEmailVerification({
        email: account.email as string,
        displayName: account.displayName,
        token,
      }),
    );

    return {
      accepted: true,
      alreadyVerified: false,
      ...(this.config.nodeEnv === "production" ? {} : { developmentToken: token }),
    };
  }

  async confirmEmailVerification(body: unknown, requestId?: string): Promise<{
    verified: true;
    verifiedAt: Date;
  }> {
    const token = validateToken(body);
    const accountToken = await this.prisma.accountToken.findUnique({
      where: { tokenHash: hashAccountToken(token) },
      include: { user: true },
    });
    const now = new Date();
    if (
      !accountToken
      || accountToken.purpose !== AccountTokenPurpose.EMAIL_VERIFICATION
      || accountToken.consumedAt
      || accountToken.expiresAt.getTime() <= now.getTime()
      || accountToken.user.status !== AccountStatus.ACTIVE
    ) {
      throw new ApiError("EMAIL_VERIFICATION_TOKEN_INVALID", "인증 링크가 만료되었거나 유효하지 않습니다.", HttpStatus.BAD_REQUEST);
    }

    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.accountToken.updateMany({
        where: {
          id: accountToken.id,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new ApiError("EMAIL_VERIFICATION_TOKEN_INVALID", "인증 링크가 만료되었거나 유효하지 않습니다.", HttpStatus.BAD_REQUEST);
      }
      await transaction.user.update({
        where: { id: accountToken.userId },
        data: { emailVerifiedAt: now },
      });
      await transaction.accountToken.updateMany({
        where: {
          userId: accountToken.userId,
          purpose: AccountTokenPurpose.EMAIL_VERIFICATION,
          consumedAt: null,
        },
        data: { consumedAt: now },
      });
      await transaction.auditLog.create({
        data: {
          actorId: accountToken.userId,
          action: "auth.email_verification.completed",
          resourceType: "User",
          resourceId: accountToken.userId,
          requestId: requestId ?? null,
        },
      });
    });
    return { verified: true, verifiedAt: now };
  }

  async login(body: unknown, requestId?: string): Promise<AuthResult> {
    const input = validateLogin(body);
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { roles: true },
    });
    const passwordMatches = user?.passwordHash
      ? await verifyPassword(input.password, user.passwordHash)
      : false;

    if (!user || !passwordMatches) {
      throw new ApiError("INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.", HttpStatus.UNAUTHORIZED);
    }
    if (user.status !== AccountStatus.ACTIVE) {
      throw new ApiError("ACCOUNT_UNAVAILABLE", "현재 사용할 수 없는 계정입니다.", HttpStatus.FORBIDDEN);
    }

    const sessionToken = generateSessionToken();
    const expiresAt = this.sessionExpiry();
    await this.prisma.$transaction([
      this.prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hashSessionToken(sessionToken),
          expiresAt,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: "auth.login",
          resourceType: "Session",
          requestId: requestId ?? null,
        },
      }),
    ]);

    return { user: this.toCurrentUser(user), sessionToken, expiresAt };
  }

  async startOAuth(providerValue: string, returnToValue: unknown, requestId?: string): Promise<{ url: string }> {
    const provider = this.readOAuthProvider(providerValue);
    const oauth = this.requireOAuthClient();
    const state = generateOAuthSecret();
    const nonce = generateOAuthSecret();
    const codeVerifier = generateOAuthSecret();
    const returnTo = normalizeReturnTo(returnToValue);
    let authorizationUrl: URL;
    try {
      authorizationUrl = oauth.createAuthorizationUrl(provider, {
        state,
        nonce,
        codeChallenge: createPkceChallenge(codeVerifier),
      });
    } catch (error) {
      this.throwOAuthError(error);
    }

    const attempt = await this.prisma.oAuthLoginAttempt.create({
      data: {
        provider,
        stateHash: hashOAuthSecret(state),
        nonce,
        codeVerifier,
        returnTo,
        expiresAt: new Date(Date.now() + this.config.oauthStateTtlMinutes * 60 * 1000),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        action: "auth.oauth.started",
        resourceType: "OAuthLoginAttempt",
        resourceId: attempt.id,
        requestId: requestId ?? null,
        metadata: { provider, returnTo },
      },
    });
    return { url: authorizationUrl.toString() };
  }

  async completeOAuth(
    providerValue: string,
    query: Record<string, unknown>,
    requestId?: string,
  ): Promise<AuthResult & { returnTo: string }> {
    const provider = this.readOAuthProvider(providerValue);
    const state = readString(query.state);
    const code = readString(query.code);
    if (readString(query.error)) {
      throw new ApiError("OAUTH_ACCESS_DENIED", "소셜 로그인이 취소되었습니다.", HttpStatus.UNAUTHORIZED);
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 2_048) {
      throw new ApiError("OAUTH_CALLBACK_INVALID", "소셜 로그인 응답이 올바르지 않습니다.", HttpStatus.BAD_REQUEST);
    }

    const attempt = await this.prisma.oAuthLoginAttempt.findUnique({
      where: { stateHash: hashOAuthSecret(state) },
    });
    const now = new Date();
    if (
      !attempt
      || attempt.provider !== provider
      || attempt.consumedAt
      || attempt.expiresAt.getTime() <= now.getTime()
    ) {
      throw new ApiError("OAUTH_STATE_INVALID", "소셜 로그인 요청이 만료되었거나 유효하지 않습니다.", HttpStatus.BAD_REQUEST);
    }
    const claimed = await this.prisma.oAuthLoginAttempt.updateMany({
      where: { id: attempt.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) {
      throw new ApiError("OAUTH_STATE_INVALID", "소셜 로그인 요청이 이미 처리되었습니다.", HttpStatus.BAD_REQUEST);
    }

    let identity: OAuthIdentity;
    try {
      identity = await this.requireOAuthClient().exchangeCode(provider, {
        code,
        state,
        nonce: attempt.nonce,
        codeVerifier: attempt.codeVerifier,
      });
    } catch (error) {
      this.throwOAuthError(error);
    }
    const user = await this.resolveOAuthUser(identity, requestId);
    if (user.status !== AccountStatus.ACTIVE) {
      throw new ApiError("ACCOUNT_UNAVAILABLE", "현재 사용할 수 없는 계정입니다.", HttpStatus.FORBIDDEN);
    }

    const sessionToken = generateSessionToken();
    const expiresAt = this.sessionExpiry();
    await this.prisma.$transaction([
      this.prisma.session.create({
        data: { userId: user.id, tokenHash: hashSessionToken(sessionToken), expiresAt },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: "auth.oauth.login",
          resourceType: "Session",
          requestId: requestId ?? null,
          metadata: { provider },
        },
      }),
    ]);
    return { user: this.toCurrentUser(user), sessionToken, expiresAt, returnTo: attempt.returnTo };
  }

  async authenticate(sessionToken: string | null): Promise<CurrentUser> {
    if (!sessionToken) {
      throw new ApiError("AUTH_REQUIRED", "로그인이 필요합니다.", HttpStatus.UNAUTHORIZED);
    }
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(sessionToken) },
      include: { user: { include: { roles: true } } },
    });
    if (
      !session
      || session.revokedAt
      || session.expiresAt.getTime() <= Date.now()
      || session.user.status !== AccountStatus.ACTIVE
    ) {
      throw new ApiError("SESSION_INVALID", "세션이 만료되었거나 유효하지 않습니다.", HttpStatus.UNAUTHORIZED);
    }
    return this.toCurrentUser(session.user);
  }

  async refresh(sessionToken: string | null, requestId?: string): Promise<AuthResult> {
    const user = await this.authenticate(sessionToken);
    const nextToken = generateSessionToken();
    const expiresAt = this.sessionExpiry();
    const currentHash = hashSessionToken(sessionToken as string);

    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { tokenHash: currentHash },
        data: { revokedAt: new Date() },
      }),
      this.prisma.session.create({
        data: { userId: user.id, tokenHash: hashSessionToken(nextToken), expiresAt },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: user.id,
          action: "auth.refresh",
          resourceType: "Session",
          requestId: requestId ?? null,
        },
      }),
    ]);

    return { user, sessionToken: nextToken, expiresAt };
  }

  async logout(sessionToken: string | null, requestId?: string): Promise<void> {
    if (!sessionToken) return;
    const tokenHash = hashSessionToken(sessionToken);
    const session = await this.prisma.session.findUnique({ where: { tokenHash } });
    if (!session || session.revokedAt) return;

    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          actorId: session.userId,
          action: "auth.logout",
          resourceType: "Session",
          resourceId: session.id,
          requestId: requestId ?? null,
        },
      }),
    ]);
  }

  getConfig(): AppConfig {
    return this.config;
  }

  private async resolveOAuthUser(identity: OAuthIdentity, requestId?: string): Promise<UserWithRoles> {
    const linked = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerUserId: {
          provider: identity.provider,
          providerUserId: identity.subject,
        },
      },
      include: { user: { include: { roles: true } } },
    });
    if (linked) return linked.user;

    if (identity.email) {
      const existingEmail = await this.prisma.user.findUnique({ where: { email: identity.email } });
      if (existingEmail) {
        throw new ApiError(
          "OAUTH_ACCOUNT_LINK_REQUIRED",
          "같은 이메일 계정이 있습니다. 기존 계정으로 로그인한 뒤 소셜 계정을 연결해 주세요.",
          HttpStatus.CONFLICT,
        );
      }
    }

    return this.prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          email: identity.email,
          displayName: identity.displayName.slice(0, 40),
          emailVerifiedAt: identity.emailVerified ? new Date() : null,
          roles: { create: [{ role: RoleType.STUDENT }] },
          oauthAccounts: {
            create: [{
              provider: identity.provider,
              providerUserId: identity.subject,
              email: identity.email,
            }],
          },
        },
        include: { roles: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId: created.id,
          action: "auth.oauth.signup",
          resourceType: "User",
          resourceId: created.id,
          requestId: requestId ?? null,
          metadata: { provider: identity.provider, emailVerified: identity.emailVerified },
        },
      });
      return created;
    });
  }

  private readOAuthProvider(value: string): OAuthProviderName {
    if (value === "naver" || value === "kakao" || value === "google") return value;
    throw new ApiError("OAUTH_PROVIDER_INVALID", "지원하지 않는 소셜 로그인 제공사입니다.", HttpStatus.NOT_FOUND);
  }

  private requireOAuthClient(): OAuthClient {
    if (!this.oauthClient) {
      throw new ApiError("OAUTH_NOT_CONFIGURED", "소셜 로그인 설정이 완료되지 않았습니다.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    return this.oauthClient;
  }

  private throwOAuthError(error: unknown): never {
    if (error instanceof OAuthComponentError && error.code === "PROVIDER_NOT_CONFIGURED") {
      throw new ApiError("OAUTH_NOT_CONFIGURED", "해당 소셜 로그인 설정이 완료되지 않았습니다.", HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (error instanceof OAuthComponentError && error.code === "INVALID_REQUEST") {
      throw new ApiError("OAUTH_REQUEST_INVALID", "소셜 로그인 요청이 올바르지 않습니다.", HttpStatus.BAD_REQUEST);
    }
    throw new ApiError("OAUTH_PROVIDER_ERROR", "소셜 로그인 제공사 응답을 확인하지 못했습니다.", HttpStatus.BAD_GATEWAY);
  }

  private sessionExpiry(): Date {
    return new Date(Date.now() + this.config.sessionTtlHours * 60 * 60 * 1000);
  }

  private passwordResetExpiry(): Date {
    return new Date(Date.now() + this.config.passwordResetTtlMinutes * 60 * 1000);
  }

  private emailVerificationExpiry(): Date {
    return new Date(Date.now() + this.config.emailVerificationTtlHours * 60 * 60 * 1000);
  }

  private queueAccountMail(
    kind: "email_verification" | "password_reset",
    userId: string,
    requestId: string | undefined,
    send: () => ReturnType<AccountMailService["sendEmailVerification"]>,
  ): void {
    if (!this.accountMail) return;
    setImmediate(() => {
      void this.deliverAccountMail(kind, userId, requestId, send);
    });
  }

  private async deliverAccountMail(
    kind: "email_verification" | "password_reset",
    userId: string,
    requestId: string | undefined,
    send: () => ReturnType<AccountMailService["sendEmailVerification"]>,
  ): Promise<void> {
    let status: "sent" | "skipped" | "failed";
    let messageId: string | undefined;
    let errorName: string | undefined;
    try {
      const result = await send();
      status = result.status;
      messageId = result.messageId;
    } catch (error) {
      status = "failed";
      errorName = error instanceof Error ? error.name : "UnknownError";
      this.logger.error(`Account email delivery failed: ${kind} (${errorName})`);
    }

    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: userId,
          action: `mail.account.${kind}.${status}`,
          resourceType: "EmailDelivery",
          resourceId: userId,
          requestId: requestId ?? null,
          metadata: {
            status,
            ...(messageId ? { messageId } : {}),
            ...(errorName ? { errorName } : {}),
          },
        },
      });
    } catch (error) {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      this.logger.error(`Account email audit failed: ${kind} (${errorName})`);
    }
  }

  private toCurrentUser(user: UserWithRoles): CurrentUser {
    return {
      id: user.id,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
      displayName: user.displayName,
      roles: user.roles.map(({ role }) => role.toLowerCase() as PublicRole),
    };
  }
}
