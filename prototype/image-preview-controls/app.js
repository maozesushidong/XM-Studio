const viewport = document.querySelector("#imageViewport");
const stage = document.querySelector("#imageStage");
const zoomValue = document.querySelector("#zoomValue");
const toast = document.querySelector("#toast");

const state = {
  zoom: 1,
  rotation: 0,
  x: 0,
  y: 18,
  dragging: false,
  pointerX: 0,
  pointerY: 0,
  startX: 0,
  startY: 0
};

let toastTimer = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function renderTransform() {
  stage.style.transform = `translate(calc(-50% + ${state.x}px), calc(-50% + ${state.y}px)) rotate(${state.rotation}deg) scale(${state.zoom})`;
  zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
}

function setZoom(nextZoom) {
  state.zoom = clamp(Math.round(nextZoom * 20) / 20, 0.25, 4);
  renderTransform();
}

function fitImage() {
  const bounds = viewport.getBoundingClientRect();
  const rotated = Math.abs(state.rotation % 180) === 90;
  const width = rotated ? 620 : 1104;
  const height = rotated ? 1104 : 620;
  const availableWidth = Math.max(320, bounds.width - 48);
  const availableHeight = Math.max(220, bounds.height - 36);
  state.zoom = clamp(Math.min(availableWidth / width, availableHeight / height), 0.25, 1);
  state.x = 0;
  state.y = 18;
  renderTransform();
}

function resetImage() {
  state.rotation = 0;
  fitImage();
}

function rotate(delta) {
  state.rotation = (state.rotation + delta + 360) % 360;
  fitImage();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 1600);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "zoom-out") setZoom(state.zoom - 0.1);
  if (action === "zoom-in") setZoom(state.zoom + 0.1);
  if (action === "rotate-left") rotate(-90);
  if (action === "rotate-right") rotate(90);
  if (action === "fit") fitImage();
  if (action === "reset") resetImage();
  if (action === "copy") showToast("图片已复制");
  if (action === "download") showToast("图片已保存到下载目录");
  if (action === "close") showToast("预览版中保留弹窗便于继续体验");
});

viewport.addEventListener("wheel", (event) => {
  event.preventDefault();
  setZoom(state.zoom + (event.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });

viewport.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  state.dragging = true;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  state.startX = state.x;
  state.startY = state.y;
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add("dragging");
});

viewport.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  state.x = state.startX + event.clientX - state.pointerX;
  state.y = state.startY + event.clientY - state.pointerY;
  renderTransform();
});

function stopDragging(event) {
  if (!state.dragging) return;
  state.dragging = false;
  viewport.releasePointerCapture?.(event.pointerId);
  viewport.classList.remove("dragging");
}

viewport.addEventListener("pointerup", stopDragging);
viewport.addEventListener("pointercancel", stopDragging);
window.addEventListener("resize", fitImage);
window.addEventListener("keydown", (event) => {
  if (event.key === "+" || event.key === "=") setZoom(state.zoom + 0.1);
  if (event.key === "-") setZoom(state.zoom - 0.1);
  if (event.key.toLowerCase() === "r" && event.shiftKey) rotate(-90);
  else if (event.key.toLowerCase() === "r") rotate(90);
  if (event.key === "0") resetImage();
});

window.addEventListener("load", fitImage);
