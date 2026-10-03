import test from "node:test";
import { CONFIG } from "../src/config.js";
import assert from "node:assert/strict";
import {
  commandShip,
  createInitialState,
  getExpectedSaleValue,
  getMarketQuote,
  getSalePrice,
  selectMarket,
  sellCargo,
  setPaused,
  setSpeedMultiplier,
  stepSimulation
} from "../src/simulation.js";

test("new game starts with the configured capital, procedurally generated asteroids and one station", () => {
  const state = createInitialState();
  assert.equal(state.credits, 1000);
  assert.equal(state.ship.cargo, 0);
  assert.equal(state.ship.cargoCapacity, 30);
  assert.equal(state.asteroids.length, 128);
  assert.equal(state.markets.length, 1);
});

test("ship accepts valid asteroid commands and rejects unknown targets", () => {
  const state = createInitialState();
  assert.equal(commandShip(state, state.asteroids[0].id).ok, true);
  assert.equal(state.ship.state, "travel-to-asteroid");
  assert.equal(commandShip(state, "not-a-target").ok, false);
});

test("mining is limited by free cargo space and asteroid reserves", () => {
  const state = createInitialState();
  const asteroid = state.asteroids[0];
  state.ship.x = asteroid.x;
  state.ship.y = asteroid.y;
  state.ship.cargo = state.ship.cargoCapacity - 0.1;
  state.ship.cargoResourceId = asteroid.resourceId;
  asteroid.reserve = 5;
  state.ship.targetId = asteroid.id;
  state.ship.state = "mining";

  stepSimulation(state, 0.25);

  assert.ok(state.ship.cargo <= state.ship.cargoCapacity);
  assert.equal(state.ship.cargo, state.ship.cargoCapacity);
  assert.ok(Math.abs(asteroid.reserve - 4.9) < 1e-9);
  assert.equal(state.ship.state, "travel-to-market");
});

test("sale credits the account once and clears the sold cargo", () => {
  const state = createInitialState();
  const market = state.markets[0];
  state.ship.x = market.x;
  state.ship.y = market.y;
  state.ship.cargo = 12;
  state.ship.cargoResourceId = "iron-ore";
  selectMarket(state, market.id);

  const expectedRevenue = 120;
  assert.equal(getExpectedSaleValue(state, market.id, "iron-ore"), expectedRevenue);
  const first = sellCargo(state, market.id);
  assert.equal(first.ok, true);
  assert.equal(first.sale.revenue, expectedRevenue);
  assert.equal(state.credits, 1120);
  assert.equal(state.ship.cargo, 0);
  assert.equal(state.ship.cargoResourceId, null);

  const second = sellCargo(state, market.id);
  assert.equal(second.ok, false);
  assert.equal(state.credits, 1120);
});

test("sale is rejected when the ship is away from every market", () => {
  const state = createInitialState();
  state.ship.cargo = 10;
  state.ship.cargoResourceId = "iron-ore";
  const result = sellCargo(state);
  assert.equal(result.ok, false);
  assert.equal(state.credits, 1000);
  assert.equal(state.ship.cargo, 10);
});

test("pause freezes game time and ship movement", () => {
  const state = createInitialState();
  commandShip(state, state.asteroids[0].id);
  const initialX = state.ship.x;
  const initialTime = state.gameSeconds;
  setPaused(state, true);
  stepSimulation(state, 0.2);
  assert.equal(state.ship.x, initialX);
  assert.equal(state.gameSeconds, initialTime);
  setPaused(state, false);
  stepSimulation(state, 0.2);
  assert.ok(state.gameSeconds > initialTime);
  assert.notEqual(state.ship.x, initialX);
});

test("only configured simulation speeds can be selected", () => {
  const state = createInitialState();
  assert.equal(setSpeedMultiplier(state, 2).ok, true);
  assert.equal(state.speedMultiplier, 2);
  assert.equal(setSpeedMultiplier(state, 3).ok, false);
  assert.equal(state.speedMultiplier, 2);
});

test("a depleted asteroid cannot receive a mining command", () => {
  const state = createInitialState();
  state.asteroids[0].reserve = 0;
  const result = commandShip(state, state.asteroids[0].id);
  assert.equal(result.ok, false);
  assert.equal(state.ship.state, "idle");
});

test("a complete mining run returns to the selected market and sells exactly once", () => {
  const state = createInitialState();
  assert.equal(commandShip(state, state.asteroids[0].id).ok, true);

  for (let i = 0; i < 1000 && state.credits === 1000; i += 1) {
    stepSimulation(state, 0.25);
  }

  assert.equal(state.credits, 1300);
  assert.equal(state.ship.cargo, 0);
  assert.equal(state.ship.cargoResourceId, null);
  assert.equal(state.ship.state, "idle");
  assert.equal(state.asteroids[0].reserve, state.asteroids[0].initialReserve - 30);
  assert.equal(state.markets[0].salesCount, 1);
  assert.equal(state.lastSale.quantity, 30);
  assert.equal(state.lastSale.revenue, 300);
});

test("market quotes compare prices, distance and expected revenue", () => {
  const state = createInitialState();
  const rareAsteroid = state.asteroids.find((asteroid) => asteroid.resourceId === "rare-earth");
  const quote = getMarketQuote(state, "market-01", rareAsteroid.id);
  assert.equal(quote.unitPrice, getSalePrice(state, "market-01", "rare-earth"));
  assert.ok(quote.distance > 0);
  assert.ok(quote.expectedRevenue > 0);
  assert.equal(state.markets.length, 1);
});

test("a sale lowers local demand price and demand recovers with game time", () => {
  const state = createInitialState();
  const market = state.markets[0];
  state.ship.x = market.x;
  state.ship.y = market.y;
  state.ship.cargo = 30;
  state.ship.cargoResourceId = "iron-ore";
  const before = getSalePrice(state, market.id, "iron-ore");
  assert.equal(sellCargo(state, market.id).ok, true);
  const afterSale = getSalePrice(state, market.id, "iron-ore");
  assert.ok(afterSale < before);
  for (let i = 0; i < 240; i += 1) stepSimulation(state, 0.25);
  assert.ok(getSalePrice(state, market.id, "iron-ore") > afterSale);
});

test("a ship cannot mix different resource types in one cargo hold", () => {
  const state = createInitialState();
  state.ship.cargo = 5;
  state.ship.cargoResourceId = "iron-ore";
  const rareAsteroid = state.asteroids.find((asteroid) => asteroid.resourceId === "rare-earth");
  const result = commandShip(state, rareAsteroid.id);
  assert.equal(result.ok, false);
  assert.equal(state.ship.cargo, 5);
});


test("fleet can buy up to three ships with independent tasks and cargo", async () => {
  const { buyShip, selectShip } = await import("../src/simulation.js");
  const state = createInitialState();
  const first = state.ships[0];
  const secondResult = buyShip(state);
  assert.equal(secondResult.ok, true);
  const second = secondResult.ship;
  assert.equal(state.ships.length, 2);
  assert.equal(state.credits, 400);
  assert.equal(commandShip(state, state.asteroids[0].id, first.id).ok, true);
  assert.equal(commandShip(state, state.asteroids[1].id, second.id).ok, true);
  assert.equal(first.targetId, state.asteroids[0].id);
  assert.equal(second.targetId, state.asteroids[1].id);
  assert.equal(first.state, "travel-to-asteroid");
  assert.equal(second.state, "travel-to-asteroid");
  selectShip(state, first.id);
  for (let i = 0; i < 10; i += 1) stepSimulation(state, 0.25);
  assert.notEqual(first.x, CONFIG.start.ship.x);
  assert.notEqual(second.x, CONFIG.start.ship.x + 28);
  state.credits = 2000;
  const thirdResult = buyShip(state);
  assert.equal(thirdResult.ok, true);
  assert.equal(state.ships.length, 3);
  assert.equal(buyShip(state).ok, false);
});

test("route auto-repeat is stored independently per ship", async () => {
  const { buyShip, setShipAutoRepeat } = await import("../src/simulation.js");
  const state = createInitialState();
  const second = buyShip(state).ship;
  assert.equal(setShipAutoRepeat(state, true, second.id).ok, true);
  assert.equal(second.autoRepeat, true);
  assert.equal(state.ships[0].autoRepeat, false);
});
