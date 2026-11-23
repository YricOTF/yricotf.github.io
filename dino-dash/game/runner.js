import { courseGroup, FIRST_GROUP, flightPose, GROUP_SPACING, hash, isFlyer, rideHeight, rideLength, trackDistance } from "./course.js?v=10";
import { advanceBoss, battleRoute, beginBoss, BOSSES, collectStrike, LANES, POWERUPS, restoreBoss } from "./challenge.js?v=10";
import { cruisingSpeed, HIGH_JUMP_TIME, JUMP_TIME, jumpHeight, VINE_GAP_END, VINE_GAP_START, VINE_GRAB_END, VINE_GRAB_START, VINE_GRIP } from "./movement.js?v=6";
import { sectionsNear, sectionFossils, SECTION_RULES, RIVER_SWING, RIVER_RELEASE, RIVER_GRAB_BACK, RIVER_GRAB_FORWARD, swingHeight } from "./sections.js?v=10";

export { LANES, hash };
export { SKINS } from "./catalog.js?v=6";
export const RACE_METRES = 650;
export const RACE_LIMIT_MS = 65_000;
export const RACE_RULES = SECTION_RULES;

const SLIDE_TIME = 0.86;
export const ARENA_LEAD = 54;
export const ARENA_EXIT = 44;
export const ARENA_BOSS_DEPTH = 28.7;
const CHASE_EXIT = 42;
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
  if (["vine", "mud", "washout", "rift", "river", "derail"].includes(kind)) return ["fall", 1.28];
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
  if (rules >= SECTION_RULES && sectionsNear(seed, dist, 15, 15, mode).length) return { obstacles: [], fossils: [], powers: [] };
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

export function runGroups(run, ahead, behind) {
  const groups = groupsNear(run.seed, run.distance, ahead, behind, run.mode, run.rules, run.arenaRoute);
  const exit = run.bossExit;
  if (!exit || run.distance - behind - GROUP_SPACING > exit) return groups;
  return groups.map(group => ({
    obstacles: group.obstacles.filter(mark => mark.d >= exit + 5),
    fossils: group.fossils.filter(mark => mark.d >= exit + 3),
    powers: group.powers.filter(mark => mark.d >= exit + 3),
    formation: group.formation?.d >= exit + 8 ? group.formation : null,
  }));
}

export function newRun(seed = randomSeed(), mode = "solo", rules = RACE_RULES) {
  return {
    seed, mode, rules, distance: 0, elapsed: 0, x: 0, lane: 1, jump: 0, slide: 0, y: 0, boostJump: false,
    fossils: 0, bonus: 0, picked: {}, hit: {}, passed: {}, flash: 0, slow: 0, phase: 0, done: false, death: null, powers: {},
    ride: null, riverLift: 0, riverAssist: false, boss: null, bossExit: 0, nextBoss: 0, bossWins: 0, arenaRoute: rules, grace: 0, practice: false, won: false,
  };
}

export function newPractice(index) {
  if (!BOSSES[index]) return null;
  const run = newRun();
  run.practice = true;
  run.nextBoss = index;
  run.distance = BOSSES[index].distance;
  run.boss = beginBoss(index, cruisingSpeed(run.distance));
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
  if (run.rules < SECTION_RULES && run.rules >= 3 && ride && ["vine", "minecart"].includes(ride.kind) && [0, 1, 2].includes(ride.lane)
    && Number.isFinite(ride.d) && run.distance >= ride.d + (run.rules >= 5 ? VINE_GRAB_START : -0.8) && run.distance < ride.d + rideLength(ride.kind)) {
    run.ride = { kind: ride.kind, lane: ride.lane, d: ride.d, side: ride.side === -1 ? -1 : 1 };
    if (Number.isFinite(ride.grabD) && Number.isFinite(ride.grabY)) {
      run.ride.grabD = clamp(ride.grabD, ride.d + VINE_GRAB_START, Math.min(ride.d + VINE_GRAB_END, run.distance));
      run.ride.grabY = clamp(ride.grabY, 0, 3.25);
    }
  }
  if (run.rules >= SECTION_RULES) {
    const [section] = sectionsNear(run.seed, run.distance, 2, 0, mode);
    const inside = section && run.distance >= section.start - 3 && run.distance < section.end;
    if (inside && snapshot.rules !== SECTION_RULES) {
      run.distance = Math.max(0, section.start - SECTION_BUFFER);
      run.jump = run.y = 0;
    } else if (inside && section.kind === "rail" && ride?.kind === "rail" && run.distance >= section.start) {
      run.ride = { kind: "rail" };
    } else if (inside && section.kind === "river") {
      const rope = section.vines.find(item => item.d === ride?.d && item.lane === ride?.lane
        && run.distance >= item.d - RIVER_GRAB_BACK && run.distance <= item.d + RIVER_SWING);
      if (ride?.kind === "river" && rope) run.ride = { ...rope, kind: "river" };
      if (!run.ride && Number.isFinite(snapshot.riverLift)) run.riverLift = clamp(snapshot.riverLift, 0, 3.2);
      run.riverAssist = mode === "race" && snapshot.riverAssist === true;
    }
  }
  if (mode === "solo") {
    run.arenaRoute = Number.isInteger(snapshot.arenaRoute) && [3, 4, 5, SECTION_RULES].includes(snapshot.arenaRoute) ? snapshot.arenaRoute
      : snapshot.legacyBossRoute === true || snapshot.rules < 4 || snapshot.rules === undefined ? 3 : snapshot.rules === 4 ? 4 : 5;
    if (snapshot.rules !== RACE_RULES) run.grace = Math.max(run.grace, 0.8);
    const sites = arenaSites(run.arenaRoute);
    const passed = sites.filter(site => site < snapshot.distance - 0.01).length;
    run.nextBoss = Number.isInteger(snapshot.nextBoss)
      ? clamp(snapshot.nextBoss, snapshot.rules === SECTION_RULES ? 0 : passed, BOSSES.length) : passed;
    run.boss = restoreBoss(snapshot.boss, run.distance, sites[snapshot.boss?.index], snapshot.rules === SECTION_RULES);
    if (run.boss) {
      run.nextBoss = run.boss.index;
      if (snapshot.rules !== RACE_RULES) {
        run.boss.pace = cruisingSpeed(run.distance);
        if (run.boss.hp > 0) Object.assign(run.boss, { phase: "intro", age: 0, lanes: [], routeMask: 0, travel: 0 });
      }
    }
    if (Number.isFinite(snapshot.bossExit) && snapshot.bossExit >= 0 && snapshot.bossExit <= run.distance + CHASE_EXIT) run.bossExit = snapshot.bossExit;
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
  if (run.ride?.kind === "river" && move === "jump") {
    if (run.distance - run.ride.d < RIVER_RELEASE) return false;
    run.riverLift = run.y;
    run.boostJump = false;
    run.jump = JUMP_TIME;
    run.ride = null;
    notify("ride");
    return true;
  }
  if (run.ride && !["river", "rail"].includes(run.ride.kind)) return false;
  if ((run.ride?.kind === "rail" && move === "jump") || (run.ride?.kind === "river" && move === "slide")) return false;
  if (move === "left" || move === "right") {
    const lane = clamp(run.lane + (move === "left" ? -1 : 1), 0, 2);
    if (lane === run.lane) return false;
    run.lane = lane;
  } else if (move === "jump" && run.jump === 0) {
    run.riverLift = 0;
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
  const lostTrack = cause === "river" || cause === "derail";
  if (!lostTrack && run.grace > 0) return;
  if (!lostTrack && run.powers.shield) {
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

function playBossRoute(run, previous, notify) {
  const state = run.boss;
  const route = battleRoute(state);
  if (!route || state.phase !== "exposed") return;
  if (route.fossils) {
    const origin = run.distance - route.distance;
    pickups(run, { powers: [], fossils: route.fossils.map(item => ({ ...item, d: origin + item.d })) }, previous, notify);
  }
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

function finishSection(run, section, notify) {
  run.ride = null;
  const assisted = run.riverAssist;
  run.riverAssist = false;
  if (section.kind === "rail") run.y = 0;
  if (assisted) return;
  run.fossils += section.kind === "river" ? 6 : 8;
  const bonus = section.kind === "river" ? 260 : 320;
  run.bonus += bonus;
  notify("ride-clear", bonus);
}

function crossRiver(run, section, previous, notify) {
  if (run.ride?.kind === "river") {
    const offset = run.distance - run.ride.d;
    if (offset <= RIVER_SWING) {
      run.x = LANES[run.ride.lane];
      run.y = swingHeight(offset);
    } else {
      run.ride = null;
      damage(run, "river", notify);
      run.riverAssist = run.mode === "race";
    }
  }
  if (!run.ride && !run.death) {
    const next = section.vines.find(rope => run.hit[rope.id] == null && run.distance <= rope.d + RIVER_GRAB_FORWARD);
    if (run.riverAssist) {
      if (next) {
        run.lane = next.lane;
        run.x = LANES[next.lane];
      }
      run.y = 1.51;
    }
    if (next && run.distance >= next.d - RIVER_GRAB_BACK && (run.jump > 0 || run.riverAssist)
      && Math.abs(run.x - LANES[next.lane]) < 1.03 && run.y >= 0.49 && run.y <= 3.85) {
      run.ride = { ...next, kind: "river" };
      run.hit[next.id] = next.d;
      run.lane = next.lane;
      run.x = LANES[next.lane];
      run.jump = run.slide = run.riverLift = 0;
      run.riverAssist = false;
      run.y = swingHeight(run.distance - next.d);
      notify("ride");
    }
    if (!run.ride && !run.riverAssist && previous < section.end && run.distance <= section.end
      && run.distance >= section.start && run.y < 0.54) {
      damage(run, "river", notify);
      run.riverAssist = run.mode === "race";
    }
  }
}

function rideRails(run, section, previous, notify) {
  if (run.distance < section.start) return;
  if (!run.ride) {
    if (Math.abs(run.x) > 1.09) damage(run, "derail", notify);
    if (run.death) return;
    run.ride = { kind: "rail" };
    run.lane = 1;
    run.x = 0;
    run.jump = run.slide = 0;
    notify("ride");
  }
  run.y = 0.56 + 0.025 * Math.sin(run.phase);
  for (const fork of section.forks) {
    if (previous >= fork.d || run.distance < fork.d) continue;
    if (Math.abs(run.x - LANES[fork.lane]) <= 1.05) {
      run.bonus += 35;
      continue;
    }
    damage(run, "derail", notify);
    if (run.death) return;
    run.lane = fork.lane;
    run.x = LANES[fork.lane];
  }
  for (const beam of section.beams) {
    if (run.slide > 0 || Math.abs(run.x - LANES[beam.lane]) > 1.03
      || previous >= beam.d || run.distance < beam.d) continue;
    damage(run, beam.kind, notify);
    if (run.death) return;
  }
}

export function stepRun(run, dt, notify = () => {}) {
  if (run.done) return;
  if (run.death) {
    run.death.age = Math.min(run.death.duration, run.death.age + dt);
    run.done = run.death.age >= run.death.duration;
    return;
  }
  const section = run.rules >= SECTION_RULES && !run.boss && run.distance >= run.bossExit
    ? sectionsNear(run.seed, run.distance, 1, 1, run.mode).find(item => item.start >= run.bossExit) : null;
  let base = run.boss?.pace || cruisingSpeed(run.distance, run.mode);
  if (section && run.distance < section.end + 6) base = Math.min(base, section.kind === "river" ? 22 : 28);
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
  if (!run.jump) run.riverLift = 0;
  run.y = Math.min(3.45, jumpHeight(jumpTime - run.jump, run.boostJump) + run.riverLift * run.jump / JUMP_TIME);
  run.x = tune(run.x, LANES[run.lane], 1 - Math.exp(-28 * dt));
  if (Math.abs(run.x - LANES[run.lane]) < 0.01) run.x = LANES[run.lane];
  for (const id of POWER_IDS) {
    if (run.powers[id] === undefined) continue;
    run.powers[id] -= dt;
    if (run.powers[id] <= 0) delete run.powers[id];
  }

  if (run.boss) {
    const moving = !!run.boss.pace;
    if (moving) run.distance += speed * dt;
    advanceBoss(run, dt, cause => damage(run, cause, notify), notify);
    if (run.boss && !run.death) playBossRoute(run, previous, notify);
    if (moving && !run.boss) run.bossExit = run.distance + CHASE_EXIT;
    return;
  }

  run.distance += speed * dt;
  if (section && previous < section.start - 18 && run.distance >= section.start - 18) notify("section-enter", section.kind);
  if (section && previous < section.end && run.distance >= section.start - 5) {
    if (section.kind === "river") crossRiver(run, section, previous, notify);
    else rideRails(run, section, previous, notify);
    if (run.death) return;
    pickups(run, { powers: [], fossils: sectionFossils(section) }, previous, notify);
    if (run.distance >= section.end) finishSection(run, section, notify);
  } else if (run.rules < SECTION_RULES && run.ride) {
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
  if (site !== undefined && run.distance >= site && run.distance >= run.bossExit) {
    if (run.rules < SECTION_RULES) run.distance = site;
    run.ride = null;
    run.boss = beginBoss(run.nextBoss, run.rules >= SECTION_RULES ? cruisingSpeed(run.distance) : 0);
    notify("boss-enter", BOSSES[run.nextBoss]);
    return;
  }

  const groups = runGroups(run, 17, 20);
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
