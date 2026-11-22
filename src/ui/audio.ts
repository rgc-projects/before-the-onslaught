import type { GameEvent } from '../core/types';
import { isForeground } from '../platform/foreground';

const clips = {
  click: { url: new URL('../../assets/originals/kenney-interface/click_001.ogg', import.meta.url).href, level: 0.32 },
  place: { url: new URL('../../assets/originals/kenney-interface/confirmation_001.ogg', import.meta.url).href, level: 0.42 },
};

// Voice envelopes are scheduled on the audio clock. Each row is delay, length, waveform,
// start frequency, end frequency and peak gain.
type Voice = [delay: number, length: number, waveform: OscillatorType, from: number, to: number, gain: number];
const scores = {
  select: [[0, 0.07, 'triangle', 523, 698, 0.075]],
  upgrade: [[0, 0.14, 'triangle', 294, 330, 0.12], [0.075, 0.28, 'sine', 530, 587, 0.10]],
  melee: [[0, 0.065, 'triangle', 220, 66, 0.11], [0, 0.025, 'square', 900, 275, 0.026]],
  arrow: [[0, 0.09, 'triangle', 770, 275, 0.047]],
  arcane: [[0, 0.16, 'sine', 388, 588, 0.085], [0.025, 0.17, 'triangle', 596, 407, 0.034]],
  heavy: [[0, 0.19, 'triangle', 138, 42, 0.16], [0.02, 0.075, 'triangle', 417, 111, 0.05]],
  death: [[0, 0.17, 'triangle', 173, 52, 0.082]],
  heal: [[0, 0.17, 'sine', 410, 620, 0.08], [0.075, 0.22, 'sine', 620, 826, 0.058]],
  summon: [[0, 0.20, 'triangle', 296, 392, 0.08], [0.05, 0.27, 'sine', 444, 592, 0.065]],
  start: [[0, 0.30, 'triangle', 147, 147, 0.17], [0.16, 0.31, 'triangle', 220, 220, 0.13]],
  boss: [[0, 0.60, 'triangle', 98, 78, 0.24], [0.13, 0.46, 'sine', 104, 98, 0.18], [0.30, 0.51, 'triangle', 146, 130, 0.10]],
  slam: [[0, 0.29, 'triangle', 110, 43, 0.17], [0.025, 0.39, 'sine', 72, 36, 0.17], [0.075, 0.12, 'triangle', 176, 111, 0.043]],
  won: [[0, 0.26, 'triangle', 294, 294, 0.16], [0.14, 0.28, 'triangle', 370, 370, 0.14],
    [0.28, 0.43, 'triangle', 440, 440, 0.14], [0.32, 0.47, 'sine', 587, 587, 0.11]],
  lost: [[0, 0.35, 'triangle', 196, 175, 0.16], [0.18, 0.47, 'triangle', 131, 98, 0.12]],
} satisfies Record<string, Voice[]>;
type Synth = keyof typeof scores;
type Clip = keyof typeof clips;
type Cue = Clip | Synth;

const samples = new Map<Clip, HTMLAudioElement>();
const lastPlayed = new Map<Cue, number>();
let context: AudioContext | undefined;
let master: GainNode | undefined;
let waking = false;
let level = 0;

export function setSoundLevel(volume: number, muted: boolean): void {
  level = muted || !isForeground() ? 0 : volume / 100;
  if (master) master.gain.value = level;
  for (const [cue, sample] of samples) {
    sample.volume = clips[cue].level * level;
    if (!level) sample.pause();
  }
}

function voice(cue: Synth, audio: AudioContext, output: GainNode): void {
  if (!level) return;
  const now = audio.currentTime;
  for (const [delay, length, waveform, from, to, gain] of scores[cue]) {
    const start = now + delay;
    const source = audio.createOscillator();
    const envelope = audio.createGain();
    source.type = waveform;
    source.frequency.setValueAtTime(from, start);
    source.frequency.exponentialRampToValueAtTime(to, start + length);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    source.connect(envelope).connect(output);
    source.start(start);
    source.stop(start + length);
    source.onended = () => { source.disconnect(); envelope.disconnect(); };
  }
}

export function playSound(cue: Cue): void {
  if (!level) return;
  const now = performance.now();
  if (now - (lastPlayed.get(cue) ?? -Infinity) < (cue === 'click' || cue === 'select' ? 50 : 120)) return;
  lastPlayed.set(cue, now);
  if (cue === 'click' || cue === 'place') {
    const sample = samples.get(cue) ?? new Audio(clips[cue].url);
    samples.set(cue, sample);
    sample.currentTime = 0;
    sample.volume = level * clips[cue].level;
    void sample.play().catch(() => {});
    return;
  }
  if (!globalThis.AudioContext) return;
  if (!context || !master) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = level;
    master.connect(context.createDynamicsCompressor()).connect(context.destination);
  }
  const audio = context;
  const output = master;
  if (audio.state === 'running') voice(cue, audio, output);
  else if (!waking) {
    waking = true;
    void audio.resume().then(() => voice(cue, audio, output)).catch(() => {}).finally(() => { waking = false; });
  }
}

export function playBattleSounds(events: readonly GameEvent[]): void {
  if (!level) return;
  const cues = new Set<Synth>();
  for (const event of events) {
    if (event.kind === 'boss') cues.add('boss');
    if (event.kind === 'attack') cues.add(event.style);
    if (event.kind === 'death') cues.add('death');
    if (event.kind === 'heal') cues.add('heal');
    if (event.kind === 'support' && event.style === 'summon') cues.add('summon');
    if (event.kind === 'effect' && event.style === 'boss') cues.add('slam');
  }
  const attack = (['heavy', 'arcane', 'melee', 'arrow'] as const).find(cue => cues.has(cue));
  if (cues.has('boss')) playSound('boss');
  else if (cues.has('slam')) playSound('slam');
  else if (cues.has('summon')) playSound('summon');
  else if (attack) playSound(attack);
  if (cues.has('death')) playSound('death');
  else if (cues.has('heal')) playSound('heal');
}
