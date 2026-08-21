# 간편 로그인·토스페이먼츠 연동

## 1. 구현 범위

프런트엔드에는 다음 연결점이 구현되어 있습니다.

- 네이버 간편 로그인 버튼
- 카카오톡 간편 로그인 버튼
- Google 간편 로그인 버튼
- 토스페이먼츠 JavaScript SDK v2 결제위젯
- 서버 주문 생성 요청
- 결제 성공·실패 리다이렉트 화면
- 서버 결제 승인 요청

OAuth 토큰 교환과 토스페이먼츠 최종 결제 승인은 비밀 키가 필요한 서버 기능입니다. 현재 저장소에는 비밀 키가 포함되어 있지 않습니다.

## 2. 프런트엔드 설정

`config.example.js`를 참고해 배포 환경의 `config.js`를 설정합니다.

```javascript
window.APP_CONFIG = Object.freeze({
  apiBaseUrl: "https://api.example.com/api/v1",
  oauthEnabled: true,
  tossPayments: Object.freeze({
    clientKey: "test_결제위젯_클라이언트_키",
    paymentMethodVariantKey: "DEFAULT",
    agreementVariantKey: "AGREEMENT"
  })
});
```

### 프런트엔드에 둘 수 있는 값

- API 기본 주소
- OAuth 사용 여부
- 토스페이먼츠 결제위젯 클라이언트 키
- 결제위젯 Variant Key

### 프런트엔드에 두면 안 되는 값

- 네이버 Client Secret
- 카카오 Client Secret
- Google Client Secret
- 토스페이먼츠 Secret Key
- 운영자 토큰, DB 비밀번호, 세션 서명 키

## 3. 간편 로그인 흐름

브라우저는 로그인 버튼을 누르면 다음 서버 엔드포인트로 이동합니다.

```text
GET /api/v1/auth/oauth/{provider}/start?returnTo=/원래경로
```

`provider`는 `naver`, `kakao`, `google` 중 하나입니다.

권장 서버 흐름:

1. `returnTo`를 허용된 내부 경로로 정규화합니다.
2. 추측하기 어려운 `state` 값을 생성하고 서버 세션에 저장합니다.
3. 제공사의 인가 페이지로 리다이렉트합니다.
4. 콜백에서 `state`와 인가 코드를 검증합니다.
5. 서버가 Client Secret을 사용해 토큰을 교환합니다.
6. 제공사 사용자 식별자를 서비스 계정과 연결합니다.
7. 서비스 세션 쿠키를 발급합니다.
8. 검증된 `returnTo`로 이동합니다.

### 제안 엔드포인트

| 메서드 | 경로 | 설명 |
|---|---|---|
| `GET` | `/auth/oauth/naver/start` | 네이버 인가 시작 |
| `GET` | `/auth/oauth/naver/callback` | 네이버 인가 코드 처리 |
| `GET` | `/auth/oauth/kakao/start` | 카카오 인가 시작 |
| `GET` | `/auth/oauth/kakao/callback` | 카카오 인가 코드 처리 |
| `GET` | `/auth/oauth/google/start` | Google OIDC 시작 |
| `GET` | `/auth/oauth/google/callback` | Google 코드 및 ID Token 처리 |

### 제공사 콘솔 설정

#### 네이버

1. 네이버 개발자센터에 애플리케이션을 등록합니다.
2. 네이버 로그인 API 권한을 활성화합니다.
3. 서비스 URL과 Callback URL을 실제 도메인과 일치시킵니다.
4. `state`를 서버에서 생성·검증합니다.

공식 문서: <https://developers.naver.com/docs/login/api/api.md>

#### 카카오

1. 카카오디벨로퍼스에서 앱과 웹 플랫폼을 등록합니다.
2. 카카오 로그인을 활성화하고 Redirect URI를 등록합니다.
3. 필요한 동의항목만 요청합니다.
4. 로그인 목적이면 OpenID Connect 사용을 권장합니다.

공식 문서: <https://developers.kakao.com/docs/ko/kakaologin/rest-api>

#### Google

1. Google Cloud Console에서 OAuth 동의 화면을 구성합니다.
2. 웹 애플리케이션 OAuth Client를 생성합니다.
3. 승인된 Redirect URI를 등록합니다.
4. OIDC `state`, `nonce`, ID Token의 서명·발급자·대상·만료를 서버에서 검증합니다.
5. 기본 로그인에는 `openid email profile` 최소 범위를 사용합니다.

공식 문서: <https://developers.google.com/identity/openid-connect/openid-connect>

### 서버 환경 변수 예시

```text
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
NAVER_REDIRECT_URI=https://api.example.com/api/v1/auth/oauth/naver/callback

KAKAO_REST_API_KEY=
KAKAO_CLIENT_SECRET=
KAKAO_REDIRECT_URI=https://api.example.com/api/v1/auth/oauth/kakao/callback

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://api.example.com/api/v1/auth/oauth/google/callback
```

비밀 값은 비밀 관리 서비스 또는 서버 환경 변수로 주입하고 저장소에 커밋하지 않습니다.

## 4. 토스페이먼츠 결제 흐름

현재 프런트엔드 구현은 토스페이먼츠 SDK v2 주문서형 결제위젯을 사용합니다.

```text
상품의 “토스로 결제” 선택
  → POST /orders/checkout
  → 서버가 상품 가격·재고를 검증하고 주문 생성
  → 서버가 orderId, amount, orderName 반환
  → 브라우저가 결제위젯 렌더링
  → widgets.requestPayment()
  → payment/success.html 또는 payment/fail.html
  → POST /payments/toss/confirm
  → 서버가 저장된 주문 금액과 비교
  → 토스페이먼츠 결제 승인 API 호출
  → 주문 상태를 paid로 변경
```

공식 문서:

- JavaScript SDK v2: <https://docs.tosspayments.com/sdk/v2/js>
- 결제위젯 연동: <https://docs.tosspayments.com/guides/v2/payment-widget>
- 결제 흐름: <https://docs.tosspayments.com/guides/v2/get-started/payment-flow>

### 주문 생성 요청

```http
POST /api/v1/orders/checkout
Content-Type: application/json

{
  "items": [
    { "productId": "starter-kit", "quantity": 1 }
  ]
}
```

서버 응답 예시:

```json
{
  "data": {
    "orderId": "order_01JABCDEF123456",
    "orderName": "첫 여행 체험 키트",
    "amount": 39000,
    "customerKey": "user_01J123",
    "customerEmail": "student@example.com",
    "customerName": "홍길동",
    "customerMobilePhone": "01012345678"
  }
}
```

상품 가격과 주문 금액은 서버가 상품 DB를 기준으로 계산해야 합니다. 브라우저의 `data-product-price` 값은 화면 표시와 1차 이상 감지용이며 결제 근거로 신뢰하면 안 됩니다.

### 결제 승인 요청

성공 URL은 토스페이먼츠가 전달한 값을 서버로 보냅니다.

```http
POST /api/v1/payments/toss/confirm
Content-Type: application/json

{
  "paymentKey": "...",
  "orderId": "order_01JABCDEF123456",
  "amount": 39000
}
```

서버는 다음 순서로 처리합니다.

1. 로그인 사용자에게 해당 주문 권한이 있는지 확인합니다.
2. DB에 저장된 주문 금액과 전달받은 금액을 비교합니다.
3. 이미 승인된 주문이면 기존 결과를 멱등하게 반환합니다.
4. 토스페이먼츠 Secret Key로 승인 API를 호출합니다.
5. 승인 응답과 주문 상태를 하나의 트랜잭션으로 저장합니다.
6. 성공한 주문에만 교재 또는 계정 구독 권한을 부여합니다.

강의는 개별 결제하지 않습니다. 계정 구독 주문이면 서버가 `SubscriptionPlan`의 최신 개월 수와 금액을 검증하고, 승인 시각을 `paidAt`과 `startsAt`으로 저장합니다. 한국시간 달력 기준으로 플랜 개월 수를 더한 날짜까지 이용하게 한 뒤 다음 날 `00:00:00`을 `endsAt`으로 계산합니다. 예를 들어 8월 19일에 1개월 구독을 승인하면 9월 20일 00:00:00에 종료됩니다. 결제와 구독 발급은 같은 트랜잭션에서 처리하고, 활성 구독 중 중복 결제는 차단합니다.

토스페이먼츠 Secret Key는 서버에서만 사용합니다. 토스페이먼츠 안내에 따라 결제 인증 후 제한 시간 안에 승인을 완료해야 합니다.

### 서버 환경 변수 예시

```text
TOSS_PAYMENTS_CLIENT_KEY=test_...
TOSS_PAYMENTS_SECRET_KEY=test_...
TOSS_PAYMENTS_WEBHOOK_SECRET=
```

Client Key는 프런트엔드 설정에 노출할 수 있지만 Secret Key는 서버 외부로 노출하면 안 됩니다.

## 5. 운영 전 필수 작업

- 제공사별 운영 앱 등록 및 심사 완료
- 운영 도메인과 Redirect URI 확정
- 개인정보처리방침에 소셜 계정 연동과 결제 처리자 고지
- 계정 연결·해제와 탈퇴 시 제공사 토큰 폐기 정책 구현
- 토스페이먼츠 계약과 운영 키 발급
- 결제 성공, 실패, 취소, 중복 승인, 금액 변조 테스트
- 결제 취소와 환불 API 및 운영자 처리 화면 구현
- 웹훅 서명 검증과 주문 상태 동기화
- 테스트 키를 운영 키로 교체하기 전 환경 분리 확인
