// EmailJS 연동 — 예약 상태 변경(Booked/Cancelled) 시 고객에게 안내 메일 발송
// EmailJS SDK 는 bookings.html 에서 CDN 스크립트 태그로 로드되어 window.emailjs 전역으로 제공됨.
import {
  EMAILJS_PUBLIC_KEY,
  EMAILJS_SERVICE_ID,
  EMAILJS_TEMPLATE_BOOKED,
  EMAILJS_TEMPLATE_CANCELLED,
  EMAILJS_TEMPLATE_CUSTOM,
} from './email-config.js';
import { tripOrCourseOf } from './booking-shared.js';

// 상태별 사용할 템플릿 매핑
const TEMPLATE_BY_STATUS = {
  booked: EMAILJS_TEMPLATE_BOOKED,
  cancelled: EMAILJS_TEMPLATE_CANCELLED,
};

// 상태별 메일에 표시할 라벨
const STATUS_LABEL = {
  booked: 'Booked',
  cancelled: 'Cancelled',
};

// 최초 1회만 EmailJS init 하도록 플래그로 관리 (재호출 시 무시)
let initialized = false;
function ensureInit() {
  if (initialized) return;
  if (!window.emailjs) {
    throw new Error('EmailJS SDK 가 로드되지 않았습니다. CDN 스크립트 태그를 확인하세요.');
  }
  window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
  initialized = true;
}

// 예약 상태 변경 안내 메일 발송
// booking: 예약 객체, status: 'booked' | 'cancelled', toEmail: 수신 이메일 주소
// 발송 성공 시 EmailJS 응답을 resolve, 실패 시 reject → 호출부에서 try/catch 처리
export async function sendStatusEmail(booking, status, toEmail) {
  ensureInit();

  const templateId = TEMPLATE_BY_STATUS[status];
  if (!templateId) {
    throw new Error(`안내 메일을 지원하지 않는 상태입니다: ${status}`);
  }

  // 템플릿에서 사용할 변수들 — EmailJS 템플릿의 {{변수명}} 과 매칭됨
  const templateParams = {
    to_email: toEmail,
    to_name: booking.name || 'Guest',
    trip_or_course: tripOrCourseOf(booking),
    preferred_date: booking.date || 'TBD',
    status_label: STATUS_LABEL[status] || status,
    booking_id: booking.id || '',
  };

  return window.emailjs.send(EMAILJS_SERVICE_ID, templateId, templateParams);
}

// 고객 대상 커스텀 메일 발송 (Customers 페이지에서 관리자가 직접 제목/본문 작성)
// toEmail: 수신 이메일, toName: 수신자 이름, subject: 제목, message: 본문
// 발송 성공 시 EmailJS 응답을 resolve, 실패 시 reject → 호출부에서 try/catch 처리
export async function sendCustomEmail(toEmail, toName, subject, message) {
  ensureInit();

  // 템플릿에서 사용할 변수들 — EmailJS 템플릿의 {{변수명}} 과 매칭됨
  const templateParams = {
    to_email: toEmail,
    to_name: toName || 'Guest',
    subject,
    message,
  };

  return window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_CUSTOM, templateParams);
}
