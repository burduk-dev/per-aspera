export const CONFIG = Object.freeze({
  version: 1,
  map: Object.freeze({ width: 1200, height: 760 }),
  start: Object.freeze({
    credits: 1000,
    gameSeconds: 0,
    ship: Object.freeze({ x: 245, y: 405, cargoCapacity: 30, miningRate: 1, travelSpeed: 112 }),
    asteroid: Object.freeze({ id: "asteroid-01", x: 720, y: 245, reserve: 420, resourceId: "iron-ore" }),
    market: Object.freeze({ id: "market-01", x: 930, y: 530, price: 10 })
  }),
  resources: Object.freeze({
    "iron-ore": Object.freeze({ name: "Железная руда", basePrice: 10 })
  }),
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
    salePriceMaxMultiplier: 1.2
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
