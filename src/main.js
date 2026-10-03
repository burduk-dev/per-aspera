import { CONFIG, formatCredits, formatDuration } from "./config.js";
import {
  cloneDesign, configureCell, createDefaultDesign, calculateDesignStats, getCell, getCompartmentName, getCompatibleModules
} from "./builder.js";
import {
  commandShip, createInitialState, getDistanceToTarget, getMarketQuote, getResourceName, getSalePrice,
  getShipStatusLabel, sellCargo, setPaused, setSpeedMultiplier, stepSimulation, buyShip, selectShip, setShipAutoRepeat
} from "./simulation.js";

const canvas = document.querySelector("#space-map");
const ctx = canvas.getContext("2d");
const $ = (selector) => document.querySelector(selector);
const ui = {
  credits: $("#credits"), reputation: $("#reputation"), clock: $("#game-clock"), pause: $("#pause-button"),
  speed: $("#speed-button"), status: $("#sim-status"), shipPanel: $("#ship-panel"), shipName: $("#ship-name"),
  shipState: $("#ship-state"), cargoValue: $("#cargo-value"), cargoPercent: $("#cargo-percent"),
  miningValue: $("#mining-value"), speedValue: $("#speed-value"), moduleCount: $("#module-count"),
  powerLabel: $("#power-label"), targetName: $("#target-name"), targetDescription: $("#target-description"),
  targetProgress: $("#target-progress"), bottomCargo: $("#bottom-cargo"), marketPrice: $("#market-price"),
  expectedRevenue: $("#expected-revenue"), objectKicker: $("#object-kicker"), objectName: $("#object-name"),
  objectDetail: $("#object-detail"), hint: $("#map-hint"), toast: $("#toast"), settings: $("#settings-modal"),
  settingsPause: $("#settings-pause"), settingsSpeed: $("#settings-speed"), config: $("#configure-overlay"),
  slotLabel: $("#selected-slot-label"), modulePower: $("#module-power"), moduleCategories: $("#module-categories"),
  moduleOptions: $("#module-options"), configHint: $("#configure-hint"), fleetButton: $("#fleet-button"), fleetModal: $("#fleet-modal"), fleetList: $("#fleet-list"), buyShip: $("#buy-ship"), buyShipCost: $("#buy-ship-cost")
};
const state = createInitialState();
let design = createDefaultDesign();
let selectedSlot = design.cells[0] ? design.cells[0].x + "," + design.cells[0].y : null;
let activeCategory = "mining";
let shipPanelOpen = false;
let configuring = false;
let autoExplore = false;
let renderedEventId = 0;
let lastFrame = performance.now();
let lastUiUpdate = 0;
let lastToast = "";
let tripStartDistance = 1;
let lastTargetId = null;
const stars = createStars(210, 93421);
const categoryNames = { mining: "Добыча", cargo: "Трюм", engine: "Двигатель", reactor: "Реактор" };
const categoryIcons = { mining: "⌁", cargo: "▤", engine: "⟿", reactor: "ϟ" };
const shortNames = { mining: "БУР", storage: "ТРЮМ", engine: "ДВИГ.", reactor: "РЕАКТ." };

function createStars(count, seed) {
  let value = seed;
  const random = () => { value = (value * 16807) % 2147483647; return (value - 1) / 2147483646; };
  return Array.from({ length: count }, () => ({
    x: random() * CONFIG.map.width, y: random() * CONFIG.map.height,
    radius: random() > .96 ? 1.6 : .4 + random() * .8, alpha: .12 + random() * .58
  }));
}
function asteroidById(id) { return state.asteroids.find((item) => item.id === id) ?? state.asteroids[0]; }
function marketById(id) { return state.markets.find((item) => item.id === id) ?? state.markets[0]; }
function targetById(id) { return state.asteroids.find((item) => item.id === id) ?? state.markets.find((item) => item.id === id) ?? null; }
function activeShip() { return state.ships.find(ship => ship.id === state.selectedShipId) ?? state.ships[0] ?? state.ship; }
function syncActiveShip() { state.ship = activeShip(); return state.ship; }
function currentTarget() { return targetById(activeShip().targetId); }
function selectedAsteroid() { return asteroidById(state.selectedAsteroidId); }
function selectedMarket() { return marketById(state.selectedMarketId); }
function cellAtKey(key) { return design.cells.find((cell) => cell.x + "," + cell.y === key) ?? null; }
function notify(message) {
  if (!message || message === lastToast) return;
  lastToast = message;
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  setTimeout(() => ui.toast.classList.remove("visible"), 2400);
}
function moduleDefinition(cell) {
  return cell?.moduleId ? CONFIG.construction.moduleDefinitions[cell.moduleId] : null;
}
function moduleLevelDefinition(cell) {
  return moduleDefinition(cell)?.levels[Number(cell.moduleLevel)] ?? null;
}
function shipStats() {
  const stats = calculateDesignStats(design);
  return stats;
}
function updateShipFromDesign() {
  const stats = shipStats();
  for (const ship of state.ships) {
    ship.cargoCapacity = Math.max(1, stats.cargoCapacity);
    ship.miningRate = Math.max(.1, stats.miningRate);
    ship.travelSpeed = Math.max(20, stats.travelSpeed);
  }
  return stats;
}
function logEvent(type, message) {
  state.events.push({ id: state.nextEventId++, time: state.gameSeconds, type, message });
  if (state.events.length > 80) state.events.shift();
}
function issueCommand(targetId) {
  syncActiveShip();
  const result = commandShip(state, targetId, activeShip().id);
  if (!result.ok) { notify(result.reason); return; }
  tripStartDistance = getDistanceToTarget(state) || 1;
  lastTargetId = state.ship.targetId;
  const target = targetById(targetId);
  if (target?.resourceId) {
    ui.objectKicker.textContent = "ЦЕЛЬ ДОБЫЧИ / " + target.label;
    ui.objectName.textContent = getResourceName(target.resourceId);
    ui.objectDetail.textContent = "Запас " + Math.ceil(target.reserve) + " ед. · цена рынка от " + getSalePrice(state, state.selectedMarketId, target.resourceId).toFixed(1) + " ¢";
  } else if (target) {
    ui.objectKicker.textContent = "ТОРГОВАЯ ТОЧКА / " + target.label;
    ui.objectName.textContent = "Станция «" + target.name + "»";
    ui.objectDetail.textContent = "Рынок выбран для продажи груза";
  }
  updateInterface();
}
function openShipPanel(open = true) {
  shipPanelOpen = open;
  ui.shipPanel.classList.toggle("open", open);
  ui.shipPanel.setAttribute("aria-hidden", String(!open));
}
function setConfigureMode(open) {
  configuring = open;
  ui.config.classList.toggle("open", open);
  ui.config.setAttribute("aria-hidden", String(!open));
  ui.hint.textContent = open ? "ВЫБЕРИТЕ СЛОТ НА КОРПУСЕ · УСТАНОВИТЕ МОДУЛЬ" : "ВЫБЕРИТЕ КОРАБЛЬ ИЛИ ЦЕЛЬ НА КАРТЕ";
  ui.hint.classList.toggle("config-hint", open);
  if (open) {
    openShipPanel(false);
    const cell = cellAtKey(selectedSlot);
    if (cell) activeCategory = cell.compartment;
    renderModuleDock();
  }
}
function updateInterface() {
  const ship = syncActiveShip();
  const target = currentTarget();
  const asteroid = selectedAsteroid();
  const market = selectedMarket();
  const stats = updateShipFromDesign();
  const ratio = Math.min(1, ship.cargo / Math.max(1, ship.cargoCapacity));
  ui.credits.textContent = formatCredits(state.credits);
  ui.reputation.textContent = String(Math.floor(ship.totalSold / 10));
  ui.clock.textContent = formatDuration(state.gameSeconds);
  ui.status.textContent = state.paused ? "СИМУЛЯЦИЯ НА ПАУЗЕ" : "СИСТЕМА АКТИВНА";
  ui.pause.textContent = state.paused ? "▶" : "Ⅱ";
  ui.pause.setAttribute("aria-pressed", String(state.paused));
  ui.speed.textContent = state.speedMultiplier + "×";
  ui.settingsPause.querySelector("strong").textContent = state.paused ? "▶" : "Ⅱ";
  ui.settingsSpeed.querySelector("strong").textContent = state.speedMultiplier + "×";
  ui.shipName.textContent = "«" + ship.name + "»";
  ui.shipState.textContent = getShipStatusLabel(state);
  ui.cargoValue.textContent = ship.cargo.toFixed(0) + " / " + ship.cargoCapacity;
  ui.cargoPercent.textContent = Math.round(ratio * 100) + "% ЗАПОЛНЕНИЕ";
  ui.miningValue.innerHTML = ship.miningRate.toFixed(1) + ' <small>ед./с</small>';
  ui.speedValue.innerHTML = Math.round(ship.travelSpeed) + ' <small>ед./с</small>';
  ui.moduleCount.textContent = String(stats.modulesCount);
  ui.powerLabel.textContent = stats.power < 0 ? "НЕХВАТКА ЭНЕРГИИ" : "ЭНЕРГИЯ СТАБИЛЬНА";
  ui.powerLabel.style.color = stats.power < 0 ? "#ff938e" : "var(--mint)";
  ui.bottomCargo.innerHTML = ship.cargo.toFixed(0) + ' <small>ед.</small>';
  ui.marketPrice.innerHTML = getSalePrice(state, market.id, asteroid.resourceId).toFixed(1) + ' <small>¢ / ед.</small>';
  const quote = getMarketQuote(state, market.id, asteroid.id);
  ui.expectedRevenue.innerHTML = formatCredits(ship.cargo > 0 ? Math.floor(ship.cargo * getSalePrice(state, market.id, ship.cargoResourceId)) : quote.expectedRevenue) + ' <small>¢</small>';
  ui.targetName.textContent = target ? (target.resourceId ? target.label + " · " + getResourceName(target.resourceId) : "Станция «" + target.name + "»") : "Нет назначения";
  ui.targetDescription.textContent = target ? (ship.state === "mining" ? "Добыча идёт автоматически. Корабль вернётся при заполнении трюма." : "Расстояние до цели: " + Math.ceil(getDistanceToTarget(state) ?? 0) + " ед.") : "Выберите объект на карте.";
  ui.targetProgress.style.width = target ? (ship.state === "mining" ? Math.min(100, ratio * 100) : Math.max(5, Math.min(100, (1 - (getDistanceToTarget(state) ?? 0) / Math.max(tripStartDistance, 1)) * 100))) + "%" : "0%";
  ui.autoExplore.setAttribute("aria-pressed", String(ship.autoRepeat));
  ui.autoExplore.innerHTML = ship.autoRepeat ? "Автоисследование <span>●</span>" : "Автоисследование <span>○</span>";
  const fleetStat = [...document.querySelectorAll(".bottom-stat")].find(el => el.querySelector("span")?.textContent === "ФЛОТ");
  if (fleetStat) fleetStat.querySelector("strong").innerHTML = String(state.ships.length).padStart(2,"0") + " <small>/ 03</small>";
  if (ui.fleetModal.classList.contains("open")) renderFleet();
  if (configuring) renderModuleDock();
}
function nearestAvailableAsteroid() {
  const ship = activeShip();
  return state.asteroids.filter((asteroid) => asteroid.reserve > 0 && (ship.cargo <= 0 || asteroid.resourceId === ship.cargoResourceId))
    .sort((a, b) => Math.hypot(a.x - state.ship.x, a.y - state.ship.y) - Math.hypot(b.x - state.ship.x, b.y - state.ship.y))[0] ?? null;
}
function runAutoExplore() {
  const ship = activeShip();
  if (!ship.autoRepeat || state.paused || ship.state !== "idle") return;
  if (ship.cargo > 0) { issueCommand(state.selectedMarketId); return; }
  const asteroid = nearestAvailableAsteroid();
  if (asteroid) issueCommand(asteroid.id);
  else { autoExplore = false; notify("В системе больше нет доступных астероидов."); updateInterface(); }
}

function drawBackground() {
  const w = CONFIG.map.width, h = CONFIG.map.height;
  ctx.fillStyle = "#070b12"; ctx.fillRect(0, 0, w, h);
  const nebula = ctx.createRadialGradient(w * .55, h * .44, 5, w * .55, h * .44, 530);
  nebula.addColorStop(0, "rgba(21,54,69,.28)"); nebula.addColorStop(.5, "rgba(14,31,46,.13)"); nebula.addColorStop(1, "rgba(7,11,18,0)");
  ctx.fillStyle = nebula; ctx.fillRect(0, 0, w, h);
  for (const star of stars) {
    ctx.globalAlpha = star.alpha; ctx.fillStyle = "#a9c7d9";
    ctx.fillRect(Math.round(star.x), Math.round(star.y), star.radius, star.radius);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(95,143,163,.12)"; ctx.lineWidth = 1; ctx.setLineDash([2, 13]);
  ctx.beginPath(); ctx.ellipse(615, 380, 420, 275, -.23, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(615, 380, 500, 325, -.23, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  for (let i = 0; i < 35; i++) {
    const a = i * 2.399, r = 90 + (i * 37 % 390);
    ctx.fillStyle = "rgba(108,145,161,.12)"; ctx.fillRect(610 + Math.cos(a) * r, 380 + Math.sin(a) * r * .7, 2, 2);
  }
}
function drawRoute() {
  const target = currentTarget(); if (!target || configuring) return;
  ctx.save(); ctx.strokeStyle = "rgba(169,244,207,.55)"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 9]);
  ctx.beginPath(); ctx.moveTo(state.ship.x, state.ship.y); ctx.lineTo(target.x, target.y); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
}
function drawAsteroid(asteroid) {
  const color = CONFIG.resources[asteroid.resourceId].color;
  ctx.save(); ctx.translate(asteroid.x, asteroid.y);
  if (asteroid.id === state.selectedAsteroidId || asteroid.id === state.ship.targetId) {
    ctx.strokeStyle = color + "77"; ctx.setLineDash([2, 7]); ctx.beginPath(); ctx.arc(0, 0, 39, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.fillStyle = color + "0c"; ctx.beginPath(); ctx.arc(0, 0, 32, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = asteroid.reserve > 0 ? "#454b50" : "#292f35"; ctx.strokeStyle = asteroid.reserve > 0 ? "#9e947d" : "#59616a"; ctx.lineWidth = 1.5;
  ctx.beginPath();
  const points = [[-18,-5],[-12,-19],[2,-22],[17,-12],[22,3],[11,18],[-5,20],[-21,9]];
  points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.fillRect(-8,-6,5,4); ctx.fillRect(7,5,3,3); ctx.fillRect(1,-15,3,3);
  ctx.fillStyle = "#a5b7c4"; ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textAlign = "center"; ctx.fillText(asteroid.label,0,36);
  ctx.fillStyle = color; ctx.font = "8px 'IBM Plex Mono', monospace"; ctx.fillText(asteroid.reserve > 0 ? Math.ceil(asteroid.reserve) + " u" : "EMPTY",0,48);
  ctx.restore();
}
function drawMarket(market) {
  ctx.save(); ctx.translate(market.x,market.y);
  if (market.id === state.selectedMarketId || market.id === state.ship.targetId) {
    ctx.strokeStyle = "rgba(114,217,232,.55)"; ctx.beginPath(); ctx.arc(0,0,42,0,Math.PI*2); ctx.stroke();
  }
  ctx.fillStyle = "rgba(114,217,232,.055)"; ctx.beginPath(); ctx.arc(0,0,30,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = "#72d9e8"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0,0,20,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle = "#16333c"; ctx.strokeStyle = "#91eaf1";
  ctx.beginPath(); ctx.moveTo(-13,-2); ctx.lineTo(-7,-13); ctx.lineTo(8,-13); ctx.lineTo(14,-2); ctx.lineTo(14,9); ctx.lineTo(-13,9); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#b7f7fa"; ctx.fillRect(-6,-8,4,4); ctx.fillRect(3,-8,4,4); ctx.fillRect(-2,2,4,6);
  ctx.fillStyle = "#a6bac8"; ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textAlign = "center"; ctx.fillText(market.label,0,37);
  ctx.fillStyle = "#72d9e8"; ctx.font = "8px 'IBM Plex Mono', monospace"; ctx.fillText(getSalePrice(state,market.id,selectedAsteroid().resourceId).toFixed(1)+" CR",0,49);
  ctx.restore();
}
function getSlotLayout() {
  const cells = design.cells;
  const minX = Math.min(...cells.map(c=>c.x)), maxX = Math.max(...cells.map(c=>c.x));
  const minY = Math.min(...cells.map(c=>c.y)), maxY = Math.max(...cells.map(c=>c.y));
  const cellSize = 37, gap = 7;
  const width = (maxX-minX+1)*cellSize + (maxX-minX)*gap;
  const height = (maxY-minY+1)*cellSize + (maxY-minY)*gap;
  return cells.map(cell=>({
    cell, x: 600-width/2 + (cell.x-minX)*(cellSize+gap)+cellSize/2,
    y: 350-height/2 + (cell.y-minY)*(cellSize+gap)+cellSize/2,
    size: cellSize
  }));
}
function drawShipAt(x,y,angle,zoom,selected=false) {
  // Placeholder rendering only: replace this abstract navigation marker with final art later.
  ctx.save(); ctx.translate(x,y); ctx.scale(zoom,zoom);
  ctx.strokeStyle = selected ? "#d2ffe9" : "rgba(169,244,207,.78)";
  ctx.lineWidth = selected ? 2 : 1.25;
  ctx.beginPath(); ctx.arc(0,0,13,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle = "rgba(169,244,207,.25)";
  ctx.setLineDash([2,4]); ctx.beginPath(); ctx.arc(0,0,22,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = "#a9f4cf"; ctx.beginPath(); ctx.arc(0,0,3.5,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = "rgba(169,244,207,.7)"; ctx.fillRect(-26,-1,7,2); ctx.fillRect(19,-1,7,2);
  ctx.restore();
}
function drawConfiguredShip() {
  // Module positions are schematic placeholders, not a rendered ship hull.
  const slots = getSlotLayout();
  for (const slot of slots) {
    const cell = slot.cell, selected = cell.x+","+cell.y === selectedSlot;
    const def = moduleLevelDefinition(cell);
    const color = cell.compartment === "mining" ? "#ffc879" : cell.compartment === "cargo" ? "#72d9e8" : cell.compartment === "engine" ? "#b8a0ff" : "#a9f4cf";
    ctx.save(); ctx.translate(slot.x,slot.y);
    ctx.fillStyle = selected ? "rgba(169,244,207,.23)" : "rgba(7,14,21,.88)";
    ctx.strokeStyle = selected ? "#c6ffe4" : color; ctx.lineWidth = selected ? 2.5 : 1.2;
    ctx.fillRect(-slot.size/2,-slot.size/2,slot.size,slot.size); ctx.strokeRect(-slot.size/2,-slot.size/2,slot.size,slot.size);
    ctx.fillStyle = color; ctx.font = "bold 9px 'IBM Plex Mono', monospace"; ctx.textAlign = "center";
    ctx.fillText(cell.moduleId ? shortNames[cell.moduleId] : "EMPTY",0,-2);
    ctx.fillStyle = "#d5e3eb"; ctx.font = "8px 'IBM Plex Mono', monospace"; ctx.fillText(def ? "LV "+cell.moduleLevel : categoryNames[cell.compartment].toUpperCase(),0,10);
    ctx.restore();
  }
  ctx.save();
  ctx.strokeStyle = "rgba(169,244,207,.15)"; ctx.setLineDash([3,8]); ctx.beginPath(); ctx.arc(600,350, Math.max(90, Math.min(230, slots.length*17)), 0, Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = "#a8c5d2"; ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textAlign = "center";
  ctx.fillText("СХЕМА МОДУЛЬНЫХ СИСТЕМ",600,350+Math.max(90, Math.min(230, slots.length*17))+24);
  ctx.restore();
}
function drawShip() {
  if (configuring) { drawConfiguredShip(); return; }
  const ship = state.ship, moving = ship.state.startsWith("travel-to");
  drawShipAt(ship.x,ship.y,moving?Math.atan2(ship.vy,ship.vx):0,1,shipPanelOpen);
  ctx.fillStyle = "#d6e8e6"; ctx.font = "600 10px 'IBM Plex Mono', monospace"; ctx.textAlign = "center";
  ctx.fillText("ПИОНЕР",ship.x,ship.y+34);
  ctx.fillStyle = "#8199a8"; ctx.font = "8px 'IBM Plex Mono', monospace"; ctx.fillText(Math.floor(ship.cargo)+" / "+ship.cargoCapacity+" CARGO",ship.x,ship.y+46);
  if (shipPanelOpen) { ctx.strokeStyle = "rgba(169,244,207,.75)"; ctx.setLineDash([3,5]); ctx.beginPath(); ctx.arc(ship.x,ship.y,40,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]); }
}
function drawMap() {
  drawBackground();
  if (!configuring) {
    drawRoute();
    for (const asteroid of state.asteroids) drawAsteroid(asteroid);
    for (const market of state.markets) drawMarket(market);
  } else {
    const glow = ctx.createRadialGradient(600,350,25,600,350,300);
    glow.addColorStop(0,"rgba(80,160,146,.1)"); glow.addColorStop(1,"rgba(7,11,18,0)");
    ctx.fillStyle = glow; ctx.fillRect(250,80,700,560);
    ctx.fillStyle = "rgba(169,244,207,.035)"; ctx.fillRect(0,0,1200,760);
  }
  drawShip();
}
function canvasPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return { x:(event.clientX-rect.left)*canvas.width/rect.width, y:(event.clientY-rect.top)*canvas.height/rect.height };
}
function handleMapClick(event) {
  const point = canvasPosition(event);
  if (configuring) {
    const slot = getSlotLayout().find(item => Math.hypot(point.x-item.x,point.y-item.y) < item.size*.72);
    if (slot) {
      selectedSlot = slot.cell.x+","+slot.cell.y;
      activeCategory = slot.cell.compartment;
      renderModuleDock(); drawMap(); return;
    }
    return;
  }
  if (Math.hypot(point.x-state.ship.x,point.y-state.ship.y) < 38) {
    openShipPanel(true); ui.objectKicker.textContent="КОРАБЛЬ / 01"; ui.objectName.textContent="«"+state.ship.name+"»"; ui.objectDetail.textContent=getShipStatusLabel(state); return;
  }
  const asteroid = state.asteroids.find(item=>Math.hypot(point.x-item.x,point.y-item.y)<34);
  if (asteroid) { state.selectedAsteroidId=asteroid.id; issueCommand(asteroid.id); return; }
  const market = state.markets.find(item=>Math.hypot(point.x-item.x,point.y-item.y)<34);
  if (market) { state.selectedMarketId=market.id; issueCommand(market.id); return; }
}
function renderModuleDock() {
  const cell = cellAtKey(selectedSlot);
  const stats = shipStats();
  ui.modulePower.textContent = (stats.power > 0 ? "+" : "") + stats.power + " MW";
  ui.slotLabel.textContent = cell ? "Слот " + (cell.x+1) + "—" + (cell.y+1) + " · " + categoryNames[cell.compartment] : "Выберите квадрат на корпусе";
  ui.moduleCategories.querySelectorAll("[data-category]").forEach(button => {
    button.classList.toggle("active",button.dataset.category===activeCategory);
    button.disabled = !design.cells.some(item=>item.compartment===button.dataset.category);
  });
  ui.moduleOptions.replaceChildren();
  if (!cell) { ui.configHint.textContent="На корпусе нет выбранного слота."; return; }
  if (cell.compartment !== activeCategory) {
    ui.configHint.textContent="Выберите слот типа «"+categoryNames[activeCategory]+"» на корабле.";
    const note=document.createElement("div"); note.className="module-empty"; note.textContent="Слот другого типа. Выберите совместимый слот на корпусе."; ui.moduleOptions.append(note); return;
  }
  ui.configHint.textContent="Установка меняет характеристики корабля и списывает стоимость модуля.";
  const compatible = getCompatibleModules(cell.compartment);
  for (const item of compatible) {
    const definition = CONFIG.construction.moduleDefinitions[item.id];
    for (const level of [1,2]) {
      const spec = definition.levels[level];
      if (!spec) continue;
      const button=document.createElement("button"); button.type="button"; button.className="module-option";
      const already = cell.moduleId===item.id && Number(cell.moduleLevel)===level;
      if (already) button.classList.add("selected");
      const title=document.createElement("strong"); title.textContent=spec.name || item.name;
      const details=document.createElement("span");
      const traits=[];
      if (spec.miningRate) traits.push(spec.miningRate+" ед./с добычи");
      if (spec.cargoCapacity) traits.push(spec.cargoCapacity+" ед. трюма");
      if (spec.travelSpeed) traits.push(spec.travelSpeed+" ед./с скорости");
      if (spec.power) traits.push((spec.power>0?"+":"")+spec.power+" MW");
      details.textContent=traits.join(" · ") || "Системный модуль";
      const price=document.createElement("span"); price.innerHTML="<em>"+(already?"УСТАНОВЛЕН":formatCredits(spec.cost)+" ¢")+"</em>";
      button.append(title,details,price);
      const oldSpec=moduleLevelDefinition(cell);
      const purchaseCost=already?0:Math.max(0,spec.cost-(cell.moduleId===item.id && oldSpec ? oldSpec.cost : 0));
      const candidate=cloneDesign(design);
      configureCell(candidate,selectedSlot,{moduleId:item.id,moduleLevel:level});
      const candidateStats=calculateDesignStats(candidate);
      const required=["mining","storage","engine","reactor"].every(id=>candidate.cells.some(c=>c.moduleId===id));
      const validPower=candidateStats.power>=0;
      if (!already && (state.credits<purchaseCost || !validPower || !required)) button.disabled=true;
      if (button.disabled) button.title = state.credits<purchaseCost ? "Недостаточно кредитов" : !validPower ? "Недостаточно энергии" : "Нужны все четыре основные системы";
      button.addEventListener("click",()=>installModule(item.id,level));
      ui.moduleOptions.append(button);
    }
  }
}
function installModule(moduleId,level) {
  const cell=cellAtKey(selectedSlot); if (!cell) return;
  if (cell.moduleId===moduleId && Number(cell.moduleLevel)===level) return;
  const spec=CONFIG.construction.moduleDefinitions[moduleId]?.levels[level];
  const oldSpec=moduleLevelDefinition(cell);
  const cost=Math.max(0,(spec?.cost??0)-(cell.moduleId===moduleId?(oldSpec?.cost??0):0));
  if (state.credits<cost) return notify("Недостаточно кредитов для установки модуля.");
  const candidate=cloneDesign(design);
  const result=configureCell(candidate,selectedSlot,{moduleId,moduleLevel:level});
  if (!result.ok) return notify(result.reason);
  const stats=calculateDesignStats(candidate);
  if (stats.power<0) return notify("Установка невозможна: энергобаланс станет отрицательным.");
  if (!["mining","storage","engine","reactor"].every(id=>candidate.cells.some(c=>c.moduleId===id))) return notify("Нельзя отключить одну из четырёх основных систем.");
  design=candidate; state.credits-=cost; updateShipFromDesign();
  logEvent("system","Установлен модуль «"+(spec?.name??moduleId)+"» за "+formatCredits(cost)+" ¢.");
  notify("Модуль установлен. Стоимость: "+formatCredits(cost)+" ¢.");
  renderModuleDock(); updateInterface(); drawMap();
}
function openSettings(open) {
  ui.settings.classList.toggle("open",open); ui.settings.setAttribute("aria-hidden",String(!open));
}
function togglePause() { setPaused(state,!state.paused); updateInterface(); }
function toggleSpeed() { setSpeedMultiplier(state,state.speedMultiplier===1?2:1); updateInterface(); }

ui.settingsButton = $("#settings-button");
ui.autoExplore = $("#auto-explore-button");
ui.settingsButton.addEventListener("click",()=>openSettings(true));
function shipStatus(ship) { const previous=state.ship; state.ship=ship; const label=getShipStatusLabel(state); state.ship=previous; return label; }
function openFleet(open=true) { ui.fleetModal.classList.toggle("open",open); ui.fleetModal.setAttribute("aria-hidden",String(!open)); if(open) renderFleet(); }
function renderFleet() {
  ui.fleetList.replaceChildren();
  for (const ship of state.ships) {
    const row=document.createElement("div"); row.className="fleet-row"+(ship.id===state.selectedShipId?" selected":"");
    const main=document.createElement("div"); main.className="fleet-row-main";
    const title=document.createElement("strong"); title.textContent=ship.name+(ship.id===state.selectedShipId?" · ВЫБРАН":"");
    const detail=document.createElement("small"); detail.textContent=shipStatus(ship)+" · Груз "+Math.floor(ship.cargo)+"/"+ship.cargoCapacity+" · "+(ship.autoRepeat?"автоповтор включён":"ручное управление");
    main.append(title,detail);
    const actions=document.createElement("div"); actions.className="fleet-row-actions";
    const choose=document.createElement("button"); choose.type="button"; choose.textContent="Выбрать"; choose.disabled=ship.id===state.selectedShipId;
    choose.addEventListener("click",()=>{selectShip(state,ship.id);openShipPanel(true);updateInterface();drawMap();renderFleet();});
    const repeat=document.createElement("button"); repeat.type="button"; repeat.textContent=ship.autoRepeat?"Автоповтор: ВКЛ":"Автоповтор: ВЫКЛ"; repeat.setAttribute("aria-pressed",String(ship.autoRepeat));
    repeat.addEventListener("click",()=>{setShipAutoRepeat(state,!ship.autoRepeat,ship.id);renderFleet();updateInterface();});
    actions.append(choose,repeat); row.append(main,actions); ui.fleetList.append(row);
  }
  const cost=600+(state.ships.length-1)*400; ui.buyShipCost.textContent=state.ships.length>=3?"ЛИМИТ":cost+" ¢";
  ui.buyShip.disabled=state.ships.length>=3||state.credits<cost;
}
ui.fleetButton.addEventListener("click",()=>openFleet(true));
$("#close-fleet").addEventListener("click",()=>openFleet(false));
$("#fleet-scrim").addEventListener("click",()=>openFleet(false));
ui.buyShip.addEventListener("click",()=>{const result=buyShip(state);if(!result.ok){notify(result.reason);return;}selectShip(state,result.ship.id);openShipPanel(true);notify("В состав флота принят корабль «"+result.ship.name+"».");renderFleet();updateInterface();drawMap();});
$("#close-settings").addEventListener("click",()=>openSettings(false));
$("#settings-scrim").addEventListener("click",()=>openSettings(false));
$("#close-ship-panel").addEventListener("click",()=>openShipPanel(false));
$("#configure-button").addEventListener("click",()=>setConfigureMode(true));
$("#close-configure").addEventListener("click",()=>setConfigureMode(false));
$("#auto-explore-button").addEventListener("click",()=>{ const ship=activeShip(); setShipAutoRepeat(state,!ship.autoRepeat,ship.id); updateInterface(); notify(ship.autoRepeat?"Автоповтор включён для «"+ship.name+"».":"Автоповтор выключен для «"+ship.name+"»."); runAutoExplore(); });
$("#pause-button").addEventListener("click",togglePause);
$("#speed-button").addEventListener("click",toggleSpeed);
$("#settings-pause").addEventListener("click",togglePause);
$("#settings-speed").addEventListener("click",toggleSpeed);
ui.moduleCategories.querySelectorAll("[data-category]").forEach(button=>button.addEventListener("click",()=>{
  activeCategory=button.dataset.category;
  const first=design.cells.find(cell=>cell.compartment===activeCategory);
  if(first) selectedSlot=first.x+","+first.y;
  renderModuleDock();drawMap();
}));
canvas.addEventListener("click",handleMapClick);
document.addEventListener("keydown",event=>{
  if(event.key==="Escape"){
    if(configuring)setConfigureMode(false);
    else if(ui.fleetModal.classList.contains("open"))openFleet(false);
    else if(ui.settings.classList.contains("open"))openSettings(false);
    else openShipPanel(false);
  }
  if(event.code==="Space" && !["INPUT","TEXTAREA","BUTTON"].includes(document.activeElement?.tagName)){event.preventDefault();togglePause();}
  if(event.key==="1" && state.speedMultiplier!==1)toggleSpeed();
  if(event.key==="2" && state.speedMultiplier!==2)toggleSpeed();
});
function frame(now) {
  const delta=Math.min((now-lastFrame)/1000,CONFIG.simulation.maxRealDelta);
  lastFrame=now;stepSimulation(state,delta); syncActiveShip();
  if(state.ship.targetId!==lastTargetId){lastTargetId=state.ship.targetId;tripStartDistance=getDistanceToTarget(state)||1;}
  runAutoExplore();drawMap();
  if(now-lastUiUpdate>150){updateInterface();lastUiUpdate=now;}
  requestAnimationFrame(frame);
}
function initialize() {
  ctx.imageSmoothingEnabled=false;
  updateInterface();
  ui.objectKicker.textContent="СЕКТОР 01";ui.objectName.textContent="Пояс астероидов";ui.objectDetail.textContent="8 астероидов · 3 торговые станции";
  requestAnimationFrame(frame);
}
initialize();
