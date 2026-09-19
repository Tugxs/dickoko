const stage = document.querySelector('#previewStage');
if (stage) {
  let frame;
  const moveField = (event) => {
    const rect = stage.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dx = ((x / rect.width) - 0.5) * 28;
    const dy = ((y / rect.height) - 0.5) * 28;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      stage.style.setProperty('--field-x', `${x}px`);
      stage.style.setProperty('--field-y', `${y}px`);
      stage.style.setProperty('--field-dx', `${dx}px`);
      stage.style.setProperty('--field-dy', `${dy}px`);
      stage.style.setProperty('--field-opacity', '1');
    });
  };
  const resetField = () => {
    stage.style.setProperty('--field-x', '50%');
    stage.style.setProperty('--field-y', '50%');
    stage.style.setProperty('--field-dx', '0px');
    stage.style.setProperty('--field-dy', '0px');
    stage.style.setProperty('--field-opacity', '0');
  };
  stage.addEventListener('pointermove', moveField, {passive:true});
  stage.addEventListener('pointerleave', resetField);
  resetField();
}
