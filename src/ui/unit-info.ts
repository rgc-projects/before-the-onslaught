import type { UnitDef } from '../core/types';
import { tuning } from '../data/content';
import { STEP_MS } from '../systems/combat';

export type Fact = [label: string, value: string | number];

const { cavalrySplashRadius, chargeBonusDamage, marshal, siegeSplashRadius, spellSplashRadius } = tuning.combat;
const abilities: Record<NonNullable<UnitDef['attack']>, string> = {
  ranged: '发射远程投射物。',
  splash: `远程法术命中后，会伤及目标 ${spellSplashRadius} 格内的其他敌对单位。`,
  heal: '治疗射程内生命比例最低的伤员。',
  summon: '首次接敌时可从邻近的空草地召出矛兵。',
  charge: `移动后的下一次攻击附加 ${chargeBonusDamage} 点冲锋伤害。`,
  pierce: '攻击无视护甲。',
  siege: `重击会波及目标 ${siegeSplashRadius} 格内的其他敌对单位。`,
  boss: `生命首次降至 ${marshal.healthTrigger * 100}% 或以下时发动半血反击，对 ${marshal.radius} 格内的守军造成 ${marshal.damage} 点基础伤害。下一次攻击附加 ${chargeBonusDamage} 点伤害。`,
  hero: '首次降至半血时治疗附近友军。英雄厅升级提高其最大生命。',
};

export function unitDescription(unit: UnitDef, hostile: boolean): string {
  if (unit.id === 'captain') return `${abilities.pierce} 优先攻击触及范围内的远程、法术、召唤和治疗单位。`;
  if (unit.id === 'spear') return `可攻击相邻斜格的敌军。${abilities.pierce}`;
  if (!hostile && unit.attack === 'charge') return `${abilities.charge} 战争王国骑兵的冲锋还会波及目标 ${cavalrySplashRadius} 格内的其他敌军。`;
  return unit.attack ? abilities[unit.attack] : '拦截近身的敌对单位。';
}

export function unitFacts(unit: UnitDef): Fact[] {
  return [
    ['生命', unit.hp], [unit.attack === 'heal' ? '基础治疗' : '基础伤害', unit.damage], ['护甲', unit.armor],
    ['作用距离', `${unit.reach} 格`], ['行动间隔', `${unit.interval * STEP_MS / 1000} 秒`], ['移动速度', `${unit.speed} 格/秒`],
  ];
}

export function factList(facts: Fact[]): string {
  return `<dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
}
