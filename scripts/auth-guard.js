// 인증 가드 — onAuthStateChanged 래퍼 + 리다이렉트
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { auth } from './firebase-config.js';

// 인증된 사용자가 확정될 때까지 콜백을 호출하지 않음.
// 미인증이면 로그인 페이지로 리다이렉트, 인증되면 onUser(user) 실행.
export function requireAuth(onUser) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      onUser(user);
    } else {
      // 미인증 방문 시 로그인 페이지로 이동 (예약 데이터를 렌더링하기 전에 차단)
      window.location.replace('index.html');
    }
  });
}

// 이미 로그인된 사용자가 로그인 페이지에 오면 대시보드로 보냄
export function redirectIfAuthenticated() {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      window.location.replace('dashboard.html');
    }
  });
}
