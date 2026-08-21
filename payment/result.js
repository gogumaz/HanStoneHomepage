const config = window.APP_CONFIG || {};
const params = new URLSearchParams(window.location.search);
const resultType = document.body.dataset.paymentResult;
const title = document.querySelector('#resultTitle');
const message = document.querySelector('#resultMessage');
const icon = document.querySelector('#resultIcon');
const details = document.querySelector('#resultDetails');
const action = document.querySelector('#resultAction');
const source = params.get('source');

if (source === 'subscription') {
  action.href = resultType === 'success' ? '../lecture.html#subscriptionHistory' : '../lecture.html#subscriptionPlans';
  action.textContent = resultType === 'success' ? '구독 내역 확인하기' : '구독 플랜으로 돌아가기';
}

function apiUrl(path) {
  const base = String(config.apiBaseUrl || '/api/v1').replace(/\/$/, '');
  return new URL(`${base}${path}`, window.location.origin).toString();
}

function addDetail(label, value) {
  const row = document.createElement('div');
  const key = document.createElement('span');
  const content = document.createElement('strong');
  key.textContent = label;
  content.textContent = value || '-';
  row.append(key, content);
  details.append(row);
}

async function confirmPayment() {
  const paymentKey = params.get('paymentKey');
  const orderId = params.get('orderId');
  const amount = Number(params.get('amount'));
  addDetail('주문번호', orderId);
  addDetail('결제 금액', Number.isFinite(amount) ? `${amount.toLocaleString('ko-KR')}원` : '-');

  if (!paymentKey || !orderId || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('결제 승인 정보가 올바르지 않습니다.');
  }

  const response = await fetch(apiUrl('/payments/toss/confirm'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ paymentKey, orderId, amount })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || '결제 승인에 실패했습니다.');

  const payment = payload.data || payload;
  title.textContent = '결제가 완료되었습니다';
  message.textContent = '주문 내역에서 결제 결과를 확인할 수 있어요.';
  icon.textContent = '✓';
  if (payment.method) addDetail('결제수단', payment.method);
  if (source === 'subscription' && payment.subscription?.endsAt) {
    message.textContent = '계정 구독이 시작되었습니다. 구독 기간에는 모든 공개 강의를 시청할 수 있어요.';
    addDetail('구독 종료', new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'medium', hourCycle: 'h23'
    }).format(new Date(payment.subscription.endsAt)));
  }
}

function showFailure() {
  addDetail('오류 코드', params.get('code'));
  addDetail('주문번호', params.get('orderId'));
  const providerMessage = params.get('message');
  if (providerMessage) message.textContent = providerMessage;
}

if (resultType === 'success') {
  confirmPayment().catch(error => {
    title.textContent = '결제 승인을 확인해 주세요';
    message.textContent = error.message;
    icon.textContent = '!';
    icon.classList.add('fail');
  });
} else {
  showFailure();
}
