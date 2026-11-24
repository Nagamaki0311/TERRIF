export type Species = "若人" | "働人" | "老人" | "客人" | "休人";
export type CellKind = "seat" | "standing" | "door";
export interface Cell {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  kind: CellKind;
  priority: boolean;
  capacity: number;
  door: number | null;
}
export interface Passenger {
  id: string;
  species: Species;
  age: number;
  sensitivity: number;
  luggage: boolean;
  stress: number;
  destination: number;
  cellId: string | null;
  boardedAt: number;
  belongings: "none" | "backpack" | "hand" | "wheeled";
  activity: "none" | "screen" | "call" | "talk" | "read" | "food";
  audio: "quiet" | "leak";
  attention: "aware" | "absorbed" | "asleep";
  posture: "normal" | "wide" | "lean";
  group: string | null;
}
export interface EventDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  points: number;
  rare: boolean;
}
export interface TroubleEvent {
  id: string;
  type: string;
  name: string;
  participants: string[];
  points: number;
  wave: number;
  rare: boolean;
  sources: string[];
}
export interface Wave {
  index: number;
  sources: string[];
  receivers: string[];
  triggered: string[];
  stress: Record<string, number>;
  events: TroubleEvent[];
  score: number;
}
export interface Evaluation {
  passengers: Passenger[];
  waves: Wave[];
  events: TroubleEvent[];
  score: number;
  maxChain: number;
}
export interface Snapshot {
  passengers: Passenger[];
  waiting: Passenger[];
  movesLeft: number;
}
export interface GameState extends Snapshot {
  seed: string;
  station: number;
  score: number;
  schedule: Passenger[][];
  history: Snapshot[];
  scoredEvents: string[];
  discovered: string[];
  lastEvaluation: Evaluation | null;
  finished: null | "terminal" | "capacity" | "no-space";
}
