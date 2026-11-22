export const resources = ['gold', 'food', 'wood', 'mana'] as const;
export type Resource = typeof resources[number];
export type Wallet = Record<Resource, number>;
export type Cost = Partial<Wallet>;
export type Point = { x: number; y: number };
export type Terrain = 'grass' | 'rock' | 'water' | 'bridge' | 'entry' | 'keep';
export type Phase = 'planning' | 'battle' | 'reward' | 'won' | 'lost';
export type CampaignId = 'crowford' | 'march';
export const formations = ['advance', 'bank', 'inner'] as const;
export type Formation = typeof formations[number];
export type RouteId = 'ferry' | 'shoal' | 'crossing';
export type RelicId = 'grain-ledger' | 'ember-lens' | 'muster-banner' | 'gate-keystone';
export type Relic = { id: RelicId; name: string; description: string; trait: 'provisions' | 'arcane' | 'vitality' | 'guard'; power: number };
export type EncounterChoice = { id: string; label: string; cost: Cost; relic?: RelicId; gain?: Cost; card?: string };
export type Encounter = { id: string; name: string; description: string; choices: EncounterChoice[] };
export const kingdomIds = ['iron', 'arcane', 'wild', 'war', 'tide'] as const;
export type KingdomId = typeof kingdomIds[number];
export type CharterId = 'storehouse' | 'medic' | 'magetower' | 'divination';
export type ResearchId = 'fletching' | 'provisions' | 'masonry';
export type Kingdom = {
  id: KingdomId; name: string; tagline: string; description: string; signature: string;
  trait: 'repair' | 'arcane' | 'farm' | 'cavalry' | 'marksman'; power: number;
};
export type BuildingUpgrade = { cost: Cost; hp: number; damage?: number; reach?: number; income?: Cost; capacity?: Cost; recruits?: number; effect?: number };
export type BuildingDef = {
  id: string; name: string; hp: number; damage: number; reach: number; interval: number;
  block: boolean; income: Cost; upgrade: BuildingUpgrade; width?: number; capacity?: Cost;
  recruits?: string; splash?: number; effect?: 'market' | 'blessing' | 'research' | 'ritual';
  site?: 'ley';
  art: 'field' | 'wall' | 'tower' | 'hall' | 'mine' | 'arcane';
};
export type UnitDef = {
  id: string; name: string; hp: number; damage: number; reach: number; interval: number;
  speed: number; armor: number; upkeep?: number; attack?: 'ranged' | 'splash' | 'heal' | 'summon' | 'charge' | 'pierce' | 'siege' | 'boss' | 'hero';
};
export const rarities = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = typeof rarities[number];
export type Card = { id: string; name: string; kind: 'building' | 'unit' | 'spell' | 'tactic' | 'fortify' | 'event'; rarity: Rarity; ref: string; cost: Cost; description: string; heal?: number; gain?: Cost; upgradesFrom?: string };
export type MapDef = { width: number; height: number; entry: Point; keep: Point; riverX: number; bridges: number[]; rocks: Point[]; start: Wallet; capacity: Wallet; keepHp: number };
export type Placement = { id: number; def: string; tile: Point };
export type DeploymentRecord = { id: number; card: string; slot: number };
export type Building = Placement & { hp: number; cooldown: number; level: 1 | 2 };
export type Actor = { id: number; def: string; side: 'ally' | 'enemy'; tile: Point; to?: Point; travel: number; hp: number; cooldown: number; bonusHp?: number; charge?: boolean; summoned?: boolean; stats?: UnitDef; riposteAt?: number };
export type Target = { kind: 'actor' | 'building' | 'keep'; id: number };
export type Shot = { from: Point; target: Target; end: Point; damage: number; ticks: number; duration: number; hostile?: boolean; splash?: number; enemy?: string };
export type KeepDamageSource = { enemy: string; damage: number; hits: number };
export type WaveReport = {
  deployed: number; blocked: number; unfed: string[]; foodAvailable: number; foodSpent: number; foodNeeded: number;
  keepStart: number; lastKeepHit: { enemy: string; from: Point } | null;
  keepDamage: KeepDamageSource[] | null;
};
export type ArchivedWave = {
  wave: number; keepHp: number; defeated: number; formation: Formation; reward: string;
  research: ResearchId | null; relics: RelicId[]; waveReport: WaveReport;
  buildings: Building[]; rally: Placement[];
};
export type AttackStyle = 'melee' | 'arrow' | 'arcane' | 'heavy';
export type EffectStyle = 'arcane' | 'heal' | 'charge' | 'siege' | 'boss';
export type GameEvent =
  | { kind: 'hit'; at: Point; amount: number; hostile: boolean }
  | { kind: 'death'; at: Point }
  | { kind: 'heal'; at: Point; amount: number }
  | { kind: 'support'; id: number; at: Point; towards: Point; style: 'heal' | 'summon' }
  | { kind: 'attack'; id: number; at: Point; towards: Point; style: AttackStyle }
  | { kind: 'effect'; at: Point; radius: number; style: EffectStyle; sourceId?: number }
  | { kind: 'boss'; at: Point }
  | { kind: 'placed' | 'upgraded'; id: number; at: Point }
  | { kind: 'withdrawn'; id: number }
  | { kind: 'phase' | 'resources' };
export type Scheduled = { tick: number; enemy: string };
export type Run = {
  seed: number; random: number; campaign: CampaignId; kingdom: KingdomId | null; phase: Phase; paused: boolean; tick: number; wave: number;
  wallet: Wallet; keepHp: number; hand: string[]; rewards: string[]; divined: boolean;
  shopBought: string[];
  route: RouteId; resolvedEncounters: number[]; relics: RelicId[];
  chronicleId: string | null; charter: CharterId | null;
  research: ResearchId | null;
  deckRandom: number; deck: string[]; discard: string[]; retired: string[];
  buildings: Building[]; rally: Placement[]; actors: Actor[]; shots: Shot[];
  deployments: DeploymentRecord[]; supplyPriority: number | null;
  formation: Formation;
  waveReport: WaveReport | null;
  pastWaves: ArchivedWave[];
  schedule: Scheduled[]; spawnIndex: number; nextId: number; defeated: number;
};
export type Command =
  | { kind: 'play'; slot: number; tile?: Point }
  | { kind: 'undo-deployment' }
  | { kind: 'relocate'; id: number; tile: Point }
  | { kind: 'remove-deployment'; id: number }
  | { kind: 'supply-priority'; id: number | null }
  | { kind: 'formation'; value: Formation }
  | { kind: 'upgrade'; id: number }
  | { kind: 'buy'; card: string }
  | { kind: 'encounter'; choice: string }
  | { kind: 'refine'; card: string; action: 'improve' | 'retire' }
  | { kind: 'research'; topic: ResearchId }
  | { kind: 'start' | 'pause' | 'divine' }
  | { kind: 'reward'; card: string };
export type Result = { ok: true } | { ok: false; reason: string };
