// 팝업 배너 설정 페이지 로직 — siteConfig/popup 문서를 읽고/저장하고 실시간 미리보기 제공
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './firebase-config.js';
import { requireAuth } from './auth-guard.js';
import { initSidebarLogout, setUserEmail } from './sidebar.js';
import { renderNav } from './nav.js';

// ---- 상태 저장소 ------------------------------------------------------------

let currentUser = null;

// ---- 폼 <-> 값 헬퍼 ----------------------------------------------------------

// 폼 요소 참조 모음
const els = {
  title: () => document.getElementById('popup-title'),
  image: () => document.getElementById('popup-image'),
  message: () => document.getElementById('popup-message'),
  start: () => document.getElementById('popup-start'),
  end: () => document.getElementById('popup-end'),
  enabled: () => document.getElementById('popup-enabled'),
};

// 현재 폼 입력값을 하나의 객체로 수집
function readForm() {
  return {
    title: els.title().value.trim(),
    imageUrl: els.image().value.trim(),
    message: els.message().value.trim(),
    startDate: els.start().value, // YYYY-MM-DD
    endDate: els.end().value, // YYYY-MM-DD
    enabled: els.enabled().checked,
  };
}

// Firestore 에서 불러온 값으로 폼 채우기 (문서 없으면 빈 폼 + enabled false)
function fillForm(data) {
  els.title().value = data.title || '';
  els.image().value = data.imageUrl || '';
  els.message().value = data.message || '';
  els.start().value = data.startDate || '';
  els.end().value = data.endDate || '';
  els.enabled().checked = data.enabled === true;
}

// ---- 실시간 미리보기 ---------------------------------------------------------

function renderPreview() {
  const data = readForm();
  const disabledEl = document.getElementById('preview-disabled');
  const cardEl = document.getElementById('preview-card');

  // enabled 가 아니면 미리보기 대신 비활성 안내만 표시
  if (!data.enabled) {
    disabledEl.classList.remove('hidden');
    cardEl.classList.add('hidden');
    return;
  }
  disabledEl.classList.add('hidden');
  cardEl.classList.remove('hidden');

  const imageEl = document.getElementById('preview-image');
  if (data.imageUrl) {
    imageEl.src = data.imageUrl;
    imageEl.classList.remove('hidden');
  } else {
    imageEl.removeAttribute('src');
    imageEl.classList.add('hidden');
  }

  document.getElementById('preview-title').textContent = data.title || 'Popup title';
  document.getElementById('preview-message').textContent = data.message || 'Your message will appear here.';

  const dates = data.startDate && data.endDate ? `${data.startDate} → ${data.endDate}` : '';
  document.getElementById('preview-dates').textContent = dates;
}

// ---- 저장 -------------------------------------------------------------------

function showSaveStatus(message, ok) {
  const el = document.getElementById('save-status');
  el.textContent = message;
  el.className = ok
    ? 'text-xs mt-3 text-center text-green-600 font-semibold'
    : 'text-xs mt-3 text-center text-red-500 font-semibold';
  el.classList.remove('hidden');
}

async function onSave(isMock) {
  const data = readForm();
  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;

  // 목업 모드에서는 Firestore 호출 없이 저장한 척만 함
  if (isMock) {
    showSaveStatus('Saved (mock — not persisted).', true);
    saveBtn.disabled = false;
    return;
  }

  try {
    await setDoc(doc(db, 'siteConfig', 'popup'), {
      title: data.title,
      imageUrl: data.imageUrl,
      message: data.message,
      startDate: data.startDate,
      endDate: data.endDate,
      enabled: data.enabled,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser ? currentUser.email : 'unknown',
    });
    showSaveStatus('Saved successfully.', true);
  } catch (err) {
    console.error('[Firestore] 팝업 설정 저장 실패:', err);
    showSaveStatus('Failed to save. Check permissions or network.', false);
  } finally {
    saveBtn.disabled = false;
  }
}

// ---- 불러오기 ---------------------------------------------------------------

async function loadConfig() {
  try {
    const snap = await getDoc(doc(db, 'siteConfig', 'popup'));
    if (snap.exists()) {
      fillForm(snap.data());
    } else {
      fillForm({}); // 문서 없음 → 빈 폼
    }
  } catch (err) {
    console.error('[Firestore] 팝업 설정 불러오기 실패:', err);
    fillForm({});
  }
  renderPreview();
}

// ---- 이벤트 바인딩 ----------------------------------------------------------

function bindFormEvents() {
  ['title', 'image', 'message', 'start', 'end'].forEach((key) => {
    els[key]().addEventListener('input', renderPreview);
  });
  els.enabled().addEventListener('change', renderPreview);
}

// ---- 부트스트랩 -------------------------------------------------------------

renderNav('popup.html');
initSidebarLogout();
bindFormEvents();

if (new URLSearchParams(location.search).get('mock') === '1') {
  // 목업 모드 — Firestore 호출 없이 폼/미리보기만 동작
  setUserEmail('mock@example.com');
  document.getElementById('save-btn').addEventListener('click', () => onSave(true));
  renderPreview();
} else {
  requireAuth((user) => {
    currentUser = user;
    setUserEmail(user.email);
    document.getElementById('save-btn').addEventListener('click', () => onSave(false));
    loadConfig();
  });
}
