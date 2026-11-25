import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalCandidates,
  selectNormal,
  candidateEvent,
  waveScore,
} from "../src/game/events.ts";
import { rareCandidates, selectRare } from "../src/game/rare.ts";
import { eventDefinitions } from "../src/game/catalog.ts";
import { createGame, evaluate, allocatePassenger, cellById, getCellUsage, getSpaceCapacity } from "../src/game/index.ts";
import type { Passenger, TroubleEvent } from "../src/game/types.ts";

let serial = 0;
function p(cellId: string, patch: Partial<Passenger> = {}): Passenger {
  return {
    id: `f${serial++}`,
    species: patch.sensitivity === 4 ? "働人" : "若人",
    age: patch.sensitivity === 4 ? 50 : 20,
    sensitivity: 1,
    luggage: false,
    stress: 85,
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
const seat = "r0-b1-2",
  front = "r1-b1-2",
  nextSeat = "r0-b1-3",
  nextFront = "r1-b1-3";
const door = "r3-d1";
const fixtures: Record<string, () => Passenger[]> = {
  N01: () => [p(front), p(nextFront)],
  N02: () => [p(front, { posture: "lean" }), p("r2-b1-2")],
  N03: () => [p(door), p(door), p(door)],
  N04: () => [p(front, { posture: "lean" }), p(seat)],
  N05: () => [p(seat, { posture: "wide" }), p(nextSeat, { posture: "wide" })],
  N06: () => [
    p(seat, { posture: "wide" }),
    p(front, { luggage: true, belongings: "hand" }),
  ],
  N07: () => [p("r1-b0-0", { sensitivity: 4 }), p("r0-b0-0")],
  N08: () => [p("r0-b1-1"), p(seat, { posture: "wide" }), p(nextSeat)],
  N09: () => [p("r0-b0-0"), p("r0-b0-1", { posture: "lean" }), p("r1-b0-0")],
  N10: () => [p(seat, { attention: "asleep", posture: "lean" }), p(nextSeat)],
  N11: () => [
    p(front, { luggage: true, belongings: "backpack" }),
    p("r2-b1-2"),
  ],
  N12: () => [p(door, { luggage: true, belongings: "hand" }), p(door)],
  N13: () => [
    p(door, { luggage: true, belongings: "wheeled" }),
    p(door, { destination: 1 }),
  ],
  N14: () => [
    p(front, { luggage: true, belongings: "hand" }),
    p(nextFront, { luggage: true, belongings: "backpack" }),
  ],
  N15: () => [
    p(seat, { luggage: true, belongings: "hand" }),
    p(front, { luggage: true, belongings: "wheeled" }),
  ],
  N16: () => [
    p(front, { luggage: true, belongings: "backpack", posture: "lean" }),
    p(nextFront, { activity: "screen", attention: "absorbed" }),
  ],
  N17: () => [
    p("r1-b1-1", { luggage: true, belongings: "hand" }),
    p(front),
    p(nextFront, { luggage: true, belongings: "hand" }),
  ],
  N18: () => [
    p(door, { luggage: true, belongings: "wheeled" }),
    p(door, { luggage: true, belongings: "wheeled" }),
  ],
  N19: () => [p(front, { activity: "call" }), p(nextFront)],
  N20: () => [p(front, { audio: "leak" }), p(nextFront)],
  N21: () => [
    p("r1-b1-1", { group: "g1", activity: "talk" }),
    p(front, { group: "g1", activity: "talk" }),
    p(nextFront, { activity: "read" }),
  ],
  N22: () => [
    p(door, { activity: "screen", attention: "absorbed" }),
    p(door, { activity: "screen", attention: "absorbed" }),
  ],
  N23: () => [p(seat, { activity: "screen" }), p(front, { posture: "lean" })],
  N24: () => [p(seat, { activity: "read", posture: "wide" }), p(nextSeat)],
  N25: () => [
    p(seat, { activity: "food" }),
    p(nextSeat, { attention: "asleep" }),
  ],
  N26: () => [
    p(door, { activity: "call" }),
    p(door, { group: "g1", activity: "talk" }),
    p(door, { group: "g1", activity: "talk" }),
  ],
  N27: () => [
    p(door, { destination: 1 }),
    p(door, { audio: "leak", attention: "absorbed" }),
  ],
  N28: () => [
    p(door, { activity: "screen", attention: "absorbed" }),
    p(door, { destination: 1 }),
  ],
  N29: () => [p(door, { destination: 1 }), p(door, { posture: "wide" })],
  N30: () => [
    p(door, { destination: 1, luggage: true, belongings: "wheeled" }),
    p(door, { luggage: true, belongings: "hand" }),
  ],
  N31: () => [
    p(door, { destination: 1, attention: "absorbed" }),
    p(door, { destination: 1, attention: "absorbed" }),
  ],
  N32: () => [p(seat, { destination: 1 }), p(front), p("r2-b1-2")],
  N33: () => [p(door), p(door, { destination: 1, boardedAt: -1 })],
  N34: () => [p(seat, { destination: 1 }), p(front)],
  N35: () => [
    p(front, { destination: 1, luggage: true, belongings: "hand" }),
    p("r2-b1-2", { destination: 1 }),
  ],
  N36: () => [
    p("r0-d1", { destination: 1, attention: "absorbed" }),
    p("r0-d1", { posture: "lean" }),
  ],
  N37: () => [
    p(door, { group: "g1", destination: 1 }),
    p(door, { group: "g1", destination: 1 }),
    p(door),
  ],
  N38: () => [
    p(door, { posture: "wide", boardedAt: -1, attention: "absorbed" }),
    p(door, { destination: 1 }),
  ],
  N39: () => [
    p("r0-b1-1", { group: "g1", activity: "talk" }),
    p(seat, { attention: "asleep" }),
    p(nextSeat, { group: "g1", activity: "talk" }),
  ],
  N40: () => [
    p("r0-b1-1", { group: "g1" }),
    p(nextSeat, { group: "g1" }),
    p("r1-b1-1", { sensitivity: 4 }),
  ],
  N41: () => [
    p("r1-b1-1", { group: "g1", activity: "talk" }),
    p(front),
    p(nextFront, { group: "g1", activity: "talk" }),
  ],
  N42: () => [
    p(seat, { group: "g1" }),
    p(front, { group: "g1", sensitivity: 4 }),
  ],
  N43: () => [
    p(door, { group: "g1", luggage: true, belongings: "hand" }),
    p(door, { group: "g1", luggage: true, belongings: "backpack" }),
    p(door, { destination: 1 }),
  ],
  N44: () => [
    p("r1-b1-1", { group: "g1", activity: "talk" }),
    p(front, { group: "g1", activity: "talk" }),
    p(nextFront, { group: "g2", activity: "read" }),
    p("r1-b1-4", { group: "g2", activity: "read" }),
  ],
  N45: () => [p(front, { activity: "call" }), p("r2-b1-2", { audio: "leak" })],
  N46: () => [
    p("r0-b0-0", { attention: "absorbed" }),
    p("r1-b0-0", { posture: "wide", luggage: true, belongings: "hand" }),
  ],
  N47: () => [
    p(front, { activity: "read", posture: "wide" }),
    p("r2-b1-2", { activity: "read", posture: "wide" }),
  ],
  N48: () => [
    p(door, { attention: "absorbed", luggage: true, belongings: "hand" }),
    p(door, { attention: "absorbed", activity: "food" }),
  ],
  N49: () => [
    p(door, { destination: 1 }),
    p(door, { attention: "asleep", posture: "lean" }),
  ],
  N50: () => [
    p(door, { destination: 1 }),
    p(door, { luggage: true, belongings: "wheeled" }),
    p(door, { activity: "screen", attention: "absorbed" }),
  ],
};

function reserveFixture(people: Passenger[]): Passenger[] {
  const placed: Passenger[] = [];
  const ordered = [...people].sort((a,b) => Number(cellById.get(b.cellId!)!.kind === "seat") - Number(cellById.get(a.cellId!)!.kind === "seat") || Number(b.luggage)-Number(a.luggage));
  for (const person of ordered) {
    const allocated = allocatePassenger(placed, person, person.cellId!);
    assert.ok(allocated, `fixture cannot allocate ${person.id} at ${person.cellId}`);
    placed.push(allocated);
  }
  for (const person of people) Object.assign(person, placed.find(other => other.id===person.id));
  for(const cell of cellById.values()) assert.ok(getCellUsage(people,cell.id)<=getSpaceCapacity(cell.id));
  return people;
}
for(const [type,build] of Object.entries(fixtures)) fixtures[type] = () => reserveFixture(build());

for (const [type, build] of Object.entries(fixtures)) {
  test(`${type} has a reachable and selectable normal-event fixture`, () => {
    const people = build();
    const triggered = new Set(people.map((person) => person.id));
    const candidates = normalCandidates(people, triggered, 1, 0);
    assert.ok(
      candidates.some((event) => event.type === type),
      "condition detected",
    );
    const selected = selectNormal(
      candidates,
      new Set(),
      new Set(),
      new Map(),
      20,
    );
    assert.ok(
      selected.some((event) => event.type === type),
      `candidate not shadowed: ${selected.map((event) => event.type)}`,
    );
    assert.equal(
      normalCandidates(people, new Set(), 1, 0).length,
      0,
      "requires causal threshold crossing",
    );
    const reversed = normalCandidates([...people].reverse(), triggered, 1, 0);
    assert.deepEqual(
      reversed.map((event) => event.id).sort(),
      candidates.map((event) => event.id).sort(),
      "input order does not change candidate set",
    );
  });
}

test("catalog has exactly fifty-one ordinary and ten special definitions", () => {
  assert.equal(eventDefinitions.filter((event) => !event.rare).length, 51);
  assert.equal(eventDefinitions.filter((event) => event.rare).length, 10);
  assert.equal(new Set(eventDefinitions.map((event) => event.id)).size, 61);
});

test("selection canonical keys, participant budgets and integer wave scoring", () => {
  const people = fixtures.N01();
  const candidate = candidateEvent("N01", people, 1);
  assert.equal(
    candidateEvent("N01", [...people].reverse(), 1).id,
    candidate.id,
  );
  assert.equal(
    selectNormal([candidate], new Set([candidate.id]), new Set(), new Map(), 20)
      .length,
    0,
  );
  assert.equal(
    selectNormal([candidate], new Set(), new Set([people[0].id]), new Map(), 20)
      .length,
    0,
  );
  assert.equal(
    selectNormal([candidate], new Set(), new Set(), new Map([["N01", 2]]), 20)
      .length,
    0,
  );
  assert.equal(waveScore([candidate], 1), 20);
  assert.equal(
    waveScore(
      [
        candidateEvent("N06", people, 2),
        candidateEvent("N07", [p(seat), p(front)], 2),
      ],
      2,
    ),
    187,
  );
});

export { fixtures, p };

interface RareFixture {
  people: Passenger[];
  events: TroubleEvent[];
  station: number;
}
function rareFixture(
  types: string[],
  transform?: (groups: Passenger[][]) => void,
  station = 0,
): RareFixture {
  const groups = types.map((type) => fixtures[type]());
  transform?.(groups);
  for (const person of groups.flat()) {
    person.sensitivity =
      { 若人: 1, 働人: 2, 老人: 3, 客人: 2, 休人: 1 }[person.species] +
      Math.min(3, Math.floor((person.age - 10) / 20));
  }
  reserveFixture(groups.flat());
  return {
    people: groups.flat(),
    events: groups.map((group, index) =>
      candidateEvent(types[index], group, 2),
    ),
    station,
  };
}
function relocate(group: Passenger[], replacements: string[]): void {
  group.forEach((person, index) => {
    person.cellId = replacements[index];
  });
}
const rareFixtures: Record<string, () => RareFixture> = {
  S01: () =>
    rareFixture(["N09", "N46"], (groups) =>
      relocate(groups[1], ["r0-b4-0", "r1-b4-0"]),
    ),
  S02: () =>
    rareFixture(["N12", "N18", "N22", "N31"], (groups) => {
      groups.forEach((group, index) =>
        relocate(
          group,
          group.map(() => `r3-d${index}`),
        ),
      );
    }),
  S03: () =>
    rareFixture(["N11", "N12", "N13"], (groups) => {
      relocate(groups[0], ["r1-b0-1", "r2-b0-1"]);
      relocate(groups[1], ["r3-d0", "r3-d0"]);
      relocate(groups[2], ["r3-d1", "r3-d1"]);
    }),
  S04: () =>
    rareFixture(["N19", "N20", "N21"], (groups) => {
      relocate(groups[1], ["r1-b2-2", "r1-b2-3"]);
      relocate(groups[2], ["r1-b3-1", "r1-b3-2", "r1-b3-3"]);
    }),
  S05: () =>
    rareFixture(["N01", "N02", "N04"], (groups) => {
      relocate(groups[0], ["r1-b0-0", "r1-b0-1"]);
      relocate(groups[1], ["r1-b2-2", "r2-b2-2"]);
      relocate(groups[2], ["r1-b3-2", "r0-b3-2"]);
      const species: Passenger["species"][] = [
        "若人",
        "働人",
        "老人",
        "客人",
        "休人",
        "働人",
      ];
      groups.flat().forEach((person, index) => {
        person.species = species[index];
        person.age = person.species === "老人" ? 80 : 20;
      });
    }),
  S06: () =>
    rareFixture(["N01", "N02", "N04"], (groups) => {
      relocate(groups[0], ["r1-b0-0", "r1-b0-1"]);
      relocate(groups[1], ["r1-b2-2", "r2-b2-2"]);
      relocate(groups[2], ["r1-b3-2", "r0-b3-2"]);
      groups[0][0].age = 10;
      groups[1][0].age = 40;
      groups[2][0].age = 80;
      groups[0][0].species = "若人";
      groups[2][0].species = "老人";
    }),
  S07: () =>
    rareFixture(
      ["N30", "N32", "N37"],
      (groups) => {
        relocate(groups[0], ["r3-d0", "r3-d0"]);
        relocate(groups[1], ["r0-b2-2", "r1-b2-2", "r2-b2-2"]);
        relocate(groups[2], ["r3-d3", "r3-d3", "r3-d3"]);
        groups.flat().forEach((person) => {
          if (person.destination === 1) person.destination = 4;
        });
      },
      3,
    ),
  S08: () =>
    rareFixture(["N10", "N25", "N49"], (groups) => {
      relocate(groups[0], ["r0-b1-0", "r0-b1-1"]);
      relocate(groups[1], ["r0-b2-0", "r0-b2-1"]);
      relocate(groups[2], ["r3-d3", "r3-d3"]);
    }),
  S09: () => {
    const result = rareFixtures.S06();
    result.station = 4;
    result.people[0].boardedAt = 0;
    result.people[4].boardedAt = 4;
    result.events[0].wave = 3;
    return result;
  },
  S10: () =>
    rareFixture(["N01", "N02", "N04", "N12", "N22"], (groups) => {
      relocate(groups[0], ["r1-b0-0", "r1-b0-1"]);
      relocate(groups[1], ["r1-b2-2", "r2-b2-2"]);
      relocate(groups[2], ["r1-b3-2", "r0-b3-2"]);
      relocate(groups[3], ["r3-d0", "r3-d0"]);
      relocate(groups[4], ["r3-d3", "r3-d3"]);
    }),
};
for (const [type, build] of Object.entries(rareFixtures)) {
  test(`${type} recognizes a legal accepted-event history and can score`, () => {
    const fixture = build();
    const peopleById = new Map(
      fixture.people.map((person) => [person.id, person]),
    );
    // Verify that prerequisite normal logs really satisfy their respective predicates.
    for (const event of fixture.events) {
      const participants = event.participants.map((id) => peopleById.get(id)!);
      assert.ok(
        normalCandidates(
          participants,
          new Set(participants.map((person) => person.id)),
          event.wave,
          fixture.station,
        ).some((candidate) => candidate.type === event.type),
        `${type} prerequisite ${event.type}`,
      );
    }
    const normal = selectNormal(
      normalCandidates(
        fixture.people,
        new Set(fixture.people.map((person) => person.id)),
        2,
        fixture.station,
      ),
      new Set(),
      new Set(),
      new Map(),
      20,
    );
    for (const event of fixture.events)
      assert.ok(
        normal.some((candidate) => candidate.id === event.id),
        `${type} prerequisite selected ${event.type}`,
      );
    const candidates = rareCandidates(
      fixture.people,
      fixture.events,
      2,
      fixture.station,
    );
    const expected = candidates.find((event) => event.type === type);
    assert.ok(expected, "special condition detected");
    const selected = selectRare(candidates, new Set(), []);
    assert.ok(
      selected.some((event) => event.type === type),
      "special not shadowed by another special",
    );
    assert.equal(expected.sources.length, fixture.events.length);
    assert.equal(
      selectRare([expected], new Set([expected.id]), []).length,
      0,
      "once per play",
    );
    assert.equal(
      rareCandidates(fixture.people, fixture.events, 8, fixture.station).length,
      0,
      "requires a new normal event in this wave",
    );
  });
}

test("N35 uses the occupied-board walking exit, including remaining-person tie breaks", () => {
  const a = p("r1-b1-3", { luggage: true, belongings: "hand", destination: 1 });
  const b = p("r2-b1-3", { destination: 1 });
  const people = [
    a,
    b,
    p("r1-b1-2", { stress: 40 }),
    p("r2-b1-2", { stress: 40 }),
    p("r2-b1-4", { stress: 40 }),
  ];
  assert.equal(
    normalCandidates(people, new Set([a.id]), 1, 0).some(
      (event) => event.type === "N35",
    ),
    false,
  );
});

test("N40 recognizes the needy passenger in front of either member of a seated party", () => {
  const a = p("r0-b1-1", { group: "party" });
  const b = p("r0-b1-3", { group: "party" });
  const c = p("r1-b1-1", { sensitivity: 4 });
  for (const people of [
    [a, b, c],
    [b, a, c],
  ]) {
    assert.ok(
      normalCandidates(people, new Set([c.id]), 1, 0).some(
        (event) => event.type === "N40",
      ),
    );
  }
});

for (const [type, build] of Object.entries(fixtures)) {
  test(`${type} also scores through real recovery, propagation and wave selection`, () => {
    const original = build();
    let reached = false;
    for (const trigger of original) {
      for (let initial = 35; initial <= 75; initial += 5) {
      const people = original.map((person) => ({
        ...person,
        stress:
          person.id === trigger.id
            ? initial
            : 100,
      }));
      const station = people.some((person) => person.boardedAt < 0) ? 1 : 0;
      if (station === 1)
        for (const person of people) {
          person.boardedAt++;
          if (person.destination === 1) person.destination = 2;
        }
      const game = {
        ...createGame("event-integration"),
        station,
        passengers: people,
        waiting: [],
      };
      const result = evaluate(game);
      if (result.events.some((event) => event.type === type)) {
        reached = true;
        break;
      }
      }
      if(reached)break;
    }
    assert.ok(
      reached,
      "ordinary event must be reachable from actual causal waves",
    );
  });
}

for (const [type, build] of Object.entries(rareFixtures)) {
  test(`${type} scores from a real causal wave evaluation`, () => {
    const fixture = build();
    const people = fixture.people.map((person) => ({ ...person, stress: 100 }));
    for (const source of fixture.events) {
      const group = people.filter((person) =>
        source.participants.includes(person.id),
      );
      let found = false;
      for (const target of group) {
        for(let initial=35;initial<=75;initial+=5){
        const attempt = group.map((person) => ({
          ...person,
          stress:
            person.id === target.id
              ? initial
              : 100,
        }));
        const result = evaluate({
          ...createGame("special-group"),
          station: fixture.station,
          passengers: attempt,
          waiting: [],
        });
        if (result.events.some((event) => event.type === source.type)) {
          for (const person of attempt)
            people.find((other) => other.id === person.id)!.stress =
              person.stress;
          found = true;
          break;
        }
        }
        if(found)break;
      }
      assert.ok(found, `precondition ignition for ${source.type}`);
    }
    if (type === "S09") {
      const chain = fixture.events.find((event) => event.type === "N01")!;
      const pair = chain.participants.map(
        (id) => people.find((person) => person.id === id)!,
      );
      pair[0].cellId = "r1-b1-2";
      pair[1].cellId = "r1-b1-3";
      pair.forEach((person) => {
        person.stress = 60;
      });
      people.push(
        p("r1-b1-0", { stress: 100, luggage: true, belongings: "backpack" }),
        p("r1-b1-1", { stress: 60, luggage: true, belongings: "backpack" }),
      );
    }
    const result = evaluate({
      ...createGame("special-integration"),
      station: fixture.station,
      passengers: people,
      waiting: [],
    });
    assert.ok(
      result.events.some((event) => event.type === type),
      `expected ${type}, got ${result.events.map((event) => event.type)}`,
    );
  });
}
