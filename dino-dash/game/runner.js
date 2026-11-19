export const LANES = [-3, 0, 3];
export const RACE_METRES = 650;
export const RACE_LIMIT_MS = 65_000;
export const SKINS = [
  { id: "classic", name: "原色", item: "经典石墨色", cost: 0, body: "#383937", detail: "#525350" },
  { id: "cap", name: "探险队", item: "像素棒球帽", cost: 12, body: "#414240", detail: "#63645f" },
  { id: "scarf", name: "沙地旅人", item: "方格围巾", cost: 25, body: "#484946", detail: "#656662" },
  { id: "pale", name: "月岩", item: "浅灰岩纹皮肤", cost: 40, body: "#aaaba4", detail: "#c4c5bd" },
  { id: "visor", name: "夜巡", item: "单片护目镜", cost: 60, body: "#282927", detail: "#444641" },
  { id: "crown", name: "荒原冠军", item: "像素尖角冠", cost: 90, body: "#555653", detail: "#737470" },
];

const GROUP_SPACING = 23;
const FIRST_GROUP = 25;
const JUMP_TIME = 0.84;
const SLIDE_TIME = 0.86;
const MAX_SOLO_SPEED = 30;
const BASE_SPEED = 15;
const RACE_SPEED = 18;

export const tune = (a, b, t) => a + (b - a) * t;
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;

export function hash(seed, index) {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

const obstacleKinds = ["cactus", "boulder", "flyer", "ridge"];

export function trackGroup(seed, index) {
  const roll = n => hash(seed, index * 11 + n);
  const dist = FIRST_GROUP + index * GROUP_SPACING + (index ? roll(0) * 3 : 0);
  const safe = index === 0 ? (roll(2) < 0.5 ? 0 : 2) : Math.floor(roll(1) * 3);
  const other = [0, 1, 2].filter(lane => lane !== safe);
  const first = index === 0 ? 1 : other[Math.floor(roll(2) * 2)];
  const laneType = n => obstacleKinds[Math.floor(roll(n) * (index < 2 ? 2 : obstacleKinds.length))];
  const obstacles = [{ id: `${index}a`, kind: laneType(3), d: dist, lane: first }];
  if (index > 1 && roll(4) < 0.72) {
    obstacles.push({ id: `${index}b`, kind: laneType(5), d: dist + (roll(6) - 0.5) * 2.6, lane: other.find(lane => lane !== first) });
  }
  const fossilLane = index > 1 && roll(7) < 0.27 ? first : safe;
  const fossils = Array.from({ length: 4 }, (_, n) => ({
    id: `${index}f${n}`,
    lane: fossilLane,
    d: dist - 7 + n * 3.6,
    y: fossilLane === first && obstacles[0].kind !== "flyer" && (n === 2 || n === 3) ? 1.32 : 0.62,
  }));
  return { obstacles, fossils };
}

export function groupsNear(seed, distance, ahead = 110, behind = 14) {
  const start = Math.max(0, Math.floor((distance - behind - FIRST_GROUP) / GROUP_SPACING));
  const end = Math.ceil((distance + ahead - FIRST_GROUP) / GROUP_SPACING);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, n) => trackGroup(seed, start + n));
}

export function newRun(seed = randomSeed(), mode = "solo") {
  return {
    seed, mode, distance: 0, elapsed: 0, x: 0, lane: 1, jump: 0, slide: 0, y: 0,
    fossils: 0, picked: {}, hit: {}, flash: 0, slow: 0, phase: 0, done: false,
  };
}

export function loadRun(snapshot, mode = "solo") {
  if (!snapshot || typeof snapshot !== "object" || snapshot.mode !== mode || snapshot.done) return null;
  const fields = ["seed", "distance", "elapsed", "x", "lane", "jump", "slide", "y", "fossils", "phase"];
  if (fields.some(key => !Number.isFinite(snapshot[key]))) return null;
  const maxDistance = mode === "race" ? RACE_METRES : 10_000_000;
  if (snapshot.distance < 0 || snapshot.distance > maxDistance || snapshot.elapsed < 0 || ![0, 1, 2].includes(snapshot.lane)) return null;
  const run = newRun(snapshot.seed >>> 0, mode);
  Object.assign(run, Object.fromEntries(fields.map(k => [k, snapshot[k]])));
  run.x = clamp(run.x, -3, 3);
  run.jump = clamp(run.jump, 0, JUMP_TIME);
  run.slide = clamp(run.slide, 0, SLIDE_TIME);
  run.y = clamp(run.y, 0, 2.8);
  run.fossils = clamp(Math.floor(run.fossils), 0, 100_000);
  if (snapshot.picked && typeof snapshot.picked === "object") run.picked = { ...snapshot.picked };
  if (snapshot.hit && typeof snapshot.hit === "object") run.hit = { ...snapshot.hit };
  run.slow = Number.isFinite(snapshot.slow) ? clamp(snapshot.slow, 0, 1) : 0;
  return run;
}

export function control(run, move) {
  if (!run || run.done) return false;
  if (move === "left" || move === "right") {
    const lane = clamp(run.lane + (move === "left" ? -1 : 1), 0, 2);
    if (lane === run.lane) return false;
    run.lane = lane;
  } else if (move === "jump" && run.jump === 0) {
    run.slide = 0;
    run.jump = JUMP_TIME;
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

export function stepRun(run, dt, notify = () => {}) {
  if (run.done) return;
  const base = run.mode === "race" ? RACE_SPEED : Math.min(MAX_SOLO_SPEED, BASE_SPEED + run.distance / 58);
  const speed = base * (run.slow > 0 ? 0.43 : 1);
  const previous = run.distance;
  run.distance += speed * dt;
  run.elapsed += dt;
  run.phase += dt * (9 + speed * 0.38);
  run.flash = Math.max(0, run.flash - dt);
  run.slow = Math.max(0, run.slow - dt);
  run.jump = Math.max(0, run.jump - dt);
  run.slide = Math.max(0, run.slide - dt);
  run.y = run.jump ? 2.46 * Math.sin(Math.PI * run.jump / JUMP_TIME) : 0;
  run.x = tune(run.x, LANES[run.lane], 1 - Math.exp(-18 * dt));
  if (Math.abs(run.x - LANES[run.lane]) < 0.01) run.x = LANES[run.lane];

  const groups = groupsNear(run.seed, run.distance, 2, 5);
  for (const group of groups) {
    for (const fossil of group.fossils) {
      if (run.picked[fossil.id] != null || fossil.d < previous - 0.8 || fossil.d > run.distance + 0.8) continue;
      if (Math.abs(run.x - LANES[fossil.lane]) < 0.82 && Math.abs(fossil.y - (run.y + 0.72)) < 0.8) {
        run.picked[fossil.id] = fossil.d;
        run.fossils++;
        notify("fossil");
      }
    }
    for (const obstacle of group.obstacles) {
      if (run.hit[obstacle.id] != null || obstacle.d < previous - 0.55 || obstacle.d > run.distance + 0.75) continue;
      if (Math.abs(run.x - LANES[obstacle.lane]) > 0.88) continue;
      const clear = obstacle.kind === "flyer" ? run.slide > 0
        : run.y > (obstacle.kind === "cactus" ? 1.6 : obstacle.kind === "ridge" ? 0.99 : 1.16);
      if (clear) continue;
      run.hit[obstacle.id] = obstacle.d;
      notify("hit");
      if (run.mode === "solo") {
        run.done = true;
        return;
      }
      run.flash = 0.48;
      run.slow = 1;
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
