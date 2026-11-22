import type { Run, WaveReport } from '../core/types';
import { buildings, campaigns, cards, enemies, kingdoms, map, units } from '../data/content';
import { relics, routes } from '../data/journey';
import { topics } from '../systems/research';
import { formationNames } from './labels';

const exportedBuild = `导出构建 ${__NINE_KINGDOMS_BUILD__}`;

function reviewDetails(run: Pick<Run, 'keepHp' | 'phase'>, report: WaveReport) {
  const missed = new Map<string, number>();
  for (const id of report.unfed) missed.set(id, (missed.get(id) ?? 0) + 1);
  const squads = [...missed].map(([id, count]) => `${units.get(id)!.name} × ${count}`).join('、');
  const damage = report.keepStart - run.keepHp;
  const ranked = [...(report.keepDamage ?? [])].sort((a, b) => b.damage - a.damage);
  let keep = damage ? `本波城堡损失 ${damage} 生命。` : '本波城堡未受伤。';
  const hit = report.lastKeepHit;
  if (run.phase === 'lost' && run.keepHp > 0) keep += ' 到达战斗时限时，仍有敌军未被清除。';
  else if (run.phase === 'lost' && hit) {
    keep += ` ${enemies.get(hit.enemy)!.name}从第 ${hit.from.x + 1} 列、第 ${hit.from.y + 1} 行发起最后一次攻击。`;
  }
  const supply = `出阵 ${report.deployed} 支 · 开战有 ${report.foodAvailable} 食物 · 出阵消耗 ${report.foodSpent} 食物`;
  const shortage = squads ? `缺粮未出阵 ${report.unfed.length} 支 · ${squads}。全部预备队出阵需要 ${report.foodNeeded} 食物。` : '';
  return { damage, ranked, keep, supply, shortage };
}

export function waveReview(run: Run): string {
  const report = run.waveReport;
  if (!report) return '';
  const { damage, ranked, keep, supply, shortage } = reviewDetails(run, report);

  return `<section class="wave-review" aria-label="本波战况">
    <p>${keep}</p>
    ${ranked.length ? `<h3>城堡伤害来源</h3>
    <ul class="wave-damage" aria-label="城堡伤害来源">${ranked.map(row =>
      `<li data-enemy="${row.enemy}" style="--share:${Math.round(row.damage * 100 / damage)}%">
        <span>${enemies.get(row.enemy)!.name}</span>
        <span class="wave-damage-detail">${row.damage} 生命 · ${row.hits} 次命中</span>
      </li>`).join('')}</ul>` : ''}
    <p>${supply}</p>
    ${run.formation !== 'advance' ? `<p>守军阵势 · ${formationNames[run.formation]}</p>` : ''}
    ${shortage ? `<p class="wave-review-alert">${shortage}</p>` : ''}
    ${report.blocked ? `<p class="wave-review-alert">另有 ${report.blocked} 个召集位置受阻。为征兵建筑留出相邻空地可增加出阵名额。</p>` : ''}
  </section>`;
}

function reportContext(run: Run): string {
  return [campaigns[run.campaign].name, run.kingdom && kingdoms[run.kingdom].name, `种子 ${run.seed}`].filter(Boolean).join(' · ');
}

type ReportWave = Pick<Run, 'campaign' | 'wave' | 'phase' | 'keepHp' | 'defeated' | 'route'
  | 'formation' | 'research' | 'relics' | 'buildings' | 'rally'>;

function waveReportLines(run: ReportWave, report: WaveReport, reward?: string): string[] {
  const mapName = run.campaign === 'march' ? routes.get(run.route)!.name : '鸦渡战场';
  const outcome = run.phase === 'reward' ? '本波守住' : run.phase === 'won' ? '通关' : '防线失守';
  const { ranked, keep, supply, shortage } = reviewDetails(run, report);
  const structures = run.buildings.map(({ def, tile, level, hp }) =>
    `第 ${tile.x + 1} 列第 ${tile.y + 1} 行 · ${buildings.get(def)!.name} · ${level} 级 · 耐久 ${hp}`);
  const rallies = run.rally.map(({ def, tile }) => `第 ${tile.x + 1} 列第 ${tile.y + 1} 行 · ${units.get(def)!.name}`);
  return [
    `第 ${run.wave + 1} / ${campaigns[run.campaign].waves.length} 波 · ${outcome} · 城堡生命 ${run.keepHp} / ${map.keepHp} · 累计击退 ${run.defeated} 名敌军`,
    `地图 ${mapName} · 守军阵势 ${formationNames[run.formation]}`,
    ...(reward ? [`领取军令 ${cards.get(reward)!.name}`] : []),
    ...(run.research ? [`科技 ${topics.get(run.research)!.name}`] : []),
    ...(run.relics.length ? [`遗物 ${run.relics.map(id => relics.get(id)!.name).join('、')}`] : []),
    '', keep,
    ...(ranked.length ? ['城堡伤害来源', ...ranked.map(row =>
      `${enemies.get(row.enemy)!.name} · ${row.damage} 生命 · ${row.hits} 次命中`)] : []),
    supply, ...(shortage ? [shortage] : []), `召集位置受阻 ${report.blocked} 个`,
    '', '战后保留建筑', ...(structures.length ? structures : ['无']),
    '', '集结点', ...(rallies.length ? rallies : ['无']), '',
  ];
}

export function waveReportText(run: Run): string | undefined {
  const report = run.waveReport;
  if (!report || (run.phase !== 'reward' && run.phase !== 'won' && run.phase !== 'lost')) return undefined;
  return ['兵锋未至 · 战报', reportContext(run), exportedBuild, ...waveReportLines(run, report)].join('\r\n');
}

export function runReportText(run: Run): string | undefined {
  if (!run.waveReport || (run.phase !== 'won' && run.phase !== 'lost')) return undefined;
  const sections = run.pastWaves.flatMap(wave => [
    ...waveReportLines({ ...wave, campaign: run.campaign, route: run.route, phase: 'reward' }, wave.waveReport, wave.reward), '',
  ]);
  const count = run.pastWaves.length + 1;
  return [
    '兵锋未至 · 整局战报', reportContext(run), exportedBuild, `记录 ${count} / ${run.wave + 1} 个已完成波次`,
    ...(count < run.wave + 1 ? ['部分早期波次没有可用战报。'] : []), '',
    ...sections, ...waveReportLines(run, run.waveReport),
  ].join('\r\n');
}
