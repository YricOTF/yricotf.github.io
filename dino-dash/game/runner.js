import { advanceBoss, beginBoss, BOSSES, LANES, POWERUPS, restoreBoss, strikeBoss } from "./challenge.js?v=2";

export { LANES };
export { SKINS } from "./catalog.js?v=2";
export const RACE_METRES = 650;
export const RACE_LIMIT_MS = 65_000;
export const RACE_RULES = 2;

const GROUP_SPACING = 23;
const FIRST_GROUP = 25;
const JUMP_TIME = 0.84;
const HIGH_JUMP_TIME = 1.02;
const SLIDE_TIME = 0.86;
const MAX_SOLO_SPEED = 30;
const BASE_SPEED = 15;
const RACE_SPEED = 18;
const BOSS_BUFFER_M = 16;
const POWER_IDS = Object.keys(POWERUPS);
const obstacleKinds = ["cactus", "boulder", "flyer", "ridge"];

export const tune = (a, b, t) => a + (b - a) * t;
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;

export function hash(seed, index) {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function trackGroup(seed, index, mode = "solo", rules = RACE_RULES) {
  const roll = n => hash(seed, index * 11 + n);
  const dist = FIRST_GROUP + index * GROUP_SPACING + (index ? roll(0) * 3 : 0);
  if (mode === "solo" && BOSSES.some(boss => Math.abs(dist - boss.distance) <= BOSS_BUFFER_M)) {
    return { obstacles: [], fossils: [], powers: [] };
  }
  const safe = index === 0 ? (roll(2) < 0.5 ? 0 : 2) : Math.floor(roll(1) * 3);
  const other = [0, 1, 2].filter(lane => lane !== safe);
  const first = index === 0 ? 1 : other[Math.floor(roll(2) * 2)];
  const meteor = rules >= RACE_RULES && (index === 4 || index > 6 && (index % 5 === 4 || roll(10) > 0.83));
  const laneType = n => obstacleKinds[Math.floor(roll(n) * (index < 2 ? 2 : obstacleKinds.length))];
  const obstacles = [{ id: `${index}a`, kind: meteor ? "meteor" : laneType(3), d: dist, lane: first }];
  if (index > 1 && (meteor ? roll(4) < 0.5 : roll(4) < 0.72)) {
    obstacles.push({ id: `${index}b`, kind: laneType(5), d: dist + (roll(6) - 0.5) * 2.6, lane: other.find(lane => lane !== first) });
  }
  const fossilLane = !meteor && index > 1 && roll(7) < 0.27 ? first : safe;
  const fossils = Array.from({ length: 4 }, (_, n) => ({
    id: `${index}f${n}`,
    lane: fossilLane,
    d: dist - 7 + n * 3.6,
    y: fossilLane === first && obstacles[0].kind !== "flyer" && (n === 2 || n === 3) ? 1.32 : 0.62,
  }));
  const powers = rules >= RACE_RULES && (index === 1 || index > 1 && index % 4 === 0) ? [{
    id: `${index}p`, kind: index === 1 ? "shield" : POWER_IDS[Math.floor(roll(9) * POWER_IDS.length)],
    lane: safe, d: dist - 2.5, y: 0.95,
  }] : [];
  return { obstacles, fossils, powers };
}

export function groupsNear(seed, distance, ahead = 110, behind = 14, mode = "solo", rules = RACE_RULES) {
  const start = Math.max(0, Math.floor((distance - behind - FIRST_GROUP) / GROUP_SPACING));
  const end = Math.ceil((distance + ahead - FIRST_GROUP) / GROUP_SPACING);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, n) => trackGroup(seed, start + n, mode, rules));
}

export function newRun(seed = randomSeed(), mode = "solo", rules = RACE_RULES) {
  return {
    seed, mode, rules, distance: 0, elapsed: 0, x: 0, lane: 1, jump: 0, slide: 0, y: 0, boostJump: false,
    fossils: 0, picked: {}, hit: {}, flash: 0, slow: 0, phase: 0, done: false, powers: {},
    boss: null, nextBoss: 0, bossWins: 0, grace: 0, practice: false, won: false,
  };
}

export function newPractice(index) {
  if (!BOSSES[index]) return null;
  const run = newRun();
  run.practice = true;
  run.nextBoss = index;
  run.distance = BOSSES[index].distance;
  run.boss = beginBoss(index);
  return run;
}

export function loadRun(snapshot, mode = "solo") {
  if (!snapshot || typeof snapshot !== "object" || snapshot.mode !== mode || snapshot.done || snapshot.practice) return null;
  const fields = ["seed", "distance", "elapsed", "x", "lane", "jump", "slide", "y", "fossils", "phase"];
  if (fields.some(key => !Number.isFinite(snapshot[key]))) return null;
  const maxDistance = mode === "race" ? RACE_METRES : 10_000_000;
  if (snapshot.distance < 0 || snapshot.distance > maxDistance || snapshot.elapsed < 0 || ![0, 1, 2].includes(snapshot.lane)) return null;
  const run = newRun(snapshot.seed >>> 0, mode, mode === "race" && snapshot.rules !== RACE_RULES ? 1 : RACE_RULES);
  Object.assign(run, Object.fromEntries(fields.map(k => [k, snapshot[k]])));
  run.x = clamp(run.x, -3, 3);
  run.boostJump = snapshot.boostJump === true;
  run.jump = clamp(run.jump, 0, run.boostJump ? HIGH_JUMP_TIME : JUMP_TIME);
  run.slide = clamp(run.slide, 0, SLIDE_TIME);
  run.y = clamp(run.y, 0, 3.5);
  run.fossils = clamp(Math.floor(run.fossils), 0, 100_000);
  if (snapshot.picked && typeof snapshot.picked === "object") run.picked = { ...snapshot.picked };
  if (snapshot.hit && typeof snapshot.hit === "object") run.hit = { ...snapshot.hit };
  run.slow = Number.isFinite(snapshot.slow) ? clamp(snapshot.slow, 0, 1) : 0;
  run.grace = Number.isFinite(snapshot.grace) ? clamp(snapshot.grace, 0, 1) : 0;
  for (const id of POWER_IDS) {
    const seconds = snapshot.powers?.[id];
    if (Number.isFinite(seconds) && seconds > 0) run.powers[id] = clamp(seconds, 0, POWERUPS[id].duration);
  }
  if (mode === "solo") {
    const passed = BOSSES.filter(boss => boss.distance < snapshot.distance - 0.01).length;
    run.nextBoss = Number.isInteger(snapshot.nextBoss) ? clamp(snapshot.nextBoss, passed, BOSSES.length) : passed;
    run.boss = restoreBoss(snapshot.boss, run.distance);
    if (run.boss) run.nextBoss = run.boss.index;
    run.bossWins = Number.isInteger(snapshot.bossWins) ? clamp(snapshot.bossWins, 0, run.nextBoss) : 0;
  }
  return run;
}

export function control(run, move, notify = () => {}) {
  if (!run || run.done) return false;
  if (move === "strike") return strikeBoss(run, notify);
  if (move === "left" || move === "right") {
    const lane = clamp(run.lane + (move === "left" ? -1 : 1), 0, 2);
    if (lane === run.lane) return false;
    run.lane = lane;
  } else if (move === "jump" && run.jump === 0) {
    run.slide = 0;
    run.boostJump = !!run.powers.feather;
    run.jump = run.boostJump ? HIGH_JUMP_TIME : JUMP_TIME;
  } else if (move === "slide" && run.slide === 0) {
    run.jump = 0;
    run.y = 0;
    run.slide = SLIDE_TIME;
  } else {
    return false;
  }
  return true;
}

function trimPassed(items, distance) {
  for (const [id, d] of Object.entries(items)) {
    if (!Number.isFinite(d) || d < distance - 45 || d > distance + 10) delete items[id];
  }
}

function damage(run, cause, notify) {
  if (run.grace > 0) return;
  if (run.powers.shield) {
    delete run.powers.shield;
    run.grace = 0.55;
    run.flash = 0.48;
    notify("shield", cause);
    return;
  }
  run.lastHit = cause;
  notify("hit", cause);
  if (run.mode === "solo") {
    run.done = true;
    return;
  }
  run.flash = 0.48;
  run.slow = 1;
}

function pickups(run, group, previous, notify) {
  for (const power of group.powers) {
    if (run.picked[power.id] != null || power.d < previous - 1 || power.d > run.distance + 0.8
      || Math.abs(run.x - LANES[power.lane]) >= 0.9 || Math.abs(power.y - (run.y + 0.72)) >= 1.15) continue;
    run.picked[power.id] = power.d;
    run.powers[power.kind] = POWERUPS[power.kind].duration;
    notify("power", power.kind);
  }
  const magnet = !!run.powers.magnet;
  for (const fossil of group.fossils) {
    if (run.picked[fossil.id] != null || fossil.d < previous - 0.8 || fossil.d > run.distance + (magnet ? 3.8 : 0.8)) continue;
    if (!magnet && (Math.abs(run.x - LANES[fossil.lane]) >= 0.82 || Math.abs(fossil.y - (run.y + 0.72)) >= 0.8)) continue;
    run.picked[fossil.id] = fossil.d;
    run.fossils += run.powers.amber ? 2 : 1;
    notify("fossil");
  }
}

function cleared(run, obstacle) {
  if (obstacle.kind === "meteor") return false;
  if (obstacle.kind === "flyer") return run.slide > 0;
  return run.y > (obstacle.kind === "cactus" ? 1.6 : obstacle.kind === "ridge" ? 0.99 : 1.16);
}

export function stepRun(run, dt, notify = () => {}) {
  if (run.done) return;
  const base = run.mode === "race" ? RACE_SPEED : Math.min(MAX_SOLO_SPEED, BASE_SPEED + run.distance / 58);
  const speed = base * (run.slow > 0 ? 0.43 : 1);
  const previous = run.distance;
  run.elapsed += dt;
  run.phase += dt * (9 + speed * 0.38);
  run.flash = Math.max(0, run.flash - dt);
  run.slow = Math.max(0, run.slow - dt);
  run.grace = Math.max(0, run.grace - dt);
  run.jump = Math.max(0, run.jump - dt);
  run.slide = Math.max(0, run.slide - dt);
  const jumpTime = run.boostJump ? HIGH_JUMP_TIME : JUMP_TIME;
  run.y = run.jump ? (run.boostJump ? 3.22 : 2.46) * Math.sin(Math.PI * run.jump / jumpTime) : 0;
  run.x = tune(run.x, LANES[run.lane], 1 - Math.exp(-28 * dt));
  if (Math.abs(run.x - LANES[run.lane]) < 0.01) run.x = LANES[run.lane];
  for (const id of POWER_IDS) {
    if (run.powers[id] === undefined) continue;
    run.powers[id] -= dt;
    if (run.powers[id] <= 0) delete run.powers[id];
  }

  if (run.boss) {
    advanceBoss(run, dt, speed, cause => damage(run, cause, notify), notify);
    return;
  }

  run.distance += speed * dt;
  const upcoming = run.mode === "solo" ? BOSSES[run.nextBoss] : null;
  if (upcoming && run.distance >= upcoming.distance) {
    run.distance = upcoming.distance;
    run.boss = beginBoss(run.nextBoss);
    notify("boss-enter", upcoming);
    return;
  }

  const groups = groupsNear(run.seed, run.distance, 6, 5, run.mode, run.rules);
  for (const group of groups) {
    pickups(run, group, previous, notify);
    for (const obstacle of group.obstacles) {
      if (run.hit[obstacle.id] != null || obstacle.d < previous - 0.55 || obstacle.d > run.distance + 0.75) continue;
      if (Math.abs(run.x - LANES[obstacle.lane]) > (obstacle.kind === "meteor" ? 1.18 : 0.88) || cleared(run, obstacle)) continue;
      run.hit[obstacle.id] = obstacle.d;
      damage(run, obstacle.kind, notify);
      if (run.done) return;
    }
  }
  if (run.mode === "race" && run.distance >= RACE_METRES) {
    run.distance = RACE_METRES;
    run.done = true;
  }
  if (Math.floor(previous / 25) !== Math.floor(run.distance / 25)) {
    trimPassed(run.picked, run.distance);
    trimPassed(run.hit, run.distance);
  }
}
