import type { Card, Cost, KingdomId, Phase, Rarity, Resource } from '../core/types';
import { spriteCard } from '../scenes/sprites';

export const resourceLabel: Record<Resource, string> = { gold: '金币', food: '食物', wood: '木材', mana: '魔力' };
export const resourceMark: Record<Resource, string> = { gold: '◈', food: '❧', wood: '▰', mana: '✦' };
export const phaseLabel: Record<Phase, string> = { planning: '备战', battle: '交战', reward: '战利品', won: '守城成功', lost: '城堡失守' };
export const kingdomCrests: Record<KingdomId, string> = { iron: '♜', arcane: '✧', wild: '❦', war: '⚑', tide: '≋' };
export const cardMark: Record<string, string> = {
  watch: '♜', farm: '❧', wall: '▥', guard: '⚔', ember: '✦', timber: '▰', trade: '◈', rations: '❧',
  'forge-seal': '⟐', 'star-mason': '✧', 'wild-grove': '❧', 'swift-company': '♞', 'archive-cache': '▣',
  'timber-plus': '▰', 'trade-plus': '◈', 'rations-plus': '❧', 'silver-feather': '➶',
};
const rarityNames: Record<Rarity, string> = { common: '普通', rare: '稀有', epic: '史诗', legendary: '传说' };

export function costText(cost: Cost): string {
  return Object.entries(cost).filter(([, amount]) => amount > 0)
    .map(([key, amount]) => `${amount} ${resourceLabel[key as Resource]}`).join('、');
}

export function price(card: Card): string {
  return Object.entries(card.cost).map(([key, value]) =>
    `<span class="cost ${key}" title="${resourceLabel[key as Resource]}">${resourceMark[key as Resource]} ${value}</span>`).join('');
}

export function cardBody(card: Card, index?: number): string {
  const category = { unit: '部队', spell: '法术', building: '建筑', tactic: '战术', fortify: '强化', event: '事件' }[card.kind];
  const art = spriteCard(card.ref || card.id, cardMark[card.id] ?? (card.kind === 'unit' ? '⚔' : '♜'));
  return `<div class="card-kicker"><span>${category} · <span class="rarity ${card.rarity}">${rarityNames[card.rarity]}</span></span>${index === undefined || index >= 9 ? '' : `<kbd>${index + 1}</kbd>`}</div>
    <div class="card-icon ${card.rarity} ${card.kind}" aria-hidden="true">${art}</div>
    <strong>${card.name}</strong><div class="price">${price(card)}</div>`;
}
export const formationNames = { advance: '主动迎击', bank: '固守东岸', inner: '收缩内线' } as const;

