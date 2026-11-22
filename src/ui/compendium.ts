import type { UnitDef } from '../core/types';
import { buildings, cards, enemies, kingdoms, units, upgrades } from '../data/content';
import { relics } from '../data/journey';
import { ROW, TILE, soldier, structure } from '../scenes/art';
import { renderAtlasPortrait } from '../scenes/sprites';
import { topics } from '../systems/research';
import { cardBody, costText } from './labels';
import { factList, unitDescription, unitFacts } from './unit-info';
import type { Fact } from './unit-info';

type Entry = {
  name: string;
  description: string;
  facts: Fact[];
  card?: string;
  portrait?: (context: CanvasRenderingContext2D) => void;
};

function unitEntry(unit: UnitDef, hostile: boolean): Entry {
  const facts = unitFacts(unit);
  if (!hostile) facts.push(['基础军粮', `${unit.upkeep ?? 0} 食物/波`]);
  return {
    name: unit.name, description: unitDescription(unit, hostile), facts,
    portrait: context => soldier(context, { x: 0.5, y: 0.45 }, hostile, unit.id),
  };
}

function catalogs(): [name: string, entries: Entry[]][] {
  return [
    ['军令', [...cards.values()].map(card => ({
      name: card.name, description: card.description, card: card.id,
      facts: [
        ...(costText(card.cost) ? [] : [['使用费用', '免费'] as Fact]),
        ...(upgrades.has(card.id) ? [['强化结果', cards.get(upgrades.get(card.id)!)!.name] as Fact] : []),
      ],
    }))],
    ['建筑', [...buildings.values()].map(def => {
      const facts: Fact[] = [
        ['耐久', `${def.hp} → ${def.hp + def.upgrade.hp}`], ['占地', `${def.width ?? 1} × 1`], ['升级费用', costText(def.upgrade.cost)],
      ];
      if (def.damage) facts.push(['基础伤害', `${def.damage} → ${def.damage + (def.upgrade.damage ?? 0)}`], ['射程', `${def.reach} 格`]);
      if (def.recruits) facts.push(['召集单位', units.get(def.recruits)!.name]);
      return { name: def.name, description: cards.get(def.id)!.description, facts,
        portrait: context => structure(context, def.id, { x: def.width === 2 ? 0 : 0.5, y: 0.45 }, def.art, def.width) };
    })],
    ['友军', [...units.values()].map(unit => unitEntry(unit, false))],
    ['敌军', [...enemies.values()].map(unit => unitEntry(unit, true))],
    ['王国', Object.values(kingdoms).map(kingdom => ({
      name: kingdom.name, description: kingdom.description, facts: [['专属军令', cards.get(kingdom.signature)!.name]],
    }))],
    ['遗物', [...relics.values()].map(relic => ({ name: relic.name, description: relic.description, facts: [] }))],
    ['科技', [...topics.values()].map(topic => ({ name: topic.name, description: topic.description, facts: [['研究费用', costText(topic.cost)]] }))],
  ];
}

export function openCompendium(): void {
  const opener = document.activeElement;
  const catalog = catalogs();
  const dialog = document.createElement('dialog');
  dialog.className = 'compendium';
  dialog.setAttribute('aria-labelledby', 'compendium-title');
  dialog.innerHTML = `<header class="compendium-header"><h2 id="compendium-title">图鉴</h2><button class="quiet" type="button">返回</button></header>
    <div class="compendium-filters">
      <label>类别 <select>${catalog.map(([name], index) => `<option value="${index}">${name}</option>`).join('')}</select></label>
      <label>搜索 <input type="search" placeholder="名称或能力"></label>
    </div>
    <div class="compendium-grid">
      <select size="9" aria-label="图鉴条目"></select>
      <section class="compendium-detail" aria-live="polite"></section>
    </div>`;
  const [category, list] = dialog.querySelectorAll('select');
  const search = dialog.querySelector('input')!;
  const detail = dialog.querySelector<HTMLElement>('section')!;
  const back = dialog.querySelector('button')!;
  let matches: Entry[] = [];

  function renderDetail(): void {
    const entry = matches[list.selectedIndex];
    if (!entry) {
      detail.textContent = '没有匹配的条目。';
      return;
    }
    detail.innerHTML = `${entry.card ? '' : `<h3>${entry.name}</h3>`}<p>${entry.description}</p>
      ${entry.facts.length ? factList(entry.facts) : ''}`;
    if (entry.card) {
      const card = document.createElement('div');
      card.className = 'card compendium-card';
      card.innerHTML = cardBody(cards.get(entry.card)!);
      detail.prepend(card);
    }
    if (entry.portrait) {
      const canvas = document.createElement('canvas');
      canvas.width = TILE * 2;
      canvas.height = ROW + 25;
      canvas.setAttribute('aria-hidden', 'true');
      renderAtlasPortrait(canvas, entry.portrait);
      detail.prepend(canvas);
    }
  }

  function filter(): void {
    const term = search.value.trim().toLocaleLowerCase();
    matches = catalog[Number(category.value)][1].filter(entry => `${entry.name} ${entry.description}`.toLocaleLowerCase().includes(term));
    list.replaceChildren(...matches.map(entry => new Option(entry.name)));
    list.selectedIndex = matches.length ? 0 : -1;
    list.disabled = !matches.length;
    renderDetail();
  }

  back.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opener instanceof HTMLElement) opener.focus();
  }, { once: true });
  category.addEventListener('change', filter);
  search.addEventListener('input', filter);
  search.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.isComposing) return;
    event.preventDefault();
    dialog.close();
  });
  list.addEventListener('input', renderDetail);
  filter();
  document.body.append(dialog);
  dialog.showModal();
  category.focus();
}
