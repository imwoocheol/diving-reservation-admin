// Firebase 초기화 및 auth/db 싱글턴 export
// CDN 모듈 임포트만 사용 (빌드 단계 없음 — 워크스페이스 관례 유지)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// 예약 사이트(index.html)와 동일한 Firebase 프로젝트를 가리킴
const firebaseConfig = {
  apiKey: "AIzaSyDLaqesPTF7FdM5z1qBa7rymAZr0EMucV8",
  authDomain: "diving-booking-b69f7.firebaseapp.com",
  projectId: "diving-booking-b69f7",
  storageBucket: "diving-booking-b69f7.firebasestorage.app",
  messagingSenderId: "423210595527",
  appId: "1:423210595527:web:429a5883d28eb51b25bae2",
};

// placeholder config 이므로 초기화가 실패할 수 있음 — 호출부에서 처리
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
