import { adjacent, cellById, cells, exitPath } from "./board.ts";
import { eventDefinitions } from "./catalog.ts";
import type { Passenger, TroubleEvent } from "./types.ts";

const definitions = new Map(eventDefinitions.map((event) => [event.id, event]));
const cell = (p: Passenger) => cellById.get(p.cellId!)!;
const seated = (p: Passenger) => cell(p).kind === "seat";
const standing = (p: Passenger) => !seated(p);
const needy = (p: Passenger) => p.sensitivity >= 4;
const sameParty = (a: Passenger, b: Passenger) =>
  a.group !== null && a.group === b.group;
const near = (a: Passenger, b: Passenger) => adjacent(a.cellId, b.cellId);
const sameCell = (a: Passenger, b: Passenger) => a.cellId === b.cellId;
const horizontal = (a: Passenger, b: Passenger) =>
  cell(a).row === cell(b).row && !sameCell(a, b) && near(a, b);
const opposite = (a: Passenger, b: Passenger) =>
  [1, 2].includes(cell(a).row) &&
  [1, 2].includes(cell(b).row) &&
  cell(a).row !== cell(b).row &&
  near(a, b);
const seatFront = (a: Passenger, b: Passenger) =>
  seated(a) && standing(b) && near(a, b);
const normalStanding = (p: Passenger) => cell(p).kind === "standing";
const southDoor = (p: Passenger) =>
  cell(p).kind === "door" && cell(p).row === 2;
const northDoor = (p: Passenger) =>
  cell(p).kind === "door" && cell(p).row === 1;
const endSeat = (p: Passenger) =>
  seated(p) &&
  (p.cellId!.endsWith("-0") ||
    cells.every(
      (other) => other.row !== cell(p).row || other.x !== cell(p).x + 460,
    ));

export function candidateEvent(
  type: string,
  people: Passenger[],
  wave: number,
  sources: string[] = [],
): TroubleEvent {
  const definition = definitions.get(type)!;
  const participants = people.map((p) => p.id).sort();
  return {
    id: `${type}:${participants.join(",")}`,
    type,
    name: definition.name,
    participants,
    points: definition.points,
    wave,
    rare: definition.rare,
    sources,
  };
}

/** Only adjacent occupants on the actual south-side exit route can obstruct a passenger. */
export function onExitPath(
  a: Passenger,
  b: Passenger,
  people: Passenger[] = [],
  station = -1,
): boolean {
  if (!near(a, b) || seated(b)) return false;
  if (sameCell(a, b)) return southDoor(a) || northDoor(a);
  return exitPath(a.cellId!, people, station).slice(1).includes(b.cellId!);
}

export function normalCandidates(
  people: Passenger[],
  newlyTriggered: Set<string>,
  wave: number,
  station: number,
): TroubleEvent[] {
  if (newlyTriggered.size === 0) return [];
  const high = people.filter((p) => p.stress >= 80 && p.cellId !== null);
  const candidates = new Map<string, TroubleEvent>();
  const next = (p: Passenger) => p.destination === station + 1;
  const stays = (p: Passenger) => p.destination > station + 1;
  const long = (p: Passenger) => p.destination >= station + 2;
  const fresh = (p: Passenger) => p.boardedAt === station;
  const paths = new Map<string, string[]>();
  function route(person: Passenger): string[] {
    if (!paths.has(person.cellId!))
      paths.set(person.cellId!, exitPath(person.cellId!, people, station));
    return paths.get(person.cellId!)!;
  }
  function onPath(a: Passenger, b: Passenger): boolean {
    if (!near(a, b) || seated(b)) return false;
    if (sameCell(a, b)) return southDoor(a) || northDoor(a);
    return route(a).slice(1).includes(b.cellId!);
  }
  function add(type: string, members: Passenger[]): void {
    if (!members.some((p) => newlyTriggered.has(p.id))) return;
    if (new Set(members.map((p) => p.id)).size !== members.length) return;
    const event = candidateEvent(type, members, wave);
    candidates.set(event.id, event);
  }
  for (const a of high) {
    for (const b of high) {
      if (a === b || !near(a, b)) continue;
      const ac = cell(a);
      const bc = cell(b);
      if (
        horizontal(a, b) &&
        normalStanding(a) &&
        normalStanding(b) &&
        !a.luggage &&
        !b.luggage
      )
        add("N01", [a, b]);
      if (
        opposite(a, b) &&
        normalStanding(a) &&
        normalStanding(b) &&
        (a.posture === "lean" || b.posture === "lean")
      )
        add("N02", [a, b]);
      if (standing(a) && a.posture === "lean" && seatFront(b, a))
        add("N04", [a, b]);
      if (
        seated(a) &&
        seated(b) &&
        horizontal(a, b) &&
        a.posture === "wide" &&
        b.posture === "wide"
      )
        add("N05", [a, b]);
      if (seatFront(a, b) && a.posture === "wide" && b.luggage)
        add("N06", [a, b]);
      if (standing(a) && needy(a) && seated(b) && bc.priority && !needy(b))
        add("N07", [a, b]);
      if (
        seated(a) &&
        a.attention === "asleep" &&
        a.posture === "lean" &&
        seated(b) &&
        horizontal(a, b) &&
        b.attention === "aware"
      )
        add("N10", [a, b]);
      if (standing(a) && a.belongings === "backpack" && opposite(a, b))
        add("N11", [a, b]);
      if (standing(a) && a.belongings === "hand" && sameCell(a, b))
        add("N12", [a, b]);
      if (a.belongings === "wheeled" && next(b) && stays(a) && onPath(b, a))
        add("N13", [a, b]);
      if (
        standing(a) &&
        standing(b) &&
        a.luggage &&
        b.luggage &&
        a.belongings !== b.belongings
      )
        add("N14", [a, b]);
      if (
        seatFront(a, b) &&
        a.belongings === "hand" &&
        b.belongings === "wheeled"
      )
        add("N15", [a, b]);
      if (
        standing(a) &&
        a.belongings === "backpack" &&
        a.posture === "lean" &&
        horizontal(a, b) &&
        b.activity === "screen" &&
        b.attention === "absorbed"
      )
        add("N16", [a, b]);
      if (
        southDoor(a) &&
        sameCell(a, b) &&
        a.belongings === "wheeled" &&
        b.belongings === "wheeled" &&
        stays(a) &&
        stays(b)
      )
        add("N18", [a, b]);
      if (a.activity === "call" && b.activity === "none" && b.audio === "quiet")
        add("N19", [a, b]);
      if (a.audio === "leak" && b.audio === "quiet" && b.attention === "aware")
        add("N20", [a, b]);
      if (
        standing(a) &&
        standing(b) &&
        sameCell(a, b) &&
        a.activity === "screen" &&
        b.activity === "screen" &&
        a.attention === "absorbed" &&
        b.attention === "absorbed"
      )
        add("N22", [a, b]);
      if (
        seatFront(a, b) &&
        a.activity === "screen" &&
        b.posture === "lean" &&
        b.attention === "aware"
      )
        add("N23", [a, b]);
      if (
        a.activity === "read" &&
        a.posture === "wide" &&
        seated(b) &&
        horizontal(a, b)
      )
        add("N24", [a, b]);
      if (
        seated(a) &&
        seated(b) &&
        a.activity === "food" &&
        b.attention === "asleep"
      )
        add("N25", [a, b]);
      if (
        next(a) &&
        stays(b) &&
        b.audio === "leak" &&
        b.attention === "absorbed" &&
        onPath(a, b)
      )
        add("N27", [a, b]);
      if (
        southDoor(a) &&
        sameCell(a, b) &&
        a.activity === "screen" &&
        a.attention === "absorbed" &&
        stays(a) &&
        next(b)
      )
        add("N28", [a, b]);
      if (
        next(a) &&
        stays(b) &&
        b.posture === "wide" &&
        b.attention === "aware" &&
        onPath(a, b)
      )
        add("N29", [a, b]);
      if (
        next(a) &&
        a.belongings === "wheeled" &&
        stays(b) &&
        b.luggage &&
        onPath(a, b)
      )
        add("N30", [a, b]);
      if (
        southDoor(a) &&
        sameCell(a, b) &&
        next(a) &&
        next(b) &&
        a.attention === "absorbed" &&
        b.attention === "absorbed"
      )
        add("N31", [a, b]);
      if (
        southDoor(a) &&
        sameCell(a, b) &&
        fresh(a) &&
        stays(a) &&
        !fresh(b) &&
        next(b)
      )
        add("N33", [a, b]);
      if (fresh(a) && next(a) && seatFront(a, b) && long(b)) add("N34", [a, b]);
      if (
        opposite(a, b) &&
        next(a) &&
        next(b) &&
        a.luggage &&
        route(a).at(-1) === route(b).at(-1)
      )
        add("N35", [a, b]);
      if (
        northDoor(a) &&
        sameCell(a, b) &&
        next(a) &&
        a.attention === "absorbed" &&
        stays(b) &&
        b.posture === "lean"
      )
        add("N36", [a, b]);
      if (
        southDoor(a) &&
        sameCell(a, b) &&
        long(a) &&
        a.posture === "wide" &&
        !fresh(a) &&
        next(b)
      )
        add("N38", [a, b]);
      if (sameParty(a, b) && seatFront(a, b) && needy(b) && !needy(a))
        add("N42", [a, b]);
      if (opposite(a, b) && a.activity === "call" && b.audio === "leak")
        add("N45", [a, b]);
      if (
        endSeat(a) &&
        ac.row === 0 &&
        seatFront(a, b) &&
        b.posture === "wide" &&
        b.luggage &&
        a.attention === "absorbed"
      )
        add("N46", [a, b]);
      if (
        opposite(a, b) &&
        a.activity === "read" &&
        b.activity === "read" &&
        a.posture === "wide" &&
        b.posture === "wide"
      )
        add("N47", [a, b]);
      if (
        sameCell(a, b) &&
        a.belongings === "hand" &&
        a.attention === "absorbed" &&
        b.activity === "food" &&
        b.attention === "absorbed"
      )
        add("N48", [a, b]);
      if (
        next(a) &&
        stays(b) &&
        b.attention === "asleep" &&
        b.posture === "lean" &&
        onPath(a, b)
      )
        add("N49", [a, b]);
    }
  }
  // Three-person combinations are generated from local neighborhoods or small parties.
  for (const b of high) {
    const around = high.filter((p) => p !== b && near(p, b));
    for (let i = 0; i < around.length; i++)
      for (let j = i + 1; j < around.length; j++) {
        const a = around[i],
          c = around[j];
        const bc = cell(b);
        const same = sameCell(a, b) && sameCell(b, c);
        const line = horizontal(a, b) && horizontal(b, c) && !near(a, c);
        if (same && bc.kind === "door") add("N03", [a, b, c]);
        if (
          line &&
          seated(a) &&
          seated(b) &&
          seated(c) &&
          b.posture === "wide" &&
          a.posture === "normal" &&
          c.posture === "normal"
        )
          add("N08", [a, b, c]);
        if (
          endSeat(b) &&
          ((horizontal(a, b) && seatFront(b, c)) ||
            (horizontal(c, b) && seatFront(b, a))) &&
          (a.posture === "lean" || c.posture === "lean")
        )
          add("N09", [a, b, c]);
        if (
          line &&
          normalStanding(a) &&
          normalStanding(b) &&
          normalStanding(c) &&
          a.belongings === "hand" &&
          c.belongings === "hand" &&
          !b.luggage
        )
          add("N17", [a, b, c]);
        if (
          same &&
          b.activity === "call" &&
          sameParty(a, c) &&
          a.activity === "talk" &&
          c.activity === "talk"
        )
          add("N26", [a, b, c]);
        if (
          same &&
          southDoor(b) &&
          sameParty(a, c) &&
          next(a) &&
          next(c) &&
          stays(b)
        )
          add("N37", [a, b, c]);
        if (
          same &&
          southDoor(b) &&
          sameParty(a, c) &&
          a.luggage &&
          c.luggage &&
          next(b) &&
          !sameParty(a, b)
        )
          add("N43", [a, b, c]);
        if (
          line &&
          sameParty(a, c) &&
          a.activity === "talk" &&
          c.activity === "talk"
        ) {
          if (b.attention === "asleep") add("N39", [a, b, c]);
          if (normalStanding(a) && normalStanding(b) && normalStanding(c))
            add("N41", [a, b, c]);
        }
        if (same) {
          for (const [first, second, third] of [
            [a, b, c],
            [a, c, b],
            [b, a, c],
            [b, c, a],
            [c, a, b],
            [c, b, a],
          ]) {
            if (
              next(first) &&
              second.belongings === "wheeled" &&
              stays(second) &&
              third.activity === "screen" &&
              third.attention === "absorbed" &&
              stays(third)
            )
              add("N50", [a, b, c]);
          }
        }
      }
    if (seated(b) && cell(b).row === 0 && next(b)) {
      const north = high.find(
        (p) => cell(p).row === 1 && near(b, p) && stays(p),
      );
      const south =
        north &&
        high.find((p) => cell(p).row === 2 && opposite(north, p) && stays(p));
      if (north && south) add("N32", [b, north, south]);
    }
  }
  const parties = new Map<string, Passenger[]>();
  for (const p of high)
    if (p.group) parties.set(p.group, [...(parties.get(p.group) ?? []), p]);
  for (const group of parties.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i],
          b = group[j];
        if (a.activity === "talk" && b.activity === "talk" && near(a, b)) {
          for (const c of high)
            if (
              c !== a &&
              c !== b &&
              c.activity === "read" &&
              (near(a, c) || near(b, c))
            )
              add("N21", [a, b, c]);
        }
        if (
          seated(a) &&
          seated(b) &&
          !horizontal(a, b) &&
          a.cellId!.split("-b")[1].split("-")[0] ===
            b.cellId!.split("-b")[1].split("-")[0] &&
          cell(a).row === cell(b).row
        ) {
          for (const c of high)
            if (
              c !== a &&
              c !== b &&
              (seatFront(a, c) || seatFront(b, c)) &&
              needy(c)
            )
              add("N40", [a, b, c]);
        }
      }
  }
  const partyList = [...parties.values()];
  for (const talkers of partyList)
    for (const readers of partyList) {
      if (talkers === readers) continue;
      const ta = talkers.filter((p) => p.activity === "talk"),
        re = readers.filter((p) => p.activity === "read");
      if (ta.length < 2 || re.length < 2) continue;
      for (const a of ta)
        for (const b of ta)
          for (const c of re)
            for (const d of re) {
              if (a === b || c === d) continue;
              if (standing(b) && standing(c) && horizontal(b, c))
                add("N44", [a, b, c, d]);
            }
    }
  return [...candidates.values()];
}

export function selectNormal(
  candidates: TroubleEvent[],
  paid: Set<string>,
  used: Set<string>,
  counts: Map<string, number>,
  remaining: number,
): TroubleEvent[] {
  const selected: TroubleEvent[] = [];
  candidates.sort(
    (a, b) =>
      b.points - a.points ||
      a.type.localeCompare(b.type) ||
      a.id.localeCompare(b.id),
  );
  for (const event of candidates) {
    if (selected.length >= remaining) break;
    if (
      paid.has(event.id) ||
      (counts.get(event.type) ?? 0) >= 2 ||
      event.participants.some((id) => used.has(id))
    )
      continue;
    selected.push(event);
    paid.add(event.id);
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
    event.participants.forEach((id) => used.add(id));
  }
  return selected;
}

export function waveScore(events: TroubleEvent[], wave: number): number {
  if (!events.length) return 0;
  const count = Math.min(events.length, 10),
    types = Math.min(new Set(events.map((e) => e.type)).size, 5);
  // Integer quarters avoid accumulation of floating-point rounding errors.
  return Math.floor(
    (events.reduce((sum, e) => sum + e.points, 0) *
      (4 + count - 1 + types - 1) *
      (4 + Math.min(wave - 1, 4))) /
      16,
  );
}
