import { resolveTossBrowserConfig, tossPaymentReadyMessage } from './src/payments/toss-browser.ts';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const appConfig = window.APP_CONFIG || {};

function apiUrl(path) {
  const base = String(appConfig.apiBaseUrl || '/api/v1').replace(/\/$/, '');
  return new URL(`${base}${path}`, window.location.origin).toString();
}

const menuToggle = $('.menu-toggle');
const mainNav = $('#mainNav');
menuToggle?.addEventListener('click', () => {
  const open = mainNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
});
$$('.main-nav a').forEach(link => link.addEventListener('click', () => {
  mainNav.classList.remove('open');
  menuToggle?.setAttribute('aria-expanded', 'false');
}));

$$('[data-scroll]').forEach(button => button.addEventListener('click', () => {
  $(button.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' });
}));

const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: .12 });
$$('.reveal').forEach(element => revealObserver.observe(element));

const eraData = {
  prehistoric: { kicker: '선사시대 · 구석기', title: '주변을 살피면<br>살아갈 길이 보여요', description: '구석기 사람들은 자연을 세심히 살펴 도구와 먹을 것을 찾았어요. 바둑돌도 놓기 전에 주변의 ‘활로’를 먼저 확인해야 합니다.', tags: ['역사 이야기 2분', '바둑 미션 3개', '유물 카드 1장'], cta: '선사시대 여행 시작' },
  gojoseon: { kicker: '고조선 · 건국 이야기', title: '내 영역을 만들고<br>함께 지켜 나가요', description: '고조선이 하나의 나라로 성장한 이야기를 만나고, 바둑판에서 좋은 자리를 먼저 차지하는 포석의 원리를 배워요.', tags: ['건국 이야기 3분', '포석 미션 3개', '청동검 카드'], cta: '고조선 여행 시작' },
  three: { kicker: '삼국시대 · 성장과 교류', title: '연결할수록<br>더 큰 힘이 생겨요', description: '고구려·백제·신라가 성장하고 교류한 과정을 살펴보며 돌을 연결하고 상대의 연결을 끊는 방법을 익혀요.', tags: ['삼국 이야기 3분', '연결 미션 3개', '금관 카드'], cta: '삼국시대 여행 시작' },
  goryeo: { kicker: '고려 · 곧 만나요', title: '균형을 잡는<br>새 여행을 준비 중이에요', description: '고려의 문화와 기초 사활을 연결한 다음 여행 코스를 만들고 있습니다.', tags: ['두 번째 시즌', '사활 미션', '청자 카드'], cta: '오픈 알림 받기' },
  joseon: { kicker: '조선 · 곧 만나요', title: '판 전체를 읽는<br>넓은 시야를 만나요', description: '조선의 인물과 사건을 따라가며 공배와 집 계산을 익히는 코스입니다.', tags: ['두 번째 시즌', '집 계산', '훈민정음 카드'], cta: '오픈 알림 받기' },
  modern: { kicker: '근현대 · 곧 만나요', title: '한 수의 선택이<br>미래를 바꾸어요', description: '근현대사의 중요한 선택과 종합 바둑 문제를 연결한 마지막 여정입니다.', tags: ['세 번째 시즌', '종합 미션', '태극기 카드'], cta: '오픈 알림 받기' }
};

$$('.era-tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.era-tab').forEach(item => { item.classList.remove('active'); item.setAttribute('aria-selected', 'false'); });
  tab.classList.add('active');
  tab.setAttribute('aria-selected', 'true');
  const data = eraData[tab.dataset.era];
  $('#eraKicker').textContent = data.kicker;
  $('#eraTitle').innerHTML = data.title;
  $('#eraDescription').textContent = data.description;
  $('#eraTags').innerHTML = data.tags.map(tag => `<span>${tag}</span>`).join('');
  $('.era-copy .button').innerHTML = `${data.cta} <span>→</span>`;
  $('#eraPanel').animate([{ opacity: .55, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], { duration: 280 });
}));

$$('.board-point').forEach(point => point.addEventListener('click', () => {
  $$('.board-point').forEach(item => item.classList.remove('correct', 'wrong'));
  if (point.dataset.point === 'B') {
    point.classList.add('correct');
    $('#boardFeedback').textContent = '정답! B에 두면 흰 돌의 활로가 하나 더 생겨요. ★ +1';
  } else {
    point.classList.add('wrong');
    $('#boardFeedback').textContent = '아쉬워요. 흰 돌의 오른쪽 빈칸을 다시 살펴보세요.';
  }
}));

let lastFocused = null;
function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  lastFocused = document.activeElement;
  $$('.modal.open').forEach(item => closeModal(item));
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  setTimeout(() => $('.modal-close', modal)?.focus(), 10);
}
function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  if (!$('.modal.open')) document.body.classList.remove('modal-open');
  lastFocused?.focus?.();
}
$$('.login-open').forEach(button => button.addEventListener('click', () => openModal('#loginModal')));
$$('.trial-open').forEach(button => button.addEventListener('click', () => openModal('#trialModal')));
$$('.mission-open').forEach(button => button.addEventListener('click', () => openModal('#missionModal')));
$$('.consult-open').forEach(button => button.addEventListener('click', () => openModal('#consultModal')));
$$('.social-login').forEach(button => button.addEventListener('click', () => {
  if (!appConfig.oauthEnabled) {
    showToast('간편 로그인을 사용하려면 OAuth 서버 설정을 완료해 주세요.');
    return;
  }
  const provider = button.dataset.provider;
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`${apiUrl(`/auth/oauth/${provider}/start`)}?returnTo=${encodeURIComponent(returnTo)}`);
}));
$$('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.closest('.modal'))));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeModal($('.modal.open'));
  if (event.key === 'Tab' && $('.modal.open')) {
    const modal = $('.modal.open');
    const focusable = $$('button:not([disabled]), input, textarea, a[href]', modal);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

const roleCards = $$('.role-card');
roleCards.forEach(card => card.addEventListener('click', () => {
  roleCards.forEach(item => item.classList.remove('selected'));
  card.classList.add('selected');
  $('#trialContinue').disabled = false;
  $('#trialContinue').dataset.role = card.dataset.role;
  $('#trialContinue').dataset.roleId = card.dataset.roleId;
}));
$('#trialContinue')?.addEventListener('click', () => {
  const role = $('#trialContinue').dataset.role;
  localStorage.setItem('bhj_demo_role', $('#trialContinue').dataset.roleId || 'student');
  closeModal($('#trialModal'));
  showToast(`${role} 여행 지도를 준비했어요. 첫 미션으로 출발합니다!`);
  setTimeout(() => openModal('#missionModal'), 550);
});

$$('.quiz-options button').forEach(button => button.addEventListener('click', () => {
  $$('.quiz-options button').forEach(item => item.classList.remove('correct', 'wrong'));
  if (button.dataset.answer === 'correct') {
    button.classList.add('correct');
    $('#quizFeedback').textContent = '정답이에요! 활로는 바둑돌이 숨 쉬는 길이에요. ★ +1';
  } else {
    button.classList.add('wrong');
    $('#quizFeedback').textContent = '한 번 더 생각해 볼까요? 돌 주변의 빈칸을 떠올려 보세요.';
  }
}));

const paymentState = { product: null, order: null, widgets: null, clientConfig: null };

function formatKrw(value) {
  return `${Number(value).toLocaleString('ko-KR')}원`;
}

function setPaymentStatus(message, isError = false) {
  const status = $('#paymentStatus');
  status.textContent = message;
  status.classList.toggle('error', isError);
}

async function prepareTossPayment(button) {
  const product = {
    id: button.dataset.productId,
    name: button.dataset.productName,
    price: Number(button.dataset.productPrice),
    requiresShipping: button.dataset.requiresShipping === 'true'
  };
  paymentState.product = product;
  paymentState.order = null;
  paymentState.widgets = null;
  paymentState.clientConfig = null;

  $('#paymentProductName').textContent = product.name;
  $('#paymentProductPrice').textContent = formatKrw(product.price);
  $('#tossPaymentAmount').textContent = formatKrw(product.price);
  $('#paymentButtonLabel').textContent = product.requiresShipping ? '배송정보 확인' : '결제 준비';
  $('#payment-method').replaceChildren();
  $('#agreement').replaceChildren();
  const shippingPanel = $('#paymentShipping');
  shippingPanel.hidden = !product.requiresShipping;
  $$('#paymentShipping input').forEach(input => {
    input.required = product.requiresShipping && input.id !== 'shippingAddressLine2';
    input.value = '';
  });
  openModal('#paymentModal');

  let tossConfig;
  try {
    tossConfig = resolveTossBrowserConfig(appConfig.tossPayments);
  } catch {
    $('#tossPaymentButton').disabled = true;
    setPaymentStatus('토스페이먼츠 테스트·라이브 클라이언트 키와 결제 모드가 일치하지 않습니다.', true);
    return;
  }
  if (!tossConfig || typeof window.TossPayments !== 'function') {
    $('#tossPaymentButton').disabled = true;
    setPaymentStatus('토스페이먼츠 클라이언트 키와 SDK 설정이 필요합니다.', true);
    return;
  }
  paymentState.clientConfig = tossConfig;
  $('#tossPaymentButton').disabled = false;
  setPaymentStatus(product.requiresShipping
    ? '배송 정보를 입력한 뒤 확인 버튼을 눌러 주세요.'
    : '결제 준비 버튼을 눌러 주세요.');
}

function readShippingInformation() {
  const fields = $$('#paymentShipping input');
  const invalid = fields.find(input => input.required && !input.reportValidity());
  if (invalid) {
    invalid.focus();
    return null;
  }
  return {
    recipientName: $('#shippingRecipientName').value.trim(),
    recipientPhone: $('#shippingRecipientPhone').value.trim(),
    postalCode: $('#shippingPostalCode').value.trim(),
    addressLine1: $('#shippingAddressLine1').value.trim(),
    addressLine2: $('#shippingAddressLine2').value.trim()
  };
}

async function createStoreCheckoutAndRender() {
  const product = paymentState.product;
  if (!product) return false;
  const tossConfig = paymentState.clientConfig;
  if (!tossConfig) return false;
  const shipping = product.requiresShipping ? readShippingInformation() : null;
  if (product.requiresShipping && !shipping) return false;
  const button = $('#tossPaymentButton');
  button.disabled = true;
  setPaymentStatus('서버에서 주문 금액과 배송 정보를 확인하고 있습니다.');
  try {
    const request = { items: [{ productId: product.id, quantity: 1 }] };
    if (shipping) request.shipping = shipping;
    const response = await fetch(apiUrl('/store/orders/checkout'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(request)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || '주문을 생성하지 못했습니다.');

    const order = payload.data || payload;
    if (!order.orderId || Number(order.amount) !== product.price) {
      throw new Error('서버 주문 금액이 화면의 상품 금액과 일치하지 않습니다.');
    }
    paymentState.order = order;

    const tossPayments = window.TossPayments(tossConfig.clientKey);
    const anonymousKey = window.TossPayments.ANONYMOUS || 'ANONYMOUS';
    const widgets = tossPayments.widgets({ customerKey: order.customerKey || anonymousKey });
    await widgets.setAmount({ currency: 'KRW', value: Number(order.amount) });
    await Promise.all([
      widgets.renderPaymentMethods({ selector: '#payment-method', variantKey: tossConfig.paymentMethodVariantKey }),
      widgets.renderAgreement({ selector: '#agreement', variantKey: tossConfig.agreementVariantKey })
    ]);
    paymentState.widgets = widgets;
    button.disabled = false;
    $('#paymentButtonLabel').textContent = '결제하기';
    setPaymentStatus(tossPaymentReadyMessage(tossConfig.mode));
    return true;
  } catch (error) {
    button.disabled = false;
    setPaymentStatus(error.message || '결제 정보를 불러오지 못했습니다.', true);
    return false;
  }
}

$$('.payment-open').forEach(button => button.addEventListener('click', () => prepareTossPayment(button)));

$('#tossPaymentButton')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  if (!paymentState.widgets || !paymentState.order) {
    await createStoreCheckoutAndRender();
    return;
  }
  button.disabled = true;
  setPaymentStatus('토스페이먼츠 결제창을 여는 중입니다.');
  const order = paymentState.order;
  const paymentRequest = {
    orderId: order.orderId,
    orderName: order.orderName || paymentState.product.name,
    successUrl: (() => {
      const url = new URL('payment/success.html', window.location.href);
      url.searchParams.set('source', 'store');
      return url.toString();
    })(),
    failUrl: (() => {
      const url = new URL('payment/fail.html', window.location.href);
      url.searchParams.set('source', 'store');
      return url.toString();
    })()
  };
  if (order.customerEmail) paymentRequest.customerEmail = order.customerEmail;
  if (order.customerName) paymentRequest.customerName = order.customerName;
  if (order.customerMobilePhone) paymentRequest.customerMobilePhone = order.customerMobilePhone;

  try {
    await paymentState.widgets.requestPayment(paymentRequest);
  } catch (error) {
    button.disabled = false;
    setPaymentStatus(error.message || '결제 요청이 취소되었습니다.', true);
  }
});

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}
$$('[data-toast]').forEach(element => element.addEventListener('click', event => {
  event.preventDefault();
  showToast(element.dataset.toast);
}));

$('#loginForm')?.addEventListener('submit', event => { event.preventDefault(); closeModal($('#loginModal')); showToast('데모 로그인 화면입니다. 계정 연동은 백엔드 구축 시 활성화됩니다.'); });
$('#consultForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  if (!appConfig.boardApiEnabled) {
    closeModal($('#consultModal'));
    form.reset();
    showToast('상담 신청 데모가 완료되었습니다. API를 활성화하면 서버에 접수됩니다.');
    return;
  }

  const values = new FormData(form);
  const request = {
    category: String(values.get('category') || ''),
    organizationName: String(values.get('organizationName') || ''),
    contactName: String(values.get('contactName') || ''),
    phone: String(values.get('phone') || ''),
    email: String(values.get('email') || ''),
    expectedStudents: Number(values.get('expectedStudents')),
    title: String(values.get('title') || ''),
    content: String(values.get('content') || ''),
    privacyConsent: values.get('privacyConsent') === 'on'
  };
  button.disabled = true;
  try {
    const response = await fetch(apiUrl('/consultations'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify(request)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || '상담 신청을 접수하지 못했습니다.');
    closeModal($('#consultModal'));
    form.reset();
    showToast('상담 신청이 접수되었습니다. 빠르게 연락드릴게요.');
  } catch (error) {
    showToast(error.message || '상담 신청 중 오류가 발생했습니다.');
  } finally {
    button.disabled = false;
  }
});

$('#year').textContent = new Date().getFullYear();
