// 고객 관리 페이지 로직 — 예약을 이메일 기준으로 dedupe 한 고객 목록 + 선택 발송(커스텀 메일)
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './firebase-config.js';
import { requireAuth } from './auth-guard.js';
import { resolveEmailAddress, escapeHtml, initials, avatarColor, toDate } from './booking-shared.js';
import { initSidebarLogout, setUserEmail } from './sidebar.js';
import { renderNav } from './nav.js';
import { sendCustomEmail } from './email.js';

// ---- 상태 저장소 ------------------------------------------------------------

let customers = []; // dedupe 된 고객 배열 ({ name, email, count } 형태)
let selectedEmails = new Set(); // 체크된 이메일 (재렌더 시에도 선택 유지)
let isSending = false; // 발송 진행 중 중복 실행 방지

// 목업 고객 데이터 (로그인 없이 테이블/선택/모달 동작 확인용, ?mock=1)
const MOCK_CUSTOMERS = [
  { name: 'Emma Wilson', email: 'emma.wilson@example.com', count: 3 },
  { name: 'Kim Minsu', email: 'minsu@test.com', count: 1 },
  { name: 'Yuki Tanaka', email: 'yuki@test.com', count: 2 },
  { name: 'Sarah Lee', email: 'sarah.lee@example.com', count: 1 },
];

// ---- 고객 dedupe -------------------------------------------------------------

// 예약 배열 → 이메일 기준 고유 고객 배열
// count 는 해당 이메일의 총 예약 건수, name 은 가장 최근 예약의 이름을 사용.
function buildCustomers(bookings) {
  const map = new Map(); // email → { name, email, count, lastCreatedAt }
  bookings.forEach((b) => {
    const email = resolveEmailAddress(b);
    if (!email) return;
    const created = toDate(b.createdAt); // 최신 여부 비교용 (없으면 null)
    const existing = map.get(email);
    if (!existing) {
      map.set(email, { name: b.name || 'Guest', email, count: 1, lastCreatedAt: created });
    } else {
      existing.count += 1;
      // 더 최근 예약이면 이름 갱신 (lastCreatedAt 이 없던 경우도 채움)
      if (created && (!existing.lastCreatedAt || created > existing.lastCreatedAt)) {
        existing.name = b.name || existing.name;
        existing.lastCreatedAt = created;
      }
    }
  });
  return Array.from(map.values());
}

// ---- 렌더링: 고객 테이블 -----------------------------------------------------

function renderTable() {
  const tbody = document.getElementById('customers-tbody');
  const emptyRow = document.getElementById('table-empty');

  if (customers.length === 0) {
    tbody.innerHTML = '';
    emptyRow.classList.remove('hidden');
    updateSelectAllState();
    renderSelectedCount();
    return;
  }
  emptyRow.classList.add('hidden');

  tbody.innerHTML = customers
    .map((c) => {
      const checked = selectedEmails.has(c.email) ? ' checked' : '';
      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
          <td class="px-4 py-3">
            <input type="checkbox" class="admin-checkbox customer-check" data-email="${escapeHtml(c.email)}"${checked}>
          </td>
          <td class="px-4 py-3">
            <div class="flex items-center gap-3">
              <span class="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style="background:${avatarColor(c.name)}">${escapeHtml(initials(c.name))}</span>
              <p class="font-semibold text-slate-800 text-sm truncate">${escapeHtml(c.name)}</p>
            </div>
          </td>
          <td class="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">${escapeHtml(c.email)}</td>
          <td class="px-4 py-3 text-sm text-slate-600 text-right">${c.count}</td>
        </tr>`;
    })
    .join('');

  // 개별 체크박스 이벤트 바인딩 (재렌더 시마다 재바인딩)
  tbody.querySelectorAll('.customer-check').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const email = e.target.dataset.email;
      if (e.target.checked) selectedEmails.add(email);
      else selectedEmails.delete(email);
      updateSelectAllState();
      renderSelectedCount();
    });
  });

  updateSelectAllState();
  renderSelectedCount();
}

// 전체 선택 체크박스 상태를 현재 선택 현황에 맞게 갱신
function updateSelectAllState() {
  const selectAll = document.getElementById('select-all');
  if (!selectAll) return;
  const total = customers.length;
  const selected = customers.filter((c) => selectedEmails.has(c.email)).length;
  selectAll.checked = total > 0 && selected === total;
  selectAll.indeterminate = selected > 0 && selected < total;
}

// 선택 건수 라벨 + 발송 버튼 카운트 갱신
function renderSelectedCount() {
  const count = customers.filter((c) => selectedEmails.has(c.email)).length;
  const label = document.getElementById('selected-count-label');
  const sendCount = document.getElementById('send-count');
  if (label) label.textContent = `${count} selected`;
  if (sendCount) sendCount.textContent = count;
}

// ---- 전체 선택 토글 ----------------------------------------------------------

function bindSelectAll() {
  const selectAll = document.getElementById('select-all');
  if (!selectAll) return;
  selectAll.addEventListener('change', (e) => {
    if (e.target.checked) {
      customers.forEach((c) => selectedEmails.add(c.email));
    } else {
      customers.forEach((c) => selectedEmails.delete(c.email));
    }
    renderTable();
  });
}

// ---- 발송 흐름 ---------------------------------------------------------------

// 현재 선택된 고객 목록 반환
function selectedCustomers() {
  return customers.filter((c) => selectedEmails.has(c.email));
}

// Send 버튼 → 유효성 검사 후 확인 모달 표시
function onSendClick() {
  if (isSending) return;
  const recipients = selectedCustomers();
  const subject = document.getElementById('compose-subject').value.trim();
  const message = document.getElementById('compose-message').value.trim();

  // 선택 0건이거나 제목/본문이 비어 있으면 무시
  if (recipients.length === 0 || !subject || !message) return;

  openSendConfirm(recipients.length);
}

function openSendConfirm(count) {
  document.getElementById('send-confirm-title').textContent = `Send to ${count} recipients?`;
  document.getElementById('send-confirm-message').innerHTML =
    `This message will be emailed to <span class="font-semibold text-slate-800">${count}</span> selected customer(s).`;
  document.getElementById('send-confirm-note').textContent =
    'Emails are sent one at a time. Please keep this tab open until it finishes.';
  const modal = document.getElementById('send-confirm-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeSendConfirm() {
  const modal = document.getElementById('send-confirm-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

// 확인 → 순차 발송 진행
async function confirmSend() {
  closeSendConfirm();
  const recipients = selectedCustomers();
  const subject = document.getElementById('compose-subject').value.trim();
  const message = document.getElementById('compose-message').value.trim();
  if (recipients.length === 0 || !subject || !message) return;

  isSending = true;
  const sendBtn = document.getElementById('send-btn');
  const progressEl = document.getElementById('send-progress');
  const bannerEl = document.getElementById('result-banner');
  sendBtn.disabled = true;
  bannerEl.classList.add('hidden');
  progressEl.classList.remove('hidden');

  const succeeded = [];
  const failed = []; // { email, error }

  for (let i = 0; i < recipients.length; i++) {
    const c = recipients[i];
    progressEl.textContent = `Sending ${i + 1} / ${recipients.length}… (${c.email})`;
    try {
      await sendCustomEmail(c.email, c.name, subject, message);
      succeeded.push(c.email);
    } catch (err) {
      console.error('[EmailJS] 커스텀 메일 발송 실패:', c.email, err);
      failed.push({ email: c.email, error: err });
    }
    // 각 발송 사이 400ms 대기 (마지막 건 뒤에는 대기 불필요)
    if (i < recipients.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  progressEl.classList.add('hidden');
  progressEl.textContent = '';
  sendBtn.disabled = false;
  isSending = false;
  renderResultBanner(succeeded, failed);
}

// 발송 결과를 인라인 배너에 렌더 (alert 사용 안 함)
function renderResultBanner(succeeded, failed) {
  const bannerEl = document.getElementById('result-banner');
  const okCount = succeeded.length;
  const failCount = failed.length;

  // 실패가 하나도 없으면 초록, 있으면 주황 톤
  bannerEl.className =
    failCount === 0
      ? 'mt-4 text-xs rounded-xl px-3 py-3 bg-green-50 text-green-700 ring-1 ring-green-100'
      : 'mt-4 text-xs rounded-xl px-3 py-3 bg-orange-50 text-orange-700 ring-1 ring-orange-100';

  let html = `<p class="font-semibold">${okCount} sent, ${failCount} failed</p>`;
  if (failCount > 0) {
    const list = failed
      .map((f) => `<li class="truncate">${escapeHtml(f.email)}</li>`)
      .join('');
    html += `<p class="mt-2 font-semibold">Failed recipients:</p><ul class="mt-1 list-disc list-inside space-y-0.5">${list}</ul>`;
  }
  bannerEl.innerHTML = html;
  bannerEl.classList.remove('hidden');
}

// ---- 전체 렌더 --------------------------------------------------------------

function renderAll() {
  renderTable();
}

// ---- 실시간 구독 ------------------------------------------------------------

function subscribeBookings() {
  const q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'), limit(200));
  onSnapshot(
    q,
    (snapshot) => {
      const bookings = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      customers = buildCustomers(bookings);
      // 목록에서 사라진 이메일은 선택 집합에서도 제거 (유효한 선택만 유지)
      pruneSelected();
      document.getElementById('loading-state').classList.add('hidden');
      renderAll();
    },
    (err) => {
      // placeholder config 상태에서는 여기로 빠짐 — 조용히 처리하고 빈 상태 표시
      console.error('[Firestore] 고객 구독 실패 (빈 상태로 표시):', err);
      document.getElementById('loading-state').classList.add('hidden');
      customers = [];
      pruneSelected();
      renderAll();
    }
  );
}

// 현재 고객 목록에 없는 이메일은 선택 집합에서 제거
function pruneSelected() {
  const emails = new Set(customers.map((c) => c.email));
  selectedEmails.forEach((email) => {
    if (!emails.has(email)) selectedEmails.delete(email);
  });
}

// ---- 부트스트랩 -------------------------------------------------------------

renderNav('customers.html');
bindSelectAll();
document.getElementById('send-btn').addEventListener('click', onSendClick);
document.getElementById('send-confirm-ok').addEventListener('click', confirmSend);
document.getElementById('send-confirm-cancel').addEventListener('click', closeSendConfirm);
document.getElementById('send-confirm-modal').addEventListener('click', (e) => {
  if (e.target.id === 'send-confirm-modal') closeSendConfirm();
});

if (new URLSearchParams(location.search).get('mock') === '1') {
  // 목업 모드 — 로그인 없이 테이블/선택/모달 동작 확인용
  // 주의: Send 버튼은 실제 EmailJS 호출을 그대로 실행하므로 테스트 시 발송에 유의할 것
  console.warn('[Customers] mock 모드 — Send 버튼은 실제 EmailJS 발송을 수행합니다.');
  initSidebarLogout();
  document.getElementById('loading-state').classList.add('hidden');
  customers = MOCK_CUSTOMERS;
  setUserEmail('mock@example.com');
  renderAll();
} else {
  initSidebarLogout();
  requireAuth((user) => {
    setUserEmail(user.email);
    subscribeBookings();
  });
}
