import { createServer } from 'vite';

const vite = await createServer({ appType: 'custom', logLevel: 'warn', server: { middlewareMode: true, hmr: false, ws: false } });
try {
  const { createRun, dispatch, step } = await vite.ssrLoadModule('/src/core/game.ts');
  const { buildings, campaigns, cards, map, rampartGuard } = await vite.ssrLoadModule('/src/data/content.ts');
  const { formations, kingdomIds } = await vite.ssrLoadModule('/src/core/types.ts');
  const { relicTradeChoice, routes } = await vite.ssrLoadModule('/src/data/journey.ts');
  const { pendingEncounter } = await vite.ssrLoadModule('/src/systems/encounters.ts');
  const { checkRelocation } = await vite.ssrLoadModule('/src/systems/deployments.ts');
  const { shopStock, rotatingShopStock, permitPrice } = await vite.ssrLoadModule('/src/systems/shop.ts');
  const { buildingAt, neighbors, same, sealedDistrict, terrain } = await vite.ssrLoadModule('/src/systems/grid.ts');
  const { canAfford, capacity, production } = await vite.ssrLoadModule('/src/systems/economy.ts');
  const { planMuster } = await vite.ssrLoadModule('/src/systems/buildings.ts');

  const recordings = new WeakMap();
  const send = (run, command) => {
    const result = dispatch(run, command, []);
    if (result.ok) recordings.get(run)?.push(command);
    return result;
  };
  const permit = (run, id, tile) => send(run, { kind: 'play', slot: run.hand.indexOf(id), tile }).ok;
  const args = process.argv.slice(2);
  const seedList = args.find(arg => arg.startsWith('--seeds='))?.slice(8);
  if (seedList !== undefined && !/^\d+(,\d+)*$/.test(seedList)) throw new Error('Pass unsigned integer seeds as --seeds=4,12,99');
  const seeds = seedList ? [...new Set(seedList.split(',').map(Number))] : [0, 1, 2, 6, 16, 21, 23, 28, 77, 119, 173, 414];
  if (seeds.some(seed => seed > 0xffffffff)) throw new Error('Seeds must be at most 4294967295');
  const doctrines = ['towers', 'garrison', 'linked_garrison', 'field_army', 'ritual', 'rampart'];
  const chosenKingdom = args.find(arg => arg.startsWith('--kingdom='))?.slice(10);
  const chosenStrategy = args.find(arg => arg.startsWith('--strategy='))?.slice(11);
  if (chosenKingdom && !kingdomIds.includes(chosenKingdom)) throw new Error('Unknown kingdom');
  if (chosenStrategy && !doctrines.includes(chosenStrategy)) throw new Error('Unknown strategy');
  const samples = [];
  const trace = args.find(arg => arg.startsWith('--trace='))?.slice(8);
  const bossSupply = args.find(arg => arg.startsWith('--boss-supply='))?.slice('--boss-supply='.length);
  if (bossSupply !== undefined && !buildings.get(bossSupply)?.recruits) throw new Error('Expected a recruiting building ID for --boss-supply');
  const bossDeploy = args.find(arg => arg.startsWith('--boss-deploy='))?.slice('--boss-deploy='.length);
  if (bossDeploy !== undefined && !['bombard', 'wall', 'sentinel'].includes(bossDeploy)) {
    throw new Error('Expected --boss-deploy=bombard, wall or sentinel');
  }
  const reportCurve = args.includes('--curve');
  const reportLosses = args.includes('--losses');
  const losses = [];
  const bridgeTowers = args.includes('--bridge-towers');
  const orderFarms = args.includes('--order-farms');
  const supplyRations = args.includes('--supply-rations');
  const tradeRelic = args.includes('--trade-relic');
  const clearMuster = args.includes('--clear-muster');
  const formation = args.find(arg => arg.startsWith('--formation='))?.slice('--formation='.length);
  if (formation !== undefined && !formations.includes(formation)) throw new Error('Expected --formation=advance, bank or inner');
  const formationWave = Number(args.find(arg => arg.startsWith('--formation-wave='))?.slice('--formation-wave='.length) ?? 5);
  if (!Number.isInteger(formationWave) || formationWave < 1 || formationWave > campaigns.march.waves.length) throw new Error('Invalid formation wave');
  const formationPlanArg = args.find(arg => arg.startsWith('--formation-plan='))?.slice('--formation-plan='.length);
  const formationPlan = new Map();
  if (formation) formationPlan.set(formationWave, formation);
  if (formationPlanArg !== undefined) {
    if (formation || args.some(arg => arg.startsWith('--formation-wave='))) {
      throw new Error('Use --formation-plan without --formation or --formation-wave');
    }
    for (const change of formationPlanArg.split(',')) {
      const [waveText, value, ...extra] = change.split(':');
      const wave = Number(waveText);
      if (!/^\d+$/.test(waveText) || wave < 1 || wave > campaigns.march.waves.length
        || extra.length || !formations.includes(value) || formationPlan.has(wave)) {
        throw new Error('Expected one formation per wave, e.g. --formation-plan=2:bank,3:advance,5:inner');
      }
      formationPlan.set(wave, value);
    }
  }
  const curve = campaigns.march.waves.map((_, index) => ({ wave: index + 1, attempted: 0, cleared: 0, shortOfFood: 0, keepLost: 0, lostInBossWave: 0 }));

  function vacant(run, point) {
    return terrain(point, run.route) === 'grass' && !sealedDistrict(run, point) && !buildingAt(run.buildings, point)
      && !run.rally.some(v => same(v.tile, point));
  }

  function forecastMuster(run) {
    const income = production(run.buildings, run.kingdom, run.route, run.relics, run.research);
    return planMuster(run, Math.min(capacity(run.buildings).food, run.wallet.food + income.food));
  }

  function deployPermit(run, id, cell) {
    if (!run.hand.includes(id) && rotatingShopStock(run).includes(id) && !run.shopBought.includes(id)) {
      const cost = cards.get(id).cost;
      const quote = permitPrice(id);
      if (canAfford(run.wallet, { ...cost, gold: (quote.gold ?? 0) + (cost.gold ?? 0) })) send(run, { kind: 'buy', card: id });
    }
    if (run.hand.includes(id)) permit(run, id, cell);
  }

  function clearMusterCell(run) {
    const current = forecastMuster(run);
    if (!current.blocked || !run.wallet.wood) return;
    const blocked = run.buildings.filter(building => {
      const group = current.groups.get(building.id);
      return group && group.limit > group.ready;
    });
    const sites = Array.from({ length: map.height * map.width }, (_, index) => ({
      x: index % map.width, y: Math.floor(index / map.width),
    })).filter(tile => vacant(run, tile));
    for (const building of run.buildings) {
      if (!['farm', 'mine'].includes(building.def)
        || !blocked.some(group => neighbors(group.tile).some(tile => same(tile, building.tile)))) continue;
      const income = production(run.buildings, run.kingdom, run.route, run.relics, run.research);
      for (const tile of sites) {
        if (!checkRelocation(run, building.id, tile).ok) continue;
        const projected = { ...run, buildings: run.buildings.map(item => item.id === building.id ? { ...item, tile } : item) };
        const nextIncome = production(projected.buildings, run.kingdom, run.route, run.relics, run.research);
        if (nextIncome.food < income.food || nextIncome.gold < income.gold || forecastMuster(projected).fed <= current.fed) continue;
        send(run, { kind: 'relocate', id: building.id, tile });
        return;
      }
    }
  }

  function simulate(seed, kingdom, doctrine, recording = false) {
    const run = createRun(seed, 'march', kingdom);
    if (recording) recordings.set(run, []);
    const [upper, lower] = routes.get(run.route).bridges;
    const riverbank = Array.from({ length: map.height }, (_, y) => ({ x: map.riverX + 1, y }))
      .filter(tile => tile.y > 0 && tile.y < map.height - 1 && tile.y !== upper && tile.y !== lower);
    const farmY = riverbank[0].y;
    const towerOpening = [['watch', 5, upper], ['watch', 5, lower], ['farm', 4, farmY], ['mine', 5, farmY], ['barracks', 6, 3], ['bowcamp', 7, 3]];
    const openings = {
      towers: towerOpening,
      ritual: towerOpening,
      rampart: [['wall', 5, 3], ['barracks', 6, 3], ['bowcamp', 7, 3], ['guard', 5, 4], ['watch', 5, 2],
        ['farm', 4, farmY], ['mine', 8, 1], ['forge-seal', 6, 3], ['watch', 5, 5]],
      garrison: [['barracks', 5, 3], ['bowcamp', 7, 2], ['farm', 4, farmY], ['mine', 7, 4], ['guard', 6, 3], ['watch', 6, lower]],
      linked_garrison: [['barracks', 5, 3], ['bowcamp', 6, 3], ['wall', 5, 4], ['farm', 4, farmY], ['mine', 8, 1],
        ['watch', 5, upper === 3 || upper === 4 ? 2 : upper], ['watch', 7, lower]],
      field_army: [['barracks', 7, 3], ['bowcamp', 7, 4], ['wall', 8, 3], ['farm', 4, farmY], ['mine', 8, 1],
        ['guard', 9, 4], ['watch', 5, upper], ['swift-company', 9, 2], ['silver-feather', 10, 2],
        ['wild-grove', 4, 5], ['forge-seal', 7, 4], ['watch', 5, lower]],
    };
    for (const [id, x, y] of openings[doctrine]) permit(run, id, { x, y });

    const rampart = doctrine === 'rampart';
    const fieldArmy = doctrine === 'field_army' || rampart;
    const ritual = doctrine === 'ritual';
    const fallback = {
      towers: ['arcanetower', 'magetower', 'bombard', 'watch', 'sentinel', 'hall', 'shrine', 'stable', 'wall'],
      field_army: ['sentinel', 'hall', 'magetower', 'drake', 'shrine', 'medic', 'farm', 'colossus', 'lab', 'stable', 'watch', 'archer'],
      ritual: ['altar', 'arcanetower', 'magetower', 'shrine', 'watch', 'sentinel', 'bombard', 'hall'],
      rampart: ['sentinel', 'medic', 'shrine', 'spear', 'hall', 'farm', 'lab', 'guard', 'watch', 'bombard', 'wall'],
    }[doctrine] ?? ['stable', 'archer', 'guard', 'sentinel', 'hall', 'medic', 'shrine', 'watch', 'magetower'];
    const altarSite = { x: 6, y: 2 };
    const nearAltar = neighbors(altarSite);
    const deployment = fieldArmy ? [
      { x: 8, y: 4 }, { x: 8, y: 2 }, { x: 5, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 1 },
      { x: 10, y: 2 }, { x: 4, y: 5 }, { x: 9, y: 5 }, { x: 9, y: 1 }, { x: 4, y: 3 },
    ] : [
      { x: 8, y: 4 }, { x: 8, y: 2 }, { x: 7, y: 3 }, { x: 6, y: 2 }, { x: 6, y: 4 },
      { x: 8, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 1 }, { x: 9, y: 4 }, { x: 9, y: 2 },
    ];
    let ticks = 0;
    let acquired = 0;
    let ritualWaves = 0;
    let counters = 0;
    for (let i = 0; i < campaigns.march.waves.length; i++) {
      const healing = ['star-mason', 'ember'].find(id => run.hand.includes(id));
      if (i > 0 && run.keepHp < 24 && healing) permit(run, healing);
      if (fieldArmy) {
        permit(run, 'rations-plus') || permit(run, 'rations');
        const priority = rampart ? ['farm', 'bowcamp', 'watch', 'wall', 'shrine']
          : i < 3 ? ['farm', 'barracks', 'bowcamp'] : ['hall', 'stable', 'farm'];
        for (const id of priority) for (const building of run.buildings) {
          if (building.def === id) send(run, { kind: 'upgrade', id: building.id });
        }
      }
      if (i === 1 || (i === 2 && doctrine === 'linked_garrison')) for (const building of run.buildings) {
        const target = doctrine === 'towers' || ritual ? 'watch' : i === 1 ? 'barracks' : 'bowcamp';
        if (building.def === target) send(run, { kind: 'upgrade', id: building.id });
      }
      if (i > 0) for (const id of fallback) {
        const reserving = fieldArmy ? planMuster(run, Infinity).recruited : [];
        let spots = fieldArmy && id === 'farm' ? [...riverbank, ...deployment] : deployment;
        if (bridgeTowers && id === 'watch' && (doctrine === 'garrison' || doctrine === 'linked_garrison')) {
          spots = [{ x: 5, y: upper }, { x: 5, y: lower }, { x: 6, y: upper }, { x: 6, y: lower }, ...spots];
        }
        if (rampart && ['sentinel', 'spear', 'guard'].includes(id)) spots = [{ x: 4, y: 3 }, { x: 4, y: 4 }, { x: 5, y: 1 }, ...deployment];
        if (ritual) {
          const ordinary = deployment.filter(point => !same(point, altarSite));
          if (id === 'altar') {
            if (buildingAt(run.buildings, altarSite)) continue;
            spots = [altarSite];
          } else {
            spots = ['magetower', 'arcanetower'].includes(id) ? [...nearAltar, ...ordinary] : ordinary;
          }
        }
        const cell = spots.find(point => vacant(run, point) && !reserving.some(recruit => same(point, recruit.tile)));
        if (cell) deployPermit(run, id, cell);
      }
      if (fieldArmy) send(run, { kind: 'research', topic: 'provisions' });
      const encounter = pendingEncounter(run);
      const trade = tradeRelic ? encounter?.choices.find(option => option.id === relicTradeChoice && canAfford(run.wallet, option.cost)) : undefined;
      const choice = trade ?? encounter?.choices.find(option => option.id !== relicTradeChoice && option.relic && canAfford(run.wallet, option.cost))
        ?? encounter?.choices[1];
      if (choice && send(run, { kind: 'encounter', choice: choice.id }).ok) acquired += Number(Boolean(choice.relic));
      if (i >= 2 && supplyRations) {
        const plan = forecastMuster(run);
        if (plan.available < plan.needed + 2) permit(run, 'rations-plus') || permit(run, 'rations');
      }
      if (orderFarms && shopStock(run).includes('farm') && !run.hand.includes('farm')) {
        const plan = forecastMuster(run);
        const cell = riverbank.find(point => vacant(run, point) && !plan.recruited.some(recruit => same(point, recruit.tile)));
        const cost = cards.get('farm').cost;
        if (cell && plan.available <= plan.needed + 3 && canAfford(run.wallet, { ...cost, gold: cost.gold + permitPrice('farm').gold })
          && send(run, { kind: 'buy', card: 'farm' }).ok) permit(run, 'farm', cell);
      }
      if (clearMuster && i >= 4) clearMusterCell(run);
      if (bossDeploy && i === campaigns.march.waves.length - 1) {
        const reserves = planMuster(run, Infinity).recruited;
        const innerSites = [{ x: 7, y: 3 }, { x: 6, y: 3 }, { x: 7, y: 2 }, { x: 7, y: 4 }, ...deployment];
        const site = innerSites.find(point => vacant(run, point) && !reserves.some(unit => same(unit.tile, point)));
        if (site) deployPermit(run, bossDeploy, site);
      }
      const before = run.keepHp;
      if (ritual && buildingAt(run.buildings, altarSite)?.def === 'altar'
        && nearAltar.some(tile => ['magetower', 'arcanetower'].includes(buildingAt(run.buildings, tile)?.def))) ritualWaves++;
      const income = production(run.buildings, run.kingdom, run.route, run.relics, run.research);
      const available = Math.min(capacity(run.buildings).food, run.wallet.food + income.food);
      let muster = planMuster(run, available);
      const nextFormation = formationPlan.get(i + 1);
      if (nextFormation) send(run, { kind: 'formation', value: nextFormation });
      if (bossSupply && i === campaigns.march.waves.length - 1) {
        const candidate = run.buildings.find(building => {
          const group = muster.groups.get(building.id);
          return building.def === bossSupply && group && group.fed < group.ready;
        });
        if (candidate && send(run, { kind: 'supply-priority', id: candidate.id }).ok) muster = planMuster(run, available);
      }
      send(run, { kind: 'start' });
      const forces = run.actors.reduce((groups, actor) => ({ ...groups, [actor.def]: (groups[actor.def] ?? 0) + 1 }), {});
      while (run.phase === 'battle') {
        step(run, []);
        counters += run.actors.filter(actor => actor.riposteAt === run.tick + rampartGuard.interval).length;
        ticks++;
      }
      if (reportCurve) {
        const row = curve[i];
        row.attempted++;
        row.cleared += Number(run.phase !== 'lost');
        row.shortOfFood += Number(muster.fed < muster.ready);
        row.keepLost += before - run.keepHp;
        row.lostInBossWave += Number(i === curve.length - 1 && run.phase === 'lost');
      }
      if (reportLosses && run.phase === 'lost') losses.push({
        seed, kingdom, wave: i + 1, route: run.route, formation: run.formation,
        deployed: muster.fed, unfed: muster.ready - muster.fed, blocked: muster.blocked,
        keepBefore: before, lastAttacker: run.waveReport?.lastKeepHit?.enemy ?? null,
        keepDamage: run.waveReport?.keepDamage ?? [],
      });
      if (trace === `${seed}:${kingdom}:${doctrine}`) console.log(JSON.stringify({
        wave: i + 1, phase: run.phase, forces, survivors: run.actors.filter(actor => actor.side === 'ally').length,
        enemyLeft: run.actors.filter(actor => actor.side === 'enemy').length, keepDamage: before - run.keepHp,
        food: run.wallet.food, foodIncome: income.food, upkeep: muster.food, fullUpkeep: muster.needed,
        formation: run.formation, lastKeepHit: run.waveReport?.lastKeepHit, keepDamageByEnemy: run.waveReport?.keepDamage,
        buildings: run.buildings.map(item => item.def), battleSteps: run.tick, ritualWaves, counters,
      }));
      if (run.phase !== 'reward') break;
      const reward = fallback.find(id => run.rewards.includes(id)) ?? run.rewards.find(id => cards.get(id)?.kind !== 'tactic') ?? run.rewards[0];
      send(run, { kind: 'reward', card: reward });
    }
    return { seed, route: run.route, kingdom, doctrine, won: run.phase === 'won', waves: run.wave + Number(run.phase === 'won'),
      hp: run.keepHp, defeated: run.defeated, ticks, acquired, ritualWaves, counters, commands: recordings.get(run),
      report: recording ? run.waveReport : undefined };
  }

  const replay = args.find(arg => arg.startsWith('--replay='))?.slice(9);
  if (replay) {
    const [seed, kingdom, doctrine] = replay.split(':');
    if (!/^\d+$/.test(seed) || Number(seed) > 0xffffffff || !kingdomIds.includes(kingdom) || !doctrines.includes(doctrine)) {
      throw new Error('Expected --replay=119:iron:rampart');
    }
    console.log(JSON.stringify(simulate(Number(seed), kingdom, doctrine, true)));
  } else {
    for (const kingdom of chosenKingdom ? [chosenKingdom] : kingdomIds) for (const doctrine of chosenStrategy ? [chosenStrategy] : doctrines) {
      const outcomes = seeds.map(seed => simulate(seed, kingdom, doctrine));
      const wins = outcomes.filter(row => row.won);
      samples.push({ kingdom, opening: doctrine, wins: wins.length, played: outcomes.length,
        avgCleared: Number((outcomes.reduce((sum, row) => sum + row.waves, 0) / outcomes.length).toFixed(2)),
        avgKeepOnWin: wins.length ? Number((wins.reduce((sum, row) => sum + row.hp, 0) / wins.length).toFixed(1)) : 0,
        maxTicks: Math.max(...outcomes.map(row => row.ticks)), ritualGames: outcomes.filter(row => row.ritualWaves > 0).length,
        counters: outcomes.reduce((sum, row) => sum + row.counters, 0),
        ...(args.includes('--wins') && { seedsWon: wins.map(row => row.seed).join(',') }) });
    }
    console.table(samples);
    if (reportCurve) console.table(curve);
    if (reportLosses) for (const loss of losses) console.log(JSON.stringify(loss));
    if (bossSupply) console.log(`Boss wave policy: prioritize the first undersupplied ${bossSupply}.`);
    if (bossDeploy) console.log(`Boss wave policy: try deploying one additional ${bossDeploy} without taking reserved muster cells.`);
    if (bridgeTowers) console.log('Garrison policies prefer bridge positions for new arrow towers after wave 1.');
    if (orderFarms) console.log('Supply policy: buy and deploy a riverbank farm when a food shortfall is approaching.');
    if (supplyRations) console.log('Supply policy: play a ration card when the food reserve is low, starting in wave 3.');
    if (tradeRelic) console.log('Relic policy: prefer the alternate relic when affordable.');
    if (clearMuster) console.log('Muster policy: relocate at most one farm or mine per wave from wave 5 if more units can deploy and income holds.');
    if (formation) console.log(`Formation policy: switch to ${formation} in wave ${formationWave}.`);
    if (formationPlanArg !== undefined) console.log(`Formation plan: ${formationPlanArg}.`);
    console.log(`Seeds: ${seeds.join(', ')}. One fixed policy per opening; these are regression samples, not human win rates.`);
  }
} finally {
  await vite.close();
}
