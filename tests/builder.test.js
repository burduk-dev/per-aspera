import test from "node:test";
import assert from "node:assert/strict";
import {
  addHullCell,
  buildDesign,
  calculateDesignStats,
  configureCell,
  createDefaultDesign,
  createTemplateDesign,
  getCell,
  removeHullCell,
  validateDesign
} from "../src/builder.js";
import { createInitialState } from "../src/simulation.js";

test("default compact grid design is connected, viable and affordable at the starting budget", () => {
  const design = createDefaultDesign();
  const validation = validateDesign(design, 1000);
  assert.equal(design.cells.length, 8);
  assert.equal(validation.valid, true, validation.errors.map((error) => error.message).join("; "));
  assert.equal(validation.stats.power, 0);
  assert.equal(validation.stats.cost, 924);
  assert.equal(validation.stats.cargoCapacity, 30);
  assert.equal(validation.stats.miningRate, 1);
  assert.equal(validation.stats.travelSpeed, 112);
});

test("all three hull templates are connected and have valid required modules", () => {
  const light = createTemplateDesign("light");
  const standard = createTemplateDesign("standard");
  const hauler = createTemplateDesign("hauler");
  assert.equal(light.cells.length, 6);
  assert.equal(standard.cells.length, 8);
  assert.equal(hauler.cells.length, 12);
  assert.equal(validateDesign(light, 1000).valid, true);
  assert.equal(validateDesign(standard, 1000).valid, true);
  assert.equal(validateDesign(hauler, 2000).valid, true);
  assert.equal(calculateDesignStats(light).cost, 770);
  assert.equal(calculateDesignStats(standard).cost, 924);
  assert.equal(calculateDesignStats(hauler).cost, 1428);
});

test("free construction accepts only grid cells connected by a side", () => {
  const design = createDefaultDesign();
  const before = design.cells.length;
  assert.equal(addHullCell(design, 5, 1).ok, true);
  assert.equal(design.cells.length, before + 1);
  assert.equal(addHullCell(design, 6, 4).ok, false);
  assert.equal(design.cells.length, before + 1);
  assert.equal(addHullCell(design, 5.5, 2).ok, false);
  assert.equal(addHullCell(design, 7, 1).ok, false);
});

test("hull cannot exceed 20 cells or shrink below four", () => {
  const design = createDefaultDesign();
  while (design.cells.length < 20) {
    const candidate = [
      [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0],
      [0, 1], [0, 2], [0, 3], [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4]
    ].find(([x, y]) => !getCell(design, `${x},${y}`) && design.cells.some((cell) => Math.abs(cell.x - x) + Math.abs(cell.y - y) === 1));
    assert.ok(candidate, "expected an adjacent empty cell");
    assert.equal(addHullCell(design, candidate[0], candidate[1]).ok, true);
  }
  assert.equal(addHullCell(design, 5, 2).ok, false);
  while (design.cells.length > 4) {
    const removable = design.cells.find((cell) => {
      const copy = { ...design, cells: design.cells.filter((item) => item !== cell) };
      const coords = new Set(copy.cells.map((item) => `${item.x},${item.y}`));
      const visited = new Set();
      const queue = [copy.cells[0]];
      while (queue.length) {
        const item = queue.shift();
        const key = `${item.x},${item.y}`;
        if (visited.has(key)) continue;
        visited.add(key);
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const next = `${item.x+dx},${item.y+dy}`;
          if (coords.has(next) && !visited.has(next)) {
            const [x,y] = next.split(",").map(Number);
            queue.push({x,y});
          }
        }
      }
      return visited.size === copy.cells.length;
    });
    assert.ok(removable);
    assert.equal(removeHullCell(design, `${removable.x},${removable.y}`).ok, true);
  }
  assert.equal(removeHullCell(design).ok, false);
});

test("removing an articulation cell is rejected and leaves the design intact", () => {
  const design = {
    name: "Narrow hull",
    selectedCell: "2,1",
    cells: [0, 1, 2, 3, 4].map((x) => ({
      x, y: 1, compartment: "cargo", level: 1, moduleId: null, moduleLevel: 1
    }))
  };
  const before = design.cells.length;
  const result = removeHullCell(design, "2,1");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "Нельзя удалить клетку: корпус должен оставаться связным.");
  assert.equal(design.cells.length, before);
});

test("module compatibility is enforced when configuring a compartment", () => {
  const design = createDefaultDesign();
  const result = configureCell(design, "1,1", { compartment: "engine", moduleId: "mining" });
  assert.equal(result.ok, false);
  assert.equal(getCell(design, "1,1").compartment, "mining");
  assert.equal(configureCell(design, "1,1", { compartment: "engine" }).ok, true);
  assert.equal(getCell(design, "1,1").moduleId, null);
});

test("validator rejects disconnected hulls, negative power and missing required modules", () => {
  const disconnected = createDefaultDesign();
  disconnected.cells[7].x = 6;
  disconnected.cells[7].y = 4;
  assert.ok(validateDesign(disconnected, 1000).errors.some((error) => error.code === "disconnected"));

  const lowPower = createDefaultDesign();
  const reactor = getCell(lowPower, "4,1");
  reactor.moduleId = null;
  assert.ok(validateDesign(lowPower, 1000).errors.some((error) => error.code === "power"));
  assert.ok(validateDesign(lowPower, 1000).errors.some((error) => error.code === "required-module"));
});

test("construction cost includes hull, compartment levels, modules and shape factor", () => {
  const design = createDefaultDesign();
  const stats = calculateDesignStats(design);
  assert.equal(stats.hullCost, 120);
  assert.equal(stats.compartmentCost, 320);
  assert.equal(stats.moduleCost, 440);
  assert.equal(stats.shapeFactor, 1.05);
  assert.equal(stats.cost, 924);
  assert.equal(validateDesign(design, 923).valid, false);
});

test("building deducts credits and applies the designed ship stats exactly once", () => {
  const state = createInitialState();
  const design = createDefaultDesign();
  const result = buildDesign(state, design);
  assert.equal(result.ok, true);
  assert.equal(result.cost, 924);
  assert.equal(state.credits, 76);
  assert.equal(state.ship.cargoCapacity, 30);
  assert.equal(state.ship.miningRate, 1);
  assert.equal(state.ship.travelSpeed, 112);
  assert.equal(buildDesign(state, design).ok, false);
  assert.equal(state.credits, 76);
});

test("building is blocked while the ship is travelling or carrying cargo", () => {
  const state = createInitialState();
  const design = createDefaultDesign();
  state.ship.state = "travel-to-asteroid";
  assert.equal(buildDesign(state, design).ok, false);
  state.ship.state = "idle";
  state.ship.cargo = 1;
  state.ship.cargoResourceId = "iron-ore";
  assert.equal(buildDesign(state, design).ok, false);
  assert.equal(state.credits, 1000);
});
