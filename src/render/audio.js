import { makeRng } from '../engine/rng.js';

// WebAudioによる合成音。既定はオフで、利用者が明示的に許可したときだけ開始する。
// 外部の音声ファイルは使わない。音量には上限を設け、リミッターを通す。
export const AUDIO_SAFETY = {
  masterMax: 0.3, // マスター音量の上限（0〜1）
  stingerPeak: 0.22, // 突発音のピーク
  minHz: 40, // 一般的な機器で再生できない超低域は使わない（効果の根拠も弱い。docs/content_policy.md）
  fadeOutSec: 1.2,
};

export function createAudio({ stinger = false, seed = 'audio' } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -20;
  limiter.knee.value = 6;
  limiter.ratio.value = 14;
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(limiter).connect(ctx.destination);

  // 室内音: 低域だけを通した雑音
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rng = makeRng(seed, 'noise');
  let b0 = 0;
  for (let i = 0; i < d.length; i++) {
    b0 = 0.97 * b0 + 0.03 * (rng() * 2 - 1);
    d[i] = b0 * 6;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 380;
  const room = ctx.createGain();
  room.gain.value = 0.05;
  noise.connect(lp).connect(room).connect(master);
  noise.start();

  // 持続音: わずかにずれた2つの低い音。うなりが段階とともに速くなる
  const o1 = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  o1.frequency.value = 62;
  o2.frequency.value = 62.6;
  const drone = ctx.createGain();
  drone.gain.value = 0.02;
  o1.connect(drone);
  o2.connect(drone);
  drone.connect(master);
  o1.start();
  o2.start();

  const now = () => ctx.currentTime;
  const ramp = (param, v, sec) => {
    param.cancelScheduledValues(now());
    param.setValueAtTime(param.value, now());
    param.linearRampToValueAtTime(v, now() + sec);
  };
  const env = (g, peak, attack, release) => {
    g.gain.setValueAtTime(0.0001, now());
    g.gain.linearRampToValueAtTime(Math.min(peak, AUDIO_SAFETY.stingerPeak), now() + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now() + attack + release);
  };

  return {
    async start() {
      await ctx.resume();
      ramp(master.gain, AUDIO_SAFETY.masterMax, 2);
    },
    setStage(stage) {
      ramp(drone.gain, 0.02 + 0.012 * stage, 3);
      o2.frequency.setTargetAtTime(62 + 0.6 + 0.9 * stage, now(), 1.5);
      ramp(room.gain, 0.05 - 0.01 * stage, 3);
    },
    /** 'silence': 無音を挟む / 'thump': 低い物音 / 'stinger': 突発音（許可されている場合のみ） */
    event(name, sec = 2.2) {
      if (name === 'silence') {
        ramp(master.gain, 0.0001, 0.4);
        setTimeout(() => ramp(master.gain, AUDIO_SAFETY.masterMax, 1.2), sec * 1000);
      } else if (name === 'thump') {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(90, now());
        o.frequency.exponentialRampToValueAtTime(AUDIO_SAFETY.minHz + 5, now() + 0.4);
        o.connect(g).connect(master);
        env(g, 0.14, 0.02, 0.5);
        o.start();
        o.stop(now() + 0.7);
      } else if (name === 'stinger' && stinger) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1100;
        const g = ctx.createGain();
        src.connect(bp).connect(g).connect(master);
        env(g, AUDIO_SAFETY.stingerPeak, 0.005, 0.3);
        src.start();
        src.stop(now() + 0.5);
      }
    },
    stop() {
      ramp(master.gain, 0.0001, AUDIO_SAFETY.fadeOutSec);
      setTimeout(() => ctx.close(), AUDIO_SAFETY.fadeOutSec * 1000 + 100);
    },
  };
}
