import { describe, expect, it } from 'vitest';
import { createRun, dispatch, step } from '../src/core/game';
import { decodeCheckpoint, encodeCheckpoint } from '../src/core/checkpoint';
import { decodeChronicle, emptyChronicle, finishExpedition, hasCharter, hasKingdom } from '../src/core/chronicle';
import type { Run } from '../src/core/types';
import { cards, divinationCost, map, units } from '../src/data/content';
import { encounterFor, relicIds, relicTradeChoice } from '../src/data/journey';
import { liveTactics } from '../src/systems/deck';
import { production } from '../src/systems/economy';
import { pendingEncounter } from '../src/systems/encounters';
import { tickBattle } from '../src/systems/combat';
import { route, terrain } from '../src/systems/grid';
import { drawRewards, scheduleWave } from '../src/systems/waves';

const act = (run: Run, command: Parameters<typeof dispatch>[1]) => dispatch(run, command, []);
const place = (run: Run, card: string, x: number, y: number) => act(run, { kind: 'play', slot: run.hand.indexOf(card), tile: { x, y } });

describe('expedition journey', () => {
  it('unlocks north and south districts over two waves and validates the entire building footprint', () => {
    const run = createRun(119, 'march');
    const before = encodeCheckpoint(run);
    expect(place(run, 'storehouse', 5, 0)).toEqual({ ok: false, reason: '北岭外营将在第 2 波备战时开放。' });
    expect(place(run, 'guard', 6, 6).ok).toBe(false);
    expect(encodeCheckpoint(run)).toBe(before);
    function claimReward() {
      run.phase = 'reward';
      run.rewards = ['wall'];
      expect(act(run, { kind: 'reward', card: 'wall' }).ok).toBe(true);
    }
    claimReward();
    expect(place(run, 'storehouse', 5, 0).ok).toBe(true);
    expect(place(run, 'guard', 6, 6).ok).toBe(false);
    claimReward();
    claimReward();
    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;
    expect(place(restored, 'guard', 6, 6).ok).toBe(true);
    expect(place(createRun(119), 'watch', 6, 0).ok).toBe(true);
  });

  it('requires a ley site for new altars and preserves earlier placements in compatible checkpoints', () => {
    const run = createRun(119, 'march');
    run.hand.push('altar', 'magetower');
    const before = encodeCheckpoint(run);
    expect(place(run, 'altar', 8, 5).ok).toBe(false);
    expect(place(run, 'altar', 7, 0).ok).toBe(false);
    expect(encodeCheckpoint(run)).toBe(before);
    expect(place(run, 'altar', 8, 4).ok).toBe(true);
    expect(place(run, 'magetower', 8, 5).ok).toBe(true);
    expect(production(run.buildings).mana).toBe(3);
    const legacy = JSON.parse(encodeCheckpoint(run)!);
    legacy.run.buildings[0].tile = { x: 8, y: 0 };
    const restored = decodeCheckpoint(JSON.stringify(legacy))!;
    expect(restored.buildings[0].tile).toEqual({ x: 8, y: 0 });
    expect(production(restored.buildings).mana).toBe(2);
    expect(act(restored, { kind: 'upgrade', id: restored.buildings[0].id }).ok).toBe(true);
  });

  it('fires with the strongest adjacent living altar buff and recalculates after destruction', () => {
    const run = createRun(119, 'march', 'arcane');
    run.wave = 1;
    run.hand.push('altar', 'altar', 'magetower');
    expect(place(run, 'altar', 6, 2).ok).toBe(true);
    expect(place(run, 'altar', 8, 2).ok).toBe(true);
    expect(place(run, 'magetower', 7, 2).ok).toBe(true);
    const [first, second, tower] = run.buildings;
    expect(act(run, { kind: 'upgrade', id: second.id }).ok).toBe(true);
    run.actors.push({ id: 90, def: 'breaker', side: 'enemy', tile: { x: 7, y: 3 }, hp: 23, travel: 0, cooldown: 50 });
    tickBattle(run, []);
    expect(run.shots.at(-1)?.damage).toBe(8);
    second.hp = 0;
    tower.cooldown = 0;
    tickBattle(run, []);
    expect(run.shots.at(-1)?.damage).toBe(7);
    first.hp = 0;
    tower.cooldown = 0;
    tickBattle(run, []);
    expect(run.shots.at(-1)?.damage).toBe(6);
  });

  it('uses seed-selected crossings for actual routes and enemy lineups', () => {
    const varied = createRun(0, 'march');
    const standard = createRun(119, 'march');
    expect(varied.route).toBe('ferry');
    expect(standard.route).toBe('crossing');
    const original = route(map.entry, map.keep, [], false, standard.route)!;
    const detour = route(map.entry, map.keep, [], false, varied.route)!;
    expect(original.find(tile => tile.x === map.riverX)?.y).toBe(2);
    expect(detour.find(tile => tile.x === map.riverX)?.y).not.toBe(2);
    expect(terrain({ x: map.riverX, y: 1 }, varied.route)).toBe('bridge');
    expect(terrain({ x: map.riverX, y: 1 }, standard.route)).toBe('water');
    expect(scheduleWave(0, 'march', varied.route).filter(entry => entry.enemy === 'skirmisher')).toHaveLength(3);
    expect(scheduleWave(0, 'march', standard.route).filter(entry => entry.enemy === 'skirmisher')).toHaveLength(2);
    expect(decodeCheckpoint(encodeCheckpoint(varied)!)).toEqual(varied);
  });

  it('keeps the marshal arrival and staggers the final wave ogres on every route', () => {
    for (const routeId of ['crossing', 'ferry', 'shoal'] as const) {
      const schedule = scheduleWave(5, 'march', routeId);
      const ticks = (enemy: string) => schedule.filter(spawn => spawn.enemy === enemy).map(spawn => spawn.tick);
      expect(schedule).toHaveLength(14);
      expect(ticks('marshal')).toEqual([33]);
      expect(ticks('hexer')).toEqual([76, 89, 102]);
      expect(ticks('ogre')).toEqual([115, 132, 149]);
    }
  });

  it('spends once, persists the relic and applies its real effect to castle damage', () => {
    const run = createRun(119, 'march');
    run.wave = 1;
    expect(pendingEncounter(run)?.id).toBe('gate');
    const oldWood = run.wallet.wood;
    expect(act(run, { kind: 'encounter', choice: 'stone' }).ok).toBe(true);
    expect(run.wallet.wood).toBe(oldWood - 4);
    expect(run.relics).toEqual(['gate-keystone']);
    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;
    expect(act(restored, { kind: 'encounter', choice: 'stone' }).ok).toBe(false);
    expect(restored.wallet.wood).toBe(oldWood - 4);
    expect(restored.relics).toEqual(run.relics);
    expect(pendingEncounter(restored)).toBeUndefined();
    act(restored, { kind: 'start' });
    restored.actors.push({ id: 500, side: 'enemy', def: 'raider', hp: 12, tile: { x: 8, y: 3 }, travel: 0, cooldown: 0 });
    tickBattle(restored, []);
    expect(restored.keepHp).toBe(map.keepHp - 2);
  });

  it('can collect a one-use event card and rejects unaffordable relic payments', () => {
    const run = createRun(1, 'march');
    run.wave = 1;
    run.wallet.mana = 0;
    const snapshot = encodeCheckpoint(run);
    expect(encounterFor('march', 1, 1)?.id).toBe('archive');
    expect(encounterFor('march', 1, 3)?.id).not.toBe('archive');
    expect(act(run, { kind: 'encounter', choice: 'lens' }).ok).toBe(false);
    expect(encodeCheckpoint(run)).toBe(snapshot);
    expect(act(run, { kind: 'encounter', choice: 'supplies' }).ok).toBe(true);
    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;
    expect(restored.hand).toContain('archive-cache');
    expect(cards.get('archive-cache')?.kind).toBe('event');
    expect(act(restored, { kind: 'play', slot: restored.hand.indexOf('archive-cache') }).ok).toBe(true);
    expect(restored.wallet.wood).toBe(18);
    expect(restored.wallet.mana).toBe(1);
    expect(restored.discard).not.toContain('archive-cache');
  });

  it('offers a reproducible second-stop trade outside the two normal relics', () => {
    const variants = new Set<string>();
    for (let seed = 0; seed < 64; seed++) {
      const first = encounterFor('march', seed, 1)!;
      const second = encounterFor('march', seed, 3)!;
      const alternate = second.choices.find(choice => choice.id === relicTradeChoice)!;
      expect(first.choices).toHaveLength(2);
      expect(second.choices).toHaveLength(3);
      expect([...first.choices, ...second.choices.slice(0, 2)].some(choice => choice.relic === alternate.relic)).toBe(false);
      expect(encounterFor('march', seed, 3)).toEqual(second);
      variants.add(alternate.relic!);
    }
    expect(variants).toEqual(new Set(relicIds));
    expect(encounterFor('crowford', 119, 3)).toBeUndefined();
  });

  it('spends the alternate trade once and restores its effect and exclusive choice', () => {
    const seed = Array.from({ length: 64 }, (_, value) => value).find(value =>
      encounterFor('march', value, 3)?.choices.find(choice => choice.id === relicTradeChoice)?.relic === 'muster-banner')!;
    const run = createRun(seed, 'march');
    expect(place(run, 'guard', 7, 3).ok).toBe(true);
    run.wave = 3;
    const event = pendingEncounter(run)!;
    const originalRelic = event.choices[0];
    const trade = { kind: 'encounter', choice: relicTradeChoice } as const;
    run.wallet.food = 2;
    const before = encodeCheckpoint(run);
    expect(act(run, trade).ok).toBe(false);
    expect(encodeCheckpoint(run)).toBe(before);
    run.wallet.food = 7;
    const random = run.random;
    expect(act(run, trade).ok).toBe(true);
    expect(run.wallet.food).toBe(4);
    expect(run.random).toBe(random);
    expect(run.relics).toEqual(['muster-banner']);

    const saved = encodeCheckpoint(run)!;
    const restored = decodeCheckpoint(saved)!;
    expect(restored.relics).toEqual(run.relics);
    expect(pendingEncounter(restored)).toBeUndefined();
    expect(act(restored, { kind: 'encounter', choice: originalRelic.id }).ok).toBe(false);
    expect(act(restored, { kind: 'start' }).ok).toBe(true);
    expect(restored.actors.find(actor => actor.def === 'guard')?.hp).toBe(units.get('guard')!.hp + 3);

    const duplicate = JSON.parse(saved);
    duplicate.run.relics.push(originalRelic.relic);
    expect(decodeCheckpoint(JSON.stringify(duplicate))).toBeUndefined();
  });

  it('charges for one improved copy and remembers a deliberate card removal', () => {
    const run = createRun(119, 'march');
    expect(act(run, { kind: 'refine', action: 'improve', card: 'timber' }).ok).toBe(false);
    run.wave = 1;
    const startGold = run.wallet.gold;
    expect(act(run, { kind: 'refine', action: 'improve', card: 'timber' }).ok).toBe(true);
    expect(act(run, { kind: 'refine', action: 'retire', card: 'trade' }).ok).toBe(true);
    expect(run.wallet.gold).toBe(startGold - 6);
    expect(liveTactics(run).sort()).toEqual(['rations', 'timber-plus']);
    expect(act(run, { kind: 'refine', action: 'retire', card: 'rations' }).ok).toBe(false);
    expect(run.retired).toEqual(['trade']);
    expect(decodeCheckpoint(encodeCheckpoint(run)!)).toEqual(run);
    const fake = JSON.parse(encodeCheckpoint(run)!);
    fake.run.deck.push('timber-plus', 'timber-plus', 'timber-plus');
    expect(decodeCheckpoint(JSON.stringify(fake))).toBeUndefined();
  });

  it('awards merits once per expedition and unlocks a faction and one optional charter', () => {
    let profile = emptyChronicle();
    for (const [index, outcome] of ['won', 'won', 'lost'].entries()) {
      const run = createRun(119, 'march');
      run.chronicleId = String(index).padStart(32, '0');
      run.phase = outcome as 'won' | 'lost';
      const result = finishExpedition(profile, run);
      profile = result.profile;
      expect(finishExpedition(profile, run).gained).toBe(0);
    }
    expect(profile).toMatchObject({ merit: 7, victories: 2, expeditions: 3 });
    expect(decodeChronicle(JSON.stringify(profile))).toEqual(profile);
    expect(hasKingdom(6, 'tide')).toBe(false);
    expect(hasKingdom(profile.merit, 'tide')).toBe(true);
    expect(hasCharter(profile.merit, 'medic')).toBe(true);
    const next = createRun(119, 'march', 'tide', 'medic');
    expect(next.hand).toContain('silver-feather');
    expect(next.hand).toContain('medic');
    expect(decodeCheckpoint(encodeCheckpoint(next)!)).toEqual(next);
  });

  it('lets an unlocked divination charter change one reward at the normal cost', () => {
    expect(hasCharter(8, 'divination')).toBe(false);
    expect(hasCharter(9, 'divination')).toBe(true);
    const run = createRun(119, 'march', 'arcane', 'divination');
    expect(run.hand).toEqual(createRun(119, 'march', 'arcane').hand);
    const divine = { kind: 'divine' } as const;
    expect(act(run, divine).ok).toBe(false);
    expect(place(run, 'watch', 5, 2).ok).toBe(true);
    expect(place(run, 'watch', 5, 4).ok).toBe(true);
    expect(act(run, { kind: 'start' }).ok).toBe(true);
    while (run.phase === 'battle') step(run, []);
    expect(run.phase).toBe('reward');
    const originalOffers = run.rewards;
    const initialMana = run.wallet.mana;
    run.wallet.mana = divinationCost.mana - 1;
    const underfunded = encodeCheckpoint(run);
    expect(act(run, divine).ok).toBe(false);
    expect(encodeCheckpoint(run)).toBe(underfunded);
    run.wallet.mana = initialMana;
    expect(act(run, divine).ok).toBe(true);
    expect(run.wallet.mana).toBe(initialMana - divinationCost.mana);
    expect(run.rewards).toHaveLength(3);
    expect(run.rewards.every(card => !originalOffers.includes(card))).toBe(true);
    expect(run.buildings.every(building => building.def !== 'altar')).toBe(true);

    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;
    expect(restored.charter).toBe('divination');
    expect(restored.divined).toBe(true);
    expect(restored.rewards).toEqual(run.rewards);
    expect(act(restored, { kind: 'reward', card: restored.rewards[0] }).ok).toBe(true);
    restored.hand.push('altar');
    restored.wallet.mana = 10;
    expect(place(restored, 'altar', 6, 2).ok).toBe(true);
    restored.phase = 'reward';
    restored.rewards = drawRewards(restored);
    const spent = encodeCheckpoint(restored);
    expect(act(restored, divine).ok).toBe(false);
    expect(encodeCheckpoint(restored)).toBe(spent);
  });
});
