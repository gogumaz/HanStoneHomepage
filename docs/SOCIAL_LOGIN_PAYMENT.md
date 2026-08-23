# 간편 로그인·PortOne V1 토스페이 연동

> 결제 연동 방식은 PortOne V1 유지로 확정했습니다. React 구독 화면과 서버는
> PortOne V1 흐름으로 연결되어 있으며, 공급자 통신은 재사용 가능한 CBD 컴포넌트로 분리했습니다.
> 기존 정적 교재 결제 프로토타입만 향후 같은 컴포넌트로 이전해야 합니다.

## 1. 구현 범위

React 프런트엔드와 API에는 다음 연결점이 구현되어 있습니다.

- 네이버 간편 로그인 버튼
- 카카오톡 간편 로그인 버튼
- Google 간편 로그인 버튼
- PortOne V1 JavaScript SDK 결제 요청
- 서버 주문 생성 요청
- 결제 성공·실패 리다이렉트 화면
- 서버 결제 승인 요청

OAuth 토큰 교환과 PortOne 결제 조회·검증은 비밀 키가 필요한 서버 기능입니다. OAuth는 네이버·카카오 프로필 API와 Google OIDC JWKS 검증을 표준 프로필 계약으로 변환하며, 결제는 표준 조회·취소 계약으로 변환합니다. 두 컴포넌트 모두 현재 Prisma·사용자·구독 모델을 참조하지 않습니다. Git 추적 대상에는 비밀 키를 포함하지 않습니다.

운영 앱과 Redirect URI가 등록되기 전에는 `oauthEnabled=false`를 유지합니다. 서버 시작·콜백·계정 생성·세션 발급 경로는 구현되어 있으며 실제 공급자 앱 심사와 운영 자격증명 검증이 남아 있습니다.

## 2. 프런트엔드 설정

`config.example.js`를 참고해 배포 환경의 `config.js`를 설정합니다.

```javascript
window.APP_CONFIG = Object.freeze({
  apiBaseUrl: "https://api.example.com/api/v1",
  oauthEnabled: true,
  paymentProvider: "portone-v1",
  portoneV1: Object.freeze({
    userCode: "imp_운영_고객사_식별코드",
    pgProvider: "tosspay",
    mid: "운영_토스페이_MID",
    channelKey: "channel-key-운영_채널키"
  }),
  tossPayments: Object.freeze({
    mid: "tosstest",
    channelKey: "channel-key-851ec2b1-9bed-4487-b74b-a37c2503c0ce",
    clientKey: "test_결제위젯_클라이언트_키",
    paymentMethodVariantKey: "DEFAULT",
    agreementVariantKey: "AGREEMENT"
  })
});
```

### 프런트엔드에 둘 수 있는 값

- API 기본 주소
- OAuth 사용 여부
- PortOne V1 고객사 식별코드
- PortOne V1 PG Provider와 MID
- PortOne 채널 키

### 프런트엔드에 두면 안 되는 값

- 네이버 Client Secret
- 카카오 Client Secret
- Google Client Secret
- PortOne V1 REST API Key와 REST API Secret
- 운영자 토큰, DB 비밀번호, 세션 서명 키

## 3. 간편 로그인 흐름

### 적용 시점

- React 프로토타입 완료 전: `oauthEnabled = false`
- 프로토타입 완료 후: 운영·스테이징 도메인과 API 주소 확정
- 도메인 확정 후: 제공사별 앱·동의 화면·Redirect URI 등록 및 심사
- 서버 콜백과 세션 검증 완료 후: 환경별로 OAuth 활성화

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

## 4. PortOne V1 결제 설정

설정 파일은 공개값과 서버 비밀값으로 분리합니다.

| 파일 | 용도 | Git 커밋 |
|---|---|---|
| `config.js` | 고객사 식별코드, PG Provider, MID 등 브라우저 공개 설정 | 가능 |
| `payment/portone-v1.server.example.env` | 운영 환경변수 이름과 입력 예시 | 가능 |
| `payment/portone-v1.server.local.env` | 현재 테스트 REST API Key와 Secret | 금지(자동 제외) |

운영 전환 시에는 `config.example.js`의 PortOne V1 공개 설정과
`payment/portone-v1.server.example.env`의 서버 설정을 운영값으로 주입합니다.
토스페이 API Key는 PortOne 콘솔의 운영 채널에 등록하고 애플리케이션
브라우저 설정에는 넣지 않습니다. 테스트/실연동 웹훅 URL도 PortOne 콘솔에서
각각 등록해야 합니다.

## 5. PortOne V1 결제 검증 흐름

```text
상품의 “토스로 결제” 선택
  → 서버가 상품 가격·재고를 검증하고 merchant_uid를 생성
  → 브라우저가 IMP.init(userCode) 실행
  → IMP.request_pay()에 토스페이 PG와 주문 정보를 전달
  → 콜백에서 imp_uid와 merchant_uid를 서버로 전달
  → 서버가 PortOne V1 REST API로 결제 건을 다시 조회
  → 주문번호·결제금액·결제상태를 DB 주문과 비교
  → 검증 성공 시 주문 및 구독 상태를 paid로 변경
```

브라우저 콜백과 웹훅의 성공 여부만 신뢰하면 안 됩니다. 서버는 REST API Key와
Secret으로 PortOne 액세스 토큰을 발급받고 `imp_uid` 결제를 다시 조회해야 합니다.
웹훅을 중복 수신하거나 사용자가 결과 페이지를 새로고침해도 동일 주문이 한 번만
처리되도록 `imp_uid`와 `merchant_uid`에 고유 제약 및 멱등 처리를 적용합니다.

강의 구독 화면과 React `/subscriptions`는 PortOne V1 SDK와
`/payments/portone/verify` 서버 검증으로 전환했습니다. 홈페이지 교재 상품의
`index.html`, `script.js`에는 기존 토스페이먼츠 직접 SDK 프로토타입이 남아 있어
교재 주문 모델을 구현할 때 PortOne 흐름으로 교체해야 합니다.

## 6. 운영 전 필수 작업

- 제공사별 운영 앱 등록 및 심사 완료
- 운영 도메인과 Redirect URI 확정
- 개인정보처리방침에 소셜 계정 연동과 결제 처리자 고지
- 계정 연결·해제와 탈퇴 시 제공사 토큰 폐기 정책 구현
- PortOne 콘솔에 토스페이 운영 MID와 실거래용 API Key 등록
- PortOne 운영 키와 웹훅 URL 주입 후 실제 결제·취소 대사 확인
- 결제 성공, 실패, 취소, 중복 승인, 금액 변조 테스트
- [x] 관리자 결제 대사·불일치 표시·PortOne 재동기화·환불 처리 화면 구현
- [x] 결제 대사 기간·상태·검색·페이지 조회와 동일 조건 CSV 내보내기 구현
- PortOne 콘솔 V1 웹훅 URL 등록과 운영 재전송 확인
- 테스트 키를 운영 키로 교체하기 전 환경 분리 확인
