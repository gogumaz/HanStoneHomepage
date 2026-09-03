# 토스페이먼츠 테스트 결제 실행

현재 프로젝트는 토스페이먼츠 SDK v2 주문서형 결제를 사용합니다. 교재 주문과 계정 구독 모두 브라우저에서 결제수단·약관 UI를 렌더링하고, 인증 성공 뒤 서버가 `/v1/payments/confirm`을 호출해 최종 승인합니다.

## 1. 테스트 키 준비

토스페이먼츠 개발자센터의 개발자용 테스트 상점에서 같은 세트의 키 두 개를 확인합니다.

- 브라우저 공개 키: `test_gck_`로 시작하는 결제위젯 클라이언트 키
- 서버 전용 키: 위 클라이언트 키와 한 쌍이며 `test_gsk_`로 시작하는 시크릿 키

`test_ck_` API 개별 연동 키는 현재 `widgets()` 연동에 사용하지 않습니다. 테스트·라이브 키를 섞지 않고 시크릿 키를 `config.js`, HTML, React 환경변수 또는 Git 저장소에 넣지 않습니다.

## 2. 로컬 설정

브라우저 설정 예시를 복사한 뒤 `clientKey`만 실제 테스트 클라이언트 키로 교체합니다.

```powershell
Copy-Item -LiteralPath .\config.test.example.js -Destination .\config.js
```

서버를 직접 실행한다면 `server/.env`에 시크릿 키를 설정합니다.

```dotenv
TOSS_PAYMENTS_SECRET_KEY=test_gsk_개발자센터에서_발급받은_시크릿_키
```

Docker Compose로 실행할 때는 현재 PowerShell 세션 또는 저장소 루트의 Git 제외 `.env`에 같은 값을 설정합니다. Compose는 이 값을 API 컨테이너에만 전달합니다.

```powershell
$env:TOSS_PAYMENTS_SECRET_KEY = "test_gsk_개발자센터에서_발급받은_시크릿_키"
docker compose up -d database redis api
npm run dev:web
```

키를 입력한 다음 아래 준비 점검을 실행합니다. 결과에는 키 문자열이 포함되지 않으며 여섯 점검이 모두 `pass`여야 합니다.

```powershell
npm run verify:toss-test-readiness
```

서버를 직접 실행하는 경우에는 DB를 준비하고 마이그레이션한 뒤 API와 웹을 각각 실행합니다.

```powershell
docker compose up -d database redis
npm --prefix server run db:deploy
npm --prefix server run dev
npm run dev:web
```

## 3. 테스트 결제

1. `http://127.0.0.1:5173/account`에서 테스트 회원을 만들고 로그인합니다.
2. 구독은 `/subscriptions`, 교재는 홈페이지의 교재 구매 영역에서 결제를 시작합니다.
3. 결제수단과 약관 위젯이 모두 표시되고 결제 버튼이 활성화된 뒤, 화면에 “테스트 결제입니다. 실제 금액은 청구되지 않습니다.” 안내가 표시되는지 확인합니다. 위젯 준비 중이거나 렌더링에 실패하면 결제 버튼은 비활성 상태를 유지합니다.
4. 결제 인증을 완료하면 성공 URL의 `paymentKey`, `orderId`, `amount`가 서버 승인 API로 전달됩니다.
5. 구독 내역 또는 교재 주문 내역이 `결제 완료`인지 확인합니다.
6. 토스페이먼츠 개발자센터 테스트 결제 내역에서 같은 `orderId`를 확인합니다.

브라우저의 `amount`는 신뢰하지 않습니다. 서버가 저장한 주문 금액과 먼저 비교하고, 토스페이먼츠 승인 응답의 결제키·주문번호·금액·상태를 다시 확인한 뒤에만 주문을 완료합니다. 성공 페이지 새로고침이나 네트워크 재시도에는 주문별로 같은 `Idempotency-Key`를 재사용합니다.

## 4. 실패·재시도 확인

- 결제창 닫기: 주문은 `pending` 상태로 남고 중복 주문 대신 같은 유효 주문을 재사용해야 합니다.
- 성공 URL 새로고침: 중복 구독이나 중복 주문을 만들지 않고 기존 결제 완료 결과를 반환해야 합니다.
- 금액 쿼리 변경: 서버 승인 전에 `PAYMENT_AMOUNT_MISMATCH`로 거부해야 합니다.
- 다른 클라이언트·시크릿 키 세트 사용: 토스페이먼츠의 `INVALID_API_KEY`로 실패해야 합니다.
- 테스트 모드에 `live_gck_` 입력: 브라우저가 결제창을 열기 전에 설정 불일치로 차단해야 합니다.

테스트 승인 실패 후 `paymentKey`가 확보되어 있다면 운영자 결제 대사 화면에서 토스 원본 재조회를 실행해 주문 상태 복구도 확인합니다.

## 5. 앱 WebView 연동 범위

현재 저장소는 웹 애플리케이션이며 모바일 브라우저 결제까지 지원합니다. Android·iOS 네이티브 WebView로 감싸는 경우에는 별도 앱 작업이 필요합니다.

- Android `shouldOverrideUrlLoading`에서 카드사·간편결제 앱스킴과 Intent URL을 처리합니다.
- iOS `WKNavigationDelegate`에서 외부 앱스킴을 열고 필요한 스킴을 앱 설정에 등록합니다.
- 앱 복귀 후에도 웹 성공 URL에서 서버 승인 API를 호출하며 시크릿 키를 앱에 포함하지 않습니다.

네이티브 앱 프로젝트가 추가되기 전에는 모바일 WebView 앱투앱 전환을 완료 항목으로 처리하지 않습니다.
