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
  const counts = [12, 4, 6, 3, 3, 4, 6, 8, 10, 12, 14, 16, 14, 10, 0];
  const roster: Passenger[][] = [];
  let serial = 0;
  for (let station = 0; station < 15; station++) {
    const count =
      station === 14 ? 0 : counts[station] + Math.floor(random() * 5) - 2;
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
        random() < 0.45
          ? 14
          : station + 1 + Math.floor(random() * (14 - station));
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
