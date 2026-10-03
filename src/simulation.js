import { CONFIG } from "./config.js";

const distanceBetween = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function addEvent(state, type, message) {
  state.events.push({ id: state.nextEventId++, time: state.gameSeconds, type, message });
  if (state.events.length > 80) state.events.shift();
}

export function createInitialState() {
  const { ship, asteroid, market, credits, gameSeconds } = CONFIG.start;
  return {
    version: CONFIG.version,
    credits,
    gameSeconds,
    paused: false,
    speedMultiplier: CONFIG.simulation.initialSpeedMultiplier,
    ship: {
      id: "ship-01",
      name: "Пионер",
      x: ship.x,
      y: ship.y,
      vx: 0,
      vy: 0,
      cargo: 0,
      cargoCapacity: ship.cargoCapacity,
      miningRate: ship.miningRate,
      travelSpeed: ship.travelSpeed,
      targetId: null,
      state: "idle",
      lastSaleId: null,
      totalSold: 0
    },
    asteroid: {
      id: asteroid.id,
      x: asteroid.x,
      y: asteroid.y,
      reserve: asteroid.reserve,
      initialReserve: asteroid.reserve,
      resourceId: asteroid.resourceId
    },
    market: {
      id: market.id,
      x: market.x,
      y: market.y,
      basePrice: market.price,
      demandMultiplier: 1,
      salesCount: 0
    },
    events: [],
    nextEventId: 1,
    lastSale: null
  };
}

export function getSalePrice(state) {
  const { salePriceMinMultiplier, salePriceMaxMultiplier } = CONFIG.market;
  const multiplier = Math.min(
    salePriceMaxMultiplier,
    Math.max(salePriceMinMultiplier, state.market.demandMultiplier)
  );
  return Math.max(0, state.market.basePrice * multiplier);
}

export function getExpectedSaleValue(state) {
  return Math.floor(state.ship.cargo * getSalePrice(state));
}

export function getDistanceToTarget(state) {
  const target = getTarget(state, state.ship.targetId);
  return target ? distanceBetween(state.ship, target) : null;
}

function getTarget(state, targetId) {
  if (targetId === state.asteroid.id) return state.asteroid;
  if (targetId === state.market.id) return state.market;
  return null;
}

export function commandShip(state, targetId) {
  const target = getTarget(state, targetId);
  if (!target) return { ok: false, reason: "Неизвестная цель." };

  if (targetId === state.asteroid.id) {
    if (state.asteroid.reserve <= 0) {
      return { ok: false, reason: "Астероид истощён." };
    }
    if (state.ship.cargo >= state.ship.cargoCapacity) {
      return { ok: false, reason: "Трюм заполнен. Сначала доставьте груз на рынок." };
    }
    state.ship.targetId = targetId;
    state.ship.state = "travel-to-asteroid";
    addEvent(state, "command", "Корабль получил курс на астероид A-01.");
    return { ok: true };
  }

  if (targetId === state.market.id) {
    state.ship.targetId = targetId;
    state.ship.state = state.ship.cargo > 0 ? "travel-to-market" : "travel-to-market-empty";
    addEvent(state, "command", state.ship.cargo > 0
      ? "Корабль направляется на станцию для продажи груза."
      : "Корабль направляется на станцию «Меридиан».");
    return { ok: true };
  }

  return { ok: false, reason: "Не удалось назначить цель." };
}

export function sellCargo(state) {
  const ship = state.ship;
  if (distanceBetween(ship, state.market) > CONFIG.navigation.arrivalRadius + 2) {
    return { ok: false, reason: "Корабль должен прибыть на торговую станцию." };
  }
  if (ship.cargo <= 0) {
    return { ok: false, reason: "В трюме нет груза для продажи." };
  }

  const quantity = ship.cargo;
  const unitPrice = getSalePrice();
  const revenue = Math.floor(quantity * unitPrice);
  if (revenue <= 0) return { ok: false, reason: "Стоимость сделки должна быть положительной." };

  // Transaction is atomic: capture the cargo, credit the account, then clear the cargo once.
  const saleId = `sale-${state.nextEventId}-${Math.floor(state.gameSeconds * 1000)}`;
  ship.cargo = 0;
  state.credits += revenue;
  ship.totalSold += quantity;
  ship.lastSaleId = saleId;
  state.market.salesCount += 1;
  state.lastSale = { id: saleId, quantity, unitPrice, revenue, time: state.gameSeconds };
  ship.targetId = null;
  ship.state = "idle";
  addEvent(state, "sale", `Продано ${quantity} ед. руды за ${revenue} ¢ (${unitPrice.toFixed(1)} ¢/ед.).`);
  return { ok: true, sale: state.lastSale };
}

function beginReturnToMarket(state, reason) {
  state.ship.targetId = state.market.id;
  state.ship.state = "travel-to-market";
  addEvent(state, "logistics", reason);
}

function arriveAtTarget(state) {
  const ship = state.ship;
  if (ship.targetId === state.asteroid.id) {
    if (ship.cargo >= ship.cargoCapacity) {
      beginReturnToMarket(state, "Трюм заполнен: автоматический возврат на станцию.");
    } else if (state.asteroid.reserve <= 0) {
      if (ship.cargo > 0) {
        beginReturnToMarket(state, "Астероид истощён: возвращение с добытым грузом.");
      } else {
        ship.state = "idle";
        ship.targetId = null;
        addEvent(state, "info", "Астероид A-01 истощён. Требуется выбрать другую цель.");
      }
    } else {
      ship.state = "mining";
      addEvent(state, "mining", "Начата добыча железной руды на астероиде A-01.");
    }
  } else if (ship.targetId === state.market.id) {
    if (ship.cargo > 0) {
      sellCargo(state);
    } else {
      ship.state = "idle";
      ship.targetId = null;
      addEvent(state, "info", "Корабль прибыл на станцию. Груз для продажи отсутствует.");
    }
  }
}

function updateShipMovement(state, dt) {
  const ship = state.ship;
  if (ship.state !== "travel-to-asteroid" && ship.state !== "travel-to-market" && ship.state !== "travel-to-market-empty") {
    return;
  }
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
    ship.x = target.x - (dx / (distance || 1)) * Math.min(CONFIG.navigation.arrivalRadius * 0.55, distance);
    ship.y = target.y - (dy / (distance || 1)) * Math.min(CONFIG.navigation.arrivalRadius * 0.55, distance);
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

  if (distanceBetween(ship, state.asteroid) > CONFIG.navigation.arrivalRadius + 2) {
    ship.state = "travel-to-asteroid";
    return;
  }

  const freeSpace = ship.cargoCapacity - ship.cargo;
  const mined = Math.min(ship.miningRate * dt, freeSpace, state.asteroid.reserve);
  if (mined > 0) {
    ship.cargo += mined;
    state.asteroid.reserve -= mined;
  }

  if (ship.cargo >= ship.cargoCapacity - 1e-6) {
    ship.cargo = ship.cargoCapacity;
    beginReturnToMarket(state, "Трюм заполнен: автоматический возврат на станцию.");
  } else if (state.asteroid.reserve <= 1e-6) {
    state.asteroid.reserve = 0;
    if (ship.cargo > 0) beginReturnToMarket(state, "Запас астероида исчерпан: возвращение с грузом.");
    else {
      ship.state = "idle";
      ship.targetId = null;
    }
  }
}

export function stepSimulation(state, realDeltaSeconds) {
  if (state.paused || !Number.isFinite(realDeltaSeconds) || realDeltaSeconds <= 0) return state;
  const realDt = Math.min(realDeltaSeconds, CONFIG.simulation.maxRealDelta);
  const dt = realDt * state.speedMultiplier;
  state.gameSeconds += dt;

  updateShipMovement(state, dt);
  updateMining(state, dt);
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
