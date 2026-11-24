import { capacity, cellById, cells } from "./board.ts";
import { evaluate } from "./evaluation.ts";
import { generateSchedule } from "./generation.ts";
import type { Evaluation, GameState, Snapshot } from "./types.ts";

export {
  cells,
  stations,
  capacity,
  maximumOccupancy,
  adjacent,
  cellById,
} from "./board.ts";
export { eventDefinitions } from "./catalog.ts";
export { evaluate } from "./evaluation.ts";
export type * from "./types.ts";

export function createGame(seed: string): GameState {
  const schedule = generateSchedule(seed);
  return {
    seed,
    station: 0,
    passengers: [],
    waiting: schedule[0].map((person) => ({ ...person })),
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
  return (
    state.passengers.filter(
      (passenger) =>
        passenger.id !== passengerId && passenger.cellId === cellId,
    ).length < cell.capacity
  );
}

function commit(
  state: GameState,
  result: Evaluation,
  finished: GameState["finished"],
): GameState {
  return {
    ...state,
    passengers: result.passengers,
    score: state.score + result.score,
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
    lastEvaluation: result,
    finished,
  };
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
    passengers: [...state.passengers, { ...person, cellId }],
    waiting: state.waiting.filter((passenger) => passenger.id !== passengerId),
    history: [...state.history, snapshot(state)],
    lastEvaluation: null,
  };
  if (next.passengers.length >= capacity * 2)
    return commit(next, evaluate(next), "capacity");
  return next;
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
  return {
    ...state,
    passengers: state.passengers.map((passenger) =>
      passenger.id === passengerId ? { ...passenger, cellId } : passenger,
    ),
    movesLeft: state.movesLeft - 1,
    history: [...state.history, snapshot(state)],
    lastEvaluation: null,
  };
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
  const passengers = [
    ...state.passengers.filter((passenger) => passenger.id !== passengerId),
    { ...person, cellId },
  ];
  return evaluate({ ...state, passengers });
}

export function depart(state: GameState): GameState {
  if (state.finished || state.waiting.length) return state;
  const committed = commit(state, evaluate(state), null);
  const station = state.station + 1;
  if (station >= 14)
    return {
      ...committed,
      station: 14,
      passengers: [],
      waiting: [],
      finished: "terminal",
    };
  const passengers = committed.passengers.filter(
    (person) => person.destination > station,
  );
  const waiting = state.schedule[station].map((person) => ({ ...person }));
  const noSpace =
    waiting.length > 0 &&
    passengers.length >= cells.reduce((sum, cell) => sum + cell.capacity, 0);
  return {
    ...committed,
    station,
    passengers,
    waiting,
    movesLeft: 2,
    finished: noSpace ? "no-space" : null,
  };
}
