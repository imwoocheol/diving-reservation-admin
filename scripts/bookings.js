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
} from './booking-shared.js';
import { initSidebarLogout, setUserEmail } from './sidebar.js';

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
  tbody.querySelectorAll('.status-select').forEach((sel) => {
    sel.addEventListener('change', (e) => onStatusChange(e.target.dataset.id, e.target.value));
  });
  // 상세보기 이벤트 바인딩
  tbody.querySelectorAll('.detail-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => openDetail(e.target.dataset.detail));
  });
}

// ---- 상태 변경 write ---------------------------------------------------------

async function onStatusChange(id, status) {
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
  }
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
