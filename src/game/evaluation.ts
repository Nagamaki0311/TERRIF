import { adjacent, cellById, cells } from "./board.ts";
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

export function evaluate(state: GameState): Evaluation {
  const passengers = state.passengers.map((person) => ({ ...person }));
  const standing = (person: Passenger) =>
    cellById.get(person.cellId!)!.kind !== "seat";
  const hasStandingNeed = passengers.some(
    (person) => standing(person) && person.sensitivity >= 4,
  );
  const vacantSeats = cells.some(cell => cell.kind === "seat" && getCellUsage(passengers, cell.id) === 0);
  const vacantStanding = cells.some(cell => cell.kind === "standing" && getCellUsage(passengers, cell.id) === 0);
  for (const person of passengers) {
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
    person.stress = Math.min(
      100,
      Math.max(0, person.stress - recovery) + burden,
    );
  }
  const stress = () =>
    Object.fromEntries(passengers.map((person) => [person.id, person.stress]));
  let sources = passengers
    .filter((person) => person.stress >= 80)
    .map((person) => person.id);
  const fired = new Set(sources);
  const paid = new Set(state.scoredEvents);
  const used = new Set<string>();
  const counts = new Map<string, number>();
  const normalHistory: TroubleEvent[] = [];
  const rareHistory: TroubleEvent[] = [];
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
      const hits = passengers.filter(
        (other) =>
          other.id !== person.id &&
          sourceSet.has(other.id) &&
          adjacent(person.cellId, other.cellId),
      ).length;
      if (hits) receivers.push(person.id);
      const after = Math.min(100, person.stress + hits * 25);
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
      20 - normalHistory.length,
    );
    normalHistory.push(...normal);
    const rare = selectRare(
      rareCandidates(passengers, normalHistory, index, state.station),
      paid,
      rareHistory,
    );
    rareHistory.push(...rare);
    const score =
      waveScore(normal, index) +
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
