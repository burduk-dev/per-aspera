export const CONFIG = Object.freeze({
  version: 1,
  map: Object.freeze({ width: 1200, height: 760 }),
  start: Object.freeze({
    credits: 1000,
    gameSeconds: 0,
    ship: Object.freeze({ x: 245, y: 405, cargoCapacity: 30, miningRate: 1, travelSpeed: 112 })
  }),
  resources: Object.freeze({
    "iron-ore": Object.freeze({ name: "Железная руда", basePrice: 10, color: "#ffc879" }),
    "rare-earth": Object.freeze({ name: "Редкоземельная руда", basePrice: 18, color: "#c4a4ff" })
  }),
  asteroids: Object.freeze([
    Object.freeze({ id: "asteroid-01", label: "A-01", x: 720, y: 245, reserve: 420, resourceId: "iron-ore" }),
    Object.freeze({ id: "asteroid-02", label: "A-02", x: 390, y: 175, reserve: 360, resourceId: "iron-ore" }),
    Object.freeze({ id: "asteroid-03", label: "A-03", x: 430, y: 575, reserve: 170, resourceId: "rare-earth" }),
    Object.freeze({ id: "asteroid-04", label: "A-04", x: 650, y: 605, reserve: 450, resourceId: "iron-ore" }),
    Object.freeze({ id: "asteroid-05", label: "A-05", x: 975, y: 190, reserve: 150, resourceId: "rare-earth" }),
    Object.freeze({ id: "asteroid-06", label: "A-06", x: 170, y: 615, reserve: 300, resourceId: "iron-ore" }),
    Object.freeze({ id: "asteroid-07", label: "A-07", x: 1060, y: 390, reserve: 210, resourceId: "rare-earth" }),
    Object.freeze({ id: "asteroid-08", label: "A-08", x: 555, y: 405, reserve: 500, resourceId: "iron-ore" })
  ]),
  markets: Object.freeze([
    Object.freeze({ id: "market-01", label: "M-01", name: "Меридиан", x: 930, y: 530, baselineDemand: Object.freeze({ "iron-ore": 1.00, "rare-earth": 0.92 }) }),
    Object.freeze({ id: "market-02", label: "M-02", name: "Северные ворота", x: 190, y: 275, baselineDemand: Object.freeze({ "iron-ore": 0.88, "rare-earth": 1.16 }) }),
    Object.freeze({ id: "market-03", label: "M-03", name: "Гелиос", x: 1010, y: 105, baselineDemand: Object.freeze({ "iron-ore": 1.12, "rare-earth": 0.86 }) })
  ]),
  navigation: Object.freeze({
    arrivalRadius: 25,
    arrivalEpsilon: 0.001
  }),
  simulation: Object.freeze({
    maxRealDelta: 0.25,
    initialSpeedMultiplier: 1,
    allowedSpeedMultipliers: Object.freeze([1, 2])
  }),
  market: Object.freeze({
    salePriceMinMultiplier: 0.8,
    salePriceMaxMultiplier: 1.2,
    saleImpactPerUnit: 0.0015,
    recoveryPerUpdate: 0.01,
    updateIntervalSeconds: 60
  })
});

export const formatCredits = (amount) =>
  Math.round(amount).toLocaleString("ru-RU");

export const formatDuration = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
};
