# 간편 로그인·토스페이먼츠 연동

계정 구독과 교재 주문은 모두 토스페이먼츠 결제위젯 SDK v2 및 Core API를 사용합니다. OAuth와 결제 공급자 통신은 `server/src/components`의 재사용 가능한 CBD 컴포넌트로 분리되어 있습니다.

## 구성

- 브라우저: `config.js`에 공개 결제위젯 클라이언트 키만 사용
- 서버: `TOSS_PAYMENTS_SECRET_KEY`로 결제 승인·조회·취소
- OAuth: 네이버·카카오·Google 공급자별 Client ID·Secret·Redirect URI
- 비밀 키는 Git 추적 파일과 브라우저 자산에 포함하지 않음

네이버 로그인은 `https://nid.naver.com/oauth2.0/authorize`에서 `state`와 PKCE로 시작하고, 콜백에서 네이버 토큰 교환과 Bearer 프로필 조회를 마친 뒤 서버 세션을 발급합니다. 자동 통합 테스트는 인가 요청부터 사용자 생성·세션 쿠키·원래 경로 복귀·콜백 재사용 차단까지 외부 응답을 모사해 검증합니다. 운영 배포 전에는 별도로 네이버 개발자센터의 실제 Client ID·Secret·Callback URL을 사용한 현장 검증이 필요합니다.

카카오 로그인은 `https://kauth.kakao.com/oauth/authorize`에서 `profile_nickname account_email` 동의 범위와 `state`·PKCE를 적용합니다. 콜백은 토큰 교환 후 Bearer 프로필 조회로 카카오 회원번호, 검증 이메일, 닉네임을 매핑하고 서버 세션을 발급합니다. 자동 통합 테스트는 원래 경로 복귀와 동일 콜백 재사용 차단까지 검증하며, 운영 배포 전에는 카카오 개발자 콘솔에 실제 Redirect URI와 동의 항목을 등록해 현장 검증해야 합니다.

Google 로그인은 OIDC `openid email profile` 범위와 `state`·PKCE·`nonce`로 시작합니다. 콜백에서 받은 ID 토큰은 Google JWKS 서명, 발급자, Client ID 대상, 만료와 `nonce`를 검증한 뒤에만 계정과 서버 세션을 만듭니다. 자동 통합 테스트는 토큰 요청부터 검증된 이메일·이름 매핑, 원래 경로 복귀와 콜백 재사용 차단까지 확인하며, 운영 배포 전에는 Google Cloud Console의 실제 OAuth 동의 화면과 Redirect URI로 현장 검증해야 합니다.

OAuth `state` 원문은 저장하지 않고 SHA-256 해시, 공급자, 만료 시각, 사용 시각을 서버에 보관합니다. 콜백에서는 형식·해시·공급자·만료·일회성 소비를 확인한 뒤에만 토큰을 교환합니다. Google `nonce`는 시작 요청과 같은 값을 서명 검증된 ID 토큰에서 다시 확인하며, 누락되거나 일치하지 않으면 사용자나 세션을 만들지 않습니다.

브라우저 공개 설정은 다음과 같습니다.

```js
window.APP_CONFIG = Object.freeze({
  paymentProvider: "toss-payments",
  tossPayments: Object.freeze({
    mode: "live",
    clientKey: "live_gck_운영_클라이언트_키",
    paymentMethodVariantKey: "DEFAULT",
    agreementVariantKey: "AGREEMENT"
  })
});
```

서버에는 다음 환경변수를 주입합니다.

```dotenv
TOSS_PAYMENTS_SECRET_KEY=live_gsk_운영_시크릿_키
```

## CBD 결제 모듈

```ts
PaymentComponentModule.register({
  provider: "toss-payments",
  tossPayments: {
    secretKey: process.env.TOSS_PAYMENTS_SECRET_KEY ?? null,
  },
});
```

결제 도메인은 `PaymentProvider` 계약만 사용합니다. 토스 어댑터는 Basic 인증을 사용하는 승인·조회·취소와 `Idempotency-Key` 전달을 담당하고, 상품 가격·주문 소유권·구독 발급·환불 권한은 애플리케이션이 담당합니다.

## 구독 결제 흐름

```text
POST /api/v1/orders/checkout
  → 서버 가격으로 sub_ 주문 생성
  → 브라우저가 토스 결제위젯 렌더링
  → 성공 URL에서 paymentKey·orderId·amount 수신
  → POST /api/v1/payments/toss/subscriptions/confirm
  → 서버가 저장 금액을 대조하고 토스 Core API 승인
  → 승인 응답을 재검증한 뒤 구독 발급
```

구독 웹훅 URL은 `/api/v1/payments/toss/subscriptions/webhook`, 교재 주문 웹훅 URL은 `/api/v1/payments/toss/webhook`입니다. 두 엔드포인트 모두 웹훅 본문의 상태를 직접 신뢰하지 않고 `paymentKey`로 토스 원본 결제를 다시 조회합니다.

결제 승인·취소 재시도에는 주문별로 안정적인 멱등키를 사용합니다. DB의 결제키 고유 제약과 조건부 상태 갱신으로 중복 승인과 중복 구독 발급을 차단합니다.

사업자등록 전 `test_gck_`·`test_gsk_` 키로 실행하는 방법은 [토스페이먼츠 테스트 결제 실행](./TOSS_TEST_PAYMENT.md)을 따릅니다.

## 운영 전 확인

- 토스페이먼츠 운영 클라이언트 키와 Secret Key 분리 주입
- 운영 도메인의 성공·실패 URL 등록 및 HTTPS 확인
- 구독·교재 웹훅 URL 등록과 재전송 확인
- 결제 성공·실패·취소·부분 환불·중복 승인·금액 변조 테스트
- 관리자 대사 화면에서 토스 원본 재조회와 전액 환불 확인
- 개인정보처리방침에 결제 처리자와 보유 항목 고지
