const themes = {
  menu: { bpm: 88, roots: [48, 45, 41, 43], notes: [60, 64, 67, 0, 69, 67, 64, 0, 62, 65, 69, 72, 67, 65, 62, 0] },
  wild: { bpm: 114, roots: [45, 48, 43, 40], notes: [57, 60, 64, 0, 67, 64, 60, 0, 55, 59, 62, 0, 64, 62, 59, 0] },
  jungle: { bpm: 124, roots: [50, 53, 48, 45], notes: [62, 0, 65, 69, 0, 67, 65, 0, 60, 64, 0, 67, 69, 0, 67, 64] },
  cave: { bpm: 96, roots: [45, 41, 43, 40], notes: [57, 0, 60, 0, 64, 0, 63, 60, 55, 0, 58, 0, 62, 0, 60, 56] },
  boss: { bpm: 142, roots: [45, 46, 43, 40], notes: [57, 0, 64, 60, 57, 0, 65, 64, 55, 0, 62, 58, 56, 0, 59, 64] },
};

const effects = {
  jump: [212, 424, .14], slide: [250, 83, .22], lane: [172, 221, .065], fossil: [740, 1120, .105], hit: [228, 53, .29],
  tick: [440, 440, .081], go: [600, 900, .148], unlock: [470, 920, .21], shop: [440, 880, .19],
  chain: [570, 1420, .21], ride: [275, 645, .20], feint: [185, 92, .16],
  power: [325, 960, .18], shield: [490, 154, .22], "boss-strike": [190, 82, .25], "boss-dodge": [438, 611, .12],
  "boss-clear": [490, 1170, .27], "boss-enter": [125, 340, .25], "boss-orb": [330, 990, .25],
  skill: [435, 770, .11], "ride-clear": [590, 1140, .21], chest: [145, 477, .26],
};
const hz = midi => 440 * 2 ** ((midi - 69) / 12);

export class Sound {
  configure(settings) {
    this.settings = settings;
    this.mix();
  }

  mix() {
    if (!this.context || !this.settings) return;
    const now = this.context.currentTime;
    const audio = this.settings;
    this.music.gain.setTargetAtTime(audio.music && this.theme ? audio.musicVolume / 100 : 0, now, .032);
    this.effects.gain.setTargetAtTime(audio.effects ? audio.effectsVolume / 100 : 0, now, .025);
  }

  unlock() {
    if (!this.settings?.effects && !this.settings?.music) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      if (!this.context) {
        const ctx = new Audio();
        this.music = ctx.createGain();
        this.effects = ctx.createGain();
        for (const bus of [this.music, this.effects]) {
          bus.gain.value = 0;
          bus.connect(ctx.destination);
        }
        this.context = ctx;
        this.mix();
      }
      if (this.context.state !== "running") this.context.resume().catch(() => {});
    } catch {
      this.context = null;
    }
  }

  tone(bus, type, start, end, length, volume, when) {
    const ctx = this.context;
    const source = ctx.createOscillator();
    const envelope = ctx.createGain();
    source.type = type;
    source.frequency.setValueAtTime(start, when);
    source.frequency.exponentialRampToValueAtTime(end, when + length);
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.linearRampToValueAtTime(volume, when + .008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + length);
    source.connect(envelope).connect(bus);
    source.start(when);
    source.stop(when + length + .008);
    source.onended = () => { source.disconnect(); envelope.disconnect(); };
  }

  play(which) {
    if (!this.settings?.effects || !this.settings.effectsVolume || this.context?.state !== "running" || !effects[which]) return;
    const [start, end, length] = effects[which];
    const when = this.context.currentTime + .005;
    this.tone(this.effects, which === "hit" || which === "slide" ? "sawtooth" : "triangle", start, end, length, .17, when);
    if (["chest", "chain", "boss-clear", "power"].includes(which)) {
      this.tone(this.effects, "square", start * 1.5, end * 1.25, length * .88, .038, when + .075);
    }
  }

  update(theme) {
    if (theme !== this.theme) {
      this.theme = theme;
      this.beat = 0;
      this.next = 0;
      this.mix();
    }
    if (!theme || !this.settings?.music || !this.settings.musicVolume || this.context?.state !== "running") return;
    const now = this.context.currentTime;
    if (this.next < now) this.next = now + .03;
    const song = themes[theme];
    const step = 30 / song.bpm;
    while (this.next < now + .16) {
      const i = this.beat % 16;
      const root = song.roots[Math.floor((this.beat % 32) / 8)];
      const pitch = song.notes[i];
      const when = this.next;
      if (pitch) this.tone(this.music, theme === "cave" ? "sine" : "triangle", hz(pitch), hz(pitch), step * .84, .18, when);
      if (i % 2 === 0) this.tone(this.music, "triangle", hz(root + (i % 8 === 4 ? 7 : 0)), hz(root), step * 1.10, .15, when);
      if (i % 4 === 0 && theme !== "menu") this.tone(this.music, "sine", 99, 42, .10, .21, when);
      if (i % 4 === 2 && (theme === "jungle" || theme === "boss")) this.tone(this.music, "square", 212, 106, .055, .035, when);
      this.beat++;
      this.next += step;
    }
  }

  dispose() {
    this.context?.close().catch(() => {});
  }
}
