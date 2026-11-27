import { adjacent, capacity, cellById, cells } from "./board.ts";
import { perkChoices, troubleSector } from "./perks.ts";
import { evaluate, evaluatePlacement } from "./evaluation.ts";
import { generateSchedule, createInitialPassengers, initialPassengerCount, seededRandom } from "./generation.ts";
import { allocatePassenger, hasLegalPlacement, normalizeBodySpace } from "./occupancy.ts";
import { eventDefinitions } from "./catalog.ts";
import type { Evaluation, GameState, Passenger, Snapshot, TroubleEvent } from "./types.ts";

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
export { stationProfile } from "./generation.ts";
export { getCellUsage, getSpaceCapacity, luggageCandidates, allocatePassenger } from "./occupancy.ts";
export type * from "./types.ts";

export function createGame(seed: string): GameState {
  const schedule = generateSchedule(seed);
  return {
    seed,
    objective: null,
    buffs: [],
    eventLedger: [],
    maxChain: 0,
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

export function summarizeChaos(state: GameState) {
  const ledger = state.eventLedger;
  const rare = ledger.filter(event => event.rare).length;
  const total = ledger.length;
  const types = new Set(ledger.map(event => event.type)).size;
  const sectors = new Set(ledger.map(event => event.sector).filter(sector => sector !== undefined && sector >= 0 && sector < 4)).size;
  const categories = new Map<string, number>();
  for (const event of ledger) {
    const category = eventDefinitions.find(definition => definition.id === event.type)?.category;
    if (category) categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  const mainCategory = [...categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  // Breadth and variety are required: repeated trouble in one corner cannot reach the top stages.
  const stage = types >= 12 && sectors === 4 && total >= 20 ? 4
    : types >= 8 && sectors >= 3 && total >= 12 ? 3
    : types >= 4 && sectors >= 2 && total >= 6 ? 2
    : total > 0 ? 1 : 0;
  return { total, events: total - rare, rare, types, sectors, maxChain: state.maxChain,
    mainCategory, stage, label: ["平穏", "ざわつき", "混乱", "大混乱", "カオス"][stage] };
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
  const perk = perkChoices(state.seed, state.station, state.buffs).find(offer => offer.id === id);
  if (!perk) return state;
  const extraMoves = perk.effect === "switch" ? perk.scope === "global" ? 1 : 2 : 0;
  const special = perk.kind === "special" ? {
    ...state.schedule[state.station][0],
    id: "special-" + state.station,
    species: "客人" as const,
    age: 40, sensitivity: 3, luggage: false, belongings: "none" as const,
    group: perk.skill === "gather" ? "special-group-" + state.station : null,
    attention: "aware" as const, audio: "quiet" as const,
    activity: perk.skill === "snack" ? "food" as const : perk.skill === "bridge" ? "none" as const : "talk" as const,
    posture: perk.skill === "bridge" ? "lean" as const : "normal" as const,
    cellId: null, luggageCellId: null, bodySpace: 1 as const,
    stress: perk.rarity === "SSS" ? 76 : perk.rarity === "SS" ? 70 : 64,
    destination: 6, boardedAt: state.station,
    special: { name: perk.name, rarity: perk.rarity!, skill: perk.skill! },
  } : null;
  return {
    ...state, perk, objective: perk.sector,
    buffs: perk.kind === "buff" ? [...state.buffs, perk] : state.buffs,
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

function afterTrouble(passengers: Passenger[], events: TroubleEvent[]): Passenger[] {
  const categories = new Map<string, Set<string>>();
  for (const event of events) {
    const category = eventDefinitions.find(definition => definition.id === event.type)?.category;
    if (!category || category === "特殊") continue;
    for (const id of event.participants) {
      if (!categories.has(id)) categories.set(id, new Set());
      categories.get(id)!.add(category);
    }
  }
  return passengers.map(person => {
    const affected = categories.get(person.id);
    if (!affected) return person;
    const next = { ...person };
    const reactions: string[] = [];
    if (next.attention === "asleep") {
      next.attention = "aware";
      reactions.push("目を覚ました");
    }
    let screenFocus = false;
    if (affected.has("行動・音")) {
      if (next.audio === "leak" || next.activity === "call") {
        reactions.push(next.activity === "call" ? "通話を切って画面に集中" : "音を止めて画面に集中");
        next.audio = "quiet";
        next.activity = "screen";
        next.attention = "absorbed";
        screenFocus = true;
      } else if (next.activity === "talk") {
        reactions.push("会話が止まった");
        next.activity = "none";
      }
    }
    if (!screenFocus && next.attention === "absorbed") {
      next.attention = "aware";
      reactions.push("顔を上げた");
    }
    if ((affected.has("空間・座席") || affected.has("荷物") || affected.has("乗降")) && next.posture !== "normal") {
      next.posture = "normal";
      reactions.push("姿勢を直した");
    }
    if (affected.has("集団・複合") && next.activity === "talk") {
      next.activity = "none";
      reactions.push("会話が止まった");
    }
    if (!reactions.length) return person;
    next.lastReaction = reactions.join("・");
    return next;
  });
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
  const events = result.events.map(event => ({ ...event, station: state.station }));
  return {
    ...state,
    passengers: afterTrouble(result.passengers, events),
    stationEvents: [...priorEvents, ...events],
    eventLedger: [...state.eventLedger, ...events],
    maxChain: Math.max(state.maxChain, result.maxChain),
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

function applyBoardingSkill(state: GameState, passengerId: string): GameState {
  const rider = state.passengers.find(person => person.id === passengerId)!;
  const skill = rider.special?.skill;
  if (skill !== "gather" && skill !== "snack") return state;
  const count = rider.special!.rarity === "SSS" ? 3 : rider.special!.rarity === "SS" ? 2 : 1;
  const invited = new Set(state.passengers.filter(person => person.id !== rider.id && !person.special
    && adjacent(person.cellId, rider.cellId)
    && (skill === "gather" ? person.group === null
      : person.attention !== "asleep" && ["none", "read", "screen"].includes(person.activity)))
    .slice(0, count).map(person => person.id));
  return { ...state, passengers: state.passengers.map(person => invited.has(person.id) ? {
    ...person, attention: "aware", activity: skill === "gather" ? "talk" : "food",
    group: skill === "gather" ? rider.group : person.group,
    lastReaction: skill === "gather" ? "話の輪に加わった" : "おやつを受け取った",
  } : person) };
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
  const boarded = applyBoardingSkill(next, passengerId);
  return finishIfBlocked(commit(boarded, evaluatePlacement(boarded, passengerId), null));
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
    movesLeft: (committed.objectiveFulfilled ? 3 : 2) + committed.buffs
      .filter(buff => buff.effect === "switch").reduce((sum, buff) => sum + (buff.scope === "global" ? 1 : 2), 0),
    finished: null,
  });
}
