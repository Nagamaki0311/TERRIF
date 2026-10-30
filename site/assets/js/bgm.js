// 平成の個人サイトのBGM（MIDI風）。WebAudioの矩形波と三角波で短いループを鳴らす。既定はオフ。
const NOTES = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G3: 196, A3: 220, F3: 174.61, C3: 130.81 };
// 1拍=8分音符。null は休符
const MELODY = ['E5', 'D5', 'C5', 'D5', 'E5', 'E5', 'E5', null, 'D5', 'D5', 'D5', null, 'E5', 'G4', 'G4', null, 'E5', 'D5', 'C5', 'D5', 'E5', 'E5', 'E5', 'C5', 'D5', 'D5', 'E5', 'D5', 'C5', null, null, null];
const BASS = ['C3', 'C3', 'G3', 'G3', 'A3', 'A3', 'F3', 'F3'];
const STEP = 60 / 112 / 2; // 112BPM の8分音符

export function createBgm() {
  let ctx = null, gain = null, timer = 0, step = 0, next = 0;
  const tone = (freq, at, len, type, vol) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(gain);
    o.start(at);
    o.stop(at + len + 0.02);
  };
  const schedule = () => {
    while (next < ctx.currentTime + 0.3) {
      const n = MELODY[step % MELODY.length];
      if (n) tone(NOTES[n], next, STEP * 0.9, 'square', 0.18);
      if (step % 4 === 0) tone(NOTES[BASS[(step / 4) % BASS.length]], next, STEP * 3.6, 'triangle', 0.35);
      step++;
      next += STEP;
    }
  };
  return {
    get on() { return !!timer; },
    async start() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx ??= new AC();
      await ctx.resume();
      gain = ctx.createGain();
      gain.gain.value = 0.07; // 小さめの音量
      gain.connect(ctx.destination);
      step = 0;
      next = ctx.currentTime + 0.05;
      timer = setInterval(schedule, 100);
      return true;
    },
    stop() {
      clearInterval(timer);
      timer = 0;
      gain?.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    },
  };
}
