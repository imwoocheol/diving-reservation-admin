// 대시보드 로직 — 실시간 예약 조회 + 통계/차트 렌더링 (홈 화면)
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { db } from './firebase-config.js';
import { requireAuth } from './auth-guard.js';
import { CATEGORY_COLORS, TRIP_LABELS, toDate, isSameMonth, categoryOf } from './booking-shared.js';
import { initSidebarLogout, setUserEmail } from './sidebar.js';
import { renderNav } from './nav.js';

// ---- 상태 저장소 ------------------------------------------------------------

let bookings = []; // 최신 스냅샷 (모든 렌더링이 이 배열에서 파생)
let barChart = null;
let doughnutChart = null;

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

// 도넛 조각 위에 퍼센트를 직접 그리는 커스텀 플러그인 (별도 라이브러리 없이 canvas API로 구현)
const donutPercentagePlugin = {
  id: 'donutPercentageLabels',
  afterDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    const data = chart.data.datasets[0].data;
    const total = data.reduce((sum, v) => sum + v, 0);
    if (total <= 0) return;

    const { ctx } = chart;
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    meta.data.forEach((arc, i) => {
      const value = data[i];
      if (!value) return; // 값이 0인 조각은 라벨 생략
      const pct = Math.round((value / total) * 100);
      if (pct < 5) return; // 너무 얇은 조각은 라벨이 겹치므로 생략
      const { x, y } = arc.getCenterPoint();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)'; // 어떤 배경색 위에서도 읽히도록 외곽선 처리
      ctx.strokeText(`${pct}%`, x, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${pct}%`, x, y);
    });
    ctx.restore();
  },
};

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
    plugins: [donutPercentagePlugin],
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

// ---- 전체 렌더 --------------------------------------------------------------

function renderAll() {
  renderStats();
  renderCharts();
}

// ---- 실시간 구독 ------------------------------------------------------------

function subscribeBookings() {
  const q = query(collection(db, 'bookings'), orderBy('createdAt', 'desc'), limit(200));
  onSnapshot(
    q,
    (snapshot) => {
      bookings = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderAll();
    },
    (err) => {
      // placeholder config 상태에서는 여기로 빠짐 — 조용히 처리하고 빈 상태 표시
      console.error('[Firestore] 예약 구독 실패 (빈 상태로 표시):', err);
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

renderNav('dashboard.html');
initSidebarLogout();

// 인증 확정 후에만 데이터/차트 렌더 (미인증이면 requireAuth가 로그인으로 리다이렉트)
requireAuth((user) => {
  setUserEmail(user.email);
  initGreeting(user);
  initCharts();
  subscribeBookings();
});
