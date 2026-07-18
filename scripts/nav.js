// 사이드바/모바일 네비게이션 공용 렌더러 — 모든 어드민 페이지가 동일 메뉴를 공유
// 데스크톱은 #sidebar-nav, 모바일은 #mobile-nav 컨테이너에 마크업을 주입한다.

// 네비게이션 항목 정의 (아이콘은 기존 관례 ▦ ▤ 를 따르고, 신규는 ✉ ◈ 사용)
export const NAV_ITEMS = [
  { href: 'dashboard.html', label: 'Dashboard', icon: '▦' },
  { href: 'bookings.html', label: 'Bookings', icon: '▤' },
  { href: 'customers.html', label: 'Customers', icon: '✉' },
  { href: 'popup.html', label: 'Popup', icon: '◈' },
];

// activeHref 에 해당하는 항목만 active 클래스를 붙여 두 컨테이너에 렌더
export function renderNav(activeHref) {
  const desktop = document.getElementById('sidebar-nav');
  const mobile = document.getElementById('mobile-nav');

  if (desktop) {
    desktop.innerHTML = NAV_ITEMS.map((item) => {
      const active = item.href === activeHref ? ' active' : '';
      return `<a href="${item.href}" class="side-link${active}"><span>${item.icon}</span> ${item.label}</a>`;
    }).join('');
  }

  if (mobile) {
    mobile.innerHTML = NAV_ITEMS.map((item) => {
      const active = item.href === activeHref ? ' active' : '';
      return `<a href="${item.href}" class="mobile-nav-link${active}">${item.label}</a>`;
    }).join('');
  }
}
