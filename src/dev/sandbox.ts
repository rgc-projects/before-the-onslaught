import './sandbox.css';
import { createRun } from '../core/game';
import { kingdomIds } from '../core/types';
import type { GameEvent, Run, UnitDef } from '../core/types';
import { campaigns, cards, enemies, map } from '../data/content';
import { actorDefinition, maxActorHp } from '../systems/combat';
import { capacity } from '../systems/economy';

type Stat = keyof Pick<UnitDef, 'hp' | 'damage' | 'armor' | 'reach' | 'speed' | 'interval'>;
const stats: Record<Stat, { label: string; min: number; max: number; step: number }> = {
  hp: { label: '生命上限', min: 1, max: 9999, step: 1 },
  damage: { label: '攻击力或治疗量', min: 1, max: 9999, step: 1 },
  armor: { label: '护甲', min: 0, max: 99, step: 1 },
  reach: { label: '射程（格）', min: 0.1, max: 15, step: 0.05 },
  speed: { label: '移动速度（格/秒）', min: 0.1, max: 10, step: 0.05 },
  interval: { label: '攻击间隔（步）', min: 1, max: 250, step: 1 },
};

export function createSandboxRun(parameters: URLSearchParams): Run {
  const seed = Number(parameters.get('seed') ?? '119');
  const campaign = parameters.get('campaign') === 'crowford' ? 'crowford' : 'march';
  const kingdom = kingdomIds.find(id => id === parameters.get('kingdom')) ?? 'iron';
  return createRun(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff ? seed : 119, campaign, kingdom);
}

type Host = {
  state: () => Run;
  refresh: () => void;
  prepareWave: () => void;
  pause: () => void;
  advance: (ticks: number) => void;
  leave: () => void;
};

export function mountSandbox(parent: HTMLElement, host: Host) {
  const panel = document.createElement('section');
  panel.className = 'sandbox';
  panel.setAttribute('aria-labelledby', 'sandbox-title');
  const action = (name: string, label: string) => `<button type="button" class="quiet" data-do="${name}">${label}</button>`;
  const options = (entries: Iterable<{ id: string; name: string }>) => [...entries].map(entry => `<option value="${entry.id}">${entry.name}</option>`).join('');
  panel.innerHTML = `<header><div><h2 id="sandbox-title">开发调试沙盒</h2><p>关闭页面即结束本次会话。</p></div>${action('leave', '回到正式游戏')}</header>
    <div class="sandbox-controls">
      <fieldset><legend>备战操作</legend>
        <label><input name="refill" type="checkbox"> 无限补给</label>
        <div><label>目标波次 <select name="wave">${campaigns[host.state().campaign].waves.map((wave, index) =>
          `<option value="${index}">第 ${index + 1} 波 · ${wave.name}</option>`).join('')}</select></label>${action('jump', '跳转波次')}</div>
        <div><label>军令 <select name="card">${options(cards.values())}</select></label>${action('card', '加入军令')}</div>
      </fieldset>
      <fieldset><legend>战斗控制</legend>
        <div><label>敌军 <select name="enemy">${options(enemies.values())}</select></label>${action('spawn', '安排敌军')}</div>
        <div><label>推进步数 <input name="steps" type="number" min="1" max="1000" step="1" value="1"></label>
          ${action('clock', '暂停时钟')}${action('step', '推进模拟')}</div>
        <div><label>场上单位 <select name="actor"></select></label>
          <label>属性 <select name="stat">${Object.entries(stats).map(([id, data]) => `<option value="${id}">${data.label}</option>`).join('')}</select></label>
          <label>数值 <input name="value" type="number"></label>${action('stat', '应用属性')}</div>
      </fieldset>
    </div>
    <p class="sandbox-data"></p><p class="sandbox-status" role="status"></p>`;
  parent.prepend(panel);
  const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => panel.querySelector<T>(`[name="${name}"]`)!;
  const button = (name: string) => panel.querySelector<HTMLButtonElement>(`[data-do="${name}"]`)!;
  const refill = field<HTMLInputElement>('refill');
  const actorField = field<HTMLSelectElement>('actor');
  const statField = field<HTMLSelectElement>('stat');
  const valueField = field<HTMLInputElement>('value');
  const battleData = panel.querySelector<HTMLElement>('.sandbox-data')!;
  const notice = panel.querySelector<HTMLElement>('.sandbox-status')!;
  let roster = '';
  let hits = 0;
  let damage = 0;
  let healed = 0;
  const selectedActor = () => host.state().actors.find(actor => actor.id === Number(actorField.value));

  function showStat(): void {
    const prop = statField.value as Stat;
    const rule = stats[prop];
    const actor = selectedActor();
    valueField.min = String(rule.min);
    valueField.max = String(rule.max);
    valueField.step = String(rule.step);
    valueField.value = actor ? String(prop === 'hp' ? maxActorHp(actor) : actorDefinition(actor)[prop]) : '';
  }

  function resetData(): void {
    hits = damage = healed = 0;
  }

  function refresh(run: Run): void {
    if (refill.checked) run.wallet = capacity(run.buildings);
    if (run.phase === 'planning') resetData();
    const battle = run.phase === 'battle';
    const alive = battle ? run.actors : [];
    const key = alive.map(actor => actor.id).join(',');
    if (key !== roster) {
      roster = key;
      const previous = actorField.value;
      actorField.replaceChildren(...alive.map(actor => new Option(`${actor.id} · ${actorDefinition(actor).name}`, String(actor.id))));
      if (alive.some(actor => String(actor.id) === previous)) actorField.value = previous;
      showStat();
    }
    button('spawn').disabled = !battle;
    button('clock').disabled = !battle;
    button('clock').textContent = run.paused ? '恢复时钟' : '暂停时钟';
    button('step').disabled = !battle || !run.paused;
    button('stat').disabled = !battle || !alive.length;
    button('card').disabled = run.phase !== 'planning';
    actorField.disabled = !battle || !alive.length;
    battleData.textContent = `种子 ${run.seed} · 波次 ${run.wave + 1} · 步数 ${run.tick} · 友军 ${alive.filter(actor => actor.side === 'ally').length} · 敌军 ${alive.filter(actor => actor.side === 'enemy').length} · 弹道 ${run.shots.length} · 本波命中 ${hits} · 伤害 ${damage} · 治疗 ${healed}`;
  }

  refill.onchange = host.refresh;
  actorField.onchange = showStat;
  statField.onchange = showStat;
  button('leave').onclick = host.leave;
  button('clock').onclick = host.pause;
  button('jump').onclick = () => {
    const run = host.state();
    const wave = Number(field('wave').value);
    if (!campaigns[run.campaign].waves[wave]) return;
    Object.assign(run, { wave, phase: 'planning', paused: false, tick: 0, rewards: [], shopBought: [],
      actors: [], shots: [], deployments: [], waveReport: null, pastWaves: [], schedule: [], spawnIndex: 0, keepHp: Math.max(1, run.keepHp) });
    // Replaying a resolved event would otherwise grant its rewards again.
    notice.textContent = `已跳到第 ${wave + 1} 波备战，保留既有布局与军令。`;
    host.prepareWave();
  };
  button('card').onclick = () => {
    const run = host.state();
    const card = cards.get(field('card').value);
    if (!card || run.phase !== 'planning') return;
    run.hand.push(card.id);
    notice.textContent = `已加入${card.name}。`;
    host.refresh();
  };
  button('spawn').onclick = () => {
    const run = host.state();
    const enemy = enemies.get(field('enemy').value);
    if (!enemy || run.phase !== 'battle') return;
    run.schedule.splice(run.spawnIndex, 0, { tick: run.tick + 1, enemy: enemy.id });
    notice.textContent = `${enemy.name}将在下一模拟步从入口登场。`;
    host.refresh();
  };
  button('stat').onclick = () => {
    const actor = selectedActor();
    if (!actor || host.state().phase !== 'battle' || !valueField.checkValidity() || !Number.isFinite(valueField.valueAsNumber)) {
      valueField.reportValidity();
      return;
    }
    const prop = statField.value as Stat;
    const value = valueField.valueAsNumber;
    actor.stats = { ...actorDefinition(actor), [prop]: value };
    if (prop === 'hp') {
      actor.bonusHp = 0;
      actor.hp = value;
    }
    notice.textContent = `已调整 ${actor.id} 号单位的${stats[prop].label}。`;
    host.refresh();
  };
  button('step').onclick = () => {
    const input = field<HTMLInputElement>('steps');
    if (input.reportValidity() && Number.isInteger(input.valueAsNumber)) host.advance(input.valueAsNumber);
  };
  refresh(host.state());
  return {
    refresh,
    record(events: readonly GameEvent[]) {
      for (const event of events) {
        if (event.kind === 'hit') { hits++; damage += event.amount; }
        if (event.kind === 'heal') healed += event.amount;
      }
    },
  };
}
