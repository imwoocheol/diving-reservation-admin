// 로그인 페이지 로직 — Firebase Auth 이메일/비밀번호 로그인
import { signInWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { auth } from './firebase-config.js';
import { redirectIfAuthenticated } from './auth-guard.js';

// 이미 로그인된 상태면 바로 대시보드로 이동
redirectIfAuthenticated();

const form = document.getElementById('login-form');
const emailInput = document.getElementById('login-email');
const passwordInput = document.getElementById('login-password');
const errorBox = document.getElementById('login-error');
const submitBtn = document.getElementById('login-submit');

// 에러 메시지 표시 유틸
function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function hideError() {
  errorBox.classList.add('hidden');
}

// 브라우저 기본 검증 말풍선("이 입력란을 작성하세요.")은 OS/브라우저 언어를 따르므로
// 영어 메시지를 직접 지정한다
function forceEnglishValidation(input, messages) {
  const applyMessage = () => {
    // 커스텀 메시지를 먼저 비워야 브라우저가 실제 validity 를 다시 계산한다
    input.setCustomValidity('');
    if (input.validity.valid) return;

    let message = 'Please enter a valid value.';
    if (input.validity.valueMissing && messages.valueMissing) {
      message = messages.valueMissing;
    } else if (input.validity.typeMismatch && messages.typeMismatch) {
      message = messages.typeMismatch;
    }
    input.setCustomValidity(message);
  };

  input.addEventListener('invalid', applyMessage);
  // 사용자가 값을 고치면 커스텀 에러를 해제해 다시 제출할 수 있게 한다
  input.addEventListener('input', () => input.setCustomValidity(''));
}

forceEnglishValidation(emailInput, {
  valueMissing: 'Please enter your email address.',
  typeMismatch: 'Please enter a valid email address.',
});
forceEnglishValidation(passwordInput, {
  valueMissing: 'Please enter your password.',
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showError('Please enter your email and password.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in...';

  try {
    await signInWithEmailAndPassword(auth, email, password);
    // 성공 시 onAuthStateChanged(redirectIfAuthenticated)가 대시보드로 이동시킴
    window.location.replace('dashboard.html');
  } catch (err) {
    console.error('[Auth] 로그인 실패:', err);
    // Firebase 에러 코드를 사용자 친화적 메시지로 변환
    const code = err && err.code ? err.code : '';
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      showError('Incorrect email or password.');
    } else if (code === 'auth/invalid-email') {
      showError('That doesn\'t look like a valid email address.');
    } else if (code === 'auth/too-many-requests') {
      showError('Too many attempts. Please try again in a moment.');
    } else {
      showError('Sign-in failed. Please check the setup and try again.');
    }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
});
