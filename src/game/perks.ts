import { cellById } from "./board.ts";
import { seededRandom } from "./generation.ts";

export const perks = [
  { id: "quiet", name: "静かな火種", strength: 34, globalStrength: 10 },
  { id: "seats", name: "休めない座席", strength: 26, globalStrength: 8 },
  { id: "luggage", name: "荷物の重圧", strength: 24, globalStrength: 8 },
  { id: "bridge", name: "通路の共鳴", strength: 25, globalStrength: 8 },
  { id: "switch", name: "配置替え", strength: 12, globalStrength: 4 },
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
  sector: number | null;
  kind: "special" | "buff";
  scope?: "sector" | "global";
  effect?: (typeof perks)[number]["id"];
  strength?: number;
  rarity?: Rarity;
  skill?: SpecialSkill;
};

const specialTemplates = [
  { skill: "aura" as const, name: "騒音の発信者", description: "配置時に周囲へ強いストレスを与える" },
  { skill: "bridge" as const, name: "対岸の扇動者", description: "向かいの通路まで不満を大きく飛び火させる" },
  { skill: "relay" as const, name: "噂の運び手", description: "ひと席離れていても、ぼやきが届く" },
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
  const buffs: PerkOffer[] = Array.from({ length: 2 }, (_, index) => {
    const template = pool.splice(Math.floor(random() * pool.length), 1)[0];
    const global = index === 1;
    const sector = sectors.splice(Math.floor(random() * sectors.length), 1)[0];
    const strength = global ? template.globalStrength : template.strength;
    const description = template.id === "quiet" ? `隣り合う人が1人以下ならストレス＋${strength}`
      : template.id === "seats" ? `着席ストレス＋${strength}。座席の回復${global ? "が半減" : "なし"}`
      : template.id === "luggage" ? `荷物持ちとその隣の人にストレス＋${strength}`
      : template.id === "bridge" ? `向かいの通路からの不満がストレス＋${strength}増し`
      : `立席ストレス＋${strength}。この駅の再配置＋${global ? 1 : 2}`;
    return {
      id: template.id + (global ? "-global" : ""), name: template.name,
      description: `${global ? "車内全体" : `乗降口${sector + 1}付近`}：${description}`,
      kind: "buff", scope: global ? "global" : "sector", effect: template.id,
      strength, sector: global ? null : sector,
    };
  });
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
