import { HttpStatus, Inject, Injectable, Optional } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import { ApiError } from "../common/api-error.js";
import { loadAppConfig, type AppConfig } from "../config/app-config.js";
import {
  verifyMailDomainAuthentication,
  type MailDomainAuthenticationResult,
} from "./mail-domain-authentication.js";

export const MAIL_TRANSPORT = Symbol("MAIL_TRANSPORT");

export type MailDeliveryResult = {
  status: "sent" | "skipped";
  messageId?: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] as string);
}

@Injectable()
export class AccountMailService {
  private readonly config: AppConfig;
  private readonly transporter: Transporter | null;

  constructor(@Optional() @Inject(MAIL_TRANSPORT) transport?: Transporter) {
    this.config = loadAppConfig();
    this.transporter = transport ?? this.createTransport();
  }

  sendEmailVerification(input: { email: string; displayName: string; token: string }): Promise<MailDeliveryResult> {
    const url = this.accountUrl("verifyEmailToken", input.token);
    return this.send({
      to: input.email,
      subject: "[바둑타고] 이메일을 인증해 주세요",
      text: `${input.displayName}님, 아래 링크에서 이메일 인증을 완료해 주세요.\n\n${url}\n\n이 링크는 ${this.config.emailVerificationTtlHours}시간 동안 한 번만 사용할 수 있습니다.`,
      html: `<p><strong>${escapeHtml(input.displayName)}</strong>님, 이메일 인증을 완료해 주세요.</p><p><a href="${escapeHtml(url)}">이메일 인증하기</a></p><p>이 링크는 ${this.config.emailVerificationTtlHours}시간 동안 한 번만 사용할 수 있습니다.</p>`,
    });
  }

  sendPasswordReset(input: { email: string; displayName: string; token: string }): Promise<MailDeliveryResult> {
    const url = this.accountUrl("resetToken", input.token);
    return this.send({
      to: input.email,
      subject: "[바둑타고] 비밀번호를 다시 설정해 주세요",
      text: `${input.displayName}님, 아래 링크에서 비밀번호를 다시 설정해 주세요.\n\n${url}\n\n이 링크는 ${this.config.passwordResetTtlMinutes}분 동안 한 번만 사용할 수 있습니다. 요청하지 않았다면 이 메일을 무시해 주세요.`,
      html: `<p><strong>${escapeHtml(input.displayName)}</strong>님, 비밀번호를 다시 설정해 주세요.</p><p><a href="${escapeHtml(url)}">비밀번호 재설정하기</a></p><p>이 링크는 ${this.config.passwordResetTtlMinutes}분 동안 한 번만 사용할 수 있습니다. 요청하지 않았다면 이 메일을 무시해 주세요.</p>`,
    });
  }

  sendInquiryAnswered(input: { email: string; displayName: string; inquiryId: string }): Promise<MailDeliveryResult> {
    const url = new URL("/board.html", this.config.publicAppUrl);
    url.searchParams.set("type", "inquiry");
    url.searchParams.set("id", input.inquiryId);
    return this.send({
      to: input.email,
      subject: "[바둑타고] 1:1 문의에 답변이 등록되었습니다",
      text: `${input.displayName}님, 접수하신 1:1 문의에 답변이 등록되었습니다.\n\n${url.toString()}\n\n로그인 후 본인 문의함에서 답변을 확인해 주세요.`,
      html: `<p><strong>${escapeHtml(input.displayName)}</strong>님, 접수하신 1:1 문의에 답변이 등록되었습니다.</p><p><a href="${escapeHtml(url.toString())}">내 문의 답변 확인하기</a></p><p>로그인 후 본인 문의함에서 답변을 확인해 주세요.</p>`,
    });
  }

  async verifyConnection(): Promise<void> {
    if (!this.transporter || !this.config.smtpFrom) {
      throw new ApiError(
        "SMTP_NOT_CONFIGURED",
        "SMTP 연결 설정이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    try {
      await this.transporter.verify();
    } catch {
      throw new ApiError(
        "SMTP_PREFLIGHT_FAILED",
        "SMTP DNS·TLS·인증 연결을 확인하지 못했습니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async verifyDomainAuthentication(): Promise<MailDomainAuthenticationResult> {
    if (!this.config.smtpFrom || !this.config.mailDkimSelector) {
      throw new ApiError(
        "MAIL_DOMAIN_AUTH_NOT_CONFIGURED",
        "메일 발신 도메인과 DKIM 선택자 설정이 필요합니다.",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return verifyMailDomainAuthentication({
      mailFrom: this.config.smtpFrom,
      dkimSelector: this.config.mailDkimSelector,
    });
  }

  private createTransport(): Transporter | null {
    if (!this.config.smtpHost) return null;
    return nodemailer.createTransport({
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: this.config.smtpSecure,
      requireTLS: this.config.smtpRequireTls,
      connectionTimeout: this.config.smtpConnectionTimeoutMs,
      greetingTimeout: this.config.smtpConnectionTimeoutMs,
      socketTimeout: this.config.smtpConnectionTimeoutMs,
      disableFileAccess: true,
      disableUrlAccess: true,
      ...(this.config.smtpUser && this.config.smtpPassword
        ? { auth: { user: this.config.smtpUser, pass: this.config.smtpPassword } }
        : {}),
    });
  }

  private accountUrl(parameter: "verifyEmailToken" | "resetToken", token: string): string {
    const url = new URL("/account", this.config.publicAppUrl);
    url.searchParams.set(parameter, token);
    return url.toString();
  }

  private async send(message: { to: string; subject: string; text: string; html: string }): Promise<MailDeliveryResult> {
    if (!this.transporter || !this.config.smtpFrom) return { status: "skipped" };
    const result = await this.transporter.sendMail({
      from: this.config.smtpFrom,
      ...message,
    });
    return { status: "sent", ...(result.messageId ? { messageId: String(result.messageId) } : {}) };
  }
}
