import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjacent,
  canPlace,
  capacity,
  cellById,
  cells,
  createGame,
  depart,
  evaluate,
  getCellUsage,
  getSpaceCapacity,
  eventDefinitions,
  move,
  place,
  preview,
  stations,
  undo,
} from "../src/game/index.ts";
import { exitPath } from "../src/game/board.ts";
import type { GameState, Passenger } from "../src/game/types.ts";

function person(
  id: string,
  cellId: string | null,
  patch: Partial<Passenger> = {},
): Passenger {
  return {
    id,
    species: "働人",
    age: 40,
    sensitivity: 2,
    luggage: false,
    stress: 60,
    destination: 6,
    cellId,
    boardedAt: 0,
    belongings: "none",
    activity: "none",
    audio: "quiet",
    attention: "aware",
    posture: "normal",
    group: null,
    ...patch,
  };
}
function state(people: Passenger[]): GameState {
  return { ...createGame("fixture"), passengers: people, waiting: [] };
}


function emptyGame(seed: string): GameState {
  const game = createGame(seed);
  return { ...game, passengers: [], waiting: game.waiting.map(person => ({...person,luggage:false,belongings:"none",luggageCellId:null})) };
}

test("physical board has four rows, uniform seats and independent door capacities", () => {
  assert.equal(cells.filter((cell) => cell.kind === "seat").length, 54);
  assert.equal(cells.filter((cell) => cell.kind === "standing").length, 78);
  assert.equal(cells.filter((cell) => cell.kind === "door").length, 8);
  assert.equal(
    cells.reduce((sum, cell) => sum + cell.capacity, 0),
    156,
  );
  assert.equal(cells.filter((cell) => cell.priority).length, 12);
  assert.ok(
    cells
      .filter((cell) => cell.kind === "seat")
      .every((cell) => cell.width === 460),
  );
  assert.equal(new Set(cells.map((cell) => cell.id)).size, cells.length);
  assert.equal(capacity * 2, 152);
  assert.equal(stations.length, 7);
  for (const cell of cells)
    for (const other of cells) {
      if (cell === other) continue;
      const overlapX =
        Math.min(cell.x + cell.width, other.x + other.width) -
        Math.max(cell.x, other.x);
      const overlapY =
        Math.min(cell.y + cell.height, other.y + other.height) -
        Math.max(cell.y, other.y);
      assert.ok(overlapX <= 0 || overlapY <= 0, "no double-counted area");
    }
});

test("seeded demographics are reproducible and respect all species age ranges", () => {
  assert.deepEqual(createGame("same"), createGame("same"));
  assert.notDeepEqual(
    createGame("same").schedule,
    createGame("other").schedule,
  );
  for (const person of createGame("demographics").schedule.flat()) {
    const ranges = {
      若人: [10, 20],
      働人: [10, 60],
      老人: [60, 90],
      客人: [10, 90],
      休人: [10, 90],
    };
    assert.ok(
      person.age >= ranges[person.species][0] &&
        person.age <= ranges[person.species][1],
    );
    assert.equal(person.age % 10, 0);
    assert.ok(
      person.destination > person.boardedAt && person.destination <= 6,
    );
    assert.equal(person.luggage, person.belongings !== "none");
    if (person.attention === "asleep") {
      assert.equal(person.activity, "none");
      assert.equal(person.audio, "quiet");
    }
  }
});

test("placement, movement, undo and preview preserve passenger identities and original state", () => {
  const original = emptyGame("actions");
  const frozen = JSON.stringify(original);
  const id = original.waiting[0].id;
  const placed = place(original, id, "r1-b0-0");
  assert.equal(JSON.stringify(original), frozen);
  assert.equal(placed.waiting.length, original.waiting.length - 1);
  assert.equal(place(placed, placed.waiting[0].id, "r1-b0-0"), placed);
  assert.equal(place(original, id, "bad"), original);
  assert.equal(place(original, "missing", "r1-b0-0"), original);
  assert.equal(canPlace(placed, id, "r1-b0-0"), true);
  const beforePreview = JSON.stringify(placed);
  preview(placed, placed.waiting[0].id, "r1-b0-1");
  assert.equal(JSON.stringify(placed), beforePreview);
  const moved = move(placed, id, "r1-b0-1");
  assert.equal(moved.movesLeft, 1);
  assert.deepEqual(undo(moved), placed);
  assert.deepEqual(undo(placed), original);
  const movedTwice = move(moved, id, "r1-b0-2");
  assert.equal(move(movedTwice, id, "r0-d0"), movedTwice);
  assert.equal(
    depart(original),
    original,
    "cannot leave waiting passengers behind",
  );
});

test("special door cells allow three people and reject a fourth", () => {
  let game = emptyGame("door");
  for (let i = 0; i < 3; i++) game = place(game, game.waiting[0].id, "r3-d0");
  assert.equal(game.passengers.length, 3);
  assert.equal(place(game, game.waiting[0].id, "r3-d0"), game);
});

test("all walking routes leave only by south doors, with seats as leaves", () => {
  for (const cell of cells) {
    const path = exitPath(cell.id);
    assert.equal(path[0], cell.id);
    const exit = cellById.get(path[path.length - 1])!;
    assert.equal(exit.row, 3);
    assert.equal(exit.kind, "door");
    assert.ok(path.slice(1).every((id) => cellById.get(id)!.kind !== "seat"));
    for (let i = 1; i < path.length; i++)
      assert.ok(adjacent(path[i - 1], path[i]));
  }
});

test("synchronous waves propagate through a line, stop finitely and require new crossings for score", () => {
  const game = state([
    person("a", "r1-b1-1", { stress: 80, luggage: true, belongings: "hand" }),
    person("b", "r1-b1-2", { stress: 60 }),
    person("c", "r1-b1-3", { stress: 55 }),
  ]);
  const result = evaluate(game);
  assert.ok(result.maxChain >= 2);
  assert.ok(result.events.length > 0);
  assert.ok(result.waves.length <= game.passengers.length + 1);
  const firings = result.waves
    .filter((wave) => wave.index > 0)
    .flatMap((wave) => wave.sources);
  assert.equal(new Set(firings).size, firings.length);
  assert.ok(result.passengers.every((person) => person.stress <= 100));
  const high = state(
    game.passengers.map((person) => ({ ...person, stress: 100 })),
  );
  assert.equal(
    evaluate(high).score,
    0,
    "already stressed people do not score without new crossings",
  );
  assert.equal(
    evaluate(state([person("alone", "r1-b1-1", { stress: 99 })])).score,
    0,
  );
});

test("priority-seat occupancy and luggage affect local burden", () => {
  const needed = person("need", "r1-b1-1", { stress: 40, sensitivity: 4 });
  const seated = person("seat", "r0-b0-0", { stress: 40 });
  const withNeed = evaluate(state([needed, seated]));
  const withoutNeed = evaluate(state([seated]));
  assert.equal(
    withNeed.passengers.find((person) => person.id === "seat")!.stress -
      withoutNeed.passengers[0].stress,
    2,
  );
});

test("152nd placement produces one final evaluation and permanently finishes at 200 percent", () => {
  const passengers: Passenger[] = [];
  for (const cell of cells)
    for (
      let index = 0;
      index < cell.capacity && passengers.length < 151;
      index++
    )
      passengers.push(
        person(`p${passengers.length}`, cell.id, { stress: 100, bodySpace: cell.kind === "door" && index===2 ? 0.5 : 1 }),
      );
  const free = cells.find(
    (cell) =>
      passengers.filter((person) => person.cellId === cell.id).length <
      cell.capacity,
  )!;
  const before = {
    ...state(passengers),
    waiting: [person("last", null, { stress: 60 })],
  };
  const result = place(before, "last", free.id);
  assert.equal(result.finished, "capacity");
  assert.equal(result.passengers.length, 152);
  assert.equal(depart(result), result);
  assert.equal(undo(result), result);
  assert.equal(place(result, "last", free.id), result);
  assert.ok(result.lastEvaluation);
});

test("fixed-seed full runs terminate after six rides and produce actual varied trouble", () => {
  const order = [...cells].sort(
    (a, b) =>
      ({ door: 0, standing: 1, seat: 2 })[a.kind] -
        { door: 0, standing: 1, seat: 2 }[b.kind] || a.x - b.x,
  );
  for (const seed of ["始発", "chaos", "2026-11-24"]) {
    let game = createGame(seed);
    let rides = 0;
    let eventCount = 0;
    while (!game.finished && rides < 15) {
      while (game.waiting.length && !game.finished) {
        const person = game.waiting[0];
        const cell = order.find((cell) => canPlace(game, person.id, cell.id));
        assert.ok(cell);
        game = place(game, person.id, cell.id);
      }
      if (game.finished) break;
      game = depart(game);
      rides++;
      eventCount += game.lastEvaluation!.events.length;
      assert.equal(
        new Set(game.passengers.map((person) => person.id)).size,
        game.passengers.length,
      );
      for (const cell of cells)
        assert.ok(
          game.passengers.filter((person) => person.cellId === cell.id)
            .length <= cell.capacity,
        );
    }
    assert.equal(game.finished, "terminal");
    assert.equal(rides, 6);
    assert.equal(game.station, 6);
    assert.ok(game.passengers.length >= 80);
    assert.ok(game.score > 0);
    assert.ok(game.discovered.length >= 5);
    assert.ok(eventCount >= 10);
    assert.ok(
      game.discovered.every((id) =>
        eventDefinitions.some((event) => event.id === id),
      ),
    );
  }
});

test("half-cell compression scores a crowding event and preview matches luggage relocation", () => {
  const owner = person("owner", "r0-b0-0", {
    luggage: true,
    belongings: "hand",
    luggageCellId: "r1-b0-0",
    stress: 100,
  });
  const waiting = person("rider", null, { stress: 50 });
  const initial = { ...state([owner]), waiting: [waiting] };
  const crowded = place(initial, waiting.id, "r1-b0-0");
  assert.equal(crowded.passengers.find(p => p.id === waiting.id)?.bodySpace, 0.5);
  assert.equal(getCellUsage(crowded.passengers, "r1-b0-0"), 1);
  const result = evaluate(crowded);
  assert.ok(result.events.some(event => event.type === "N51"));
  const moved = move(crowded, owner.id, "r0-b0-2");
  assert.notEqual(moved, crowded);
  assert.equal(moved.passengers.find(p => p.id === waiting.id)?.bodySpace, 1);
  assert.deepEqual(preview(crowded, owner.id, "r0-b0-2"), evaluate(moved));
});

test("route objectives are reproducible and reward distinct trouble areas", async () => {
  const { chooseObjective, routeChoices, routeBonuses } = await import("../src/game/index.ts");
  const game = createGame("route-check");
  const [first, second] = routeChoices(game);
  assert.notEqual(first, second);
  assert.deepEqual(routeChoices(createGame(game.seed)), [first, second]);
  const chosen = chooseObjective(game, first);
  assert.equal(chosen.objective, first);
  assert.equal(chooseObjective(chosen, second), chosen);
  const riders = [person("west", "r1-b0-0"), person("east", "r1-b4-0")];
  const events = riders.map(rider => ({
    id: rider.id, type: "N01", name: "test", points: 50, wave: 1,
    participants: [rider.id], sources: [], rare: false,
  }));
  const evaluation = { passengers: riders, waves: [], events, score: 100, maxChain: 1 };
  assert.deepEqual(routeBonuses(evaluation, 3), { routeBonus: 250, objectiveBonus: 400 });
  assert.deepEqual(routeBonuses({ ...evaluation, events: [events[0], events[0]] }, 3),
    { routeBonus: 0, objectiveBonus: 0 });
});
