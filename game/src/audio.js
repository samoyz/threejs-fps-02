// Every sound is synthesised with WebAudio: no audio files, no network. A shot is
// a noise burst through a low-pass filter plus a click; the rest are short blips.
// The context is created lazily on the first user gesture and every call is guarded,
// so a headless capture that never unlocks audio simply stays silent.
export function createAudio() {
  let context = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (context) return context;
    try {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return null;
      context = new AC();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
    } catch {
      return null;
    }
    return context;
  }

  function noiseBuffer(duration) {
    const ctx = ensure();
    if (!ctx) return null;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration = 0.12, freq = 1800, gain = 0.5, type = 'lowpass', when = 0 }) {
    const ctx = ensure();
    if (!ctx || muted || !master) return;
    try {
      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer(duration);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(gain, ctx.currentTime + when);
      amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + duration);
      source.connect(filter);
      filter.connect(amp);
      amp.connect(master);
      source.start(ctx.currentTime + when);
      source.stop(ctx.currentTime + when + duration);
    } catch { /* audio is best-effort */ }
  }

  function tone({ freq = 440, end = null, duration = 0.08, gain = 0.25, type = 'square', when = 0 }) {
    const ctx = ensure();
    if (!ctx || muted || !master) return;
    try {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + when);
      if (end) osc.frequency.exponentialRampToValueAtTime(end, ctx.currentTime + when + duration);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(gain, ctx.currentTime + when);
      amp.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + duration);
      osc.connect(amp);
      amp.connect(master);
      osc.start(ctx.currentTime + when);
      osc.stop(ctx.currentTime + when + duration);
    } catch { /* audio is best-effort */ }
  }

  return {
    unlock() { ensure(); },
    toggleMute() {
      muted = !muted;
      return muted;
    },
    shot(defId, distant = false) {
      const table = {
        p9: { freq: 1400, gain: 0.4, duration: 0.09 },
        raptor: { freq: 1900, gain: 0.35, duration: 0.08 },
        vk47: { freq: 1200, gain: 0.55, duration: 0.12 },
        longbow: { freq: 900, gain: 0.7, duration: 0.22 },
        breacher: { freq: 700, gain: 0.7, duration: 0.18 },
      };
      const s = table[defId] ?? table.vk47;
      burst({ ...s, gain: distant ? s.gain * 0.35 : s.gain });
      tone({ freq: 180, end: 60, duration: 0.08, gain: distant ? 0.1 : 0.25, type: 'sine' });
    },
    dryFire() { tone({ freq: 1200, duration: 0.03, gain: 0.12 }); },
    reload() {
      tone({ freq: 500, duration: 0.04, gain: 0.15 });
      tone({ freq: 700, duration: 0.04, gain: 0.15, when: 0.25 });
    },
    hit() { tone({ freq: 900, duration: 0.05, gain: 0.3 }); },
    headshot() {
      tone({ freq: 1200, duration: 0.05, gain: 0.3 });
      tone({ freq: 1600, duration: 0.07, gain: 0.3, when: 0.05 });
    },
    kill() {
      tone({ freq: 660, duration: 0.07, gain: 0.3 });
      tone({ freq: 990, duration: 0.1, gain: 0.3, when: 0.07 });
    },
    hurt() { burst({ duration: 0.15, freq: 400, gain: 0.3 }); },
    explosion() {
      burst({ duration: 0.7, freq: 300, gain: 0.9 });
      tone({ freq: 90, end: 35, duration: 0.6, gain: 0.6, type: 'sine' });
    },
    plantBeep(final = false) {
      tone({ freq: final ? 1500 : 1000, duration: 0.09, gain: 0.25 });
    },
    defuseBeep() { tone({ freq: 800, duration: 0.06, gain: 0.2 }); },
    roundWin() {
      tone({ freq: 523, duration: 0.12, gain: 0.25 });
      tone({ freq: 659, duration: 0.12, gain: 0.25, when: 0.12 });
      tone({ freq: 784, duration: 0.2, gain: 0.25, when: 0.24 });
    },
    roundLose() {
      tone({ freq: 392, duration: 0.14, gain: 0.25 });
      tone({ freq: 311, duration: 0.22, gain: 0.25, when: 0.14 });
    },
    buy() { tone({ freq: 1000, duration: 0.05, gain: 0.2 }); },
    denied() { tone({ freq: 220, duration: 0.1, gain: 0.2 }); },
    step() { burst({ duration: 0.04, freq: 500, gain: 0.05 }); },
  };
}
