// 배포 환경에서 이 값을 주입하거나 config.js로 복사해 사용합니다.
// OAuth Client Secret과 토스페이먼츠 Secret Key는 절대 이 파일에 넣지 않습니다.
window.APP_CONFIG = Object.freeze({
  apiBaseUrl: "https://api.example.com/api/v1",
  oauthEnabled: true,
  boardApiEnabled: true,
  lectureApiEnabled: true,
  demoRoleSwitcher: false,
  tossPayments: Object.freeze({
    // 토스페이먼츠 개발자센터의 결제위젯 연동 클라이언트 키(공개 키)
    clientKey: "test_여기에_결제위젯_클라이언트_키를_입력하세요",
    paymentMethodVariantKey: "DEFAULT",
    agreementVariantKey: "AGREEMENT"
  })
});
