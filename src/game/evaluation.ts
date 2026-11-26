import { sectorAt, troubleSector } from "./perks.ts";
import { adjacent, cellById, cells, neighbors } from "./board.ts";
import { normalCandidates, selectNormal, waveScore } from "./events.ts";
import { getCellUsage } from "./occupancy.ts";
import { rareCandidates, selectRare } from "./rare.ts";
import type {
  Evaluation,
  GameState,
  Passenger,
  TroubleEvent,
  Wave,
} from "./types.ts";

export function evaluatePlacement(state: GameState, passengerId: string): Evaluation {
  const placed = state.passengers.find(person => person.id === passengerId)!;
  const affected = new Set(state.passengers
    .filter(person => person.id === passengerId || adjacent(person.cellId, placed.cellId))
    .map(person => person.id));
  return evaluate(state, affected);
}

export function evaluate(state: GameState, affected?: Set<string>): Evaluation {
  const passengers = state.passengers.map((person) => ({ ...person }));
  const standing = (person: Passenger) =>
    cellById.get(person.cellId!)!.kind !== "seat";
  const inPerkScope = (cell: (typeof cells)[number]) =>
    state.perk?.scope === "global" || state.perk?.sector === sectorAt(cell.x + cell.width / 2);
  const hasStandingNeed = passengers.some(
    (person) => standing(person) && person.sensitivity >= 4,
  );
  const vacantSeats = cells.some(cell => cell.kind === "seat" && getCellUsage(passengers, cell.id) === 0);
  const vacantStanding = cells.some(cell => cell.kind === "standing" && getCellUsage(passengers, cell.id) === 0);
  const rank = (person: Passenger) => person.special?.rarity === "SSS" ? 3 : person.special?.rarity === "SS" ? 2 : 1;
  for (const person of passengers) {
    if (affected && !affected.has(person.id)) continue;
    const cell = cellById.get(person.cellId!)!;
    const nearby = passengers.filter(
      (other) =>
        other.id !== person.id && adjacent(person.cellId, other.cellId),
    );
    const luggageNeighbors = nearby.filter(
      (other) => other.luggage && standing(other),
    ).length;
    const occupants = passengers.filter(
      (other) => other.cellId === person.cellId,
    ).length;
    const recovery =
      cell.kind === "seat"
        ? 12
        : occupants === 1 && luggageNeighbors === 0
          ? 2
          : 0;
    const sameRow = nearby.filter(other => cellById.get(other.cellId!)!.row === cell.row);
    const left = sameRow.some(other => cellById.get(other.cellId!)!.x < cell.x);
    const right = sameRow.some(other => cellById.get(other.cellId!)!.x > cell.x);
    const unwantedSeatNeighbor = cell.kind === "seat" && vacantSeats && sameRow.some(other => cellById.get(other.cellId!)!.kind === "seat");
    const standingInFront = cell.kind === "seat" && vacantStanding && nearby.some(other => cellById.get(other.cellId!)!.kind === "standing");
    const relationBurden = (unwantedSeatNeighbor ? 6 : 0) + (standingInFront ? 5 : 0) +
      (left && right && (vacantSeats || vacantStanding) ? 8 : 0) +
      (person.bodySpace === 0.5 ? 14 : 0) +
      (cell.kind === "door" && cell.row === 3 && (vacantSeats || vacantStanding) ? 5 : 0);
    const burden =
      (standing(person) ? person.sensitivity : 0) +
      (cell.kind === "door" && occupants === 3 ? 8 : 0) +
      luggageNeighbors * 2 +
      (cell.priority && person.sensitivity < 4 && hasStandingNeed ? 2 : 0) + relationBurden;
    const perk = state.perk?.kind === "buff" && inPerkScope(cell) ? state.perk : undefined;
    const receivesBuff = perk?.effect === "quiet" && nearby.length <= 1
      || perk?.effect === "seats" && cell.kind === "seat"
      || perk?.effect === "luggage" && (person.luggage || nearby.some(other => other.luggage))
      || perk?.effect === "switch" && standing(person);
    const perkBurden = receivesBuff ? perk!.strength! : 0;
    const aura = nearby.filter(other => other.special?.skill === "aura")
      .reduce((sum, other) => sum + rank(other) * 8, 0);
    const effectiveRecovery = perk?.effect === "seats" && cell.kind === "seat"
      ? perk.scope === "global" ? recovery / 2 : 0 : recovery;
    person.stress = Math.min(
      100,
      Math.max(0, person.stress - effectiveRecovery) + burden + perkBurden + aura,
    );
  }
  const stress = () =>
    Object.fromEntries(passengers.map((person) => [person.id, person.stress]));
  let sources = passengers
    .filter((person) => person.stress >= 80 && (!affected || affected.has(person.id)))
    .map((person) => person.id);
  const fired = new Set(sources);
  const paid = new Set(state.scoredEvents);
  const prior = affected ? state.stationEvents ?? [] : [];
  const used = new Set<string>(prior.filter(event => !event.rare).flatMap(event => event.participants));
  const counts = new Map<string, number>();
  for (const event of prior.filter(event => !event.rare)) counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  const normalHistory: TroubleEvent[] = [];
  const positions = new Map(passengers.map(person => [person.id, person.cellId]));
  const sectorCounts = [0, 0, 0, 0];
  for (const event of prior.filter(event => !event.rare)) {
    const sector = event.sector ?? troubleSector(event.participants, positions);
    if (sector >= 0) sectorCounts[sector]++;
  }
  const rareHistory: TroubleEvent[] = [];
  const priorNormal = prior.filter(event => !event.rare);
  const priorRare = prior.filter(event => event.rare);
  const waves: Wave[] = [];
  if (sources.length)
    waves.push({
      index: 0,
      sources: [...sources],
      receivers: [],
      triggered: [],
      stress: stress(),
      events: [],
      score: 0,
    });
  let index = 1;
  while (sources.length) {
    const sourceSet = new Set(sources);
    const receivers: string[] = [];
    const triggered: string[] = [];
    const changes = passengers.map((person) => {
      const senders = passengers.filter(
        (other) =>
          other.id !== person.id &&
          sourceSet.has(other.id) &&
          (adjacent(person.cellId, other.cellId) ||
            (other.special?.skill === "relay" && other.cellId !== null && person.cellId !== null &&
              (neighbors.get(other.cellId) ?? []).some(middle =>
                !passengers.some(occupant => occupant.cellId === middle) &&
                (neighbors.get(middle) ?? []).includes(person.cellId!)))),
      );
      if (senders.length) receivers.push(person.id);
      const target = cellById.get(person.cellId!)!;
      const specialBoost = senders.reduce((sum, sender) => {
        if (sender.special?.skill === "bridge" && cellById.get(sender.cellId!)!.row !== target.row)
          return sum + 10 * rank(sender);
        if (sender.special?.skill === "relay") return sum + 4 * rank(sender);
        return sum;
      }, 0);
      const resonant = state.perk?.effect === "bridge" && inPerkScope(target) && target.kind === "standing"
        ? senders.filter(sender => {
          const origin = cellById.get(sender.cellId!)!;
          return origin.kind === "standing" && origin.row !== target.row;
        }).length
        : 0;
      const after = Math.min(100, person.stress + senders.length * 25 + resonant * (state.perk?.strength ?? 0) + specialBoost);
      if (person.stress < 80 && after >= 80) triggered.push(person.id);
      return after;
    });
    passengers.forEach((person, position) => {
      person.stress = changes[position];
    });
    const normal = selectNormal(
      normalCandidates(passengers, new Set(triggered), index, state.station),
      paid,
      used,
      counts,
      20 - priorNormal.length - normalHistory.length,
    );
    normal.forEach(event => { event.sector = troubleSector(event.participants, positions); });
    normalHistory.push(...normal);
    const rareOptions = rareCandidates(
      passengers,
      [...priorNormal.map(event => ({ ...event, wave: -event.wave })), ...normalHistory],
      index,
      state.station,
    ).filter(event => event.sources.some(id => normal.some(current => current.id === id)));
    const rare = selectRare(
      rareOptions,
      paid,
      [...priorRare, ...rareHistory],
    );
    rare.forEach(event => { event.sector = troubleSector(event.participants, positions); });
    rareHistory.push(...rare);
    // Later trouble at the same location has diminishing value within the ride.
    const scoringEvents = normal.map(event => {
      const sector = event.sector ?? troubleSector(event.participants, positions);
      if (sector < 0 || ++sectorCounts[sector] <= 2) return event;
      return { ...event, points: Math.floor(event.points * 0.4) };
    });
    const score =
      waveScore(scoringEvents, index) +
      rare.reduce((sum, event) => sum + event.points, 0);
    waves.push({
      index,
      sources: [...sources],
      receivers,
      triggered,
      stress: stress(),
      events: [...normal, ...rare],
      score,
    });
    sources = triggered.filter((id) => !fired.has(id));
    sources.forEach((id) => fired.add(id));
    index++;
  }
  return {
    passengers,
    waves,
    events: [...normalHistory, ...rareHistory],
    score: waves.reduce((sum, wave) => sum + wave.score, 0),
    maxChain: Math.max(
      0,
      ...waves
        .filter((wave) => wave.triggered.length > 0)
        .map((wave) => wave.index),
    ),
  };
}
