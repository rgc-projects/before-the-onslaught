import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false } });
try {
  const { buildings, cards, units, enemies, tuning } = await vite.ssrLoadModule('/src/data/content.ts');
  const { buildingStats } = await vite.ssrLoadModule('/src/systems/buildings.ts');
  const { STEP_MS } = await vite.ssrLoadModule('/src/systems/combat.ts');
  const resourceLabels = { gold: '金币', food: '食物', wood: '木材', mana: '魔力' };
  const types = { building: '建筑', unit: '部队', spell: '法术', tactic: '战术', fortify: '强化', event: '事件' };
  const rarity = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };
  const amount = cost => Object.entries(cost).map(([key, value]) => `${value} ${resourceLabels[key]}`).join('、') || '—';
  const escape = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const row = values => `| ${values.map(escape).join(' | ')} |`;
  const table = (columns, rows) => [row(columns), row(columns.map(() => '---')), ...rows.map(row)].join('\n');
  const levels = (base, upgraded) => base === upgraded ? base : `${base} → ${upgraded}`;
  const unitRows = list => [...list.values()].map(unit => [unit.id, unit.name, unit.hp, unit.damage, unit.armor,
    unit.reach, unit.interval * STEP_MS / 1000, unit.speed, unit.upkeep ?? '—', unit.attack ?? 'melee']);
  const unitColumns = ['ID', '名称', '生命', '攻击或治疗', '护甲', '射程（格）', '攻击间隔（秒）', '移速（格/秒）', '军粮/波', '行为'];
  const documents = [
    '# 兵锋未至 内容数据表',
    '由 `npm run docs:content` 从当前游戏数据和规则生成。数值为基础值，实战加成由王国、科技、遗物、位置及资源条件结算。',
    '## 军令',
    table(['ID', '名称', '类型', '稀有度', '费用', '效果'], [...cards.values()].map(card => [
      card.id, card.name, types[card.kind], rarity[card.rarity], amount(card.cost), card.description,
    ])),
    '## 建筑',
    table(['ID', '名称', '占地', '耐久', '伤害', '射程（格）', '产出', '仓储增量', '召集兵种与名额', '升级费用'], [...buildings.values()].map(def => {
      const base = buildingStats({ def: def.id, level: 1 });
      const upgraded = buildingStats({ def: def.id, level: 2 });
      return [def.id, def.name, `${def.width ?? 1} × 1`, levels(base.hp, upgraded.hp), levels(base.damage, upgraded.damage),
        levels(base.reach, upgraded.reach), levels(amount(base.income), amount(upgraded.income)),
        levels(amount(base.capacity), amount(upgraded.capacity)), def.recruits ? `${units.get(def.recruits).name} ${levels(base.recruits, upgraded.recruits)}` : '—',
        amount(def.upgrade.cost)];
    })),
    '## 友军',
    table(unitColumns, unitRows(units)),
    '## 敌军',
    table(unitColumns, unitRows(enemies)),
    '## 关键协同与特殊能力',
    table(['效果', '基础规则'], [
      ['临水农圃', `每波 +${tuning.buildings.riverFood} 食物`],
      ['市场与仓库', `每波 +${tuning.buildings.warehouseMarketGold} 金币`],
      ['神殿祝福', `出阵单位生命 +${tuning.buildings.shrineHealth}`],
      ['月环祭坛占卜', `${amount(tuning.divination)}，每局可换一批战利品`],
      ['战争王国骑兵冲锋', `目标周围 ${tuning.combat.cavalrySplashRadius} 格，范围基础伤害 ${tuning.combat.cavalryDamagePerPower} 点`],
      ['断桥元帅反击', `${tuning.combat.marshal.healthTrigger * 100}% 生命触发，半径 ${tuning.combat.marshal.radius} 格，基础伤害 ${tuning.combat.marshal.damage}`],
      ['渡桥誓卫鼓舞', `${tuning.combat.hero.healthTrigger * 100}% 生命触发，半径 ${tuning.combat.hero.radius} 格，恢复 ${tuning.combat.hero.healing} 生命`],
    ]),
  ];
  await writeFile(new URL('../docs/CONTENT_TABLES.md', import.meta.url), documents.join('\n\n') + '\n', 'utf8');
  console.log(`Exported ${cards.size} cards, ${buildings.size} buildings and ${units.size + enemies.size} units.`);
} finally {
  await vite.close();
}
