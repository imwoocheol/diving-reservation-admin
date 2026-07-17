// 대시보드 로직 — 실시간 예약 조회 + 통계/차트/테이블 렌더링 + 상태 변경 write
import { signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
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
import { auth, db } from './firebase-config.js';
import { requireAuth } from './auth-guard.js';

// ---- 상수 정의 --------------------------------------------------------------

// 다이빙 트립 7개 + course 문의 버킷 1개 (도넛 차트 카테고리 순서 고정)
const TRIP_LABELS = [
  'Nusa Penida',
  'Tulamben',
  'Padang Bai',
  'Tepekong & Mimpang',
  'Amed',
  'Sanur',
  'Night Dive (Tulamben)',
  'Course Inquiry',
];

// 검증된 categorical 팔레트 (dataviz 스킬 기준, 8개 슬롯 — 인접 CVD ΔE≥12 통과)
const CATEGORY_COLORS = [
  '#2a78d6', // blue
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
  '#e87ba4', // magenta
  '#eb6834', // orange
];

// 상태 → 색상 매핑 (plan 확정값: Booked=초록/Pending=주황/Call Back=보라/Cancelled=빨강)
const STATUS_META = {
  pending: { label: 'Pending', pill: 'bg-orange-100 text-orange-700 ring-orange-200' },
  booked: { label: 'Booked', pill: 'bg-green-100 text-green-700 ring-green-200' },
  call_back: { label: 'Call Back', pill: 'bg-purple-100 text-purple-700 ring-purple-200' },
  cancelled: { label: 'Cancelled', pill: 'bg-red-100 text-red-700 ring-red-200' },
};
const STATUS_ORDER = ['pending', 'booked', 'call_back', 'cancelled'];

// ---- 상태 저장소 ------------------------------------------------------------

let bookings = []; // 최신 스냅샷 (모든 렌더링이 이 배열에서 파생)
let currentUser = null;
let barChart = null;
let doughnutChart = null;

// ---- 유틸 -------------------------------------------------------------------

// Firestore Timestamp → JS Date (serverTimestamp 반영 전이면 null 가능)
function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return null;
}

function isSameMonth(date, ref) {
  return date && date.getFullYear() === ref.getFullYear() && date.getMonth() === ref.getMonth();
}

// 이름 이니셜 기반 아바타 텍스트
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0].toUpperCase()).join('');
}

// 이름 문자열 → 안정적인 아바타 배경색 (categorical 팔레트에서 선택)
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
}

// 예약 1건 → 통합 Contact 표시 (plan: 전화/이메일 분리 없이 한 컬럼)
function contactOf(b) {
  if (b.source === 'hero') {
    return b.phone || b.email || '-';
  }
  return b.contact || '-';
}

// 예약 1건 → Trip/Course 표시
function tripOrCourseOf(b) {
  if (b.source === 'hero') return b.trip || '-';
  return b.course || '-';
}

// 예약 1건 → 도넛 차트 카테고리
function categoryOf(b) {
  if (b.source === 'booking_section') return 'Course Inquiry';
  return TRIP_LABELS.includes(b.trip) ? b.trip : 'Course Inquiry';
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- 렌더링: 통계 카드 -------------------------------------------------------

function renderStats() {
  const now = new Date();
  const total = bookings.length;
  const pending = bookings.filter((b) => b.status === 'pending').length;
  const bookedThisMonth = bookings.filter(
    (b) => b.status === 'booked' && isSameMonth(toDate(b.createdAt), now)
  ).length;
  const cancelled = bookings.filter((b) => b.status === 'cancelled').length;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-booked-month').textContent = bookedThisMonth;
  document.getElementById('stat-cancelled').textContent = cancelled;
}

// ---- 렌더링: 차트 -----------------------------------------------------------

// 최근 6개월 라벨 + 카운트 계산
function monthlyBuckets() {
  const now = new Date();
  const labels = [];
  const counts = [];
  const keys = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${d.getMonth()}`);
    labels.push(d.toLocaleString('en-US', { month: 'short' }));
    counts.push(0);
  }
  bookings.forEach((b) => {
    const d = toDate(b.createdAt);
    if (!d) return;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const idx = keys.indexOf(key);
    if (idx !== -1) counts[idx] += 1;
  });
  return { labels, counts };
}

function categoryBuckets() {
  const counts = TRIP_LABELS.map(() => 0);
  bookings.forEach((b) => {
    const idx = TRIP_LABELS.indexOf(categoryOf(b));
    if (idx !== -1) counts[idx] += 1;
  });
  return counts;
}

function initCharts() {
  if (!window.Chart) {
    console.error('[Chart] Chart.js 로드 실패 — 차트 비활성화');
    return;
  }
  const barCtx = document.getElementById('bar-chart');
  const doughnutCtx = document.getElementById('doughnut-chart');

  barChart = new window.Chart(barCtx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Bookings',
          data: [],
          backgroundColor: '#0891b2', // 브랜드 cyan (단일 시리즈)
          borderRadius: 6,
          maxBarThickness: 42,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } }, // 단일 시리즈 → 범례 불필요
      scales: {
        y: {
          beginAtZero: true,
          ticks: { precision: 0, color: '#64748b' },
          grid: { color: '#e2e8f0' },
        },
        x: { ticks: { color: '#64748b' }, grid: { display: false } },
      },
    },
  });

  doughnutChart = new window.Chart(doughnutCtx, {
    type: 'doughnut',
    data: {
      labels: TRIP_LABELS,
      datasets: [
        {
          data: TRIP_LABELS.map(() => 0),
          backgroundColor: CATEGORY_COLORS,
          borderColor: '#ffffff',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#475569',
            boxWidth: 12,
            font: { size: 11 },
            // 범례 라벨에 실제 데이터 기준 퍼센트를 함께 표시
            generateLabels: (chart) => {
              const data = chart.data.datasets[0].data;
              const total = data.reduce((sum, v) => sum + v, 0);
              return chart.data.labels.map((label, i) => {
                const value = data[i];
                const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                return {
                  text: `${label} (${pct}%)`,
                  fillStyle: CATEGORY_COLORS[i],
                  strokeStyle: '#ffffff',
                  lineWidth: 2,
                  hidden: false,
                  index: i,
                };
              });
            },
          },
        },
        tooltip: {
          callbacks: {
            // 툴팁에도 건수와 함께 퍼센트 표시
            label: (context) => {
              const data = context.dataset.data;
              const total = data.reduce((sum, v) => sum + v, 0);
              const value = context.parsed;
              const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
              return `${context.label}: ${value}건 (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function renderCharts() {
  if (!barChart || !doughnutChart) return;
  const { labels, counts } = monthlyBuckets();
  barChart.data.labels = labels;
  barChart.data.datasets[0].data = counts;
  barChart.update();

  doughnutChart.data.datasets[0].data = categoryBuckets();
  doughnutChart.update();

  // 데이터가 전혀 없을 때 도넛 위 안내 표시
  const empty = bookings.length === 0;
  document.getElementById('doughnut-empty').classList.toggle('hidden', !empty);
}

// ---- 렌더링: 테이블 ----------------------------------------------------------

function renderTable() {
  const tbody = document.getElementById('bookings-tbody');
  const emptyRow = document.getElementById('table-empty');

  if (bookings.length === 0) {
    tbody.innerHTML = '';
    emptyRow.classList.remove('hidden');
    return;
  }
  emptyRow.classList.add('hidden');

  tbody.innerHTML = bookings
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
  renderStats();
  renderCharts();
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

// ---- 부트스트랩 -------------------------------------------------------------

function initGreeting(user) {
  const hour = new Date().getHours();
  let greeting = 'Good evening';
  if (hour < 12) greeting = 'Good morning';
  else if (hour < 18) greeting = 'Good afternoon';
  const nameFromEmail = user.email ? user.email.split('@')[0] : 'Admin';
  document.getElementById('greeting-title').textContent = `${greeting}, ${nameFromEmail}`;
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  document.getElementById('greeting-date').textContent = today;
}

// 인증 확정 후에만 데이터/차트 렌더 (미인증이면 requireAuth가 로그인으로 리다이렉트)
requireAuth((user) => {
  currentUser = user;
  document.getElementById('user-email').textContent = user.email || '';
  initGreeting(user);
  initCharts();
  subscribeBookings();
});

// 로그아웃
document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await signOut(auth);
    window.location.replace('index.html');
  } catch (err) {
    console.error('[Auth] 로그아웃 실패:', err);
  }
});

// 모달 닫기 바인딩
document.getElementById('detail-close').addEventListener('click', closeDetail);
document.getElementById('detail-modal').addEventListener('click', (e) => {
  if (e.target.id === 'detail-modal') closeDetail();
});
