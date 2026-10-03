import test from "node:test";
import assert from "node:assert/strict";
import {
  commandShip,
  createInitialState,
  getExpectedSaleValue,
  sellCargo,
  setPaused,
  setSpeedMultiplier,
  stepSimulation
} from "../src/simulation.js";

test("new game starts with the configured capital and empty cargo", () => {
  const state = createInitialState();
  assert.equal(state.credits, 1000);
  assert.equal(state.ship.cargo, 0);
  assert.equal(state.ship.cargoCapacity, 30);
  assert.equal(state.asteroid.reserve, 420);
});

test("ship accepts a valid asteroid command and rejects an unknown target", () => {
  const state = createInitialState();
  assert.equal(commandShip(state, state.asteroid.id).ok, true);
  assert.equal(state.ship.state, "travel-to-asteroid");
  assert.equal(commandShip(state, "not-a-target").ok, false);
});

test("mining is limited by free cargo space and asteroid reserves", () => {
  const state = createInitialState();
  state.ship.x = state.asteroid.x;
  state.ship.y = state.asteroid.y;
  state.ship.cargo = state.ship.cargoCapacity - 0.1;
  state.asteroid.reserve = 5;
  state.ship.targetId = state.asteroid.id;
  state.ship.state = "mining";

  stepSimulation(state, 0.25);

  assert.ok(state.ship.cargo <= state.ship.cargoCapacity);
  assert.equal(state.ship.cargo, state.ship.cargoCapacity);
  assert.ok(Math.abs(state.asteroid.reserve - 4.9) < 1e-9);
  assert.equal(state.ship.state, "travel-to-market");
});

test("sale credits the account once and clears the sold cargo", () => {
  const state = createInitialState();
  state.ship.x = state.market.x;
  state.ship.y = state.market.y;
  state.ship.cargo = 12;

  const expectedRevenue = 120;
  assert.equal(getExpectedSaleValue(state), expectedRevenue);
  const first = sellCargo(state);
  assert.equal(first.ok, true);
  assert.equal(first.sale.revenue, expectedRevenue);
  assert.equal(state.credits, 1120);
  assert.equal(state.ship.cargo, 0);

  const second = sellCargo(state);
  assert.equal(second.ok, false);
  assert.equal(state.credits, 1120);
});

test("sale is rejected when the ship is away from the market", () => {
  const state = createInitialState();
  state.ship.cargo = 10;
  const result = sellCargo(state);
  assert.equal(result.ok, false);
  assert.equal(state.credits, 1000);
  assert.equal(state.ship.cargo, 10);
});

test("pause freezes game time and ship movement", () => {
  const state = createInitialState();
  commandShip(state, state.asteroid.id);
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
  state.asteroid.reserve = 0;
  const result = commandShip(state, state.asteroid.id);
  assert.equal(result.ok, false);
  assert.equal(state.ship.state, "idle");
});

test("a complete mining run returns to the market and sells exactly once", () => {
  const state = createInitialState();
  assert.equal(commandShip(state, state.asteroid.id).ok, true);

  for (let i = 0; i < 1000 && state.credits === 1000; i += 1) {
    stepSimulation(state, 0.25);
  }

  assert.equal(state.credits, 1300);
  assert.equal(state.ship.cargo, 0);
  assert.equal(state.ship.state, "idle");
  assert.equal(state.asteroid.reserve, 390);
  assert.equal(state.market.salesCount, 1);
  assert.equal(state.lastSale.quantity, 30);
  assert.equal(state.lastSale.revenue, 300);
});
