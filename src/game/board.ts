import type { Cell } from "./types.ts";

const bands = [
  [1190, 3],
  [3870, 7],
  [8390, 7],
  [12910, 7],
  [17430, 3],
];
const doorStarts = [2570, 7090, 11610, 16130];
export const cells: Cell[] = [];
for (let row = 0; row < 4; row++) {
  for (const [bandIndex, [start, count]] of bands.entries()) {
    for (let column = 0; column < count; column++) {
      cells.push({
        id: `r${row}-b${bandIndex}-${column}`,
        x: start + column * 460,
        y: row * 450,
        width: 460,
        height: 450,
        row,
        kind: row === 0 || row === 3 ? "seat" : "standing",
        priority:
          (row === 0 || row === 3) && (bandIndex === 0 || bandIndex === 4),
        capacity: 1,
        door: null,
      });
    }
  }
  if (row === 1 || row === 2) {
    doorStarts.forEach((x, door) =>
      cells.push({
        id: `r${row}-d${door}`,
        x,
        y: row * 450,
        width: 1300,
        height: 450,
        row,
        kind: "door",
        priority: false,
        capacity: 3,
        door,
      }),
    );
  }
}
export const cellById = new Map(cells.map((cell) => [cell.id, cell]));
function sharesEdge(a: Cell, b: Cell): boolean {
  const verticalOverlap =
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const horizontalOverlap =
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  return (
    ((a.x + a.width === b.x || b.x + b.width === a.x) && verticalOverlap > 0) ||
    ((a.y + a.height === b.y || b.y + b.height === a.y) &&
      horizontalOverlap > 0)
  );
}
export const neighbors = new Map(
  cells.map((cell) => [
    cell.id,
    cells
      .filter((other) => other !== cell && sharesEdge(cell, other))
      .map((other) => other.id),
  ]),
);
export function adjacent(a: string | null, b: string | null): boolean {
  return (
    a !== null &&
    b !== null &&
    (a === b || neighbors.get(a)?.includes(b) === true)
  );
}
export const stations = [
  "川瀬口",
  "御園辻",
  "青葉丘陵",
  "杉越峠",
  "天瀬谷",
  "千草口",
  "明日葉台",
  "三日野町",
  "南河原市",
  "金嶺",
  "北穂野",
  "東さかい町",
  "茶ノ辻",
  "新宮前",
  "湊中央",
];
export const capacity = 64;
export const maximumOccupancy = 132;
export function nearestDoor(cellId: string): number {
  const cell = cellById.get(cellId)!;
  const center = cell.x + cell.width / 2;
  return doorStarts
    .map((x, index) => ({ index, distance: Math.abs(x + 650 - center) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)[0].index;
}

/** The passenger's legal walking route. Seats are leaves, never longitudinal shortcuts. */
export function exitPath(
  startId: string,
  people: import("./types.ts").Passenger[] = [],
  station = -1,
): string[] {
  if (!cellById.has(startId)) return [];
  const records = new Map<
    string,
    { distance: number; remaining: number; path: string[] }
  >();
  const visited = new Set<string>();
  records.set(startId, { distance: 0, remaining: 0, path: [startId] });
  const compare = (
    a: { distance: number; remaining: number; path: string[] },
    b: { distance: number; remaining: number; path: string[] },
  ) =>
    a.distance - b.distance ||
    a.remaining - b.remaining ||
    a.path.join("/").localeCompare(b.path.join("/"));
  while (visited.size < cells.length) {
    const available = [...records.entries()]
      .filter(([id]) => !visited.has(id))
      .sort((a, b) => compare(a[1], b[1]));
    if (!available.length) break;
    const [id, record] = available[0];
    visited.add(id);
    const current = cellById.get(id)!;
    if (current.row === 2 && current.kind === "door") return record.path;
    for (const neighborId of neighbors.get(id)!) {
      if (visited.has(neighborId)) continue;
      const neighbor = cellById.get(neighborId)!;
      if (neighbor.kind === "seat") continue;
      const distance =
        Math.abs(
          current.x + current.width / 2 - neighbor.x - neighbor.width / 2,
        ) + Math.abs(current.y - neighbor.y);
      const candidate = {
        distance: record.distance + distance,
        remaining:
          record.remaining +
          people.filter(
            (person) =>
              person.cellId === neighborId && person.destination > station + 1,
          ).length,
        path: [...record.path, neighborId],
      };
      const previous = records.get(neighborId);
      if (!previous || compare(candidate, previous) < 0)
        records.set(neighborId, candidate);
    }
  }
  return [];
}
