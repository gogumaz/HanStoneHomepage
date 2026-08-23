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
    writeRoles: ['teacher', 'operator', 'admin'],
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
      { name: 'attachment', label: '수업자료 첨부', type: 'file', full: true }
    ]
  },
  travel: {
    label: '여행기',
    description: '교실과 가정에서 경험한 역사 여행 이야기를 소개합니다.',
    writeLabel: '여행기 작성',
    writeRoles: ['teacher', 'operator', 'admin'],
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
      { name: 'attachment', label: '사진 첨부', type: 'file', accept: 'image/*', full: true },
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
    writeRoles: ['student', 'guardian', 'teacher', 'operator', 'admin'],
    roleGuide: '로그인한 회원만 작성할 수 있으며 본인의 문의만 확인할 수 있습니다.',
    isPrivate: true,
    listEndpoint: '/me/inquiries',
    writeEndpoint: '/inquiries',
    categories: ['회원', '학습', '교재', '결제', '기타'],
    fields: [
      { name: 'category', label: '문의 유형', type: 'select', required: true, options: ['회원', '학습', '교재', '결제', '기타'] },
      { name: 'title', label: '제목', type: 'text', required: true, full: true },
      { name: 'content', label: '문의 내용', type: 'textarea', required: true, full: true },
      { name: 'attachment', label: '첨부파일', type: 'file', full: true }
    ]
  },
  consultation: {
    label: '기관상담',
    description: '바둑학원과 방과후 교실에 맞는 도입 구성을 상담합니다.',
    writeLabel: '상담 신청',
    writeRoles: ['guest', 'student', 'guardian', 'teacher', 'operator', 'admin'],
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
    readRoles: ['teacher', 'operator', 'admin'],
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
      { name: 'lessonVideo', label: '수업용 5분 영상', type: 'file', required: true, accept: 'video/mp4,video/webm', full: true },
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
let currentUser = { id: 'guest-local', role: 'guest', name: '비회원' };
let records = [];
let lastFocused = null;

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
        const role = user.role || (Array.isArray(user.roles) ? user.roles[0] : null) || 'guest';
        return { id: user.id, role, name: user.displayName || user.name || ROLE_LABELS[role] };
      }
    } catch {}
  }
  const role = localStorage.getItem('bhj_demo_role') || 'guest';
  return { id: `demo-${role}`, role, name: ROLE_LABELS[role] || '비회원' };
}

async function loadRecords() {
  if (!canRead()) return [];
  if (!config.boardApiEnabled) return localRecords(boardType);
  try {
    const response = await fetch(apiUrl(board.listEndpoint), { credentials: 'include' });
    if (!response.ok) throw new Error('게시글을 불러오지 못했습니다.');
    const payload = await response.json();
    return payload.data?.items || payload.data || payload.items || [];
  } catch (error) {
    showToast(error.message);
    return [];
  }
}

function canWrite() {
  return board.writeRoles.includes(currentUser.role);
}

function canRead() {
  return !board.readRoles || board.readRoles.includes(currentUser.role);
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
  if (!board.isPrivate || ['operator', 'admin'].includes(currentUser.role)) return records;
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
  if (record.status === 'answered') return '답변 완료';
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
    <button class="board-row" type="button" data-record-id="${record.id}">
      <span class="board-row-status ${record.isPinned ? 'pinned' : ''}">${displayStatus(record)}</span>
      <span class="board-row-main"><small>${record.category || '일반'}</small><strong>${escapeHtml(record.title || '제목 없음')}</strong><em>${escapeHtml((record.content || '').slice(0, 80))}</em></span>
      <span class="board-row-info"><b>${escapeHtml(record.authorLabel || '작성자')}</b><time>${formatDate(record.publishedAt || record.createdAt)}</time></span>
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

function createField(field) {
  const wrapper = document.createElement('label');
  wrapper.className = `dynamic-field ${field.full ? 'full' : ''} ${field.type === 'checkbox' ? 'checkbox-field' : ''}`;
  const label = document.createElement('span');
  label.textContent = `${field.label}${field.required ? ' *' : ''}`;
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
  input.required = Boolean(field.required);
  if (field.min != null) input.min = field.min;
  if (field.accept) input.accept = field.accept;
  if (field.type === 'date') input.value = new Date().toISOString().slice(0, 10);
  if (field.type === 'checkbox') {
    wrapper.append(input, label);
  } else {
    wrapper.append(label, input);
  }
  return wrapper;
}

function renderWriteForm() {
  const form = $('#dynamicForm');
  form.replaceChildren(...board.fields.map(createField));
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
  $('#detailAuthor').textContent = `${record.authorLabel || '작성자'} · ${displayStatus(record)}`;
  $('#detailBody').textContent = record.content || '내용이 없습니다.';
  renderClassHelperDetail(record);
  renderDetailAttachments(record);
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
    .filter(field => field.type === 'file' && record[field.name])
    .map(field => {
      const value = record[field.name];
      const fileName = typeof value === 'object' ? (value.originalName || value.name || '첨부파일') : value;
      return { label: field.label, fileName };
    });
  container.hidden = !attachments.length;
  if (!attachments.length) {
    container.replaceChildren();
    return;
  }
  container.innerHTML = `
    <div class="attachment-heading"><strong>첨부 수업자료 ${attachments.length}개</strong><span>게시물 하나에서 순서대로 활용하세요.</span></div>
    <div class="attachment-package-list">
      ${attachments.map((item, index) => `
        <div><b>${String(index + 1).padStart(2, '0')}</b><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.fileName)}</small></span><em>첨부</em></div>`).join('')}
    </div>`;
}

function collectFormRecord(form) {
  const record = {};
  for (const field of board.fields) {
    const element = form.elements[field.name];
    if (field.type === 'file') record[field.name] = element.files?.[0]?.name || '';
    else if (field.type === 'checkbox') record[field.name] = element.checked;
    else record[field.name] = element.value.trim();
  }
  return record;
}

async function submitRecord(event) {
  event.preventDefault();
  if (!canWrite()) return;
  const submitted = collectFormRecord(event.currentTarget);
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
      const response = await fetch(apiUrl(board.writeEndpoint), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(record)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || '글을 저장하지 못했습니다.');
      records = await loadRecords();
    } else {
      saveLocalRecord(boardType, record);
      records = localRecords(boardType);
    }
    closeModal($('#writeModal'));
    event.currentTarget.reset();
    renderList();
    showToast(board.isPrivate ? '정상적으로 접수되었습니다.' : '글이 저장되었습니다.');
  } catch (error) {
    showToast(error.message || '저장 중 오류가 발생했습니다.');
  }
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
  $('#year').textContent = new Date().getFullYear();
}

initialize();
