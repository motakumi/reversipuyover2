"use strict";

// 効果音(Web Audio APIで合成。音声ファイル不要)
const Sound = (() => {
  let ac = null;
  let master = null;

  function init() {
    if (ac) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(ac.destination);
  }

  // ユーザー操作の中で呼ぶ(ブラウザの自動再生制限対策)
  function resume() {
    init();
    if (ac && ac.state === "suspended") ac.resume();
  }

  function tone({ freq, freq2, dur = 0.12, type = "square", vol = 0.2, delay = 0 }) {
    if (!ac || ac.state !== "running") return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freq2) o.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise({ dur = 0.15, vol = 0.2, delay = 0, lp = 3000 }) {
    if (!ac || ac.state !== "running") return;
    const t = ac.currentTime + delay;
    const len = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const f = ac.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lp;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
  }

  const sounds = {
    move() {
      tone({ freq: 330, freq2: 300, dur: 0.04, type: "square", vol: 0.06 });
    },
    rotate() {
      tone({ freq: 500, freq2: 800, dur: 0.07, type: "triangle", vol: 0.15 });
    },
    lock() {
      tone({ freq: 200, freq2: 80, dur: 0.1, type: "sine", vol: 0.3 });
      noise({ dur: 0.06, vol: 0.1, lp: 1500 });
    },
    // 連鎖数が増えるほど音程が上がる
    clear(chain) {
      const c = Math.max(1, Math.min(chain || 1, 8));
      const base = 392 * Math.pow(2, ((c - 1) * 2) / 12);
      [1, 1.25, 1.5, 2].forEach((m, i) => {
        tone({ freq: base * m, dur: 0.14, type: "square", vol: 0.1, delay: i * 0.06 });
      });
      tone({ freq: base * 2, dur: 0.3, type: "sine", vol: 0.12, delay: 0.24 });
      if (c >= 2) {
        tone({ freq: base * 3, freq2: base * 4, dur: 0.25, type: "triangle", vol: 0.1, delay: 0.3 });
      }
      noise({ dur: 0.15, vol: 0.08, lp: 6000 });
    },
    flip() {
      tone({ freq: 700, freq2: 1100, dur: 0.08, type: "triangle", vol: 0.15 });
      tone({ freq: 1100, freq2: 1600, dur: 0.1, type: "triangle", vol: 0.15, delay: 0.07 });
    },
    ojama() {
      tone({ freq: 140, freq2: 55, dur: 0.3, type: "sawtooth", vol: 0.18 });
      noise({ dur: 0.2, vol: 0.15, lp: 800 });
    },
    start() {
      [523, 659, 784, 1047].forEach((f, i) => {
        tone({ freq: f, dur: 0.1, type: "square", vol: 0.1, delay: i * 0.07 });
      });
    },
    // arg = true ならハイスコア更新のファンファーレ
    gameover(newRecord) {
      if (newRecord) {
        [523, 659, 784, 1047, 1319].forEach((f, i) => {
          tone({ freq: f, dur: 0.18, type: "square", vol: 0.12, delay: i * 0.1 });
        });
      } else {
        [392, 349, 330, 262].forEach((f, i) => {
          tone({ freq: f, dur: 0.25, type: "sawtooth", vol: 0.14, delay: i * 0.22 });
        });
      }
    },
  };

  return {
    resume,
    play(name, arg) {
      const fn = sounds[name];
      if (fn) fn(arg);
    },
  };
})();