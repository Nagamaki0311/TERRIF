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

export type Rarity = "S" | "SS" | "SSS";
export type SpecialSkill = "aura" | "bridge" | "relay";
export type PerkOffer = {
  id: string;
  name: string;
  description: string;
  sector: number;
  kind: "special" | "buff";
  rarity?: Rarity;
  skill?: SpecialSkill;
};

const specialTemplates = [
  { skill: "aura" as const, name: "騒音の発信者", description: "配置時に周囲へ強いストレスを与える" },
  { skill: "bridge" as const, name: "対岸の扇動者", description: "南北通路をまたぐ自身の伝播を強化" },
  { skill: "relay" as const, name: "噂の運び手", description: "空き区画1つを越えて自身の伝播を届ける" },
];

export function perkChoices(seed: string, station: number): PerkOffer[] {
  const random = seededRandom(seed + ":perks:" + station);
  const roll = random();
  const rarity: Rarity = roll < 0.7 ? "S" : roll < 0.95 ? "SS" : "SSS";
  const template = specialTemplates[Math.floor(random() * specialTemplates.length)];
  const sectors = [0, 1, 2, 3];
  const special: PerkOffer = {
    ...template, kind: "special", rarity,
    id: "special-" + template.skill + "-" + rarity,
    sector: sectors.splice(Math.floor(random() * sectors.length), 1)[0],
  };
  const pool = [...perks];
  const buffs: PerkOffer[] = Array.from({ length: 2 }, () => ({
    ...pool.splice(Math.floor(random() * pool.length), 1)[0],
    kind: "buff",
    sector: sectors.splice(Math.floor(random() * sectors.length), 1)[0],
  }));
  return [special, ...buffs];
}

export function troubleSector(participants: string[], positions: ReadonlyMap<string, string | null>): number {
  const centers = participants.flatMap(id => {
    const cellId = positions.get(id);
    const cell = cellId ? cellById.get(cellId) : undefined;
    return cell ? [cell.x + cell.width / 2] : [];
  });
  return centers.length ? sectorAt(centers.reduce((sum, x) => sum + x, 0) / centers.length) : -1;
}
