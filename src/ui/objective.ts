import type { Run } from '../core/types';
import type { Muster } from '../systems/buildings';
import { upkeepFor } from '../systems/buildings';
import { cards, map } from '../data/content';
import { canAfford } from '../systems/economy';
import { permitPrice, shopStock } from '../systems/shop';

export function planningObjective(run: Run, muster: Muster, crossings: readonly { name: string; towers: number }[]): string {
  const affordable = run.hand.map(id => cards.get(id)!).filter(card => canAfford(run.wallet, card.cost));
  const farm = affordable.find(card => card.kind === 'building' && card.ref === 'farm');
  if (muster.fed < muster.ready) {
    const rations = affordable.find(card => (card.gain?.food ?? 0) > 0);
    const missed = muster.ready - muster.fed;
    const warning = `有 ${missed} 支部队会因缺粮留守。`;
    if (rations) return `${warning}可用「${rations.name}」补给。`;
    if (farm) return `${warning}可将「${farm.name}」布在水边生产食物。`;
    const farmCost = cards.get('farm')!.cost;
    const purchase = { ...farmCost, gold: (farmCost.gold ?? 0) + (permitPrice('farm').gold ?? 0) };
    if (shopStock(run).includes('farm') && !run.shopBought.includes('farm') && canAfford(run.wallet, purchase)) {
      return `${warning}可从「军令商店」采购河畔农圃并部署。`;
    }
    return `${warning}可在「军粮分配」指定优先供给。`;
  }
  if (run.campaign !== 'crowford') {
    if (muster.blocked) return '有营地的出阵位受阻。点击部署面板里对应的营地，查看当前可用位置。';
    if (run.wave <= 1) {
      const uncovered = crossings.filter(crossing => crossing.towers === 0).map(crossing => crossing.name);
      if (uncovered.length) return `${uncovered.join('、')}没有防御塔覆盖。选中防御塔军令可预览落点，或在渡口部署守军。`;
    }
    return '核对敌军编成、渡口覆盖和出阵供给，再开始战斗。';
  }
  if (run.wave === 0) {
    if (!run.buildings.some(building => building.def === 'watch') && affordable.some(card => card.id === 'watch')) {
      return '先选「松岗箭塔」，悬停河东草地查看射程，让箭塔覆盖一个渡口。';
    }
    if (!run.rally.length && affordable.some(card => card.id === 'guard')) {
      return `用「边境卫士」设立集结点。支付卡面费用后，再留 ${upkeepFor(run, 'guard')} 食物供它出阵。`;
    }
    if (!run.buildings.some(building => building.def === 'farm') && farm) {
      return '把「河畔农圃」建在水边。水边比普通草地每波多产出食物。';
    }
    return '查看两处渡口的火力覆盖。放错可以撤销，准备好就开战。';
  }
  if (run.wave === 1) return '本波新增重卫。让两座箭塔覆盖同一路段，可以集中火力。';
  const repair = affordable.find(card => card.id === 'ember');
  if (run.keepHp < map.keepHp && repair?.heal) {
    const healing = Math.min(map.keepHp - run.keepHp, repair.heal);
    return `开战前可用「${repair.name}」修复 ${healing} 点城堡生命。`;
  }
  return '重卫会带着轻兵进攻，最后还有一队重卫。让守军在箭塔射程内拦截。';
}

export function formationAdvice(run: Run): string {
  if ((run.wave === 1 || run.wave === 3) && run.formation === 'advance') {
    return '本波可试试「固守东岸」，减少守军追过桥后城堡被绕袭的风险。';
  }
  if (run.wave === 2 && run.formation === 'bank') {
    return '本波可改回「主动迎击」，让守军更早接敌。';
  }
  if (run.wave === 4 && run.formation !== 'inner') {
    return '本波可试试「收缩内线」，把拦截位置留在城堡附近。';
  }
  if (run.wave === 5 && run.formation !== 'inner') {
    return '最终波可试试「收缩内线」，让守军留在城堡附近，应对随后入场的裂岩巨兽。';
  }
  return '';
}
