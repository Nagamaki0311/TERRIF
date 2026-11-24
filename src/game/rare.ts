import { cellById } from "./board.ts";
import { candidateEvent } from "./events.ts";
import type { Passenger, TroubleEvent } from "./types.ts";

function smallestGroup(
  events: TroubleEvent[],
  minimum: number,
  maximum: number,
  matches: (group: TroubleEvent[]) => boolean,
): TroubleEvent[] | null {
  const ordered = [...events].sort((a, b) => a.id.localeCompare(b.id));
  for (let size = minimum; size <= Math.min(maximum, ordered.length); size++) {
    let result: TroubleEvent[] | null = null;
    function visit(start: number, chosen: TroubleEvent[]): void {
      if (result) return;
      if (chosen.length === size) {
        if (matches(chosen)) result = [...chosen];
        return;
      }
      for (
        let index = start;
        index <= ordered.length - (size - chosen.length);
        index++
      ) {
        chosen.push(ordered[index]);
        visit(index + 1, chosen);
        chosen.pop();
        if (result) return;
      }
    }
    visit(0, []);
    if (result) return result;
  }
  return null;
}

export function rareCandidates(
  people: Passenger[],
  history: TroubleEvent[],
  wave: number,
  station: number,
): TroubleEvent[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  const members = (events: TroubleEvent[]) =>
    [...new Set(events.flatMap((event) => event.participants))].map(
      (id) => byId.get(id)!,
    );
  const sameWave = history.filter((event) => event.wave === wave);
  const types = (events: TroubleEvent[]) =>
    new Set(events.map((event) => event.type));
  const containsTypes = (events: TroubleEvent[], required: string[]) =>
    required.every((type) => types(events).has(type));
  const includesCurrent = (events: TroubleEvent[]) =>
    events.some((event) => event.wave === wave);
  const cell = (person: Passenger) => cellById.get(person.cellId!)!;
  const result: TroubleEvent[] = [];
  function add(type: string, source: TroubleEvent[] | null): void {
    if (!source || !includesCurrent(source)) return;
    result.push(
      candidateEvent(
        type,
        members(source),
        wave,
        source.map((event) => event.id).sort(),
      ),
    );
  }
  add(
    "S01",
    smallestGroup(
      sameWave.filter((event) => event.type === "N09" || event.type === "N46"),
      2,
      2,
      (group) => {
        const left = group.find((event) => event.type === "N09");
        const right = group.find((event) => event.type === "N46");
        return (
          !!left &&
          !!right &&
          members([left]).some((p) => cell(p).x < 2570) &&
          members([right]).some((p) => cell(p).x >= 17430)
        );
      },
    ),
  );
  add(
    "S02",
    smallestGroup(
      history.filter((event) =>
        members([event]).some(
          (p) => cell(p).row === 2 && cell(p).door !== null,
        ),
      ),
      4,
      4,
      (group) => {
        const doors = new Set(
          members(group)
            .filter((p) => cell(p).row === 2 && cell(p).door !== null)
            .map((p) => cell(p).door),
        );
        return (
          doors.size === 4 && types(group).size >= 4 && includesCurrent(group)
        );
      },
    ),
  );
  add(
    "S03",
    smallestGroup(
      sameWave.filter((event) => ["N11", "N12", "N13"].includes(event.type)),
      3,
      3,
      (group) => containsTypes(group, ["N11", "N12", "N13"]),
    ),
  );
  add(
    "S04",
    smallestGroup(
      history.filter((event) => ["N19", "N20", "N21"].includes(event.type)),
      3,
      3,
      (group) => {
        const waves = group.map((event) => event.wave);
        return (
          containsTypes(group, ["N19", "N20", "N21"]) &&
          new Set(waves).size < 3 &&
          includesCurrent(group)
        );
      },
    ),
  );
  add(
    "S05",
    smallestGroup(
      sameWave,
      3,
      5,
      (group) => new Set(members(group).map((p) => p.species)).size === 5,
    ),
  );
  add(
    "S06",
    smallestGroup(sameWave, 3, 3, (group) => {
      const ages = members(group).map((p) => p.age);
      return (
        ages.some((age) => age <= 20) &&
        ages.some((age) => age === 40 || age === 50) &&
        ages.some((age) => age >= 80)
      );
    }),
  );
  if (station + 1 >= 8 && station + 1 <= 13) {
    add(
      "S07",
      smallestGroup(
        history.filter((event) => ["N30", "N32", "N37"].includes(event.type)),
        3,
        3,
        (group) =>
          containsTypes(group, ["N30", "N32", "N37"]) && includesCurrent(group),
      ),
    );
  }
  add(
    "S08",
    smallestGroup(
      sameWave.filter((event) => ["N10", "N25", "N49"].includes(event.type)),
      3,
      3,
      (group) => containsTypes(group, ["N10", "N25", "N49"]),
    ),
  );
  if (station >= 9 && station <= 13) {
    add(
      "S09",
      smallestGroup(history, 3, 5, (group) => {
        const passengers = members(group);
        return (
          types(group).size >= 3 &&
          group.some((event) => event.wave >= 3) &&
          includesCurrent(group) &&
          passengers.some((p) => p.boardedAt <= 3) &&
          passengers.some((p) => p.boardedAt === station)
        );
      }),
    );
  }
  add(
    "S10",
    smallestGroup(sameWave, 5, 5, (group) => {
      const rows = new Set(members(group).map((p) => cell(p).row));
      return (
        types(group).size === 5 &&
        rows.has(1) &&
        rows.has(2) &&
        (rows.has(0) || rows.has(3)) &&
        group.filter((event) =>
          members([event]).some((p) => cell(p).kind === "door"),
        ).length >= 2
      );
    }),
  );
  return result;
}

export function selectRare(
  candidates: TroubleEvent[],
  paid: Set<string>,
  selected: TroubleEvent[],
): TroubleEvent[] {
  const accepted: TroubleEvent[] = [];
  const sourceKeys = new Set(selected.map((event) => event.sources.join("|")));
  for (const event of [...candidates].sort(
    (a, b) => b.points - a.points || a.type.localeCompare(b.type),
  )) {
    if (selected.length + accepted.length >= 2) break;
    if ([...paid].some((key) => key.startsWith(event.type + ":"))) continue;
    const sourceKey = event.sources.join("|");
    if (sourceKeys.has(sourceKey)) continue;
    paid.add(event.id);
    sourceKeys.add(sourceKey);
    accepted.push(event);
  }
  return accepted;
}
