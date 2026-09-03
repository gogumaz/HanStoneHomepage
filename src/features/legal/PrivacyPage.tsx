import { Link } from 'react-router-dom';

export function ChildPrivacyNotice() {
  return (
    <section className="child-privacy-notice" aria-labelledby="child-privacy-title">
      <p className="privacy-kicker">어린이용 쉬운 안내</p>
      <h2 id="child-privacy-title">내 정보는 이렇게 지켜요</h2>
      <div className="child-privacy-grid">
        <article><span aria-hidden="true">1</span><h3>왜 필요한가요?</h3><p>로그인하고, 공부한 곳을 기억하고, 보호자와 함께 학습 기록을 보기 위해 꼭 필요한 정보만 받아요.</p></article>
        <article><span aria-hidden="true">2</span><h3>보호자에게 무엇을 보내나요?</h3><p>보호자 동의를 부탁할 때는 보호자의 이메일 주소 하나만 받아요. 동의하기 전에는 학습을 시작할 수 없어요.</p></article>
        <article><span aria-hidden="true">3</span><h3>싫다고 말할 수 있나요?</h3><p>언제든 보호자 연결을 끊거나 계정을 지울 수 있어요. 어려우면 보호자와 함께 1:1 문의로 알려 주세요.</p></article>
      </div>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <main className="privacy-page">
      <article className="privacy-document">
        <Link className="back-link" to="/">← 홈으로</Link>
        <p className="privacy-kicker">PRIVACY NOTICE · 시행 전 법무 검토본</p>
        <h1>개인정보 처리 안내</h1>
        <p className="privacy-lead">바둑타고는 서비스 제공에 필요한 정보만 수집하며, 목적이 끝나면 아래 기준에 따라 삭제하거나 분리 보관합니다.</p>

        <section aria-labelledby="privacy-purpose-title">
          <h2 id="privacy-purpose-title">무엇을, 왜, 얼마나 보관하나요?</h2>
          <div className="privacy-table-wrap">
            <table>
              <thead><tr><th>목적</th><th>수집 항목</th><th>보유 기간</th></tr></thead>
              <tbody>
                <tr><td>계정 생성·로그인·보안</td><td>이메일, 이름, 암호화된 비밀번호, 역할, 연령대</td><td>회원 탈퇴 시까지. 세션은 만료 또는 로그아웃 시 사용할 수 없게 처리</td></tr>
                <tr><td>강의·미션·학습 리포트</td><td>학습 진도, 문제 풀이, 보상 기록</td><td>회원 탈퇴 시까지</td></tr>
                <tr><td>법정대리인 동의 요청</td><td>보호자 이메일 주소</td><td>초대 수락·만료·철회 시 연락처 즉시 삭제</td></tr>
                <tr><td>상담·1:1 문의 처리</td><td>연락처, 이메일, 문의 내용과 첨부파일</td><td>처리 종료 후 3년</td></tr>
                <tr><td>결제·환불·거래 증빙</td><td>주문·결제·환불 내역</td><td>관계 법령에 따른 5년</td></tr>
                <tr><td>보안·권한·운영 감사</td><td>요청 ID, 작업자, 작업 종류·시각·대상</td><td>3년. 비밀번호와 원문 토큰은 기록하지 않음</td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="privacy-rights-title">
          <h2 id="privacy-rights-title">열람·정정·삭제·동의 철회</h2>
          <p>계정 화면에서 회원 탈퇴를 요청할 수 있고, 보호자 화면에서 연결과 동의를 철회할 수 있습니다. 그 밖의 열람·정정·삭제·처리정지 요청은 <Link to="/board.html?type=inquiry">1:1 문의</Link>로 접수합니다. 본인 확인 후 처리 결과와 이의 제기 방법을 안내합니다.</p>
        </section>

        <section aria-labelledby="privacy-child-title">
          <h2 id="privacy-child-title">만 14세 미만 아동</h2>
          <p>법정대리인의 동의와 동의 확인이 끝날 때까지 계정은 제한 상태로 유지됩니다. 동의 요청에는 보호자의 이메일 주소 하나만 사용하며, 보호자는 아동의 개인정보 열람·정정·삭제·처리정지와 동의 철회를 요청할 수 있습니다.</p>
        </section>

        <ChildPrivacyNotice />

        <aside className="privacy-review-note" aria-label="법무 검토 상태">
          <strong>운영 전 확인</strong>
          <p>이 문서는 서비스 구현 기준 초안입니다. 개인정보 보호책임자 연락처, 수탁자·국외이전 여부, 정확한 법정 보유기간과 법정대리인 확인 수단은 법무 승인 후 확정하며, 승인 전 운영 배포를 허용하지 않습니다.</p>
        </aside>
      </article>
    </main>
  );
}
