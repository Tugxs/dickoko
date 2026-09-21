(() => {
  const overlay = document.querySelector('#homeOverlay');
  if (!overlay) return;

  const scene = overlay.querySelector('.home-main');
  const sections = [
    overlay.querySelector('.partners-strip'),
    overlay.querySelector('.plans-section'),
    overlay.querySelector('.knowledge-home-section')
  ].filter(Boolean);
  const logoChips = overlay.querySelectorAll('.logo-chip');
  const planCards = overlay.querySelectorAll('.plan-card');
  const knowledgeCards = overlay.querySelectorAll('.knowledge-small-card');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;

  logoChips.forEach((el, index) => {
    el.style.setProperty('--logo-index', index);
    el.style.setProperty('--logo-depth', `${(index % 4) * 12}`);
  });
  planCards.forEach((el, index) => el.style.setProperty('--card-index', index));
  knowledgeCards.forEach((el, index) => el.style.setProperty('--card-index', index));

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

  function update3D() {
    frame = 0;
    const y = overlay.scrollTop || 0;
    const active = !reducedMotion.matches && y > 24;
    overlay.classList.toggle('home-scroll-3d', active);
    if (scene) scene.style.setProperty('--scroll-distance', `${Math.min(y, 900)}px`);

    sections.forEach(section => {
      const rect = section.getBoundingClientRect();
      const viewport = window.innerHeight || document.documentElement.clientHeight;
      const progress = clamp((viewport * .94 - rect.top) / (viewport * .86 + rect.height));
      const inScene = rect.bottom > viewport * .08 && rect.top < viewport * .92;
      section.classList.toggle('is-3d-active', active && inScene);
      section.style.setProperty('--section-progress', inScene ? progress.toFixed(3) : (rect.top >= viewport ? '0' : '1'));
    });
  }

  function requestUpdate() {
    if (!frame) frame = requestAnimationFrame(update3D);
  }

  overlay.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate, { passive: true });
  reducedMotion.addEventListener?.('change', requestUpdate);
  requestUpdate();
})();
