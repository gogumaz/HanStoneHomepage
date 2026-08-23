window.APP_CONFIG = Object.freeze({
  apiBaseUrl: "/api/v1",
  oauthEnabled: false,
  oauthProviders: Object.freeze([]),
  boardApiEnabled: false,
  lectureApiEnabled: false,
  demoRoleSwitcher: true,
  paymentProvider: "portone-v1",
  portoneV1: Object.freeze({
    // 브라우저에서 IMP.init()에 사용하는 공개 식별자입니다.
    userCode: "imp06121806",
    pgProvider: "tosspay",
    mid: "tosstest",
    // 콘솔 채널을 식별하기 위한 공개값입니다. V1 결제 요청에는 pgProvider와 MID를 사용합니다.
    channelKey: "channel-key-851ec2b1-9bed-4487-b74b-a37c2503c0ce"
  })
});
