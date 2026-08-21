const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const config = window.APP_CONFIG || {};

const ROLE_LABELS = {
  guest: '비회원',
  student: '학생',
  guardian: '학부모',
  teacher: '지도자',
  operator: '운영자',
  admin: '관리자'
};

const MANAGE_ROLES = new Set(['operator', 'admin']);
const SUBSCRIBE_ROLES = new Set(['student', 'guardian', 'teacher']);
const LESSON_STEPS = ['역사 이야기', '오늘의 바둑', '바둑판 미션', '역사 미션', '생각 나눔', '보상'];
const LESSON_STORAGE_KEY = 'bhj_lesson_catalog_v3';
const SUBSCRIPTION_STORAGE_KEY = 'bhj_account_subscriptions_v1';
const PROGRESS_STORAGE_KEY = 'bhj_lesson_progress_v2';
const BOOKMARK_STORAGE_KEY = 'bhj_lesson_bookmarks_v2';
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const DEFAULT_SUBSCRIPTION_PLANS = Object.freeze([
  { id: 'subscription-1m', label: '1개월', months: 1, price: 10000 },
  { id: 'subscription-3m', label: '3개월', months: 3, price: 30000 },
  { id: 'subscription-6m', label: '6개월', months: 6, price: 50000, recommended: true },
  { id: 'subscription-12m', label: '12개월', months: 12, price: 100000 }
]);

const SEED_LESSONS = [
  {
    id: 'PRE-01', level: '입문', course: '입문 1권', era: '선사시대', order: 1,
    title: '주먹도끼에서 배운 첫 수', summary: '구석기 사람들의 관찰과 바둑돌의 흐름을 연결해 배우는 첫 강의입니다.',
    instructor: '김바둑 선생님', durationMinutes: 8, difficulty: '처음 시작', status: 'published', isFreeSample: true,
    videoUrl: '', videoFileName: '', thumbnailFileName: '', materials: ['선사시대-1강-활동지.pdf'], popularity: 96,
    createdAt: '2026-08-01T09:00:00+09:00', updatedAt: '2026-08-01T09:00:00+09:00'
  },
  {
    id: 'PRE-02', level: '입문', course: '입문 1권', era: '선사시대', order: 2,
    title: '돌을 연결하면 길이 생겨요', summary: '신석기 마을의 협력 이야기를 통해 바둑돌 연결의 기초를 익힙니다.',
    instructor: '김바둑 선생님', durationMinutes: 10, difficulty: '입문', status: 'published', isFreeSample: false,
    videoUrl: '', videoFileName: '', thumbnailFileName: '', materials: ['선사시대-2강-활동지.pdf'], popularity: 89,
    createdAt: '2026-08-05T09:00:00+09:00', updatedAt: '2026-08-10T09:00:00+09:00'
  },
  {
    id: 'GOJ-01', level: '기초', course: '기초 1권', era: '고조선', order: 1,
    title: '좋은 자리를 먼저 차지해요', summary: '고조선 건국 이야기와 바둑의 요소를 함께 이해합니다.',
    instructor: '이역사 선생님', durationMinutes: 12, difficulty: '기초', status: 'published', isFreeSample: false,
    videoUrl: '', videoFileName: '', thumbnailFileName: '', materials: ['고조선-1강-해설.pdf'], popularity: 82,
    createdAt: '2026-08-10T09:00:00+09:00', updatedAt: '2026-08-15T09:00:00+09:00'
  },
  {
    id: 'GOJ-02', level: '기초', course: '기초 1권', era: '고조선', order: 2,
    title: '우리 영역을 지켜라', summary: '나라의 영역과 바둑의 집을 비교하며 안전한 모양을 만들어 봅니다.',
    instructor: '이역사 선생님', durationMinutes: 14, difficulty: '기초', status: 'published', isFreeSample: false,
    videoUrl: '', videoFileName: '', thumbnailFileName: '', materials: ['고조선-2강-활동지.pdf', '고조선-2강-정답.pdf'], popularity: 74,
    createdAt: '2026-08-15T09:00:00+09:00', updatedAt: '2026-08-15T09:00:00+09:00'
  },
  {
    id: 'SAM-01', level: '기본', course: '기본 1권', era: '삼국시대', order: 1,
    title: '연결할수록 강해져요', summary: '삼국의 성장과 교류를 돌의 연결과 끊기 문제로 학습합니다.',
    instructor: '박한수 선생님', durationMinutes: 16, difficulty: '기본', status: 'published', isFreeSample: false,
    videoUrl: '', videoFileName: '', thumbnailFileName: '', materials: [], popularity: 68,
    createdAt: '2026-08-01T09:00:00+09:00', updatedAt: '2026-08-01T09:00:00+09:00'
  },
  {
    id: 'GOR-01', level: '기본', course: '기본 2권', era: '고려', order: 1,
    title: '균형을 읽는 힘', summary: '고려의 문화 교류와 바둑판 전체의 균형을 연결한 신규 강의입니다.',
    instructor: '박한수 선생님', durationMinutes: 18, difficulty: '기본', status: 'draft', isFreeSample: false,
    videoUrl: '', videoFileName: '', thumbnailFileName: '', materials: [], popularity: 0,
    createdAt: '2026-08-18T09:00:00+09:00', updatedAt: '2026-08-18T09:00:00+09:00'
  }
];

let currentUser = { id: 'guest-local', role: 'guest', name: '비회원' };
let lessons = [];
let subscriptionPlans = [...DEFAULT_SUBSCRIPTION_PLANS];
let subscriptions = [];
let activeView = 'all';
let activeLessonId = null;
let activeStepIndex = 0;
let lastFocused = null;
let paymentState = { plan: null, order: null, widgets: null };
const sessionVideoUrls = new Map();

function apiUrl(path) {
  const base = String(config.apiBaseUrl || '/api/v1').replace(/\/$/, '');
  return new URL(`${base}${path}`, window.location.origin).toString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function canManage() {
  return MANAGE_ROLES.has(currentUser.role);
}

function canSubscribe() {
  return SUBSCRIBE_ROLES.has(currentUser.role);
}

function isFreeSampleLesson(lesson) {
  return lesson?.isFreeSample === true || lesson?.isFreeSample === 'true' || lesson?.isFreeSample === 1;
}

async function resolveCurrentUser() {
  if (config.lectureApiEnabled) {
    try {
      const response = await fetch(apiUrl('/me'), { credentials: 'include' });
      if (response.ok) {
        const payload = await response.json();
        const user = payload.data || payload;
        return { id: user.id, role: user.role, name: user.name || ROLE_LABELS[user.role] || '회원' };
      }
    } catch {}
  }
  const role = localStorage.getItem('bhj_demo_role') || 'guest';
  return { id: `demo-${role}`, role, name: ROLE_LABELS[role] || '회원' };
}

async function loadLessons() {
  if (!config.lectureApiEnabled) {
    const stored = parseStorage(LESSON_STORAGE_KEY, null);
    lessons = (Array.isArray(stored) ? stored : clone(SEED_LESSONS)).map(item => ({
      ...item,
      isFreeSample: isFreeSampleLesson(item)
    }));
    return;
  }
  const endpoint = canManage() ? '/admin/lessons?include=draft,archived' : '/lessons';
  const response = await fetch(apiUrl(endpoint), { credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || '강의 목록을 불러오지 못했습니다.');
  const items = payload.data?.items || payload.data || payload.items || [];
  lessons = items.map(item => ({ ...item, isFreeSample: isFreeSampleLesson(item) }));
}

async function loadSubscriptionPlans() {
  if (!config.lectureApiEnabled) {
    subscriptionPlans = clone(DEFAULT_SUBSCRIPTION_PLANS);
    return;
  }
  const response = await fetch(apiUrl('/subscription-plans'), { credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || '구독 플랜을 불러오지 못했습니다.');
  const items = payload.data?.items || payload.data || payload.items || [];
  subscriptionPlans = items.filter(item => item.active !== false).map(item => ({
    id: item.id,
    label: item.label || `${item.months}개월`,
    months: Number(item.months),
    price: Number(item.price),
    recommended: Boolean(item.recommended)
  }));
}

async function loadSubscriptions() {
  if (!config.lectureApiEnabled) {
    subscriptions = parseStorage(SUBSCRIPTION_STORAGE_KEY, []);
    return;
  }
  if (!canSubscribe()) {
    subscriptions = [];
    return;
  }
  const response = await fetch(apiUrl('/me/subscriptions'), { credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || '구독 내역을 불러오지 못했습니다.');
  subscriptions = payload.data?.items || payload.data || payload.items || [];
}

function saveLocalLessons() {
  localStorage.setItem(LESSON_STORAGE_KEY, JSON.stringify(lessons));
}

function saveLocalSubscriptions() {
  localStorage.setItem(SUBSCRIPTION_STORAGE_KEY, JSON.stringify(subscriptions));
}

function formatKrw(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

function formatDateTime(value, includeSeconds = false) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', ...(includeSeconds ? { second: '2-digit' } : {}), hourCycle: 'h23'
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function calculateSubscriptionEnd(paidAt, months) {
  const paidDate = new Date(paidAt);
  const durationMonths = Number(months);
  if (Number.isNaN(paidDate.getTime()) || !Number.isInteger(durationMonths) || durationMonths < 1) {
    throw new Error('구독 종료일을 계산할 수 없습니다.');
  }
  const kstDate = new Date(paidDate.getTime() + KST_OFFSET_MS);
  const monthIndex = kstDate.getUTCMonth() + durationMonths;
  const targetYear = kstDate.getUTCFullYear() + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const finalInclusiveDay = Math.min(kstDate.getUTCDate(), lastDay);
  const nextDayMidnightKstAsUtc = Date.UTC(targetYear, targetMonth, finalInclusiveDay + 1, 0, 0, 0) - KST_OFFSET_MS;
  return new Date(nextDayMidnightKstAsUtc).toISOString();
}

function userSubscriptions() {
  return subscriptions.filter(item => (!item.userId || item.userId === currentUser.id) && item.paymentStatus === 'paid');
}

function activeSubscription(now = Date.now()) {
  return userSubscriptions()
    .filter(item => new Date(item.startsAt || item.paidAt).getTime() <= now && new Date(item.endsAt).getTime() > now)
    .sort((a, b) => new Date(b.endsAt) - new Date(a.endsAt))[0] || null;
}

function bookmarkIds() {
  const store = parseStorage(BOOKMARK_STORAGE_KEY, {});
  return new Set(store[currentUser.id] || []);
}

function saveBookmarkIds(ids) {
  const store = parseStorage(BOOKMARK_STORAGE_KEY, {});
  store[currentUser.id] = [...ids];
  localStorage.setItem(BOOKMARK_STORAGE_KEY, JSON.stringify(store));
}

function progressFor(lessonId) {
  const store = parseStorage(PROGRESS_STORAGE_KEY, {});
  return store[currentUser.id]?.[lessonId] || { completedSteps: 0, status: 'available', lastPositionSeconds: 0 };
}

function saveProgress(lessonId, nextProgress) {
  const store = parseStorage(PROGRESS_STORAGE_KEY, {});
  store[currentUser.id] ||= {};
  store[currentUser.id][lessonId] = { ...nextProgress, updatedAt: new Date().toISOString() };
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(store));
}

function renderRoleAndPermission() {
  $('#currentRoleBadge').textContent = ROLE_LABELS[currentUser.role] || currentUser.role;
  $('#lectureManagerCard').hidden = !canManage();
  if (config.demoRoleSwitcher) {
    $('#lectureRolePreview').hidden = false;
    $('#lectureRoleSelect').value = currentUser.role;
  }
  const banner = $('#lecturePermissionBanner');
  const subscription = activeSubscription();
  if (canManage()) {
    banner.className = 'permission-banner allowed';
    banner.innerHTML = '<strong>CMS 관리</strong><span>관리자·운영자는 영상별로 구독 전용 또는 무료 샘플을 지정하고 모든 강의를 미리보기 할 수 있습니다.</span>';
  } else if (subscription) {
    banner.className = 'permission-banner allowed';
    banner.innerHTML = `<strong>구독 이용 중</strong><span>${formatDateTime(subscription.endsAt, true)}까지 모든 공개 강의를 시청할 수 있습니다.</span>`;
  } else if (canSubscribe()) {
    banner.className = 'permission-banner';
    banner.innerHTML = '<strong>구독 필요</strong><span>무료 샘플은 바로 볼 수 있으며, 구독하면 구독 기간 동안 모든 공개 강의를 시청할 수 있습니다.</span>';
  } else {
    banner.className = 'permission-banner';
    banner.innerHTML = '<strong>무료 샘플</strong><span>샘플 영상은 로그인 없이 볼 수 있습니다. 전체 강의는 로그인 후 구독해 주세요.</span>';
  }
}

function visibleLessons() {
  let items = canManage() ? [...lessons] : lessons.filter(item => item.status === 'published');
  const query = $('#lectureSearch').value.trim().toLowerCase();
  const level = $('#lectureLevelFilter').value;
  if (query) {
    items = items.filter(item => `${item.title} ${item.summary} ${item.era} ${item.instructor} ${item.course}`.toLowerCase().includes(query));
  }
  if (level) items = items.filter(item => item.level === level);
  if (activeView === 'bookmarked') {
    const ids = bookmarkIds();
    items = items.filter(item => ids.has(item.id));
  }
  if (activeView === 'recent') {
    items = items.filter(item => progressFor(item.id).updatedAt).sort((a, b) => String(progressFor(b.id).updatedAt).localeCompare(String(progressFor(a.id).updatedAt)));
  } else if (activeView === 'popular') {
    items.sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0));
  } else {
    items.sort((a, b) => `${a.level}-${a.course}-${String(a.order).padStart(4, '0')}`.localeCompare(`${b.level}-${b.course}-${String(b.order).padStart(4, '0')}`, 'ko'));
  }
  return items;
}

function lessonState(lesson) {
  if (lesson.status === 'draft') return { code: 'draft', label: '임시저장' };
  if (lesson.status === 'archived') return { code: 'archived', label: '보관' };
  if (isFreeSampleLesson(lesson)) return { code: 'sample', label: '무료 샘플' };
  return { code: 'published', label: '구독 전용' };
}

function canAccessLesson(lesson) {
  if (!lesson) return false;
  if (canManage()) return true;
  return lesson.status === 'published' && (isFreeSampleLesson(lesson) || Boolean(activeSubscription()));
}

function lectureAction(lesson) {
  if (canManage()) return { action: 'learn', label: '관리자 미리보기' };
  if (lesson.status === 'published' && isFreeSampleLesson(lesson) && !activeSubscription()) {
    return { action: 'learn', label: '무료로 보기' };
  }
  if (canAccessLesson(lesson)) return { action: 'learn', label: progressFor(lesson.id).completedSteps ? '이어서 수강' : '수강하기' };
  return { action: 'plans', label: currentUser.role === 'guest' ? '로그인 후 구독' : '구독 후 시청' };
}

function renderLectureCard(lesson) {
  const state = lessonState(lesson);
  const action = lectureAction(lesson);
  const subscription = activeSubscription();
  const progress = progressFor(lesson.id);
  const progressRate = Math.round((Number(progress.completedSteps || 0) / LESSON_STEPS.length) * 100);
  const isBookmarked = bookmarkIds().has(lesson.id);
  const managerActions = canManage() ? `
    <div class="lecture-admin-actions">
      <button type="button" data-action="edit" data-lesson-id="${escapeHtml(lesson.id)}">수정</button>
      <button type="button" data-action="toggle-status" data-lesson-id="${escapeHtml(lesson.id)}">${lesson.status === 'published' ? '비공개' : '공개'}</button>
      <button type="button" data-action="archive" data-lesson-id="${escapeHtml(lesson.id)}">보관</button>
    </div>` : '';
  return `
    <article class="lecture-card ${state.code}">
      <div class="lecture-card-visual level-${escapeHtml(lesson.level)}">
        <span>${escapeHtml(lesson.era)}</span><b>● ○ ●</b><strong>${escapeHtml(lesson.course)}</strong>
        <button class="lecture-bookmark ${isBookmarked ? 'active' : ''}" type="button" data-action="bookmark" data-lesson-id="${escapeHtml(lesson.id)}" aria-label="${isBookmarked ? '찜 해제' : '찜하기'}">${isBookmarked ? '♥' : '♡'}</button>
      </div>
      <div class="lecture-card-body">
        <div class="lecture-card-badges"><span>${escapeHtml(lesson.level)}</span><em class="sale-${state.code}">${state.label}</em></div>
        <h3>${escapeHtml(lesson.title)}</h3>
        <p>${escapeHtml(lesson.summary)}</p>
        <dl class="lecture-card-meta">
          <div><dt>강사</dt><dd>${escapeHtml(lesson.instructor)}</dd></div>
          <div><dt>영상</dt><dd>${Number(lesson.durationMinutes)}분</dd></div>
          <div><dt>난이도</dt><dd>${escapeHtml(lesson.difficulty || lesson.level)}</dd></div>
          <div><dt>학습자료</dt><dd>${Number(lesson.materials?.length || 0)}개</dd></div>
        </dl>
        ${subscription && !canManage() ? `<div class="lecture-access-date">계정 구독 종료 <strong>${formatDateTime(subscription.endsAt, true)}</strong></div>` : ''}
        ${progress.completedSteps && canAccessLesson(lesson) ? `<div class="lecture-card-progress"><span style="width:${progressRate}%"></span></div>` : ''}
        <div class="lecture-card-price"><strong>${isFreeSampleLesson(lesson) ? '무료 샘플 영상' : '구독 회원 전체 공개'}</strong><small>${isFreeSampleLesson(lesson) ? '로그인·구독 없이 시청' : '강의별 추가 결제 없음'}</small></div>
        <button class="button ${action.action === 'learn' ? 'button-dark' : 'button-primary'} lecture-main-action" type="button" data-action="${action.action}" data-lesson-id="${escapeHtml(lesson.id)}">${action.label}</button>
        ${managerActions}
      </div>
    </article>`;
}

function renderLectureGrid() {
  const items = visibleLessons();
  $('#lectureGrid').innerHTML = items.length
    ? items.map(renderLectureCard).join('')
    : '<div class="lecture-empty"><span>▤</span><strong>조건에 맞는 강의가 없습니다.</strong><p>검색어나 과정 필터를 변경해 보세요.</p></div>';
}

function renderSummary() {
  const publicLessons = lessons.filter(item => item.status === 'published');
  const freeSampleCount = publicLessons.filter(isFreeSampleLesson).length;
  const duration = publicLessons.reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0);
  const subscription = activeSubscription();
  $('#publishedLessonCount').textContent = `${publicLessons.length}강`;
  $('#totalDuration').textContent = duration >= 60 ? `${Math.floor(duration / 60)}시간 ${duration % 60}분` : `${duration}분`;
  $('#subscriptionSummary').textContent = canManage()
    ? '전체 미리보기'
    : (subscription ? `${formatDateTime(subscription.endsAt)}까지` : (freeSampleCount ? `무료 샘플 ${freeSampleCount}강` : '구독 필요'));
}

function renderSubscriptionPlans() {
  const container = $('#subscriptionPlanGrid');
  const subscription = activeSubscription();
  $('#subscriptionStatusCard').className = `subscription-status-card ${subscription || canManage() ? 'active' : ''}`;
  if (canManage()) {
    $('#subscriptionStatusCard').innerHTML = '<strong>관리 계정</strong><span>관리자와 운영자는 결제 없이 모든 강의를 미리보기 할 수 있습니다.</span>';
  } else if (subscription) {
    $('#subscriptionStatusCard').innerHTML = `<strong>현재 ${escapeHtml(subscription.planLabelSnapshot || '구독')} 이용 중</strong><span>${formatDateTime(subscription.startsAt || subscription.paidAt, true)} 시작 · ${formatDateTime(subscription.endsAt, true)} 종료</span>`;
  } else if (currentUser.role === 'guest') {
    $('#subscriptionStatusCard').innerHTML = '<strong>로그인이 필요합니다.</strong><span>학생·학부모·지도자 계정으로 로그인한 뒤 구독할 수 있습니다.</span>';
  } else {
    $('#subscriptionStatusCard').innerHTML = '<strong>현재 이용 중인 구독이 없습니다.</strong><span>원하는 기간을 선택하면 결제 승인 즉시 모든 공개 강의를 볼 수 있습니다.</span>';
  }

  container.innerHTML = subscriptionPlans.map(plan => {
    const monthly = Math.round(plan.price / plan.months);
    const disabled = Boolean(subscription) || canManage();
    const label = canManage() ? '관리 계정 이용 가능' : (subscription ? '현재 구독 이용 중' : (currentUser.role === 'guest' ? '로그인 후 구독' : '구독하기'));
    return `
      <article class="subscription-plan-card ${plan.recommended ? 'recommended' : ''}">
        ${plan.recommended ? '<span class="subscription-plan-badge">추천</span>' : ''}
        <small>ACCOUNT PASS</small>
        <h3>${escapeHtml(plan.label)}</h3>
        <strong>${formatKrw(plan.price)}</strong>
        <p>월 평균 ${formatKrw(monthly)} · 모든 공개 영상 이용</p>
        <button class="button ${plan.recommended ? 'button-primary' : 'button-dark'}" type="button" data-action="subscribe" data-plan-id="${escapeHtml(plan.id)}" ${disabled ? 'disabled' : ''}>${label}</button>
      </article>`;
  }).join('');
}

function renderSubscriptionHistory() {
  const container = $('#subscriptionList');
  if (!canSubscribe()) {
    container.innerHTML = `<div class="purchase-empty"><strong>${currentUser.role === 'guest' ? '로그인하면 구독 내역을 확인할 수 있습니다.' : '관리 계정은 강의 미리보기를 이용해 주세요.'}</strong></div>`;
    return;
  }
  const history = [...userSubscriptions()].sort((a, b) => new Date(b.paidAt || b.startsAt) - new Date(a.paidAt || a.startsAt));
  if (!history.length) {
    container.innerHTML = '<div class="purchase-empty"><strong>구독 내역이 없습니다.</strong><p>구독을 결제하면 시작일과 종료시각이 이 목록에 보관됩니다.</p></div>';
    return;
  }
  const now = Date.now();
  container.innerHTML = history.map(subscription => {
    const isActive = new Date(subscription.startsAt || subscription.paidAt).getTime() <= now && new Date(subscription.endsAt).getTime() > now;
    return `
      <article class="purchase-row ${isActive ? 'active' : 'expired'}">
        <span class="purchase-status">${isActive ? '이용 중' : '종료'}</span>
        <div>
          <strong>${escapeHtml(subscription.planLabelSnapshot || `${subscription.monthsSnapshot || '-'}개월 구독`)}</strong>
          <small>결제 ${formatDateTime(subscription.paidAt, true)} · 종료 ${formatDateTime(subscription.endsAt, true)}</small>
        </div>
        <span class="subscription-history-amount">${formatKrw(subscription.amountSnapshot)}</span>
      </article>`;
  }).join('');
}

function renderAll() {
  renderRoleAndPermission();
  renderSummary();
  renderSubscriptionPlans();
  renderLectureGrid();
  renderSubscriptionHistory();
}

function openModal(modal) {
  if (!modal) return;
  lastFocused = document.activeElement;
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

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function openLectureForm(lessonId) {
  if (!canManage()) return;
  const form = $('#lectureForm');
  form.reset();
  const lesson = lessonId ? lessons.find(item => item.id === lessonId) : null;
  $('#lectureFormTitle').textContent = lesson ? '강의 정보 수정' : '새 강의 등록';
  form.elements.id.value = lesson?.id || '';
  if (lesson) {
    ['level', 'course', 'era', 'order', 'title', 'summary', 'instructor', 'durationMinutes', 'status', 'difficulty', 'videoUrl'].forEach(name => {
      form.elements[name].value = lesson[name] ?? '';
    });
    form.elements.isFreeSample.value = String(isFreeSampleLesson(lesson));
  } else {
    form.elements.status.value = 'draft';
    form.elements.isFreeSample.value = 'false';
  }
  const existing = lesson ? [lesson.videoFileName, lesson.thumbnailFileName, ...(lesson.materials || [])].filter(Boolean) : [];
  $('#lectureExistingFiles').textContent = existing.length ? `현재 파일: ${existing.join(', ')}` : '실제 파일 원본은 운영 서버의 비공개 저장소에 업로드해야 합니다.';
  openModal($('#lectureFormModal'));
}

function collectLessonForm(form) {
  const existing = lessons.find(item => item.id === form.elements.id.value);
  const videoFile = form.elements.videoFile.files?.[0];
  const thumbnailFile = form.elements.thumbnailFile.files?.[0];
  const materialFiles = [...(form.elements.materials.files || [])];
  const id = existing?.id || `LESSON-${Date.now()}`;
  if (videoFile) sessionVideoUrls.set(id, URL.createObjectURL(videoFile));
  return {
    ...(existing || {}), id,
    level: form.elements.level.value,
    course: form.elements.course.value.trim(),
    era: form.elements.era.value,
    order: Number(form.elements.order.value),
    title: form.elements.title.value.trim(),
    summary: form.elements.summary.value.trim(),
    instructor: form.elements.instructor.value.trim(),
    durationMinutes: Number(form.elements.durationMinutes.value),
    status: form.elements.status.value,
    isFreeSample: form.elements.isFreeSample.value === 'true',
    difficulty: form.elements.difficulty.value.trim(),
    videoUrl: form.elements.videoUrl.value.trim(),
    videoFileName: videoFile?.name || existing?.videoFileName || '',
    thumbnailFileName: thumbnailFile?.name || existing?.thumbnailFileName || '',
    materials: materialFiles.length ? materialFiles.map(file => file.name) : (existing?.materials || []),
    popularity: Number(existing?.popularity || 0),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: currentUser.id
  };
}

async function submitLecture(event) {
  event.preventDefault();
  if (!canManage()) return;
  const form = event.currentTarget;
  const lesson = collectLessonForm(form);
  try {
    if (config.lectureApiEnabled) {
      const body = new FormData(form);
      const isEdit = Boolean(form.elements.id.value);
      const endpoint = isEdit ? `/admin/lessons/${encodeURIComponent(lesson.id)}` : '/admin/lessons';
      const response = await fetch(apiUrl(endpoint), {
        method: isEdit ? 'PATCH' : 'POST', credentials: 'include',
        headers: { 'X-Requested-With': 'XMLHttpRequest' }, body
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || '강의를 저장하지 못했습니다.');
      await loadLessons();
    } else {
      const index = lessons.findIndex(item => item.id === lesson.id);
      if (index >= 0) lessons[index] = lesson;
      else lessons.unshift(lesson);
      saveLocalLessons();
    }
    closeModal($('#lectureFormModal'));
    renderAll();
    showToast('강의 콘텐츠가 사용자 화면에 반영되었습니다.');
  } catch (error) {
    showToast(error.message || '강의를 저장하지 못했습니다.');
  }
}

async function updateLessonStatus(lessonId, status) {
  if (!canManage()) return;
  const lesson = lessons.find(item => item.id === lessonId);
  if (!lesson) return;
  try {
    if (config.lectureApiEnabled) {
      const response = await fetch(apiUrl(`/admin/lessons/${encodeURIComponent(lessonId)}/status`), {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ status })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || '공개 상태를 변경하지 못했습니다.');
      await loadLessons();
    } else {
      lesson.status = status;
      lesson.updatedAt = new Date().toISOString();
      saveLocalLessons();
    }
    renderAll();
    showToast(status === 'archived' ? '강의를 보관했습니다.' : '공개 상태를 변경했습니다.');
  } catch (error) {
    showToast(error.message || '공개 상태를 변경하지 못했습니다.');
  }
}

function safeVideoUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:', 'blob:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

async function getPlaybackUrl(lesson) {
  if (!config.lectureApiEnabled || canManage()) return safeVideoUrl(sessionVideoUrls.get(lesson.id) || lesson.videoUrl);
  const response = await fetch(apiUrl(`/lessons/${encodeURIComponent(lesson.id)}/playback`), { credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || '재생 권한을 확인하지 못했습니다.');
  return safeVideoUrl((payload.data || payload).playbackUrl);
}

async function openLessonPlayer(lessonId) {
  const lesson = lessons.find(item => item.id === lessonId);
  if (!lesson) return showToast('강의 정보를 찾을 수 없습니다.');
  if (!canAccessLesson(lesson)) {
    showToast(currentUser.role === 'guest' ? '로그인 후 구독해 주세요.' : '강의를 보려면 구독이 필요합니다.');
    $('#subscriptionPlans').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  activeLessonId = lessonId;
  const progress = progressFor(lessonId);
  activeStepIndex = Math.min(Number(progress.completedSteps || 0), LESSON_STEPS.length - 1);
  $('#playerCourse').textContent = `${lesson.level} · ${lesson.course} · ${lesson.era}`;
  $('#playerTitle').textContent = lesson.title;
  const subscription = activeSubscription();
  $('#playerAccessEnd').textContent = canManage()
    ? '관리자·운영자 미리보기'
    : (isFreeSampleLesson(lesson) && !subscription ? '무료 샘플 영상' : `구독 종료 ${formatDateTime(subscription.endsAt, true)}`);
  const host = $('#lectureVideoHost');
  host.innerHTML = '<div class="lecture-video-placeholder"><span>◷</span><strong>재생 권한 확인 중</strong></div>';
  openModal($('#lecturePlayerModal'));
  try {
    const mediaUrl = await getPlaybackUrl(lesson);
    if (mediaUrl) {
      host.innerHTML = `<video controls preload="metadata" aria-label="${escapeHtml(lesson.title)} 강의 영상"><source src="${escapeHtml(mediaUrl)}"></video>`;
      const video = $('video', host);
      video.addEventListener('loadedmetadata', () => {
        if (progress.lastPositionSeconds && progress.lastPositionSeconds < video.duration) video.currentTime = progress.lastPositionSeconds;
      });
      let lastSavedSecond = -1;
      video.addEventListener('timeupdate', () => {
        const second = Math.floor(video.currentTime);
        if (second !== lastSavedSecond && second % 5 === 0) {
          lastSavedSecond = second;
          saveProgress(lessonId, { ...progressFor(lessonId), status: 'in_progress', lastPositionSeconds: second });
        }
      });
    } else {
      host.innerHTML = `<div class="lecture-video-placeholder"><span>▶</span><strong>${escapeHtml(lesson.videoFileName || '영상 연결 대기')}</strong><p>운영 서버에서는 계정 구독을 확인한 뒤 만료 시간이 포함된 재생 URL을 제공합니다.</p></div>`;
    }
  } catch (error) {
    host.innerHTML = `<div class="lecture-video-placeholder"><span>!</span><strong>영상을 재생할 수 없습니다.</strong><p>${escapeHtml(error.message)}</p></div>`;
  }
  renderPlayerSteps();
}

function renderPlayerSteps() {
  const progress = progressFor(activeLessonId);
  const completed = Number(progress.completedSteps || 0);
  $('#playerProgress').value = completed;
  $('#playerProgressText').textContent = `${completed} / ${LESSON_STEPS.length}`;
  $('#lectureStepList').innerHTML = LESSON_STEPS.map((step, index) => `
    <li class="${index < completed ? 'completed' : ''} ${index === activeStepIndex ? 'active' : ''}">
      <button type="button" data-step-index="${index}" ${index > completed ? 'disabled' : ''}><b>${String(index + 1).padStart(2, '0')}</b><span>${step}</span><em>${index < completed ? '완료' : (index === activeStepIndex ? '학습 중' : '대기')}</em></button>
    </li>`).join('');
  $('#completeLectureStep').textContent = completed >= LESSON_STEPS.length ? '강의 완료' : '현재 단계 완료';
  $('#completeLectureStep').disabled = completed >= LESSON_STEPS.length;
}

async function completeCurrentStep() {
  const lesson = lessons.find(item => item.id === activeLessonId);
  if (!lesson || !canAccessLesson(lesson)) return;
  const progress = progressFor(activeLessonId);
  const nextCount = Math.min(Math.max(Number(progress.completedSteps || 0), activeStepIndex + 1), LESSON_STEPS.length);
  const next = { ...progress, completedSteps: nextCount, status: nextCount === LESSON_STEPS.length ? 'completed' : 'in_progress' };
  saveProgress(activeLessonId, next);
  if (config.lectureApiEnabled && !canManage() && currentUser.role !== 'guest') {
    fetch(apiUrl(`/lessons/${encodeURIComponent(activeLessonId)}/steps/${activeStepIndex + 1}/complete`), {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: '{}'
    }).catch(() => {});
  }
  activeStepIndex = Math.min(nextCount, LESSON_STEPS.length - 1);
  renderPlayerSteps();
  renderLectureGrid();
  showToast(nextCount === LESSON_STEPS.length ? '강의를 완료했습니다.' : '학습 단계가 저장되었습니다.');
}

function setSubscriptionPaymentStatus(message, isError = false) {
  const status = $('#subscriptionPaymentStatus');
  status.textContent = message;
  status.classList.toggle('error', isError);
}

async function prepareSubscriptionPayment(planId) {
  const plan = subscriptionPlans.find(item => item.id === planId);
  if (!plan) return;
  if (!canSubscribe()) {
    showToast(currentUser.role === 'guest' ? '로그인 후 구독할 수 있습니다.' : '관리 계정은 구독 결제가 필요하지 않습니다.');
    return;
  }
  if (activeSubscription()) {
    showToast('현재 구독 이용 중에는 새 구독을 중복 결제할 수 없습니다.');
    return;
  }
  const startsAt = new Date();
  const endsAt = calculateSubscriptionEnd(startsAt, plan.months);
  paymentState = { plan, order: null, widgets: null };
  $('#subscriptionPaymentName').textContent = plan.label;
  $('#subscriptionPaymentStart').textContent = `${formatDateTime(startsAt, true)} (결제 승인 시점)`;
  $('#subscriptionPaymentEnd').textContent = formatDateTime(endsAt, true);
  $('#subscriptionPaymentPrice').textContent = formatKrw(plan.price);
  $('#requestSubscriptionPayment').disabled = true;
  $('#completeDemoSubscriptionPayment').hidden = true;
  $('#subscription-payment-method').replaceChildren();
  $('#subscription-agreement').replaceChildren();
  setSubscriptionPaymentStatus('구독 플랜과 결제 금액을 확인하고 있습니다.');
  openModal($('#subscriptionPaymentModal'));

  const tossConfig = config.tossPayments || {};
  if (!config.lectureApiEnabled || !tossConfig.clientKey || typeof window.TossPayments !== 'function') {
    if (config.demoRoleSwitcher) {
      $('#completeDemoSubscriptionPayment').hidden = false;
      setSubscriptionPaymentStatus('개발용 화면입니다. 실제 결제 없이 계정 구독 기록을 생성할 수 있습니다.');
    } else {
      setSubscriptionPaymentStatus('토스페이먼츠 및 주문 서버 설정이 필요합니다.', true);
    }
    return;
  }

  try {
    const response = await fetch(apiUrl('/orders/checkout'), {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ items: [{ productType: 'account_subscription', planId: plan.id, quantity: 1 }] })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || '구독 주문을 생성하지 못했습니다.');
    const order = payload.data || payload;
    if (!order.orderId || Number(order.amount) !== Number(plan.price)) {
      await loadSubscriptionPlans();
      renderAll();
      throw new Error('구독 금액이 변경되었습니다. 최신 금액을 확인하고 다시 결제해 주세요.');
    }
    paymentState.order = order;
    sessionStorage.setItem('bhj_pending_subscription_checkout', JSON.stringify({ planId: plan.id, orderId: order.orderId }));
    const tossPayments = window.TossPayments(tossConfig.clientKey);
    const customerKey = order.customerKey || window.TossPayments.ANONYMOUS || 'ANONYMOUS';
    const widgets = tossPayments.widgets({ customerKey });
    await widgets.setAmount({ currency: 'KRW', value: Number(order.amount) });
    await Promise.all([
      widgets.renderPaymentMethods({ selector: '#subscription-payment-method', variantKey: tossConfig.paymentMethodVariantKey || 'DEFAULT' }),
      widgets.renderAgreement({ selector: '#subscription-agreement', variantKey: tossConfig.agreementVariantKey || 'AGREEMENT' })
    ]);
    paymentState.widgets = widgets;
    $('#requestSubscriptionPayment').disabled = false;
    setSubscriptionPaymentStatus('결제수단을 선택한 뒤 결제하기를 눌러 주세요.');
  } catch (error) {
    setSubscriptionPaymentStatus(error.message || '결제 정보를 준비하지 못했습니다.', true);
  }
}

function completeDemoSubscription() {
  const plan = paymentState.plan;
  if (!plan || !canSubscribe() || activeSubscription()) return;
  const paidAt = new Date();
  const endsAt = calculateSubscriptionEnd(paidAt, plan.months);
  subscriptions.push({
    id: `subscription-${Date.now()}`,
    userId: currentUser.id,
    planId: plan.id,
    planLabelSnapshot: plan.label,
    monthsSnapshot: Number(plan.months),
    amountSnapshot: Number(plan.price),
    paidAt: paidAt.toISOString(),
    startsAt: paidAt.toISOString(),
    endsAt,
    paymentStatus: 'paid',
    paymentProvider: 'demo'
  });
  saveLocalSubscriptions();
  closeModal($('#subscriptionPaymentModal'));
  renderAll();
  showToast(`${plan.label} 구독이 시작되었습니다. ${formatDateTime(endsAt, true)}에 종료됩니다.`);
}

async function requestTossPayment() {
  if (!paymentState.widgets || !paymentState.order || !paymentState.plan) return;
  const { order, plan } = paymentState;
  const successUrl = new URL('payment/success.html', window.location.href);
  successUrl.searchParams.set('source', 'subscription');
  successUrl.searchParams.set('planId', plan.id);
  const failUrl = new URL('payment/fail.html', window.location.href);
  failUrl.searchParams.set('source', 'subscription');
  failUrl.searchParams.set('planId', plan.id);
  const request = { orderId: order.orderId, orderName: order.orderName || `바둑타고 ${plan.label} 구독`, successUrl: successUrl.toString(), failUrl: failUrl.toString() };
  if (order.customerEmail) request.customerEmail = order.customerEmail;
  if (order.customerName) request.customerName = order.customerName;
  if (order.customerMobilePhone) request.customerMobilePhone = order.customerMobilePhone;
  try {
    $('#requestSubscriptionPayment').disabled = true;
    setSubscriptionPaymentStatus('토스페이먼츠 결제창을 여는 중입니다.');
    await paymentState.widgets.requestPayment(request);
  } catch (error) {
    $('#requestSubscriptionPayment').disabled = false;
    setSubscriptionPaymentStatus(error.message || '결제 요청이 취소되었습니다.', true);
  }
}

function handleDynamicAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const lessonId = button.dataset.lessonId;
  const action = button.dataset.action;
  if (action === 'learn') openLessonPlayer(lessonId);
  if (action === 'plans') {
    $('#subscriptionPlans').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(currentUser.role === 'guest' ? '로그인 후 구독 플랜을 선택해 주세요.' : '구독 플랜을 선택해 주세요.');
  }
  if (action === 'subscribe') prepareSubscriptionPayment(button.dataset.planId);
  if (action === 'edit') openLectureForm(lessonId);
  if (action === 'bookmark') {
    if (currentUser.role === 'guest') return showToast('로그인 후 찜한 강의를 저장할 수 있습니다.');
    const ids = bookmarkIds();
    ids.has(lessonId) ? ids.delete(lessonId) : ids.add(lessonId);
    saveBookmarkIds(ids);
    renderLectureGrid();
  }
  if (action === 'toggle-status') {
    const lesson = lessons.find(item => item.id === lessonId);
    updateLessonStatus(lessonId, lesson?.status === 'published' ? 'draft' : 'published');
  }
  if (action === 'archive' && canManage() && window.confirm('이 강의를 보관할까요? 구독 내역과 학습 진도는 유지됩니다.')) {
    updateLessonStatus(lessonId, 'archived');
  }
}

$('#lectureGrid').addEventListener('click', handleDynamicAction);
$('#subscriptionPlanGrid').addEventListener('click', handleDynamicAction);
$('#newLectureButton').addEventListener('click', () => openLectureForm());
$('#lectureForm').addEventListener('submit', submitLecture);
$('#completeLectureStep').addEventListener('click', completeCurrentStep);
$('#completeDemoSubscriptionPayment').addEventListener('click', completeDemoSubscription);
$('#requestSubscriptionPayment').addEventListener('click', requestTossPayment);
$('#lectureStepList').addEventListener('click', event => {
  const button = event.target.closest('[data-step-index]');
  if (!button || button.disabled) return;
  activeStepIndex = Number(button.dataset.stepIndex);
  renderPlayerSteps();
});

$('#lectureSearch').addEventListener('input', renderLectureGrid);
$('#lectureLevelFilter').addEventListener('change', renderLectureGrid);
$('#lectureViewNav').addEventListener('click', event => {
  const button = event.target.closest('[data-view]');
  if (!button) return;
  $$('#lectureViewNav button').forEach(item => item.classList.toggle('active', item === button));
  if (button.dataset.view === 'subscription') {
    $('#subscriptionHistory').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  activeView = button.dataset.view;
  $('#lectureListTitle').textContent = ({ all: '전체 강의', popular: '인기 강의', recent: '최근 시청 강의', bookmarked: '찜한 강의' })[activeView];
  renderLectureGrid();
});

$('#lectureRoleSelect').addEventListener('change', async event => {
  localStorage.setItem('bhj_demo_role', event.target.value);
  currentUser = await resolveCurrentUser();
  await Promise.all([loadLessons(), loadSubscriptionPlans(), loadSubscriptions()]);
  renderAll();
  showToast(`${ROLE_LABELS[currentUser.role]} 권한으로 전환했습니다.`);
});

$$('[data-close-lecture-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.closest('.modal'))));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeModal($('.modal.open'));
});

async function initialize() {
  try {
    currentUser = await resolveCurrentUser();
    await Promise.all([loadLessons(), loadSubscriptionPlans(), loadSubscriptions()]);
    renderAll();
  } catch (error) {
    showToast(error.message || '강의 정보를 준비하지 못했습니다.');
  }
  $('#year').textContent = new Date().getFullYear();
}

initialize();
