/** Original sample-based music and damped-body sound effects. */
const AUDIO_FILES = {
  music: 'night-express.ogg',
  placement: 'place.wav',
  reaction: 'reaction.wav',
  rare: 'rare.wav',
  finish: 'finish.wav',
} as const;

type SoundName = keyof typeof AUDIO_FILES;
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

  get muted(): boolean { return this.settings.muted; }
  get musicEnabled(): boolean { return this.settings.musicEnabled; }
  get volume(): number { return this.settings.volume; }
  get ready(): boolean { return this.enabled && this.buffers.size === 5; }

  /** Call from a click or keyboard action to satisfy browser audio permissions. */
  async unlock(): Promise<void> {
    const generation = this.playbackGeneration;
    if (!this.context) this.createContext();
    const context = this.context!;
    await context.resume();
    if (generation !== this.playbackGeneration) return;
    if (this.buffers.size !== 5) {
      if (!this.loading) {
        this.loading = this.loadBuffers(context).finally(() => { this.loading = null; });
      }
      await this.loading;
    }
    if (generation !== this.playbackGeneration) return;
    this.enabled = true;
    this.applyVolume();
    this.startMusic();
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
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
    this.playSample('placement', 0.43, 1);
  }

  playWave(depth: number, events: number, rare = false): void {
    const step = Math.max(0, Math.min(8, Math.floor(depth)));
    const rate = 0.94 + step * 0.035;
    this.playSample('reaction', 0.42, rate);
    if (events > 1) this.playSample('reaction', 0.16, rate * 1.25, 0.035);
    if (rare) this.playSample('rare', 0.34, 1);
    this.duckMusic(rare ? 0.85 : 0.38);
  }

  playFinish(): void {
    this.playSample('finish', 0.55, 1);
    this.duckMusic(0.7);
  }

  /** Cancels queued accents too, so skipping a chain cannot leave late sounds. */
  stop(): void {
    this.playbackGeneration++;
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
