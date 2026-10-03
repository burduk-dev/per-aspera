import { CONFIG, formatCredits, formatDuration } from "./config.js";
import {
  addHullCell, buildDesign, calculateDesignStats, configureCell, createDefaultDesign,
  getCell, getCompartmentName, getCompatibleModules, removeHullCell, validateDesign
} from "./builder.js";
import {
  commandShip,
  createInitialState,
  getDistanceBetweenShipAnd,
  getDistanceToTarget,
  getMarketQuote,
  getResourceName,
  getSalePrice,
  getShipStatusLabel,
  selectMarket,
  sellCargo,
  setPaused,
  setSpeedMultiplier,
  stepSimulation
} from "./simulation.js";

const canvas = document.querySelector("#space-map");
const ctx = canvas.getContext("2d");
const $ = (selector) => document.querySelector(selector);
const ui = {
  credits: $("#credits"), clock: $("#game-clock"), pause: $("#pause-button"),
  status: $("#sim-status"), shipState: $("#ship-state"), cargoValue: $("#cargo-value"),
  speedValue: $("#speed-value"), targetName: $("#target-name"), targetDescription: $("#target-description"),
  targetProgress: $("#target-progress-bar"), targetProgressLabel: $("#target-progress-label"),
  oreCargo: $("#ore-cargo"), cargoFill: $("#cargo-meter-fill"), cargoPercent: $("#cargo-percent"),
  cargoResourceName: $("#cargo-resource-name"), cargoResourceType: $("#cargo-resource-type"),
  asteroidStatus: $("#asteroid-status"), asteroidTitle: $("#selected-asteroid-title"),
  marketTitle: $("#selected-market-title"), marketPrice: $("#market-price"), asteroidCode: $("#selected-asteroid-code"), marketCode: $("#selected-market-code"),
  course: $("#course-label"), speedMultiplier: $("#speed-multiplier"), eventLog: $("#event-log"),
  logCount: $("#log-count"), toast: $("#toast"), mapCoordinates: $("#map-coordinates"),
  mine: $("#mine-button"), sell: $("#sell-button"), marketOffers: $("#market-offers"),
  saleReportTime: $("#sale-report-time"), saleReportContent: $("#sale-report-content"),
  shipName: $("#ship-card .ship-card-copy strong"), builderGrid: $("#builder-grid"), builderSelectedCell: $("#builder-selected-cell"),
  builderCompartment: $("#builder-compartment"), builderCompartmentLevel: $("#builder-compartment-level"), builderModule: $("#builder-module"),
  builderModuleLevel: $("#builder-module-level"), builderCellDescription: $("#builder-cell-description"), builderErrors: $("#builder-errors"),
  builderBadge: $("#builder-validation-badge"), builderPowerStatus: $("#builder-power-status"), builderHullCost: $("#builder-hull-cost"),
  builderCompartmentCost: $("#builder-compartment-cost"), builderModuleCost: $("#builder-module-cost"), builderTotalCost: $("#builder-total-cost"),
  builderCargoCapacity: $("#builder-cargo-capacity"), builderMiningRate: $("#builder-mining-rate"), builderTravelSpeed: $("#builder-travel-speed"),
  builderCellCount: $("#builder-cell-count"), builderBuild: $("#builder-build"), builderAddCell: $("#builder-add-cell"), builderRemoveCell: $("#builder-remove-cell"),
  builderApplyCell: $("#builder-apply-cell"), builderReset: $("#builder-reset")
};

const state = createInitialState();
const defaultDesign = createDefaultDesign();
let design = createDefaultDesign();
let builderAddMode = false;
let renderedEventId = 0;
let lastFrame = performance.now();
let lastUiUpdate = 0;
let lastToast = "";
let tripStartDistance = 1;
let lastTargetId = null;
let lastRenderedSaleId = null;
const stars = createStars(145, 93421);

function createStars(count, seed) {
  let value = seed;
  const random = () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
  return Array.from({ length: count }, () => ({
    x: random() * CONFIG.map.width, y: random() * CONFIG.map.height,
    radius: random() > .92 ? 1.8 : .6 + random() * .8, alpha: .18 + random() * .55
  }));
}
function asteroidById(id) { return state.asteroids.find((item) => item.id === id) ?? state.asteroids[0]; }
function marketById(id) { return state.markets.find((item) => item.id === id) ?? state.markets[0]; }
function targetById(id) { return asteroidById(id) && state.asteroids.some((item) => item.id === id) ? asteroidById(id) : marketById(id) && state.markets.some((item) => item.id === id) ? marketById(id) : null; }
function currentTarget() { return targetById(state.ship.targetId); }
function selectedAsteroid() { return asteroidById(state.selectedAsteroidId); }
function selectedMarket() { return marketById(state.selectedMarketId); }

function notify(message) {
  if (!message || message === lastToast) return;
  lastToast = message;
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  setTimeout(() => ui.toast.classList.remove("visible"), 2600);
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

function renderMarketOffers() {
  const asteroid = selectedAsteroid();
  ui.marketOffers.replaceChildren();
  for (const market of state.markets) {
    const quote = getMarketQuote(state, market.id, asteroid.id);
    const row = document.createElement("tr");
    if (market.id === state.selectedMarketId) row.className = "active-market";
    const name = document.createElement("td");
    name.className = "market-name";
    name.textContent = market.name;
    const price = document.createElement("td");
    price.className = "price-cell";
    price.textContent = `${quote.unitPrice.toFixed(1)} ¢`;
    const distance = document.createElement("td");
    distance.className = "distance-cell";
    distance.textContent = `${Math.round(quote.distance)} ед.`;
    const revenue = document.createElement("td");
    revenue.className = "revenue-cell";
    revenue.textContent = `${formatCredits(quote.expectedRevenue)} ¢`;
    const action = document.createElement("td");
    const button = document.createElement("button");
    button.className = "market-select-button";
    button.type = "button";
    button.textContent = market.id === state.selectedMarketId ? "Выбран" : "Выбрать";
    button.setAttribute("aria-pressed", String(market.id === state.selectedMarketId));
    button.addEventListener("click", () => {
      selectMarket(state, market.id);
      updateInterface();
      notify(`Для автоматического возврата выбран рынок «${market.name}».`);
    });
    action.append(button);
    row.append(name, price, distance, revenue, action);
    ui.marketOffers.append(row);
  }
}

function renderSaleReport() {
  const sale = state.lastSale;
  if (!sale || sale.id === lastRenderedSaleId) return;
  lastRenderedSaleId = sale.id;
  ui.saleReportTime.textContent = formatDuration(sale.time);
  ui.saleReportContent.replaceChildren();
  const metrics = [
    ["ОБЪЁМ", `${sale.quantity.toFixed(0)} ед.`],
    ["ЦЕНА / ЕД.", `${sale.unitPrice.toFixed(1)} ¢`],
    ["РЫНОК", sale.marketName],
    ["ВЫРУЧКА", `${formatCredits(sale.revenue)} ¢`]
  ];
  for (const [label, value] of metrics) {
    const metric = document.createElement("div");
    metric.className = `report-metric${label === "ВЫРУЧКА" ? " revenue" : ""}`;
    const caption = document.createElement("span");
    caption.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    metric.append(caption, strong);
    ui.saleReportContent.append(metric);
  }
}

function updateInterface() {
  const ship = state.ship;
  const target = currentTarget();
  const asteroid = selectedAsteroid();
  const market = selectedMarket();
  const cargoRatio = Math.min(1, ship.cargo / ship.cargoCapacity);
  ui.credits.textContent = formatCredits(state.credits);
  ui.clock.textContent = formatDuration(state.gameSeconds);
  ui.pause.innerHTML = state.paused ? "▶ <span>Продолжить</span>" : "Ⅱ <span>Пауза</span>";
  ui.pause.setAttribute("aria-pressed", String(state.paused));
  ui.status.textContent = state.paused ? "СИСТЕМА НА ПАУЗЕ" : "СИСТЕМА АКТИВНА";
  ui.status.previousElementSibling.style.background = state.paused ? "#ffc879" : "#a9f4cf";
  ui.shipState.textContent = getShipStatusLabel(state);
  if (ui.shipName) ui.shipName.textContent = `«${ship.name}»`;
  ui.cargoValue.textContent = `${ship.cargo.toFixed(0)} / ${ship.cargoCapacity} ед.`;
  ui.oreCargo.textContent = ship.cargo.toFixed(0);
  ui.cargoResourceName.textContent = ship.cargoResourceId ? getResourceName(ship.cargoResourceId) : "Нет груза";
  ui.cargoResourceType.textContent = ship.cargoResourceId ? "Ресурс в трюме" : "Трюм пуст";
  ui.cargoFill.style.width = `${cargoRatio * 100}%`;
  ui.cargoPercent.textContent = `${Math.round(cargoRatio * 100)}%`;
  ui.speedValue.textContent = `${Math.round(ship.travelSpeed)} ед./с`;
  ui.asteroidTitle.textContent = `${getResourceName(asteroid.resourceId)} ${asteroid.label}`;
  ui.asteroidCode.textContent = `ДОБЫЧА / ${asteroid.label}`;
  ui.asteroidStatus.textContent = asteroid.reserve > 0 ? `Запас: ${Math.ceil(asteroid.reserve)} ед.` : "Астероид истощён";
  ui.marketTitle.textContent = `Станция «${market.name}»`;
  ui.marketCode.textContent = `ТОРГОВЛЯ / ${market.label}`;
  ui.marketPrice.textContent = `${getSalePrice(state, market.id, asteroid.resourceId).toFixed(1)} ¢ / ед.`;
  ui.speedMultiplier.textContent = `${state.speedMultiplier}×`;
  ui.course.textContent = target ? target.label ?? target.name : "НЕ ЗАДАН";

  if (target) {
    ui.targetName.textContent = target.resourceId
      ? `${target.label} · ${getResourceName(target.resourceId)}`
      : `Торговая точка · ${target.name}`;
    ui.targetDescription.textContent = target.resourceId
      ? "Добыча продолжается до заполнения трюма или истощения астероида."
      : "При прибытии груз будет продан по текущей цене этого рынка.";
    const distance = getDistanceToTarget(state) ?? 0;
    const progress = ship.state.startsWith("travel-to")
      ? Math.max(3, Math.min(100, (1 - distance / Math.max(tripStartDistance, 1)) * 100))
      : 100;
    ui.targetProgress.style.width = `${progress}%`;
    ui.targetProgressLabel.textContent = ship.state === "mining" ? "Идёт добыча" : `До цели: ${Math.ceil(distance)} ед.`;
  } else {
    ui.targetName.textContent = "Нет назначения";
    ui.targetDescription.textContent = "Выберите объект на карте, чтобы отдать приказ кораблю.";
    ui.targetProgress.style.width = "0%";
    ui.targetProgressLabel.textContent = "Ожидание команды";
  }

  ui.mine.disabled = asteroid.reserve <= 0 || ship.cargo >= ship.cargoCapacity;
  ui.mine.style.opacity = ui.mine.disabled ? ".45" : "1";
  const nearSelectedMarket = (getDistanceBetweenShipAnd(state, market.id) ?? Infinity) <= CONFIG.navigation.arrivalRadius + 2;
  ui.sell.textContent = nearSelectedMarket && ship.cargo > 0 ? "Продать" : "На рынок";
  ui.sell.disabled = ship.cargo <= 0;
  ui.sell.style.opacity = ui.sell.disabled ? ".45" : "1";
  renderMarketOffers();
  renderSaleReport();
  logEvents();
}

function issueCommand(targetId) {
  const result = commandShip(state, targetId);
  if (!result.ok) {
    notify(result.reason);
    return;
  }
  tripStartDistance = getDistanceToTarget(state) || 1;
  lastTargetId = state.ship.targetId;
  updateInterface();
}

const compartmentSymbols = { mining: "M", cargo: "C", engine: "E", reactor: "R" };
const moduleShortNames = { mining: "БУР", storage: "ТРЮМ", engine: "ДВИГ.", reactor: "РЕАКТ." };
const moduleNames = { mining: "Добыча", storage: "Хранилище", engine: "Двигатель", reactor: "Реактор" };

function renderBuilderGrid() {
  ui.builderGrid.replaceChildren();
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const key = `${x},${y}`;
      const cell = getCell(design, key);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "builder-cell";
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", cell
        ? `Клетка ${key}, отсек: ${getCompartmentName(cell.compartment)}`
        : `Пустая клетка ${key}`);
      if (cell) {
        button.classList.add("hull-cell", `compartment-${cell.compartment}`);
        if (design.selectedCell === key) button.classList.add("selected");
        const symbol = document.createElement("span");
        symbol.className = "cell-symbol";
        symbol.textContent = compartmentSymbols[cell.compartment] ?? "·";
        const module = document.createElement("span");
        module.className = "cell-module";
        module.textContent = cell.moduleId ? moduleShortNames[cell.moduleId] : `У${cell.level}`;
        const coord = document.createElement("span");
        coord.className = "cell-coordinate";
        coord.textContent = key;
        button.append(symbol, module, coord);
      } else {
        button.classList.add("empty-cell");
        button.textContent = builderAddMode ? "+" : "·";
      }
      button.addEventListener("click", () => {
        if (cell) {
          design.selectedCell = key;
          builderAddMode = false;
          renderBuilder();
          return;
        }
        if (!builderAddMode) return notify("Нажмите «Добавить клетку», затем выберите пустую клетку рядом с корпусом.");
        const result = addHullCell(design, x, y);
        builderAddMode = false;
        if (!result.ok) notify(result.reason);
        renderBuilder();
      });
      ui.builderGrid.append(button);
    }
  }
}

function updateBuilderControls() {
  const cell = getCell(design);
  ui.builderSelectedCell.textContent = cell ? cellKeyLabel(cell) : "—";
  ui.builderCompartment.disabled = !cell;
  ui.builderCompartmentLevel.disabled = !cell;
  ui.builderModule.disabled = !cell;
  ui.builderModuleLevel.disabled = !cell;
  ui.builderApplyCell.disabled = !cell;
  if (!cell) {
    ui.builderCellDescription.textContent = "Выберите клетку корпуса.";
    ui.builderModule.replaceChildren(new Option("Нет модуля", ""));
    return;
  }
  ui.builderCompartment.value = cell.compartment;
  ui.builderCompartmentLevel.value = String(cell.level);
  const compatible = getCompatibleModules(cell.compartment);
  ui.builderModule.replaceChildren(new Option("Нет модуля", ""));
  for (const item of compatible) ui.builderModule.add(new Option(item.name, item.id));
  ui.builderModule.value = cell.moduleId ?? "";
  ui.builderModuleLevel.value = String(cell.moduleLevel ?? 1);
  ui.builderCellDescription.textContent = `${getCompartmentName(cell.compartment)} · уровень ${cell.level}. ${cell.moduleId ? `Модуль: ${moduleNames[cell.moduleId]}, уровень ${cell.moduleLevel}.` : "Модуль не установлен."}`;
}

function cellKeyLabel(cell) {
  return `(${cell.x + 1}; ${cell.y + 1})`;
}

function updateBuilderSummary() {
  const stats = calculateDesignStats(design);
  const validation = validateDesign(design, state.credits);
  ui.builderHullCost.textContent = `${formatCredits(stats.hullCost)} ¢`;
  ui.builderCompartmentCost.textContent = `${formatCredits(stats.compartmentCost)} ¢`;
  ui.builderModuleCost.textContent = `${formatCredits(stats.moduleCost)} ¢`;
  ui.builderTotalCost.textContent = `${formatCredits(stats.cost)} ¢`;
  ui.builderCargoCapacity.textContent = `${stats.cargoCapacity} ед.`;
  ui.builderMiningRate.textContent = `${stats.miningRate.toFixed(1)} ед./с`;
  ui.builderTravelSpeed.textContent = stats.travelSpeed ? `${stats.travelSpeed} ед./с` : "—";
  ui.builderCellCount.textContent = `${stats.cellCount} / ${CONFIG.construction.maxCells}`;
  ui.builderPowerStatus.textContent = `ЭНЕРГИЯ: ${stats.power > 0 ? "+" : ""}${stats.power}`;
  ui.builderPowerStatus.classList.toggle("power-negative", stats.power < 0);
  ui.builderBadge.textContent = validation.valid ? "СБОРКА ДОПУСТИМА" : `ОШИБОК: ${validation.errors.length}`;
  ui.builderBadge.classList.toggle("invalid", !validation.valid);
  ui.builderBuild.disabled = !validation.valid;
  ui.builderErrors.replaceChildren();
  if (validation.valid) {
    const success = document.createElement("div");
    success.className = "builder-success";
    success.textContent = `Конфигурация корректна. После постройки останется ${formatCredits(state.credits - stats.cost)} ¢.`;
    ui.builderErrors.append(success);
  } else {
    for (const error of validation.errors) {
      const row = document.createElement("div");
      row.textContent = `• ${error.message}`;
      ui.builderErrors.append(row);
    }
  }
}

function renderBuilder() {
  renderBuilderGrid();
  updateBuilderControls();
  updateBuilderSummary();
}

function drawBackground() {
  const { width, height } = CONFIG.map;
  ctx.fillStyle = "#080e19";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(94,128,160,0.095)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  for (let y = 0; y <= height; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
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
  ctx.beginPath(); ctx.ellipse(620, 390, 390, 265, -.2, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
}

function drawRoute() {
  const target = currentTarget();
  if (!target) return;
  ctx.save();
  ctx.strokeStyle = "rgba(169,244,207,.7)";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 9]);
  ctx.beginPath(); ctx.moveTo(state.ship.x, state.ship.y); ctx.lineTo(target.x, target.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawAsteroid(asteroid) {
  const reserveRatio = asteroid.reserve / asteroid.initialReserve;
  const color = CONFIG.resources[asteroid.resourceId].color;
  ctx.save();
  ctx.translate(asteroid.x, asteroid.y);
  if (asteroid.id === state.selectedAsteroidId) {
    ctx.strokeStyle = `${color}88`; ctx.setLineDash([2, 7]);
    ctx.beginPath(); ctx.arc(0, 0, 45, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.fillStyle = `${color}0d`;
  ctx.beginPath(); ctx.arc(0, 0, 37, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = asteroid.reserve > 0 ? "#6e6656" : "#383c43";
  ctx.strokeStyle = asteroid.reserve > 0 ? color : "#59606b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const points = 9;
  for (let i = 0; i < points; i++) {
    const angle = i / points * Math.PI * 2;
    const radius = [17, 23, 19, 25, 18, 22, 17, 24, 19][i];
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * .83;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(-7, -6, 5, 4); ctx.fillRect(5, 4, 4, 3);
  ctx.fillStyle = "#a6b4c8"; ctx.font = "600 11px 'IBM Plex Mono', monospace"; ctx.textAlign = "center";
  ctx.fillText(asteroid.label, 0, 39);
  ctx.fillStyle = color; ctx.font = "9px 'IBM Plex Mono', monospace";
  ctx.fillText(asteroid.reserve > 0 ? `${Math.ceil(asteroid.reserve)}` : "EMPTY", 0, 52);
  ctx.fillStyle = "#344052"; ctx.fillRect(-19, 59, 38, 2);
  ctx.fillStyle = color; ctx.fillRect(-19, 59, 38 * reserveRatio, 2);
  ctx.restore();
}

function drawMarket(market) {
  const color = "#73d9e7";
  ctx.save();
  ctx.translate(market.x, market.y);
  if (market.id === state.selectedMarketId) {
    ctx.strokeStyle = "rgba(115,217,231,.48)";
    ctx.beginPath(); ctx.arc(0, 0, 47, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = "rgba(115,217,231,.06)";
  ctx.beginPath(); ctx.arc(0, 0, 35, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 23, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#15343e"; ctx.strokeStyle = "#8be7f0";
  ctx.beginPath(); ctx.moveTo(-13, -3); ctx.lineTo(-7, -15); ctx.lineTo(8, -15); ctx.lineTo(14, -3); ctx.lineTo(14, 10); ctx.lineTo(-13, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#a6eff4"; ctx.fillRect(-6, -10, 4, 5); ctx.fillRect(3, -10, 4, 5); ctx.fillRect(-2, 2, 4, 8);
  ctx.fillStyle = "#9fb3c6"; ctx.font = "600 11px 'IBM Plex Mono', monospace"; ctx.textAlign = "center";
  ctx.fillText(market.label, 0, 39);
  ctx.fillStyle = color; ctx.font = "9px 'IBM Plex Mono', monospace";
  ctx.fillText(`${getSalePrice(state, market.id, selectedAsteroid().resourceId).toFixed(1)} CR`, 0, 52);
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
    ctx.fillStyle = "#a9f4cf"; ctx.fillRect(-20, -2, 7, 4);
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
  for (const asteroid of state.asteroids) drawAsteroid(asteroid);
  for (const market of state.markets) drawMarket(market);
  drawShip();
  const target = currentTarget();
  if (target) {
    ctx.strokeStyle = "rgba(169,244,207,.7)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(target.x, target.y, 38, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(169,244,207,.35)";
    ctx.beginPath(); ctx.moveTo(target.x - 44, target.y); ctx.lineTo(target.x - 34, target.y); ctx.moveTo(target.x + 34, target.y); ctx.lineTo(target.x + 44, target.y); ctx.stroke();
  }
}

function canvasPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
}
function handleMapClick(event) {
  const point = canvasPosition(event);
  const asteroid = state.asteroids.find((item) => Math.hypot(point.x - item.x, point.y - item.y) < 38);
  if (asteroid) { issueCommand(asteroid.id); return; }
  const market = state.markets.find((item) => Math.hypot(point.x - item.x, point.y - item.y) < 45);
  if (market) { issueCommand(market.id); return; }
  ui.mapCoordinates.textContent = `X ${String(Math.round(point.x)).padStart(3, "0")} · Y ${String(Math.round(point.y)).padStart(3, "0")}`;
}

ui.builderGrid.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    builderAddMode = false;
    renderBuilder();
  }
});
ui.builderCompartment.addEventListener("change", () => {
  const selected = ui.builderModule.value;
  const compatible = getCompatibleModules(ui.builderCompartment.value);
  ui.builderModule.replaceChildren(new Option("Нет модуля", ""));
  for (const item of compatible) ui.builderModule.add(new Option(item.name, item.id));
  ui.builderModule.value = compatible.some((item) => item.id === selected) ? selected : "";
});

ui.builderAddCell.addEventListener("click", () => {
  builderAddMode = true;
  renderBuilderGrid();
  notify("Выберите пустую клетку, которая примыкает к корпусу стороной.");
});
ui.builderRemoveCell.addEventListener("click", () => {
  const result = removeHullCell(design);
  if (!result.ok) notify(result.reason);
  renderBuilder();
});
ui.builderApplyCell.addEventListener("click", () => {
  const result = configureCell(design, design.selectedCell, {
    compartment: ui.builderCompartment.value,
    level: Number(ui.builderCompartmentLevel.value),
    moduleId: ui.builderModule.value || null,
    moduleLevel: Number(ui.builderModuleLevel.value)
  });
  if (!result.ok) notify(result.reason);
  else notify("Настройки отсека применены.");
  renderBuilder();
});
ui.builderReset.addEventListener("click", () => {
  design = createDefaultDesign();
  builderAddMode = false;
  renderBuilder();
  notify("Восстановлен стандартный чертёж.");
});
ui.builderBuild.addEventListener("click", () => {
  const result = buildDesign(state, design);
  if (!result.ok) {
    notify(result.reason);
    updateBuilderSummary();
    return;
  }
  state.events.push({ id: state.nextEventId++, time: state.gameSeconds, type: "system", message: `Корабль перестроен. Стоимость: ${formatCredits(result.cost)} ¢; энергия: ${result.stats.power > 0 ? "+" : ""}${result.stats.power}.` });
  if (state.events.length > 80) state.events.shift();
  notify(`Корабль перестроен за ${formatCredits(result.cost)} ¢.`);
  updateInterface();
  renderBuilder();
});

canvas.addEventListener("click", handleMapClick);
ui.mine.addEventListener("click", () => issueCommand(state.selectedAsteroidId));
ui.sell.addEventListener("click", () => {
  if (state.ship.cargo <= 0) return notify("Сначала добудьте руду на астероиде.");
  if ((getDistanceBetweenShipAnd(state, state.selectedMarketId) ?? Infinity) <= CONFIG.navigation.arrivalRadius + 2) {
    const result = sellCargo(state, state.selectedMarketId);
    if (!result.ok) notify(result.reason);
    updateInterface();
  } else issueCommand(state.selectedMarketId);
});
ui.pause.addEventListener("click", () => setPaused(state, !state.paused));
document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && !["INPUT", "TEXTAREA", "BUTTON"].includes(document.activeElement?.tagName)) {
    event.preventDefault(); setPaused(state, !state.paused);
  }
  if (event.key === "1") setSpeedMultiplier(state, 1);
  if (event.key === "2") setSpeedMultiplier(state, 2);
});

function frame(now) {
  const delta = Math.min((now - lastFrame) / 1000, CONFIG.simulation.maxRealDelta);
  lastFrame = now;
  stepSimulation(state, delta);
  if (state.ship.targetId !== lastTargetId) {
    lastTargetId = state.ship.targetId;
    tripStartDistance = getDistanceToTarget(state) || 1;
  }
  drawMap();
  if (now - lastUiUpdate > 150) {
    updateInterface();
    lastUiUpdate = now;
  }
  requestAnimationFrame(frame);
}
function initialize() {
  ctx.imageSmoothingEnabled = false;
  updateInterface();
  drawMap();
  requestAnimationFrame(frame);
}
initialize();
