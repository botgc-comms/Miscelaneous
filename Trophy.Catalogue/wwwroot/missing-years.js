(() => {
  window.addEventListener('trophy-app-ready', () => {
    const script = document.createElement('script');
    script.src = '/missing-years-core.js';
    document.head.append(script);
  }, { once: true });
})();
