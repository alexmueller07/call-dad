// Synthesized sound effects for the in-call soundboard.
// Everything is generated with the Web Audio API — no audio assets to ship,
// no licensing, works offline. Each renderer connects its own nodes to `dest`,
// which the caller has already wired to the local monitor and the outgoing call.

export type SfxId =
  | 'airhorn'
  | 'applause'
  | 'tada'
  | 'rimshot'
  | 'drumroll'
  | 'sadtrombone'
  | 'bell'
  | 'buzzer'
  | 'laser'
  | 'boing'
  | 'crickets';

export const SOUNDS: { id: SfxId; label: string; emoji: string }[] = [
  { id: 'airhorn', label: 'Air horn', emoji: '📢' },
  { id: 'applause', label: 'Applause', emoji: '👏' },
  { id: 'tada', label: 'Ta-da!', emoji: '🎉' },
  { id: 'rimshot', label: 'Rimshot', emoji: '🥁' },
  { id: 'drumroll', label: 'Drumroll', emoji: '🎬' },
  { id: 'sadtrombone', label: 'Sad horn', emoji: '🎺' },
  { id: 'bell', label: 'Ding', emoji: '🔔' },
  { id: 'buzzer', label: 'Wrong!', emoji: '❌' },
  { id: 'laser', label: 'Pew pew', emoji: '🔫' },
  { id: 'boing', label: 'Boing', emoji: '🤸' },
  { id: 'crickets', label: 'Crickets', emoji: '🦗' },
];

type Renderer = (ctx: AudioContext, dest: AudioNode) => void;

/** White-noise buffer of the given length, for percussion and crowd textures. */
function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

const airhorn: Renderer = (ctx, dest) => {
  const t = ctx.currentTime;
  const dur = 0.85;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.4, t + 0.04);
  g.gain.setValueAtTime(0.4, t + dur - 0.08);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 0.7;
  bp.connect(g);
  g.connect(dest);
  for (const f of [292, 370, 440]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.98, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    o.connect(bp);
    o.start(t);
    o.stop(t + dur);
  }
};

const applause: Renderer = (ctx, dest) => {
  const t = ctx.currentTime;
  const dur = 1.6;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1500;
  bp.Q.value = 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.32, t + 0.3);
  g.gain.setValueAtTime(0.32, t + dur - 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  // Flutter the level so the noise reads as many hands, not a hiss.
  const lfo = ctx.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 17;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.12;
  lfo.connect(lfoGain);
  lfoGain.connect(g.gain);
  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + dur);
  lfo.start(t);
  lfo.stop(t + dur);
};

const tada: Renderer = (ctx, dest) => {
  const t = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    const last = i === notes.length - 1;
    const st = t + i * 0.09;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.34, st + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, st + (last ? 0.7 : 0.2));
    o.connect(g);
    g.connect(dest);
    o.start(st);
    o.stop(st + 0.8);
  });
};

const drum = (ctx: AudioContext, dest: AudioNode, st: number, freq: number) => {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, st);
  o.frequency.exponentialRampToValueAtTime(freq * 0.5, st + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.6, st);
  g.gain.exponentialRampToValueAtTime(0.0001, st + 0.15);
  o.connect(g);
  g.connect(dest);
  o.start(st);
  o.stop(st + 0.16);
};

const cymbal = (ctx: AudioContext, dest: AudioNode, st: number, dur: number, peak: number) => {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, st);
  g.gain.exponentialRampToValueAtTime(0.0001, st + dur);
  src.connect(hp);
  hp.connect(g);
  g.connect(dest);
  src.start(st);
  src.stop(st + dur);
};

const rimshot: Renderer = (ctx, dest) => {
  const t = ctx.currentTime;
  drum(ctx, dest, t, 220); // ba
  drum(ctx, dest, t + 0.16, 180); // dum
  cymbal(ctx, dest, t + 0.32, 0.4, 0.5); // tss
};

const drumroll: Renderer = (ctx, dest) => {
  const t = ctx.currentTime;
  const dur = 1.3;
  let time = t;
  let interval = 0.06;
  while (time < t + dur) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 250;
    bp.Q.value = 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    src.connect(bp);
    bp.connect(g);
    g.connect(dest);
    src.start(time);
    src.stop(time + 0.05);
    time += interval;
    interval = Math.max(0.026, interval * 0.95); // accelerate toward the crash
  }
  cymbal(ctx, dest, t + dur, 0.6, 0.5);
};

const sadtrombone: Renderer = (ctx, dest) => {
  const t = ctx.currentTime;
  const notes: Array<[number, number]> = [
    [233.08, 0.28], // Bb
    [220.0, 0.28], // A
    [207.65, 0.28], // Ab
    [196.0, 0.72], // G, held and bent down
  ];
  let st = t;
  notes.forEach(([f, d], i) => {
    const last = i === notes.length - 1;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, st);
    if (last) o.frequency.exponentialRampToValueAtTime(f * 0.75, st + d);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, st);
    g.gain.exponentialRampToValueAtTime(0.38, st + 0.03);
    g.gain.setValueAtTime(0.38, st + d - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, st + d);
    o.connect(lp);
    lp.connect(g);
    g.connect(dest);
    o.start(st);
    o.stop(st + d + 0.02);
    st += d;
  });
};

const bell: Renderer = (ctx, dest) => {
  const t = ctx.currentTime;
  const partials: Array<[number, number]> = [
    [880, 0.5],
    [1760, 0.24],
    [2640, 0.12],
  ];
  partials.forEach(([f, amp]) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + 1.3);
  });
};

const buzzer: Renderer = (ctx, dest) => {
  const t = ctx.currentTime;
  const dur = 0.55;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
  g.gain.setValueAtTime(0.4, t + dur - 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  lp.connect(g);
  g.connect(dest);
  const a = ctx.createOscillator();
  a.type = 'sawtooth';
  a.frequency.value = 120;
  const b = ctx.createOscillator();
  b.type = 'square';
  b.frequency.value = 90;
  a.connect(lp);
  b.connect(lp);
  a.start(t);
  a.stop(t + dur);
  b.start(t);
  b.stop(t + dur);
};

const laser: Renderer = (ctx, dest) => {
  const t = ctx.currentTime;
  const dur = 0.3;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(1400, t);
  o.frequency.exponentialRampToValueAtTime(180, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + dur);
};

const boing: Renderer = (ctx, dest) => {
  const t = ctx.currentTime;
  const dur = 0.5;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(600, t);
  o.frequency.exponentialRampToValueAtTime(120, t + dur);
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 18;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 60;
  lfo.connect(lfoGain);
  lfoGain.connect(o.frequency);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + dur);
  lfo.start(t);
  lfo.stop(t + dur);
};

const crickets: Renderer = (ctx, dest) => {
  const t = ctx.currentTime;
  const chirp = (start: number) => {
    for (let k = 0; k < 3; k++) {
      const cs = start + k * 0.04;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 4500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, cs);
      g.gain.exponentialRampToValueAtTime(0.22, cs + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, cs + 0.03);
      o.connect(g);
      g.connect(dest);
      o.start(cs);
      o.stop(cs + 0.035);
    }
  };
  chirp(t);
  chirp(t + 0.5);
  chirp(t + 1.0);
};

const RENDERERS: Record<SfxId, Renderer> = {
  airhorn,
  applause,
  tada,
  rimshot,
  drumroll,
  sadtrombone,
  bell,
  buzzer,
  laser,
  boing,
  crickets,
};

/** Play a sound effect into `dest`. Node lifetimes are self-managed. */
export function renderSfx(ctx: AudioContext, dest: AudioNode, id: SfxId): void {
  RENDERERS[id](ctx, dest);
}
