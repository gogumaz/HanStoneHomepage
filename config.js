window.APP_CONFIG = Object.freeze({
  apiBaseUrl: "/api/v1",
  oauthEnabled: true,
  oauthProviders: Object.freeze(["naver", "kakao", "google"]),
  boardApiEnabled: true,
  lectureApiEnabled: true,
  demoRoleSwitcher: false,
  paymentProvider: "toss-payments",
  tossPayments: Object.freeze({
    mode: "test",
    clientKey: "test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm",
    paymentMethodVariantKey: "DEFAULT",
    agreementVariantKey: "AGREEMENT"
  })
});
