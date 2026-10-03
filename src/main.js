import { CONFIG, formatCredits, formatDuration } from "./config.js";
import {
  commandShip,
  createInitialState,
  getDistanceToTarget,
  getExpectedSaleValue,
  getSalePrice,
  getShipStatusLabel,
  sellCargo,
  setPaused,
  setSpeedMultiplier,
  stepSimulation
} from "./simulation.js";

const canvas = document.querySelector("#space-map");
const ctx = canvas.getContext("2d");
const $ = (selector) => document.querySelector(selector);

const ui = {
  credits: $("#credits"),
  clock: $("#game-clock"),
  pause: $("#pause-button"),
  status: $("#sim-status"),
  shipState: $("#ship-state"),
  cargoValue: $("#cargo-value"),
  speedValue: $("#speed-value"),
  targetName: $("#target-name"),
  targetDescription: $("#target-description"),
  targetProgress: $("#target-progress-bar"),
  targetProgressLabel: $("#target-progress-label"),
  oreCargo: $("#ore-cargo"),
  cargoFill: $("#cargo-meter-fill"),
  cargoPercent: $("#cargo-percent"),
  asteroidStatus: $("#asteroid-status"),
  marketPrice: $("#market-price"),
  course: $("#course-label"),
  speedMultiplier: $("#speed-multiplier"),
  eventLog: $("#event-log"),
  logCount: $("#log-count"),
  toast: $("#toast"),
  mapCoordinates: $("#map-coordinates"),
  mine: $("#mine-button"),
  sell: $("#sell-button")
};

const state = createInitialState();
const toastTimers = new WeakMap();
const stars = createStars(145, 93421);
let renderedEventId = 0;
let lastFrame = performance.now();
let lastToast = "";
let tripStartDistance = 1;

function createStars(count, seed) {
  let value = seed;
  const random = () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
  return Array.from({ length: count }, () => ({
    x: random() * CONFIG.map.width,
    y: random() * CONFIG.map.height,
    radius: random() > 0.92 ? 1.8 : 0.6 + random() * 0.8,
    alpha: 0.18 + random() * 0.55
  }));
}

function notify(message) {
  if (!message || message === lastToast) return;
  lastToast = message;
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  const previous = toastTimers.get(ui.toast);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => ui.toast.classList.remove("visible"), 2600);
  toastTimers.set(ui.toast, timer);
}

function logEvents() {
  for (const event of state.events) {
    if (event.id <= renderedEventId) continue;
    const row = document.createElement("div");
    row.className = "log-entry";
    const time = document.createElement("span");
    time.className = "log-time";
    time.textContent = formatDuration(event.time);
    const dot = document.createElement("span");
    dot.className = "log-dot";
    dot.style.background = event.type === "sale" ? "#ffc879" : event.type === "system" ? "#73d9e7" : "#a9f4cf";
    const message = document.createElement("span");
    message.textContent = event.message;
    row.append(time, dot, message);
    ui.eventLog.prepend(row);
    renderedEventId = Math.max(renderedEventId, event.id);
  }
  while (ui.eventLog.children.length > 8) ui.eventLog.lastElementChild.remove();
  ui.logCount.textContent = `${Math.min(state.events.length, 80)} событий`;
}

function currentTarget() {
  if (state.ship.targetId === state.asteroid.id) return state.asteroid;
  if (state.ship.targetId === state.market.id) return state.market;
  return null;
}

function updateInterface() {
  const ship = state.ship;
  const target = currentTarget();
  ui.credits.textContent = formatCredits(state.credits);
  ui.clock.textContent = formatDuration(state.gameSeconds);
  ui.pause.innerHTML = state.paused ? "▶ <span>Продолжить</span>" : "Ⅱ <span>Пауза</span>";
  ui.pause.setAttribute("aria-pressed", String(state.paused));
  ui.status.textContent = state.paused ? "СИСТЕМА НА ПАУЗЕ" : "СИСТЕМА АКТИВНА";
  ui.status.previousElementSibling.style.background = state.paused ? "#ffc879" : "#a9f4cf";
  ui.shipState.textContent = getShipStatusLabel(state);
  ui.cargoValue.textContent = `${ship.cargo.toFixed(0)} / ${ship.cargoCapacity} ед.`;
  ui.oreCargo.textContent = ship.cargo.toFixed(0);
  const cargoRatio = Math.min(1, ship.cargo / ship.cargoCapacity);
  ui.cargoFill.style.width = `${cargoRatio * 100}%`;
  ui.cargoPercent.textContent = `${Math.round(cargoRatio * 100)}%`;
  ui.speedValue.textContent = `${Math.round(ship.travelSpeed)} ед./с`;
  ui.asteroidStatus.textContent = state.asteroid.reserve > 0
    ? `Запас: ${Math.ceil(state.asteroid.reserve)} ед.`
    : "Астероид истощён";
  ui.marketPrice.textContent = `${getSalePrice(state).toFixed(1)} ¢ / ед.`;
  ui.speedMultiplier.textContent = `${state.speedMultiplier}×`;
  ui.course.textContent = target
    ? (target.id === state.asteroid.id ? "АСТЕРОИД A-01" : "СТАНЦИЯ M-01")
    : "НЕ ЗАДАН";

  if (target) {
    ui.targetName.textContent = target.id === state.asteroid.id ? "Железный астероид A-01" : "Станция «Меридиан»";
    ui.targetDescription.textContent = target.id === state.asteroid.id
      ? "Добыча железной руды. При заполнении трюма корабль вернётся на станцию."
      : "Торговая точка. При прибытии весь груз будет продан по текущей цене.";
    const distance = getDistanceToTarget(state) ?? 0;
    const progress = state.ship.state.startsWith("travel-to")
      ? Math.max(3, Math.min(100, (1 - distance / Math.max(tripStartDistance, 1)) * 100))
      : 100;
    ui.targetProgress.style.width = `${progress}%`;
    ui.targetProgressLabel.textContent = state.ship.state === "mining"
      ? "Идёт добыча"
      : `До цели: ${Math.ceil(distance)} ед.`;
  } else {
    ui.targetName.textContent = "Нет назначения";
    ui.targetDescription.textContent = "Выберите объект на карте, чтобы отдать приказ кораблю.";
    ui.targetProgress.style.width = "0%";
    ui.targetProgressLabel.textContent = "Ожидание команды";
  }

  ui.mine.disabled = state.asteroid.reserve <= 0 || ship.cargo >= ship.cargoCapacity;
  ui.mine.style.opacity = ui.mine.disabled ? ".45" : "1";
  ui.sell.disabled = ship.cargo <= 0 && ship.state !== "travel-to-market-empty";
  ui.sell.style.opacity = ui.sell.disabled ? ".45" : "1";
  logEvents();
}

function issueCommand(targetId) {
  const result = commandShip(state, targetId);
  if (!result.ok) {
    notify(result.reason);
    return;
  }
  tripStartDistance = getDistanceToTarget(state) || 1;
  updateInterface();
}

function drawBackground() {
  const { width, height } = CONFIG.map;
  ctx.fillStyle = "#080e19";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(94,128,160,0.095)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y <= height; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }

  for (const star of stars) {
    ctx.globalAlpha = star.alpha;
    ctx.fillStyle = "#b8d4eb";
    ctx.fillRect(Math.round(star.x), Math.round(star.y), star.radius, star.radius);
  }
  ctx.globalAlpha = 1;

  const glow = ctx.createRadialGradient(width * .53, height * .48, 10, width * .53, height * .48, 490);
  glow.addColorStop(0, "rgba(29,68,95,.17)");
  glow.addColorStop(1, "rgba(9,16,28,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(95,135,163,.16)";
  ctx.setLineDash([4, 9]);
  ctx.beginPath();
  ctx.ellipse(620, 390, 390, 265, -.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawRoute() {
  const target = currentTarget();
  if (!target) return;
  ctx.save();
  ctx.strokeStyle = "rgba(169,244,207,.7)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 9]);
  ctx.beginPath();
  ctx.moveTo(state.ship.x, state.ship.y);
  ctx.lineTo(target.x, target.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawAsteroid() {
  const asteroid = state.asteroid;
  const reserveRatio = asteroid.reserve / asteroid.initialReserve;
  ctx.save();
  ctx.translate(asteroid.x, asteroid.y);
  ctx.fillStyle = "rgba(255,200,121,.055)";
  ctx.beginPath(); ctx.arc(0, 0, 62, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,200,121,.4)";
  ctx.setLineDash([2, 7]);
  ctx.beginPath(); ctx.arc(0, 0, 45, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = asteroid.reserve > 0 ? "#6e6656" : "#383c43";
  ctx.strokeStyle = asteroid.reserve > 0 ? "#c7ad7d" : "#59606b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const points = 11;
  for (let i = 0; i < points; i++) {
    const angle = i / points * Math.PI * 2;
    const radius = [25, 31, 27, 34, 24, 30, 26, 32, 23, 29, 25][i];
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * .83;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#d3c3a2";
  ctx.fillRect(-10, -9, 7, 5); ctx.fillRect(7, 5, 5, 4); ctx.fillRect(0, 14, 4, 3);
  ctx.fillStyle = "#a6b4c8";
  ctx.font = "600 13px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("A-01 / FE", 0, 65);
  ctx.fillStyle = "#77869b";
  ctx.font = "10px 'IBM Plex Mono', monospace";
  ctx.fillText(asteroid.reserve > 0 ? `${Math.ceil(asteroid.reserve)} UNITS` : "DEPLETED", 0, 82);
  ctx.fillStyle = "#344052"; ctx.fillRect(-31, 91, 62, 3);
  ctx.fillStyle = "#ffc879"; ctx.fillRect(-31, 91, 62 * reserveRatio, 3);
  ctx.restore();
}

function drawMarket() {
  const market = state.market;
  ctx.save();
  ctx.translate(market.x, market.y);
  ctx.fillStyle = "rgba(115,217,231,.07)";
  ctx.beginPath(); ctx.arc(0, 0, 66, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(115,217,231,.38)";
  ctx.setLineDash([3, 7]);
  ctx.beginPath(); ctx.arc(0, 0, 51, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "#73d9e7"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#15343e"; ctx.fill();
  ctx.strokeStyle = "#8be7f0";
  ctx.beginPath(); ctx.moveTo(-17, -4); ctx.lineTo(-9, -19); ctx.lineTo(11, -19); ctx.lineTo(19, -4); ctx.lineTo(19, 13); ctx.lineTo(-17, 13); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#a6eff4";
  ctx.fillRect(-8, -12, 5, 6); ctx.fillRect(4, -12, 5, 6); ctx.fillRect(-2, 3, 5, 10);
  ctx.fillStyle = "#9fb3c6"; ctx.font = "600 13px 'IBM Plex Mono', monospace"; ctx.textAlign = "center";
  ctx.fillText("M-01 / MERIDIAN", 0, 75);
  ctx.fillStyle = "#73d9e7"; ctx.font = "10px 'IBM Plex Mono', monospace";
  ctx.fillText(`${getSalePrice(state).toFixed(1)} CR / UNIT`, 0, 92);
  ctx.restore();
}

function drawShip() {
  const ship = state.ship;
  const moving = ship.state.startsWith("travel-to");
  const angle = moving ? Math.atan2(ship.vy, ship.vx) : -Math.PI / 5;
  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(angle);
  if (moving) {
    ctx.fillStyle = "rgba(169,244,207,.12)";
    ctx.beginPath(); ctx.moveTo(-13, -5); ctx.lineTo(-40, 0); ctx.lineTo(-13, 5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#a9f4cf";
    ctx.fillRect(-20, -2, 7, 4);
  }
  ctx.fillStyle = "rgba(169,244,207,.12)";
  ctx.beginPath(); ctx.arc(0, 0, 31, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#142c2a"; ctx.strokeStyle = "#a9f4cf"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(21, 0); ctx.lineTo(-11, -13); ctx.lineTo(-7, 0); ctx.lineTo(-11, 13); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#d6fff0"; ctx.fillRect(0, -2, 8, 4);
  ctx.restore();
  ctx.fillStyle = "#d7e7e7"; ctx.font = "600 12px 'IBM Plex Mono', monospace"; ctx.textAlign = "center";
  ctx.fillText("ПИОНЕР", ship.x, ship.y + 35);
  ctx.fillStyle = "#7e96a9"; ctx.font = "9px 'IBM Plex Mono', monospace";
  ctx.fillText(`${Math.floor(ship.cargo)} / ${ship.cargoCapacity} CARGO`, ship.x, ship.y + 49);
}

function drawMap() {
  drawBackground();
  drawRoute();
  drawAsteroid();
  drawMarket();
  drawShip();

  const target = currentTarget();
  if (target) {
    ctx.strokeStyle = "rgba(169,244,207,.7)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(target.x, target.y, 40, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(169,244,207,.35)";
    ctx.beginPath(); ctx.moveTo(target.x - 48, target.y); ctx.lineTo(target.x - 36, target.y); ctx.moveTo(target.x + 36, target.y); ctx.lineTo(target.x + 48, target.y); ctx.stroke();
  }
}

function canvasPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height
  };
}

function handleMapClick(event) {
  const point = canvasPosition(event);
  const asteroidDistance = Math.hypot(point.x - state.asteroid.x, point.y - state.asteroid.y);
  const marketDistance = Math.hypot(point.x - state.market.x, point.y - state.market.y);
  if (asteroidDistance < 58) {
    issueCommand(state.asteroid.id);
  } else if (marketDistance < 58) {
    issueCommand(state.market.id);
  } else {
    ui.mapCoordinates.textContent = `X ${String(Math.round(point.x)).padStart(3, "0")} · Y ${String(Math.round(point.y)).padStart(3, "0")}`;
  }
}

canvas.addEventListener("click", handleMapClick);
ui.mine.addEventListener("click", () => issueCommand(state.asteroid.id));
ui.sell.addEventListener("click", () => {
  if (Math.hypot(state.ship.x - state.market.x, state.ship.y - state.market.y) <= CONFIG.navigation.arrivalRadius + 2) {
    const result = sellCargo(state);
    if (!result.ok) notify(result.reason);
    updateInterface();
  } else if (state.ship.cargo > 0) {
    issueCommand(state.market.id);
  } else {
    notify("Сначала добудьте руду на астероиде.");
  }
});
ui.pause.addEventListener("click", () => setPaused(state, !state.paused));

document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !["INPUT", "TEXTAREA", "BUTTON"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    setPaused(state, !state.paused);
  }
  if (event.key === "1") setSpeedMultiplier(state, 1);
  if (event.key === "2") setSpeedMultiplier(state, 2);
});

function frame(now) {
  const delta = Math.min((now - lastFrame) / 1000, CONFIG.simulation.maxRealDelta);
  lastFrame = now;
  stepSimulation(state, delta);
  drawMap();
  updateInterface();
  requestAnimationFrame(frame);
}

function initialize() {
  ctx.imageSmoothingEnabled = false;
  updateInterface();
  drawMap();
  requestAnimationFrame(frame);
}

initialize();
