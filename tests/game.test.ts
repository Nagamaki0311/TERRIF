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
  assert.equal(undo(moved), moved);
  assert.equal(undo(placed), placed);
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

test("fixed-seed full runs end within six rides and produce actual varied trouble", () => {
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
        let placement: { person: Passenger; cell: (typeof cells)[number] } | undefined;
        for (const person of game.waiting) {
          const cell = order.find(cell => canPlace(game, person.id, cell.id));
          if (cell) { placement = { person, cell }; break; }
        }
        if (placement) game = place(game, placement.person.id, placement.cell.id);
        else {
          for (const person of game.passengers) {
            const cell = order.find(cell => cell.id !== person.cellId && canPlace(game, person.id, cell.id));
            if (cell) { placement = { person, cell }; break; }
          }
          assert.ok(placement, "an unfinished blocked state must offer a legal repositioning move");
          game = move(game, placement.person.id, placement.cell.id);
        }
        eventCount += game.lastEvaluation?.events.length ?? 0;
      }
      if (game.finished) break;
      game = depart(game);
      rides++;

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
    assert.ok(["terminal", "capacity", "no-space"].includes(game.finished!));
    assert.ok(rides <= 6);
    if (game.finished === "terminal") {
      assert.equal(rides, 6);
      assert.equal(game.station, 6);
    }
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
  assert.ok(crowded.lastEvaluation!.events.some(event => event.type === "N51"));
  const predicted = preview(crowded, owner.id, "r0-b0-2");
  const moved = move(crowded, owner.id, "r0-b0-2");
  assert.notEqual(moved, crowded);
  assert.equal(moved.passengers.find(p => p.id === waiting.id)?.bodySpace, 1);
  assert.deepEqual(predicted.passengers, moved.passengers);
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

test("station perks are seeded, single-pick, and can change the first ignition", async () => {
  const { choosePerk, perkChoices, sectorAt } = await import("../src/game/index.ts");
  const seeds = Array.from({ length: 30 }, (_, i) => "perk-" + i);
  const offers = seeds.flatMap(seed => perkChoices(seed, 0));
  assert.equal(new Set(offers.filter(offer => offer.kind === "buff").map(offer => offer.effect)).size, 6);
  const seed = seeds.find(value => perkChoices(value, 0).some(offer => offer.id === "quiet"))!;
  const game = createGame(seed);
  const choices = perkChoices(seed, 0);
  assert.deepEqual(choices, perkChoices(seed, 0));
  assert.equal(new Set(choices.map(offer => offer.sector)).size, 3);
  const quiet = choices.find(offer => offer.id === "quiet")!;
  const chosen = choosePerk(game, quiet.id);
  assert.equal(choosePerk(chosen, choices.find(offer => offer !== quiet)!.id), chosen);
  assert.equal(choosePerk(game, "unknown"), game);
  const cell = cells.find(cell => cell.kind === "standing" && sectorAt(cell.x + cell.width / 2) === quiet.sector)!;
  const rider = person("quiet-rider", cell.id, { stress: 50 });
  const fixture = { ...chosen, passengers: [rider], waiting: [] };
  assert.equal(evaluate({ ...fixture, perk: undefined, buffs: [] }).waves.length, 0);
  assert.equal(evaluate(fixture).waves[0].sources[0], rider.id);
  assert.equal(depart(fixture).perk, undefined);
});

test("the repositioning perk survives undo without granting moves twice", async () => {
  const { choosePerk, perkChoices } = await import("../src/game/index.ts");
  const seed = Array.from({ length: 30 }, (_, i) => "moves-" + i)
    .find(value => perkChoices(value, 0).some(offer => offer.id === "switch"))!;
  const first = { ...createGame(seed), passengers: [person("mover", "r0-b0-0")] };
  const moved = move(first, "mover", "r0-b0-2");
  assert.equal(moved.movesLeft, 1);
  const picked = choosePerk(moved, "switch");
  assert.equal(picked.movesLeft, 3);
  const restored = undo(picked);
  assert.equal(restored.movesLeft, 3);
  assert.equal(restored, picked);
  assert.equal(choosePerk(restored, "switch"), restored);
});

test("offers always contain one rarity-weighted special and two distinct buffs", async () => {
  const { perkChoices, choosePerk } = await import("../src/game/index.ts");
  const counts = { S: 0, SS: 0, SSS: 0 };
  for (let i = 0; i < 500; i++) {
    const offers = perkChoices("rarity-" + i, i % 6);
    assert.equal(offers.filter(offer => offer.kind === "special").length, 1);
    assert.equal(offers.filter(offer => offer.kind === "buff").length, 2);
    assert.equal(offers[1].scope, "sector");
    assert.equal(offers[2].scope, "global");
    assert.equal(offers[2].sector, null);
    assert.equal(new Set(offers.map(offer => offer.id)).size, 3);
    counts[offers[0].rarity!]++;
  }
  assert.ok(counts.S > counts.SS && counts.SS > counts.SSS && counts.SSS > 0);
  const initial = createGame("special-acquisition");
  const offer = perkChoices(initial.seed, initial.station)[0];
  const acquired = choosePerk(initial, offer.id);
  assert.equal(acquired.waiting.length, initial.waiting.length + 1);
  assert.equal(acquired.waiting[0].special?.skill, offer.skill);
  assert.equal(acquired.waiting[0].special?.rarity, offer.rarity);
  assert.equal(choosePerk(acquired, offer.id), acquired);
});

test("regional buffs are stronger while global buffs reach distant passengers", async () => {
  const { perkChoices, sectorAt } = await import("../src/game/index.ts");
  for (const effect of ["quiet", "seats", "luggage", "switch"] as const) {
    const offers = Array.from({ length: 100 }, (_, i) => perkChoices("scope-" + i, 0)).flat();
    const regional = offers.find(offer => offer.effect === effect && offer.scope === "sector")!;
    const global = offers.find(offer => offer.effect === effect && offer.scope === "global")!;
    assert.ok(regional.strength! > global.strength!);
    const local = cells.find(cell => cell.kind === (effect === "seats" ? "seat" : "standing")
      && sectorAt(cell.x + cell.width / 2) === regional.sector)!;
    const remote = cells.find(cell => cell.kind === local.kind
      && Math.abs(sectorAt(cell.x + cell.width / 2) - regional.sector!) >= 2)!;
    const initial = state([person("local", local.id, { stress: 35, luggage: effect === "luggage" }),
      person("remote", remote.id, { stress: 35, luggage: effect === "luggage" })]);
    const baseline = evaluate(initial).passengers;
    const focused = evaluate({ ...initial, perk: regional, buffs: [regional] }).passengers;
    const broad = evaluate({ ...initial, perk: global, buffs: [global] }).passengers;
    assert.ok(focused[0].stress > broad[0].stress, effect);
    assert.equal(focused[1].stress, baseline[1].stress, effect + " must stay local");
    assert.ok(broad[1].stress > baseline[1].stress, effect + " must reach remote riders");
    assert.equal(broad[0].stress - baseline[0].stress, broad[1].stress - baseline[1].stress);
  }
});

test("global bridge adds a smaller cross-aisle boost throughout the board", async () => {
  const { perkChoices, sectorAt } = await import("../src/game/index.ts");
  const offers = Array.from({ length: 100 }, (_, i) => perkChoices("bridge-scope-" + i, 0)).flat();
  const regional = offers.find(offer => offer.effect === "bridge" && offer.scope === "sector")!;
  const global = offers.find(offer => offer.effect === "bridge" && offer.scope === "global")!;
  const target = cells.find(cell => cell.row === 2 && cell.kind === "standing"
    && sectorAt(cell.x + cell.width / 2) === regional.sector)!;
  const source = cells.find(cell => cell.row === 1 && cell.kind === "standing" && cell.x === target.x)!;
  const remoteTarget = cells.find(cell => cell.row === 2 && cell.kind === "standing"
    && Math.abs(sectorAt(cell.x + cell.width / 2) - regional.sector!) >= 2)!;
  const remoteSource = cells.find(cell => cell.row === 1 && cell.kind === "standing" && cell.x === remoteTarget.x)!;
  const initial = state([
    person("source", source.id, { stress: 100 }), person("target", target.id, { stress: 0 }),
    person("remote-source", remoteSource.id, { stress: 100 }), person("remote-target", remoteTarget.id, { stress: 0 }),
  ]);
  const baseline = evaluate(initial).passengers;
  const focused = evaluate({ ...initial, perk: regional, buffs: [regional] }).passengers;
  const broad = evaluate({ ...initial, perk: global, buffs: [global] }).passengers;
  assert.equal(focused[1].stress - baseline[1].stress, 25);
  assert.equal(focused[3].stress, baseline[3].stress);
  assert.equal(broad[1].stress - baseline[1].stress, 8);
  assert.equal(broad[3].stress - baseline[3].stress, 8);
});

test("global repositioning grants one move once and creates no sector objective", async () => {
  const { perkChoices, choosePerk } = await import("../src/game/index.ts");
  const seed = Array.from({ length: 100 }, (_, i) => "global-moves-" + i)
    .find(seed => perkChoices(seed, 0).some(offer => offer.id === "switch-global"))!;
  const initial = createGame(seed);
  const selected = choosePerk(initial, "switch-global");
  assert.equal(selected.movesLeft, initial.movesLeft + 1);
  assert.equal(selected.objective, null);
  assert.equal(choosePerk(selected, "switch-global"), selected);
});

test("a global buff preserves realtime locality instead of ticking every remote rider", async () => {
  const { perkChoices } = await import("../src/game/index.ts");
  const { evaluatePlacement } = await import("../src/game/evaluation.ts");
  const global = Array.from({ length: 100 }, (_, i) => perkChoices("global-live-" + i, 0)).flat()
    .find(offer => offer.id === "quiet-global")!;
  const fixture = { ...state([
    person("placed", "r1-b0-0", { stress: 10 }),
    person("remote", "r1-b4-1", { stress: 40 }),
  ]), perk: global, buffs: [global] };
  const evaluated = evaluatePlacement(fixture, "placed");
  assert.equal(evaluated.passengers[0].stress, 20);
  assert.equal(evaluated.passengers[1].stress, 40);
});

test("placement resolves immediately, leaves remote stress untouched, and departure never rescores", () => {
  const remote = person("remote", "r1-b4-1", { stress: 40 });
  const owner = person("owner", "r0-b0-0", { luggage: true, belongings: "hand", luggageCellId: "r1-b0-0", stress: 100 });
  const waiting = person("new", null, { stress: 50 });
  const initial = { ...state([owner, remote]), waiting: [waiting] };
  const placed = place(initial, waiting.id, "r1-b0-0");
  assert.ok(placed.lastEvaluation!.events.some(event => event.type === "N51"));
  assert.ok(placed.score > initial.score);
  assert.equal(placed.passengers.find(person => person.id === remote.id)!.stress, 40);
  assert.equal(undo(placed), placed);
  const score = placed.score;
  const paid = placed.scoredEvents;
  const next = depart(placed);
  assert.equal(next.score, score);
  assert.deepEqual(next.scoredEvents, paid);
  assert.equal(next.lastEvaluation, null);
  assert.deepEqual(next.stationEvents, []);
});

test("old events retain their sector and cannot become a new objective after movement", () => {
  const old = {
    id: "old-event", type: "N01", name: "old", participants: ["old"],
    points: 20, wave: 1, rare: false, sources: [], sector: 0,
  };
  const initial = {
    ...state([person("old", "r1-b4-1", { stress: 20 })]),
    stationEvents: [old], stationSectors: [0], objective: 3,
    scoredEvents: [old.id], waiting: [person("new", null, { stress: 5 })],
  };
  const placed = place(initial, "new", "r0-b2-0");
  assert.equal(placed.lastEvaluation!.events.length, 0);
  assert.equal(placed.lastEvaluation!.objectiveBonus, 0);
  assert.equal(placed.lastEvaluation!.routeBonus, 0);
  assert.deepEqual(placed.stationSectors, [0]);
  assert.equal(placed.stationEvents![0].sector, 0);
});

test("special skills have distinct reach and rarity-strength effects", async () => {
  const { evaluatePlacement } = await import("../src/game/evaluation.ts");
  const skillState = (skill: "aura" | "bridge" | "relay", rarity: "S" | "SSS", target: string) => state([
    person("special", "r1-b1-1", {
      stress: 100, special: { name: "test", skill, rarity },
    }),
    person("target", target, { stress: 35 }),
  ]);
  const s = evaluatePlacement(skillState("aura", "S", "r1-b1-2"), "special");
  const sss = evaluatePlacement(skillState("aura", "SSS", "r1-b1-2"), "special");
  assert.ok(sss.passengers[1].stress > s.passengers[1].stress);
  const bridge = evaluatePlacement(skillState("bridge", "SSS", "r2-b1-1"), "special");
  const plain = evaluatePlacement(state([
    person("special", "r1-b1-1", { stress: 100 }),
    person("target", "r2-b1-1", { stress: 35 }),
  ]), "special");
  assert.ok(bridge.passengers[1].stress > plain.passengers[1].stress);
  const relay = evaluatePlacement(skillState("relay", "S", "r1-b1-3"), "special");
  assert.ok(relay.passengers[1].stress > 35);
});

test("run ledger survives station changes, freezes event sites, and shared summary rewards variety", async () => {
  const { summarizeChaos } = await import("../src/game/index.ts");
  const owner = person("owner", "r0-b0-0", { luggage: true, belongings: "hand", luggageCellId: "r1-b0-0", stress: 100 });
  const initial = { ...state([owner]), waiting: [person("new", null, { stress: 50 })] };
  const placed = place(initial, "new", "r1-b0-0");
  assert.ok(placed.eventLedger.length > 0);
  assert.ok(placed.eventLedger.every(event => event.station === 0 && event.sector === 0));
  const summary = summarizeChaos(placed);
  assert.equal(summary.total, placed.eventLedger.length);
  assert.equal(summary.events + summary.rare, summary.total);
  assert.equal(summary.types, 1);
  assert.equal(summary.sectors, 1);
  assert.equal(summary.mainCategory, "空間・座席");
  assert.equal(summary.maxChain, placed.maxChain);
  const next = depart(placed);
  assert.deepEqual(next.eventLedger, placed.eventLedger);
  assert.equal(next.maxChain, placed.maxChain);
  assert.equal(summarizeChaos(next).label, summary.label);
  const repeated = { ...next, eventLedger: Array.from({ length: 50 }, (_, i) => ({ ...placed.eventLedger[0], id: "repeat-" + i })) };
  assert.equal(summarizeChaos(repeated).stage, 1, "one kind at one site cannot become the top stage");
  const varied = { ...next, maxChain: 0, eventLedger: Array.from({ length: 20 }, (_, i) => ({
    ...placed.eventLedger[0], id: "varied-" + i, type: "N" + String(i + 1).padStart(2, "0"), sector: i % 4,
  })) };
  assert.equal(summarizeChaos(varied).stage, 4, "variety and spread suffice without a mandatory chain depth");
  assert.equal(summarizeChaos(createGame("calm")).stage, 0);
});

test("prior station events no longer suppress new trouble or discount repeated sites", async () => {
  const { evaluatePlacement } = await import("../src/game/evaluation.ts");
  const people = [person("caller", "r1-b1-1", { stress: 100, activity: "call" }), person("listener", "r1-b1-2", { stress: 60 })];
  const initial = state(people);
  const plain = evaluatePlacement(initial, "listener");
  const prior = Array.from({ length: 25 }, (_, index) => ({
    id: "past-" + index, type: "N19", name: "past", participants: ["caller", "listener"],
    points: 40, wave: 1, rare: false, sources: [], sector: 1,
  }));
  const repeated = evaluatePlacement({ ...initial, stationEvents: prior, scoredEvents: prior.map(event => event.id) }, "listener");
  assert.ok(repeated.events.some(event => event.type === "N19"));
  assert.equal(repeated.score, plain.score);
  const paid = evaluatePlacement({ ...initial, scoredEvents: repeated.events.map(event => event.id) }, "listener");
  assert.ok(paid.events.every(event => !repeated.events.some(old => old.id === event.id)));
  assert.ok(repeated.waves.length <= people.length + 1);
  const fired = repeated.waves.filter(wave => wave.index > 0).flatMap(wave => wave.sources);
  assert.equal(new Set(fired).size, fired.length, "each passenger fires only once in a reaction");
});

test("trouble changes actual behavior after its snapshot and lets a different spark reuse the site", () => {
  const caller = person("caller", "r3-d0", { stress: 100, activity: "call" });
  let game = { ...state([caller]), waiting: [person("listener", null, { stress: 60 }), person("screen", null, { stress: 60, activity: "screen", attention: "absorbed" })] };
  game = place(game, "listener", "r3-d0");
  assert.ok(game.lastEvaluation!.events.some(event => event.type === "N19"));
  const changed = game.passengers.find(person => person.id === caller.id)!;
  assert.equal(changed.activity, "screen");
  assert.equal(changed.attention, "absorbed");
  assert.equal(changed.lastReaction, "通話を切って画面に集中");
  assert.equal(game.lastEvaluation!.passengers.find(person => person.id === caller.id)!.activity, "call");
  assert.equal(caller.activity, "call", "input passenger remains immutable");
  assert.equal(game.passengers.find(person => person.id === "listener")!.lastReaction, undefined);
  game = move(game, "listener", "r0-b4-0");
  game = place(game, "screen", "r3-d0");
  assert.ok(game.lastEvaluation!.events.some(event => event.type === "N22"), "a phone-screen event follows the call event at the same place");
  assert.equal(game.eventLedger.filter(event => event.type === "N19").length, 1);
  assert.equal(game.eventLedger.filter(event => event.type === "N22").length, 1);
  assert.equal(game.passengers.find(person => person.id === caller.id)!.cellId, "r3-d0");
});

test("seat trouble wakes and straightens its participant while preserving luggage reservations", () => {
  const sleeper = person("sleeper", "r0-b1-2", { stress: 100, attention: "asleep", posture: "lean",
    luggage: true, belongings: "hand", luggageCellId: "r1-b1-2" });
  const game = place({ ...state([sleeper]), waiting: [person("neighbor", null, { stress: 65 })] }, "neighbor", "r0-b1-3");
  assert.ok(game.lastEvaluation!.events.some(event => event.type === "N10"));
  const changed = game.passengers.find(person => person.id === sleeper.id)!;
  assert.equal(changed.attention, "aware");
  assert.equal(changed.posture, "normal");
  assert.equal(changed.lastReaction, "目を覚ました・姿勢を直した");
  assert.equal(changed.cellId, sleeper.cellId);
  assert.equal(changed.luggageCellId, sleeper.luggageCellId);
  assert.equal(changed.luggage, true);
  assert.equal(game.lastEvaluation!.passengers.find(person => person.id === sleeper.id)!.attention, "asleep");
});

test("all six buff choices remain available, persistent and nonduplicating across a run", async () => {
  const { perkChoices, choosePerk } = await import("../src/game/index.ts");
  const { buffKey } = await import("../src/game/perks.ts");
  for (const mode of ["sector", "global"] as const) {
    for (const seed of ["accumulate-0", "accumulate-1", "accumulate-2"]) {
      let game = createGame(seed);
      for (let phase = 0; phase < 6; phase++) {
        const offers = perkChoices(seed, phase, game.buffs);
        assert.equal(offers.length, 3);
        assert.deepEqual(offers, perkChoices(seed, phase, game.buffs));
        assert.equal(offers[0].kind, "special");
        assert.equal(offers[1].scope, "sector");
        assert.equal(offers[2].scope, "global");
        for (const offer of offers.slice(1)) assert.ok(!game.buffs.some(buff => buffKey(buff) === buffKey(offer)));
        game = choosePerk(game, offers.find(offer => offer.scope === mode)!.id);
        assert.equal(game.buffs.length, phase + 1);
        const before = game.buffs;
        game = depart({ ...game, waiting: [] });
        assert.deepEqual(game.buffs, before);
      }
      assert.equal(new Set(game.buffs.map(buffKey)).size, 6);
    }
  }
});

test("persistent buffs apply after departure, respect realtime locality and cap combined burden", async () => {
  const { perkChoices, choosePerk, sectorAt } = await import("../src/game/index.ts");
  const { evaluatePlacement } = await import("../src/game/evaluation.ts");
  const seed = Array.from({ length: 100 }, (_, i) => "persistent-" + i)
    .find(seed => perkChoices(seed, 0).some(offer => offer.id === "quiet-global"))!;
  let game = choosePerk(createGame(seed), "quiet-global");
  game = depart({ ...game, passengers: [], waiting: [] });
  const fixture = { ...game, passengers: [person("local", "r1-b1-1", { stress: 10 }), person("far", "r1-b4-1", { stress: 40 })] };
  assert.equal(fixture.perk, undefined);
  const result = evaluatePlacement(fixture, "local");
  assert.equal(result.passengers[0].stress, 20);
  assert.equal(result.passengers[1].stress, 40);
  const offers = Array.from({ length: 200 }, (_, i) => perkChoices("cap-" + i, 0)).flat();
  const buffs = ["quiet", "noise", "switch"].flatMap(effect => [
    offers.find(buff => buff.effect === effect && buff.scope === "global")!,
    { ...offers.find(buff => buff.effect === effect && buff.scope === "sector")!, sector: sectorAt(cellById.get("r1-b1-1")!.x + 230) },
  ]);
  const capped = evaluate({ ...state([person("local", "r1-b1-1", { stress: 10, activity: "call" })]), buffs });
  assert.equal(capped.passengers[0].stress, 58, "combined buff burden is capped at 48");
  const bridges = [
    offers.find(buff => buff.id === "bridge-global")!,
    { ...offers.find(buff => buff.id === "bridge")!, sector: sectorAt(cellById.get("r2-b1-2")!.x + 230) },
  ];
  const crossFixture = { ...state([
    person("source-a", "r1-b1-2", { stress: 100, bodySpace: 0.5 }),
    person("source-b", "r1-b1-2", { stress: 100, bodySpace: 0.5 }),
    person("target", "r2-b1-2", { stress: 0 }),
  ]), buffs: bridges };
  const cross = evaluate(crossFixture);
  const withoutBridge = evaluate({ ...crossFixture, buffs: [] });
  assert.equal(cross.passengers[2].stress - withoutBridge.passengers[2].stress, 35,
    "two sources keep their base transmission but bridge additions cap at 35");
});

test("boarding-only special skills create distinct actions and groups without breaking existing parties", async () => {
  const { choosePerk, perkChoices } = await import("../src/game/index.ts");
  for (const skill of ["gather", "snack"] as const) {
    for (const rarity of ["S", "SSS"] as const) {
      const seed = Array.from({ length: 500 }, (_, i) => "role-" + i)
        .find(seed => perkChoices(seed, 0)[0].skill === skill && perkChoices(seed, 0)[0].rarity === rarity)!;
      assert.ok(seed, `${skill}/${rarity} is reachable`);
      const template = choosePerk(createGame(seed), perkChoices(seed, 0)[0].id).waiting[0];
      assert.equal(template.activity, skill === "gather" ? "talk" : "food");
      const targets = [
        person("left", "r1-b1-1", { stress: 0, activity: "none", luggage: true, belongings: "hand", luggageCellId: "r2-b1-1" }),
        person("right", "r1-b1-3", { stress: 0, activity: "read" }),
        person("opposite", "r2-b1-2", { stress: 0, activity: "screen", attention: "absorbed" }),
        person("protected", "r0-b1-2", { stress: 0, attention: "asleep", group: "existing-party" }),
        person("remote", "r1-b4-1", { stress: 0 }),
      ];
      const initial = { ...state(targets), waiting: [{ ...template, stress: 0 }] };
      const placed = place(initial, template.id, "r1-b1-2");
      const count = rarity === "SSS" ? 3 : 1;
      const changed = placed.passengers.filter(person => person.lastReaction === (skill === "gather" ? "話の輪に加わった" : "おやつを受け取った"));
      assert.equal(changed.length, count);
      assert.ok(changed.every(person => person.activity === (skill === "gather" ? "talk" : "food") && person.attention === "aware"));
      if (skill === "gather") assert.ok(changed.every(person => person.group === template.group && template.group !== null));
      assert.equal(placed.passengers.find(person => person.id === "protected")!.group, "existing-party");
      assert.equal(placed.passengers.find(person => person.id === "protected")!.attention, "asleep");
      assert.equal(placed.passengers.find(person => person.id === "left")!.luggageCellId, "r2-b1-1");
      assert.equal(targets[0].activity, "none", "original input is unchanged");
      const moved = move(placed, template.id, "r1-b4-2");
      assert.equal(moved.passengers.find(person => person.id === "remote")!.activity, "none", "moving does not repeat the boarding skill");
    }
  }
});

test("station profiles produce reproducible, distinct passenger waves without changing route constraints", async () => {
  const { stationProfile } = await import("../src/game/index.ts");
  const { generateSchedule } = await import("../src/game/generation.ts");
  const totals = new Map<string, { people: number; awake: number; screen: number; luggage: number; noisy: number; read: number; grouped: number }>();
  let terminal = 0, riders = 0;
  for (let sample = 0; sample < 40; sample++) {
    const seed = "profile-" + sample;
    const schedule = generateSchedule(seed);
    assert.deepEqual(schedule, generateSchedule(seed));
    for (let station = 0; station < 6; station++) {
      const profile = stationProfile(seed, station);
      assert.deepEqual(profile, stationProfile(seed, station));
      if (!totals.has(profile.id)) totals.set(profile.id, { people: 0, awake: 0, screen: 0, luggage: 0, noisy: 0, read: 0, grouped: 0 });
      const stats = totals.get(profile.id)!;
      for (const person of schedule[station]) {
        riders++;
        if (person.destination === 6) terminal++;
        assert.ok(person.destination > station && person.destination <= 6);
        assert.equal(person.luggage, person.belongings !== "none");
        stats.people++;
        if (person.attention !== "asleep") stats.awake++;
        if (person.activity === "screen") stats.screen++;
        if (person.luggage) stats.luggage++;
        if (person.audio === "leak" || person.activity === "call" || person.activity === "talk") stats.noisy++;
        if (person.activity === "read") stats.read++;
        if (person.group) stats.grouped++;
      }
    }
  }
  assert.equal(totals.size, 4);
  const commute = totals.get("commute")!, luggage = totals.get("luggage")!, quiet = totals.get("quiet")!, groups = totals.get("groups")!;
  assert.ok(commute.screen / commute.awake > 0.65);
  assert.ok(luggage.luggage / luggage.people > 0.7);
  assert.equal(quiet.noisy, 0);
  assert.ok(quiet.read / quiet.awake > 0.65);
  assert.ok(groups.grouped / groups.awake > 0.65);
  assert.ok(terminal / riders > 0.92 && terminal / riders < 0.98);
});
