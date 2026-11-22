import type { Actor, EffectStyle, GameEvent, Point, Run, Target, WaveReport } from '../core/types';
import { battleLimit, buildings, enemies, kingdomPower, map, rampartGuard, tuning, units } from '../data/content';
import { relicPower } from '../data/journey';
import { arcaneBonus, buildingStats, guardsRampart, reinforcedWatch, watchReach } from './buildings';
import { deposit } from './economy';
import { buildingAt, distance, neighbors, route, routeToKeep, same, terrain, tileKey } from './grid';
import { researchPower } from './research';

export const STEP_MS = 100;
const balance = tuning.combat;
export const formationBoundary = { advance: 0, bank: map.riverX + 1, inner: map.riverX + 3 };
const keepTarget: Target = { kind: 'keep', id: 0 };
export const actorDefinition = (actor: Actor) => actor.stats ?? (actor.side === 'ally' ? units : enemies).get(actor.def)!;
const defFor = actorDefinition;
const actorTarget = (actor: Actor): Target => ({ kind: 'actor', id: actor.id });

export function position(actor: Actor): Point {
  if (!actor.to) return actor.tile;
  return {
    x: actor.tile.x + (actor.to.x - actor.tile.x) * actor.travel,
    y: actor.tile.y + (actor.to.y - actor.tile.y) * actor.travel,
  };
}

function nearestEnemy(run: Run, from: Point, side: Actor['side'], reach = Infinity): Actor | undefined {
  let nearest: Actor | undefined;
  for (const actor of run.actors) {
    if (actor.hp <= 0 || actor.side === side) continue;
    const gap = distance(from, position(actor));
    if (gap <= reach && (!nearest || gap < reach)) {
      nearest = actor;
      reach = gap;
    }
  }
  return nearest;
}

export const maxActorHp = (actor: Actor): number => defFor(actor).hp + (actor.bonusHp ?? 0);

function hurt(run: Run, target: Target, damage: number, hostile: boolean, events: GameEvent[], pierce = false,
  source?: NonNullable<WaveReport['lastKeepHit']>): void {
  if (target.kind === 'keep') {
    const amount = Math.min(run.keepHp, Math.max(1, damage - relicPower(run.relics, 'guard')));
    if (!amount) return;
    run.keepHp -= amount;
    if (run.waveReport && source) {
      run.waveReport.lastKeepHit = source;
      const breakdown = run.waveReport.keepDamage;
      const existing = breakdown?.find(entry => entry.enemy === source.enemy);
      if (existing) {
        existing.damage += amount;
        existing.hits++;
      } else breakdown?.push({ enemy: source.enemy, damage: amount, hits: 1 });
    }
    events.push({ kind: 'hit', at: map.keep, amount, hostile });
    return;
  }
  const actor = target.kind === 'actor' ? run.actors.find(entity => entity.id === target.id) : undefined;
  const victim = actor ?? (target.kind === 'building' ? run.buildings.find(entity => entity.id === target.id) : undefined);
  if (!victim || victim.hp <= 0) return;
  const at = actor ? position(actor) : victim.tile;
  const cover = actor?.side === 'ally' && guardsRampart(run, actor.def, at) ? rampartGuard.armor : 0;
  const armor = actor && !pierce ? defFor(actor).armor + cover : 0;
  const amount = Math.min(victim.hp, Math.max(1, damage - armor));
  victim.hp -= amount;
  events.push({ kind: 'hit', at, amount, hostile });
  if (victim.hp === 0) {
    events.push({ kind: 'death', at });
    if (actor?.side === 'enemy') run.defeated++;
    if (target.kind === 'building' && run.supplyPriority === target.id) run.supplyPriority = null;
  }
}

function riposte(run: Run, attacker: Actor, target: Target, events: GameEvent[]): void {
  if (attacker.side !== 'enemy' || target.kind !== 'actor') return;
  const guard = run.actors.find(actor => actor.id === target.id && actor.hp > 0);
  if (!guard || (guard.riposteAt ?? 0) > run.tick) return;
  const at = position(guard);
  const towards = position(attacker);
  if (!guardsRampart(run, guard.def, at) || distance(at, towards) > defFor(guard).reach) return;
  guard.riposteAt = run.tick + rampartGuard.interval;
  events.push({ kind: 'attack', id: guard.id, at, towards, style: 'heavy' });
  hurt(run, actorTarget(attacker), rampartGuard.damage, false, events);
}

function advance(actor: Actor, next: Point, speed: number): void {
  if (defFor(actor).attack === 'charge') actor.charge = true;
  actor.to = next;
  actor.travel += speed * STEP_MS / 1000;
  if (actor.travel >= 1 - 1e-9) {
    actor.tile = next;
    actor.to = undefined;
    actor.travel = 0;
  }
}

function bolt(run: Run, from: Point, end: Point, target: Target, damage: number, hostile = false, splash?: number, enemy?: string): void {
  const duration = Math.max(1, Math.ceil(distance(from, end) * 1.4));
  run.shots.push({ from, end, target, damage, hostile, splash, ticks: duration, duration, ...(enemy ? { enemy } : {}) });
}

function splashHit(run: Run, center: Point, hostile: boolean, radius: number, damage: number, events: GameEvent[], style: EffectStyle,
  options: { exclude?: number; sourceId?: number } = {}): void {
  events.push({ kind: 'effect', at: center, radius, style, ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }) });
  for (const other of run.actors) {
    if (other.id === options.exclude || other.hp <= 0 || (other.side === 'enemy') === hostile) continue;
    if (distance(center, position(other)) <= radius) hurt(run, actorTarget(other), damage, hostile, events);
  }
}

function tryAid(run: Run, actor: Actor, events: GameEvent[]): boolean {
  const def = defFor(actor);
  if (def.attack === 'hero' && !actor.summoned && actor.hp <= maxActorHp(actor) * balance.hero.healthTrigger) {
    actor.summoned = true;
    events.push({ kind: 'effect', at: position(actor), radius: balance.hero.radius, style: 'heal' });
    for (const friend of run.actors) {
      if (friend.side !== actor.side || friend.hp <= 0 || distance(position(actor), position(friend)) > balance.hero.radius) continue;
      const amount = Math.min(balance.hero.healing, maxActorHp(friend) - friend.hp);
      if (!amount) continue;
      friend.hp += amount;
      events.push({ kind: 'heal', at: position(friend), amount });
    }
  }
  if (def.attack === 'heal') {
    const friend = run.actors.filter(other => other.side === actor.side && other.hp > 0 && other.hp < maxActorHp(other)
      && distance(actor.tile, position(other)) <= def.reach)
      .reduce<Actor | undefined>((lowest, other) => !lowest || other.hp / maxActorHp(other) < lowest.hp / maxActorHp(lowest) ? other : lowest, undefined);
    if (friend && !actor.cooldown) {
      const amount = Math.min(def.damage, maxActorHp(friend) - friend.hp);
      friend.hp += amount;
      const target = position(friend);
      events.push({ kind: 'support', id: actor.id, at: position(actor), towards: target, style: 'heal' },
        { kind: 'heal', at: target, amount });
      actor.cooldown = def.interval;
    }
    return Boolean(friend);
  }
  if (def.attack === 'summon' && !actor.summoned && !actor.cooldown && nearestEnemy(run, actor.tile, actor.side, def.reach)) {
    const cell = neighbors(actor.tile).find(tile => terrain(tile, run.route) === 'grass' && !buildingAt(run.buildings, tile)
      && !run.actors.some(other => other.hp > 0 && (same(other.tile, tile) || (other.to && same(other.to, tile)))));
    if (!cell) return false;
    actor.summoned = true;
    actor.cooldown = def.interval;
    const spiritHp = balance.spiritHealth + Math.max(0, actor.bonusHp ?? 0);
    run.actors.push({ id: run.nextId++, def: 'spear', side: actor.side, tile: cell, hp: spiritHp, bonusHp: spiritHp - units.get('spear')!.hp, travel: 0, cooldown: 0 });
    events.push({ kind: 'support', id: actor.id, at: position(actor), towards: cell, style: 'summon' });
    return true;
  }
  return false;
}

function strike(run: Run, actor: Actor, target: Target, end: Point, events: GameEvent[]): void {
  const def = defFor(actor);
  const hostile = actor.side === 'enemy';
  const keepAttacker = hostile && target.kind === 'keep' ? actor.def : undefined;
  const cavalry = actor.charge && !hostile && def.attack === 'charge' ? kingdomPower(run.kingdom, 'cavalry') : 0;
  const cavalryDamage = cavalry * balance.cavalryDamagePerPower;
  const damage = def.damage + (actor.charge ? balance.chargeBonusDamage : 0)
    + cavalryDamage + (!hostile && actor.def === 'archer' ? kingdomPower(run.kingdom, 'marksman') : 0);
  const style = def.attack === 'ranged' ? 'arrow' : def.attack === 'splash' ? 'arcane'
    : actor.charge || def.attack === 'siege' || def.attack === 'boss' ? 'heavy' : 'melee';
  events.push({ kind: 'attack', id: actor.id, at: actor.tile, towards: end, style });
  actor.charge = false;
  if (def.attack === 'ranged' || def.attack === 'splash') {
    bolt(run, actor.tile, end, target, damage, hostile, def.attack === 'splash' ? balance.spellSplashRadius : undefined, keepAttacker);
  } else {
    hurt(run, target, damage, hostile, events, def.attack === 'pierce', keepAttacker ? { enemy: keepAttacker, from: actor.tile } : undefined);
    if (def.attack === 'siege') splashHit(run, end, hostile, balance.siegeSplashRadius, Math.ceil(damage / 2), events, 'siege', { exclude: target.kind === 'actor' ? target.id : undefined });
    if (cavalry) splashHit(run, end, false, balance.cavalrySplashRadius, cavalryDamage, events, 'charge', { exclude: target.id });
    riposte(run, actor, target, events);
  }
  actor.cooldown = def.interval;
}

function combatTarget(run: Run, actor: Actor, reach: number): Actor | undefined {
  const nearest = nearestEnemy(run, actor.tile, actor.side, reach);
  if (!nearest || run.campaign !== 'march') return nearest;
  if (actor.side === 'ally') {
    const threat = run.actors.find(target => target.side === 'enemy' && target.hp > 0
      && threateningKeep(target) && distance(actor.tile, position(target)) <= reach);
    if (threat) return threat;
  }
  if (actor.def === 'stalker' || actor.def === 'captain') {
    const support = (target: Actor) => ['heal', 'summon', 'splash', 'ranged'].includes(defFor(target).attack ?? '');
    return run.actors.find(target => target.side !== actor.side && target.hp > 0 && support(target)
      && distance(actor.tile, position(target)) <= reach) ?? nearest;
  }
  if (actor.def === 'archer' || actor.def === 'skirmisher') {
    return run.actors.reduce((target, other) => other.side !== actor.side && other.hp > 0
      && other.hp < target.hp && distance(actor.tile, position(other)) <= reach ? other : target, nearest);
  }
  return nearest;
}

function threateningKeep(actor: Actor): boolean {
  return distance(position(actor), map.keep) <= defFor(actor).reach + 0.8;
}

/** Search reachable firing positions, prioritizing enemies close enough to threaten the keep. */
function intercept(run: Run, actor: Actor, reach: number): Point | undefined {
  const enemies = run.actors.filter(other => other.side === 'enemy' && other.hp > 0);
  if (!enemies.length) return undefined;
  const close = enemies.filter(threateningKeep).map(position);
  const targets = enemies.map(position);
  const boundary = formationBoundary[run.formation];
  const visited = new Set([tileKey(actor.tile)]);
  const open = [{ tile: actor.tile, first: undefined as Point | undefined }];
  let fallback: Point | undefined;
  for (let index = 0; index < open.length; index++) {
    const { tile, first } = open[index];
    if (first && close.some(target => distance(tile, target) <= reach)) return first;
    if (first && !fallback && targets.some(target => distance(tile, target) <= reach)) {
      if (!close.length) return first;
      fallback = first;
    }
    for (const next of neighbors(tile)) {
      const key = tileKey(next);
      const ground = terrain(next, run.route);
      if (next.x < boundary || visited.has(key) || ground === 'keep' || ground === 'rock' || ground === 'water'
        || buildings.get(buildingAt(run.buildings, next)?.def ?? '')?.block) continue;
      visited.add(key);
      open.push({ tile: next, first: first ?? next });
    }
  }
  return fallback;
}

const keepRoutes = new WeakMap<Run, { layout: string; next: Map<number, Point | undefined> }>();

function nextKeepSteps(run: Run): Map<number, Point | undefined> {
  // Breach costs depend on durability, so even a wall that survived a hit can change the next route.
  const layout = [run.route, ...run.buildings.map(({ def, tile, hp }) => `${def}:${tile.x},${tile.y}:${hp}`)].join('|');
  const cached = keepRoutes.get(run);
  if (cached?.layout === layout) return cached.next;
  const next = new Map<number, Point | undefined>();
  keepRoutes.set(run, { layout, next });
  return next;
}

export function tickBattle(run: Run, events: GameEvent[]): 'won' | 'lost' | undefined {
  run.tick++;
  while (run.schedule[run.spawnIndex]?.tick === run.tick) {
    const spawn = run.schedule[run.spawnIndex++];
    const def = enemies.get(spawn.enemy)!;
    run.actors.push({ id: run.nextId++, tile: map.entry, def: def.id, side: 'enemy', hp: def.hp, travel: 0, cooldown: 0 });
    if (def.attack === 'boss') events.push({ kind: 'boss', at: map.entry });
  }

  for (const shot of run.shots) {
    shot.ticks--;
    if (shot.ticks) continue;
    const target = shot.target.kind === 'actor' ? run.actors.find(actor => actor.id === shot.target.id && actor.hp > 0) : undefined;
    hurt(run, shot.target, shot.damage, !!shot.hostile, events, false, shot.enemy ? { enemy: shot.enemy, from: shot.from } : undefined);
    if (shot.splash) splashHit(run, target ? position(target) : shot.end, !!shot.hostile, shot.splash, Math.ceil(shot.damage / 2), events, 'arcane', { exclude: target?.id });
  }
  run.shots = run.shots.filter(shot => shot.ticks > 0);

  for (const structure of run.buildings) {
    const def = buildings.get(structure.def)!;
    const stats = buildingStats(structure);
    const reach = stats.reach + watchReach(run, def.id);
    if (structure.hp <= 0 || !stats.damage) continue;
    structure.cooldown = Math.max(0, structure.cooldown - 1);
    const target = (def.id === 'bombard' ? run.actors.filter(actor => actor.side === 'enemy' && actor.hp > 0 && distance(structure.tile, position(actor)) <= reach)
      .sort((a, b) => defFor(b).armor - defFor(a).armor || distance(structure.tile, position(a)) - distance(structure.tile, position(b)))[0] : undefined)
      ?? nearestEnemy(run, structure.tile, 'ally', reach);
    if (!target || structure.cooldown) continue;
    const damage = stats.damage + arcaneBonus(run, structure);
    const towards = position(target);
    const style = def.art === 'arcane' ? 'arcane' : def.id === 'bombard' ? 'heavy' : 'arrow';
    events.push({ kind: 'attack', id: structure.id, at: structure.tile, towards, style });
    bolt(run, structure.tile, towards, actorTarget(target), damage, false, def.splash);
    structure.cooldown = Math.max(1, def.interval - reinforcedWatch(run, structure));
  }

  const nextSteps = new Map<number, Point | undefined>();
  let cachedSteps: Map<number, Point | undefined> | undefined;
  for (const actor of run.actors) {
    if (actor.hp <= 0 || !run.keepHp) continue;
    const def = defFor(actor);
    actor.cooldown = Math.max(0, actor.cooldown - 1);
    if (def.attack === 'boss' && !actor.summoned && actor.hp <= maxActorHp(actor) * balance.marshal.healthTrigger) {
      actor.summoned = true;
      splashHit(run, position(actor), true, balance.marshal.radius, balance.marshal.damage, events, 'boss', { sourceId: actor.id });
      actor.charge = true;
    }
    if (actor.to) {
      advance(actor, actor.to, def.speed);
      continue;
    }

    if (tryAid(run, actor, events)) continue;
    const reach = def.reach + (actor.side === 'ally' && actor.def === 'archer' ? researchPower(run.research, 'fletching') : 0);
    const opponent = combatTarget(run, actor, reach);
    if (opponent) {
      if (!actor.cooldown && def.attack !== 'heal') strike(run, actor, actorTarget(opponent), position(opponent), events);
      continue;
    }
    if (actor.side === 'ally') {
      if (run.campaign === 'march') {
        if (run.spawnIndex < run.schedule.length && guardsRampart(run, actor.def, actor.tile)
          && !run.actors.some(target => target.side === 'enemy' && target.hp > 0 && threateningKeep(target))) continue;
        const next = intercept(run, actor, reach);
        if (next) advance(actor, next, def.speed);
        continue;
      }
      const target = nearestEnemy(run, actor.tile, 'ally');
      if (!target) continue;
      const next = route(actor.tile, target.tile, run.buildings, false, run.route)?.[0];
      if (next && !same(next, map.keep)) advance(actor, next, def.speed);
      continue;
    }

    if (distance(actor.tile, map.keep) <= def.reach) {
      if (!actor.cooldown) {
        strike(run, actor, keepTarget, map.keep, events);
      }
      continue;
    }
    const key = tileKey(actor.tile);
    if (!nextSteps.has(key)) {
      const shared = cachedSteps ??= nextKeepSteps(run);
      if (!shared.has(key)) shared.set(key, routeToKeep(actor.tile, run.buildings, run.route)?.[0]);
      nextSteps.set(key, shared.get(key));
    }
    const next = nextSteps.get(key);
    if (!next) continue;
    const obstacle = buildingAt(run.buildings, next);
    if (obstacle && buildings.get(obstacle.def)!.block) {
      if (!actor.cooldown) {
        const before = obstacle.hp;
        strike(run, actor, { kind: 'building', id: obstacle.id }, next, events);
        if (obstacle.hp !== before) cachedSteps = undefined;
        if (!obstacle.hp) nextSteps.clear();
      }
    } else {
      advance(actor, next, def.speed);
    }
  }

  run.actors = run.actors.filter(actor => actor.hp > 0);
  if (run.buildings.some(building => building.hp <= 0)) {
    run.buildings = run.buildings.filter(building => building.hp > 0);
    deposit(run.wallet, {}, run.buildings);
  }
  if (run.keepHp <= 0) return 'lost';
  if (run.spawnIndex === run.schedule.length && !run.actors.some(actor => actor.side === 'enemy')) {
    return run.shots.some(shot => shot.hostile) ? undefined : 'won';
  }
  if (run.tick >= battleLimit) return 'lost';
  return undefined;
}

