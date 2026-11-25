import { cells } from "./board.ts";
import { allocatePassenger, getCellUsage } from "./occupancy.ts";
import type { Passenger, Species } from "./types.ts";

export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const character of seed)
    state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export function generateSchedule(seed: string): Passenger[][] {
  const random = seededRandom(seed);
  const pick = <T>(values: T[]): T =>
    values[Math.floor(random() * values.length)];
  const initialCount = initialPassengerCount(seed);
  const traffic = Math.max(54, 128 - initialCount);
  const weights = [0.10, 0.14, 0.18, 0.22, 0.22, 0.14];
  const counts = [...weights.map(weight => Math.round(traffic * weight)), 0];
  counts[0] += initialCount;
  const roster: Passenger[][] = [];
  let serial = 0;
  for (let station = 0; station < 7; station++) {
    const count =
      station === 6 ? 0 : counts[station] + Math.floor(random() * 5) - 2;
    const people: Passenger[] = [];
    for (let i = 0; i < count; i++) {
      const draw = random();
      const species: Species =
        draw < 0.2
          ? "若人"
          : draw < 0.6
            ? "働人"
            : draw < 0.75
              ? "老人"
              : draw < 0.9
                ? "客人"
                : "休人";
      const ages =
        species === "若人"
          ? [10, 20]
          : species === "働人"
            ? [10, 20, 30, 40, 50, 60]
            : species === "老人"
              ? [60, 70, 80, 90]
              : [10, 20, 30, 40, 50, 60, 70, 80, 90];
      const age = pick(ages);
      const adjustment = Math.min(3, Math.floor((age - 10) / 20));
      const base = { 若人: 1, 働人: 2, 老人: 3, 客人: 2, 休人: 1 }[species];
      const baggageRate =
        { 若人: 0.1, 働人: 0.2, 老人: 0.1, 客人: 0.6, 休人: 0.3 }[species] +
        adjustment * 0.05;
      const belongings: Passenger["belongings"] =
        random() < baggageRate ? pick(["backpack", "hand", "wheeled"]) : "none";
      const attention = pick<Passenger["attention"]>([
        "aware",
        "aware",
        "absorbed",
        "asleep",
      ]);
      const activity =
        attention === "asleep"
          ? "none"
          : pick<Passenger["activity"]>([
              "none",
              "screen",
              "call",
              "talk",
              "read",
              "food",
            ]);
      const initialStress = { 若人: 10, 働人: 35, 老人: 20, 客人: 20, 休人: 5 }[
        species
      ];
      // Journey tension gives early placement a meaningful ignition window.
      const stress = Math.min(
        78,
        initialStress + adjustment * 5 + 24 + Math.floor(random() * 14),
      );
      const destination =
        random() < 0.94
          ? 6
          : station + 1 + Math.floor(random() * (6 - station));
      people.push({
        id: `p${serial++}`,
        species,
        age,
        sensitivity: base + adjustment,
        luggage: belongings !== "none",
        stress,
        destination,
        cellId: null,
        boardedAt: station,
        belongings,
        activity,
        audio:
          attention === "asleep" ? "quiet" : random() < 0.3 ? "leak" : "quiet",
        attention,
        posture: pick(["normal", "wide", "lean"]),
        group: null,
      });
    }
    // One seeded party of two or three, with a common destination.
    if (people.length >= 3 && random() < 0.8) {
      const members = random() < 0.5 ? 2 : 3;
      const destination = people[0].destination;
      for (let i = 0; i < members; i++) {
        people[i].group = `g${station}`;
        people[i].destination = destination;
      }
    }
    roster.push(people);
  }
  return roster;
}

export function initialPassengerCount(seed: string): number {
  return 30 + Math.floor(seededRandom(`${seed}:initial-count`)() * 31);
}

export function createInitialPassengers(seed: string, roster: Passenger[]): Passenger[] {
  const random = seededRandom(`${seed}:initial-layout`);
  const seatGroups = new Map<string, typeof cells>();
  for (const cell of cells.filter(cell => cell.kind === "seat")) {
    const band = cell.id.split("-").slice(0, 2).join("-");
    seatGroups.set(band, [...(seatGroups.get(band) ?? []), cell]);
  }
  const ranked: { cell: typeof cells[number]; rank: number; tie: number }[] = [];
  for (const group of seatGroups.values()) {
    group.sort((a,b) => a.x-b.x);
    const used = new Set<number>();
    let rank = 0;
    for (let distance = 0; distance < group.length; distance += 2) {
      for (const index of [distance, group.length-1-distance]) {
        if (index < 0 || index >= group.length || used.has(index) || used.has(index-1) || used.has(index+1)) continue;
        used.add(index); ranked.push({cell:group[index],rank:rank++,tie:random()});
      }
    }
  }
  ranked.sort((a,b) => a.rank-b.rank || a.tie-b.tie);
  const people: Passenger[] = [];
  for (const original of roster.slice(0, initialPassengerCount(seed))) {
    const person = {...original, boardedAt: -1};
    let placed: Passenger | null = null;
    for (const entry of ranked) {
      if (people.some(other => other.cellId && cells.find(cell => cell.id===other.cellId)?.row===entry.cell.row &&
        Math.abs(cells.find(cell => cell.id===other.cellId)!.x-entry.cell.x)===460)) continue;
      placed = allocatePassenger(people,person,entry.cell.id);
      if (placed) break;
    }
    if (!placed) {
      const choices = cells.filter(cell => cell.kind === "standing").map(cell => ({cell,tie:random()})).sort((a,b)=>getCellUsage(people,a.cell.id)-getCellUsage(people,b.cell.id)||a.tie-b.tie);
      for (const {cell} of choices) { placed = allocatePassenger(people,person,cell.id); if(placed)break; }
    }
    if (!placed) throw new Error("Initial passenger layout exceeds available space");
    people.push(placed);
  }
  return people;
}
