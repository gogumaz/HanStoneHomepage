const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const config = window.APP_CONFIG || {};

const ROLE_LABELS = {
  guest: '비회원',
  student: '학생',
  guardian: '학부모',
  teacher: '지도자',
  instructor: '지도자',
  operator: '운영자',
  admin: '관리자'
};

const BOARD_CONFIG = {
  notice: {
    label: '공지사항',
    description: '서비스의 새로운 소식과 중요한 안내를 확인하세요.',
    writeLabel: '공지 등록',
    writeRoles: ['operator', 'admin'],
    roleGuide: '공지사항은 운영자만 작성할 수 있습니다.',
    listEndpoint: '/notices',
    writeEndpoint: '/admin/notices',
    categories: ['서비스', '점검', '콘텐츠', '이벤트'],
    fields: [
      { name: 'category', label: '분류', type: 'select', required: true, options: ['서비스', '점검', '콘텐츠', '이벤트'] },
      { name: 'title', label: '제목', type: 'text', required: true, full: true },
      { name: 'content', label: '내용', type: 'textarea', required: true, full: true },
      { name: 'publishedAt', label: '공개일', type: 'date', required: true },
      { name: 'isPinned', label: '상단 고정', type: 'checkbox' },
      { name: 'attachment', label: '첨부파일', type: 'file', full: true }
    ]
  },
  classTip: {
    label: '수업 팁',
    description: '바둑과 한국사를 연결하는 수업 활용법과 활동 자료를 나눕니다.',
    writeLabel: '수업 팁 작성',
    writeRoles: ['teacher', 'instructor', 'operator', 'admin'],
    roleGuide: '승인된 지도자와 운영자가 작성할 수 있습니다.',
    listEndpoint: '/posts?type=classTip',
    writeEndpoint: '/posts',
    categories: ['수업설계', '바둑활동', '역사활동', '학급운영'],
    fields: [
      { name: 'category', label: '분류', type: 'select', required: true, options: ['수업설계', '바둑활동', '역사활동', '학급운영'] },
      { name: 'title', label: '제목', type: 'text', required: true, full: true },
      { name: 'targetGrade', label: '대상 학년', type: 'select', required: true, options: ['초등 1~2학년', '초등 3~4학년', '초등 5~6학년', '전 학년'] },
      { name: 'era', label: '연결 시대', type: 'select', required: true, options: ['선사시대', '고조선', '삼국시대', '고려', '조선', '근현대'] },
      { name: 'badukLevel', label: '바둑 수준', type: 'select', required: true, options: ['입문', '초급', '중급'] },
      { name: 'content', label: '수업 내용', type: 'textarea', required: true, full: true },
      { name: 'attachment', label: '수업자료 첨부', type: 'file', accept: '.pdf,.pptx,.docx,.hwpx', full: true }
    ]
  },
  travel: {
    label: '여행기',
    description: '교실과 가정에서 경험한 역사 여행 이야기를 소개합니다.',
    writeLabel: '여행기 작성',
    writeRoles: ['teacher', 'instructor', 'operator', 'admin'],
    roleGuide: '지도자와 운영자가 작성할 수 있으며 사진 공개 동의가 필요합니다.',
    listEndpoint: '/posts?type=travel',
    writeEndpoint: '/posts',
    categories: ['교실여행', '가정학습', '체험후기'],
    fields: [
      { name: 'category', label: '분류', type: 'select', required: true, options: ['교실여행', '가정학습', '체험후기'] },
      { name: 'title', label: '제목', type: 'text', required: true, full: true },
      { name: 'className', label: '반·기관명', type: 'text', required: true },
      { name: 'era', label: '여행 시대', type: 'select', required: true, options: ['선사시대', '고조선', '삼국시대', '고려', '조선', '근현대'] },
      { name: 'content', label: '여행 이야기', type: 'textarea', required: true, full: true },
      { name: 'attachment', label: '사진 첨부', type: 'file', accept: '.jpg,.jpeg,.png,.webp', full: true },
      { name: 'consent', label: '사진과 학습 사례의 공개 동의를 확인했습니다.', type: 'checkbox', required: true, full: true }
    ]
  },
  faq: {
    label: '자주 묻는 질문',
    description: '서비스 이용, 학습, 교재와 결제에 관한 답변을 확인하세요.',
    writeLabel: 'FAQ 등록',
    writeRoles: ['operator', 'admin'],
    roleGuide: 'FAQ는 운영자만 작성하고 노출 순서를 설정할 수 있습니다.',
    listEndpoint: '/faqs',
    writeEndpoint: '/admin/faqs',
    categories: ['회원', '학습', '교재', '결제', '기관'],
    fields: [
      { name: 'category', label: '분류', type: 'select', required: true, options: ['회원', '학습', '교재', '결제', '기관'] },
      { name: 'title', label: '질문', type: 'text', required: true, full: true },
      { name: 'content', label: '답변', type: 'textarea', required: true, full: true },
      { name: 'displayOrder', label: '노출 순서', type: 'number', required: true, min: 1 },
      { name: 'isPublished', label: '바로 공개', type: 'checkbox' }
    ]
  },
  inquiry: {
    label: '1:1 문의',
    description: '내 문의 내용과 답변 상태를 안전하게 확인할 수 있습니다.',
    writeLabel: '문의하기',
    writeRoles: ['student', 'guardian', 'teacher', 'instructor', 'organization_admin', 'operator', 'admin'],
    roleGuide: '로그인한 회원만 작성할 수 있으며 본인의 문의만 확인할 수 있습니다.',
    isPrivate: true,
    listEndpoint: '/me/inquiries',
    writeEndpoint: '/inquiries',
    categories: ['회원', '학습', '교재', '결제', '기타'],
    fields: [
      { name: 'category', label: '문의 유형', type: 'select', required: true, options: ['회원', '학습', '교재', '결제', '기타'] },
      { name: 'title', label: '제목', type: 'text', required: true, full: true },
      { name: 'content', label: '문의 내용', type: 'textarea', required: true, full: true },
      { name: 'attachment', label: '첨부파일', type: 'file', accept: '.jpg,.jpeg,.png,.webp,.pdf', full: true }
    ]
  },
  consultation: {
    label: '기관상담',
    description: '바둑학원과 방과후 교실에 맞는 도입 구성을 상담합니다.',
    writeLabel: '상담 신청',
    writeRoles: ['guest', 'student', 'guardian', 'teacher', 'instructor', 'organization_admin', 'operator', 'admin'],
    readRoles: ['student', 'guardian', 'teacher', 'instructor', 'organization_admin', 'operator', 'admin'],
    roleGuide: '비회원도 신청할 수 있으며 접수 내용은 공개되지 않습니다.',
    isPrivate: true,
    listEndpoint: '/me/consultations',
    writeEndpoint: '/consultations',
    categories: ['바둑학원', '방과후학교', '학교', '기관·단체'],
    fields: [
      { name: 'category', label: '기관 유형', type: 'select', required: true, options: ['바둑학원', '방과후학교', '학교', '기관·단체'] },
      { name: 'organizationName', label: '기관명', type: 'text', required: true },
      { name: 'contactName', label: '담당자명', type: 'text', required: true },
      { name: 'phone', label: '연락처', type: 'tel', required: true },
      { name: 'email', label: '이메일', type: 'email' },
      { name: 'expectedStudents', label: '예상 인원', type: 'number', required: true, min: 1 },
      { name: 'title', label: '문의 제목', type: 'text', required: true, full: true },
      { name: 'content', label: '문의 내용', type: 'textarea', required: true, full: true },
      { name: 'privacyConsent', label: '개인정보 수집 및 이용에 동의합니다.', type: 'checkbox', required: true, full: true }
    ]
  },
  classHelper: {
    label: '지도자 수업도우미',
    description: '한 게시물에서 영상부터 수업 진행 가이드까지 열어 25~30분 수업을 바로 실행하세요.',
    writeLabel: '수업 패키지 등록',
    writeRoles: ['operator', 'admin'],
    readRoles: ['teacher', 'instructor', 'operator', 'admin'],
    readGuide: '지도자 계정으로 로그인하면 수업 패키지와 첨부자료를 열 수 있습니다.',
    roleGuide: '관리자와 운영자가 수업 패키지를 한 게시물로 등록하며, 지도자는 자료를 찾지 않고 수업 순서대로 바로 활용할 수 있습니다.',
    listEndpoint: '/class-helpers',
    writeEndpoint: '/admin/class-helpers',
    categories: ['선사시대', '고조선', '삼국시대', '고려', '조선', '근현대'],
    fields: [
      { name: 'category', label: '연결 시대', type: 'select', required: true, options: ['선사시대', '고조선', '삼국시대', '고려', '조선', '근현대'] },
      { name: 'title', label: '수업 패키지명', type: 'text', required: true, full: true },
      { name: 'lessonId', label: '연결 강의 ID', type: 'text', required: true },
      { name: 'badukMissionId', label: '연결 바둑미션 ID', type: 'text', required: true },
      { name: 'targetGrade', label: '대상 학년', type: 'select', required: true, options: ['초등 1~2학년', '초등 3~4학년', '초등 5~6학년', '전 학년'] },
      { name: 'lessonDuration', label: '전체 수업 시간', type: 'text', required: true },
      { name: 'content', label: '수업 목표와 활용 안내', type: 'textarea', required: true, full: true },
      { name: 'introductionContent', label: '① 도입 · 역사 장면 2분', type: 'textarea', required: true, full: true },
      { name: 'conceptContent', label: '② 설명 · 오늘의 바둑 개념 5분', type: 'textarea', required: true, full: true },
      { name: 'problemContent', label: '③ 문제풀이 · 미션 10분', type: 'textarea', required: true, full: true },
      { name: 'quizContent', label: '④ 퀴즈 · 역사 미션 5분', type: 'textarea', required: true, full: true },
      { name: 'wrapUpContent', label: '⑤ 마무리 · 생각 한 수! 3분', type: 'textarea', required: true, full: true },
      { name: 'lessonVideo', label: '수업용 5분 영상', type: 'linked', help: '연결 강의에서 안전 검사를 통과한 영상을 자동으로 사용합니다.', full: true },
      { name: 'projectorPpt', label: '빔프로젝터용 PPT', type: 'file', required: true, accept: '.ppt,.pptx', full: true },
      { name: 'activityPdf', label: '인쇄 활동지 PDF', type: 'file', required: true, accept: '.pdf', full: true },
      { name: 'historyQuizFile', label: '역사 퀴즈', type: 'file', required: true, accept: '.ppt,.pptx,.pdf,.html', full: true },
      { name: 'problemMissionFile', label: '문제풀이 미션', type: 'file', required: true, accept: '.pdf,.ppt,.pptx,.doc,.docx,.hwp,.hwpx', full: true },
      { name: 'answerFile', label: '정답·해설', type: 'file', required: true, accept: '.pdf,.doc,.docx,.hwp,.hwpx', full: true },
      { name: 'teacherGuideFile', label: '수업 진행·가이드', type: 'file', required: true, accept: '.pdf,.ppt,.pptx,.doc,.docx,.hwp,.hwpx', full: true }
    ]
  },
  resource: {
    label: '교재자료',
    description: '교재와 강의에 연결된 활동지, 지도서, 정답 자료를 확인하세요.',
    writeLabel: '자료 등록',
    writeRoles: ['operator', 'admin'],
    roleGuide: '교재자료는 운영자만 등록하고 다운로드 권한을 지정할 수 있습니다.',
    listEndpoint: '/materials',
    writeEndpoint: '/admin/materials',
    categories: ['활동지', '교사용 지도서', '정답·해설', '수업 PPT'],
    fields: [
      { name: 'category', label: '자료 유형', type: 'select', required: true, options: ['활동지', '교사용 지도서', '정답·해설', '수업 PPT'] },
      { name: 'title', label: '자료명', type: 'text', required: true, full: true },
      { name: 'lessonId', label: '연결 강의', type: 'text', required: true },
      { name: 'version', label: '버전', type: 'text', required: true },
      { name: 'accessLevel', label: '다운로드 권한', type: 'select', required: true, options: ['전체 공개', '개인 유료', '지도자', '기관 회원'] },
      { name: 'content', label: '자료 설명', type: 'textarea', required: true, full: true },
      { name: 'attachment', label: '자료 파일', type: 'file', required: true, full: true }
    ]
  }
};

const SEED_RECORDS = {
  notice: [
    { id: 'notice-1', category: '서비스', title: '선사시대 첫 여행 무료 체험 오픈', content: '회원가입 없이 역사 이야기와 바둑 미션을 체험할 수 있습니다.', authorLabel: '운영자', publishedAt: '2026-08-18', isPinned: true, status: 'published' },
    { id: 'notice-2', category: '콘텐츠', title: '강의 콘텐츠 등록 기능 안내', content: '선사시대 2강 이후 강의는 관리자·운영자가 강의 CMS에서 순차적으로 등록하고 공개합니다.', authorLabel: '운영자', publishedAt: '2026-08-11', status: 'published' }
  ],
  classTip: [
    { id: 'tip-1', category: '바둑활동', title: '활로 개념을 역사 수업과 연결하는 방법', content: '구석기인의 환경 관찰과 바둑돌의 활로 탐색을 연결하는 25분 수업 활동입니다.', authorId: 'demo-teacher', authorLabel: '김바둑 지도자', publishedAt: '2026-08-12', targetGrade: '초등 3~4학년', era: '선사시대', badukLevel: '입문', status: 'published' },
    { id: 'tip-2', category: '수업설계', title: '고조선 포석 미션 수업 진행 순서', content: '건국 이야기와 영역 개념을 자연스럽게 연결하는 도입 질문을 소개합니다.', authorId: 'demo-teacher', authorLabel: '이역사 지도자', publishedAt: '2026-08-04', targetGrade: '초등 3~4학년', era: '고조선', badukLevel: '초급', status: 'published' }
  ],
  travel: [
    { id: 'travel-1', category: '교실여행', title: '유물 카드 모으니까 역사가 기다려져요', content: '방과후 교실 친구들이 2주 동안 선사시대와 고조선 미션에 참여한 이야기입니다.', authorId: 'demo-teacher', authorLabel: '별빛 바둑교실', publishedAt: '2026-08-06', className: '별빛 바둑교실', era: '고조선', consent: true, status: 'published' }
  ],
  faq: [
    { id: 'faq-1', category: '학습', title: '몇 학년부터 이용할 수 있나요?', content: '초등 1~6학년을 대상으로 하며 저학년은 보호자 또는 지도자와 함께 시작하는 것을 권장합니다.', authorLabel: '운영자', publishedAt: '2026-08-01', displayOrder: 1, status: 'published' },
    { id: 'faq-2', category: '교재', title: '교재 QR은 어떻게 사용하나요?', content: '교재의 QR을 촬영하면 연결된 강의로 이동합니다. 유료 교재는 최초 1회 계정 등록이 필요합니다.', authorLabel: '운영자', publishedAt: '2026-08-01', displayOrder: 2, status: 'published' },
    { id: 'faq-3', category: '결제', title: '결제는 어떤 방식으로 진행되나요?', content: '토스페이먼츠 결제위젯에서 카드와 지원되는 간편결제 수단을 선택할 수 있습니다.', authorLabel: '운영자', publishedAt: '2026-08-01', displayOrder: 3, status: 'published' }
  ],
  inquiry: [],
  consultation: [],
  classHelper: [
    {
      id: 'class-helper-pre-01',
      category: '선사시대',
      title: '오늘의 교실 · 선사시대 1강 수업 패키지',
      lessonId: 'PRE-01',
      badukMissionId: 'MISSION-PRE-01-01',
      targetGrade: '초등 3~4학년',
      lessonDuration: '25~30분',
      content: '한 강의를 클릭하면 필요한 자료와 수업 순서가 한 번에 열립니다. 자료를 찾는 페이지가 아니라 화면의 순서대로 수업을 바로 실행하는 지도자용 패키지입니다.',
      introductionContent: '역사 장면을 보여 주며 오늘 배울 시대와 핵심 질문을 소개합니다.',
      conceptContent: '오늘의 바둑 개념을 5분 영상과 빔프로젝터용 PPT로 설명합니다.',
      problemContent: '인쇄 활동지와 문제풀이 미션을 사용해 핵심 개념을 적용합니다.',
      quizContent: '역사 퀴즈로 시대 내용과 바둑 개념의 연결을 확인합니다.',
      wrapUpContent: '정답·해설을 확인하고 생각 한 수 질문으로 수업을 마무리합니다.',
      lessonVideo: '선사시대-1강-수업용-5분.mp4',
      projectorPpt: '선사시대-1강-빔프로젝터용.pptx',
      activityPdf: '선사시대-1강-인쇄활동지.pdf',
      historyQuizFile: '선사시대-1강-역사퀴즈.pptx',
      problemMissionFile: '선사시대-1강-문제풀이미션.pdf',
      answerFile: '선사시대-1강-정답해설.pdf',
      teacherGuideFile: '선사시대-1강-수업진행가이드.pdf',
      authorLabel: '운영자',
      publishedAt: '2026-08-19',
      status: 'published'
    }
  ],
  resource: [
    { id: 'resource-1', category: '활동지', title: '선사시대 1강 관찰 활동지', content: '주변 환경을 관찰하고 바둑돌의 활로를 표시하는 인쇄용 활동지입니다.', authorLabel: '운영자', publishedAt: '2026-08-15', lessonId: 'PRE-01', version: '1.0', accessLevel: '전체 공개', attachment: 'prehistoric-lesson-01.pdf', status: 'published' },
    { id: 'resource-2', category: '수업 PPT', title: '선사시대 1강 수업용 PPT', content: '구석기인의 환경 관찰과 바둑돌의 활로를 연결한 지도자용 수업 자료입니다.', authorLabel: '운영자', publishedAt: '2026-08-10', lessonId: 'PRE-01', version: '1.1', accessLevel: '지도자', attachment: 'prehistoric-lesson-01.pptx', status: 'published' }
  ]
};

const boardType = BOARD_CONFIG[new URLSearchParams(location.search).get('type')] ? new URLSearchParams(location.search).get('type') : 'notice';
const board = BOARD_CONFIG[boardType];
const storageKey = 'bhj_board_records_v1';
let currentUser = { id: 'guest-local', role: 'guest', roles: ['guest'], name: '비회원' };
let records = [];
let lastFocused = null;
let editingRecordId = null;

function apiUrl(path) {
  const base = String(config.apiBaseUrl || '/api/v1').replace(/\/$/, '');
  return new URL(`${base}${path}`, location.origin).toString();
}

function loadLocalStore() {
  try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; }
}

function saveLocalRecord(type, record) {
  const store = loadLocalStore();
  store[type] = [record, ...(store[type] || [])];
  localStorage.setItem(storageKey, JSON.stringify(store));
}

function localRecords(type) {
  const store = loadLocalStore();
  return [...(store[type] || []), ...(SEED_RECORDS[type] || [])];
}

async function resolveCurrentUser() {
  if (config.boardApiEnabled) {
    try {
      const response = await fetch(apiUrl('/me'), { credentials: 'include' });
      if (response.ok) {
        const payload = await response.json();
        const user = payload.data?.user || payload.data || payload;
        const roles = Array.isArray(user.roles) && user.roles.length ? user.roles : [user.role || 'guest'];
        const role = ['admin', 'operator', 'instructor', 'guardian', 'student', 'organization_admin']
          .find(candidate => roles.includes(candidate)) || roles[0] || 'guest';
        return { id: user.id, role, roles, name: user.displayName || user.name || ROLE_LABELS[role] };
      }
    } catch {}
  }
  const role = localStorage.getItem('bhj_demo_role') || 'guest';
  return { id: `demo-${role}`, role, roles: [role], name: ROLE_LABELS[role] || '비회원' };
}

async function loadRecords() {
  if (!canRead()) return [];
  if (!config.boardApiEnabled) return localRecords(boardType);
  try {
    const listEndpoint = ['classTip', 'travel'].includes(boardType) && isModerator()
      ? `/admin/posts?type=${encodeURIComponent(boardType)}`
      : boardType === 'classHelper' && isModerator()
        ? '/admin/class-helpers'
      : boardType === 'resource' && isModerator()
        ? '/admin/materials'
        : board.listEndpoint;
    const response = await fetch(apiUrl(listEndpoint), { credentials: 'include' });
    if (!response.ok) throw new Error('게시글을 불러오지 못했습니다.');
    const payload = await response.json();
    const items = payload.data?.items || payload.data || payload.items || [];
    return items.map(record => ({
      ...record,
      authorId: record.authorId || record.requesterUserId,
      authorLabel: record.authorLabel || (board.isPrivate ? currentUser.name : undefined)
    }));
  } catch (error) {
    showToast(error.message);
    return [];
  }
}

function canWrite() {
  return board.writeRoles.some(role => currentUser.roles.includes(role));
}

function canRead() {
  return !board.readRoles || board.readRoles.some(role => currentUser.roles.includes(role));
}

function isModerator() {
  return currentUser.roles.some(role => role === 'operator' || role === 'admin');
}

function renderTabs() {
  $('#boardTabs').innerHTML = Object.entries(BOARD_CONFIG).map(([key, item]) =>
    `<a href="board.html?type=${key}" class="${key === boardType ? 'active' : ''}" ${key === boardType ? 'aria-current="page"' : ''}>${item.label}</a>`
  ).join('');
}

function renderPageMeta() {
  document.title = `${board.label} | 바둑타고 한국사 여행`;
  $('#boardTitle').textContent = board.label;
  $('#boardDescription').textContent = board.description;
  $('#writeButton').textContent = board.writeLabel;
  $('#writeModalTitle').textContent = board.writeLabel;
  $('#writeModalDescription').textContent = board.roleGuide;
  $('#currentRoleBadge').textContent = ROLE_LABELS[currentUser.role] || currentUser.role;
  const permissionLabel = canWrite() ? '작성 가능' : (canRead() ? '읽기 전용' : '접근 제한');
  const permissionMessage = canRead() ? board.roleGuide : (board.readGuide || board.roleGuide);
  $('#permissionBanner').innerHTML = `<strong>${permissionLabel}</strong><span>${permissionMessage}</span>`;
  $('#permissionBanner').classList.toggle('allowed', canWrite() || canRead());

  $('#boardCategory').innerHTML = '<option value="">전체 분류</option>' + board.categories.map(category => `<option value="${category}">${category}</option>`).join('');

  if (config.demoRoleSwitcher) {
    $('#rolePreview').hidden = false;
    $('#demoRoleSelect').value = currentUser.role;
  }
}

function visibleRecords() {
  if (!canRead()) return [];
  if (!board.isPrivate || isModerator()) return records;
  return records.filter(record => record.authorId === currentUser.id);
}

function filteredRecords() {
  const query = $('#boardSearch').value.trim().toLowerCase();
  const category = $('#boardCategory').value;
  return visibleRecords().filter(record => {
    const haystack = Object.values(record)
      .filter(value => ['string', 'number'].includes(typeof value))
      .join(' ')
      .toLowerCase();
    return (!query || haystack.includes(query)) && (!category || record.category === category);
  });
}

function displayStatus(record) {
  if (record.status === 'pending_review') return '검토 대기';
  if (record.status === 'rejected') return '반려';
  if (record.status === 'hidden') return '숨김';
  if (record.status === 'archived') return '보관';
  if (record.status === 'in_review') return '검토 중';
  if (record.status === 'answered') return '답변 완료';
  if (record.status === 'closed') return '종료';
  if (boardType === 'inquiry' || boardType === 'consultation') return '접수 완료';
  return record.isPinned ? '중요' : '공개';
}

function renderList() {
  const items = filteredRecords().sort((a, b) => String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt)));
  $('#boardCount').textContent = items.length;
  if (!items.length) {
    const emptyGuide = !canRead() ? (board.readGuide || board.roleGuide) : (canWrite() ? `${board.writeLabel} 버튼으로 첫 글을 작성해 보세요.` : board.roleGuide);
    $('#boardList').innerHTML = `<div class="board-empty"><span>✦</span><strong>${canRead() ? '등록된 글이 없습니다.' : '지도자 전용 게시판입니다.'}</strong><p>${emptyGuide}</p></div>`;
    return;
  }
  $('#boardList').innerHTML = items.map(record => `
    <button class="board-row" type="button" data-record-id="${escapeHtml(record.id)}">
      <span class="board-row-status ${record.isPinned ? 'pinned' : ''}">${displayStatus(record)}</span>
      <span class="board-row-main"><small>${escapeHtml(record.category || '일반')}</small><strong>${escapeHtml(record.title || '제목 없음')}</strong><em>${escapeHtml((record.content || '').slice(0, 80))}</em></span>
      <span class="board-row-info"><b>${escapeHtml(record.authorLabel || '작성자')}</b><time>${escapeHtml(formatDate(record.publishedAt || record.createdAt))}</time></span>
      <span class="board-row-arrow" aria-hidden="true">→</span>
    </button>
  `).join('');
  $$('.board-row').forEach(row => row.addEventListener('click', () => openDetail(row.dataset.recordId)));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function createField(field, record = null) {
  const wrapper = document.createElement('label');
  wrapper.className = `dynamic-field ${field.full ? 'full' : ''} ${field.type === 'checkbox' ? 'checkbox-field' : ''}`;
  const label = document.createElement('span');
  label.textContent = `${field.label}${field.required ? ' *' : ''}`;
  if (field.type === 'linked') {
    const guide = document.createElement('p');
    guide.className = 'dynamic-field-guide';
    guide.textContent = field.help || '';
    wrapper.append(label, guide);
    return wrapper;
  }
  let input;
  if (field.type === 'textarea') {
    input = document.createElement('textarea');
    input.rows = 7;
  } else if (field.type === 'select') {
    input = document.createElement('select');
    input.innerHTML = '<option value="">선택하세요</option>' + field.options.map(option => `<option value="${option}">${option}</option>`).join('');
  } else {
    input = document.createElement('input');
    input.type = field.type;
  }
  input.name = field.name;
  input.required = Boolean(field.required && !(record && field.type === 'file'));
  if (field.min != null) input.min = field.min;
  if (field.accept) input.accept = field.accept;
  if (record && field.type === 'checkbox') input.checked = Boolean(record[field.name]);
  else if (record && field.type !== 'file') input.value = record[field.name] ?? '';
  else if (field.type === 'date') input.value = new Date().toISOString().slice(0, 10);
  if (field.type === 'checkbox') {
    wrapper.append(input, label);
  } else {
    wrapper.append(label, input);
    if (record && field.type === 'file' && record[field.name]) {
      const current = document.createElement('small');
      const value = record[field.name];
      current.className = 'dynamic-field-guide';
      current.textContent = `현재 파일: ${typeof value === 'object' ? (value.originalName || value.name || '첨부파일') : value} · 교체할 때만 새 파일을 선택하세요.`;
      wrapper.append(current);
    }
  }
  return wrapper;
}

function renderWriteForm(record = null) {
  editingRecordId = record?.id || null;
  const form = $('#dynamicForm');
  form.replaceChildren(...board.fields.map(field => createField(field, record)));
  $('#writeModalTitle').textContent = record ? `${board.label} 수정` : board.writeLabel;
  $('#writeModalDescription').textContent = record
    ? `현재 ${record.revision || 1}번 버전입니다. 저장하면 변경 전 내용이 수정 이력에 보관됩니다.`
    : board.roleGuide;
}

function beginEdit(record) {
  closeModal($('#detailModal'));
  renderWriteForm(record);
  openModal($('#writeModal'));
}

function openModal(modal) {
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

function openDetail(id) {
  const record = records.find(item => item.id === id);
  if (!record) return;
  $('#detailCategory').textContent = record.category || board.label;
  $('#detailDate').textContent = formatDate(record.publishedAt || record.createdAt);
  $('#detailTitle').textContent = record.title || '제목 없음';
  $('#detailAuthor').textContent = `${record.authorLabel || '작성자'} · ${displayStatus(record)}${record.revision ? ` · 버전 ${record.revision}` : ''}`;
  const baseContent = record.content || '내용이 없습니다.';
  $('#detailBody').textContent = boardType === 'inquiry' && record.answer
    ? `${baseContent}\n\n[운영자 답변]\n${record.answer}`
    : ['classTip', 'travel'].includes(boardType) && record.status === 'rejected' && record.rejectionReason
      ? `${baseContent}\n\n[반려 사유]\n${record.rejectionReason}`
      : baseContent;
  renderClassHelperDetail(record);
  renderDetailAttachments(record);
  $('#detailRevisionHistory').hidden = true;
  $('#detailRevisionHistory').replaceChildren();
  renderModerationActions(record);
  openModal($('#detailModal'));
}

function renderClassHelperDetail(record) {
  const container = $('#detailPackage');
  if (boardType !== 'classHelper') {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  const steps = [
    ['01', '도입', '역사 장면', '2분', record.introductionContent],
    ['02', '설명', '오늘의 바둑 개념', '5분', record.conceptContent],
    ['03', '문제풀이', '미션', '10분', record.problemContent],
    ['04', '퀴즈', '역사 미션', '5분', record.quizContent],
    ['05', '마무리', '생각 한 수!', '3분', record.wrapUpContent]
  ];
  container.hidden = false;
  container.innerHTML = `
    <div class="class-helper-summary">
      <span>${escapeHtml(record.targetGrade || '대상 학년 전체')}</span>
      <strong>총 ${escapeHtml(record.lessonDuration || '25~30분')} 수업 모듈</strong>
      <small>연결 강의 ${escapeHtml(record.lessonId || '-')} · 바둑미션 ${escapeHtml(record.badukMissionId || '-')}</small>
    </div>
    <div class="class-helper-launchers">
      <a class="button button-outline" href="${escapeHtml(record.lessonVideo?.appUrl || `/lessons/${encodeURIComponent(record.lessonId || '')}`)}">연결 강의 열기</a>
      <a class="button button-primary" href="${escapeHtml(record.missionUrl || `/missions?lessonId=${encodeURIComponent(record.lessonId || '')}&missionId=${encodeURIComponent(record.badukMissionId || '')}&mode=classroom`)}">바둑미션 게임 실행</a>
    </div>
    <ol class="class-helper-flow">
      ${steps.map(([number, type, title, minutes, description]) => `
        <li>
          <b>${number}</b>
          <div><small>${escapeHtml(type)} · ${escapeHtml(minutes)}</small><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description || '수업 내용을 입력해 주세요.')}</p></div>
        </li>`).join('')}
    </ol>`;
}

function renderDetailAttachments(record) {
  const container = $('#detailAttachments');
  const attachments = board.fields
    .filter(field => ['file', 'linked'].includes(field.type) && record[field.name])
    .map(field => {
      const value = record[field.name];
      const fileName = typeof value === 'object' ? (value.originalName || value.name || '첨부파일') : value;
      return {
        label: field.label,
        fileName,
        kind: typeof value === 'object' ? value.kind : null,
        downloadUrl: boardType === 'inquiry' && typeof value === 'object'
          ? apiUrl(`/me/inquiries/${encodeURIComponent(record.id)}/attachment`)
          : ['classTip', 'travel'].includes(boardType) && typeof value === 'object' && value.downloadUrl
            ? apiUrl(String(value.downloadUrl).replace(/^\/api\/v1/, ''))
            : boardType === 'resource' && typeof value === 'object' && value.downloadUrl
              ? apiUrl(String(value.downloadUrl).replace(/^\/api\/v1/, ''))
              : boardType === 'classHelper' && typeof value === 'object' && value.appUrl
                ? new URL(String(value.appUrl), location.origin).toString()
                : boardType === 'classHelper' && typeof value === 'object' && value.downloadUrl
                  ? apiUrl(String(value.downloadUrl).replace(/^\/api\/v1/, ''))
                  : null,
      };
    });
  container.hidden = !attachments.length;
  if (!attachments.length) {
    container.replaceChildren();
    return;
  }
  container.innerHTML = `
    <div class="attachment-heading"><strong>${boardType === 'inquiry' ? '문의 첨부파일' : `첨부 수업자료 ${attachments.length}개`}</strong><span>${boardType === 'inquiry' ? '안전 검사를 통과한 비공개 파일입니다.' : '게시물 하나에서 순서대로 활용하세요.'}</span></div>
    <div class="attachment-package-list">
      ${attachments.map((item, index) => `
        <div class="${item.kind === 'photo' ? 'attachment-photo' : ''}"><b>${String(index + 1).padStart(2, '0')}</b><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.fileName)}</small>${item.kind === 'photo' && item.downloadUrl ? `<img src="${escapeHtml(item.downloadUrl)}" alt="${escapeHtml(record.title || '여행기')} 첨부 사진" loading="lazy">` : ''}</span>${item.downloadUrl ? `<a href="${escapeHtml(item.downloadUrl)}">${item.kind === 'photo' ? '원본 보기' : '다운로드'}</a>` : '<em>첨부</em>'}</div>`).join('')}
    </div>`;
}

function renderModerationActions(record) {
  const container = $('#detailModerationActions');
  container.replaceChildren();
  container.hidden = true;
  if (boardType === 'classHelper' && isModerator()) {
    const actions = config.boardApiEnabled ? [['edit', '수정']] : [];
    if (config.boardApiEnabled && Number(record.revision) > 1) actions.push(['history', '수정 이력']);
    if (record.status === 'draft') actions.push(['publish', '공개']);
    if (record.status !== 'archived') actions.push(['archive', '보관']);
    if (!actions.length) return;
    container.hidden = false;
    for (const [action, label] of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `button ${action === 'publish' ? 'button-primary' : 'button-outline'}`;
      button.textContent = label;
      button.addEventListener('click', () => {
        if (action === 'edit') beginEdit(record);
        else if (action === 'history') loadRevisionHistory(record);
        else moderateClassHelper(record.id, action);
      });
      container.append(button);
    }
    return;
  }
  if (boardType === 'resource' && isModerator()) {
    const actions = config.boardApiEnabled ? [['edit', '수정']] : [];
    if (config.boardApiEnabled && Number(record.revision) > 1) actions.push(['history', '수정 이력']);
    if (record.status === 'draft') actions.push(['publish', '공개']);
    if (record.status !== 'archived') actions.push(['archive', '보관']);
    if (!actions.length) return;
    container.hidden = false;
    for (const [action, label] of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `button ${action === 'publish' ? 'button-primary' : 'button-outline'}`;
      button.textContent = label;
      button.addEventListener('click', () => {
        if (action === 'edit') beginEdit(record);
        else if (action === 'history') loadRevisionHistory(record);
        else moderateMaterial(record.id, action);
      });
      container.append(button);
    }
    return;
  }
  if (!['classTip', 'travel'].includes(boardType)) return;
  if (!isModerator()) {
    if (record.status !== 'published' || currentUser.role === 'guest' || !config.boardApiEnabled) return;
    const reportButton = document.createElement('button');
    reportButton.type = 'button';
    reportButton.className = 'button button-outline';
    reportButton.textContent = '신고';
    reportButton.addEventListener('click', () => reportCommunityPost(record.id, reportButton));
    container.append(reportButton);
    container.hidden = false;
    return;
  }
  const actions = [];
  if (['pending_review', 'rejected'].includes(record.status)) actions.push(['publish', '승인·공개']);
  if (record.status === 'pending_review') actions.push(['reject', '반려']);
  if (record.status !== 'archived') actions.push(['archive', '보관']);
  if (!actions.length) return;
  container.hidden = false;
  for (const [action, label] of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button ${action === 'publish' ? 'button-primary' : 'button-outline'}`;
    button.textContent = label;
    button.addEventListener('click', () => moderatePost(record.id, action));
    container.append(button);
  }
}

async function loadRevisionHistory(record) {
  const container = $('#detailRevisionHistory');
  const base = boardType === 'resource' ? '/admin/materials' : '/admin/class-helpers';
  container.hidden = false;
  container.innerHTML = '<strong>수정 이력을 불러오는 중입니다.</strong>';
  try {
    const response = await fetch(apiUrl(`${base}/${encodeURIComponent(record.id)}/revisions`), { credentials: 'include' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || '수정 이력을 불러오지 못했습니다.');
    const items = payload.data?.items || payload.items || [];
    if (!items.length) {
      container.innerHTML = '<strong>저장된 이전 버전이 없습니다.</strong>';
      return;
    }
    container.innerHTML = `
      <div class="revision-history-heading"><strong>수정 이력</strong><span>복원해도 현재 공개·보관 상태는 유지됩니다.</span></div>
      <ol class="revision-history-list">
        ${items.map(item => {
          const snapshot = item.snapshot || {};
          const assetNames = boardType === 'resource'
            ? [snapshot.asset?.originalName].filter(Boolean)
            : (snapshot.assets || []).map(asset => asset?.originalName).filter(Boolean);
          const changes = item.changesToNext || {};
          const changedLabels = (changes.changedFields || []).map(field =>
            board.fields.find(candidate => candidate.name === field)?.label || field,
          );
          if (changes.assetChange) changedLabels.push('자료 파일');
          for (const asset of changes.replacedAssets || []) {
            changedLabels.push(board.fields.find(candidate => candidate.name === asset.field)?.label || asset.field);
          }
          return `<li>
            <div><b>버전 ${escapeHtml(item.revision)}</b><time>${escapeHtml(formatDate(item.createdAt))} · ${escapeHtml(item.changedByLabel || '운영자')} 변경</time></div>
            <strong>${escapeHtml(snapshot.title || '제목 없음')}</strong>
            <small>${escapeHtml(assetNames.join(' · ') || '첨부파일 없음')}</small>
            <p>${escapeHtml(changedLabels.length ? `다음 버전에서 변경: ${[...new Set(changedLabels)].join(', ')}` : '다음 버전과 변경점 없음')}</p>
            <button class="button button-outline" type="button" data-restore-revision="${escapeHtml(item.revision)}">이 버전 복원</button>
          </li>`;
        }).join('')}
      </ol>`;
    $$('[data-restore-revision]', container).forEach(button => button.addEventListener('click', () =>
      restoreRevision(record, button.dataset.restoreRevision, button),
    ));
  } catch (error) {
    container.innerHTML = `<strong>${escapeHtml(error.message || '수정 이력을 불러오지 못했습니다.')}</strong>`;
  }
}

async function restoreRevision(record, revision, button) {
  if (!window.confirm(`버전 ${revision}의 내용과 파일로 복원하시겠습니까? 현재 상태는 새 이력으로 보관됩니다.`)) return;
  const base = boardType === 'resource' ? '/admin/materials' : '/admin/class-helpers';
  button.disabled = true;
  try {
    const response = await fetch(apiUrl(`${base}/${encodeURIComponent(record.id)}/revisions/${encodeURIComponent(revision)}/restore`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || '이전 버전을 복원하지 못했습니다.');
    records = await loadRecords();
    renderList();
    closeModal($('#detailModal'));
    showToast(`버전 ${revision}을 새 버전으로 복원했습니다.`);
  } catch (error) {
    button.disabled = false;
    showToast(error.message || '이전 버전 복원 중 오류가 발생했습니다.');
  }
}

async function moderateMaterial(materialId, action) {
  if (action === 'archive' && !window.confirm('이 교재자료를 보관하시겠습니까?')) return;
  const endpoint = action === 'publish'
    ? `/admin/materials/${encodeURIComponent(materialId)}/publish`
    : `/admin/materials/${encodeURIComponent(materialId)}`;
  try {
    const response = await fetch(apiUrl(endpoint), {
      method: action === 'publish' ? 'POST' : 'DELETE',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || '교재자료 상태를 변경하지 못했습니다.');
    records = await loadRecords();
    renderList();
    closeModal($('#detailModal'));
    showToast(action === 'publish' ? '교재자료를 공개했습니다.' : '교재자료를 보관했습니다.');
  } catch (error) {
    showToast(error.message || '교재자료 처리 중 오류가 발생했습니다.');
  }
}

async function moderateClassHelper(helperId, action) {
  if (action === 'archive' && !window.confirm('이 수업 패키지를 보관하시겠습니까?')) return;
  const endpoint = action === 'publish'
    ? `/admin/class-helpers/${encodeURIComponent(helperId)}/publish`
    : `/admin/class-helpers/${encodeURIComponent(helperId)}`;
  try {
    const response = await fetch(apiUrl(endpoint), {
      method: action === 'publish' ? 'POST' : 'DELETE',
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || '수업 패키지 상태를 변경하지 못했습니다.');
    records = await loadRecords();
    renderList();
    closeModal($('#detailModal'));
    showToast(action === 'publish' ? '수업 패키지를 공개했습니다.' : '수업 패키지를 보관했습니다.');
  } catch (error) {
    showToast(error.message || '수업 패키지 처리 중 오류가 발생했습니다.');
  }
}

async function reportCommunityPost(postId, button) {
  const selection = window.prompt(
    '신고 사유 번호를 입력해 주세요.\n1 광고·도배\n2 개인정보 노출\n3 욕설·괴롭힘\n4 불법정보\n5 저작권 침해\n6 기타'
  );
  if (selection === null) return;
  const reasons = {
    '1': 'spam',
    '2': 'personal_info',
    '3': 'harassment',
    '4': 'illegal',
    '5': 'copyright',
    '6': 'other'
  };
  const reason = reasons[selection.trim()];
  if (!reason) {
    showToast('1부터 6까지의 신고 사유 번호를 입력해 주세요.');
    return;
  }
  const detail = window.prompt(reason === 'other'
    ? '기타 신고 사유를 2자 이상 입력해 주세요.'
    : '운영자에게 전달할 설명이 있다면 입력해 주세요. (선택)');
  if (detail === null) return;
  if (reason === 'other' && detail.trim().length < 2) {
    showToast('기타 신고 사유를 2자 이상 입력해 주세요.');
    return;
  }
  button.disabled = true;
  try {
    const response = await fetch(apiUrl(`/posts/${encodeURIComponent(postId)}/reports`), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ reason, ...(detail.trim() ? { detail: detail.trim() } : {}) })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || '신고를 접수하지 못했습니다.');
    button.textContent = '신고 접수됨';
    showToast('신고가 접수되었습니다. 운영자가 확인하겠습니다.');
  } catch (error) {
    button.disabled = false;
    showToast(error.message || '신고 접수 중 오류가 발생했습니다.');
  }
}

async function moderatePost(postId, action) {
  let body;
  if (action === 'reject') {
    const reason = window.prompt('반려 사유를 입력해 주세요.');
    if (!reason?.trim()) return;
    body = JSON.stringify({ reason: reason.trim() });
  }
  if (action === 'archive' && !window.confirm('이 게시글을 보관하시겠습니까?')) return;
  const endpoint = action === 'archive' ? `/posts/${encodeURIComponent(postId)}` : `/admin/posts/${encodeURIComponent(postId)}/${action}`;
  try {
    const response = await fetch(apiUrl(endpoint), {
      method: action === 'archive' ? 'DELETE' : 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      ...(body ? { body } : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error?.message || '검토 상태를 변경하지 못했습니다.');
    records = await loadRecords();
    renderList();
    closeModal($('#detailModal'));
    showToast(action === 'publish' ? '게시글을 승인하고 공개했습니다.' : action === 'reject' ? '게시글을 반려했습니다.' : '게시글을 보관했습니다.');
  } catch (error) {
    showToast(error.message || '검토 처리 중 오류가 발생했습니다.');
  }
}

function collectFormRecord(form) {
  const record = {};
  for (const field of board.fields) {
    const element = form.elements[field.name];
    if (!element) continue;
    if (field.type === 'file') record[field.name] = element.files?.[0]?.name || '';
    else if (field.type === 'checkbox') record[field.name] = element.checked;
    else if (field.type === 'number') record[field.name] = element.valueAsNumber;
    else record[field.name] = element.value.trim();
  }
  return record;
}

async function submitRecord(event) {
  event.preventDefault();
  if (!canWrite()) return;
  const form = event.currentTarget;
  const inquiryAttachmentFile = boardType === 'inquiry' && config.boardApiEnabled
    ? form.elements.attachment?.files?.[0] || null
    : null;
  const communityAttachmentFile = ['classTip', 'travel'].includes(boardType) && config.boardApiEnabled
    ? form.elements.attachment?.files?.[0] || null
    : null;
  const materialFile = boardType === 'resource' && config.boardApiEnabled
    ? form.elements.attachment?.files?.[0] || null
    : null;
  const classHelperFiles = boardType === 'classHelper' && config.boardApiEnabled
    ? Object.fromEntries(['projectorPpt', 'activityPdf', 'historyQuizFile', 'problemMissionFile', 'answerFile', 'teacherGuideFile']
      .map(field => [field, form.elements[field]?.files?.[0] || null]))
    : null;
  const editing = Boolean(editingRecordId && ['resource', 'classHelper'].includes(boardType));
  const submitted = collectFormRecord(form);
  const now = new Date().toISOString();
  const record = {
    id: `local-${boardType}-${Date.now()}`,
    boardType,
    ...submitted,
    authorId: currentUser.id,
    authorLabel: currentUser.name,
    createdAt: now,
    publishedAt: submitted.publishedAt || now,
    status: currentUser.role === 'teacher' && ['classTip', 'travel'].includes(boardType) ? 'pending_review' : (board.isPrivate ? 'submitted' : 'published')
  };

  try {
    if (config.boardApiEnabled) {
      if (['classTip', 'travel'].includes(boardType)) submitted.type = boardType;
      if (communityAttachmentFile) {
        delete submitted.attachment;
        submitted.attachmentId = await uploadCommunityAttachment(communityAttachmentFile, boardType);
      }
      if (boardType === 'inquiry') {
        delete submitted.attachment;
        if (inquiryAttachmentFile) submitted.attachmentId = await uploadInquiryAttachment(inquiryAttachmentFile);
      }
      if (boardType === 'resource') {
        delete submitted.attachment;
        if (materialFile) submitted.assetId = await uploadTeachingMaterialAsset(materialFile);
        else if (!editing) throw new Error('교재자료 파일을 선택해 주세요.');
      }
      if (boardType === 'classHelper') {
        const entries = Object.entries(classHelperFiles || {}).filter(([, file]) => !editing || file);
        const uploadedAssets = await Promise.all(entries.map(async ([field, file]) => [field, await uploadClassHelperAsset(file, field)]));
        Object.keys(classHelperFiles || {}).forEach(field => delete submitted[field]);
        if (uploadedAssets.length) submitted.assetIds = Object.fromEntries(uploadedAssets);
      }
      const endpoint = editing
        ? `${board.writeEndpoint}/${encodeURIComponent(editingRecordId)}`
        : board.writeEndpoint;
      const response = await fetch(apiUrl(endpoint), {
        method: editing ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(submitted)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || '글을 저장하지 못했습니다.');
      records = await loadRecords();
    } else {
      saveLocalRecord(boardType, record);
      records = localRecords(boardType);
    }
    closeModal($('#writeModal'));
    form.reset();
    editingRecordId = null;
    $('#writeModalTitle').textContent = board.writeLabel;
    $('#writeModalDescription').textContent = board.roleGuide;
    renderList();
    showToast(editing ? '수정 내용과 이전 버전을 함께 저장했습니다.' : (board.isPrivate ? '정상적으로 접수되었습니다.' : '글이 저장되었습니다.'));
  } catch (error) {
    showToast(error.message || '저장 중 오류가 발생했습니다.');
  }
}

async function uploadTeachingMaterialAsset(file) {
  if (!file) throw new Error('교재자료 파일을 선택해 주세요.');
  const intentResponse = await fetch(apiUrl('/teaching-material-assets/uploads'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size })
  });
  const intentPayload = await intentResponse.json().catch(() => ({}));
  if (!intentResponse.ok) throw new Error(intentPayload.error?.message || '교재자료 업로드를 준비하지 못했습니다.');
  const intent = intentPayload.data || intentPayload;
  const uploadBody = new FormData();
  Object.entries(intent.upload.fields).forEach(([key, value]) => uploadBody.append(key, value));
  uploadBody.append('file', file);
  const uploaded = await fetch(intent.upload.url, { method: intent.upload.method, body: uploadBody });
  if (!uploaded.ok) throw new Error('교재자료를 저장소에 업로드하지 못했습니다.');
  const completeResponse = await fetch(apiUrl(`/teaching-material-assets/${encodeURIComponent(intent.asset.id)}/complete`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  });
  const completePayload = await completeResponse.json().catch(() => ({}));
  if (!completeResponse.ok) throw new Error(completePayload.error?.message || '교재자료 안전 검사를 완료하지 못했습니다.');
  return intent.asset.id;
}

async function uploadClassHelperAsset(file, kind) {
  if (!file) throw new Error('6종 수업자료 파일을 모두 선택해 주세요.');
  const contentTypes = {
    pdf: 'application/pdf', ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    hwp: 'application/x-hwp', hwpx: 'application/hwp+zip'
  };
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const contentType = file.type || contentTypes[extension] || '';
  const intentResponse = await fetch(apiUrl('/class-helper-assets/uploads'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ kind, fileName: file.name, contentType, size: file.size })
  });
  const intentPayload = await intentResponse.json().catch(() => ({}));
  if (!intentResponse.ok) throw new Error(intentPayload.error?.message || '수업자료 업로드를 준비하지 못했습니다.');
  const intent = intentPayload.data || intentPayload;
  const uploadBody = new FormData();
  Object.entries(intent.upload.fields).forEach(([key, value]) => uploadBody.append(key, value));
  uploadBody.append('file', file);
  const uploaded = await fetch(intent.upload.url, { method: intent.upload.method, body: uploadBody });
  if (!uploaded.ok) throw new Error('수업자료를 저장소에 업로드하지 못했습니다.');
  const completeResponse = await fetch(apiUrl(`/class-helper-assets/${encodeURIComponent(intent.asset.id)}/complete`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  });
  const completePayload = await completeResponse.json().catch(() => ({}));
  if (!completeResponse.ok) throw new Error(completePayload.error?.message || '수업자료 안전 검사를 완료하지 못했습니다.');
  return intent.asset.id;
}

async function uploadCommunityAttachment(file, type) {
  const intentResponse = await fetch(apiUrl('/community-attachments/uploads'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({
      kind: type === 'travel' ? 'photo' : 'material',
      fileName: file.name,
      contentType: file.type,
      size: file.size
    })
  });
  const intentPayload = await intentResponse.json().catch(() => ({}));
  if (!intentResponse.ok) throw new Error(intentPayload.error?.message || '첨부파일 업로드를 준비하지 못했습니다.');
  const intent = intentPayload.data || intentPayload;
  const uploadBody = new FormData();
  Object.entries(intent.upload.fields).forEach(([key, value]) => uploadBody.append(key, value));
  uploadBody.append('file', file);
  const uploaded = await fetch(intent.upload.url, { method: intent.upload.method, body: uploadBody });
  if (!uploaded.ok) throw new Error('첨부파일을 저장소에 업로드하지 못했습니다.');
  const completeResponse = await fetch(apiUrl(`/community-attachments/${encodeURIComponent(intent.attachment.id)}/complete`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  });
  const completePayload = await completeResponse.json().catch(() => ({}));
  if (!completeResponse.ok) throw new Error(completePayload.error?.message || '첨부파일 안전 검사를 완료하지 못했습니다.');
  return intent.attachment.id;
}

async function uploadInquiryAttachment(file) {
  const intentResponse = await fetch(apiUrl('/inquiry-attachments/uploads'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size })
  });
  const intentPayload = await intentResponse.json().catch(() => ({}));
  if (!intentResponse.ok) throw new Error(intentPayload.error?.message || '첨부파일 업로드를 준비하지 못했습니다.');
  const intent = intentPayload.data || intentPayload;
  const uploadBody = new FormData();
  Object.entries(intent.upload.fields).forEach(([key, value]) => uploadBody.append(key, value));
  uploadBody.append('file', file);
  const uploaded = await fetch(intent.upload.url, { method: intent.upload.method, body: uploadBody });
  if (!uploaded.ok) throw new Error('첨부파일 저장소 업로드에 실패했습니다.');
  const completeResponse = await fetch(apiUrl(`/inquiry-attachments/${encodeURIComponent(intent.attachment.id)}/complete`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  });
  const completePayload = await completeResponse.json().catch(() => ({}));
  if (!completeResponse.ok) throw new Error(completePayload.error?.message || '첨부파일 안전 검사를 완료하지 못했습니다.');
  return intent.attachment.id;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

$('#writeButton').addEventListener('click', () => {
  if (!canWrite()) {
    showToast(currentUser.role === 'guest' ? '로그인 후 작성할 수 있습니다.' : '현재 회원 권한으로는 작성할 수 없습니다.');
    return;
  }
  renderWriteForm();
  openModal($('#writeModal'));
});

$('#boardSearch').addEventListener('input', renderList);
$('#boardCategory').addEventListener('change', renderList);
$('#boardWriteForm').addEventListener('submit', submitRecord);
$$('[data-close-board-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.closest('.modal'))));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal($('.modal.open')); });
$('#demoRoleSelect').addEventListener('change', async event => {
  localStorage.setItem('bhj_demo_role', event.target.value);
  currentUser = await resolveCurrentUser();
  records = await loadRecords();
  renderPageMeta();
  renderList();
  showToast(`${ROLE_LABELS[currentUser.role]} 권한으로 전환했습니다.`);
});

async function initialize() {
  currentUser = await resolveCurrentUser();
  records = await loadRecords();
  renderTabs();
  renderPageMeta();
  renderList();
  const requestedRecordId = new URLSearchParams(window.location.search).get('id')?.trim();
  if (boardType === 'inquiry' && requestedRecordId && requestedRecordId.length <= 100) {
    if (records.some(record => record.id === requestedRecordId)) openDetail(requestedRecordId);
    else showToast('해당 문의를 찾을 수 없습니다.');
  }
  $('#year').textContent = new Date().getFullYear();
}

initialize();
