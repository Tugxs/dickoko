const stage = document.querySelector('#previewStage');
if (stage) {
  let frame;
  const particles = Array.from({length: 34}, (_, index) => {
    const star = document.createElement('span');
    star.className = 'field-particle';
    star.style.left = `${(index * 47 + 13) % 100}%`;
    star.style.top = `${(index * 29 + 17) % 100}%`;
    star.style.setProperty('--star-size', `${1 + index % 3}px`);
    star.style.setProperty('--twinkle-delay', `${(index % 7) * -0.6}s`);
    star.dataset.starX = String(((index * 47 + 13) % 100) / 100);
    star.dataset.starY = String(((index * 29 + 17) % 100) / 100);
    stage.appendChild(star);
    return star;
  });
  const moveField = (event) => {
    const rect = stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nx = x / rect.width;
    const ny = y / rect.height;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      stage.style.setProperty('--field-x', `${x}px`);
      stage.style.setProperty('--field-y', `${y}px`);
      particles.forEach((star) => {
        const distance = Math.hypot(Number(star.dataset.starX) - nx, Number(star.dataset.starY) - ny);
        star.style.opacity = distance < 0.13 ? '0' : '.55';
      });
    });
  };
  const resetField = () => {
    particles.forEach((star) => { star.style.opacity = '.38'; });
  };
  stage.addEventListener('pointermove', moveField, {passive:true});
  stage.addEventListener('pointerleave', resetField);
  resetField();
}
