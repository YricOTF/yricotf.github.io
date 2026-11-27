import { loadRun } from "./runner.js?v=16";
import { ACCESSORIES, OPENING_BOOSTS, restoreRewards, SHARD_RECYCLE, SKINS, WARDROBE, unpackLook } from "./catalog.js?v=16";

const KEY = "dino-dash.save.v1";

const json = value => {
  try { return JSON.parse(value); } catch { return null; }
};

export function readSession(key) {
  try { return json(sessionStorage.getItem(key)); } catch { return null; }
}

export function writeSession(key, value) {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    return false;
  }
  return true;
}

function points(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))) : 0;
}

export function normalizeAudio(audio, enabled = true) {
  const volume = (value, fallback) => Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback;
  const toggle = value => typeof value === "boolean" ? value : enabled;
  return { music: toggle(audio?.music), effects: toggle(audio?.effects),
    musicVolume: volume(audio?.musicVolume, 40), effectsVolume: volume(audio?.effectsVolume, 72) };
}

export function normalizeSave(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const unlocked = Array.isArray(data.unlocked) ? data.unlocked : [];
  const previousGear = data.version === 2 && Array.isArray(data.accessories) ? data.accessories : unlocked;
  const skins = SKINS.filter(item => item.id === "classic" || unlocked.includes(item.id)).map(item => item.id);
  const accessories = ACCESSORIES.filter(item => previousGear.includes(item.id)).map(item => item.id);
  const previous = unpackLook(data.skin);
  const head = data.version === 2 ? data.head : previous.head;
  const neck = data.version === 2 ? data.neck : previous.neck;
  const equipped = slot => ACCESSORIES.some(item => item.slot === slot && item.id === (slot === "head" ? head : neck) && accessories.includes(item.id));
  const fragments = {};
  let recycled = 0;
  for (const item of WARDROBE) {
    const count = points(data.fragments?.[item.id]);
    if (!item.cost || !count) continue;
    const owned = (item.slot ? accessories : skins).includes(item.id);
    const stored = owned ? 0 : Math.min(item.cost, count);
    if (stored) fragments[item.id] = stored;
    recycled += (count - stored) * SHARD_RECYCLE;
  }
  const boosts = Object.fromEntries(Object.keys(OPENING_BOOSTS).map(id => [id, Math.min(9999, points(data.boosts?.[id]))]));
  return {
    version: 2,
    best: points(data.best),
    bestScore: points(data.bestScore),
    total: points(data.total),
    fossils: points(points(data.fossils) + recycled),
    unlocked: skins,
    accessories,
    skin: skins.includes(previous.skin) ? previous.skin : "classic",
    head: equipped("head") ? head : "",
    neck: equipped("neck") ? neck : "",
    fragments,
    universal: points(data.universal),
    boosts,
    boostSelected: boosts[data.boostSelected] > 0 ? data.boostSelected : "",
    chestReceipt: restoreRewards(data.chestReceipt),
    chestOpened: data.chestOpened === true,
    audio: normalizeAudio(data.audio, data.sound !== false),
    nick: typeof data.nick === "string" ? Array.from(data.nick).slice(0, 16).join("") : "",
    checkpoint: loadRun(data.checkpoint),
    lessons: ["river", "rail"].filter(kind => Array.isArray(data.lessons) && data.lessons.includes(kind)),
    races: Array.isArray(data.races) ? data.races.filter(v => typeof v === "string" && v.length <= 16).slice(-30) : [],
    savedAt: points(data.savedAt),
  };
}

export class Save {
  constructor() {
    this.current = normalizeSave();
    this.available = true;
    this.read();
  }

  read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.current = normalizeSave(json(raw));
    } catch {
      this.available = false;
    }
    return this.current;
  }

  exclusive(fn) {
    return globalThis.navigator?.locks ? navigator.locks.request(KEY, fn) : Promise.resolve().then(fn);
  }

  change(fn) {
    const data = this.read();
    fn(data);
    data.savedAt = Date.now();
    return this.write(data);
  }

  write(data) {
    this.current = data;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.current;
  }

  matches(event) {
    return event.key === KEY;
  }
}
