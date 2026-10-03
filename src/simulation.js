import { CONFIG } from "./config.js";

const distanceBetween = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function addEvent(state, type, message) {
  state.events.push({ id: state.nextEventId++, time: state.gameSeconds, type, message });
  if (state.events.length > 80) state.events.shift();
}

function getAsteroid(state, id) {
  return state.asteroids.find((asteroid) => asteroid.id === id) ?? null;
}

function getMarket(state, id) {
  return state.markets.find((market) => market.id === id) ?? null;
}

function getTarget(state, targetId) {
  return getAsteroid(state, targetId) ?? getMarket(state, targetId);
}

export function createInitialState() {
  const shipConfig = CONFIG.start.ship;
  const asteroids = CONFIG.asteroids.map((asteroid) => ({
    ...asteroid,
    initialReserve: asteroid.reserve
  }));
  const markets = CONFIG.markets.map((market) => ({
    ...market,
    baselineDemand: { ...market.baselineDemand },
    demandMultipliers: { ...market.baselineDemand },
    salesCount: 0
  }));

  const firstShip = {
      id: "ship-01",
      name: "Пионер",
      x: shipConfig.x,
      y: shipConfig.y,
      vx: 0,
      vy: 0,
      cargo: 0,
      cargoResourceId: null,
      cargoCapacity: shipConfig.cargoCapacity,
      miningRate: shipConfig.miningRate,
      travelSpeed: shipConfig.travelSpeed,
      targetId: null,
      state: "idle",
      lastSaleId: null,
      totalSold: 0,
      autoRepeat: false,
      design: null
  };

  return {
    version: CONFIG.version,
    credits: CONFIG.start.credits,
    gameSeconds: CONFIG.start.gameSeconds,
    nextMarketUpdateAt: CONFIG.market.updateIntervalSeconds,
    paused: false,
    speedMultiplier: CONFIG.simulation.initialSpeedMultiplier,
    ship: firstShip,
    ships: [firstShip],
    selectedShipId: firstShip.id,
    asteroids,
    markets,
    selectedAsteroidId: asteroids[0].id,
    selectedMarketId: markets[0].id,
    events: [],
    nextEventId: 1,
    lastSale: null
  };
}

export function getSalePrice(state, marketId = state.selectedMarketId, resourceId = state.ship.cargoResourceId ?? "iron-ore") {
  const market = getMarket(state, marketId);
  const resource = CONFIG.resources[resourceId];
  if (!market || !resource) return 0;
  const multiplier = market.demandMultipliers[resourceId] ?? 1;
  const boundedMultiplier = Math.min(
    CONFIG.market.salePriceMaxMultiplier,
    Math.max(CONFIG.market.salePriceMinMultiplier, multiplier)
  );
  return resource.basePrice * boundedMultiplier;
}

export function getExpectedSaleValue(state, marketId = state.selectedMarketId, resourceId = state.ship.cargoResourceId ?? "iron-ore") {
  return Math.floor(state.ship.cargo * getSalePrice(state, marketId, resourceId));
}

export function getDistanceToTarget(state) {
  const target = getTarget(state, state.ship.targetId);
  return target ? distanceBetween(state.ship, target) : null;
}

export function getDistanceBetweenShipAnd(state, targetId) {
  const target = getTarget(state, targetId);
  return target ? distanceBetween(state.ship, target) : null;
}

export function getResourceName(resourceId) {
  return CONFIG.resources[resourceId]?.name ?? "Неизвестный ресурс";
}

export function getMarketQuote(state, marketId, asteroidId = state.selectedAsteroidId) {
  const market = getMarket(state, marketId);
  const asteroid = getAsteroid(state, asteroidId);
  if (!market || !asteroid) return null;
  const unitPrice = getSalePrice(state, marketId, asteroid.resourceId);
  const quantity = Math.min(state.ship.cargoCapacity, asteroid.reserve);
  const distance = distanceBetween(asteroid, market);
  return {
    marketId,
    marketName: market.name,
    resourceId: asteroid.resourceId,
    unitPrice,
    distance,
    expectedRevenue: Math.floor(quantity * unitPrice),
    quantity
  };
}

export function selectMarket(state, marketId) {
  const market = getMarket(state, marketId);
  if (!market) return { ok: false, reason: "Неизвестная торговая точка." };
  state.selectedMarketId = market.id;
  return { ok: true };
}

function commandCurrentShip(state, targetId) {
  const target = getTarget(state, targetId);
  if (!target) return { ok: false, reason: "Неизвестная цель." };

  const asteroid = getAsteroid(state, targetId);
  const market = getMarket(state, targetId);
  if (asteroid) {
    if (asteroid.reserve <= 0) return { ok: false, reason: "Астероид истощён." };
    if (state.ship.cargo >= state.ship.cargoCapacity) {
      return { ok: false, reason: "Трюм заполнен. Сначала доставьте груз на рынок." };
    }
    if (state.ship.cargo > 0 && state.ship.cargoResourceId !== asteroid.resourceId) {
      return { ok: false, reason: "Нельзя смешивать разные руды в одном трюме. Сначала продайте текущий груз." };
    }
    state.selectedAsteroidId = asteroid.id;
    if (state.ship.cargo === 0) state.ship.cargoResourceId = asteroid.resourceId;
    state.ship.targetId = asteroid.id;
    state.ship.state = "travel-to-asteroid";
    addEvent(state, "command", `Корабль получил курс на астероид ${asteroid.label}.`);
    return { ok: true };
  }

  if (market) {
    state.selectedMarketId = market.id;
    state.ship.targetId = market.id;
    state.ship.state = state.ship.cargo > 0 ? "travel-to-market" : "travel-to-market-empty";
    addEvent(state, "command", state.ship.cargo > 0
      ? `Корабль направляется на ${market.name} для продажи груза.`
      : `Корабль направляется на торговую точку ${market.name}.`);
    return { ok: true };
  }

  return { ok: false, reason: "Не удалось назначить цель." };
}

function nearestMarket(state) {
  return state.markets.reduce((best, market) =>
    distanceBetween(state.ship, market) < distanceBetween(state.ship, best) ? market : best
  , state.markets[0]);
}

function sellCurrentCargo(state, marketId = null) {
  const market = getMarket(state, marketId ?? state.ship.targetId)
    ?? state.markets.find((item) => distanceBetween(state.ship, item) <= CONFIG.navigation.arrivalRadius + 2);
  if (!market || distanceBetween(state.ship, market) > CONFIG.navigation.arrivalRadius + 2) {
    return { ok: false, reason: "Корабль должен прибыть на торговую станцию." };
  }
  if (state.ship.cargo <= 0 || !state.ship.cargoResourceId) {
    return { ok: false, reason: "В трюме нет груза для продажи." };
  }

  const quantity = state.ship.cargo;
  const resourceId = state.ship.cargoResourceId;
  const unitPrice = getSalePrice(state, market.id, resourceId);
  const revenue = Math.floor(quantity * unitPrice);
  if (revenue <= 0) return { ok: false, reason: "Стоимость сделки должна быть положительной." };

  const saleId = `sale-${state.nextEventId}-${Math.floor(state.gameSeconds * 1000)}`;
  state.ship.cargo = 0;
  state.ship.cargoResourceId = null;
  state.credits += revenue;
  state.ship.totalSold += quantity;
  state.ship.lastSaleId = saleId;
  market.salesCount += 1;
  market.demandMultipliers[resourceId] = Math.max(
    CONFIG.market.salePriceMinMultiplier,
    market.demandMultipliers[resourceId] - quantity * CONFIG.market.saleImpactPerUnit
  );
  state.lastSale = {
    id: saleId, quantity, resourceId, unitPrice, revenue, marketId: market.id,
    marketName: market.name, time: state.gameSeconds
  };
  state.ship.targetId = null;
  state.ship.state = "idle";
  addEvent(state, "sale", `Продано ${quantity.toFixed(0)} ед. ресурса «${getResourceName(resourceId)}» на станции «${market.name}» за ${revenue} ¢.`);
  return { ok: true, sale: state.lastSale };
}

function beginReturnToMarket(state, reason) {
  const market = getMarket(state, state.selectedMarketId) ?? nearestMarket(state);
  state.ship.targetId = market.id;
  state.ship.state = "travel-to-market";
  addEvent(state, "logistics", reason);
}

function arriveAtTarget(state) {
  const ship = state.ship;
  const asteroid = getAsteroid(state, ship.targetId);
  const market = getMarket(state, ship.targetId);
  if (asteroid) {
    if (ship.cargo >= ship.cargoCapacity) {
      beginReturnToMarket(state, "Трюм заполнен: автоматический возврат на выбранный рынок.");
    } else if (asteroid.reserve <= 0) {
      if (ship.cargo > 0) beginReturnToMarket(state, "Астероид истощён: возвращение с добытым грузом.");
      else {
        ship.state = "idle";
        ship.targetId = null;
        addEvent(state, "info", `Астероид ${asteroid.label} истощён. Требуется выбрать другую цель.`);
      }
    } else {
      ship.state = "mining";
      addEvent(state, "mining", `Начата добыча на астероиде ${asteroid.label}.`);
    }
  } else if (market) {
    if (ship.cargo > 0) {
      sellCargo(state, market.id);
    } else {
      ship.state = "idle";
      ship.targetId = null;
      addEvent(state, "info", `Корабль прибыл на ${market.name}. Груз для продажи отсутствует.`);
    }
  }
}

function updateShipMovement(state, dt) {
  const ship = state.ship;
  if (!ship.state.startsWith("travel-to")) return;
  const target = getTarget(state, ship.targetId);
  if (!target) {
    ship.state = "idle";
    ship.targetId = null;
    return;
  }

  const dx = target.x - ship.x;
  const dy = target.y - ship.y;
  const distance = Math.hypot(dx, dy);
  const travelDistance = ship.travelSpeed * dt;
  if (distance <= CONFIG.navigation.arrivalRadius || distance <= travelDistance + CONFIG.navigation.arrivalEpsilon) {
    const offset = Math.min(CONFIG.navigation.arrivalRadius * 0.55, distance);
    ship.x = target.x - (dx / (distance || 1)) * offset;
    ship.y = target.y - (dy / (distance || 1)) * offset;
    ship.vx = 0;
    ship.vy = 0;
    arriveAtTarget(state);
    return;
  }

  ship.vx = (dx / distance) * ship.travelSpeed;
  ship.vy = (dy / distance) * ship.travelSpeed;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
}

function updateMining(state, dt) {
  const ship = state.ship;
  if (ship.state !== "mining") return;
  const asteroid = getAsteroid(state, ship.targetId);
  if (!asteroid) {
    ship.state = "idle";
    ship.targetId = null;
    return;
  }
  if (distanceBetween(ship, asteroid) > CONFIG.navigation.arrivalRadius + 2) {
    ship.state = "travel-to-asteroid";
    return;
  }

  const freeSpace = ship.cargoCapacity - ship.cargo;
  const mined = Math.min(ship.miningRate * dt, freeSpace, asteroid.reserve);
  if (mined > 0) {
    ship.cargo += mined;
    asteroid.reserve -= mined;
  }

  if (ship.cargo >= ship.cargoCapacity - 1e-6) {
    ship.cargo = ship.cargoCapacity;
    beginReturnToMarket(state, "Трюм заполнен: автоматический возврат на выбранный рынок.");
  } else if (asteroid.reserve <= 1e-6) {
    asteroid.reserve = 0;
    if (ship.cargo > 0) beginReturnToMarket(state, "Запас астероида исчерпан: возвращение с грузом.");
    else {
      ship.state = "idle";
      ship.targetId = null;
    }
  }
}

function updateMarketDemand(state) {
  while (state.gameSeconds >= state.nextMarketUpdateAt) {
    for (const market of state.markets) {
      for (const resourceId of Object.keys(CONFIG.resources)) {
        const baseline = market.baselineDemand[resourceId] ?? 1;
        const current = market.demandMultipliers[resourceId] ?? baseline;
        market.demandMultipliers[resourceId] = current < baseline
          ? Math.min(baseline, current + CONFIG.market.recoveryPerUpdate)
          : current > baseline
            ? Math.max(baseline, current - CONFIG.market.recoveryPerUpdate)
            : baseline;
      }
    }
    state.nextMarketUpdateAt += CONFIG.market.updateIntervalSeconds;
  }
}

function stepCurrentShip(state, dt) {
  updateShipMovement(state, dt);
  updateMining(state, dt);
}

export function stepSimulation(state, realDeltaSeconds) {
  if (state.paused || !Number.isFinite(realDeltaSeconds) || realDeltaSeconds <= 0) return state;
  const realDt = Math.min(realDeltaSeconds, CONFIG.simulation.maxRealDelta);
  const dt = realDt * state.speedMultiplier;
  state.gameSeconds += dt;
  updateShipMovement(state, dt);
  updateMining(state, dt);
  updateMarketDemand(state);
  return state;
}

export function setPaused(state, paused) {
  state.paused = Boolean(paused);
  addEvent(state, "system", state.paused ? "Симуляция приостановлена." : "Симуляция возобновлена.");
}

export function setSpeedMultiplier(state, multiplier) {
  if (!CONFIG.simulation.allowedSpeedMultipliers.includes(multiplier)) {
    return { ok: false, reason: "Недопустимая скорость симуляции." };
  }
  state.speedMultiplier = multiplier;
  addEvent(state, "system", `Скорость симуляции: ${multiplier}×.`);
  return { ok: true };
}

export function getShipStatusLabel(state) {
  const labels = {
    idle: "Ожидает приказа",
    "travel-to-asteroid": "Перелёт к астероиду",
    mining: "Добывает ресурс",
    "travel-to-market": "Возвращается с грузом",
    "travel-to-market-empty": "Курс на станцию"
  };
  return labels[state.ship.state] ?? "Неизвестное состояние";
}


function withShip(state, shipId, callback) {
  const previous = state.ship;
  const ship = (state.ships ?? [previous]).find(item => item.id === shipId);
  if (!ship) return { ok: false, reason: "Корабль не найден." };
  state.ship = ship;
  try { return callback(); } finally { state.ship = previous; }
}

export function selectShip(state, shipId) {
  const ship = (state.ships ?? [state.ship]).find(item => item.id === shipId);
  if (!ship) return { ok: false, reason: "Корабль не найден." };
  state.selectedShipId = shipId;
  state.ship = ship;
  return { ok: true, ship };
}

export function commandShip(state, targetId, shipId = state.selectedShipId ?? state.ships?.[0]?.id) {
  return withShip(state, shipId, () => commandCurrentShip(state, targetId));
}

export function sellCargo(state, marketId = null, shipId = state.selectedShipId ?? state.ships?.[0]?.id) {
  return withShip(state, shipId, () => sellCurrentCargo(state, marketId));
}

export function buyShip(state) {
  const ships = state.ships ?? (state.ships = [state.ship]);
  if (ships.length >= 3) return { ok: false, reason: "Достигнут лимит флота: 3 корабля." };
  const cost = 600 + (ships.length - 1) * 400;
  if (state.credits < cost) return { ok: false, reason: "Недостаточно кредитов для нового корабля." };
  const template = ships[0];
  const id = "ship-" + String(ships.length + 1).padStart(2,"0");
  const ship = {
    ...template, id, name: ships.length === 1 ? "Старатель" : "Пионер-3",
    x: template.x + ships.length * 28, y: template.y + ships.length * 22, vx: 0, vy: 0,
    cargo: 0, cargoResourceId: null, targetId: null, state: "idle", lastSaleId: null,
    totalSold: 0, autoRepeat: false, design: null
  };
  state.credits -= cost;
  ships.push(ship);
  state.selectedShipId = ship.id;
  state.ship = ship;
  addEvent(state,"fleet",`В состав флота принят корабль «${ship.name}» за ${cost} ¢.`);
  return { ok: true, ship, cost };
}

export function setShipAutoRepeat(state, enabled, shipId = state.selectedShipId ?? state.ships?.[0]?.id) {
  return withShip(state, shipId, () => {
    state.ship.autoRepeat = Boolean(enabled);
    addEvent(state,"fleet",`Автоповтор маршрута для «${state.ship.name}»: ${state.ship.autoRepeat ? "включён" : "выключен"}.`);
    return { ok: true, enabled: state.ship.autoRepeat };
  });
}
