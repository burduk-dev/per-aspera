import { CONFIG } from "./config.js";

const RULES = CONFIG.construction;
const COMPARTMENT_TYPES = Object.freeze(["mining", "cargo", "engine", "reactor"]);
const COMPARTMENT_NAMES = Object.freeze({
  mining: "Добыча",
  cargo: "Хранилище",
  engine: "Двигатель",
  reactor: "Реактор"
});

function cloneCell(cell) {
  return { x: cell.x, y: cell.y, compartment: cell.compartment, level: cell.level, moduleId: cell.moduleId, moduleLevel: cell.moduleLevel };
}

export function createDefaultDesign() {
  const cells = [];
  const roles = [
    ["mining", "mining", 1],
    ["cargo", "storage", 1],
    ["engine", "engine", 1],
    ["reactor", "reactor", 1],
    ["cargo", null, 1],
    ["cargo", null, 1],
    ["cargo", null, 1],
    ["cargo", null, 1]
  ];
  let i = 0;
  for (let y = 1; y <= 2; y += 1) {
    for (let x = 1; x <= 4; x += 1) {
      const [compartment, moduleId, moduleLevel] = roles[i++];
      cells.push({ x, y, compartment, level: 1, moduleId, moduleLevel });
    }
  }
  return { name: "Стандартный добытчик", cells, selectedCell: "1,1" };
}

export function cloneDesign(design) {
  return { name: String(design.name ?? "Чертёж"), cells: design.cells.map(cloneCell), selectedCell: design.selectedCell ?? null };
}

export function cellKey(x, y) {
  return `${x},${y}`;
}

export function getCell(design, key = design.selectedCell) {
  return design.cells.find((cell) => cellKey(cell.x, cell.y) === key) ?? null;
}

export function addHullCell(design, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 6 || y < 0 || y > 4) {
    return { ok: false, reason: "Клетка находится за границами сетки 7×5." };
  }
  if (getCell(design, cellKey(x, y))) {
    design.selectedCell = cellKey(x, y);
    return { ok: true, selected: true };
  }
  if (design.cells.length >= RULES.maxCells) return { ok: false, reason: `В корпусе не может быть больше ${RULES.maxCells} клеток.` };
  const adjacent = design.cells.some((cell) => Math.abs(cell.x - x) + Math.abs(cell.y - y) === 1);
  if (design.cells.length > 0 && !adjacent) return { ok: false, reason: "Новая клетка должна примыкать к корпусу стороной." };
  design.cells.push({ x, y, compartment: "cargo", level: 1, moduleId: null, moduleLevel: 1 });
  design.selectedCell = cellKey(x, y);
  return { ok: true };
}

export function removeHullCell(design, key = design.selectedCell) {
  const index = design.cells.findIndex((cell) => cellKey(cell.x, cell.y) === key);
  if (index < 0) return { ok: false, reason: "Сначала выберите клетку корпуса." };
  if (design.cells.length <= RULES.minCells) return { ok: false, reason: `В корпусе должно остаться не меньше ${RULES.minCells} клеток.` };
  const removed = design.cells.splice(index, 1)[0];
  design.selectedCell = design.cells[0] ? cellKey(design.cells[0].x, design.cells[0].y) : null;
  const validation = validateDesign(design);
  if (!validation.errors.some((error) => error.code === "disconnected")) return { ok: true };
  design.cells.splice(index, 0, removed);
  design.selectedCell = key;
  return { ok: false, reason: "Нельзя удалить клетку: корпус должен оставаться связным." };
}

export function configureCell(design, key, changes) {
  const cell = getCell(design, key);
  if (!cell) return { ok: false, reason: "Выберите клетку корпуса." };
  if (changes.compartment !== undefined) {
    if (!COMPARTMENT_TYPES.includes(changes.compartment)) return { ok: false, reason: "Неизвестный тип отсека." };
    cell.compartment = changes.compartment;
    if (cell.moduleId && RULES.moduleDefinitions[cell.moduleId]?.compartment !== cell.compartment) {
      cell.moduleId = null;
      cell.moduleLevel = 1;
    }
  }
  if (changes.level !== undefined) {
    if (![1, 2].includes(Number(changes.level))) return { ok: false, reason: "Уровень отсека должен быть I или II." };
    cell.level = Number(changes.level);
  }
  if (changes.moduleId !== undefined) {
    if (changes.moduleId === "" || changes.moduleId === null) {
      cell.moduleId = null;
      cell.moduleLevel = 1;
    } else {
      const module = RULES.moduleDefinitions[changes.moduleId];
      if (!module) return { ok: false, reason: "Неизвестный модуль." };
      if (module.compartment !== cell.compartment) return { ok: false, reason: "Этот модуль несовместим с выбранным типом отсека." };
      cell.moduleId = changes.moduleId;
    }
  }
  if (changes.moduleLevel !== undefined) {
    if (![1, 2].includes(Number(changes.moduleLevel))) return { ok: false, reason: "Уровень модуля должен быть I или II." };
    cell.moduleLevel = Number(changes.moduleLevel);
  }
  return { ok: true };
}

export function getDesignShapeFactor(design) {
  if (!design.cells.length) return RULES.shapeComplexity.irregular;
  const xs = design.cells.map((cell) => cell.x);
  const ys = design.cells.map((cell) => cell.y);
  const width = Math.max(...xs) - Math.min(...xs) + 1;
  const height = Math.max(...ys) - Math.min(...ys) + 1;
  if (width === 1 || height === 1) return RULES.shapeComplexity.line;
  const fillRatio = design.cells.length / (width * height);
  return fillRatio >= 0.7 ? RULES.shapeComplexity.compact : RULES.shapeComplexity.irregular;
}

function connectedCells(cells) {
  if (!cells.length) return false;
  const keys = new Set(cells.map((cell) => cellKey(cell.x, cell.y)));
  const visited = new Set();
  const queue = [cells[0]];
  while (queue.length) {
    const current = queue.shift();
    const key = cellKey(current.x, current.y);
    if (visited.has(key)) continue;
    visited.add(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = cellKey(current.x + dx, current.y + dy);
      if (keys.has(next) && !visited.has(next)) {
        const [x, y] = next.split(",").map(Number);
        queue.push({ x, y });
      }
    }
  }
  return visited.size === cells.length;
}

export function validateDesign(design, credits = Infinity) {
  const errors = [];
  const cells = Array.isArray(design?.cells) ? design.cells : [];
  const addError = (code, message, key = null) => errors.push({ code, message, key });
  if (cells.length < RULES.minCells || cells.length > RULES.maxCells) {
    addError("cell-count", `Размер корпуса: от ${RULES.minCells} до ${RULES.maxCells} клеток.`);
  }
  const seen = new Set();
  for (const cell of cells) {
    const key = cellKey(cell.x, cell.y);
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.x > 6 || cell.y < 0 || cell.y > 4) {
      addError("bounds", "Клетка вне границ сетки 7×5.", key);
    }
    if (seen.has(key)) addError("duplicate", "Две клетки не могут занимать одну позицию.", key);
    seen.add(key);
    if (!COMPARTMENT_TYPES.includes(cell.compartment)) addError("compartment", "Неизвестный тип отсека.", key);
    if (![1, 2].includes(Number(cell.level))) addError("compartment-level", "Уровень отсека должен быть I или II.", key);
    if (cell.moduleId) {
      const module = RULES.moduleDefinitions[cell.moduleId];
      if (!module) addError("module", "Неизвестный модуль.", key);
      else {
        if (module.compartment !== cell.compartment) addError("compatibility", `Модуль «${module.name}» несовместим с отсеком «${COMPARTMENT_NAMES[cell.compartment] ?? cell.compartment}».`, key);
        if (!module.levels[Number(cell.moduleLevel)]) addError("module-level", "Недопустимый уровень модуля.", key);
      }
    }
  }
  if (cells.length && !connectedCells(cells)) addError("disconnected", "Все клетки корпуса должны быть соединены сторонами.");
  const quote = calculateDesignStats(design);
  if (quote.power < 0) addError("power", `Не хватает энергии: баланс ${quote.power} ед.`);
  if (quote.cost > credits) addError("credits", `Не хватает средств: нужно ${quote.cost} ¢, доступно ${Math.floor(credits)} ¢.`);
  return { valid: errors.length === 0, errors, stats: quote };
}

export function calculateDesignStats(design) {
  const cells = Array.isArray(design?.cells) ? design.cells : [];
  let compartmentCost = 0;
  let moduleCost = 0;
  let power = 0;
  let cargoCapacity = 0;
  let miningRate = 0;
  let travelSpeed = 0;
  let modulesCount = 0;
  for (const cell of cells) {
    compartmentCost += RULES.compartmentLevelCosts[Number(cell.level)] ?? 0;
    if (!cell.moduleId) continue;
    const module = RULES.moduleDefinitions[cell.moduleId];
    const moduleLevel = module?.levels[Number(cell.moduleLevel)];
    if (!moduleLevel) continue;
    moduleCost += moduleLevel.cost;
    power += moduleLevel.power;
    cargoCapacity += moduleLevel.cargoCapacity ?? 0;
    miningRate += moduleLevel.miningRate ?? 0;
    travelSpeed = Math.max(travelSpeed, moduleLevel.travelSpeed ?? 0);
    modulesCount += 1;
  }
  const hullCost = cells.length * RULES.cellCost;
  const shapeFactor = getDesignShapeFactor(design);
  const cost = Math.ceil((hullCost + compartmentCost + moduleCost) * shapeFactor);
  return {
    cellCount: cells.length, hullCost, compartmentCost, moduleCost, shapeFactor, cost,
    power, powerGeneration: Math.max(0, power), powerConsumption: Math.max(0, -power),
    cargoCapacity, miningRate, travelSpeed, modulesCount
  };
}

export function getCompartmentName(type) {
  return COMPARTMENT_NAMES[type] ?? "Неизвестный отсек";
}

export function getCompatibleModules(compartmentType) {
  return Object.entries(RULES.moduleDefinitions)
    .filter(([, definition]) => definition.compartment === compartmentType)
    .map(([id, definition]) => ({ id, name: definition.name }));
}
