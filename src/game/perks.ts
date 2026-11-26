import { cellById } from "./board.ts";
import { seededRandom } from "./generation.ts";

export const perks = [
  { id: "quiet", name: "静かな火種", description: "指定エリアで隣接が1人以下の乗客にストレス＋34" },
  { id: "seats", name: "休めない座席", description: "指定エリアの着席者は回復せず、ストレス＋26" },
  { id: "luggage", name: "荷物の重圧", description: "指定エリアで荷物を持つ乗客とその隣の乗客にストレス＋24" },
  { id: "bridge", name: "通路の共鳴", description: "指定エリアで南北の通路をまたぐ伝播が＋25" },
  { id: "switch", name: "配置替え", description: "この停車駅の再配置＋2。指定エリアの立席ストレス＋12" },
] as const;

export function sectorAt(x: number): number {
  return Math.min(3, Math.max(0, Math.floor((x - 960) / 4520)));
}

export function perkChoices(seed: string, station: number) {
  const random = seededRandom(seed + ":perks:" + station);
  const pool = [...perks];
  const sectors = [0, 1, 2, 3];
  return Array.from({ length: 3 }, () => ({
    ...pool.splice(Math.floor(random() * pool.length), 1)[0],
    sector: sectors.splice(Math.floor(random() * sectors.length), 1)[0],
  }));
}

export type PerkOffer = ReturnType<typeof perkChoices>[number];


export function troubleSector(participants: string[], positions: ReadonlyMap<string, string | null>): number {
  const centers = participants.flatMap(id => {
    const cellId = positions.get(id);
    const cell = cellId ? cellById.get(cellId) : undefined;
    return cell ? [cell.x + cell.width / 2] : [];
  });
  return centers.length ? sectorAt(centers.reduce((sum, x) => sum + x, 0) / centers.length) : -1;
}
