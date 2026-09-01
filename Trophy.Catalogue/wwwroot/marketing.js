if (location.hash.startsWith('#trophy/') || location.hash === '#catalogue' || location.hash === '#signup') {
  location.replace('/archive.html' + location.hash);
}

document.addEventListener('DOMContentLoaded', () => {
  const headerLogin = document.querySelector('.header-login');
  if (headerLogin) {
    headerLogin.href = '/archive.html#login';
    headerLogin.textContent = 'Sign in';
  }

  const primary = document.querySelector('.primary-cta');
  if (primary) {
    primary.href = '/archive.html#signup';
    primary.innerHTML = 'Create your club archive <span>→</span>';
  }

  const heroEyebrow = document.querySelector('.marketing-hero .marketing-eyebrow');
  if (heroEyebrow) heroEyebrow.textContent = 'Club accounts are now open';
  const assurances = document.querySelectorAll('.hero-assurances li');
  if (assurances[0]) assurances[0].textContent = 'Create your account in under a minute';
  if (assurances[1]) assurances[1].textContent = 'Add your club identity and logo';
  if (assurances[2]) assurances[2].textContent = 'Keep every club collection separate';

  document.querySelectorAll('.price-card a').forEach((link, index) => {
    link.href = '/archive.html#signup';
    link.textContent = index === 0 ? 'Create free account' : 'Create club account';
  });

  const final = document.querySelector('.final-cta');
  if (final) {
    final.querySelector('.marketing-eyebrow').textContent = 'Start your club archive';
    final.querySelector('h2').textContent = 'Create an account, add your club and photograph the first trophy.';
    final.querySelector('p:last-child').textContent = 'Every club gets its own branded, private collection. Trophy photographs flow directly into illustration generation and inscription reading.';
    const link = final.querySelector('a');
    link.href = '/archive.html#signup';
    link.innerHTML = 'Create your account <span>→</span>';
  }

  const footerLogin = document.querySelector('.marketing-footer nav a:last-child');
  if (footerLogin) {
    footerLogin.href = '/archive.html#login';
    footerLogin.textContent = 'Account sign in';
  }
});
