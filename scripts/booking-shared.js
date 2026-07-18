// 예약 데이터 공용 상수/유틸 — Firebase import 없음 (dashboard.js / bookings.js 공유)

// ---- 상수 정의 --------------------------------------------------------------

// 다이빙 트립 7개 + course 문의 버킷 1개 (도넛 차트 카테고리 순서 고정)
export const TRIP_LABELS = [
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
export const CATEGORY_COLORS = [
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
export const STATUS_META = {
  pending: { label: 'Pending', pill: 'bg-orange-100 text-orange-700 ring-orange-200' },
  booked: { label: 'Booked', pill: 'bg-green-100 text-green-700 ring-green-200' },
  call_back: { label: 'Call Back', pill: 'bg-purple-100 text-purple-700 ring-purple-200' },
  cancelled: { label: 'Cancelled', pill: 'bg-red-100 text-red-700 ring-red-200' },
};
export const STATUS_ORDER = ['pending', 'booked', 'call_back', 'cancelled'];

// ---- 유틸 -------------------------------------------------------------------

// Firestore Timestamp → JS Date (serverTimestamp 반영 전이면 null 가능)
export function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return null;
}

export function isSameMonth(date, ref) {
  return date && date.getFullYear() === ref.getFullYear() && date.getMonth() === ref.getMonth();
}

// 이름 이니셜 기반 아바타 텍스트
export function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0].toUpperCase()).join('');
}

// 이름 문자열 → 안정적인 아바타 배경색 (categorical 팔레트에서 선택)
export function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  return CATEGORY_COLORS[Math.abs(hash) % CATEGORY_COLORS.length];
}

// 예약 1건 → 통합 Contact 표시 (plan: 전화/이메일 분리 없이 한 컬럼)
export function contactOf(b) {
  if (b.source === 'hero') {
    return b.phone || b.email || '-';
  }
  return b.contact || '-';
}

// 예약 1건 → Trip/Course 표시
export function tripOrCourseOf(b) {
  if (b.source === 'hero') return b.trip || '-';
  return b.course || '-';
}

// 예약 1건 → 도넛 차트 카테고리
export function categoryOf(b) {
  if (b.source === 'booking_section') return 'Course Inquiry';
  return TRIP_LABELS.includes(b.trip) ? b.trip : 'Course Inquiry';
}

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
