// 배포 환경에서 이 값을 주입하거나 config.js로 복사해 사용합니다.
// OAuth Client Secret과 PortOne REST API Secret은 절대 이 파일에 넣지 않습니다.
window.APP_CONFIG = Object.freeze({
  apiBaseUrl: "https://api.example.com/api/v1",
  oauthEnabled: true,
  oauthProviders: Object.freeze(["naver", "kakao", "google"]),
  boardApiEnabled: true,
  lectureApiEnabled: true,
  demoRoleSwitcher: false,
  paymentProvider: "portone-v1",
  portoneV1: Object.freeze({
    // PortOne V1 고객사 식별코드. 브라우저의 IMP.init()에 사용합니다.
    userCode: "imp_운영_고객사_식별코드",
    pgProvider: "tosspay",
    // PortOne 콘솔에 운영용 토스페이 API Key와 함께 등록한 MID입니다.
    mid: "운영_토스페이_MID",
    channelKey: "channel-key-운영_채널키"
  })
});
