// EmailJS 설정값 — 실제 계정에서 발급받은 키로 교체 필요
// (EmailJS 대시보드: https://dashboard.emailjs.com/ 에서 확인)
//
// ⚠️ 아래 값은 모두 플레이스홀더입니다. 실제 발송을 하려면 본인 계정의
//    Public Key / Service ID / Template ID 로 바꿔주세요.

// Account > General 의 Public Key
export const EMAILJS_PUBLIC_KEY = 'exHKlwp_nWCEsKtiT';

// Email Services 에서 연결한 서비스의 Service ID (예: service_xxxxxxx)
export const EMAILJS_SERVICE_ID = 'service_kopom2y';

// 예약 확정(Booked) 안내 메일 템플릿 ID (예: template_xxxxxxx)
export const EMAILJS_TEMPLATE_BOOKED = 'template_zhery99';

// 예약 취소(Cancelled) 안내 메일 템플릿 ID (예: template_xxxxxxx)
export const EMAILJS_TEMPLATE_CANCELLED = 'template_7c0fzue';

// 고객 대상 커스텀 메일(관리자가 직접 제목/본문 작성) 템플릿 ID (예: template_xxxxxxx)
export const EMAILJS_TEMPLATE_CUSTOM = 'YOUR_EMAILJS_TEMPLATE_CUSTOM';
