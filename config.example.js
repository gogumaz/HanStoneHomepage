// 배포 환경에서 이 값을 주입하거나 config.js로 복사해 사용합니다.
// OAuth Client Secret과 토스페이먼츠 Secret Key는 절대 이 파일에 넣지 않습니다.
window.APP_CONFIG = Object.freeze({
  apiBaseUrl: "https://api.example.com/api/v1",
  oauthEnabled: true,
  oauthProviders: Object.freeze(["naver", "kakao", "google"]),
  boardApiEnabled: true,
  lectureApiEnabled: true,
  demoRoleSwitcher: false,
  paymentProvider: "toss-payments",
  tossPayments: Object.freeze({
    // 토스페이먼츠 결제위젯용 공개 클라이언트 키입니다. Secret Key는 서버에만 둡니다.
    // 사업자등록 전 테스트는 mode: "test"와 test_gck_ 키를 함께 사용합니다.
    mode: "live",
    clientKey: "live_gck_운영_클라이언트_키",
    paymentMethodVariantKey: "DEFAULT",
    agreementVariantKey: "AGREEMENT"
  })
});
