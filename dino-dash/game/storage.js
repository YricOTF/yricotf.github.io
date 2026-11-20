import { loadRun } from "./runner.js?v=2";
import { ACCESSORIES, SKINS, WARDROBE, unpackLook } from "./catalog.js?v=2";

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
  for (const item of WARDROBE) {
    const count = points(data.fragments?.[item.id]);
    if (item.cost && count) fragments[item.id] = Math.min(9999, count);
  }
  return {
    version: 2,
    best: points(data.best),
    total: points(data.total),
    fossils: points(data.fossils),
    unlocked: skins,
    accessories,
    skin: skins.includes(previous.skin) ? previous.skin : "classic",
    head: equipped("head") ? head : "",
    neck: equipped("neck") ? neck : "",
    fragments,
    universal: points(data.universal),
    chestOpened: data.chestOpened === true,
    sound: data.sound !== false,
    nick: typeof data.nick === "string" ? data.nick.slice(0, 16) : "",
    checkpoint: loadRun(data.checkpoint),
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
