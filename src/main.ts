import './ui/style.css';
import menuCrest from '../assets/generated/menu-crest.webp?inline';
import { charters, chronicleMilestones, hasCharter, hasKingdom, tideMerit } from './core/chronicle';
import { createRun, dispatch, step } from './core/game';
import { formations, kingdomIds, resources } from './core/types';
import type { Actor, CampaignId, Command, Formation, GameEvent, KingdomId, Point, ResearchId, Run, UnitDef } from './core/types';
import { buildings, campaigns, cards, divinationCost, enemies, kingdoms, map, rampartGuard, units, upgrades } from './data/content';
import { relics, relicTradeChoice, routeFor, routes } from './data/journey';
import { maxFrameGroups } from './platform/checkpoint-frames';
import type { FrameHistory } from './platform/checkpoint-frames';
import { downloadFile } from './platform/download';
import { watchForeground } from './platform/foreground';
import { inspectCheckpoint, removeCheckpoint, sameCheckpointRevision, storeCheckpoint, type CheckpointRevision } from './platform/local-checkpoint';
import { awardChronicle, identifyExpedition, readChronicle } from './platform/local-chronicle';
import { decodeProgress, encodeProgress, inspectProgress, maxProgressFile, restoreProgress } from './platform/progress-file';
import type { ProgressFile } from './platform/progress-file';
import { cellStyle, mountBattlefield } from './scenes/battlefield';
import type { Motion } from './scenes/feedback';
import { BattleFrameSamples, defaultFrameRate, frameRates, isFrameRate } from './scenes/frame-rate';
import type { FrameRate, FrameSummary } from './scenes/frame-rate';
import { checkCard } from './systems/cards';
import { arcaneBonus, buildingStats, frontlineRepair, guardsRampart, openingWallHp, reinforcedWatch, upgradeCost, upkeepFor, watchReach } from './systems/buildings';
import type { Muster } from './systems/buildings';
import { actorDefinition, formationBoundary, maxActorHp, position, STEP_MS } from './systems/combat';
import { liveTactics, refineCost, tacticPiles } from './systems/deck';
import { checkRelocation, checkRelocationStart, checkRemoval, previewDeploymentUndo, relocationCost } from './systems/deployments';
import { buildingProduction, canAfford, capacity } from './systems/economy';
import { pendingEncounter } from './systems/encounters';
import { topics } from './systems/research';
import { permitPrice, shopStock } from './systems/shop';
import { divinationSource, scheduleWave } from './systems/waves';
import { buildingAt, districtAt, inBounds, isLeySite, same, sealedDistrict, terrain, tileKey } from './systems/grid';
import { playBattleSounds, playSound, setSoundLevel } from './ui/audio';
import { openCompendium } from './ui/compendium';
import { describeObstacle, predictApproach } from './ui/approach';
import type { Approach } from './ui/approach';
import { crossingCoverage } from './ui/crossing-coverage';
import { describeDeployment, describeRelocation } from './ui/deployment-preview';
import type { DeploymentPreview, PlacementBaseline } from './ui/deployment-preview';
import { formationAdvice, planningObjective } from './ui/objective';
import { forecastSupplies, supplyDialog } from './ui/supply';
import { factList, unitDescription, unitFacts } from './ui/unit-info';
import { runReportText, waveReportText, waveReview } from './ui/wave-report';
import { cardBody, costText, formationNames, kingdomCrests, phaseLabel, resourceLabel, resourceMark } from './ui/labels';

const temporaryNotice = '临时试玩中。刷新、关闭页面或返回主菜单会结束本局。';
const checkpointNoticeMarkup = (surface: 'board' | 'reward') => `<div class="checkpoint-save" data-checkpoint-save hidden>
  <p id="checkpoint-status-${surface}" role="status" tabindex="-1"></p>
  <button type="button" class="quiet" aria-describedby="checkpoint-status-${surface}">重试保存进度</button>
</div>`;

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div class="shell">
    <header class="top">
      <div class="brand"><span id="brand-crest" class="crest" aria-hidden="true">♜</span><div><h1>兵锋未至</h1><span id="campaign-name"></span></div></div>
      <div id="resources" class="resources" aria-label="王国资源">
        ${resources.map(key => `<div class="resource ${key}"><i aria-hidden="true">${resourceMark[key]}</i><div><small>${resourceLabel[key]}</small><b id="res-${key}"></b></div></div>`).join('')}
        <div class="resource health"><i aria-hidden="true">♥</i><div><small>城堡</small><b id="res-hp"></b></div></div>
      </div>
      <button class="quiet" id="settings" aria-label="设置"><span aria-hidden="true">⚙</span> 设置</button>
    </header>
    <main>
      <section class="theater" aria-label="鸦渡战场">
        <aside class="briefing" aria-label="作战简报">
          <div class="chapter"><span id="campaign-chapter"></span><b id="wave-count"></b></div>
          <h2 id="wave-name"></h2>
          <div id="wave-pips" class="pips" aria-hidden="true"></div>
          <span id="phase" class="status"></span>
          <p id="objective" class="objective"></p>
          <p id="approach-obstacle" class="objective" hidden></p>
          <ul id="crossing-coverage" class="crossing-coverage" aria-label="渡口火力覆盖" hidden>
            <li id="crossing-0"></li><li id="crossing-1"></li>
          </ul>
          <p id="battle-alert" class="battle-alert" role="status" hidden></p>
          <div class="intel"><span id="enemies-left"></span><span id="defeated"></span></div>
          <p id="enemy-roster-key" class="forecast" hidden>在场 / 待入场 · 选择在场敌军可定位</p>
          <ul id="enemy-roster" class="enemy-roster" aria-label="本波敌军"></ul>
        </aside>
        <div class="map-panel">
          <div class="panel-title"><h2 id="route-name">鸦渡战场</h2><span class="seed" id="seed"></span></div>
          <div class="board" style="${cellStyle()}">
            <div id="field"></div>
            <div id="tiles" class="tiles" role="group" aria-label="战场格子"></div>
            <span id="formation-line" class="formation-line" aria-hidden="true" hidden></span>
            <span class="map-tag enemy-tag">灰旗来路</span><span class="map-tag keep-tag">边境城堡</span>
          </div>
          <div class="legend"><span><i class="line"></i>预计行军路线</span><span><i class="route-draft"></i>落点路线预览</span><span><i class="route-obstacle"></i>预计破障点</span><span><i class="bridge"></i>可通行桥梁</span><span><i class="field-key"></i>河东部署区</span><span id="locked-key" hidden><i class="locked-key"></i>未开放外营</span><span id="ley-key" hidden><i class="ley-key"></i>祭坛灵脉</span></div>
          <p id="placement-preview" class="forecast" hidden></p>
        </div>
        <aside class="orders" aria-label="部署与详情">
          <div id="relic-strip" class="relic-strip" aria-label="已收录遗物" hidden></div>
          <p class="forecast" id="forecast"></p>
          <ul id="blocked-muster" class="blocked-muster" aria-label="出阵受阻的营地" hidden></ul>
          <button class="quiet" id="supply" type="button" aria-haspopup="dialog" hidden>军粮分配</button>
          <div id="formation-control" class="formation-control" hidden>
            <label for="formation">守军阵势</label>
            <select id="formation" aria-describedby="formation-note">
              ${formations.map(stance => `<option value="${stance}">${formationNames[stance]}</option>`).join('')}
            </select>
            <p id="formation-note" class="forecast"></p>
          </div>
          <div class="inspect">
            <h3 id="inspect-title">布防指引</h3>
            <p id="inspect-text">选择一张军令，再点击河东草地。箭塔能覆盖附近的桥头。</p>
            <button type="button" class="quiet" id="upgrade" hidden></button>
            <button type="button" class="quiet" id="research" hidden>选择科技</button>
            <div class="layout-actions" id="layout-actions" hidden>
              <button type="button" class="quiet" id="relocate"></button>
              <button type="button" class="quiet" id="remove-placement"></button>
            </div>
          </div>
          <p id="notice" class="notice" role="status"></p>
          ${checkpointNoticeMarkup('board')}
          <p id="battlefield-error" class="notice" role="status" hidden>战场加载失败。请检查连接后重新加载页面。</p>
          <button id="encounter" class="quiet" type="button" hidden></button>
          <button id="shop" class="quiet" type="button" hidden>军令商店</button>
          <button id="undo-deployment" class="quiet" type="button" hidden>撤销部署</button>
          <button id="action" class="primary"></button>
        </aside>
      </section>
      <section class="hand-panel" aria-label="手中军令">
        <div class="hand-heading"><h2>手中军令 <span id="hand-count"></span></h2>
          <span id="deck-count" title="开战时弃置战术牌，备战时抽两张。牌库空时洗回弃牌。"></span>
          <div class="hand-actions"><button class="quiet" id="build-shortcut" type="button" hidden>选建造军令</button>
          <button class="quiet" id="refine" type="button" hidden>整理战术牌</button></div></div>
        <div id="hand" class="hand"></div>
      </section>
    </main>
  </div>
  <dialog id="overlay" aria-labelledby="dialog-title"></dialog>`;

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const overlay = byId<HTMLDialogElement>('overlay');
const boardCheckpointNotice = app.querySelector<HTMLElement>('.orders [data-checkpoint-save]')!;
const hand = byId('hand');
const buildShortcut = byId<HTMLButtonElement>('build-shortcut');
const tileLayer = byId('tiles');
const actionButton = byId<HTMLButtonElement>('action');
const undoButton = byId<HTMLButtonElement>('undo-deployment');
const moveButton = byId<HTMLButtonElement>('relocate');
const removeButton = byId<HTMLButtonElement>('remove-placement');
const tileButtons: HTMLButtonElement[] = [];
const sandboxParameters = import.meta.env.DEV ? new URLSearchParams(window.location.search) : undefined;
const isSandbox = sandboxParameters?.get('sandbox') === '1';
let sandboxPanel: ReturnType<typeof import('./dev/sandbox')['mountSandbox']> | undefined;
let run = createRun(119);
let selected: number | undefined;
let relocating: number | undefined;
let inspected: Point | undefined;
let battleSelection: { kind: 'actor' | 'building'; id: number } | { kind: 'keep' } | undefined;
let battleMarker: HTMLButtonElement | undefined;
let activeEnemyRow: HTMLButtonElement | undefined;
let pauseEnemyRow: HTMLButtonElement | undefined;
const liveEnemyRows = new Map<string, { button: HTMLButtonElement; amount: HTMLElement }>();
let pointerTile: Point | undefined;
let focusedTile: Point | undefined;
let preferPointerTile = false;
let settings = loadSettings();
let playing = false;
let battlefieldStatus: 'loading' | 'ready' | 'failed' = 'loading';
let presentBattleFeedback: Awaited<ReturnType<typeof mountBattlefield>> | undefined;
let dialogKind: 'menu' | 'settings' | 'pause' | 'reward' | 'result' | 'shop' | 'encounter' | 'relic' | 'refine' | 'chronicle' | 'research' | 'remove-placement' | 'supply' | 'progress' | 'enemy-briefing' | undefined;
let pauseForSettings = false;
let settingsOverPause = false;
let lastHand = '';
let lastMap = '';
let lastRelics = '';
let lastBriefing = '';
let meritAward: ReturnType<typeof awardChronicle> | undefined;
let checkpointRevision: CheckpointRevision | undefined;
let checkpointStatus: 'unsaved' | 'saved' | 'temporary' | undefined;
let deploymentTiles: HTMLButtonElement[] = [];
let previewTiles: HTMLButtonElement[] = [];
const approaches: { current?: Approach; draft?: Approach } = {};
let placementBaseline: PlacementBaseline | undefined;
const placementPreviews = new Map<number, DeploymentPreview>();
const frameSamples = new BattleFrameSamples();
let frameHistory: FrameHistory = [];
let viewport = { width: window.innerWidth, height: window.innerHeight };
const motionLabels: Record<Motion, string> = { full: '标准', reduced: '简化', off: '关闭' };

type Settings = { muted: boolean; volume: number; motion: Motion; frameRate: FrameRate; recordFrameRate?: true };

function loadSettings(): Settings {
  const fallback: Settings = {
    muted: false, volume: 70, motion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full', frameRate: defaultFrameRate,
  };
  try {
    const value = JSON.parse(localStorage.getItem('nine-kingdoms-settings') ?? 'null');
    return {
      muted: typeof value?.muted === 'boolean' ? value.muted : fallback.muted,
      volume: Number.isInteger(value?.volume) && value.volume >= 0 && value.volume <= 100 ? value.volume : fallback.volume,
      motion: value?.motion === 'full' || value?.motion === 'reduced' || value?.motion === 'off' ? value.motion
        : typeof value?.reduced === 'boolean' ? (value.reduced ? 'reduced' : 'full') : fallback.motion,
      frameRate: isFrameRate(value?.frameRate) ? value.frameRate : fallback.frameRate,
      recordFrameRate: value?.recordFrameRate === true ? true : undefined,
    };
  } catch { return fallback; }
}

function saveSettings(): void {
  if (!isSandbox) {
    try { localStorage.setItem('nine-kingdoms-settings', JSON.stringify(settings)); } catch { /* session settings remain active */ }
  }
  document.documentElement.dataset.motion = settings.motion;
  setSoundLevel(settings.volume, settings.muted);
}

for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
  const button = document.createElement('button');
  button.type = 'button';
  button.tabIndex = x === map.riverX + 1 && y === map.bridges[0] ? 0 : -1;
  const tile = { x, y };
  button.addEventListener('click', () => clickTile(tile));
  button.addEventListener('pointerenter', () => {
    pointerTile = tile;
    preferPointerTile = true;
    updateTilePreview();
  });
  button.addEventListener('pointerleave', () => {
    pointerTile = undefined;
    updateTilePreview();
  });
  button.addEventListener('focus', () => {
    focusedTile = tile;
    preferPointerTile = false;
    const previous = tileButtons.find(item => item.tabIndex === 0);
    if (previous) previous.tabIndex = -1;
    button.tabIndex = 0;
    updateTilePreview();
  });
  button.addEventListener('blur', () => { focusedTile = undefined; updateTilePreview(); });
  button.addEventListener('keydown', event => {
    const movement: Record<string, Point> = {
      ArrowUp: { x, y: y - 1 }, ArrowDown: { x, y: y + 1 },
      ArrowLeft: { x: x - 1, y }, ArrowRight: { x: x + 1, y },
    };
    const next = movement[event.key];
    if (!next) return;
    event.preventDefault();
    if (!inBounds(next)) return;
    button.tabIndex = -1;
    const target = tileButtons[tileKey(next)];
    target.tabIndex = 0;
    target.focus();
  });
  tileButtons.push(button);
  tileLayer.append(button);
}

function message(text = ''): void {
  byId('notice').textContent = text;
}

function command(value: Command): boolean {
  const pendingDeployment = value.kind === 'undo-deployment' ? run.deployments.at(-1) : undefined;
  const previousDeployments = run.deployments.length;
  const events: GameEvent[] = [];
  const result = dispatch(run, value, events);
  if (!result.ok) {
    message(result.reason);
    return false;
  }
  message(pendingDeployment ? `已撤销${cards.get(pendingDeployment.card)!.name}，军令和部署费用已返还。`
    : value.kind === 'relocate' ? '部署已迁移。'
    : value.kind === 'remove-deployment' ? '已腾出部署位置。'
    : value.kind === 'reward' ? `已领取「${cards.get(value.card)!.name}」。现在可为第 ${run.wave + 1} 波备战。`
    : value.kind !== 'start' && run.deployments.length < previousDeployments ? '相关部署已用于升级或科技，已确认。' : '');
  if (['play', 'upgrade', 'undo-deployment', 'start', 'relocate', 'remove-deployment'].includes(value.kind)) {
    selected = undefined;
    relocating = undefined;
    if (value.kind === 'undo-deployment' || value.kind === 'start') inspected = undefined;
    if (value.kind === 'relocate') {
      inspected = value.tile;
      lastMap = '';
    }
    clearTileHints();
  }
  if (value.kind === 'start') {
    battleSelection = undefined;
    frameSamples.clear();
    byId('battle-alert').hidden = true;
    playSound('start');
  } else if (events.some(event => event.kind === 'upgraded')) playSound('upgrade');
  else if (events.some(event => event.kind === 'placed')) playSound('place');
  else if (events.some(event => event.kind === 'heal')) playSound('heal');
  else playSound('click');
  if (value.kind === 'pause') frameSamples.pause();
  presentBattleFeedback?.(events);
  const saves = ['play', 'upgrade', 'buy', 'reward', 'encounter', 'refine', 'research', 'divine', 'undo-deployment', 'relocate', 'remove-deployment', 'supply-priority', 'formation'].includes(value.kind);
  if (saves && !saveRun()) return false;
  update();
  return true;
}

function clearTileHints(): void {
  for (const tile of previewTiles) {
    delete tile.dataset.valid;
    tile.removeAttribute('title');
    tile.removeAttribute('aria-describedby');
  }
  previewTiles = [];
  approaches.draft = undefined;
}

function previewTile(): Point | undefined {
  return preferPointerTile ? pointerTile ?? focusedTile : focusedTile ?? pointerTile;
}

function updateTilePreview(): void {
  clearTileHints();
  const label = byId('placement-preview');
  label.hidden = true;
  const target = previewTile();
  if (!target || run.phase !== 'planning') return;
  const key = tileKey(target);
  let preview = placementPreviews.get(key);
  if (!preview) {
    preview = relocating !== undefined ? describeRelocation(run, relocating, target, placementBaseline)
      : selected !== undefined ? describeDeployment(run, selected, target, placementBaseline) : undefined;
    if (!preview) return;
    placementPreviews.set(key, preview);
  }
  approaches.draft = preview.approach;
  label.hidden = false;
  const keyboard = focusedTile && same(target, focusedTile) && tileButtons[key].matches(':focus-visible');
  const cancel = relocating === undefined ? '返回军令' : '取消迁移';
  label.textContent = keyboard ? `${preview.text} · 方向键选格 · Enter 确认 · Esc ${cancel}` : preview.text;
  label.dataset.valid = preview.valid ? 'yes' : 'no';
  previewTiles = preview.tiles.filter(inBounds).map(tile => tileButtons[tileKey(tile)]);
  for (const button of previewTiles) {
    button.dataset.valid = label.dataset.valid;
    button.title = preview.valid ? (relocating !== undefined ? '点击迁移' : '点击部署') : preview.text;
    button.setAttribute('aria-describedby', 'placement-preview');
  }
}

function focusHandCard(slot: number): void {
  const index = Math.min(slot, run.hand.length - 1);
  (hand.querySelector<HTMLButtonElement>(`[data-slot="${index}"]`) ?? actionButton).focus();
}

function cancelCardSelection(returnToHand: boolean): void {
  const slot = selected;
  selected = undefined;
  message();
  playSound('select');
  update();
  if (returnToHand && slot !== undefined) focusHandCard(slot);
}

function select(slot: number, keyboard = false): void {
  if (run.phase !== 'planning') return;
  const card = cards.get(run.hand[slot]);
  if (!card) return;
  if (card.kind === 'spell' || card.kind === 'tactic' || card.kind === 'event') {
    const fromHand = keyboard && hand.contains(document.activeElement);
    if (command({ kind: 'play', slot }) && fromHand) focusHandCard(slot);
    return;
  }
  if (selected === slot) {
    cancelCardSelection(keyboard && tileLayer.contains(document.activeElement));
    return;
  }
  if (!canAfford(run.wallet, card.cost)) {
    message('资源不足。');
    return;
  }
  selected = slot;
  relocating = undefined;
  inspected = undefined;
  clearTileHints();
  message(keyboard ? '' : card.kind === 'fortify' ? '选择一座一级建筑，按 Esc 取消。' : '点击河东草地部署，按 Esc 取消。');
  playSound('select');
  if (keyboard) preferPointerTile = false;
  update();
  if (keyboard) tileLayer.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
}

function constructionSlots(): number[] {
  return run.hand.flatMap((id, slot) => cards.get(id)!.kind === 'building' ? [slot] : []);
}

function affordableConstruction(slots: number[]): number[] {
  return slots.filter(slot => canAfford(run.wallet, cards.get(run.hand[slot])!.cost));
}

buildShortcut.onclick = event => {
  const slots = affordableConstruction(constructionSlots());
  const next = slots.find(slot => selected !== undefined && slot > selected) ?? slots[0];
  if (next !== undefined) select(next, event.detail === 0);
};

function actorCell(actor: Actor): Point {
  const at = position(actor);
  return { x: Math.round(at.x), y: Math.round(at.y) };
}

function liveEnemiesOf(id: string): Actor[] {
  return run.actors.filter(actor => actor.side === 'enemy' && actor.def === id && actor.hp > 0);
}

function inspectEnemy(id: string): void {
  if (run.phase !== 'battle') return;
  const group = liveEnemiesOf(id);
  if (!group.length) return;
  const current = battleSelection?.kind === 'actor' ? battleSelection.id : undefined;
  const next = (group.findIndex(actor => actor.id === current) + 1) % group.length;
  battleSelection = { kind: 'actor', id: group[next].id };
  updateInspect();
}

function clickTile(tile: Point): void {
  if (run.phase === 'battle') {
    const actor = run.actors.find(item => item.hp > 0 && same(actorCell(item), tile));
    const building = buildingAt(run.buildings, tile);
    battleSelection = actor ? { kind: 'actor', id: actor.id } : building ? { kind: 'building', id: building.id }
      : same(tile, map.keep) ? { kind: 'keep' } : undefined;
    updateInspect();
    return;
  }
  if (relocating !== undefined && run.phase === 'planning') {
    command({ kind: 'relocate', id: relocating, tile });
    return;
  }
  inspected = tile;
  if (selected !== undefined && run.phase === 'planning') command({ kind: 'play', slot: selected, tile });
  updateInspect(run.phase === 'planning' ? forecastSupplies(run).muster : undefined);
}

function updateBlockedMuster(muster?: Muster): void {
  const list = byId('blocked-muster');
  list.hidden = !muster?.blocked;
  if (list.hidden || !muster) return;
  const rows = run.buildings.flatMap(building => {
    const group = muster.groups.get(building.id);
    if (!group || group.limit === group.ready) return [];
    const { origin, limit, ready } = group;
    const name = buildings.get(building.def)!.name;
    const row = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quiet';
    button.textContent = `${name} · ${limit - ready} 位受阻`;
    button.setAttribute('aria-label', `查看${name}，第 ${origin.x + 1} 列第 ${origin.y + 1} 行，${limit - ready} 位受阻`);
    button.onclick = () => {
      selected = undefined;
      relocating = undefined;
      inspected = origin;
      message();
      update();
      tileButtons[tileKey(origin)].focus();
    };
    row.append(button);
    return [row];
  });
  list.replaceChildren(...rows);
}

function openSupply(focused?: number): void {
  if (run.phase !== 'planning') return;
  const { muster } = forecastSupplies(run);
  if (!muster.groups.size) return;
  show('supply', supplyDialog(run, muster));
  byId('close-supply').onclick = closeSupply;
  for (const effects of overlay.querySelectorAll<HTMLDetailsElement>('.supply-effects')) {
    effects.ontoggle = () => {
      if (effects.open) effects.scrollIntoView({ block: 'nearest' });
    };
  }
  for (const button of overlay.querySelectorAll<HTMLButtonElement>('[data-supply-priority]')) {
    const id = Number(button.dataset.supplyPriority);
    button.onclick = () => {
      if (command({ kind: 'supply-priority', id: run.supplyPriority === id ? null : id })) openSupply(id);
    };
    if (id === focused) button.focus();
  }
}

function closeSupply(): void {
  close();
  byId('supply').focus();
}

function cancelRelocation(): void {
  relocating = undefined;
  message();
  update();
  moveButton.focus();
}

function startRelocation(id: number): void {
  if (relocating === id) return cancelRelocation();
  const result = checkRelocationStart(run, id);
  if (!result.ok) return message(result.reason);
  selected = undefined;
  relocating = id;
  message();
  update();
  tileButtons[tileKey(result.target.item.tile)].focus();
}

function openRemoval(id: number): void {
  const result = checkRemoval(run, id);
  if (!result.ok) return message(result.reason);
  const { kind, item } = result.target;
  const name = (kind === 'building' ? buildings.get(item.def) : units.get(item.def))!.name;
  const action = kind === 'building' ? '拆除' : '解散';
  const undo = previewDeploymentUndo(run);
  const refundable = undo.ok && undo.record.id === id;
  const fee = refundable ? costText(undo.card.cost) : '';
  show('remove-placement', `<h2 id="dialog-title">${action}${name}？</h2>
    <p>确认${action}会腾出地块，已使用的军令和资源计为消耗。</p>
    ${refundable ? `<p>撤回后返还军令${fee ? `和 ${fee}` : ''}。</p>` : ''}
    <button type="button" class="primary" id="cancel-removal">保留部署</button>
    ${refundable ? '<button type="button" class="quiet" id="refund-removal">撤回并返还</button>' : ''}
    <button type="button" class="quiet" id="confirm-removal">确认${action}</button>`);
  const finish = (change: Extract<Command, { kind: 'undo-deployment' | 'remove-deployment' }>) => {
    close();
    if (command(change)) tileButtons[tileKey(item.tile)].focus();
  };
  byId('cancel-removal').onclick = closeRemoval;
  if (refundable) byId('refund-removal').onclick = () => finish({ kind: 'undo-deployment' });
  byId('confirm-removal').onclick = () => finish({ kind: 'remove-deployment', id });
}

function closeRemoval(): void {
  close();
  removeButton.focus();
}

function updateInspect(muster?: Muster): void {
  const planning = run.phase === 'planning';
  const battle = run.phase === 'battle';
  if (!battle) battleSelection = undefined;
  const card = selected === undefined ? undefined : cards.get(run.hand[selected]);
  const targetId = battleSelection && 'id' in battleSelection ? battleSelection.id : undefined;
  const building = battle ? (battleSelection?.kind === 'building' ? run.buildings.find(item => item.id === targetId && item.hp > 0) : undefined)
    : inspected && buildingAt(run.buildings, inspected);
  const rally = !battle && inspected && run.rally.find(item => same(item.tile, inspected!));
  const actor = battleSelection?.kind === 'actor' ? run.actors.find(item => item.id === targetId && item.hp > 0) : undefined;
  const keep = battle ? battleSelection?.kind === 'keep' : inspected && same(inspected, map.keep);
  const marked = battle ? actor ? actorCell(actor) : building?.tile ?? (keep ? map.keep : undefined) : undefined;
  const marker = marked && tileButtons[tileKey(marked)];
  if (marker !== battleMarker) {
    if (battleMarker) delete battleMarker.dataset.battleInspect;
    if (marker) marker.dataset.battleInspect = 'true';
    battleMarker = marker;
  }
  const enemyRow = actor?.side === 'enemy' ? liveEnemyRows.get(actor.def)?.button : undefined;
  if (enemyRow !== activeEnemyRow) {
    activeEnemyRow?.removeAttribute('aria-current');
    enemyRow?.setAttribute('aria-current', 'true');
    activeEnemyRow = enemyRow;
  }
  if (!marked) battleSelection = undefined;
  const upgrade = byId<HTMLButtonElement>('upgrade');
  const research = byId('research');
  upgrade.toggleAttribute('hidden', true);
  research.toggleAttribute('hidden', true);
  for (const cell of deploymentTiles) delete cell.dataset.muster;
  deploymentTiles = [];
  let title = planning ? '布防指引' : '战场详情';
  let description = planning ? '选择一张军令，再点击河东草地。箭塔能覆盖附近的桥头。'
    : battle ? '选择名单中的敌军或地图上的格子，查看生命和能力。'
      : run.phase === 'reward' ? '打开战利品，查看本波战报。' : '打开结算，查看本波战报。';
  if (card) {
    title = card.name;
    description = card.description;
  } else if (actor) {
    const def = actorDefinition(actor);
    title = def.name;
    description = `${actor.side === 'ally' ? '守军' : '敌军'} · 生命 ${actor.hp} / ${maxActorHp(actor)} · ${def.attack === 'heal' ? '治疗' : '攻击'} ${def.damage} · 护甲 ${def.armor}。${unitDescription(def, actor.side === 'enemy')}`;
    if (actor.side === 'enemy') {
      const group = liveEnemiesOf(actor.def);
      if (group.length > 1) description += ` 同类敌军 ${group.indexOf(actor) + 1} / ${group.length}。`;
    }
  } else if (building) {
    const def = buildings.get(building.def)!;
    const stats = buildingStats(building);
    title = `${def.name} · ${building.level} 级`;
    const benefits = [`耐久 ${building.hp} / ${stats.hp}`];
    if (run.phase === 'planning' && def.id === 'wall') {
      const hp = openingWallHp(building, frontlineRepair(run));
      if (hp > building.hp) benefits.push(`开战前修至 ${hp} 耐久`);
    }
    if (run.kingdom === 'iron' && def.id === 'wall') benefits.push(`为 ${rampartGuard.distance} 格内的步兵提供 ${rampartGuard.armor} 护甲和近战反击`);
    if (stats.damage) benefits.push(`伤害 ${stats.damage + arcaneBonus(run, building)}，射程 ${Number((stats.reach + watchReach(run, def.id)).toFixed(2))} 格`);
    const reinforcement = reinforcedWatch(run, building);
    if (reinforcement) benefits.push(`邻接栅墙，射击间隔 −${reinforcement * STEP_MS / 1000} 秒`);
    if (planning) {
      const income = costText(buildingProduction(building, run.buildings, run.kingdom, run.route));
      if (income) benefits.push(`开战前产出 ${income}`);
      if (costText(stats.capacity)) benefits.push(`仓储增加 ${costText(stats.capacity)}`);
    }
    if (def.recruits) {
      const deployment = muster?.deployments.get(building.id);
      benefits.push(`召集${units.get(def.recruits)!.name}`);
      if (deployment) {
        benefits.push(`出阵位置 ${deployment.cells.length} / ${deployment.limit}${deployment.cells.length ? '，地图已标出' : ''}`);
        if (deployment.cells.length < deployment.limit) benefits.push('需要留出更多相邻草地');
        deploymentTiles = deployment.cells.map(tile => tileButtons[tileKey(tile)]);
        for (const cell of deploymentTiles) cell.dataset.muster = 'true';
      }
    }
    if (def.effect === 'blessing') benefits.push(`参战单位生命 +${stats.effect}`);
    if (def.effect === 'market') benefits.push(`每座相邻农圃或金矿 +${stats.effect} 金币`);
    if (def.effect === 'research') {
      benefits.push(`其他建筑升级少花 ${stats.effect} 金币`);
      if (run.research) benefits.push(`科技：${topics.get(run.research)!.name}`);
      research.hidden = run.phase !== 'planning' || relocating !== undefined || !!run.research || run.campaign !== 'march';
    }
    if (def.effect === 'ritual') benefits.push(`每座相邻法术设施 +${stats.effect} 魔力`, `相邻魔法类塔伤害 +${stats.effect}，同类加成取最高值`,
      run.divined ? '本局已占卜' : `战利品阶段可花费 ${costText(divinationCost)} 占卜一次`);
    description = benefits.join(' · ');
    if (run.phase === 'planning' && relocating === undefined && building.level === 1) {
      const cost = upgradeCost(run, building);
      upgrade.hidden = false;
      upgrade.textContent = `升级 · ${costText(cost)}`;
      upgrade.disabled = !canAfford(run.wallet, cost);
      upgrade.onclick = () => command({ kind: 'upgrade', id: building.id });
    }
  } else if (rally) {
    const def = units.get(rally.def)!;
    title = def.name;
    description = `基础生命 ${def.hp} · 攻击 ${def.damage} · 护甲 ${def.armor}。每波从这里集结，参战需要 ${upkeepFor(run, rally.def)} 食物。`;
    if (guardsRampart(run, rally.def, rally.tile)) description += '此处在栅墙掩护内。';
  } else if (keep) {
    title = '边境城堡';
    description = `生命 ${run.keepHp} / ${map.keepHp}。城堡归零时防线失守。`;
  } else if (planning && inspected) {
    const district = districtAt(run, inspected);
    const ley = isLeySite(run, inspected);
    if (district || ley) {
      title = district?.name ?? '灵脉';
      description = [district && (run.wave < district.wave ? `第 ${district.wave + 1} 波备战时开放。` : '已开放，可以部署军令。'),
        ley && '这块地适合建造月环祭坛。'].filter(Boolean).join('');
    }
  }
  const managed = card || run.phase !== 'planning' ? undefined : building ?? rally;
  byId('layout-actions').toggleAttribute('hidden', !managed);
  if (managed) {
    const moving = relocating === managed.id;
    moveButton.textContent = moving ? '取消迁移' : `迁移 · ${costText(relocationCost[building ? 'building' : 'rally'])}`;
    moveButton.onclick = () => startRelocation(managed.id);
    removeButton.hidden = moving;
    removeButton.textContent = building ? '拆除' : '解散';
    removeButton.onclick = () => openRemoval(managed.id);
    const group = muster?.groups.get(managed.id);
    if (group && group.fed < group.ready) description += ` · 军粮预计供给 ${group.fed} / ${group.ready} 支`;
    if (managed.id === run.supplyPriority) description += ' · 优先领粮';
    if (moving) description = '选择新位置。方向键选格，Enter 确认，Esc 取消。';
  }
  updateText('inspect-title', title);
  updateText('inspect-text', description);
}

function updateHand(): void {
  const key = `${run.phase === 'planning'}:${run.hand.join(',')}`;
  if (lastHand !== key) {
    lastHand = key;
    hand.innerHTML = run.hand.length ? run.hand.map((id, index) => {
      const card = cards.get(id)!;
      return `<button type="button" class="card" data-slot="${index}" data-card="${id}" title="${card.description}" aria-pressed="false">${cardBody(card, index)}</button>`;
    }).join('') : '<p class="empty-hand">军令已用完。迎战后可选择新的战利品。</p>';
    for (const button of hand.querySelectorAll<HTMLButtonElement>('button')) {
      button.addEventListener('click', event => select(Number(button.dataset.slot), event.detail === 0));
    }
  }
  for (const button of hand.querySelectorAll<HTMLButtonElement>('button')) {
    const slot = Number(button.dataset.slot);
    button.setAttribute('aria-pressed', String(slot === selected));
    button.disabled = run.phase !== 'planning';
    button.classList.toggle('unaffordable', !canAfford(run.wallet, cards.get(run.hand[slot])!.cost));
  }
  byId('hand-count').textContent = String(run.hand.length);
  byId('deck-count').textContent = `牌库 ${run.deck.length} · 弃牌 ${run.discard.length} · 数字键选牌`;
  const construction = run.phase === 'planning' ? constructionSlots() : [];
  buildShortcut.hidden = !construction.length;
  buildShortcut.disabled = !affordableConstruction(construction).length;
}

function updateText(id: string, value: string): void {
  const node = byId(id);
  if (node.textContent !== value) node.textContent = value;
}

function updateBattleCounters(): void {
  const planning = run.phase === 'planning';
  approaches.current = planning ? predictApproach(run) : undefined;
  const obstacle = approaches.current?.obstacle;
  const obstacleSummary = byId('approach-obstacle');
  obstacleSummary.hidden = !obstacle;
  updateText('approach-obstacle', obstacle ? `通路封闭 · ${describeObstacle(obstacle)}` : '');
  const count = planning ? campaigns[run.campaign].waves[run.wave].groups.reduce((sum, group) => sum + group.count, 0)
    : run.phase === 'battle' ? updateLiveEnemies()
      : Math.max(0, run.schedule.length - run.spawnIndex) + run.actors.filter(actor => actor.side === 'enemy').length;
  updateText('res-hp', `${run.keepHp} / ${map.keepHp}`);
  const settling = run.phase === 'battle' && count === 0 && run.shots.some(shot => shot.hostile);
  updateText('enemies-left', settling ? '敌军已清空 · 敌方弹道结算中' : planning ? `敌军 ${count}` : `敌军剩余 ${count}`);
  updateText('defeated', `累计击退 ${run.defeated}`);
}

function openEnemyBriefing(unit: UnitDef, count: number, firstTick: number): void {
  const seconds = firstTick * STEP_MS / 1000;
  show('enemy-briefing', `<h2 id="dialog-title">${unit.name}</h2>
    <div class="enemy-briefing-detail">
      <p class="enemy-arrival">本波 ${count} 名 · 开战后 ${seconds} 秒首次入场</p>
      <p>${unitDescription(unit, true)}</p>
      ${factList(unitFacts(unit))}
    </div>
    <button class="quiet" id="close-enemy-briefing" type="button">返回备战</button>`);
  byId('close-enemy-briefing').onclick = close;
}

function updateLiveEnemies(): number {
  const totals = new Map<string, { active: number; waiting: number }>();
  const countFor = (id: string) => {
    const current = totals.get(id);
    if (current) return current;
    const newCount = { active: 0, waiting: 0 };
    totals.set(id, newCount);
    return newCount;
  };
  for (let index = run.spawnIndex; index < run.schedule.length; index++) countFor(run.schedule[index].enemy).waiting++;
  let active = 0;
  for (const actor of run.actors) {
    if (actor.side !== 'enemy' || actor.hp <= 0) continue;
    active++;
    countFor(actor.def).active++;
  }
  for (const [id] of totals) {
    if (liveEnemyRows.has(id)) continue;
    const row = document.createElement('li');
    row.dataset.enemy = id;
    const button = document.createElement('button');
    button.type = 'button';
    button.onclick = () => inspectEnemy(id);
    const name = document.createElement('span');
    name.textContent = (enemies.get(id) ?? units.get(id))?.name ?? id;
    const amount = document.createElement('b');
    button.append(name, amount);
    row.append(button);
    byId('enemy-roster').append(row);
    liveEnemyRows.set(id, { button, amount });
  }
  for (const [id, { button, amount }] of liveEnemyRows) {
    const tally = totals.get(id);
    const text = `${tally?.active ?? 0} / ${tally?.waiting ?? 0}`;
    if (amount.textContent !== text) amount.textContent = text;
    const disabled = String(!tally?.active);
    if (button.getAttribute('aria-disabled') !== disabled) {
      button.setAttribute('aria-disabled', disabled);
      button.tabIndex = tally?.active ? 0 : -1;
    }
  }
  return active + run.schedule.length - run.spawnIndex;
}

function updateEnemyRoster(): void {
  const planning = run.phase === 'planning';
  const battle = run.phase === 'battle';
  const list = byId('enemy-roster');
  byId('enemy-roster-key').hidden = !battle;
  if (battle) list.setAttribute('aria-describedby', 'enemy-roster-key');
  else list.removeAttribute('aria-describedby');
  list.replaceChildren();
  liveEnemyRows.clear();
  if (!planning) return;
  const roster = new Map<string, { count: number; firstTick: number }>();
  for (const { enemy, tick } of scheduleWave(run.wave, run.campaign, run.route)) {
    const entry = roster.get(enemy);
    if (entry) entry.count++;
    else roster.set(enemy, { count: 1, firstTick: tick });
  }
  const rows = [...roster].map(([id, { count, firstTick }]) => {
    const unit = enemies.get(id)!;
    const row = document.createElement('li');
    const summary = `<span>${unit.name}</span><b>${count}</b>`;
    row.innerHTML = `<button type="button" aria-haspopup="dialog">${summary}</button>`;
    const button = row.querySelector('button')!;
    button.onclick = () => {
      button.focus({ preventScroll: true });
      openEnemyBriefing(unit, count, firstTick);
    };
    return row;
  });
  list.replaceChildren(...rows);
}

function update(): void {
  // Both the planning state and the selected order may change before a full HUD update.
  placementPreviews.clear();
  placementBaseline = undefined;
  sandboxPanel?.refresh(run);
  updateCheckpointNotice();
  const campaign = campaigns[run.campaign];
  const waves = campaign.waves;
  const limits = capacity(run.buildings);
  for (const key of resources) {
    const node = byId(`res-${key}`);
    node.textContent = String(run.wallet[key]);
    node.parentElement!.title = `${resourceLabel[key]} ${run.wallet[key]} / ${limits[key]}`;
  }
  byId('campaign-name').textContent = run.kingdom ? `${campaign.name} · ${kingdoms[run.kingdom].name}` : campaign.name;
  byId('campaign-chapter').textContent = campaign.name;
  updateJourney();
  byId('phase').textContent = run.paused ? '已暂停' : phaseLabel[run.phase];
  byId('phase').dataset.phase = run.phase;
  byId('seed').textContent = `种子 ${run.seed}`;
  byId('wave-count').textContent = `${run.wave + 1} / ${waves.length}`;
  byId('wave-name').textContent = waves[run.wave].name;
  const planning = run.phase === 'planning';
  const briefing = `${run.campaign}:${run.route}:${run.wave}:${run.phase}`;
  if (briefing !== lastBriefing) {
    lastBriefing = briefing;
    byId('wave-pips').innerHTML = waves.map((_, index) => `<i class="${index <= run.wave ? 'active' : ''}"></i>`).join('');
    updateEnemyRoster();
  }
  updateBattleCounters();
  const forecast = byId('forecast');
  forecast.hidden = run.phase !== 'planning';
  byId('crossing-coverage').hidden = run.phase !== 'planning';
  const formationVisible = run.campaign === 'march' && run.phase === 'planning';
  byId('formation-control').hidden = !formationVisible;
  const boundary = formationBoundary[run.formation];
  const line = byId('formation-line');
  line.hidden = !formationVisible || !boundary;
  if (formationVisible) {
    byId<HTMLSelectElement>('formation').value = run.formation;
    line.style.setProperty('--formation-column', String(boundary));
  }
  byId('shop').hidden = run.phase !== 'planning' || run.campaign !== 'march';
  const recentPlacement = run.phase === 'planning' ? run.deployments.at(-1) : undefined;
  undoButton.hidden = !recentPlacement;
  undoButton.textContent = recentPlacement ? `撤销部署 · ${cards.get(recentPlacement.card)!.name}` : '撤销部署';
  const refine = byId('refine');
  refine.hidden = run.phase !== 'planning' || run.campaign !== 'march';
  updateText('refine', run.wave > 0 ? '整理战术牌' : '查看战术牌');
  let muster: Muster | undefined;
  if (run.phase === 'planning') {
    const crossings = crossingCoverage(run);
    crossings.forEach(({ name, row, towers }, index) => {
      const id = `crossing-${index}`;
      updateText(id, `${name}（第 ${row} 行） · ${towers ? `${towers} 座防御塔覆盖` : '无防御塔覆盖'}`);
      byId(id).toggleAttribute('data-uncovered', towers === 0);
    });
    const supplies = forecastSupplies(run, limits.food);
    placementBaseline = { supplies, crossings, approach: approaches.current };
    const { income } = supplies;
    muster = supplies.muster;
    forecast.textContent = [costText(income) ? `开战前产出 ${costText(income)}` : '',
      muster.ready ? `出阵 ${muster.fed} / ${muster.ready} 支，消耗 ${muster.food} 食物` : '',
      muster.fed < muster.ready ? `支援全部部队需要 ${muster.needed} 食物` : '',
      muster.blocked ? `${muster.blocked} 个出阵位置受阻` : ''].filter(Boolean).join(' · ');
    forecast.hidden = !forecast.textContent;
    byId('objective').textContent = planningObjective(run, muster, crossings);
    if (formationVisible) {
      const detail = boundary ? `从第 ${boundary + 1} 列起迎击。阵线前的部队仍可原地攻击。` : '守军可越过渡口追击。';
      const advice = muster.fed ? formationAdvice(run) : '';
      updateText('formation-note', detail + advice);
    }
  } else {
    byId('objective').textContent = run.phase === 'battle' ? '守军正在自动迎敌。'
      : run.phase === 'reward' ? '选择一张军令，准备迎接下一波。'
      : run.phase === 'won' ? '所有敌军均已被击退。' : '灰旗军突破了防线。';
  }
  updateBlockedMuster(muster);
  byId('supply').hidden = !muster?.groups.size;
  updateBattleAction();
  tileLayer.classList.toggle('placing', selected !== undefined || relocating !== undefined);
  updateHand();
  updateInspect(muster);
  updateTilePreview();
}

function updateBattleAction(): void {
  const waiting = run.phase === 'planning' && battlefieldStatus !== 'ready';
  actionButton.disabled = waiting && battlefieldStatus === 'loading';
  byId('battlefield-error').hidden = !waiting || battlefieldStatus !== 'failed';
  actionButton.textContent = waiting ? (battlefieldStatus === 'loading' ? '正在加载战场…' : '重新加载页面')
    : run.phase === 'planning' ? '开始战斗'
      : run.phase === 'battle' ? (run.paused ? '继续战斗' : '暂停战斗')
        : run.phase === 'reward' ? '选择战利品' : '查看结算';
}

function updateJourney(): void {
  const route = routes.get(run.route)!;
  const title = byId('route-name');
  title.textContent = run.campaign === 'march' ? route.name : '鸦渡战场';
  title.title = route.description;
  const planning = run.phase === 'planning';
  const key = `${run.campaign}:${run.route}:${run.wave}:${planning}:${run.buildings.length}:${run.rally.length}`;
  if (lastMap !== key) {
    lastMap = key;
    let hasSealed = false;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      const tile = { x, y };
      const ground = terrain(tile, run.route);
      const names = { grass: '草地', keep: '城堡', entry: '敌方入口', water: '河流', bridge: '桥', rock: '岩石' };
      const button = tileButtons[tileKey(tile)];
      const district = sealedDistrict(run, tile);
      const building = buildingAt(run.buildings, tile);
      const rally = run.rally.find(item => same(item.tile, tile));
      const locked = district && !building && !rally ? district : undefined;
      const ley = isLeySite(run, tile);
      button.toggleAttribute('data-locked', Boolean(locked));
      button.toggleAttribute('data-ley', ley);
      button.setAttribute('aria-label', [
        `${x + 1}列${y + 1}行 ${names[ground]}`,
        locked && `第 ${locked.wave + 1} 波开放`,
        ley && '灵脉',
        building && buildings.get(building.def)!.name,
        planning && rally && `${units.get(rally.def)!.name}集结点`,
      ].filter(Boolean).join(' · '));
      hasSealed ||= Boolean(locked);
    }
    byId('locked-key').hidden = !hasSealed;
    byId('ley-key').hidden = run.campaign !== 'march';
  }
  const encounter = pendingEncounter(run);
  const button = byId('encounter');
  button.hidden = !encounter;
  button.textContent = encounter ? `沿途 · ${encounter.name}` : '';
  const strip = byId('relic-strip');
  const stamp = run.relics.join(',');
  if (lastRelics !== stamp) {
    lastRelics = stamp;
    strip.innerHTML = run.relics.map(id => `<button type="button" data-relic="${id}" title="${relics.get(id)!.description}">${relics.get(id)!.name}</button>`).join('');
    for (const id of run.relics) {
      strip.querySelector<HTMLButtonElement>(`[data-relic="${id}"]`)!.onclick = () => {
        const item = relics.get(id)!;
        show('relic', `<h2 id="dialog-title">${item.name}</h2><p>${item.description}</p><button class="quiet" id="close-relic">返回</button>`);
        byId('close-relic').onclick = () => {
          close();
          strip.querySelector<HTMLButtonElement>(`[data-relic="${id}"]`)?.focus();
        };
      };
    }
  }
  strip.hidden = !run.relics.length;
}

function show(kind: NonNullable<typeof dialogKind>, content: string): void {
  dialogKind = kind;
  overlay.innerHTML = content;
  if (!overlay.open) overlay.showModal();
  overlay.querySelector<HTMLElement>('[autofocus], button')?.focus();
}

function close(): void {
  overlay.close();
  dialogKind = undefined;
}

const defaultSeed = 119;

function randomSeed(previous: number): number {
  const [seed] = crypto.getRandomValues(new Uint32Array(1));
  return seed === previous ? (seed + 1) >>> 0 : seed;
}

function menu({ campaign = 'crowford', seed = defaultSeed, kingdom = null, charter = null }:
  Partial<Pick<Run, 'campaign' | 'seed' | 'kingdom' | 'charter'>> = {}, checkpointChanged = false): void {
  if (isSandbox) {
    const destination = new URL(window.location.href);
    for (const key of ['sandbox', 'campaign', 'kingdom', 'seed']) destination.searchParams.delete(key);
    window.location.replace(destination.href);
    return;
  }
  playing = false;
  checkpointStatus = undefined;
  updateCheckpointNotice();
  const saved = inspectCheckpoint();
  const checkpoint = saved.status === 'ready' || saved.status === 'recovered' ? saved.run : undefined;
  const temporaryOnly = saved.status === 'unavailable';
  const profile = readChronicle();
  show('menu', `<div class="menu-crest" aria-hidden="true"><img src="${menuCrest}" width="86" height="86" alt=""></div><h2 id="dialog-title">选择战局</h2>
    <label class="seed-entry">战役 <select id="campaign-input" aria-describedby="campaign-detail">
      <option value="crowford">鸦渡防线 · 三波教学</option><option value="march">灰旗远征 · 六波</option>
    </select></label>
    <p id="campaign-detail"></p>
    <div id="kingdom-choice" hidden>
      <label class="seed-entry"><span id="kingdom-label">王国</span> <select id="kingdom-input" aria-labelledby="kingdom-label">
        ${kingdomIds.map(id => `<option value="${id}" ${hasKingdom(profile.merit, id) ? '' : 'disabled'}>${kingdoms[id].name}${hasKingdom(profile.merit, id) ? '' : ` · ${tideMerit} 功勋解锁`}</option>`).join('')}
      </select></label>
      <p id="kingdom-detail"></p>
      <label class="seed-entry"><span id="charter-label">传承</span><select id="charter-input" aria-labelledby="charter-label" aria-describedby="charter-detail">
        <option value="">常规军令</option>
        ${charters.map(item => `<option value="${item.id}" ${hasCharter(profile.merit, item.id) ? '' : 'disabled'}>${item.name}${hasCharter(profile.merit, item.id) ? '' : ` · ${item.merit} 功勋解锁`}</option>`).join('')}
      </select></label>
      <p id="charter-detail" hidden></p>
    </div>
    <div class="seed-controls">
      <label class="seed-entry">战局种子 <input id="seed-input" type="number" min="0" max="4294967295" step="1" value="${seed}"></label>
      <button type="button" class="quiet" id="random-seed">随机种子</button>
    </div>
    <p id="seed-route" aria-live="polite" hidden></p>
    ${checkpointChanged ? '<p role="status">本机战局已在其他标签页更新。可从主菜单选择最新的存档继续。</p>' : ''}
    ${saved.status === 'invalid' ? '<p role="status">现有战局存档无法读取。开始新战局后会保存新进度。</p>' : ''}
    ${saved.status === 'recovered' ? '<p role="status">主存档无法读取。可以从备用进度继续战局。</p>' : ''}
    ${temporaryOnly ? '<p role="status">浏览器存储当前不可用。可以开始临时试玩。</p>' : ''}
    ${checkpoint ? '<button type="button" class="primary" id="continue-run">继续战局</button>' : ''}
    <button type="button" class="primary" id="new-run">${temporaryOnly ? '开始临时试玩' : '开始部署'}</button>
    <button type="button" class="quiet" id="menu-settings">设置</button>
    <button type="button" class="quiet" id="menu-compendium">图鉴</button>
    <button type="button" class="quiet" id="chronicle">远征纪事</button>
    <button type="button" class="quiet" id="menu-progress">进度备份</button>
    <button type="button" class="quiet" id="exit-game" title="离开当前页面，存档保留">退出游戏</button>
    ${import.meta.env.DEV ? '<div><button type="button" class="quiet" id="open-sandbox">打开调试沙盒</button></div>' : ''}`);
  const seedInput = byId<HTMLInputElement>('seed-input');
  const charterInput = byId<HTMLSelectElement>('charter-input');
  const kingdomInput = byId<HTMLSelectElement>('kingdom-input');
  const campaignInput = byId<HTMLSelectElement>('campaign-input');
  const selectedCampaign = (): CampaignId => campaignInput.value === 'march' ? 'march' : 'crowford';
  const selectedSeed = () => Number(seedInput.value || defaultSeed);
  const selectedCharter = () => charters.find(item => item.id === charterInput.value && hasCharter(profile.merit, item.id))?.id ?? null;
  campaignInput.value = campaign;
  if (kingdom && hasKingdom(profile.merit, kingdom)) kingdomInput.value = kingdom;
  if (charter && hasCharter(profile.merit, charter)) charterInput.value = charter;
  const newRun = byId('new-run');
  newRun.onclick = () => {
    if (!seedInput.reportValidity() || !hasKingdom(profile.merit, selectedKingdom())) return;
    const next = createRun(selectedSeed(), selectedCampaign(), selectedKingdom(), selectedCharter());
    if (temporaryOnly) enter(next, { temporary: true });
    else start(next, newRun);
  };
  const preview = byId('seed-route');
  const syncRoute = () => {
    const route = selectedCampaign() === 'march' && seedInput.validity.valid
      ? routes.get(routeFor('march', selectedSeed())) : undefined;
    preview.textContent = route ? `远征路线 · ${route.name}` : '';
    preview.hidden = !route;
  };
  const syncChoice = () => {
    const expedition = selectedCampaign() === 'march';
    byId('campaign-detail').textContent = expedition
      ? '选择王国，管理军粮并调整阵势，最终迎战断桥元帅。'
      : '跟随备战提示学习布阵、开战和选择战利品。';
    byId('kingdom-choice').hidden = !expedition;
    byId('kingdom-detail').textContent = kingdoms[selectedKingdom()].description;
    const choice = charters.find(item => item.id === charterInput.value);
    const detail = byId('charter-detail');
    detail.hidden = !choice;
    detail.textContent = choice ? describeMilestone(choice) : '';
    syncRoute();
  };
  campaignInput.onchange = syncChoice;
  kingdomInput.onchange = syncChoice;
  charterInput.onchange = syncChoice;
  seedInput.oninput = syncRoute;
  byId('random-seed').onclick = () => {
    seedInput.value = String(randomSeed(selectedSeed()));
    syncRoute();
  };
  syncChoice();
  byId(checkpoint ? 'continue-run' : 'new-run').focus();
  if (checkpoint) byId('continue-run').onclick = () => {
    const current = inspectCheckpoint();
    if (!('run' in current)) {
      menu({ campaign: selectedCampaign(), seed: seedInput.validity.valid ? selectedSeed() : defaultSeed,
        kingdom: selectedKingdom(), charter: selectedCharter() });
      return;
    }
    const needsId = current.run.campaign === 'march' && current.run.chronicleId === null;
    enter(current.run, { revision: current.revision, frames: current.frames });
    if (needsId || current.status === 'recovered') saveRun();
  };
  byId('menu-settings').onclick = () => openSettings();
  byId('menu-compendium').onclick = openCompendium;
  byId('chronicle').onclick = showChronicle;
  byId('menu-progress').onclick = openProgress;
  byId('exit-game').onclick = () => { window.location.assign('about:blank'); };
  if (import.meta.env.DEV) byId('open-sandbox').onclick = () => {
    if (!seedInput.reportValidity()) return;
    const destination = new URL(window.location.href);
    destination.searchParams.set('sandbox', '1');
    destination.searchParams.set('campaign', selectedCampaign());
    destination.searchParams.set('kingdom', selectedKingdom());
    destination.searchParams.set('seed', String(selectedSeed()));
    window.location.assign(destination.href);
  };
}

function describeCheckpoint(run: Run): string {
  return [campaigns[run.campaign].name, run.kingdom && kingdoms[run.kingdom].name,
    `第 ${run.wave + 1} 波`, phaseLabel[run.phase], `种子 ${run.seed}`].filter(Boolean).join(' · ');
}

function confirmNewRun(saved: ReturnType<typeof inspectCheckpoint>, next: Run, opener: HTMLElement): void {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'replace-run-title');
  dialog.setAttribute('aria-describedby', 'replace-run-current replace-run-next');
  dialog.innerHTML = `<h2 id="replace-run-title">替换现有战局？</h2>
    <p id="replace-run-current"></p>
    <p id="replace-run-next"></p>
    <p id="replace-run-status" role="status" hidden></p>
    <p id="replace-run-temporary">临时试玩会保留现有战局和功勋。本局在刷新或返回主菜单时结束。</p>
    <button type="button" class="primary" id="cancel-new-run">取消</button>
    <button type="button" class="quiet" id="confirm-new-run">替换并开始</button>
    <button type="button" class="quiet" id="try-new-run" aria-describedby="replace-run-temporary">临时试玩</button>`;
  document.body.append(dialog);
  const cancel = byId('cancel-new-run');
  const status = byId('replace-run-status');
  const details = byId('replace-run-current');
  const showCheckpoint = () => {
    details.textContent = 'run' in saved ? `现有战局 · ${describeCheckpoint(saved.run)}`
      : saved.status === 'empty' ? '本机当前没有可续玩的战局。' : '现有战局存档无法读取。';
  };
  const report = (text: string) => {
    status.hidden = false;
    status.textContent = text;
  };
  showCheckpoint();
  byId('replace-run-next').textContent = `新战局 · ${describeCheckpoint(next)}。选择「替换并开始」会替换本机战局存档。`;
  cancel.onclick = () => dialog.close();
  byId('try-new-run').onclick = () => {
    dialog.close('started');
    enter(next, { temporary: true });
  };
  byId('confirm-new-run').onclick = () => {
    const current = inspectCheckpoint();
    if (current.status === 'unavailable') {
      report('暂时无法读取本机存档。可重试或选择临时试玩。');
      return;
    }
    if (!sameCheckpointRevision(current.revision, saved.revision)) {
      saved = current;
      showCheckpoint();
      report('存档已有更新，请核对后再确认。');
      cancel.focus();
      return;
    }
    identifyExpedition(next);
    const result = storeCheckpoint(next, current.revision);
    if (result.status !== 'saved') {
      report('未能保存新战局。可重试或选择临时试玩。');
      return;
    }
    dialog.close('started');
    enter(next, { revision: result.revision });
  };
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (dialog.returnValue !== 'started') opener.focus();
  }, { once: true });
  dialog.showModal();
  cancel.focus();
}

function describeMilestone(item: typeof chronicleMilestones[number]): string {
  if (item.kind === 'kingdom') return kingdoms.tide.description;
  if (item.kind === 'card') return `开局多带一张「${cards.get(item.id)!.name}」。`;
  return `战利品阶段可花费 ${costText(divinationCost)} 换一组战利品，每局一次。`;
}

function showChronicle(): void {
  const profile = readChronicle();
  show('chronicle', `<h2 id="dialog-title">远征纪事</h2><p>功勋 ${profile.merit} · 出征 ${profile.expeditions} · 胜利 ${profile.victories}</p>
    <p>每次远征结算获得 1 功勋，胜利额外获得 2 功勋。开局时可选一种已解锁的传承。</p>
    <ul class="chronicle-list">${chronicleMilestones.map(item => `<li>
      <div><strong>${item.name}</strong><small>${describeMilestone(item)}</small></div>
      <span>${profile.merit >= item.merit ? '已解锁' : `${item.merit} 功勋`}</span>
    </li>`).join('')}</ul>
    <button class="quiet" id="close-chronicle">返回主菜单</button>`);
  byId('close-chronicle').onclick = () => menu();
}

function openProgress(): void {
  show('progress', `<h2 id="dialog-title">进度备份</h2>
    <p>将战局和远征纪事保存成文件，换浏览器或试玩包后可以导入。</p>
    <button type="button" class="quiet" id="export-progress">导出进度</button>
    <label class="progress-picker">选择进度文件 <input id="progress-file" type="file" accept=".json,application/json"></label>
    <p id="progress-status" role="status" tabindex="-1"></p>
    <section class="progress-preview" id="progress-preview" aria-label="待导入的进度" hidden>
      <dl class="progress-comparison">
        <div><dt id="progress-import-label">待导入</dt><dd id="progress-summary"></dd></div>
        <div><dt id="progress-local-label">本机当前进度</dt><dd id="progress-local"></dd></div>
      </dl>
      <p>确认后，本浏览器中的战局和远征纪事将被替换。</p>
      <button type="button" class="primary" id="restore-progress" aria-describedby="progress-import-label progress-summary progress-local-label progress-local">确认替换本机进度</button>
    </section>
    <button type="button" class="quiet" id="close-progress">返回主菜单</button>`);

  const input = byId<HTMLInputElement>('progress-file');
  const preview = byId('progress-preview');
  const status = byId('progress-status');
  const exportButton = byId<HTMLButtonElement>('export-progress');
  let local: ReturnType<typeof inspectProgress>;
  const refreshLocal = () => {
    local = inspectProgress();
    const saved = local?.saved;
    const run = saved && 'run' in saved ? saved.run : undefined;
    const summary = run ? describeCheckpoint(run) : saved?.status === 'invalid' ? '战局存档无法读取' : '没有进行中的战局';
    byId('progress-local').textContent = local ? `${summary} · 功勋 ${local.chronicle.merit}` : '本机进度暂时无法读取';
    exportButton.disabled = !run && !local?.chronicle.expeditions;
  };
  refreshLocal();
  if (exportButton.disabled) input.focus();
  let pending: ProgressFile | undefined;
  let selection = 0;
  byId('close-progress').onclick = () => { menu(); byId('menu-progress').focus(); };
  exportButton.onclick = () => {
    const latest = inspectProgress();
    if (!latest) {
      status.textContent = '暂时无法读取本机进度。请检查浏览器存储后重试。';
      return;
    }
    const { saved, chronicle } = latest;
    const run = 'run' in saved ? saved.run : null;
    const frames = 'run' in saved ? saved.frames : undefined;
    const outgoing = run || chronicle.expeditions ? encodeProgress({ run, chronicle, frames }) : undefined;
    if (!outgoing) {
      status.textContent = '当前没有可导出的进度。';
      return;
    }
    downloadFile('before-the-onslaught-progress.json', new Blob([outgoing], { type: 'application/json' }));
  };
  input.onchange = async () => {
    const current = ++selection;
    pending = undefined;
    preview.hidden = true;
    status.textContent = '';
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > maxProgressFile) {
      status.textContent = '文件超过 256 KB，请选择本游戏导出的进度。';
      return;
    }
    const text = await file.text().catch(() => undefined);
    if (current !== selection || !input.isConnected) return;
    pending = text === undefined ? undefined : decodeProgress(text);
    if (!pending) {
      status.textContent = '无法读取此进度文件。请检查文件是否完整，或尝试使用更新版游戏。';
      return;
    }
    const imported = pending.run;
    const details = imported ? describeCheckpoint(imported) : '这份备份只有远征纪事';
    byId('progress-summary').textContent = `${details} · 功勋 ${pending.chronicle.merit}`;
    refreshLocal();
    preview.hidden = false;
  };
  byId('restore-progress').onclick = () => {
    if (!pending) return;
    const result = restoreProgress(pending, local?.revision);
    if (result === 'changed') {
      refreshLocal();
      status.textContent = local ? '本机进度已有更新。请核对后再次确认。' : '暂时无法读取本机进度。请重试。';
      status.focus();
      return;
    }
    if (result === 'unavailable') {
      status.textContent = '浏览器未能保存导入的进度。请检查本地存储后重试。';
      return;
    }
    openProgress();
    const restored = byId('progress-status');
    restored.textContent = '进度已恢复。返回主菜单即可继续。';
    restored.focus();
  };
}

function selectedKingdom(): KingdomId {
  const value = byId<HTMLSelectElement>('kingdom-input').value;
  return kingdomIds.find(id => id === value) ?? 'iron';
}

function start(next: Run, opener: HTMLElement): void {
  if (isSandbox) {
    enter(next);
    return;
  }
  if (checkpointStatus === 'temporary') {
    enter(next, { temporary: true });
    return;
  }
  const current = inspectCheckpoint();
  if (current.status === 'unavailable') {
    enter(next, { temporary: true });
    return;
  }
  if (current.status !== 'empty') {
    confirmNewRun(current, next, opener);
    return;
  }
  enter(next, { revision: current.revision });
  saveRun();
}

function saveRun(): boolean {
  if (isSandbox || checkpointStatus === 'temporary') return true;
  const result = storeCheckpoint(run, checkpointRevision, frameHistory);
  if (result.status === 'changed') {
    menu({}, true);
    return false;
  }
  if (result.status === 'saved') checkpointRevision = result.revision;
  checkpointStatus = result.status === 'saved' ? undefined : 'unsaved';
  updateCheckpointNotice();
  return true;
}

function updateCheckpointNotice(focus?: 'retry' | 'status'): void {
  const inReward = playing && run.phase === 'reward';
  boardCheckpointNotice.hidden = !playing || inReward || !checkpointStatus;
  if (!playing) return;
  const notice = inReward ? overlay.querySelector<HTMLElement>('[data-checkpoint-save]') : boardCheckpointNotice;
  if (!notice) return;
  notice.hidden = !checkpointStatus;
  if (notice.hidden) return;
  const retry = notice.querySelector('button')!;
  const status = notice.querySelector('p')!;
  const text = checkpointStatus === 'temporary' ? temporaryNotice
    : checkpointStatus === 'saved' ? '进度已保存。' : '进度尚未保存。刷新或关闭会丢失本次未保存的进度。';
  if (status.textContent !== text) status.textContent = text;
  retry.hidden = checkpointStatus !== 'unsaved' || run.phase === 'battle';
  retry.onclick = retryCheckpoint;
  if (focus === 'retry' && !retry.hidden) retry.focus();
  if (focus === 'status') status.focus();
}

function retryCheckpoint(): void {
  if (!saveRun() || checkpointStatus === 'unsaved') return;
  checkpointStatus = 'saved';
  updateCheckpointNotice('status');
}

function enter(next: Run, { revision, frames = [], temporary = false }:
  { revision?: CheckpointRevision; frames?: FrameHistory; temporary?: boolean } = {}): void {
  run = next;
  frameHistory = frames;
  frameSamples.clear();
  checkpointRevision = revision;
  checkpointStatus = temporary ? 'temporary' : undefined;
  app.dataset.kingdom = run.kingdom ?? '';
  byId('brand-crest').textContent = run.kingdom ? kingdomCrests[run.kingdom] : '♜';
  lastMap = '';
  if (!isSandbox && !temporary) identifyExpedition(run);
  meritAward = undefined;
  selected = undefined;
  relocating = undefined;
  inspected = undefined;
  battleSelection = undefined;
  playing = true;
  close();
  clearTileHints();
  message();
  byId('battle-alert').hidden = true;
  playSound('click');
  update();
  if (run.phase === 'reward') reward();
  else hand.querySelector('button')?.focus();
}

const waveDownloadButton = '<button type="button" class="quiet" id="save-wave-report">保存战报</button>';

function frameReportLine(sample: FrameSummary): string {
  const cap = sample.cap === 'display' ? '跟随屏幕' : `${sample.cap} FPS`;
  return `上限 ${cap} · ${motionLabels[sample.motion]}动效 · 视口 ${sample.width} × ${sample.height}`
    + ` · 实测 ${sample.fps.toFixed(1)} FPS · 帧间隔 P95 ${sample.p95.toFixed(1)} 毫秒`
    + ` · 超过 50 毫秒 ${sample.stalls} 次 · 采样 ${sample.seconds.toFixed(2)} 秒`;
}

function bindReportDownloads(): void {
  const name = `before-the-onslaught-${run.kingdom ?? run.campaign}-${run.seed}`;
  const button = overlay.querySelector<HTMLButtonElement>('#save-wave-report');
  if (button) button.onclick = () => {
    const report = waveReportText(run);
    if (!report) return;
    const filename = `${name}-wave-${run.wave + 1}.txt`;
    const samples = settings.recordFrameRate ? frameHistory.find(row => row.wave === run.wave)?.samples : undefined;
    const timingReport = samples?.length ? ['', '战斗帧率记录', ...samples.map(frameReportLine), ''].join('\r\n') : '';
    downloadFile(filename, new Blob(['\ufeff', report, timingReport], { type: 'text/plain;charset=utf-8' }));
  };
  const whole = overlay.querySelector<HTMLButtonElement>('#save-run-report');
  if (whole) whole.onclick = () => {
    const report = runReportText(run);
    if (!report) return;
    const timings = settings.recordFrameRate && frameHistory.length ? [
      '', '战斗帧率记录',
      ...frameHistory.flatMap(({ wave, samples }) => [`第 ${wave + 1} 波帧率`, ...samples.map(frameReportLine), '']),
    ].join('\r\n') : '';
    downloadFile(`${name}-run.txt`, new Blob(['\ufeff', report, timings], { type: 'text/plain;charset=utf-8' }));
  };
}

function reward(): void {
  const source = divinationSource(run);
  const method = run.charter === 'divination' ? '传承' : '祭坛';
  const available = canAfford(run.wallet, divinationCost);
  show('reward', `<h2 id="dialog-title">选择战利品</h2><p>选一张军令加入手牌。战术牌用完会回到牌库循环。</p>
    ${checkpointStatus === 'temporary' ? `<p role="status">${temporaryNotice}</p>` : checkpointStatus ? checkpointNoticeMarkup('reward') : ''}
    ${waveReview(run)}
    <div class="reward-cards">${run.rewards.map(id => `<button class="card" data-reward="${id}">${cardBody(cards.get(id)!)}<span>${cards.get(id)!.description}</span></button>`).join('')}</div>
    ${run.divined ? `<p class="altar-offer" id="divine-status" role="status">本局已使用${method}占卜。</p>` : source
      ? `<div class="altar-offer"><p id="divine-status">${source === 'charter' ? '占卜传承' : '月环祭坛'}可以更换全部战利品，每局限一次。${available ? '' : '魔力不足。'}</p>
        <button id="divine" class="quiet" type="button" aria-describedby="divine-status" ${available ? '' : 'disabled'}>占卜新战利品 · ${costText(divinationCost)}</button></div>` : ''}
    ${run.waveReport ? waveDownloadButton : ''}`);
  updateCheckpointNotice('retry');
  bindReportDownloads();
  const divine = overlay.querySelector<HTMLButtonElement>('#divine');
  if (divine) divine.onclick = () => { if (command({ kind: 'divine' })) reward(); };
  for (const button of overlay.querySelectorAll<HTMLButtonElement>('[data-reward]')) {
    button.onclick = event => {
      const rewardSlot = run.hand.length;
      if (!command({ kind: 'reward', card: button.dataset.reward! })) return;
      close();
      if (event.detail === 0) focusHandCard(rewardSlot);
      else actionButton.focus();
    };
  }
}

function settleRun(): void {
  if (isSandbox || checkpointStatus === 'temporary') return;
  if (run.campaign === 'march') {
    meritAward = awardChronicle(run, checkpointRevision);
    if (meritAward.status !== 'saved') return;
  }
  removeCheckpoint(checkpointRevision);
}

function result(): void {
  const title = run.phase === 'won' ? (run.campaign === 'march' ? '远征告捷' : '鸦渡守住了') : '防线失守';
  const tutorialWon = run.campaign === 'crowford' && run.phase === 'won' && !isSandbox;
  const expedition = run.campaign === 'march' && !isSandbox;
  const meritPending = expedition && meritAward?.status === 'unavailable';
  const superseded = expedition && meritAward?.status === 'superseded';
  const award = meritAward?.status === 'saved' && meritAward.gained ? meritAward : undefined;
  const unlocked = award ? chronicleMilestones.filter(item => item.merit > award.before && item.merit <= award.total) : [];
  const next = award && chronicleMilestones.find(item => item.merit > award.total);
  show('result', `<div class="dialog-crest" aria-hidden="true">${run.phase === 'won' ? '♜' : '⚑'}</div>
    <h2 id="dialog-title">${title}</h2><p>第 ${run.wave + 1} 波 · 击退 ${run.defeated} 名敌军 · 城堡生命 ${run.keepHp}</p>
    ${waveReview(run)}
    ${checkpointStatus === 'temporary' ? '<p role="status">临时试玩已结束。可下载战报留存本局结果。</p>' : ''}
    ${award ? `<p id="merit-earned">远征功勋 +${award.gained}</p>` : ''}
    ${unlocked.length ? `<p id="merit-unlocked">本次解锁 ${unlocked.map(item => item.name).join('、')}</p>` : ''}
    ${next && award ? `<p id="merit-next">再获 ${next.merit - award.total} 功勋可解锁「${next.name}」。</p>` : ''}
    ${superseded ? '<p id="merit-superseded" role="status">同一战局已在其他标签页更新，功勋将以较新的进度结算。返回主菜单可继续战局。</p>' : ''}
    ${meritPending ? `<p id="merit-pending" role="status">未能保存远征功勋。请在离开结算页前重试。重新打开游戏可从上一次成功保存的检查点继续。</p>
      <button type="button" class="primary" id="retry-merit" aria-describedby="merit-pending">重试保存功勋</button>` : ''}
    ${tutorialWon ? '<button class="primary" id="choose-expedition">前往灰旗远征</button>' : ''}
    ${expedition ? `<button class="${meritPending || superseded ? 'quiet' : 'primary'}" id="next-expedition">换种子再出征</button>` : ''}
    <button class="${tutorialWon || expedition ? 'quiet' : 'primary'}" id="retry">重开同一战局</button>
    <button ${superseded ? 'class="primary" aria-describedby="merit-superseded"' : 'class="quiet"'} id="return-menu">返回主菜单</button>
    ${run.waveReport ? `${waveDownloadButton}<button type="button" class="quiet" id="save-run-report">保存整局战报</button>` : ''}`);
  bindReportDownloads();
  if (meritPending) byId('retry-merit').onclick = () => {
    settleRun();
    result();
  };
  if (tutorialWon) byId('choose-expedition').onclick = () => {
    menu({ campaign: 'march' });
    byId('kingdom-input').focus();
  };
  if (expedition) byId('next-expedition').onclick = () => {
    menu({ campaign: 'march', seed: randomSeed(run.seed), kingdom: run.kingdom, charter: run.charter });
  };
  const retry = byId('retry');
  retry.onclick = () => start(createRun(run.seed, run.campaign, run.kingdom ?? undefined, run.charter), retry);
  const back = byId('return-menu');
  back.onclick = () => menu();
  if (superseded) back.focus();
}

function openShop(): void {
  const stock = shopStock(run);
  if (run.phase !== 'planning' || !stock.length) return;
  show('shop', `<h2 id="dialog-title">军令商店</h2><p>购买后加入手牌，部署仍需支付卡面费用。</p>
    <p>当前金币 ${run.wallet.gold}</p>
    <div class="reward-cards">${stock.map(id => {
      const cost = permitPrice(id);
      const bought = run.shopBought.includes(id);
      const card = cards.get(id)!;
      return `<button type="button" class="card" data-offer="${id}" ${bought || !canAfford(run.wallet, cost) ? 'disabled' : ''}>
        ${cardBody(card)}<span>${id === 'farm' ? '常备军令 · 每波可购一张。临水部署可多产食物。' : card.description}</span>
        <span>${bought ? '本波已购' : `购入 ${costText(cost)}`}</span>
      </button>`;
    }).join('')}</div><button id="close-shop" class="quiet">返回部署</button>`);
  for (const button of overlay.querySelectorAll<HTMLButtonElement>('[data-offer]')) {
    button.onclick = () => { if (command({ kind: 'buy', card: button.dataset.offer! })) openShop(); };
  }
  byId('close-shop').onclick = closeShop;
}

function closeShop(): void {
  close();
  byId('shop').focus();
}

function openEncounter(): void {
  const encounter = pendingEncounter(run);
  if (!encounter) return;
  show('encounter', `<h2 id="dialog-title">${encounter.name}</h2><p>${encounter.description}</p>
    <p>在本波开战前可选一项。</p>
    <div class="reward-cards">${encounter.choices.map(choice => {
      const item = choice.relic ? relics.get(choice.relic) : undefined;
      const card = choice.card ? cards.get(choice.card) : undefined;
      const result = item ? (choice.id === relicTradeChoice ? item.description : `获得「${item.name}」。${item.description}`)
        : card ? `获得「${card.name}」。${card.description}` : `获得 ${costText(choice.gain!)}`;
      return `<button type="button" class="card" data-choice="${choice.id}" ${!canAfford(run.wallet, choice.cost) ? 'disabled' : ''}>
        <strong>${choice.label}</strong><span>${result}</span><span>${costText(choice.cost) || '免费'}</span>
      </button>`;
    }).join('')}</div><button class="quiet" id="close-encounter">稍后决定</button>`);
  for (const button of overlay.querySelectorAll<HTMLButtonElement>('[data-choice]')) {
    button.onclick = () => {
      if (!command({ kind: 'encounter', choice: button.dataset.choice! })) return;
      close();
      actionButton.focus();
    };
  }
  byId('close-encounter').onclick = closeEncounter;
}

function closeEncounter(): void {
  close();
  byId('encounter').focus();
}

function openRefinery(result = ''): void {
  if (run.phase !== 'planning' || run.campaign !== 'march') return;
  const editable = run.wave > 0;
  const pileNames = { hand: '手牌', deck: '牌库', discard: '弃牌' };
  const active = liveTactics(run);
  const canImprove = canAfford(run.wallet, refineCost.improve);
  const canRetire = active.length > 2 && canAfford(run.wallet, refineCost.retire);
  const rows = [...new Set(active)].map(id => {
    const card = cards.get(id)!;
    const upgraded = upgrades.get(id);
    const upgrade = upgraded ? cards.get(upgraded) : undefined;
    const piles = tacticPiles.map(pile => ({ name: pileNames[pile], count: run[pile].filter(key => key === id).length }));
    const target = piles.find(pile => pile.count > 0)!.name;
    return `<article class="refine-row" data-tactic="${id}"><strong>${card.name}</strong>
      <p class="refine-piles">${piles.map(({ name, count }) => `${name} ${count}`).join(' · ')}</p>
      <p>${card.description}</p>
      ${editable && upgrade ? `<p class="refine-preview"><strong>强化为 ${upgrade.name}</strong> · ${upgrade.description}</p>` : ''}
      ${editable ? `<div class="refine-actions">${upgrade ? `<button type="button" class="quiet" data-refine-card="${id}" data-refine-action="improve" ${canImprove ? '' : 'disabled'}>强化${target} · ${costText(refineCost.improve)}</button>` : ''}
      <button type="button" class="quiet" data-refine-card="${id}" data-refine-action="retire" ${canRetire ? '' : 'disabled'}>移除${target} · ${costText(refineCost.retire)}</button></div>` : ''}</article>`;
  });
  const title = editable ? '整理战术牌' : '查看战术牌';
  show('refine', `<h2 id="dialog-title" tabindex="-1" ${result ? '' : 'autofocus'}>${title}</h2>
    <p>${editable ? `当前金币 ${run.wallet.gold} · 流通战术牌 ${active.length} · 至少保留两张`
      : '每波备战抽两张战术牌，牌库空时洗回弃牌。打完首波可强化或移除。'}</p>
    ${result ? `<p id="refine-result" tabindex="-1" autofocus>${result}</p>` : ''}
    <div class="refine-list" tabindex="0" role="region" aria-label="战术牌分布">${rows.join('')}
      ${run.retired.length ? `<p id="retired-tactics">本局已移除 · ${run.retired.map(id => cards.get(id)!.name).join('、')}</p>` : ''}</div>
    <button class="quiet" id="close-refine">返回部署</button>`);
  for (const button of overlay.querySelectorAll<HTMLButtonElement>('[data-refine-action]')) {
    button.onclick = () => {
      const action = button.dataset.refineAction === 'improve' ? 'improve' : 'retire';
      const card = button.dataset.refineCard!;
      if (!command({ kind: 'refine', action, card })) return;
      const name = cards.get(card)!.name;
      const change = action === 'improve' ? `已将「${name}」强化为「${cards.get(upgrades.get(card)!)!.name}」` : `已移除一张「${name}」`;
      openRefinery(`${change}，花费 ${costText(refineCost[action])}。`);
    };
  }
  byId('close-refine').onclick = closeRefinery;
}

function closeRefinery(): void {
  close();
  byId('refine').focus();
}

function openResearch(): void {
  if (run.phase !== 'planning' || run.research || !run.buildings.some(item => item.def === 'lab')) return;
  show('research', `<h2 id="dialog-title">选择科技</h2><p>本局研究一项技术。研究所被摧毁后，已学技术继续生效。</p>
    <div class="reward-cards">${[...topics.values()].map(topic => `<button class="card" data-topic="${topic.id}" ${canAfford(run.wallet, topic.cost) ? '' : 'disabled'}>
      <strong>${topic.name}</strong><span>${topic.description}</span><span>${costText(topic.cost)}</span></button>`).join('')}</div>
    <button class="quiet" id="close-research">返回部署</button>`);
  for (const button of overlay.querySelectorAll<HTMLButtonElement>('[data-topic]')) {
    button.onclick = () => {
      if (!command({ kind: 'research', topic: button.dataset.topic as ResearchId })) return;
      close();
      actionButton.focus();
    };
  }
  byId('close-research').onclick = closeResearch;
}

function closeResearch(): void {
  close();
  byId('research').focus();
}

function pauseMenu(): void {
  if (run.phase !== 'battle') return;
  if (!run.paused) {
    const focus = document.activeElement;
    pauseEnemyRow = focus instanceof HTMLButtonElement && byId('enemy-roster').contains(focus) ? focus : undefined;
    command({ kind: 'pause' });
  }
  const checkpointHint = isSandbox ? '返回主菜单会结束这次调试会话。' : checkpointStatus === 'temporary'
    ? temporaryNotice : checkpointStatus === 'unsaved'
    ? '开战前的进度尚未保存。离开战局会丢失未保存的部署。' : '返回主菜单后，可从本波备战继续。';
  show('pause', `<h2 id="dialog-title">战斗已暂停</h2>
    <p>第 ${run.wave + 1} 波 · 城堡生命 ${run.keepHp} / ${map.keepHp}</p>
    <button class="primary" id="resume-battle" type="button">继续战斗</button>
    <button class="quiet" id="pause-settings" type="button">设置</button>
    <button class="quiet" id="pause-compendium" type="button">图鉴</button>
    <p class="pause-checkpoint">${checkpointHint}</p>
    <button class="quiet" id="pause-menu" type="button">返回主菜单</button>`);
  byId('resume-battle').onclick = resumeBattle;
  byId('pause-settings').onclick = () => openSettings(true);
  byId('pause-compendium').onclick = openCompendium;
  byId('pause-menu').onclick = () => menu();
}

function resumeBattle(): void {
  close();
  if (run.phase === 'battle' && run.paused) command({ kind: 'pause' });
  if (pauseEnemyRow?.isConnected) pauseEnemyRow.focus({ preventScroll: true });
  else actionButton.focus();
  pauseEnemyRow = undefined;
}

function openSettings(fromPause = false): void {
  settingsOverPause = fromPause;
  pauseForSettings = playing && run.phase === 'battle' && !run.paused;
  if (pauseForSettings) command({ kind: 'pause' });
  show('settings', `<h2 id="dialog-title">设置</h2>
    <label class="toggle"><span>关闭音效</span><input id="mute" type="checkbox" ${settings.muted ? 'checked' : ''}></label>
    <label class="toggle"><span>音效音量</span><input id="volume" type="range" min="0" max="100" step="1" value="${settings.volume}"><output id="volume-value" for="volume">${settings.volume}%</output></label>
    <label class="toggle"><span>动态效果</span><select id="motion">
      ${Object.entries(motionLabels).map(([mode, label]) => `<option value="${mode}" ${settings.motion === mode ? 'selected' : ''}>${label}</option>`).join('')}
    </select></label>
    <div class="toggle"><label for="frame-rate">帧率上限</label><select id="frame-rate" aria-describedby="frame-rate-hint">
      ${frameRates.map(rate => `<option value="${rate}" ${rate === settings.frameRate ? 'selected' : ''}>${rate === 'display' ? '跟随屏幕' : `${rate} FPS`}</option>`).join('')}
    </select></div>
    <p id="frame-rate-hint">实际帧率取决于屏幕刷新率、浏览器和设备性能。</p>
    <label class="toggle"><span>战报附上帧率</span><input id="record-frame-rate" type="checkbox" aria-describedby="frame-record-hint" ${settings.recordFrameRate ? 'checked' : ''}></label>
    <p id="frame-record-hint">开启后，完成的波次会记录实际绘制帧率，可在单波或整局战报中查看。关闭后停止采样并隐藏帧率。</p>
    <button class="quiet" id="test-volume" type="button">试听音效</button>
    <button class="quiet" id="settings-compendium" type="button">图鉴</button>
    <button class="primary" id="close-settings">返回</button>
    <p id="build-version">构建版本 <code>${__NINE_KINGDOMS_BUILD__}</code></p>`);
  const mute = byId<HTMLInputElement>('mute');
  const volume = byId<HTMLInputElement>('volume');
  const preview = byId<HTMLButtonElement>('test-volume');
  const motion = byId<HTMLSelectElement>('motion');
  const frameRate = byId<HTMLSelectElement>('frame-rate');
  const recordFrameRate = byId<HTMLInputElement>('record-frame-rate');
  const updateVolume = () => {
    settings.muted = mute.checked;
    settings.volume = volume.valueAsNumber;
    byId('volume-value').textContent = `${settings.volume}%`;
    preview.disabled = settings.muted || settings.volume === 0;
    saveSettings();
  };
  mute.onchange = updateVolume;
  volume.oninput = updateVolume;
  motion.onchange = () => { settings.motion = motion.value as Motion; saveSettings(); };
  frameRate.onchange = () => {
    if (!isFrameRate(frameRate.value)) return;
    settings.frameRate = frameRate.value;
    saveSettings();
  };
  recordFrameRate.onchange = () => {
    settings.recordFrameRate = recordFrameRate.checked ? true : undefined;
    if (!settings.recordFrameRate) frameSamples.clear();
    saveSettings();
  };
  preview.onclick = () => playSound('upgrade');
  preview.disabled = settings.muted || settings.volume === 0;
  byId('settings-compendium').onclick = openCompendium;
  byId('close-settings').onclick = finishSettings;
}

function finishSettings(): void {
  if (settingsOverPause) {
    settingsOverPause = false;
    pauseMenu();
    byId('pause-settings').focus();
    return;
  }
  if (pauseForSettings) command({ kind: 'pause' });
  pauseForSettings = false;
  if (!playing) menu();
  else {
    close();
    byId('settings').focus();
  }
}

overlay.addEventListener('cancel', event => {
  event.preventDefault();
  if (dialogKind === 'settings') finishSettings();
  else if (dialogKind === 'pause') resumeBattle();
  if (dialogKind === 'shop') closeShop();
  if (dialogKind === 'encounter') closeEncounter();
  if (dialogKind === 'relic') close();
  if (dialogKind === 'refine') closeRefinery();
  if (dialogKind === 'chronicle') menu();
  if (dialogKind === 'progress') { menu(); byId('menu-progress').focus(); }
  if (dialogKind === 'research') closeResearch();
  if (dialogKind === 'remove-placement') closeRemoval();
  if (dialogKind === 'supply') closeSupply();
  if (dialogKind === 'enemy-briefing') close();
});
byId('settings').onclick = () => openSettings();
undoButton.onclick = () => {
  if (command({ kind: 'undo-deployment' }) && undoButton.hidden) actionButton.focus();
};
byId('shop').onclick = openShop;
byId('encounter').onclick = openEncounter;
byId('refine').onclick = () => openRefinery();
byId('research').onclick = openResearch;
byId('supply').onclick = () => openSupply();
const formationSelect = byId<HTMLSelectElement>('formation');
formationSelect.onchange = () => command({ kind: 'formation', value: formationSelect.value as Formation });
actionButton.onclick = () => {
  if (run.phase === 'planning') {
    if (battlefieldStatus === 'failed') window.location.reload();
    if (battlefieldStatus !== 'ready') return;
    if (checkpointStatus === 'unsaved' && !saveRun()) return;
    if (checkpointStatus === 'saved') checkpointStatus = undefined;
    selected = undefined;
    clearTileHints();
    command({ kind: 'start' });
  } else if (run.phase === 'battle') pauseMenu();
  else if (run.phase === 'reward') reward();
  else result();
};

document.addEventListener('keydown', event => {
  if (event.repeat) {
    // Focus may land on another action before the player releases Enter.
    if (event.key === 'Enter' && event.target instanceof HTMLButtonElement) event.preventDefault();
    return;
  }
  if (overlay.open || event.ctrlKey || event.metaKey || event.altKey
    || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === 'Escape' && selected !== undefined) {
    event.preventDefault();
    cancelCardSelection(tileLayer.contains(document.activeElement));
  } else if (event.key === 'Escape' && relocating !== undefined) {
    event.preventDefault();
    cancelRelocation();
  } else if (event.key === 'Escape' && playing && run.phase === 'battle') {
    event.preventDefault();
    pauseMenu();
  }
  if (/^[1-9]$/.test(event.key)) select(Number(event.key) - 1, true);
});

function advance(): GameEvent[] {
  const events: GameEvent[] = [];
  const layout = run.buildings;
  step(run, events);
  presentSimulation(events, run.buildings !== layout);
  return events;
}

function presentSimulation(events: GameEvent[], layoutChanged = true): void {
  sandboxPanel?.record(events);
  playBattleSounds(events);
  const slam = events.some(event => event.kind === 'effect' && event.style === 'boss');
  if (slam || events.some(event => event.kind === 'boss')) {
    const alert = byId('battle-alert');
    alert.textContent = slam ? '断桥元帅发动半血反击' : '断桥元帅已进入战场';
    alert.hidden = false;
  }
  const phaseChanged = events.some(event => event.kind === 'phase');
  if (phaseChanged || layoutChanged || sandboxPanel) update();
  else {
    updateBattleCounters();
    if (battleSelection || inspected) updateInspect();
  }
  if (phaseChanged) {
    byId('battle-alert').hidden = true;
    const samples = frameSamples.summary();
    if (samples.length > maxFrameGroups) samples.sort((a, b) => b.seconds - a.seconds);
    if (samples.length) frameHistory.push({ wave: run.wave, samples: samples.slice(0, maxFrameGroups) });
    frameSamples.clear();
    if (run.phase === 'reward' && saveRun()) reward();
    if (run.phase === 'lost' || run.phase === 'won') {
      playSound(run.phase);
      settleRun();
      result();
    }
  }
}

function rangePreview(): { tile: Point; reach: number } | undefined {
  if (run.phase !== 'planning') return undefined;
  const tile = previewTile() ?? inspected;
  if (!tile) return undefined;
  if (relocating !== undefined) {
    const transfer = checkRelocation(run, relocating, tile);
    if (!transfer.ok || transfer.target.kind !== 'building') return undefined;
    const building = transfer.target.item;
    if (building.def === 'wall' && run.kingdom === 'iron') return { tile, reach: rampartGuard.distance };
    const reach = buildingStats(building).reach;
    return reach ? { tile, reach: reach + watchReach(run, building.def) } : undefined;
  }
  const placed = buildingAt(run.buildings, tile);
  const card = selected === undefined ? undefined : cards.get(run.hand[selected]);
  const id = placed?.def ?? (selected !== undefined && card?.kind === 'building' && checkCard(run, selected, tile).ok ? card.ref : undefined);
  if (id === 'wall' && run.kingdom === 'iron') return { tile, reach: rampartGuard.distance };
  const baseReach = placed ? buildingStats(placed).reach : id ? buildings.get(id)?.reach : undefined;
  const reach = baseReach && id ? baseReach + watchReach(run, id) : baseReach;
  return reach ? { tile, reach } : undefined;
}

if (import.meta.env.DEV) {
  Object.assign(window, { render_game_to_text: () => JSON.stringify(run) });
}
saveSettings();
watchForeground(() => {
  setSoundLevel(settings.volume, settings.muted);
  frameSamples.pause();
});
window.addEventListener('resize', () => {
  viewport = { width: window.innerWidth, height: window.innerHeight };
  frameSamples.pause();
});
void mountBattlefield(byId('field'), () => run, advance, () => settings.motion, () => settings.frameRate,
  rangePreview, approaches, () => {
    if (playing && !isSandbox && settings.recordFrameRate) {
      frameSamples.record(performance.now(), settings.frameRate, settings.motion, viewport.width, viewport.height);
    }
  }, () => {
    battlefieldStatus = 'ready';
    updateBattleAction();
  }).then(present => {
    presentBattleFeedback = present;
  }).catch(() => {
    battlefieldStatus = 'failed';
    updateBattleAction();
  });
update();
if (import.meta.env.DEV && isSandbox && sandboxParameters) {
  const parameters = sandboxParameters;
  void import('./dev/sandbox').then(({ createSandboxRun, mountSandbox }) => {
    enter(createSandboxRun(parameters));
    sandboxPanel = mountSandbox(app.querySelector('main')!, {
      state: () => run,
      refresh: update,
      prepareWave: () => {
        selected = undefined;
        relocating = undefined;
        inspected = undefined;
        clearTileHints();
        byId('battle-alert').hidden = true;
        update();
      },
      pause: () => command({ kind: 'pause' }),
      advance: ticks => {
        if (run.phase !== 'battle' || !run.paused) return;
        const events: GameEvent[] = [];
        run.paused = false;
        for (let index = 0; index < ticks && run.phase === 'battle'; index++) step(run, events);
        run.paused = run.phase === 'battle';
        presentSimulation(events);
        presentBattleFeedback?.(events);
      },
      leave: menu,
    });
  });
} else menu();
