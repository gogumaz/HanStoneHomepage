# 재사용 통합 컴포넌트

이 디렉터리는 현재 서비스 도메인과 분리된 CBD(Component-Based Development) 경계이자 독립 npm 패키지 `@baduk-history/integration-components`의 단일 소스입니다. 컴포넌트는 Prisma 모델, 사용자·구독 엔티티, 현재 서비스의 `ApiError`를 import하지 않습니다. 다른 NestJS 애플리케이션에서는 패키지를 설치하고 모듈 옵션과 계약만 연결할 수 있습니다.

## 패키지 빌드와 설치

프로젝트 루트에서 공개 진입점, 타입 선언, 패키지 포함 파일을 한 번에 검증합니다.

```bash
npm run pack:components
```

실제 설치 파일이 필요하면 컴포넌트 디렉터리에서 패키지를 생성합니다. 생성되는 `.tgz`는 저장소에 커밋하지 않습니다.

```bash
cd server/src/components
npm pack
npm install /path/to/baduk-history-integration-components-0.1.0.tgz
```

소비 애플리케이션에서는 필요한 공개 경계만 가져옵니다.

```ts
import {
  OAuthClient,
  OAuthComponentModule,
} from "@baduk-history/integration-components/oauth";
import {
  PAYMENT_PROVIDER,
  PaymentComponentModule,
  type PaymentProvider,
} from "@baduk-history/integration-components/payments";
```

현재 패키지는 Node.js 24 이상과 NestJS 11을 기준으로 검증합니다. `@nestjs/common`은 소비 애플리케이션과 Nest 런타임을 공유하는 peer dependency이며, `jose`는 OAuth 구현에 필요한 패키지 직접 의존성입니다. 라이선스와 배포 레지스트리가 결정되기 전에는 사내 파일 패키지 또는 비공개 레지스트리에서 사용합니다.

## OAuth 컴포넌트

공개 진입점은 `oauth/index.ts`입니다. `OAuthComponentModule`, `OAuthClient`, `OAuthProvider`, `OAuthIdentity`가 공개 계약이며 네이버·카카오·Google 어댑터가 포함됩니다.

```ts
OAuthComponentModule.register({
  providers: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: process.env.GOOGLE_REDIRECT_URI!,
    },
  },
})
```

```ts
constructor(private readonly oauth: OAuthClient) {}

const url = this.oauth.createAuthorizationUrl("google", {
  state,
  nonce,
  codeChallenge,
});
const identity = await this.oauth.exchangeCode("google", {
  code,
  state,
  nonce,
  codeVerifier,
});
```

애플리케이션은 `state`, nonce, PKCE verifier의 생성·보관·일회성 소비와 서비스 계정 연결 정책을 담당합니다. 컴포넌트는 공급자 통신과 표준 `OAuthIdentity` 변환을 담당합니다. Google 어댑터는 고정 JWKS URL에서 키를 가져와 ID Token 서명, issuer, audience, nonce를 검증합니다.

## 결제 컴포넌트

공개 진입점은 `payments/index.ts`입니다. 애플리케이션은 `PAYMENT_PROVIDER` 토큰과 `PaymentProvider` 계약에만 의존하며 토스페이먼츠 Core API 어댑터를 사용합니다.

```ts
constructor(@Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider) {}

const payment = await this.payments.getPayment(paymentId);
await this.payments.cancelPayment({ paymentId, amount, checksum, reason });
```

토스페이먼츠 결제위젯을 직접 사용하는 앱은 서버 전용 Secret Key로 직접 어댑터를 등록합니다. 브라우저 인증 결과의 `paymentKey`, 서버 주문번호와 서버 금액을 `confirmPayment`에 전달하며 같은 요청을 재시도할 때는 같은 멱등키를 사용합니다.

```ts
PaymentComponentModule.register({
  provider: "toss-payments",
  tossPayments: {
    secretKey: process.env.TOSS_PAYMENTS_SECRET_KEY ?? null,
  },
})
```

```ts
if (!this.payments.confirmPayment) throw new Error("Payment confirmation is not supported.");
const payment = await this.payments.confirmPayment({
  paymentId: paymentKey,
  orderId,
  amount: serverAmount,
  idempotencyKey: requestId,
});
```

주문 가격, 멱등 처리, 구독 발급, 권한 회수와 감사 정책은 사용하는 애플리케이션이 담당합니다. 다른 결제사를 추가할 때는 `PaymentProvider`만 구현하고 모듈 팩터리에 등록합니다.

## 의존성 규칙

```text
application domain → component contract ← provider adapter
```

- 컴포넌트에서 `auth`, `subscription`, `database`, Prisma를 참조하지 않습니다.
- 공급자 응답 원문과 비밀 토큰은 애플리케이션으로 반환하지 않습니다.
- 컴포넌트 오류는 `OAuthComponentError`, `PaymentComponentError`로 통일하고 HTTP 오류 변환은 애플리케이션 경계에서 수행합니다.
- 테스트에서는 옵션의 `fetch`를 주입하여 실제 외부 호출 없이 계약을 검증할 수 있습니다.

## 공개 API와 버전 규칙

- 공개 진입점은 패키지 루트, `/oauth`, `/payments`뿐입니다. 내부 파일 경로를 직접 import하지 않습니다.
- 공개 타입·메서드 제거 또는 호환되지 않는 변경은 major 버전을 올립니다.
- 호환되는 공급자 추가와 기능 추가는 minor, 버그 수정은 patch 버전을 올립니다.
- 애플리케이션별 상태 저장, DB 모델, HTTP 예외, 비즈니스 정책은 패키지에 넣지 않습니다.
