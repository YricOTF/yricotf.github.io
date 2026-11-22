import { courseGroup, FIRST_GROUP, flightPose, GROUP_SPACING, hash, isFlyer, rideHeight, rideLength, trackDistance } from "./course.js?v=5";
import { advanceBoss, battleRoute, beginBoss, BOSSES, collectStrike, LANES, POWERUPS, restoreBoss } from "./challenge.js?v=5";
import { cruisingSpeed, HIGH_JUMP_TIME, JUMP_TIME, jumpHeight, VINE_GAP_END, VINE_GAP_START, VINE_GRAB_END, VINE_GRAB_START, VINE_GRIP } from "./movement.js?v=5";

export { LANES, hash };
export { SKINS } from "./catalog.js?v=5";
export const RACE_METRES = 650;
export const RACE_LIMIT_MS = 65_000;
export const RACE_RULES = 5;

const SLIDE_TIME = 0.86;
export const ARENA_LEAD = 54;
export const ARENA_EXIT = 44;
export const ARENA_BOSS_DEPTH = 28.7;
const bossSites = BOSSES.map(boss => boss.distance);
const oldBossSites = [150, 375, 665];
const shortBossSites = [150, 620, 1020];
export const arenaSites = route => route === 4 ? shortBossSites : route === true || Number.isInteger(route) && route <= 3 ? oldBossSites : bossSites;
const POWER_IDS = Object.keys(POWERUPS);
const obstacleKinds = ["cactus", "boulder", "flyer", "ridge"];

export const tune = (a, b, t) => a + (b - a) * t;
export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0] || 1;
export const runScore = run => (run.practice ? 0 : Math.floor(run.distance) * 2) + run.fossils * 4 + run.bonus;

export function deathStyle(kind) {
  if (kind === "meteor") return ["meteor", 1.48];
  if (kind === "boss-charge") return ["charge", 1.35];
  if (kind === "boss-sweep") return ["sweep", 1.24];
  if (["vine", "mud", "washout", "rift"].includes(kind)) return ["fall", 1.28];
  if (isFlyer(kind) || kind === "flyer") return ["air", 1.16];
  if (["branch", "stalactite", "beam", "pod", "lowgate"].includes(kind)) return ["overhead", 1.09];
  if (["minecart", "cart", "thorn", "pillar", "idol", "cactus"].includes(kind)) return ["crash", 1.13];
  return ["trip", 1.10];
}

export function normalizeRaceRules(value) {
  return Number.isInteger(value) && value >= 1 && value <= RACE_RULES ? value : 1;
}

export function trackGroup(seed, index, mode = "solo", rules = RACE_RULES, arenaRoute = rules) {
  const roll = n => hash(seed, index * 11 + n);
  const dist = trackDistance(seed, index);
  const spanAhead = rules >= 5 ? 15 : 13;
  const spanBehind = rules >= 5 ? 15 : 8;
  if (mode === "solo" && arenaSites(arenaRoute).some(site => rules < 4 ? Math.abs(dist - site) <= 16
    : dist + spanAhead >= site - ARENA_LEAD && dist - spanBehind <= site + ARENA_EXIT)) {
    return { obstacles: [], fossils: [], powers: [] };
  }
  if (rules >= 3) return courseGroup(seed, index, mode, dist, roll, POWER_IDS, rules);
  const safe = index === 0 ? (roll(2) < 0.5 ? 0 : 2) : Math.floor(roll(1) * 3);
  const other = [0, 1, 2].filter(lane => lane !== safe);
  const first = index === 0 ? 1 : other[Math.floor(roll(2) * 2)];
  const meteor = rules >= 2 && (index === 4 || index > 6 && (index % 5 === 4 || roll(10) > 0.83));
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
  const powers = rules >= 2 && (index === 1 || index > 1 && index % 4 === 0) ? [{
    id: `${index}p`, kind: index === 1 ? "shield" : POWER_IDS[Math.floor(roll(9) * POWER_IDS.length)],
    lane: safe, d: dist - 2.5, y: 0.95,
  }] : [];
  return { obstacles, fossils, powers };
}

export function groupsNear(seed, distance, ahead = 110, behind = 17, mode = "solo", rules = RACE_RULES, arenaRoute = rules) {
  const start = Math.max(0, Math.floor((distance - behind - FIRST_GROUP) / GROUP_SPACING));
  const end = Math.ceil((distance + ahead - FIRST_GROUP) / GROUP_SPACING);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, n) => trackGroup(seed, start + n, mode, rules, arenaRoute));
}

export function newRun(seed = randomSeed(), mode = "solo", rules = RACE_RULES) {
  return {
    seed, mode, rules, distance: 0, elapsed: 0, x: 0, lane: 1, jump: 0, slide: 0, y: 0, boostJump: false,
    fossils: 0, bonus: 0, picked: {}, hit: {}, passed: {}, flash: 0, slow: 0, phase: 0, done: false, death: null, powers: {},
    ride: null, boss: null, nextBoss: 0, bossWins: 0, arenaRoute: rules, grace: 0, practice: false, won: false,
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
  const run = newRun(snapshot.seed >>> 0, mode, mode === "race" ? normalizeRaceRules(snapshot.rules) : RACE_RULES);
  Object.assign(run, Object.fromEntries(fields.map(k => [k, snapshot[k]])));
  run.x = clamp(run.x, -3, 3);
  run.boostJump = snapshot.boostJump === true;
  run.jump = clamp(run.jump, 0, run.boostJump ? HIGH_JUMP_TIME : JUMP_TIME);
  run.slide = clamp(run.slide, 0, SLIDE_TIME);
  run.y = clamp(run.y, 0, 3.5);
  run.fossils = clamp(Math.floor(run.fossils), 0, 100_000);
  run.bonus = Number.isFinite(snapshot.bonus) ? clamp(Math.floor(snapshot.bonus), 0, 50_000_000) : 0;
  if (snapshot.picked && typeof snapshot.picked === "object") run.picked = { ...snapshot.picked };
  if (snapshot.hit && typeof snapshot.hit === "object") run.hit = { ...snapshot.hit };
  if (snapshot.passed && typeof snapshot.passed === "object") run.passed = { ...snapshot.passed };
  run.slow = Number.isFinite(snapshot.slow) ? clamp(snapshot.slow, 0, 1) : 0;
  run.grace = Number.isFinite(snapshot.grace) ? clamp(snapshot.grace, 0, 1) : 0;
  for (const id of POWER_IDS) {
    const seconds = snapshot.powers?.[id];
    if (Number.isFinite(seconds) && seconds > 0) run.powers[id] = clamp(seconds, 0, POWERUPS[id].duration);
  }
  const ride = snapshot.ride;
  if (run.rules >= 3 && ride && ["vine", "minecart"].includes(ride.kind) && [0, 1, 2].includes(ride.lane)
    && Number.isFinite(ride.d) && run.distance >= ride.d + (run.rules >= 5 ? VINE_GRAB_START : -0.8) && run.distance < ride.d + rideLength(ride.kind)) {
    run.ride = { kind: ride.kind, lane: ride.lane, d: ride.d, side: ride.side === -1 ? -1 : 1 };
    if (Number.isFinite(ride.grabD) && Number.isFinite(ride.grabY)) {
      run.ride.grabD = clamp(ride.grabD, ride.d + VINE_GRAB_START, Math.min(ride.d + VINE_GRAB_END, run.distance));
      run.ride.grabY = clamp(ride.grabY, 0, 3.25);
    }
  }
  if (mode === "solo") {
    run.arenaRoute = Number.isInteger(snapshot.arenaRoute) && [3, 4, 5].includes(snapshot.arenaRoute) ? snapshot.arenaRoute
      : snapshot.legacyBossRoute === true || snapshot.rules < 4 || snapshot.rules === undefined ? 3 : snapshot.rules === 4 ? 4 : 5;
    if (snapshot.rules !== RACE_RULES) run.grace = Math.max(run.grace, 0.8);
    const sites = arenaSites(run.arenaRoute);
    const passed = sites.filter(site => site < snapshot.distance - 0.01).length;
    run.nextBoss = Number.isInteger(snapshot.nextBoss) ? clamp(snapshot.nextBoss, passed, BOSSES.length) : passed;
    run.boss = restoreBoss(snapshot.boss, run.distance, sites[snapshot.boss?.index]);
    if (run.boss) {
      run.nextBoss = run.boss.index;
      if (snapshot.rules !== RACE_RULES && run.boss.hp > 0) Object.assign(run.boss, { phase: "intro", age: 0, lanes: [], routeMask: 0 });
    }
    run.bossWins = Number.isInteger(snapshot.bossWins) ? clamp(snapshot.bossWins, 0, run.nextBoss) : 0;
    if (snapshot.death && typeof snapshot.death.kind === "string" && Number.isFinite(snapshot.death.age)) {
      const kind = snapshot.death.kind.slice(0, 18);
      const [style, duration] = deathStyle(kind);
      run.lastHit = kind;
      run.death = { kind, style, duration, age: clamp(snapshot.death.age, 0, duration), side: snapshot.death.side === -1 ? -1 : 1 };
    }
  }
  return run;
}

export function control(run, move, notify = () => {}) {
  if (!run || run.done || run.death) return false;
  if (run.ride) return false;
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
    const [style, duration] = deathStyle(cause);
    run.death = { kind: cause, style, duration, age: 0, side: run.x > 0.2 ? -1 : run.x < -0.2 ? 1 : run.seed % 2 ? -1 : 1 };
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
    const modern = run.rules >= 5;
    const reachY = run.y + (modern && run.slide > 0 ? 0.50 : 0.72);
    if (!magnet && (Math.abs(run.x - (fossil.x ?? LANES[fossil.lane])) >= (modern ? 1.28 : 0.94)
      || Math.abs(fossil.y - reachY) >= (modern ? 0.99 : 0.8))) continue;
    run.picked[fossil.id] = fossil.d;
    run.fossils += run.powers.amber ? 2 : 1;
    notify("fossil");
    if (fossil.chain != null && group.fossils.every(item => item.chain !== fossil.chain || run.picked[item.id] != null)) {
      run.fossils += modern ? 5 : 3;
      if (modern) run.bonus += 60;
      notify("chain", modern ? 60 : undefined);
    }
  }
}

function cleared(run, obstacle) {
  if (["meteor", "thorn", "idol", "pillar"].includes(obstacle.kind)) return false;
  if (["flyer", "branch", "stalactite", "beam", "pod", "lowgate"].includes(obstacle.kind)) return run.slide > 0;
  if (["mud", "washout", "rift"].includes(obstacle.kind)) return run.y > 0.88;
  if (obstacle.kind === "hurdle") return run.y > 0.90;
  if (obstacle.kind === "cart") return run.y > 1.48;
  if (obstacle.kind === "vine") return run.y > 0.93;
  return run.y > (obstacle.kind === "cactus" ? 1.6 : obstacle.kind === "ridge" ? 0.99 : 1.16);
}

function contact(run, obstacle, relative) {
  if (isFlyer(obstacle.kind)) {
    const pose = flightPose(obstacle, relative);
    if (Math.abs(pose.z) > 1.02 || Math.abs(run.x - pose.x) > 1.02) return 0;
    return run.slide > 0 && pose.y >= 1.25 || run.y > pose.y + 0.36 ? 1 : 2;
  }
  const z = relative * (obstacle.kind === "cart" ? 1.25 : 1);
  const gap = obstacle.kind === "mud" || obstacle.kind === "washout";
  const span = obstacle.kind === "rift" ? 2.55 : gap ? 1.5 : 0.72;
  const tail = gap && run.rules < 5 ? 1.35 : span - 0.04;
  if (z < -span || z > tail || Math.abs(run.x - LANES[obstacle.lane]) > (obstacle.kind === "meteor" ? 1.18 : 0.89)) return 0;
  return cleared(run, obstacle) ? 1 : 2;
}

function rideContact(run, obstacle, z, notify) {
  const vine = obstacle.kind === "vine";
  const modern = run.rules >= 5;
  if (Math.abs(run.x - LANES[obstacle.lane]) > (modern ? 1.06 : 0.91)) return 0;
  const start = modern ? (vine ? VINE_GRAB_START : -1.4) : -0.7;
  const end = modern ? (vine ? VINE_GRAB_END : 1.46) : vine ? 4.6 : 1.3;
  if (!run.ride && z >= start && z <= end && run.jump > 0 && (modern && vine
    ? run.y >= 0.46 && Math.abs(run.y + 1.25 - VINE_GRIP) < 1.55 : run.y > 1.08 && z < 1.7)) {
    run.lane = obstacle.lane;
    run.x = LANES[obstacle.lane];
    run.jump = 0;
    run.slide = 0;
    run.ride = { kind: obstacle.kind, lane: obstacle.lane, d: obstacle.d, side: Math.sign(run.x) || obstacle.side };
    if (modern && vine) Object.assign(run.ride, { grabD: run.distance, grabY: run.y });
    else run.y = rideHeight(obstacle.kind, z / rideLength(obstacle.kind), run.rules);
    run.hit[obstacle.id] = obstacle.d;
    notify("ride");
    return 0;
  }
  if (vine && modern) return z >= VINE_GAP_START && z <= VINE_GAP_END && run.y < 0.67 ? 2 : 0;
  return z >= 0 && z <= end && !cleared(run, obstacle) ? 2 : 0;
}

function mastery(run, notify) {
  run.bonus += 24;
  run.fossils += 2;
  notify("skill", 24);
}

function playBossRoute(run, notify) {
  const state = run.boss;
  const route = battleRoute(state);
  if (!route || state.phase !== "exposed") return;
  for (const [i, obstacle] of route.obstacles.entries()) {
    if (state.routeMask & (1 << i)) continue;
    const z = route.distance - obstacle.d;
    const result = contact(run, obstacle, z);
    if (result === 2 || result === 1 && z >= 0) {
      state.routeMask |= 1 << i;
      if (result === 2) damage(run, obstacle.kind, notify);
      else mastery(run, notify);
      if (run.death) return;
    }
  }
  const pick = route.attack;
  if (Math.abs(route.distance - pick.d) < 1.07 && Math.abs(run.x - LANES[pick.lane]) < 1.11 && Math.abs(pick.y - (run.y + 0.65)) < 1.58) {
    collectStrike(run, notify);
  }
}

export function stepRun(run, dt, notify = () => {}) {
  if (run.done) return;
  if (run.death) {
    run.death.age = Math.min(run.death.duration, run.death.age + dt);
    run.done = run.death.age >= run.death.duration;
    return;
  }
  const base = cruisingSpeed(run.distance, run.mode);
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
  run.y = jumpHeight(jumpTime - run.jump, run.boostJump);
  run.x = tune(run.x, LANES[run.lane], 1 - Math.exp(-28 * dt));
  if (Math.abs(run.x - LANES[run.lane]) < 0.01) run.x = LANES[run.lane];
  for (const id of POWER_IDS) {
    if (run.powers[id] === undefined) continue;
    run.powers[id] -= dt;
    if (run.powers[id] <= 0) delete run.powers[id];
  }

  if (run.boss) {
    advanceBoss(run, dt, cause => damage(run, cause, notify), notify);
    if (run.boss && !run.death) playBossRoute(run, notify);
    return;
  }

  run.distance += speed * dt;
  if (run.ride) {
    const { kind, lane, d, grabD, grabY } = run.ride;
    const progress = (run.distance - d) / rideLength(kind);
    if (progress >= 1) {
      run.ride = null;
      run.y = 0;
      if (run.rules >= 5) {
        run.bonus += 90;
        run.fossils += 3;
        notify("ride-clear", 90);
      }
    } else {
      run.x = LANES[lane];
      run.y = rideHeight(kind, progress, run.rules);
      if (grabD !== undefined) run.y = tune(grabY, run.y, clamp((run.distance - grabD) / 3.4, 0, 1));
    }
  }
  const site = run.mode === "solo" ? arenaSites(run.arenaRoute)[run.nextBoss] : undefined;
  if (site !== undefined && run.distance >= site) {
    run.distance = site;
    run.ride = null;
    run.boss = beginBoss(run.nextBoss);
    notify("boss-enter", BOSSES[run.nextBoss]);
    return;
  }

  const groups = groupsNear(run.seed, run.distance, 17, 20, run.mode, run.rules, run.arenaRoute);
  for (const group of groups) {
    pickups(run, group, previous, notify);
    for (const obstacle of group.obstacles) {
      if (run.hit[obstacle.id] != null) continue;
      const z = run.distance - obstacle.d;
      const result = obstacle.kind === "vine" || obstacle.kind === "minecart" ? rideContact(run, obstacle, z, notify) : contact(run, obstacle, z);
      if (result === 1 && obstacle.risk && run.passed[obstacle.id] == null && (z >= 0 || isFlyer(obstacle.kind))) {
        run.passed[obstacle.id] = obstacle.d;
        mastery(run, notify);
      }
      if (result !== 2) continue;
      run.hit[obstacle.id] = obstacle.d;
      damage(run, obstacle.kind, notify);
      if (run.death) return;
    }
  }
  if (run.mode === "race" && run.distance >= RACE_METRES) {
    run.distance = RACE_METRES;
    run.done = true;
  }
  if (Math.floor(previous / 25) !== Math.floor(run.distance / 25)) {
    trimPassed(run.picked, run.distance);
    trimPassed(run.hit, run.distance);
    trimPassed(run.passed, run.distance);
  }
}
