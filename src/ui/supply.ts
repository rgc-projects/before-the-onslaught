import type { Point, Run } from '../core/types';
import { units } from '../data/content';
import { planMuster, upkeepFor } from '../systems/buildings';
import type { Muster } from '../systems/buildings';
import { capacity, production } from '../systems/economy';

export function forecastSupplies(run: Run, foodCap = capacity(run.buildings).food) {
  const income = production(run.buildings, run.kingdom, run.route, run.relics, run.research);
  const muster = planMuster(run, Math.min(foodCap, run.wallet.food + income.food));
  return { income, muster };
}

const supplyPosition = ({ x, y }: Point): string => `第 ${x + 1} 列第 ${y + 1} 行`;
const showChange = (before: number, after: number): string => before === after ? String(after) : `${before} → ${after}`;

function supplyEffects(run: Run, plan: Muster, source: number): string {
  const clearing = run.supplyPriority === source;
  const projected = planMuster({ ...run, supplyPriority: clearing ? null : source }, plan.available);
  const changes = [...plan.groups].flatMap(([id, group]) => {
    const fed = projected.groups.get(id)!.fed;
    if (group.fed === fed) return [];
    return [`<li>${units.get(group.unit)!.name} <span class="supply-position">${supplyPosition(group.origin)}</span> · ${showChange(group.fed, fed)} 支</li>`];
  });
  if (!changes.length) return '';
  return `<details class="supply-effects" data-supply-effect="${source}">
    <summary aria-describedby="supply-source-${source}">${clearing ? '取消后' : '优先后'}全军出阵 ${showChange(plan.fed, projected.fed)} 支</summary>
    <p>全军耗粮 ${showChange(plan.food, projected.food)} 食物</p>
    <ul>${changes.join('')}</ul>
  </details>`;
}

export function supplyDialog(run: Run, plan: Muster): string {
  const rows = [...plan.groups].map(([id, group]) => {
    const name = units.get(group.unit)!.name;
    const position = supplyPosition(group.origin);
    const cost = upkeepFor(run, group.unit);
    const active = run.supplyPriority === id;
    const blocked = group.limit - group.ready;
    const effects = cost && group.ready && plan.fed < plan.ready ? supplyEffects(run, plan, id) : '';
    return `<li class="refine-row supply-row">
      <div><div id="supply-source-${id}"><strong>${name}</strong> <span class="supply-position">${position}</span></div>
        <p id="supply-group-${id}">预计出阵 ${group.fed} / ${group.ready} 支 · 每支 ${cost} 食物${blocked ? ` · ${blocked} 个位置受阻` : ''}</p>
        ${effects}</div>
      <button type="button" class="quiet" data-supply-priority="${id}" aria-pressed="${active}"
        aria-label="优先供给 ${name} ${position}" aria-describedby="supply-group-${id}" ${!cost ? 'disabled' : ''}>
        ${active ? '优先供给中' : '优先供给'}
      </button></li>`;
  }).join('');
  return `<h2 id="dialog-title">军粮分配</h2>
    <p class="supply-summary" role="status">开战后可用 ${plan.available} 食物 · 全员需 ${plan.needed} 食物 · 预计出阵 ${plan.fed} / ${plan.ready} 支</p>
    <p>可指定一处集结点或征兵建筑优先领粮，其余部队按原顺序配给。</p>
    <ul class="refine-list supply-list">${rows}</ul>
    <button class="primary" id="close-supply" type="button">返回备战</button>`;
}
