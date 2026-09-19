const stage = document.querySelector('#previewStage');
if (stage) {
  let frame;
  const particles = Array.from({length: 22}, (_, index) => {
    const particle = document.createElement('span');
    particle.className = 'field-particle';
    particle.style.left = `${(index * 47) % 100}%`;
    particle.style.top = `${(index * 29 + 11) % 100}%`;
    particle.style.width = `${2 + index % 3}px`;
    particle.style.height = particle.style.width;
    particle.dataset.depth = String(0.18 + (index % 5) * 0.12);
    stage.appendChild(particle);
    return particle;
  });
  const moveField = (event) => {
    const rect = stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nx = x / rect.width - 0.5;
    const ny = y / rect.height - 0.5;
    const dx = nx * 28;
    const dy = ny * 28;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      stage.style.setProperty('--field-x', `${x}px`);
      stage.style.setProperty('--field-y', `${y}px`);
      stage.style.setProperty('--field-dx', `${dx}px`);
      stage.style.setProperty('--field-dy', `${dy}px`);
      stage.style.setProperty('--field-opacity', '1');
      particles.forEach((particle, index) => {
        const depth = Number(particle.dataset.depth);
        const driftX = nx * (18 + index % 4 * 8) * depth;
        const driftY = ny * (15 + index % 3 * 9) * depth;
        particle.style.transform = `translate3d(${driftX}px, ${driftY}px, 0) scale(${1 + depth})`;
      });
    });
  };
  const resetField = () => {
    stage.style.setProperty('--field-x', '50%');
    stage.style.setProperty('--field-y', '50%');
    stage.style.setProperty('--field-dx', '0px');
    stage.style.setProperty('--field-dy', '0px');
    stage.style.setProperty('--field-opacity', '0');
    particles.forEach((particle) => { particle.style.transform = 'translate3d(0, 0, 0) scale(1)'; });
  };
  stage.addEventListener('pointermove', moveField, {passive:true});
  stage.addEventListener('pointerleave', resetField);
  resetField();
}
