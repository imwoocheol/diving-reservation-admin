// 팝업 배너 설정 페이지 로직 — siteConfig/popup 문서를 읽고/저장하고 실시간 미리보기 제공
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { db, storage } from './firebase-config.js';
import { requireAuth } from './auth-guard.js';
import { initSidebarLogout, setUserEmail } from './sidebar.js';
import { renderNav } from './nav.js';

// ---- 상태 저장소 ------------------------------------------------------------

let currentUser = null;

// 파일 크기 제한 (바이트) — 이미지 5MB, 비디오 30MB
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;

// ---- 폼 <-> 값 헬퍼 ----------------------------------------------------------

// 폼 요소 참조 모음
const els = {
  title: () => document.getElementById('popup-title'),
  image: () => document.getElementById('popup-image'),
  message: () => document.getElementById('popup-message'),
  start: () => document.getElementById('popup-start'),
  end: () => document.getElementById('popup-end'),
  enabled: () => document.getElementById('popup-enabled'),
  file: () => document.getElementById('popup-file'),
  mediaTypeImage: () => document.getElementById('media-type-image'),
  mediaTypeVideo: () => document.getElementById('media-type-video'),
};

// 날짜 선택기: 브라우저/OS 언어와 무관하게 항상 영어로 표시.
// 네이티브 <input type="date">는 플레이스홀더와 달력이 브라우저 언어를 따르고
// lang 속성이나 CSS로 통제할 수 없어 Flatpickr 로 교체한다.
// 고객 사이트와 달리 minDate 를 두지 않는다 — 어드민은 이미 지난 캠페인도 열람/수정해야 한다.
const DATE_PICKER_BASE = {
  dateFormat: 'Y-m-d', // 원본 input 에 남는 값 (Firestore 저장용, 기존 포맷 유지)
  altInput: true,
  altFormat: 'F j, Y', // 화면에 보이는 값 (예: August 15, 2026)
  disableMobile: true, // 모바일에서 네이티브(로케일 종속) 피커로 폴백되는 것 방지
  altInputClass:
    'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/40',
  // flatpickr 는 원본 input 에 change 만 발생시켜 input 리스너가 걸리지 않으므로
  // 미리보기 갱신을 여기서 직접 호출한다
  onChange: () => renderPreview(),
};

const startPicker = flatpickr('#popup-start', DATE_PICKER_BASE);
const endPicker = flatpickr('#popup-end', DATE_PICKER_BASE);

// 값이 없으면 비우고, 있으면 지정한다 (onChange 는 발생시키지 않음 — 불러오기는 사용자 입력이 아님)
function setPickerDate(picker, value) {
  if (value) {
    picker.setDate(value, false);
  } else {
    picker.clear(false);
  }
}

// 현재 선택된 미디어 타입 라디오 값 반환 ('image' | 'video'), 없으면 'image'
function readMediaType() {
  return els.mediaTypeVideo() && els.mediaTypeVideo().checked ? 'video' : 'image';
}

// 미디어 타입 라디오 선택
function setMediaType(type) {
  if (type === 'video') {
    els.mediaTypeVideo().checked = true;
  } else {
    els.mediaTypeImage().checked = true;
  }
}

// 현재 폼 입력값을 하나의 객체로 수집
function readForm() {
  return {
    title: els.title().value.trim(),
    imageUrl: els.image().value.trim(),
    message: els.message().value.trim(),
    startDate: els.start().value, // YYYY-MM-DD
    endDate: els.end().value, // YYYY-MM-DD
    enabled: els.enabled().checked,
    mediaType: readMediaType(), // 'image' | 'video'
  };
}

// Firestore 에서 불러온 값으로 폼 채우기 (문서 없으면 빈 폼 + enabled false)
function fillForm(data) {
  els.title().value = data.title || '';
  els.image().value = data.imageUrl || '';
  els.message().value = data.message || '';
  // altInput 사용 시 원본 input 에 직접 대입하면 화면에 보이는 필드가 갱신되지 않으므로
  // 반드시 flatpickr API 로 값을 넣는다
  setPickerDate(startPicker, data.startDate);
  setPickerDate(endPicker, data.endDate);
  els.enabled().checked = data.enabled === true;
  // mediaType 필드가 없는 예전 데이터는 image 로 취급 (하위 호환)
  setMediaType(data.mediaType === 'video' ? 'video' : 'image');
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
  const videoEl = document.getElementById('preview-video');

  // mediaType 에 따라 이미지/비디오 미리보기 분기
  if (data.mediaType === 'video') {
    // 비디오: video 요소에 src 설정 후 표시, 이미지 숨김
    imageEl.removeAttribute('src');
    imageEl.classList.add('hidden');
    if (data.imageUrl) {
      videoEl.src = data.imageUrl;
      videoEl.classList.remove('hidden');
    } else {
      videoEl.removeAttribute('src');
      videoEl.classList.add('hidden');
    }
  } else {
    // 이미지: image 요소에 src 설정 후 표시, 비디오 숨김
    videoEl.removeAttribute('src');
    videoEl.classList.add('hidden');
    if (data.imageUrl) {
      imageEl.src = data.imageUrl;
      imageEl.classList.remove('hidden');
    } else {
      imageEl.removeAttribute('src');
      imageEl.classList.add('hidden');
    }
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

// ---- 파일 업로드 ------------------------------------------------------------

// 업로드 상태/에러 메시지 표시 (kind: 'info' | 'error' | 'success')
function showUploadStatus(message, kind) {
  const el = document.getElementById('upload-status');
  el.textContent = message;
  const color =
    kind === 'error'
      ? 'text-red-500'
      : kind === 'success'
        ? 'text-green-600'
        : 'text-slate-500';
  el.className = `text-xs mb-3 font-semibold ${color}`;
  el.classList.remove('hidden');
}

function hideUploadStatus() {
  const el = document.getElementById('upload-status');
  el.classList.add('hidden');
}

// 진행률 바 표시/갱신/숨김
function showUploadProgress(percent) {
  const wrap = document.getElementById('upload-progress-wrap');
  const bar = document.getElementById('upload-progress-bar');
  const text = document.getElementById('upload-progress-text');
  wrap.classList.remove('hidden');
  const p = Math.round(percent);
  bar.style.width = `${p}%`;
  text.textContent = `${p}%`;
}

function hideUploadProgress() {
  document.getElementById('upload-progress-wrap').classList.add('hidden');
}

// 파일 input change 핸들러 — 검증 후 Storage 업로드, 완료 시 URL/라디오/미리보기 반영
function onFileSelected(isMock) {
  const fileInput = els.file();
  const file = fileInput.files && fileInput.files[0];
  if (!file) return; // 파일 없으면 무시

  // MIME 타입 검증 — 이미지/비디오만 허용
  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) {
    showUploadStatus('Only image or video files can be uploaded.', 'error');
    return;
  }

  // 크기 제한 검증 — 이미지 5MB, 비디오 30MB
  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    const limitMb = isVideo ? 30 : 5;
    showUploadStatus(`File is too large. ${isVideo ? 'Videos' : 'Images'} can be up to ${limitMb}MB.`, 'error');
    return;
  }

  // 목업 모드: 실제 Storage 업로드는 하지 않고 안내만 표시
  if (isMock) {
    showUploadStatus('Upload only works in the real environment (mock mode).', 'info');
    return;
  }

  // 업로드 시작
  hideUploadStatus();
  showUploadProgress(0);
  const storageRef = ref(storage, `popup-media/${Date.now()}-${file.name}`);
  const task = uploadBytesResumable(storageRef, file);

  task.on(
    'state_changed',
    (snapshot) => {
      // 진행률(%) 갱신
      const percent = snapshot.totalBytes
        ? (snapshot.bytesTransferred / snapshot.totalBytes) * 100
        : 0;
      showUploadProgress(percent);
    },
    (err) => {
      // 업로드 실패 — alert 대신 인라인 텍스트로 표시
      console.error('[Storage] 파일 업로드 실패:', err);
      hideUploadProgress();
      showUploadStatus('Upload failed. Check your network or permissions.', 'error');
    },
    async () => {
      // 업로드 완료 — 다운로드 URL 받아서 폼에 반영
      try {
        const url = await getDownloadURL(task.snapshot.ref);
        els.image().value = url;
        // 파일 MIME 타입 기준으로 미디어 타입 라디오 자동 선택
        setMediaType(isVideo ? 'video' : 'image');
        hideUploadProgress();
        showUploadStatus('Upload complete.', 'success');
        renderPreview(); // 값이 바뀌었으니 미리보기 갱신
      } catch (err) {
        console.error('[Storage] 다운로드 URL 조회 실패:', err);
        hideUploadProgress();
        showUploadStatus('Uploaded, but failed to retrieve the URL.', 'error');
      }
    },
  );
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
      mediaType: data.mediaType, // 'image' | 'video'
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
  // start/end 는 flatpickr onChange 에서 renderPreview 를 호출하므로 여기서 제외한다
  // (원본 input 이 hidden 이라 input 이벤트가 발생하지 않음)
  ['title', 'image', 'message'].forEach((key) => {
    els[key]().addEventListener('input', renderPreview);
  });
  els.enabled().addEventListener('change', renderPreview);
  // 미디어 타입 라디오 변경 시에도 미리보기 갱신
  els.mediaTypeImage().addEventListener('change', renderPreview);
  els.mediaTypeVideo().addEventListener('change', renderPreview);
}

// ---- 부트스트랩 -------------------------------------------------------------

renderNav('popup.html');
initSidebarLogout();
bindFormEvents();

if (new URLSearchParams(location.search).get('mock') === '1') {
  // 목업 모드 — Firestore/Storage 호출 없이 폼/미리보기만 동작
  setUserEmail('mock@example.com');
  document.getElementById('save-btn').addEventListener('click', () => onSave(true));
  els.file().addEventListener('change', () => onFileSelected(true));
  renderPreview();
} else {
  requireAuth((user) => {
    currentUser = user;
    setUserEmail(user.email);
    document.getElementById('save-btn').addEventListener('click', () => onSave(false));
    els.file().addEventListener('change', () => onFileSelected(false));
    loadConfig();
  });
}
