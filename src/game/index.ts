import { capacity, cellById, cells } from "./board.ts";
import { perkChoices, troubleSector } from "./perks.ts";
import { evaluate, evaluatePlacement } from "./evaluation.ts";
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

export { perkChoices, sectorAt } from "./perks.ts";

export function choosePerk(state: GameState, id: string): GameState {
  if (state.finished || state.perk) return state;
  const perk = perkChoices(state.seed, state.station).find(offer => offer.id === id);
  if (!perk) return state;
  const extraMoves = perk.id === "switch" ? 2 : 0;
  const special = perk.kind === "special" ? {
    ...state.schedule[state.station][0],
    id: "special-" + state.station,
    species: "客人" as const,
    age: 40, sensitivity: 3, luggage: false, belongings: "none" as const,
    group: null, attention: "aware" as const, audio: "quiet" as const,
    activity: perk.skill === "bridge" ? "none" as const : "talk" as const,
    posture: perk.skill === "bridge" ? "lean" as const : "normal" as const,
    cellId: null, luggageCellId: null, bodySpace: 1 as const,
    stress: perk.rarity === "SSS" ? 76 : perk.rarity === "SS" ? 70 : 64,
    destination: 6, boardedAt: state.station,
    special: { name: perk.name, rarity: perk.rarity!, skill: perk.skill! },
  } : null;
  return {
    ...state, perk, objective: perk.sector,
    waiting: special ? [special, ...state.waiting] : state.waiting,
    movesLeft: state.movesLeft + extraMoves,
    history: state.history.map(entry => ({ ...entry, movesLeft: entry.movesLeft + extraMoves })),
  };
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
    const sector = troubleSector(event.participants, byId);
    if (sector < 0) continue;
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
  const priorEvents = state.stationEvents ?? [];
  const positions = new Map(result.passengers.map(person => [person.id, person.cellId]));
  const priorSectors = new Set(state.stationSectors ?? []);
  const currentSectors = new Set(result.events.map(event =>
    event.sector ?? troubleSector(event.participants, positions)).filter(sector => sector >= 0));
  const allSectors = new Set([...priorSectors, ...currentSectors]);
  const bonuses = {
    routeBonus: (Math.max(0, allSectors.size - 1) - Math.max(0, priorSectors.size - 1)) * 250,
    objectiveBonus: !state.objectiveFulfilled && state.objective !== null && currentSectors.has(state.objective) ? 400 : 0,
  };
  const score = result.score + bonuses.routeBonus + bonuses.objectiveBonus;
  return {
    ...state,
    passengers: result.passengers,
    stationEvents: [...priorEvents, ...result.events],
    stationSectors: [...allSectors],
    objectiveFulfilled: state.objectiveFulfilled || bonuses.objectiveBonus > 0,
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
  if (state.passengers.length >= capacity * 2) return { ...state, finished: "capacity" };
  if (!state.waiting.length || state.waiting.some(person => hasLegalPlacement(state.passengers, person))) return state;
  const movable = state.movesLeft > 0 && state.passengers.some(person =>
    cells.some(cell => cell.id !== person.cellId && allocatePassenger(state.passengers, person, cell.id) !== null));
  return movable ? state : { ...state, finished: "no-space" };
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
  return finishIfBlocked(commit(next, evaluatePlacement(next, passengerId), null));
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
  const next = {
    ...state,
    passengers: normalizeBodySpace(state.passengers.map((passenger) =>
      passenger.id === passengerId ? allocatePassenger(state.passengers, person, cellId)! : passenger,
    )),
    movesLeft: state.movesLeft - 1,
    history: [...state.history, snapshot(state)],
    lastEvaluation: null,
  };
  return finishIfBlocked(commit(next, evaluatePlacement(next, passengerId), null));
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
  return evaluatePlacement({ ...state, passengers: normalizeBodySpace(passengers) }, passengerId);
}

export function depart(state: GameState): GameState {
  if (state.finished || state.waiting.length) return state;
  const committed = state;
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
  return finishIfBlocked({
    ...committed,
    station,
    passengers,
    waiting,
    objective: null,
    stationEvents: [],
    stationSectors: [],
    objectiveFulfilled: false,
    lastEvaluation: null,
    perk: undefined,
    movesLeft: committed.objectiveFulfilled ? 3 : 2,
    finished: null,
  });
}
