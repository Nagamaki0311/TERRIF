/** Original sample-based music and damped-body sound effects. */
const AUDIO_FILES = {
  music: 'night-express.ogg',
  placement: 'place.wav',
  reaction: 'reaction.wav',
  rise: 'chain-rise.wav',
  deep: 'chain-deep.wav',
  burst: 'burst.wav',
  cutin: 'cutin.wav',
  rare: 'rare.wav',
  finish: 'finish.wav',
  select: 'ui-select.wav',
  slide: 'ui-slide.wav',
  confirm: 'ui-confirm.wav',
  cancel: 'ui-cancel.wav',
  invalid: 'ui-invalid.wav',
  depart: 'ui-depart.wav',
} as const;

type SoundName = keyof typeof AUDIO_FILES;
export type AudioOperation = 'select' | 'move' | 'confirm' | 'cancel' | 'navigate' | 'invalid' | 'depart';
const OPERATION_CUES: Record<AudioOperation, readonly [SoundName, number, number]> = {
  select: ['select', 0.3, 1],
  move: ['slide', 0.34, 0.9],
  confirm: ['confirm', 0.36, 1],
  cancel: ['cancel', 0.27, 1],
  navigate: ['slide', 0.24, 1.08],
  invalid: ['invalid', 0.32, 1],
  depart: ['depart', 0.4, 1],
};
const AUDIO_FILE_COUNT = Object.keys(AUDIO_FILES).length;
interface AudioSettings {
  muted: boolean;
  musicEnabled: boolean;
  volume: number;
}

const SETTINGS_KEY = 'manin-densha.audio.v1';

function readSettings(): AudioSettings {
  const defaults = { muted: false, musicEnabled: true, volume: 0.72 };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    return {
      muted: typeof saved.muted === 'boolean' ? saved.muted : defaults.muted,
      musicEnabled: typeof saved.musicEnabled === 'boolean' ? saved.musicEnabled : defaults.musicEnabled,
      volume: typeof saved.volume === 'number' && Number.isFinite(saved.volume)
        ? Math.max(0, Math.min(1, saved.volume)) : defaults.volume,
    };
  } catch {
    return defaults;
  }
}

export class GameAudio {
  private settings = readSettings();
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private effectsGain: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private voices = new Map<AudioBufferSourceNode, GainNode>();
  private loading: Promise<void> | null = null;
  private enabled = false;
  private playbackGeneration = 0;
  private pendingGesture: { kind: AudioOperation | 'placement'; at: number } | null = null;

  get muted(): boolean { return this.settings.muted; }
  get musicEnabled(): boolean { return this.settings.musicEnabled; }
  get volume(): number { return this.settings.volume; }
  get ready(): boolean { return this.enabled && this.buffers.size === AUDIO_FILE_COUNT; }

  /** Call from a click or keyboard action to satisfy browser audio permissions. */
  async unlock(): Promise<void> {
    const generation = this.playbackGeneration;
    if (!this.context) this.createContext();
    const context = this.context!;
    await context.resume();
    if (generation !== this.playbackGeneration) return;
    if (this.buffers.size !== AUDIO_FILE_COUNT) {
      if (!this.loading) {
        this.loading = this.loadBuffers(context).finally(() => { this.loading = null; });
      }
      await this.loading;
    }
    if (generation !== this.playbackGeneration) return;
    this.enabled = true;
    this.applyVolume();
    this.startMusic();
    const pending = this.pendingGesture;
    this.pendingGesture = null;
    // Keep only a recent final gesture; a slow/retried download must not replay history.
    if (pending && performance.now() - pending.at < 1000) this.playFeedback(pending.kind);
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    if (muted) this.pendingGesture = null;
    this.persist();
    this.applyVolume();
  }

  setMusicEnabled(enabled: boolean): void {
    this.settings.musicEnabled = enabled;
    this.persist();
    if (enabled) this.startMusic();
    else this.stopMusic();
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.settings.volume = Math.max(0, Math.min(1, volume));
    this.persist();
    this.applyVolume();
  }

  playPlacement(): void {
    this.playFeedback('placement');
  }

  playOperation(kind: AudioOperation): void {
    this.playFeedback(kind);
  }

  private playFeedback(kind: AudioOperation | 'placement'): void {
    if (this.settings.muted) return;
    if (!this.enabled) {
      this.pendingGesture = { kind, at: performance.now() };
      return;
    }
    this.pendingGesture = null;
    if (kind === 'placement') this.playSample('placement', 0.52, 1);
    else this.playSample(...OPERATION_CUES[kind]);
  }

  playWave(depth: number, events: number, rare = false): void {
    const step = Math.max(0, Math.min(8, Math.floor(depth)));
    const rate = 0.96 + Math.min(step, 6) * 0.025;
    // Distinct layered samples make growth audible without endlessly pitching up one hit.
    this.playSample(step >= 4 ? 'deep' : step >= 2 ? 'rise' : 'reaction', 0.48, rate);
    if (events > 1) this.playSample('burst', 0.3, 1, 0.055);
    if (events >= 4) this.playSample('cutin', 0.22, 1.12, 0.17);
    if (rare) this.playSample('rare', 0.42, 1, 0.035);
    else if (events === 1) this.playSample('cutin', 0.24, 1, 0.055);
    this.duckMusic(rare ? 1.5 : events > 1 ? 1.1 : 0.7);
  }

  /** An accent for subsequent event cards; the first card is included in playWave. */
  playEvent(rare = false, variation = 0): void {
    this.playSample(rare ? 'rare' : 'cutin', rare ? 0.38 : 0.34,
      1 + Math.max(0, Math.min(3, variation)) * 0.025);
    this.duckMusic(rare ? 1.3 : 0.6);
  }

  playFinish(): void {
    this.playSample('finish', 0.55, 1);
    this.duckMusic(0.7);
  }

  /** Cancels queued accents too, so skipping a chain cannot leave late sounds. */
  stop(): void {
    this.playbackGeneration++;
    this.pendingGesture = null;
    this.stopMusic();
    for (const source of this.voices.keys()) {
      try { source.stop(); } catch { /* A completed source has already stopped. */ }
    }
    this.voices.clear();
    if (this.musicGain && this.context) {
      this.musicGain.gain.cancelScheduledValues(this.context.currentTime);
      this.musicGain.gain.setValueAtTime(0.28, this.context.currentTime);
    }
    this.enabled = false;
  }

  private createContext(): void {
    const context = new AudioContext();
    this.context = context;
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -8;
    compressor.knee.value = 8;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.16;
    this.musicGain = context.createGain();
    this.musicGain.gain.value = 0.28;
    this.effectsGain = context.createGain();
    this.effectsGain.gain.value = 0.8;
    this.musicGain.connect(compressor);
    this.effectsGain.connect(compressor);
    compressor.connect(master);
    master.connect(context.destination);
    this.master = master;
    this.applyVolume();
  }

  private async loadBuffers(context: AudioContext): Promise<void> {
    const loaded = await Promise.all(Object.entries(AUDIO_FILES).map(async ([name, file]) => {
      const response = await fetch(new URL(`audio/${file}`, document.baseURI));
      if (!response.ok) throw new Error(`音源を読み込めませんでした (${response.status})`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      return [name as SoundName, buffer] as const;
    }));
    for (const [name, buffer] of loaded) this.buffers.set(name, buffer);
  }

  private startMusic(): void {
    if (!this.enabled || !this.settings.musicEnabled || this.musicSource || !this.context || !this.musicGain) return;
    const buffer = this.buffers.get('music');
    if (!buffer) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(this.musicGain);
    source.onended = () => source.disconnect();
    source.start();
    this.musicSource = source;
  }

  private stopMusic(): void {
    if (!this.musicSource) return;
    try { this.musicSource.stop(); } catch { /* Stopping is idempotent. */ }
    this.musicSource = null;
  }

  private playSample(name: SoundName, gain: number, rate: number, delay = 0): void {
    if (!this.enabled || this.settings.muted || !this.context || !this.effectsGain) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    while (this.voices.size >= 8) {
      const oldest = this.voices.keys().next().value;
      if (!oldest) break;
      oldest.stop();
      this.voices.delete(oldest);
    }
    const source = this.context.createBufferSource();
    const level = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    level.gain.value = gain;
    source.connect(level);
    level.connect(this.effectsGain);
    this.voices.set(source, level);
    source.onended = () => {
      source.disconnect();
      level.disconnect();
      this.voices.delete(source);
    };
    source.start(this.context.currentTime + delay);
  }

  private duckMusic(seconds: number): void {
    if (!this.context || !this.musicGain) return;
    const now = this.context.currentTime;
    const gain = this.musicGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0.17, now + 0.035);
    gain.setTargetAtTime(0.28, now + seconds, 0.14);
  }

  private applyVolume(): void {
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.volume, this.context.currentTime, 0.025);
  }

  private persist(): void {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); }
    catch { /* Private browsing can make persistent settings unavailable. */ }
  }
}
