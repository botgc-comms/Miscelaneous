(() => {
  'use strict';

  const fallback = Object.freeze({
    clubName: 'Burton-on-Trent Golf Club',
    crestUrl: '/assets/botgc-mark.svg',
    hasCustomCrest: false,
    updatedAtUtc: null
  });

  function normalise(value) {
    return {
      clubName: String(value?.clubName || fallback.clubName).trim() || fallback.clubName,
      crestUrl: String(value?.crestUrl || fallback.crestUrl),
      hasCustomCrest: value?.hasCustomCrest === true,
      updatedAtUtc: value?.updatedAtUtc || null
    };
  }

  function apply(value) {
    const branding = normalise(value);
    window.clubBranding = branding;
    document.querySelectorAll('[data-club-branding-name]').forEach(element => {
      element.textContent = branding.clubName;
    });
    document.querySelectorAll('img[data-club-branding-crest]').forEach(element => {
      element.src = branding.crestUrl;
      element.alt = `${branding.clubName} crest`;
    });
    let icon = document.querySelector('link[rel~="icon"]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.appendChild(icon);
    }
    icon.href = branding.crestUrl;
    const title = document.querySelector('title[data-club-title-prefix]');
    if (title) document.title = `${title.dataset.clubTitlePrefix} | ${branding.clubName}`;
    return branding;
  }

  window.applyClubBranding = apply;
  window.clubBranding = fallback;
  window.clubBrandingReady = fetch('/api/branding', { cache: 'no-store' })
    .then(response => response.ok ? response.json() : fallback)
    .then(apply)
    .catch(() => apply(fallback));
})();
