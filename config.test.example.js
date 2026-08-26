// 토스페이먼츠 사업자등록 전 테스트 결제용 브라우저 설정 예시입니다.
// 이 파일을 config.js로 복사한 뒤 개발자센터에서 발급받은 test_gck_ 키를 입력하세요.
// test_gsk_ 시크릿 키는 이 파일이나 다른 브라우저 자산에 절대 입력하지 않습니다.
window.APP_CONFIG = Object.freeze({
  apiBaseUrl: "/api/v1",
  oauthEnabled: false,
  oauthProviders: Object.freeze([]),
  boardApiEnabled: true,
  lectureApiEnabled: true,
  demoRoleSwitcher: false,
  paymentProvider: "toss-payments",
  tossPayments: Object.freeze({
    mode: "test",
    clientKey: "test_gck_개발자센터_테스트_클라이언트_키",
    paymentMethodVariantKey: "DEFAULT",
    agreementVariantKey: "AGREEMENT"
  })
});
