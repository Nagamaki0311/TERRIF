import { cellById, cells, neighbors } from "./board.ts";
import type { Passenger } from "./types.ts";

export function getSpaceCapacity(cellId: string): number {
  const cell = cellById.get(cellId);
  return cell?.recommendedCapacity ?? cell?.capacity ?? 0;
}

/** Body units plus stable half-cell luggage reservations. */
export function getCellUsage(people: Passenger[], cellId: string): number {
  return people.reduce((sum, person) => sum + (person.cellId === cellId ? (person.bodySpace ?? 1) : 0) +
    (person.luggage && person.luggageCellId === cellId ? 0.5 : 0), 0);
}

export function luggageCandidates(cellId: string): string[] {
  const cell = cellById.get(cellId);
  if (!cell) return [];
  const adjacent = (neighbors.get(cellId) ?? []).map(id => cellById.get(id)!)
    .filter(other => other.kind === "standing");
  if (cell.kind === "seat") {
    return adjacent.filter(other => other.row === (cell.row === 0 ? 1 : 2)).map(other => other.id);
  }
  return adjacent.sort((a, b) => Number(b.row === cell.row) - Number(a.row === cell.row) || a.x - b.x || a.id.localeCompare(b.id)).map(other => other.id);
}

export function allocatePassenger(people: Passenger[], person: Passenger, cellId: string): Passenger | null {
  const cell = cellById.get(cellId);
  if (!cell) return null;
  const remaining = people.filter(other => other.id !== person.id);
  if (cell.kind !== "door" && remaining.some(other => other.cellId === cellId)) return null;
  if (remaining.filter(other => other.cellId === cellId).length >= cell.capacity) return null;
  const available = getSpaceCapacity(cellId) - getCellUsage(remaining, cellId);
  const bodySpace = available >= 1 ? 1 : available >= 0.5 && cell.kind !== "seat" ? 0.5 : null;
  if (bodySpace === null) return null;
  if (!person.luggage) return { ...person, cellId, bodySpace, luggageCellId: null };
  const candidates = luggageCandidates(cellId);
  // Preserve an existing reservation whenever the same body position is requested.
  const preferred = person.cellId === cellId && person.luggageCellId && candidates.includes(person.luggageCellId)
    ? [person.luggageCellId, ...candidates.filter(id => id !== person.luggageCellId)] : candidates;
  const luggageCellId = preferred.find(id => getCellUsage(remaining, id) + 0.5 <= cellById.get(id)!.capacity);
  return luggageCellId ? { ...person, cellId, bodySpace, luggageCellId } : null;
}

export function hasLegalPlacement(people: Passenger[], person: Passenger): boolean {
  return cells.some(cell => allocatePassenger(people, person, cell.id) !== null);
}

/** A compressed person expands again when the neighboring luggage leaves. */
export function normalizeBodySpace(people: Passenger[]): Passenger[] {
  const result = people.map(person => ({ ...person }));
  for (const person of result) {
    if (person.bodySpace === 0.5 && person.cellId &&
      getCellUsage(result.filter(other => other.id !== person.id), person.cellId) + 1 <= getSpaceCapacity(person.cellId)) person.bodySpace = 1;
  }
  return result;
}
