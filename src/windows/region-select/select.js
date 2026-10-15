// Lets the user drag out a rectangle and reports it to the main process.
// This window covers the primary display exactly, so mouse positions here are
// already positions on that display.

const box = document.getElementById('box');
let origin = null;

function currentRect(event) {
  const x = Math.min(origin.x, event.clientX);
  const y = Math.min(origin.y, event.clientY);
  return {
    x,
    y,
    width: Math.abs(event.clientX - origin.x),
    height: Math.abs(event.clientY - origin.y)
  };
}

function drawBox(rect) {
  box.style.left = `${rect.x}px`;
  box.style.top = `${rect.y}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
}

window.addEventListener('mousedown', (event) => {
  if (event.button !== 0) {
    window.selectionAPI.cancel();
    return;
  }

  origin = { x: event.clientX, y: event.clientY };
  drawBox({ x: origin.x, y: origin.y, width: 0, height: 0 });
  document.body.classList.add('dragging');
});

window.addEventListener('mousemove', (event) => {
  if (origin) {
    drawBox(currentRect(event));
  }
});

window.addEventListener('mouseup', (event) => {
  if (!origin || event.button !== 0) {
    return;
  }

  const rect = currentRect(event);
  origin = null;
  // The main process ignores a rectangle too small to be a real selection.
  window.selectionAPI.done(rect);
});

window.addEventListener('contextmenu', (event) => event.preventDefault());
