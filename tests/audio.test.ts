import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameAudio } from '../src/audio.ts';

// Browser-audio boundary: verify distinct cues, scheduled voice cancellation, and mute.
test('sample cues load completely, grow by chain depth, and cancel on stop', async () => {
  const descriptors = Object.fromEntries(['AudioContext', 'document', 'localStorage', 'fetch', 'performance'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let clock = 0;
  const requested: string[] = [];
  const sources: Array<{ buffer: any; started?: number; stopped?: boolean; [key: string]: any }> = [];
  const parameter = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
  class Context {
    currentTime = 10;
    destination = {};
    resume = async () => {};
    decodeAudioData = async (bytes: ArrayBuffer) => ({ file: new TextDecoder().decode(bytes) });
    createGain = () => ({ gain: parameter(), connect() {}, disconnect() {} });
    createDynamicsCompressor = () => ({ threshold: parameter(), knee: parameter(), ratio: parameter(), attack: parameter(), release: parameter(), connect() {} });
    createBufferSource = () => {
      const source = { buffer: null, playbackRate: parameter(), connect() {}, disconnect() {},
        start(at = 0) { this.started = at; }, stop() { this.stopped = true; this.onended?.(); } } as any;
      sources.push(source);
      return source;
    };
  }
  try {
    Object.defineProperties(globalThis, {
      AudioContext: { configurable: true, value: Context },
      document: { configurable: true, value: { baseURI: 'https://game.test/TERRIF/' } },
      localStorage: { configurable: true, value: { getItem: () => null, setItem() {} } },
      performance: { configurable: true, value: { now: () => clock } },
      fetch: { configurable: true, value: async (url: URL) => {
        requested.push(url.pathname);
        return { ok: true, arrayBuffer: async () => new TextEncoder().encode(url.pathname.split('/').at(-1)).buffer };
      } },
    });
    const audio = new GameAudio();
    await audio.unlock();
    assert.equal(audio.ready, true);
    assert.equal(requested.length, 15);
    assert.ok(requested.every(url => url.startsWith('/TERRIF/audio/')));
    const sounds = () => sources.filter(source => source.buffer.file !== 'night-express.ogg');
    audio.playWave(1, 0);
    audio.playWave(2, 1);
    audio.playWave(5, 4, true);
    assert.deepEqual(sounds().map(source => source.buffer.file), [
      'reaction.wav', 'chain-rise.wav', 'cutin.wav', 'chain-deep.wav', 'burst.wav', 'cutin.wav', 'rare.wav',
    ]);
    assert.ok(sounds().some(source => source.started! > 10), 'multi-event accents are deliberately staggered');
    audio.playEvent(false, 2);
    audio.playEvent(true);
    assert.equal(sounds().filter(source => !source.stopped).length, 8, 'all cue paths share the voice limit');
    const beforeMute = sources.length;
    audio.setMuted(true);
    audio.playFinish();
    assert.equal(sources.length, beforeMute);
    audio.stop();
    assert.ok(sources.every(source => source.stopped), 'stop cancels delayed accents as well as live voices');
    assert.equal(audio.ready, false);

    // Functional UI sounds share the same limiter, mute, and teardown path.
    const operations = new GameAudio();
    const firstUnlock = operations.unlock();
    const beforeUnlock = sources.length;
    operations.playOperation('select');
    operations.playOperation('confirm');
    await firstUnlock;
    assert.deepEqual(sources.slice(beforeUnlock).map(source => source.buffer.file),
      ['night-express.ogg', 'ui-confirm.wav'], 'only the latest loading-time gesture plays');
    const beforeOperations = sources.length;
    for (const kind of ['select', 'move', 'confirm', 'cancel', 'navigate', 'invalid', 'depart'] as const) {
      operations.playOperation(kind);
    }
    assert.deepEqual(sources.slice(beforeOperations).map(source => source.buffer.file), [
      'ui-select.wav', 'ui-slide.wav', 'ui-confirm.wav', 'ui-cancel.wav', 'ui-slide.wav', 'ui-invalid.wav', 'ui-depart.wav',
    ]);
    assert.notEqual(sources[beforeOperations+1].playbackRate.value, sources[beforeOperations+4].playbackRate.value,
      'move and navigate have distinct emphasis');
    operations.playPlacement();
    assert.equal(sources.at(-1)!.buffer.file, 'place.wav');
    operations.setMuted(true);
    const mutedCount = sources.length;
    operations.playOperation('confirm');
    assert.equal(sources.length, mutedCount);
    operations.stop();

    const initialPlacement = new GameAudio();
    const placementUnlock = initialPlacement.unlock();
    const beforeInitialPlacement = sources.length;
    initialPlacement.playOperation('select');
    initialPlacement.playPlacement();
    await placementUnlock;
    assert.deepEqual(sources.slice(beforeInitialPlacement).map(source => source.buffer.file),
      ['night-express.ogg', 'place.wav'], 'the initial placement replaces selection and hisses once after loading');
    initialPlacement.stop();

    const cancelled = new GameAudio();
    const cancelledUnlock = cancelled.unlock();
    const beforeCancellation = sources.length;
    cancelled.playPlacement();
    cancelled.stop();
    await cancelledUnlock;
    assert.equal(sources.length, beforeCancellation, 'stop during loading cannot produce a late operation');

    const mutedLoading = new GameAudio();
    const mutedUnlock = mutedLoading.unlock();
    mutedLoading.playPlacement();
    mutedLoading.setMuted(true);
    const beforeMutedLoad = sources.length;
    await mutedUnlock;
    assert.deepEqual(sources.slice(beforeMutedLoad).map(source => source.buffer.file),
      ['night-express.ogg'], 'muting while loading discards the pending placement');
    mutedLoading.stop();

    const stale = new GameAudio();
    const staleUnlock = stale.unlock();
    stale.playOperation('select');
    clock = 1001;
    const beforeStale = sources.length;
    await staleUnlock;
    assert.deepEqual(sources.slice(beforeStale).map(source => source.buffer.file),
      ['night-express.ogg'], 'old gestures expire instead of sounding after a slow download');
    stale.stop();
  } finally {
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
  }
});
