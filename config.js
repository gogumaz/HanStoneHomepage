window.APP_CONFIG = Object.freeze({
  apiBaseUrl: "/api/v1",
  oauthEnabled: false,
  oauthProviders: Object.freeze([]),
  boardApiEnabled: false,
  lectureApiEnabled: false,
  demoRoleSwitcher: true,
  paymentProvider: "toss-payments",
  tossPayments: Object.freeze({
    mode: "test",
    clientKey: "",
    paymentMethodVariantKey: "DEFAULT",
    agreementVariantKey: "AGREEMENT"
  })
});
