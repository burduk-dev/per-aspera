function generateAsteroids() {
  let seed = 483921;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const cx = 3600, cy = 3600;
  const belts = [
    { id: "belt-01", name: "Внутренний пояс", inner: 760, outer: 890, count: 34, resourceId: "iron-ore" },
    { id: "belt-02", name: "Средний пояс", inner: 1260, outer: 1430, count: 42, resourceId: "iron-ore" },
    { id: "belt-03", name: "Внешний пояс", inner: 1840, outer: 2040, count: 52, resourceId: "rare-earth" }
  ];
  const result = [];
  for (const belt of belts) {
    for (let i = 0; i < belt.count; i++) {
      const angle = (i / belt.count) * Math.PI * 2 + (random() - .5) * .12;
      const radius = belt.inner + random() * (belt.outer - belt.inner);
      const index = result.length + 1;
      result.push(Object.freeze({
        id: "asteroid-" + String(index).padStart(3, "0"),
        label: "A-" + String(index).padStart(3, "0"),
        beltId: belt.id,
        x: Math.round(cx + Math.cos(angle) * radius),
        y: Math.round(cy + Math.sin(angle) * radius),
        reserve: Math.round(180 + random() * 520),
        resourceId: belt.resourceId
      }));
    }
  }
  return result;
}

function generatePlanets() {
  let seed = 184731;
  const random = () => { seed = (seed * 48271) % 2147483647; return (seed - 1) / 2147483646; };
  const palette = [
    ["#b88a69", "#d59b72"], ["#4c9aab", "#76d6df"], ["#c8b17d", "#f0d7a3"],
    ["#9c6d78", "#d68a9a"], ["#6b7caa", "#9bb4ef"], ["#7c9c83", "#a8d4a6"]
  ];
  const bands = [
    { name:"Веста", orbit:520, min:18, max:30 },
    { name:"Нерея", orbit:1080, min:32, max:48 },
    { name:"Кассини", orbit:1620, min:26, max:42 },
    { name:"Эреб", orbit:2240, min:48, max:68 },
    { name:"Орион", orbit:2910, min:58, max:84 }
  ];
  return bands.map((planet, index) => {
    const colors = palette[Math.floor(random() * palette.length)];
    return Object.freeze({
      id:"planet-" + String(index + 1).padStart(2,"0"),
      name:planet.name,
      orbit:planet.orbit,
      radius:Math.round(planet.min + random() * (planet.max - planet.min)),
      color:colors[0],
      phase:random() * Math.PI * 2,
      atmosphere:colors[1]
    });
  });
}

export const CONFIG = Object.freeze({
  version: 1,
  map: Object.freeze({ width: 7200, height: 7200, centerX: 3600, centerY: 3600 }),
  start: Object.freeze({
    credits: 1000,
    gameSeconds: 0,
    ship: Object.freeze({ x: 3635, y: 3650, cargoCapacity: 30, miningRate: 1, travelSpeed: 112 })
  }),
  resources: Object.freeze({
    "iron-ore": Object.freeze({ name: "Железная руда", basePrice: 10, color: "#ffc879" }),
    "rare-earth": Object.freeze({ name: "Редкоземельная руда", basePrice: 18, color: "#c4a4ff" })
  }),
  system: Object.freeze({
    seed: 483921,
    star: Object.freeze({ x: 3600, y: 3600, radius: 95, name: "Helios" }),
    station: Object.freeze({ id: "market-01", label: "СТАНЦИЯ", name: "Меридиан", x: 3715, y: 3600, baselineDemand: Object.freeze({ "iron-ore": 1, "rare-earth": 1 }) }),
    planets: Object.freeze(generatePlanets()),
    asteroidBelts: Object.freeze([
      Object.freeze({ id: "belt-01", name: "Внутренний пояс", inner: 760, outer: 890, count: 34, resourceId: "iron-ore" }),
      Object.freeze({ id: "belt-02", name: "Средний пояс", inner: 1260, outer: 1430, count: 42, resourceId: "iron-ore" }),
      Object.freeze({ id: "belt-03", name: "Внешний пояс", inner: 1840, outer: 2040, count: 52, resourceId: "rare-earth" })
    ])
  }),
  asteroids: Object.freeze(generateAsteroids()),
  markets: Object.freeze([Object.freeze({ id: "market-01", label: "СТАНЦИЯ", name: "Меридиан", x: 3715, y: 3600, baselineDemand: Object.freeze({ "iron-ore": 1, "rare-earth": 1 }) })]),
  navigation: Object.freeze({
    arrivalRadius: 25,
    arrivalEpsilon: 0.001
  }),
  simulation: Object.freeze({
    maxRealDelta: 0.25,
    initialSpeedMultiplier: 1,
    allowedSpeedMultipliers: Object.freeze([1, 2])
  }),
  construction: Object.freeze({
    minCells: 4,
    maxCells: 20,
    cellCost: 15,
    shapeComplexity: Object.freeze({ line: 1.00, compact: 1.05, irregular: 1.12 }),
    compartmentLevelCosts: Object.freeze({ 1: 40, 2: 90 }),
    moduleDefinitions: Object.freeze({
      mining: Object.freeze({ name: "Добыча", compartment: "mining", levels: Object.freeze({
        1: Object.freeze({ name: "Бур I", cost: 120, power: -2, miningRate: 1 }),
        2: Object.freeze({ name: "Бур II", cost: 260, power: -4, miningRate: 1.8 })
      }) }),
      storage: Object.freeze({ name: "Хранилище", compartment: "cargo", levels: Object.freeze({
        1: Object.freeze({ name: "Трюм I", cost: 80, power: -1, cargoCapacity: 30 }),
        2: Object.freeze({ name: "Трюм II", cost: 180, power: -2, cargoCapacity: 70 })
      }) }),
      engine: Object.freeze({ name: "Двигатель", compartment: "engine", levels: Object.freeze({
        1: Object.freeze({ name: "Двигатель I", cost: 100, power: -2, travelSpeed: 112 }),
        2: Object.freeze({ name: "Двигатель II", cost: 220, power: -4, travelSpeed: 150 })
      }) }),
      reactor: Object.freeze({ name: "Реактор", compartment: "reactor", levels: Object.freeze({
        1: Object.freeze({ name: "Реактор I", cost: 140, power: 5 }),
        2: Object.freeze({ name: "Реактор II", cost: 300, power: 10 })
      }) })
    })
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
