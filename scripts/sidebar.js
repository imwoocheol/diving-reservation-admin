// 사이드바 공용 로직 — 로그아웃(데스크톱/모바일 위임) + 사용자 이메일 표시
import { signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { auth } from './firebase-config.js';

export function initSidebarLogout() {
  const desktopBtn = document.getElementById('logout-btn');
  const mobileBtn = document.getElementById('logout-btn-mobile');
  if (desktopBtn) {
    desktopBtn.addEventListener('click', async () => {
      try {
        await signOut(auth);
        window.location.replace('index.html');
      } catch (err) {
        console.error('[Auth] 로그아웃 실패:', err);
      }
    });
  }
  if (mobileBtn && desktopBtn) {
    mobileBtn.addEventListener('click', () => desktopBtn.click());
  }
}

export function setUserEmail(email) {
  const el = document.getElementById('user-email');
  if (el) el.textContent = email || '';
}
