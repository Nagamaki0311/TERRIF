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
  // Every rare event needs a source from the current wave.
  if (!sameWave.length) return [];
  const types = (events: TroubleEvent[]) =>
    new Set(events.map((event) => event.type));
  const containsTypes = (events: TroubleEvent[], required: string[]) =>
    required.every((type) => types(events).has(type));
  const includesCurrent = (events: TroubleEvent[]) =>
    events.some((event) => event.wave === wave);
  const cell = (person: Passenger) => cellById.get(person.cellId!)!;
  const historyMembers = members(history);
  const waveMembers = members(sameWave);
  const waveTypes = types(sameWave);
  const historyTypes = types(history);
  const doorHistory = history.filter(event => members([event]).some(person => cell(person).row === 3 && cell(person).kind === "door"));
  const audioHistory = history.filter(event => ["N19", "N20", "N21"].includes(event.type));
  const audioWaves = audioHistory.filter(event => event.wave > 0).map(event => event.wave);
  const boardingHistory = history.filter(event => ["N30", "N32", "N37"].includes(event.type));
  const southernDoors = new Set(historyMembers
    .filter(person => cell(person).row === 3 && cell(person).kind === "door")
    .map(person => cell(person).door));
  const rows = new Set(waveMembers.map(person => cell(person).row));
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
    waveTypes.has("N09") && waveTypes.has("N46") ? smallestGroup(
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
    ) : null,
  );
  add(
    "S02",
    southernDoors.size === 4 && types(doorHistory).size >= 4 && includesCurrent(doorHistory) ? smallestGroup(
      doorHistory,
      4,
      4,
      (group) => {
        const doors = new Set(
          members(group)
            .filter((p) => cell(p).row === 3 && cell(p).kind === "door")
            .map((p) => cell(p).door),
        );
        return (
          doors.size === 4 && types(group).size >= 4 && includesCurrent(group)
        );
      },
    ) : null,
  );
  add(
    "S03",
    ["N11", "N12", "N13"].every(type => waveTypes.has(type)) ? smallestGroup(
      sameWave.filter((event) => ["N11", "N12", "N13"].includes(event.type)),
      3,
      3,
      (group) => containsTypes(group, ["N11", "N12", "N13"]),
    ) : null,
  );
  add(
    "S04",
    ["N19", "N20", "N21"].every(type => historyTypes.has(type))
      && includesCurrent(audioHistory) && new Set(audioWaves).size < audioWaves.length ? smallestGroup(
      audioHistory,
      3,
      3,
      (group) => {
        // Positive wave numbers belong to this placement's reaction.
        // Earlier placements use negative markers and cannot prove simultaneity.
        const waves = group.filter((event) => event.wave > 0).map((event) => event.wave);
        return (
          containsTypes(group, ["N19", "N20", "N21"]) &&
          new Set(waves).size < waves.length &&
          includesCurrent(group)
        );
      },
    ) : null,
  );
  add(
    "S05",
    new Set(waveMembers.map(person => person.species)).size === 5 ? smallestGroup(
      sameWave,
      3,
      5,
      (group) => new Set(members(group).map((p) => p.species)).size === 5,
    ) : null,
  );
  add(
    "S06",
    waveMembers.some(person => person.age <= 20) && waveMembers.some(person => person.age === 40 || person.age === 50)
      && waveMembers.some(person => person.age >= 80) ? smallestGroup(sameWave, 3, 3, (group) => {
      const ages = members(group).map((p) => p.age);
      return (
        ages.some((age) => age <= 20) &&
        ages.some((age) => age === 40 || age === 50) &&
        ages.some((age) => age >= 80)
      );
    }) : null,
  );
  if (station >= 2 && station <= 5) {
    add(
      "S07",
      ["N30", "N32", "N37"].every(type => historyTypes.has(type)) && includesCurrent(boardingHistory) ? smallestGroup(
        boardingHistory,
        3,
        3,
        (group) =>
          containsTypes(group, ["N30", "N32", "N37"]) && includesCurrent(group),
      ) : null,
    );
  }
  add(
    "S08",
    ["N10", "N25", "N49"].every(type => waveTypes.has(type)) ? smallestGroup(
      sameWave.filter((event) => ["N10", "N25", "N49"].includes(event.type)),
      3,
      3,
      (group) => containsTypes(group, ["N10", "N25", "N49"]),
    ) : null,
  );
  if (station >= 3 && station <= 5) {
    add(
      "S09",
      historyTypes.size >= 3 && history.some(event => event.wave >= 3)
        && historyMembers.some(person => person.boardedAt <= 1)
        && historyMembers.some(person => person.boardedAt === station) ? smallestGroup(history, 3, 5, (group) => {
        const passengers = members(group);
        return (
          types(group).size >= 3 &&
          group.some((event) => event.wave >= 3) &&
          includesCurrent(group) &&
          passengers.some((p) => p.boardedAt <= 1) &&
          passengers.some((p) => p.boardedAt === station)
        );
      }) : null,
    );
  }
  add(
    "S10",
    waveTypes.size >= 5 && rows.has(1) && rows.has(2) && (rows.has(0) || rows.has(3))
      && sameWave.filter(event => members([event]).some(person => cell(person).kind === "door")).length >= 2
      ? smallestGroup(sameWave, 5, 5, (group) => {
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
    }) : null,
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
