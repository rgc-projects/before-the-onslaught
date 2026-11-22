import { createRun } from './game';
import { charters, validChronicleId } from './chronicle';
import { formations, kingdomIds, resources } from './types';
import type { ArchivedWave, Building, CharterId, DeploymentRecord, Formation, KeepDamageSource, KingdomId, Placement, Point, RelicId, ResearchId, RouteId, Run, Wallet, WaveReport } from './types';
import { buildings, campaigns, cards, enemies, kingdoms, map, starterDeck, units } from '../data/content';
import { encounterFor, relicIds, routeFor } from '../data/journey';
import { buildingStats, supplyUnit, upkeepFor } from '../systems/buildings';
import { baseTactic, discardUnusedTactics, drawTactics } from '../systems/deck';
import { capacity } from '../systems/economy';
import { footprint, inBounds, terrain, tileKey } from '../systems/grid';
import { shopStock } from '../systems/shop';
import { topics } from '../systems/research';

const VERSION = 14;
const CONTENT = 'crowford-1';
const MAX_UINT32 = 2 ** 32 - 1;
const stable = (run: Run) => run.phase === 'planning' || run.phase === 'reward';

export function encodeCheckpoint(run: Run): string | undefined {
  if (!stable(run)) return undefined;
  const { seed, random, campaign, kingdom, phase, wave, wallet, keepHp, hand, rewards, divined, shopBought, route, resolvedEncounters, relics, chronicleId, charter, research, deck, discard, retired, deckRandom, buildings: placed, rally, deployments, supplyPriority, formation, waveReport, pastWaves, nextId, defeated } = run;
  return JSON.stringify({
    version: VERSION, content: CONTENT,
    run: { seed, random, campaign, kingdom, phase, wave, wallet, keepHp, hand, rewards, divined, shopBought, route, resolvedEncounters, relics, chronicleId, charter, research, deck, discard, retired, deckRandom, buildings: placed, rally, deployments, supplyPriority, formation, waveReport, pastWaves, nextId, defeated },
  });
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const ids = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 64 && value.every(id => typeof id === 'string' && cards.has(id));
const tactic = (id: string): boolean => cards.get(id)?.kind === 'tactic';

function land(value: unknown): value is Point {
  return object(value) && typeof value.x === 'number' && typeof value.y === 'number'
    && inBounds({ x: value.x, y: value.y }) && value.x > map.riverX && terrain({ x: value.x, y: value.y }) === 'grass';
}

function placement(value: unknown): value is JsonObject & Placement {
  return object(value) && integer(value.id, 1, Number.MAX_SAFE_INTEGER)
    && typeof value.def === 'string' && land(value.tile);
}

function restorePlacements(data: JsonObject, nextId: number, version: number): { buildings: Building[]; rally: Placement[] } | undefined {
  if (!Array.isArray(data.buildings) || !Array.isArray(data.rally)
    || data.buildings.length + data.rally.length > map.width * map.height) return undefined;
  const result: { buildings: Building[]; rally: Placement[] } = { buildings: [], rally: [] };
  const occupied = new Set<number>();
  const usedIds = new Set<number>();
  for (const [group, list] of [['buildings', data.buildings], ['rally', data.rally]] as const) {
    for (const value of list) {
      if (!placement(value) || value.id >= nextId || usedIds.has(value.id)) return undefined;
      const entry = { id: value.id, def: value.def, tile: { x: value.tile.x, y: value.tile.y } };
      const def = group === 'buildings' ? buildings.get(value.def) : undefined;
      const cells = def ? footprint(def, entry.tile) : [entry.tile];
      const keys = cells.map(tileKey);
      if (cells.some(cell => !land(cell)) || keys.some(key => occupied.has(key))) return undefined;
      if (group === 'buildings') {
        const level = version < 3 ? 1 : value.level;
        if (!def || (level !== 1 && level !== 2)) return undefined;
        const maxHp = buildingStats({ ...entry, hp: 1, cooldown: 0, level }).hp;
        if (!integer(value.hp, 1, maxHp)) return undefined;
        result.buildings.push({ ...entry, hp: value.hp, cooldown: 0, level });
      } else {
        if (!units.has(value.def)) return undefined;
        result.rally.push(entry);
      }
      for (const key of keys) occupied.add(key);
      usedIds.add(value.id);
    }
  }
  return result;
}

function restoreDeployments(value: unknown, run: Run): DeploymentRecord[] | undefined {
  if (!Array.isArray(value) || value.length > run.buildings.length + run.rally.length
    || (run.phase !== 'planning' && value.length)) return undefined;
  const history: DeploymentRecord[] = [];
  let previous = 0;
  for (const record of value) {
    if (!object(record) || !integer(record.id, previous + 1, run.nextId - 1)
      || !integer(record.slot, 0, 63) || typeof record.card !== 'string') return undefined;
    const card = cards.get(record.card);
    const placed = card?.kind === 'building'
      ? run.buildings.find(building => building.id === record.id && building.level === 1)?.def
      : card?.kind === 'unit' ? run.rally.find(unit => unit.id === record.id)?.def : undefined;
    if (!card || !placed || card.ref !== placed) return undefined;
    history.push({ id: record.id, slot: record.slot, card: record.card });
    previous = record.id;
  }
  const permits = [...run.hand, ...history.map(record => record.card)];
  if (kingdomIds.some(id => permits.filter(card => card === kingdoms[id].signature).length > (id === run.kingdom ? 1 : 0))) return undefined;
  return history;
}

function restoreKeepDamage(value: unknown, total: number, hit: WaveReport['lastKeepHit']): KeepDamageSource[] | undefined {
  if (!Array.isArray(value) || value.length > enemies.size) return undefined;
  const rows: KeepDamageSource[] = [];
  let sum = 0;
  for (const item of value) {
    if (!object(item) || typeof item.enemy !== 'string' || !enemies.has(item.enemy)
      || rows.some(row => row.enemy === item.enemy)
      || !integer(item.damage, 1, total) || !integer(item.hits, 1, item.damage)) return undefined;
    rows.push({ enemy: item.enemy, damage: item.damage, hits: item.hits });
    sum += item.damage;
  }
  if (sum !== total || (total ? !hit || !rows.some(row => row.enemy === hit.enemy) : hit !== null)) return undefined;
  return rows;
}

function restoreWaveReport(value: unknown, keepHp: number, version: number): WaveReport | null | undefined {
  if (value === null) return null;
  if (!object(value)) return undefined;
  const { deployed, blocked, unfed, foodAvailable, foodSpent, foodNeeded, keepStart, lastKeepHit } = value;
  const cells = map.width * map.height;
  if (!integer(deployed, 0, cells) || !integer(blocked, 0, cells * 4) || !integer(keepStart, keepHp, map.keepHp)
    || !integer(foodAvailable, 0, MAX_UINT32) || !integer(foodSpent, 0, foodAvailable) || !integer(foodNeeded, foodSpent, MAX_UINT32)
    || !Array.isArray(unfed) || deployed + unfed.length > cells || unfed.some(id => typeof id !== 'string' || !units.has(id))) return undefined;
  let hit: WaveReport['lastKeepHit'] = null;
  if (lastKeepHit !== null) {
    if (!object(lastKeepHit) || typeof lastKeepHit.enemy !== 'string' || !enemies.has(lastKeepHit.enemy)
      || !object(lastKeepHit.from) || !integer(lastKeepHit.from.x, 0, map.width - 1) || !integer(lastKeepHit.from.y, 0, map.height - 1)) return undefined;
    hit = { enemy: lastKeepHit.enemy, from: { x: lastKeepHit.from.x, y: lastKeepHit.from.y } };
  }
  let keepDamage: WaveReport['keepDamage'] = null;
  if (version >= 13 && value.keepDamage !== null) {
    const rows = restoreKeepDamage(value.keepDamage, keepStart - keepHp, hit);
    if (!rows) return undefined;
    keepDamage = rows;
  }
  return { deployed, blocked, unfed, foodAvailable, foodSpent, foodNeeded, keepStart, lastKeepHit: hit, keepDamage };
}

function restoreArchivedWaves(value: unknown, run: Run, version: number): ArchivedWave[] {
  if (!Array.isArray(value) || value.length > run.wave) return [];
  const history: ArchivedWave[] = [];
  for (const item of value) {
    const previous = history.at(-1);
    if (!object(item) || !integer(item.wave, (previous?.wave ?? -1) + 1, run.wave - 1)
      || !integer(item.keepHp, 1, map.keepHp) || !integer(item.defeated, previous?.defeated ?? 0, run.defeated)
      || !formations.includes(item.formation as Formation) || (run.campaign !== 'march' && item.formation !== 'advance')
      || typeof item.reward !== 'string' || !cards.has(item.reward)
      || (item.research !== null && item.research !== run.research)
      || !Array.isArray(item.relics) || new Set(item.relics).size !== item.relics.length
      || item.relics.some(id => !run.relics.includes(id))) return [];
    const placed = restorePlacements(item, run.nextId, version);
    const report = restoreWaveReport(item.waveReport, item.keepHp, version);
    if (!placed || !report) return [];
    history.push({ ...placed, wave: item.wave, keepHp: item.keepHp, defeated: item.defeated,
      formation: item.formation as Formation, reward: item.reward, research: item.research as ResearchId | null,
      relics: item.relics as RelicId[], waveReport: report });
  }
  return history;
}

export function decodeCheckpoint(text: string): Run | undefined {
  if (text.length > 65536) return undefined;
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { return undefined; }
  if (!object(envelope) || !integer(envelope.version, 1, VERSION)
    || envelope.content !== CONTENT || !object(envelope.run)) return undefined;
  const data = envelope.run;
  const campaign = envelope.version < 3 ? 'crowford' : data.campaign;
  if (campaign !== 'crowford' && campaign !== 'march') return undefined;
  const faction = envelope.version < 4 ? (campaign === 'march' ? 'iron' : null) : data.kingdom;
  if (campaign === 'crowford' ? faction !== null : !kingdomIds.includes(faction as KingdomId)) return undefined;
  if (envelope.version < 6 && faction === 'tide') return undefined;
  const kingdom = faction as KingdomId | null;
  const waves = campaigns[campaign].waves;
  if (!integer(data.seed, 0, MAX_UINT32) || !integer(data.random, 0, MAX_UINT32)
    || !integer(data.wave, 0, waves.length - 1) || !integer(data.keepHp, 1, map.keepHp)
    || !integer(data.nextId, 1, Number.MAX_SAFE_INTEGER - 1) || !integer(data.defeated, 0, 100000)
    || (data.phase !== 'planning' && data.phase !== 'reward') || !ids(data.hand) || !ids(data.rewards)
    || !object(data.wallet)) return undefined;
  if (data.phase === 'planning' ? data.rewards.length !== 0
    : data.wave >= waves.length - 1 || data.rewards.length !== 3 || new Set(data.rewards).size !== 3) return undefined;
  const hand = data.hand;
  if (kingdomIds.some(id => hand.filter(card => card === kingdoms[id].signature).length > (id === kingdom ? 1 : 0))) {
    return undefined;
  }

  const placed = restorePlacements(data, data.nextId, envelope.version);
  if (!placed) return undefined;
  const limits = capacity(placed.buildings);
  const wallet = {} as Wallet;
  for (const key of resources) {
    const amount = data.wallet[key];
    if (!integer(amount, 0, limits[key])) return undefined;
    wallet[key] = amount;
  }
  const result: Run = {
    ...createRun(data.seed, campaign, kingdom ?? undefined), ...placed, random: data.random, phase: data.phase, wave: data.wave,
    wallet, keepHp: data.keepHp, hand: data.hand, rewards: data.rewards, nextId: data.nextId, defeated: data.defeated,
    route: 'crossing',
  };
  if (envelope.version >= 5) {
    const crossing = data.route;
    if (crossing !== 'crossing' && crossing !== routeFor(campaign, result.seed)) return undefined;
    if (!Array.isArray(data.resolvedEncounters) || new Set(data.resolvedEncounters).size !== data.resolvedEncounters.length
      || data.resolvedEncounters.some(wave => !integer(wave, 0, result.wave) || !encounterFor(campaign, result.seed, wave))) return undefined;
    const resolved = data.resolvedEncounters.map(wave => encounterFor(campaign, result.seed, wave)!);
    const possible = resolved.flatMap(event => event.choices);
    const acquired = data.relics;
    if (!Array.isArray(acquired) || new Set(acquired).size !== acquired.length
      || acquired.some(id => !relicIds.includes(id) || !possible.some(choice => choice.relic === id))) return undefined;
    const eventCards = hand.filter(id => cards.get(id)?.kind === 'event');
    if (eventCards.some(id => !possible.some(choice => choice.card === id))) return undefined;
    if (resolved.some(event => event.choices.filter(choice =>
      acquired.includes(choice.relic) || eventCards.some(card => card === choice.card)).length > 1)) return undefined;
    result.route = crossing as RouteId;
    result.resolvedEncounters = data.resolvedEncounters;
    result.relics = data.relics as RelicId[];
  }
  if (envelope.version >= 6) {
    const id = data.chronicleId;
    const charter = data.charter;
    if (campaign === 'crowford' && (id !== null || charter !== null)) return undefined;
    if (id !== null && !validChronicleId(id)) return undefined;
    if (charter !== null && !charters.some(item => item.id === charter)) return undefined;
    if (!ids(data.retired) || !data.retired.every(tactic)) return undefined;
    result.chronicleId = id;
    result.charter = charter as CharterId | null;
    result.retired = data.retired;
  }
  if (envelope.version >= 7) {
    const topic = data.research;
    if (topic !== null && (campaign !== 'march' || !topics.has(topic as ResearchId))) return undefined;
    result.research = topic as ResearchId | null;
  }
  if (envelope.version >= 8) {
    if (typeof data.divined !== 'boolean' || (data.divined && campaign !== 'march')) return undefined;
    result.divined = data.divined;
  }
  if (envelope.version >= 9) {
    const history = restoreDeployments(data.deployments, result);
    if (!history) return undefined;
    result.deployments = history;
  }
  if (envelope.version >= 10) {
    if (result.phase !== 'reward' && data.waveReport !== null) return undefined;
    const report = restoreWaveReport(data.waveReport, result.keepHp, envelope.version);
    if (report === undefined) return undefined;
    result.waveReport = report;
  }
  if (envelope.version >= 11 && data.supplyPriority !== null) {
    const id = data.supplyPriority;
    if (!integer(id, 1, result.nextId - 1)) return undefined;
    const unit = supplyUnit(result, id);
    if (!unit || upkeepFor(result, unit) === 0) return undefined;
    result.supplyPriority = id;
  }
  if (envelope.version >= 12) {
    const formation = data.formation as Formation;
    if (!formations.includes(formation) || (campaign !== 'march' && formation !== 'advance')) return undefined;
    result.formation = formation;
  }
  if (envelope.version >= 14) result.pastWaves = restoreArchivedWaves(data.pastWaves, result, envelope.version);
  if (envelope.version >= 3) {
    const stock = shopStock(result);
    if (!ids(data.shopBought) || new Set(data.shopBought).size !== data.shopBought.length || data.shopBought.some(id => !stock.includes(id))) return undefined;
    result.shopBought = data.shopBought;
  }
  if (envelope.version === 1) {
    if (result.hand.some(tactic) || result.rewards.some(tactic)) return undefined;
    const deckState = createRun(result.seed);
    for (let wave = 0; wave < result.wave; wave++) {
      discardUnusedTactics(deckState);
      drawTactics(deckState, 2);
    }
    if (result.phase === 'reward') discardUnusedTactics(deckState);
    result.deck = deckState.deck;
    result.discard = deckState.discard;
    result.deckRandom = deckState.deckRandom;
    result.hand.push(...deckState.hand.filter(tactic));
  } else {
    if (!integer(data.deckRandom, 0, MAX_UINT32) || !ids(data.deck) || !ids(data.discard)
      || !data.deck.every(tactic) || !data.discard.every(tactic)) return undefined;
    const handTactics = result.hand.filter(tactic);
    if (result.phase === 'reward' && handTactics.length) return undefined;
    const allTactics = [...data.deck, ...data.discard, ...handTactics];
    const ownership = [...allTactics, ...result.retired].map(baseTactic);
    if (allTactics.length < 2 || ownership.length > starterDeck.length + result.wave
      || starterDeck.some(id => ownership.filter(value => value === id).length < starterDeck.filter(value => value === id).length)) return undefined;
    if ((result.campaign !== 'march' || result.wave < 1)
      && (result.retired.length || allTactics.some(id => baseTactic(id) !== id))) return undefined;
    result.deck = data.deck;
    result.discard = data.discard;
    result.deckRandom = data.deckRandom;
  }
  return result;
}
