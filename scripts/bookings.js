// 예약 관리 페이지 로직 — 실시간 예약 조회 + 상태 필터 탭 + 테이블 렌더 + 상태 변경 write
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './firebase-config.js';
import { requireAuth } from './auth-guard.js';
import {
  STATUS_META,
  STATUS_ORDER,
  toDate,
  initials,
  avatarColor,
  contactOf,
  tripOrCourseOf,
  escapeHtml,
  resolveEmailAddress,
} from './booking-shared.js';
import { initSidebarLogout, setUserEmail } from './sidebar.js';
import { sendStatusEmail } from './email.js';

// 확인 팝업이 필요한 상태 (이메일 안내 발송 대상)
const CONFIRM_STATUSES = ['booked', 'cancelled'];

// 확인 모달에서 처리 대기 중인 상태 변경 정보 (취소 시 select 되돌리기용)
let pendingStatusChange = null;

// ---- 상태 저장소 ------------------------------------------------------------

let bookings = []; // 최신 스냅샷 (모든 렌더링이 이 배열에서 파생)
let currentUser = null;
let currentFilter = 'total'; // 활성 필터 탭 (total | pending | booked | call_back | cancelled)

// 목업 데이터 (로그인 없이 필터 탭/테이블/모달 동작 확인용, ?mock=1)
const MOCK_BOOKINGS = [
  { id: 'mock001', name: 'Jane Doe', source: 'hero', trip: 'Amed', phone: '+62 811 2222 3333', date: '2026-08-01', status: 'pending', message: '초보자용 리조트 다이빙 문의', createdAt: { toDate: () => new Date() } },
  { id: 'mock002', name: 'Kim Minsu', source: 'booking_section', course: 'Open Water', contact: 'minsu@test.com', date: '2026-08-03', status: 'booked', message: '주말 오전 코스 희망', createdAt: { toDate: () => new Date() } },
  { id: 'mock003', name: 'Sarah Lee', source: 'hero', trip: 'Nusa Penida', phone: '+62 811 4444 5555', date: '2026-08-05', status: 'call_back', message: '가격 문의 후 재통화 요청', createdAt: { toDate: () => new Date() } },
  { id: 'mock004', name: 'John Park', source: 'hero', trip: 'Tulamben', phone: '+62 811 6666 7777', date: '2026-08-02', status: 'cancelled', message: '일정 변경으로 취소', createdAt: { toDate: () => new Date() } },
  { id: 'mock005', name: 'Yuki Tanaka', source: 'booking_section', course: 'Advanced', contact: 'yuki@test.com', date: '2026-08-07', status: 'pending', message: '', createdAt: { toDate: () => new Date() } },
  // 검증 케이스 A: hero source + 유효한 email 필드 → 안내 메일 발송 대상
  { id: 'mock006', name: 'Emma Wilson', source: 'hero', trip: 'Sanur', phone: '+62 811 8888 9999', email: 'emma.wilson@example.com', date: '2026-08-09', status: 'pending', message: '가족 다이빙 패키지 문의', createdAt: { toDate: () => new Date() } },
  // 검증 케이스 B: hero source + email 없음("-") → 이메일 없음, 상태만 변경
  { id: 'mock007', name: 'Chris Brown', source: 'hero', trip: 'Padang Bai', phone: '+62 811 1010 2020', email: '-', date: '2026-08-10', status: 'pending', message: '전화 상담만 희망', createdAt: { toDate: () => new Date() } },
  // 검증 케이스 C: booking_section + contact 가 전화번호 형식 → 이메일 아님, 상태만 변경
  { id: 'mock008', name: 'Olivia Martin', source: 'booking_section', course: 'Rescue Diver', contact: '+62 812 3434 5656', date: '2026-08-11', status: 'pending', message: '레스큐 코스 일정 문의', createdAt: { toDate: () => new Date() } },
];

// ---- 필터링 ------------------------------------------------------------------

function filteredBookings() {
  if (currentFilter === 'total') return bookings;
  return bookings.filter((b) => b.status === currentFilter);
}

// ---- 렌더링: 필터 탭 카운트 --------------------------------------------------

function renderTabs() {
  const counts = { total: bookings.length };
  STATUS_ORDER.forEach((s) => {
    counts[s] = bookings.filter((b) => b.status === s).length;
  });

  document.querySelectorAll('#status-tabs .filter-tab').forEach((tab) => {
    const key = tab.dataset.filter;
    const countEl = tab.querySelector('.filter-tab-count');
    if (countEl) countEl.textContent = counts[key] != null ? counts[key] : 0;
    tab.classList.toggle('active', key === currentFilter);
  });
}

// ---- 렌더링: 테이블 ----------------------------------------------------------

function renderTable() {
  const tbody = document.getElementById('bookings-tbody');
  const emptyRow = document.getElementById('table-empty');
  const rows = filteredBookings();

  if (rows.length === 0) {
    tbody.innerHTML = '';
    emptyRow.classList.remove('hidden');
    return;
  }
  emptyRow.classList.add('hidden');

  tbody.innerHTML = rows
    .map((b) => {
      const d = toDate(b.createdAt);
      const created = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
      const preferredDate = b.date || 'TBD';
      const name = b.name || 'Unknown';
      const options = STATUS_ORDER.map(
        (s) =>
          `<option value="${s}"${b.status === s ? ' selected' : ''}>${STATUS_META[s].label}</option>`
      ).join('');
      const meta = STATUS_META[b.status] || STATUS_META.pending;

      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50/70 transition-colors">
          <td class="px-4 py-3 text-xs font-mono text-slate-400 whitespace-nowrap">#${escapeHtml(b.id.slice(0, 6))}</td>
          <td class="px-4 py-3">
            <div class="flex items-center gap-3">
              <span class="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style="background:${avatarColor(name)}">${escapeHtml(initials(name))}</span>
              <div class="min-w-0">
                <p class="font-semibold text-slate-800 text-sm truncate">${escapeHtml(name)}</p>
                <p class="text-xs text-slate-400">${escapeHtml(created)}</p>
              </div>
            </div>
          </td>
          <td class="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">${escapeHtml(contactOf(b))}</td>
          <td class="px-4 py-3 text-sm text-slate-600">${escapeHtml(tripOrCourseOf(b))}</td>
          <td class="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">${escapeHtml(preferredDate)}</td>
          <td class="px-4 py-3">
            <div class="inline-flex items-center gap-2">
              <span class="inline-block w-2 h-2 rounded-full ${meta.pill.split(' ')[0]}"></span>
              <select data-id="${escapeHtml(b.id)}" class="status-select text-xs font-semibold rounded-full px-3 py-1 ring-1 cursor-pointer focus:outline-none ${meta.pill}">
                ${options}
              </select>
            </div>
          </td>
          <td class="px-4 py-3 text-right">
            <button data-detail="${escapeHtml(b.id)}" class="detail-btn text-xs font-semibold text-cyan-600 hover:text-cyan-800">View</button>
          </td>
        </tr>`;
    })
    .join('');

  // 상태 변경 이벤트 바인딩
  // Booked / Cancelled 로 바꾸면 확인 모달을 띄우고(고객 안내 메일 발송), 그 외 상태는 즉시 변경.
  tbody.querySelectorAll('.status-select').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      const status = e.target.value;
      if (CONFIRM_STATUSES.includes(status)) {
        openStatusConfirm(id, status, e.target);
      } else {
        onStatusChange(id, status);
      }
    });
  });
  // 상세보기 이벤트 바인딩
  tbody.querySelectorAll('.detail-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => openDetail(e.target.dataset.detail));
  });
}

// ---- 상태 변경 write ---------------------------------------------------------

// 상태 변경을 Firestore 에 기록하고, Booked/Cancelled 이며 유효한 수신 이메일이 있으면 안내 메일을 발송.
// toEmail 은 확인 모달에서 미리 계산해 전달 (없으면 메일 발송 생략).
async function onStatusChange(id, status, toEmail) {
  const booking = bookings.find((x) => x.id === id) || null;

  try {
    await updateDoc(doc(db, 'bookings', id), {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: currentUser ? currentUser.email : 'unknown',
    });
    // onSnapshot이 자동으로 화면을 갱신하므로 별도 로컬 갱신 불필요
  } catch (err) {
    console.error('[Firestore] 상태 변경 실패:', err);
    alert('Failed to update status. Please check your permissions or network connection.');
    return; // 상태 변경 자체가 실패하면 이메일도 보내지 않음
  }

  // 안내 메일 발송 (Booked/Cancelled 이며 유효한 수신 이메일이 있을 때만)
  if (booking && CONFIRM_STATUSES.includes(status) && toEmail) {
    try {
      await sendStatusEmail(booking, status, toEmail);
      // 발송 성공 → 발송 시각/수신 주소 기록 (감사 로그 용도)
      await updateDoc(doc(db, 'bookings', id), {
        emailSentAt: serverTimestamp(),
        emailSentTo: toEmail,
      });
    } catch (err) {
      // 이메일 발송 실패 시에도 상태 변경은 유지하고 안내만 함
      console.error('[EmailJS] 안내 메일 발송 실패:', err);
      alert('Status updated, but the notification email could not be sent.');
    }
  }
}

// ---- 상태 변경 확인 모달 -----------------------------------------------------

// Booked/Cancelled 로 변경 시 확인 팝업을 띄움. 수신 이메일 유무를 함께 안내.
function openStatusConfirm(id, status, selectEl) {
  const b = bookings.find((x) => x.id === id);
  if (!b) return;

  const prevStatus = b.status;
  const toEmail = resolveEmailAddress(b);
  pendingStatusChange = { id, status, selectEl, prevStatus, toEmail };

  const statusLabel = (STATUS_META[status] || STATUS_META.pending).label;
  const guest = b.name || 'this guest';

  const titleEl = document.getElementById('status-confirm-title');
  const messageEl = document.getElementById('status-confirm-message');
  const emailEl = document.getElementById('status-confirm-email');

  titleEl.textContent = `Change status to ${statusLabel}?`;
  messageEl.innerHTML = `Set <span class="font-semibold text-slate-800">${escapeHtml(guest)}</span>'s booking to <span class="font-semibold text-slate-800">${escapeHtml(statusLabel)}</span>.`;

  if (toEmail) {
    // 안내 메일 발송 예정 — 초록 톤
    emailEl.className = 'mt-3 text-xs rounded-xl px-3 py-2 bg-green-50 text-green-700 ring-1 ring-green-100';
    emailEl.innerHTML = `A ${escapeHtml(statusLabel)} notification email will be sent to <span class="font-semibold">${escapeHtml(toEmail)}</span>.`;
  } else {
    // 유효한 이메일 없음 — 상태만 변경, 주황 톤
    emailEl.className = 'mt-3 text-xs rounded-xl px-3 py-2 bg-orange-50 text-orange-700 ring-1 ring-orange-100';
    emailEl.textContent = 'No valid email on file — the status will change without sending an email.';
  }

  const modal = document.getElementById('status-confirm-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

// 확인 모달 닫기. revert=true 이면 드롭다운 값을 원래 상태로 되돌림(취소한 경우).
function closeStatusConfirm(revert) {
  if (revert && pendingStatusChange && pendingStatusChange.selectEl) {
    pendingStatusChange.selectEl.value = pendingStatusChange.prevStatus;
  }
  const modal = document.getElementById('status-confirm-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  pendingStatusChange = null;
}

// 확인 버튼 → 상태 변경 + 이메일 발송 진행
function confirmStatusChange() {
  if (!pendingStatusChange) return;
  const { id, status, toEmail } = pendingStatusChange;
  // 모달은 즉시 닫되 select 값은 유지(변경 확정 상태)
  closeStatusConfirm(false);
  onStatusChange(id, status, toEmail);
}

// ---- 상세보기 모달 -----------------------------------------------------------

function openDetail(id) {
  // 필터링된 목록이 아니라 전체 bookings에서 찾음
  const b = bookings.find((x) => x.id === id);
  if (!b) return;
  const modal = document.getElementById('detail-modal');
  const body = document.getElementById('detail-body');
  const d = toDate(b.createdAt);
  const rows = [
    ['Booking ID', b.id],
    ['Source', b.source === 'hero' ? 'Hero form' : 'Booking section'],
    ['Guest', b.name || '-'],
    ['Contact', contactOf(b)],
    ['Trip / Course', tripOrCourseOf(b)],
    ['Preferred Date', b.date || 'TBD'],
    ['Channel', b.channel || '-'],
    ['Status', (STATUS_META[b.status] || STATUS_META.pending).label],
    ['Received', d ? d.toLocaleString() : '—'],
  ];
  body.innerHTML =
    rows
      .map(
        ([k, v]) =>
          `<div class="flex justify-between gap-4 py-2 border-b border-slate-100"><span class="text-xs font-semibold text-slate-400 uppercase tracking-wide">${escapeHtml(k)}</span><span class="text-sm text-slate-700 text-right">${escapeHtml(v)}</span></div>`
      )
      .join('') +
    `<div class="mt-4"><p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Message</p><pre class="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-xl p-3 border border-slate-100">${escapeHtml(b.message || '-')}</pre></div>`;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeDetail() {
  const modal = document.getElementById('detail-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

// ---- 전체 렌더 --------------------------------------------------------------

function renderAll() {
  renderTabs();
  renderTable();
}

// ---- 실시간 구독 ------------------------------------------------------------

function subscribeBookings() {
  const q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'), limit(200));
  onSnapshot(
    q,
    (snapshot) => {
      bookings = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      document.getElementById('loading-state').classList.add('hidden');
      renderAll();
    },
    (err) => {
      // placeholder config 상태에서는 여기로 빠짐 — 조용히 처리하고 빈 상태 표시
      console.error('[Firestore] 예약 구독 실패 (빈 상태로 표시):', err);
      document.getElementById('loading-state').classList.add('hidden');
      bookings = [];
      renderAll();
    }
  );
}

// ---- 필터 탭 바인딩 ----------------------------------------------------------

function bindTabs() {
  document.querySelectorAll('#status-tabs .filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      currentFilter = tab.dataset.filter;
      renderAll(); // Firestore 재구독 없이 로컬 재렌더만
    });
  });
}

// ---- 부트스트랩 -------------------------------------------------------------

bindTabs();
document.getElementById('detail-close').addEventListener('click', closeDetail);
document.getElementById('detail-modal').addEventListener('click', (e) => {
  if (e.target.id === 'detail-modal') closeDetail();
});

// 상태 변경 확인 모달 바인딩 (취소/배경 클릭 시 드롭다운 값 원복)
document.getElementById('status-confirm-ok').addEventListener('click', confirmStatusChange);
document.getElementById('status-confirm-cancel').addEventListener('click', () => closeStatusConfirm(true));
document.getElementById('status-confirm-modal').addEventListener('click', (e) => {
  if (e.target.id === 'status-confirm-modal') closeStatusConfirm(true);
});

if (new URLSearchParams(location.search).get('mock') === '1') {
  // 목업 모드 — 로그인 없이 필터 탭/테이블/모달 동작 확인용 (배포 정상 동작에는 영향 없음)
  initSidebarLogout(); // 로그아웃 버튼 눌러도 에러 없이 처리되도록 함께 바인딩
  document.getElementById('loading-state').classList.add('hidden');
  bookings = MOCK_BOOKINGS;
  currentUser = { email: 'mock@example.com' };
  setUserEmail(currentUser.email);
  renderAll();
} else {
  initSidebarLogout();
  requireAuth((user) => {
    currentUser = user;
    setUserEmail(user.email);
    subscribeBookings();
  });
}
