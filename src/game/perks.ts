import { cellById } from "./board.ts";
import { seededRandom } from "./generation.ts";

export const perks = [
  { id: "quiet", name: "静かな火種", strength: 34, globalStrength: 10 },
  { id: "seats", name: "休めない座席", strength: 26, globalStrength: 8 },
  { id: "luggage", name: "荷物の重圧", strength: 24, globalStrength: 8 },
  { id: "bridge", name: "通路の共鳴", strength: 25, globalStrength: 8 },
  { id: "switch", name: "配置替え", strength: 12, globalStrength: 4 },
  { id: "noise", name: "ざわめき", strength: 20, globalStrength: 6 },
] as const;

export function sectorAt(x: number): number {
  return Math.min(3, Math.max(0, Math.floor((x - 960) / 4520)));
}

export type Rarity = "S" | "SS" | "SSS";
export type SpecialSkill = "aura" | "bridge" | "relay" | "gather" | "snack";
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
  { skill: "gather" as const, name: "話の輪を作る人", description: "乗車時、周りのひとり客を話の輪に誘う。Sは1人、SSは2人、SSSは3人" },
  { skill: "snack" as const, name: "おすそ分け客", description: "乗車時、周りの起きている人におやつを配る。Sは1人、SSは2人、SSSは3人" },
];

export function buffKey(buff: PerkOffer): string {
  return `${buff.effect}:${buff.scope}:${buff.sector}`;
}

export function perkChoices(seed: string, station: number, acquired: readonly PerkOffer[] = []): PerkOffer[] {
  if (station === 0) return [];
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
  const owned = new Set(acquired.map(buffKey));
  const makeBuff = (template: (typeof perks)[number], global: boolean, sector: number | null): PerkOffer => {
    const strength = global ? template.globalStrength : template.strength;
    const description = template.id === "quiet" ? `隣り合う人が1人以下ならストレス＋${strength}`
      : template.id === "seats" ? `着席ストレス＋${strength}。座席の回復${global ? "が半減" : "なし"}`
      : template.id === "luggage" ? `荷物持ちとその隣の人にストレス＋${strength}`
      : template.id === "bridge" ? `向かいの通路からの不満がストレス＋${strength}増し`
      : template.id === "switch" ? `立席ストレス＋${strength}。各駅の再配置＋${global ? 1 : 2}`
      : `通話・会話・音漏れをしている人にストレス＋${strength}`;
    return {
      id: template.id + (global ? "-global" : ""), name: template.name,
      description: `${global ? "車内全体" : `乗降口${sector! + 1}付近`}：${description}`,
      kind: "buff", scope: global ? "global" : "sector", effect: template.id,
      strength, sector: global ? null : sector,
    };
  };
  const regionalPool = perks.flatMap(template => sectors.map(sector => makeBuff(template, false, sector)))
    .filter(buff => !owned.has(buffKey(buff)));
  const regional = regionalPool[Math.floor(random() * regionalPool.length)];
  const globalPool = perks.map(template => makeBuff(template, true, null))
    .filter(buff => !owned.has(buffKey(buff)));
  // Six effects cover the five later stops even if every prior pick was a global buff.
  const distinctGlobals = globalPool.filter(buff => buff.effect !== regional?.effect);
  const candidates = distinctGlobals.length ? distinctGlobals : globalPool;
  const global = candidates[Math.floor(random() * candidates.length)];
  if (!regional || !global) throw new Error("強化候補が残っていません");
  return [special, regional, global];
}

export function troubleSector(participants: string[], positions: ReadonlyMap<string, string | null>): number {
  const centers = participants.flatMap(id => {
    const cellId = positions.get(id);
    const cell = cellId ? cellById.get(cellId) : undefined;
    return cell ? [cell.x + cell.width / 2] : [];
  });
  return centers.length ? sectorAt(centers.reduce((sum, x) => sum + x, 0) / centers.length) : -1;
}
