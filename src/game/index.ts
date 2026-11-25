import { capacity, cellById, cells } from "./board.ts";
import { evaluate } from "./evaluation.ts";
import { generateSchedule, createInitialPassengers, initialPassengerCount, seededRandom } from "./generation.ts";
import { allocatePassenger, hasLegalPlacement, normalizeBodySpace } from "./occupancy.ts";
import type { Evaluation, GameState, Snapshot } from "./types.ts";

export {
  cells,
  stations,
  capacity,
  maximumOccupancy,
  adjacent,
  exitPath,
  cellById,
} from "./board.ts";
export { eventDefinitions } from "./catalog.ts";
export { evaluate } from "./evaluation.ts";
export { getCellUsage, getSpaceCapacity, luggageCandidates, allocatePassenger } from "./occupancy.ts";
export type * from "./types.ts";

export function createGame(seed: string): GameState {
  const schedule = generateSchedule(seed);
  return {
    seed,
    objective: null,
    station: 0,
    passengers: createInitialPassengers(seed, schedule[0]),
    waiting: schedule[0].slice(initialPassengerCount(seed)).map((person) => ({ ...person })),
    schedule,
    movesLeft: 2,
    history: [],
    score: 0,
    scoredEvents: [],
    discovered: [],
    lastEvaluation: null,
    finished: null,
  };
}

function snapshot(state: GameState): Snapshot {
  return {
    passengers: state.passengers.map((person) => ({ ...person })),
    waiting: state.waiting.map((person) => ({ ...person })),
    movesLeft: state.movesLeft,
  };
}

export function canPlace(
  state: GameState,
  passengerId: string,
  cellId: string,
): boolean {
  if (state.finished) return false;
  const cell = cellById.get(cellId);
  if (!cell) return false;
  const person = [...state.passengers, ...state.waiting].find(
    (passenger) => passenger.id === passengerId,
  );
  if (!person) return false;
  const existing = state.passengers.some(
    (passenger) => passenger.id === passengerId,
  );
  if (existing && person.cellId !== cellId && state.movesLeft <= 0)
    return false;
  return allocatePassenger(state.passengers, person, cellId) !== null;
}

/** Four sectors around the four boarding doors. */
export function sectorAt(x: number): number {
  return Math.min(3, Math.max(0, Math.floor((x - 960) / 4520)));
}

export function routeChoices(state: GameState): number[] {
  const offset = Math.floor(seededRandom(state.seed + ":route:" + state.station)() * 4);
  const first = (offset + state.station) % 4;
  return [first, (first + 2) % 4];
}

export function chooseObjective(state: GameState, sector: number): GameState {
  if (state.finished || state.objective !== null || !routeChoices(state).includes(sector)) return state;
  return { ...state, objective: sector };
}

export function routeBonuses(result: Evaluation, objective: number | null) {
  const byId = new Map(result.passengers.map(person => [person.id, person.cellId]));
  const sectors = new Set<number>();
  let fulfilled = false;
  for (const event of result.events) {
    const positions = event.participants.flatMap(id => {
      const cellId = byId.get(id);
      const cell = cellId ? cellById.get(cellId) : undefined;
      return cell ? [cell.x + cell.width / 2] : [];
    });
    if (!positions.length) continue;
    const sector = sectorAt(positions.reduce((sum, x) => sum + x, 0) / positions.length);
    sectors.add(sector);
    if (sector === objective) fulfilled = true;
  }
  // Reward distinct trouble sites once per ride, regardless of event count in one spot.
  return {
    routeBonus: Math.max(0, sectors.size - 1) * 250,
    objectiveBonus: fulfilled ? 400 : 0,
  };
}

function commit(
  state: GameState,
  result: Evaluation,
  finished: GameState["finished"],
): GameState {
  const bonuses = routeBonuses(result, state.objective);
  const score = result.score + bonuses.routeBonus + bonuses.objectiveBonus;
  return {
    ...state,
    passengers: result.passengers,
    score: state.score + score,
    scoredEvents: [
      ...new Set([
        ...state.scoredEvents,
        ...result.events.map((event) => event.id),
      ]),
    ],
    discovered: [
      ...new Set([
        ...state.discovered,
        ...result.events.map((event) => event.type),
      ]),
    ],
    history: [],
    lastEvaluation: { ...result, ...bonuses, score },
    finished,
  };
}

function finishIfBlocked(state: GameState): GameState {
  if (state.passengers.length >= capacity * 2) return commit(state, evaluate(state), "capacity");
  if (!state.waiting.length || state.waiting.some(person => hasLegalPlacement(state.passengers, person))) return state;
  const movable = state.movesLeft > 0 && state.passengers.some(person =>
    cells.some(cell => cell.id !== person.cellId && allocatePassenger(state.passengers, person, cell.id) !== null));
  return movable ? state : commit(state, evaluate(state), "no-space");
}

export function place(
  state: GameState,
  passengerId: string,
  cellId: string,
): GameState {
  if (
    !state.waiting.some((person) => person.id === passengerId) ||
    !canPlace(state, passengerId, cellId)
  )
    return state;
  const person = state.waiting.find(
    (passenger) => passenger.id === passengerId,
  )!;
  const next = {
    ...state,
    passengers: normalizeBodySpace([...state.passengers, allocatePassenger(state.passengers, person, cellId)!]),
    waiting: state.waiting.filter((passenger) => passenger.id !== passengerId),
    history: [...state.history, snapshot(state)],
    lastEvaluation: null,
  };
  return finishIfBlocked(next);
}

export function move(
  state: GameState,
  passengerId: string,
  cellId: string,
): GameState {
  const person = state.passengers.find(
    (passenger) => passenger.id === passengerId,
  );
  if (
    !person ||
    person.cellId === cellId ||
    !canPlace(state, passengerId, cellId)
  )
    return state;
  return finishIfBlocked({
    ...state,
    passengers: normalizeBodySpace(state.passengers.map((passenger) =>
      passenger.id === passengerId ? allocatePassenger(state.passengers, person, cellId)! : passenger,
    )),
    movesLeft: state.movesLeft - 1,
    history: [...state.history, snapshot(state)],
    lastEvaluation: null,
  });
}

export function undo(state: GameState): GameState {
  if (state.finished || !state.history.length) return state;
  const previous = state.history[state.history.length - 1];
  return {
    ...state,
    ...previous,
    history: state.history.slice(0, -1),
    lastEvaluation: null,
  };
}

export function preview(
  state: GameState,
  passengerId?: string,
  cellId?: string,
): Evaluation {
  if (!passengerId || !cellId || !canPlace(state, passengerId, cellId))
    return evaluate(state);
  const person = [...state.waiting, ...state.passengers].find(
    (passenger) => passenger.id === passengerId,
  )!;
  const allocated = allocatePassenger(state.passengers, person, cellId)!;
  const passengers = person.cellId
    ? state.passengers.map((passenger) => passenger.id === passengerId ? allocated : passenger)
    : [...state.passengers, allocated];
  return evaluate({ ...state, passengers: normalizeBodySpace(passengers) });
}

export function depart(state: GameState): GameState {
  if (state.finished || state.waiting.length) return state;
  const committed = commit(state, evaluate(state), null);
  const station = state.station + 1;
  if (station >= 6)
    return {
      ...committed,
      station: 6,
      passengers: committed.passengers,
      waiting: [],
      finished: "terminal",
    };
  const passengers = normalizeBodySpace(committed.passengers.filter(
    (person) => person.destination > station,
  ));
  const waiting = state.schedule[station].map((person) => ({ ...person }));
  const noSpace =
    waiting.length > 0 &&
    !waiting.some(person => hasLegalPlacement(passengers, person));
  return {
    ...committed,
    station,
    passengers,
    waiting,
    objective: null,
    movesLeft: committed.lastEvaluation?.objectiveBonus ? 3 : 2,
    finished: noSpace ? "no-space" : null,
  };
}
