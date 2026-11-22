import { describe, expect, it } from 'vitest';
import { createRun, dispatch, step } from '../src/core/game';
import { decodeCheckpoint, encodeCheckpoint } from '../src/core/checkpoint';
import type { GameEvent, Point, Run } from '../src/core/types';
import { buildings, campaigns, cards, enemies, units } from '../src/data/content';
import { buildingStats, planMuster, upgradeCost, upkeepFor } from '../src/systems/buildings';
import { buildingProduction, capacity, production } from '../src/systems/economy';
import { tickBattle } from '../src/systems/combat';
import { buildingAt, same } from '../src/systems/grid';
import { rotatingShopStock, shopStock } from '../src/systems/shop';

function place(run: Run, id: string, tile: Point) {
  return dispatch(run, { kind: 'play', slot: run.hand.indexOf(id), tile }, []);
}
const tile = (x: number, y: number) => ({ x, y });

describe('远征经济与成长', () => {
  it('has reachable permits for each functional building and distinct unit and enemy rosters', () => {
    expect(buildings.size).toBe(16);
    expect(units.size).toBeGreaterThanOrEqual(10);
    expect(enemies.size).toBe(8);
    const offers = new Set(campaigns.march.starter);
    for (let wave = 0; wave < campaigns.march.waves.length; wave++) {
      const run = createRun(119, 'march');
      run.wave = wave;
      for (const id of shopStock(run)) offers.add(id);
    }
    for (const def of buildings.values()) expect(offers).toContain(def.id);
    for (const def of units.values()) {
      const source = [...buildings.values()].find(building => building.recruits === def.id)?.id ?? def.id;
      expect(offers).toContain(source);
    }
  });

  it('occupies both warehouse tiles, upgrades capacity and restores the checkpoint intact', () => {
    const run = createRun(119, 'march');
    expect(place(run, 'storehouse', tile(10, 2)).ok).toBe(false);
    expect(place(run, 'storehouse', tile(5, 1)).ok).toBe(true);
    const warehouse = buildingAt(run.buildings, tile(6, 1))!;
    expect(warehouse.def).toBe('storehouse');
    expect(place(run, 'watch', tile(6, 1)).ok).toBe(false);
    expect(capacity(run.buildings).gold).toBe(33);
    expect(dispatch(run, { kind: 'upgrade', id: warehouse.id }, []).ok).toBe(true);
    expect(buildingStats(warehouse).hp).toBe(27);
    expect(capacity(run.buildings).gold).toBe(36);
    const saved = encodeCheckpoint(run)!;
    expect(decodeCheckpoint(saved)).toEqual(run);
    expect(dispatch(run, { kind: 'upgrade', id: warehouse.id }, []).ok).toBe(false);
  });

  it('predicts income and recruits using the same military upkeep as battle', () => {
    const run = createRun(119, 'march');
    expect(place(run, 'farm', tile(4, 1)).ok).toBe(true);
    expect(place(run, 'mine', tile(5, 1)).ok).toBe(true);
    expect(place(run, 'barracks', tile(5, 2)).ok).toBe(true);
    expect(place(run, 'bowcamp', tile(6, 2)).ok).toBe(true);
    expect(place(run, 'guard', tile(6, 3)).ok).toBe(true);
    expect(production(run.buildings)).toEqual({ gold: 5, food: 3, wood: 0, mana: 0 });
    expect(planMuster(run, 1)).toMatchObject({ fed: 1, ready: 4, food: 1, needed: 4 });
    const before = run.wallet.food;
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    expect(run.wallet.food).toBe(before - 1);
    expect(run.actors.map(actor => actor.def)).toEqual(['guard', 'spear', 'archer', 'archer']);
    expect(run.actors.every(actor => !buildingAt(run.buildings, actor.tile))).toBe(true);
  });

  it('distinguishes a blocked deployment slot from lack of food', () => {
    const run = createRun(119, 'march');
    expect(place(run, 'barracks', tile(7, 3)).ok).toBe(true);
    expect(place(run, 'wall', tile(8, 3)).ok).toBe(true);
    expect(place(run, 'bowcamp', tile(7, 4)).ok).toBe(true);
    expect(place(run, 'guard', tile(6, 3)).ok).toBe(true);
    const id = run.buildings[0].id;
    const muster = planMuster(run, 0);
    expect(muster.deployments.get(id)).toEqual({ limit: 2, cells: [tile(7, 2)] });
    expect(muster).toMatchObject({ blocked: 1, fed: 0, ready: 4, needed: 4 });
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    expect(run.actors.find(actor => actor.def === 'spear')?.tile).toEqual(tile(7, 2));
  });

  it('charges once per offer and keeps upgrade and purchase state across reloads', () => {
    const run = createRun(119, 'march');
    const [id] = shopStock(run);
    expect(dispatch(run, { kind: 'buy', card: id }, []).ok).toBe(true);
    expect(run.hand.at(-1)).toBe(id);
    const saved = encodeCheckpoint(run)!;
    expect(dispatch(run, { kind: 'buy', card: id }, []).ok).toBe(false);
    expect(encodeCheckpoint(run)).toBe(saved);
    expect(decodeCheckpoint(saved)).toEqual(run);
  });

  it('stocks one farm permit from wave three and charges separately for purchase and deployment', () => {
    const run = createRun(119, 'march');
    const buyFarm = (state: Run) => dispatch(state, { kind: 'buy', card: 'farm' }, []);
    expect(place(run, 'farm', tile(4, 1)).ok).toBe(true);
    run.wave = 1;
    expect(buyFarm(run).ok).toBe(false);
    run.wave = 2;
    expect(shopStock(run)).toEqual([...rotatingShopStock(run), 'farm']);
    const gold = run.wallet.gold;
    expect(buyFarm(run).ok).toBe(true);
    expect(run.wallet.gold).toBe(gold - 2);
    const restored = decodeCheckpoint(encodeCheckpoint(run)!)!;
    expect(buyFarm(restored).ok).toBe(false);
    expect(restored).toEqual(run);
    expect(place(restored, 'farm', tile(4, 3)).ok).toBe(true);
    expect(restored.wallet.gold).toBe(gold - 4);
    expect(production(restored.buildings).food).toBe(6);
    expect(shopStock(createRun(119))).toEqual([]);
  });

  it('persists the formation and uses the advance default for v11 saves', () => {
    const run = createRun(119, 'march');
    expect(dispatch(run, { kind: 'formation', value: 'inner' }, []).ok).toBe(true);
    const checkpoint = encodeCheckpoint(run)!;
    expect(decodeCheckpoint(checkpoint)?.formation).toBe('inner');
    const old = JSON.parse(checkpoint);
    old.version = 11;
    delete old.run.formation;
    expect(decodeCheckpoint(JSON.stringify(old))?.formation).toBe('advance');
    expect(dispatch(createRun(119), { kind: 'formation', value: 'bank' }, []).ok).toBe(false);
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    expect(dispatch(run, { kind: 'formation', value: 'bank' }, []).ok).toBe(false);
    expect(run.formation).toBe('inner');
  });

  it.each([['bank', 4], ['inner', 6]] as const)(
    'keeps %s melee movement east of the line while ranged attacks can cross it',
    (formation, x) => {
      const battle = (stance: typeof formation | 'advance') => {
        const run = createRun(119, 'march');
        expect(dispatch(run, { kind: 'formation', value: stance }, []).ok).toBe(true);
        expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
        run.schedule = [];
        const guard = { id: 61, def: 'guard', side: 'ally' as const, hp: 21, travel: 0, cooldown: 0, tile: tile(x, 2) };
        run.actors = [guard,
          { id: 62, def: 'archer', side: 'ally', hp: 14, travel: 0, cooldown: 0, tile: tile(x, 3) },
          { id: 63, def: 'raider', side: 'enemy', hp: 13, travel: 0, cooldown: 500, tile: tile(x - 2, 2) },
        ];
        tickBattle(run, []);
        return { guard: run.actors[0], shots: run.shots };
      };
      expect(battle('advance').guard.to).toEqual(tile(x - 1, 2));
      const defensive = battle(formation);
      expect(defensive.guard.to).toBeUndefined();
      expect(defensive.shots).toHaveLength(1);
      expect(defensive.shots[0].target).toEqual({ kind: 'actor', id: 63 });
    },
  );

  it('combines market adjacency, research discounts and shrine health with distinct placements', () => {
    const run = createRun(77, 'march');
    run.hand.push('market', 'lab', 'shrine');
    expect(place(run, 'farm', tile(4, 1)).ok).toBe(true);
    expect(place(run, 'market', tile(5, 1)).ok).toBe(true);
    expect(place(run, 'mine', tile(6, 1)).ok).toBe(true);
    expect(production(run.buildings).gold).toBe(8);
    expect(place(run, 'lab', tile(6, 2)).ok).toBe(true);
    const market = buildingAt(run.buildings, tile(5, 1))!;
    expect(upgradeCost(run, market).gold).toBe(4);
    expect(place(run, 'shrine', tile(7, 2)).ok).toBe(true);
    expect(planMuster(run, 3).vitality).toBe(4);
  });

  it('attributes riverside and adjacency income to the buildings that contribute it', () => {
    const run = createRun(119, 'march', 'wild');
    run.hand.push('market');
    expect(place(run, 'farm', tile(4, 1)).ok).toBe(true);
    expect(place(run, 'market', tile(5, 1)).ok).toBe(true);
    expect(place(run, 'mine', tile(6, 1)).ok).toBe(true);
    expect(place(run, 'storehouse', tile(5, 2)).ok).toBe(true);
    const [farm, market, , warehouse] = run.buildings;
    expect(buildingProduction(farm, run.buildings, run.kingdom, run.route)).toEqual({ gold: 2, food: 5 });
    expect(buildingProduction(market, run.buildings, run.kingdom, run.route)).toEqual({ gold: 4 });
    expect(production(run.buildings, run.kingdom, run.route)).toEqual({ gold: 9, food: 5, wood: 0, mana: 0 });

    warehouse.hp = 0;
    expect(buildingProduction(market, run.buildings, run.kingdom, run.route)).toEqual({ gold: 3 });
    market.hp = 0;
    expect(buildingProduction(market, run.buildings, run.kingdom, run.route)).toEqual({});
    expect(production(run.buildings, run.kingdom, run.route)).toEqual({ gold: 5, food: 5, wood: 0, mana: 0 });
  });

  it('trades sustained food efficiency for armor, reach or higher burst according to the unit role', () => {
    const attack = (unit: string, x: number) => {
      const run = createRun(119, 'march', 'wild');
      run.hand.push(unit);
      const before = { ...run.wallet };
      expect(place(run, unit, tile(x, 3)).ok).toBe(true);
      expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
      run.schedule = [];
      const target = { id: 70, def: 'captain', side: 'enemy' as const, tile: tile(7, 3), hp: 26, travel: 0, cooldown: 50 };
      run.actors.push(target);
      tickBattle(run, []);
      return { gold: before.gold - run.wallet.gold, food: upkeepFor(run, unit), damage: 26 - target.hp, shots: run.shots.length };
    };
    expect(attack('spear', 6)).toEqual({ gold: 2, food: 1, damage: 4, shots: 0 });
    expect(attack('sentinel', 6)).toEqual({ gold: 4, food: 2, damage: 3, shots: 0 });
    expect(attack('archer', 4)).toEqual({ gold: 3, food: 1, damage: 0, shots: 1 });
    expect(units.get('sentinel')).toMatchObject({ hp: 33, armor: 2 });
    expect(units.get('spear')).toMatchObject({ hp: 17, armor: 0 });
  });

  it('lets a spearman intercept a diagonal rider from the eastern defense line', () => {
    const run = createRun(119, 'march');
    run.hand.push('spear');
    expect(place(run, 'spear', tile(6, 3)).ok).toBe(true);
    expect(dispatch(run, { kind: 'formation', value: 'inner' }, []).ok).toBe(true);
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    run.schedule = [];
    const spearman = run.actors.find(actor => actor.def === 'spear')!;
    const rider = { id: 70, def: 'rider', side: 'enemy' as const, tile: tile(5, 2), hp: 17, travel: 0, cooldown: 50 };
    run.actors.push(rider);
    const events: GameEvent[] = [];
    tickBattle(run, events);
    expect(rider.hp).toBe(13);
    expect(spearman.to).toBeUndefined();
    expect(events).toContainEqual({ kind: 'attack', id: spearman.id, at: tile(6, 3), towards: tile(5, 2), style: 'melee' });
  });

  it('exchanges immediate defense for repeatable farm income and better muster coverage', () => {
    const military = createRun(119, 'march', 'wild');
    expect(place(military, 'guard', tile(6, 3)).ok).toBe(true);
    const economy = createRun(119, 'march', 'wild');
    expect(place(economy, 'farm', tile(4, 1)).ok).toBe(true);
    expect(military.wallet.gold).toBe(economy.wallet.gold);
    expect(planMuster(military, 8).fed).toBe(1);
    expect(planMuster(economy, 8).fed).toBe(0);
    expect(production(economy.buildings, 'wild')).toEqual({ gold: 2, food: 5, wood: 0, mana: 0 });
    for (const run of [military, economy]) {
      expect(place(run, 'barracks', tile(6, 2)).ok).toBe(true);
      expect(place(run, 'bowcamp', tile(7, 2)).ok).toBe(true);
      run.wallet.food = 2;
      expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    }
    expect(military.actors.map(actor => actor.def)).toEqual(['guard', 'spear']);
    expect(economy.actors.map(actor => actor.def)).toEqual(['spear', 'archer', 'archer']);
    expect(economy.wallet.food).toBe(4);
  });

  it('lands arcane projectiles on the target and a nearby enemy without hitting allies', () => {
    const run = createRun(119, 'march');
    run.hand.push('arcanetower');
    expect(place(run, 'arcanetower', tile(7, 3)).ok).toBe(true);
    run.actors = [
      { id: 70, def: 'breaker', side: 'enemy', tile: tile(8, 3), hp: 23, travel: 0, cooldown: 500 },
      { id: 71, def: 'breaker', side: 'enemy', tile: tile(8, 3), hp: 23, travel: 0, cooldown: 500 },
      { id: 72, def: 'guard', side: 'ally', tile: tile(8, 3), hp: 21, travel: 0, cooldown: 500 },
    ];
    tickBattle(run, []);
    expect(run.shots).toHaveLength(1);
    tickBattle(run, []);
    const events: GameEvent[] = [];
    tickBattle(run, events);
    expect(run.actors.map(actor => actor.hp)).toEqual([19, 21, 21]);
    expect(events.filter(event => event.kind === 'hit')).toHaveLength(2);
  });

  it('combines a temple, summoner and medic without duplicating summons or exceeding maximum health', () => {
    const run = createRun(119, 'march', 'wild');
    run.hand.push('shrine', 'summoner', 'medic');
    run.wallet.mana = capacity(run.buildings).mana;
    expect(place(run, 'shrine', tile(9, 4)).ok).toBe(true);
    expect(place(run, 'summoner', tile(7, 3)).ok).toBe(true);
    expect(place(run, 'medic', tile(8, 3)).ok).toBe(true);
    expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
    run.schedule = [];
    const summoner = run.actors.find(actor => actor.def === 'summoner')!;
    const medic = run.actors.find(actor => actor.def === 'medic')!;
    expect(summoner.hp).toBe(20);
    summoner.hp -= 2;
    run.actors.push({ id: 70, def: 'breaker', side: 'enemy', tile: tile(5, 3), hp: 23, travel: 0, cooldown: 50 });

    const events: GameEvent[] = [];
    tickBattle(run, events);
    expect(summoner.hp).toBe(20);
    expect(events).toContainEqual({ kind: 'heal', at: tile(7, 3), amount: 2 });
    expect(events).toContainEqual({ kind: 'support', id: medic.id, at: tile(8, 3), towards: tile(7, 3), style: 'heal' });
    const spirit = run.actors.find(actor => actor.def === 'spear')!;
    expect(spirit.hp).toBe(13);
    expect(events).toContainEqual({ kind: 'support', id: summoner.id, at: tile(7, 3), towards: spirit.tile, style: 'summon' });
    for (let tick = 0; tick < 15; tick++) tickBattle(run, events);
    expect(run.nextId).toBe(spirit.id + 1);
    expect(events.filter(event => event.kind === 'support' && event.style === 'summon')).toHaveLength(1);
    expect(events.filter(event => event.kind === 'support' && event.style === 'heal')).toHaveLength(1);
  });

  it('moves toward a reachable enemy when the closer enemy is across blocked bridges', () => {
    const run = createRun(119, 'march');
    run.hand.push('wall');
    expect(place(run, 'wall', tile(4, 2)).ok).toBe(true);
    expect(place(run, 'wall', tile(4, 4)).ok).toBe(true);
    run.actors = [
      { id: 70, def: 'guard', side: 'ally', tile: tile(6, 2), hp: 21, travel: 0, cooldown: 0 },
      { id: 71, def: 'raider', side: 'enemy', tile: tile(3, 2), hp: 12, travel: 0, cooldown: 0 },
      { id: 72, def: 'raider', side: 'enemy', tile: tile(6, 6), hp: 12, travel: 0, cooldown: 0 },
    ];
    tickBattle(run, []);
    expect(run.actors[0].to).toEqual(tile(6, 3));
  });

  it('rechecks the breach route after a wall weakens or opens a crossing', () => {
    const run = createRun(119, 'march');
    run.hand.push('wall');
    expect(place(run, 'wall', tile(4, 2)).ok).toBe(true);
    expect(place(run, 'wall', tile(4, 4)).ok).toBe(true);
    const [north, south] = run.buildings;
    const next = () => {
      run.actors = [{ id: 70, def: 'raider', side: 'enemy', tile: tile(2, 3), hp: 12, travel: 0, cooldown: 0 }];
      tickBattle(run, []);
      return run.actors[0].to;
    };
    north.hp = 8;
    expect(next()).toEqual(tile(2, 2));
    south.hp = 2;
    expect(next()).toEqual(tile(2, 4));
    south.hp = 10;
    expect(next()).toEqual(tile(2, 2));
    run.actors = [
      { id: 71, def: 'ogre', side: 'enemy', tile: tile(3, 4), hp: 38, travel: 0, cooldown: 0 },
      { ...run.actors[0], to: undefined, travel: 0 },
    ];
    tickBattle(run, []);
    expect(south.hp).toBe(3);
    expect(run.actors[1].to).toEqual(tile(2, 4));
    north.hp = 0;
    expect(next()).toEqual(tile(2, 2));
  });

  it('shoots the enemy threatening the keep ahead of a closer enemy', () => {
    const run = createRun(119, 'march');
    run.actors = [
      { id: 70, def: 'archer', side: 'ally', tile: tile(7, 3), hp: 12, travel: 0, cooldown: 0 },
      { id: 71, def: 'raider', side: 'enemy', tile: tile(6, 3), hp: 12, travel: 0, cooldown: 0 },
      { id: 72, def: 'raider', side: 'enemy', tile: tile(9, 2), hp: 12, travel: 0, cooldown: 0 },
    ];
    tickBattle(run, []);
    expect(run.shots[0]?.target).toEqual({ kind: 'actor', id: 72 });
  });

  it('emits a single arrival cue and a single half-health pulse for the marshal', () => {
    const run = createRun(119, 'march');
    run.schedule = [{ tick: 1, enemy: 'marshal' }];
    const events: GameEvent[] = [];
    tickBattle(run, events);
    expect(events.filter(event => event.kind === 'boss')).toEqual([{ kind: 'boss', at: { x: 0, y: 3 } }]);
    const boss = run.actors[0];
    boss.hp = enemies.get('marshal')!.hp / 2;
    boss.cooldown = 50;
    const ally = { id: 90, def: 'guard', side: 'ally' as const, tile: tile(2, 3), hp: 21, travel: 0, cooldown: 50 };
    run.actors.push(ally);
    tickBattle(run, events);
    tickBattle(run, events);
    expect(ally.hp).toBe(17);
    const slams = events.filter(event => event.kind === 'effect' && event.style === 'boss');
    expect(slams).toHaveLength(1);
    expect(slams[0]).toMatchObject({ sourceId: boss.id, radius: 2.4 });
    expect(events.filter(event => event.kind === 'boss')).toHaveLength(1);
  });

  it('finishes six waves with a deterministic legal opening and continuous upgrades', () => {
    const run = createRun(119, 'march');
    for (const [id, x, y] of [
      ['watch', 5, 2], ['watch', 5, 4], ['farm', 4, 1], ['mine', 5, 1], ['barracks', 6, 3], ['bowcamp', 7, 3],
    ] as const) expect(place(run, id, tile(x, y)).ok).toBe(true);
    const history: { wave: number; hp: number; defeated: number; phase: string; offers: string[]; stock: string[] }[] = [];
    for (let index = 0; index < campaigns.march.waves.length; index++) {
      if (index === 1) {
        for (const tower of run.buildings.filter(item => item.def === 'watch')) dispatch(run, { kind: 'upgrade', id: tower.id }, []);
      }
      if (index > 0 && run.keepHp < 24 && run.hand.includes('ember')) {
        expect(dispatch(run, { kind: 'play', slot: run.hand.indexOf('ember') }, []).ok).toBe(true);
      }
      if (index > 0) {
        for (const [id, x, y] of [
          ['arcanetower', 7, 2], ['magetower', 8, 2], ['bombard', 8, 4], ['sentinel', 7, 4],
          ['shrine', 7, 1], ['hall', 8, 5], ['wall', 4, 4], ['stable', 6, 5], ['watch', 6, 4],
        ] as const) {
          const spot = tile(x, y);
          if (buildingAt(run.buildings, spot) || run.rally.some(item => same(item.tile, spot))) continue;
          if (!run.hand.includes(id) && shopStock(run).includes(id)) dispatch(run, { kind: 'buy', card: id }, []);
          if (run.hand.includes(id)) place(run, id, spot);
        }
      }
      expect(dispatch(run, { kind: 'start' }, []).ok).toBe(true);
      const events: GameEvent[] = [];
      let hasCommander = false;
      while (run.phase === 'battle') {
        step(run, events);
        hasCommander ||= run.actors.some(actor => actor.def === 'marshal');
      }
      history.push({ wave: run.wave + 1, hp: run.keepHp, defeated: run.defeated, phase: run.phase, offers: [...run.rewards], stock: shopStock(run) });
      if (run.phase === 'won') expect(hasCommander).toBe(true);
      if (run.phase !== 'reward') break;
      const pick = ['arcanetower', 'magetower', 'bombard', 'watch', 'shrine', 'sentinel', 'ember']
        .find(id => run.rewards.includes(id)) ?? run.rewards.find(id => cards.get(id)?.kind !== 'tactic')!;
      expect(dispatch(run, { kind: 'reward', card: pick }, []).ok).toBe(true);
    }
    expect(run.phase, JSON.stringify(history)).toBe('won');
    expect(run.wave + 1).toBe(6);
    expect(run.defeated).toBe(74);
  });
});
