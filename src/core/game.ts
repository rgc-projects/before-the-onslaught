import { campaigns, kingdoms, map } from '../data/content';
import { routeFor } from '../data/journey';
import { playCard } from '../systems/cards';
import { musterActors, planMuster, restoreFrontline, setSupplyPriority, upgradeBuilding } from '../systems/buildings';
import { tickBattle } from '../systems/combat';
import { deckSeed, discardUnusedTactics, drawTactics, initDeck, refineTactic } from '../systems/deck';
import { relocateDeployment, removeDeployment, undoDeployment } from '../systems/deployments';
import { deposit, production } from '../systems/economy';
import { chooseEncounter } from '../systems/encounters';
import { divineRewards, drawRewards, scheduleWave } from '../systems/waves';
import { buyPermit } from '../systems/shop';
import { commissionResearch } from '../systems/research';
import { charters } from './chronicle';
import { formations } from './types';
import type { CampaignId, CharterId, Command, GameEvent, KingdomId, Result, Run } from './types';

export function createRun(seed: number, campaign: CampaignId = 'crowford', chosen: KingdomId = 'iron', charter: CharterId | null = null): Run {
  const normalized = seed >>> 0;
  const data = campaigns[campaign];
  const kingdom = campaign === 'march' ? chosen : null;
  const run: Run = {
    seed: normalized, random: normalized, campaign, kingdom, phase: 'planning', paused: false, tick: 0, wave: 0,
    wallet: { ...data.start }, keepHp: map.keepHp, hand: [...data.starter], rewards: [], divined: false, shopBought: [],
    route: routeFor(campaign, normalized), resolvedEncounters: [], relics: [],
    chronicleId: null, charter: campaign === 'march' ? charter : null, research: null,
    deckRandom: deckSeed(normalized), deck: [], discard: [], retired: [],
    buildings: [], rally: [], actors: [], shots: [], deployments: [], supplyPriority: null, formation: 'advance',
    waveReport: null, pastWaves: [], schedule: [], spawnIndex: 0, nextId: 1, defeated: 0,
  };
  if (kingdom) run.hand.push(kingdoms[kingdom].signature);
  const charterDefinition = charters.find(item => item.id === run.charter);
  if (charterDefinition?.kind === 'card') run.hand.push(charterDefinition.id);
  initDeck(run);
  drawTactics(run, 2);
  return run;
}

export function dispatch(run: Run, command: Command, events: GameEvent[]): Result {
  if (command.kind === 'play') return playCard(run, command.slot, command.tile, events);
  if (command.kind === 'undo-deployment') return undoDeployment(run, events);
  if (command.kind === 'relocate') return relocateDeployment(run, command.id, command.tile, events);
  if (command.kind === 'remove-deployment') return removeDeployment(run, command.id, events);
  if (command.kind === 'supply-priority') return setSupplyPriority(run, command.id);
  if (command.kind === 'formation') {
    if (run.campaign !== 'march' || run.phase !== 'planning' || !formations.includes(command.value)) {
      return { ok: false, reason: '只能在灰旗远征备战时调整守军阵势。' };
    }
    run.formation = command.value;
    return { ok: true };
  }
  if (command.kind === 'upgrade') return upgradeBuilding(run, command.id, events);
  if (command.kind === 'buy') return buyPermit(run, command.card, events);
  if (command.kind === 'encounter') return chooseEncounter(run, command.choice, events);
  if (command.kind === 'refine') return refineTactic(run, command.card, command.action, events);
  if (command.kind === 'research') return commissionResearch(run, command.topic, events);
  if (command.kind === 'divine') return divineRewards(run, events);
  if (command.kind === 'pause') {
    if (run.phase !== 'battle') return { ok: false, reason: '只有战斗中可以暂停。' };
    run.paused = !run.paused;
  } else if (command.kind === 'reward') {
    if (run.phase !== 'reward' || !run.rewards.includes(command.card)) {
      return { ok: false, reason: '这项战利品当前不可领取。' };
    }
    if (run.waveReport) {
      run.pastWaves.push({
        wave: run.wave, keepHp: run.keepHp, defeated: run.defeated, formation: run.formation, reward: command.card,
        research: run.research, relics: [...run.relics], waveReport: run.waveReport,
        buildings: run.buildings.map(building => ({ ...building, tile: { ...building.tile }, cooldown: 0 })),
        rally: run.rally.map(unit => ({ ...unit, tile: { ...unit.tile } })),
      });
    }
    run.hand.push(command.card);
    run.rewards = [];
    run.waveReport = null;
    run.wave++;
    run.shopBought = [];
    run.phase = 'planning';
    drawTactics(run, 2);
  } else {
    if (run.phase !== 'planning') return { ok: false, reason: '当前无法开始新一波战斗。' };
    run.deployments = [];
    discardUnusedTactics(run);
    deposit(run.wallet, production(run.buildings, run.kingdom, run.route, run.relics, run.research), run.buildings);
    restoreFrontline(run);
    const foodAvailable = run.wallet.food;
    const muster = planMuster(run, foodAvailable);
    run.waveReport = { deployed: muster.fed, blocked: muster.blocked, unfed: muster.unfed, foodAvailable,
      foodSpent: muster.food, foodNeeded: muster.needed, keepStart: run.keepHp, lastKeepHit: null, keepDamage: [] };
    run.actors = musterActors(run, muster);
    run.shots = [];
    run.schedule = scheduleWave(run.wave, run.campaign, run.route);
    run.spawnIndex = 0;
    run.tick = 0;
    for (const building of run.buildings) building.cooldown = 0;
    run.phase = 'battle';
    events.push({ kind: 'resources' });
  }
  events.push({ kind: 'phase' });
  return { ok: true };
}

export function step(run: Run, events: GameEvent[]): void {
  if (run.phase !== 'battle' || run.paused) return;
  const outcome = tickBattle(run, events);
  if (!outcome) return;
  run.shots = [];
  const campaign = campaigns[run.campaign];
  if (outcome === 'lost' || run.wave === campaign.waves.length - 1) {
    run.phase = outcome;
  } else {
    run.phase = 'reward';
    run.rewards = drawRewards(run);
    deposit(run.wallet, campaign.income, run.buildings);
    events.push({ kind: 'resources' });
  }
  events.push({ kind: 'phase' });
}
