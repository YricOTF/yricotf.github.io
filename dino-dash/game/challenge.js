import { hash } from "./course.js?v=15";

export const LANES = [-3, 0, 3];

export const POWERUPS = {
  magnet: { name: "磁矿", duration: 10, symbol: "磁" },
  shield: { name: "甲壳盾", duration: 18, symbol: "盾" },
  amber: { name: "双生琥珀", duration: 12, symbol: "倍" },
  feather: { name: "风翼羽", duration: 10, symbol: "羽" },
};

const lunge = { kind: "charge", count: 1, windup: 0.62 };
const heavy = { kind: "charge", count: 1, windup: 1.52, feint: 0.94 };
const cut = { kind: "sweep", count: 2, windup: 0.61 };
const drag = { kind: "sweep", count: 2, windup: 1.38, feint: 0.77 };
const rain = { kind: "meteor", count: 2, windup: 1.28 };

export const BOSSES = [
  { name: "裂岩角龙", distance: 1120, hp: 3, skin: "horn", prize: 10, opening: 2.42, attacks: [[lunge], [heavy], [lunge, lunge]] },
  { name: "疾影迅猛龙", distance: 4090, hp: 4, skin: "raptor", prize: 16, opening: 2.30, attacks: [[drag], [lunge, cut], [cut], [heavy, cut]] },
  { name: "陨脊暴龙", distance: 7280, hp: 5, skin: "shadow", prize: 24, opening: 2.18, attacks: [[rain], [cut, lunge], [heavy, rain], [rain, cut]] },
];

const PHASE_MAX = { intro: 1.55, warning: 1.52, impact: 0.72, exposed: 2.42, throw: 0.46, stagger: 0.67, victory: 1.22 };
export const ARENA_SPEED = 14.8;
const contactAt = { charge: 0.34, sweep: 0.30, meteor: 0.36 };
export const impactTime = kind => contactAt[kind];
export const sweepDepth = age => (age - contactAt.sweep) * 34;

export function chargeDepth(age, index = 0, scale = 1.85) {
  const arrival = Math.max(0, Math.min(1, age / contactAt.charge));
  const retreat = Math.max(0, Math.min(1, (age - contactAt.charge) / (PHASE_MAX.impact - contactAt.charge)));
  const nose = [3.25, 3.34, 2.68][index] * scale / 1.85;
  return -15.7 + (15.7 - nose - 0.83) * (arrival ** 1.32) * (1 - retreat * retreat * (3 - 2 * retreat));
}
function waveFor(state) {
  const waves = BOSSES[state.index].attacks;
  const draw = state.patternSeed
    ? Math.floor(hash(state.patternSeed ^ Math.imul(state.index + 1, 0xb436e2f9), state.cycle) * waves.length)
    : state.cycle % waves.length;
  return waves[draw];
}

export function bossAttack(state) {
  return waveFor(state)[state.beat || 0];
}

export function beginBoss(index, pace = 0, streaming = false, patternSeed = 0) {
  return { index, hp: BOSSES[index].hp, phase: "intro", age: 0, cycle: 0, beat: 0,
    retargeted: false, lanes: [], weakLane: 1, travel: 0, pace, streaming, patternSeed, mercy: !!patternSeed, strike: null, routeMask: 0, routeAge: 0, hitFrom: 0, hitY: 1 };
}

export function restoreBoss(raw, distance, site, chase = false, streaming = false, patternSeed = 0) {
  const spec = BOSSES[raw?.index];
  const start = chase && Number.isFinite(raw?.travel) ? distance - raw.travel : distance;
  if (!spec || !Number.isFinite(site) || (chase ? start + 0.01 < site : Math.abs(start - site) > 0.01) || !Object.hasOwn(PHASE_MAX, raw.phase)
    || !Number.isFinite(raw.age) || raw.age < 0 || raw.age > PHASE_MAX[raw.phase] + 0.1
    || !Number.isInteger(raw.hp) || raw.hp < (raw.phase === "victory" ? 0 : 1) || raw.hp > spec.hp
    || !Number.isSafeInteger(raw.cycle) || raw.cycle < 0 || ![0, 1, 2].includes(raw.weakLane)
    || !Array.isArray(raw.lanes) || raw.lanes.length > 2 || raw.lanes.some(lane => ![0, 1, 2].includes(lane))) return null;
  const pace = chase && Number.isFinite(raw.pace) ? Math.max(15, Math.min(34, raw.pace)) : 0;
  const strike = streaming && [0, 1, 2].includes(raw.strike?.lane) && Number.isFinite(raw.strike.d)
    && Math.abs(raw.strike.d - distance) < 200 ? { d: raw.strike.d, lane: raw.strike.lane } : null;
  const resumed = { ...beginBoss(raw.index, pace, streaming, patternSeed), cycle: raw.cycle };
  return { ...resumed, strike, mercy: !!patternSeed && raw.mercy !== false, hp: raw.hp, phase: raw.phase, age: raw.age,
    beat: raw.beat === 1 && waveFor(resumed).length > 1 ? 1 : 0,
    retargeted: raw.retargeted === true, lanes: [...new Set(raw.lanes)], weakLane: raw.weakLane,
    travel: Number.isFinite(raw.travel) ? Math.max(0, raw.travel) : 0,
    routeMask: Number.isInteger(raw.routeMask) ? raw.routeMask & 3 : 0,
    routeAge: Number.isFinite(raw.routeAge) ? Math.max(0, Math.min(PHASE_MAX.exposed, raw.routeAge)) : 0,
    hitFrom: Number.isFinite(raw.hitFrom) ? Math.max(-3, Math.min(3, raw.hitFrom)) : LANES[raw.weakLane],
    hitY: Number.isFinite(raw.hitY) ? Math.max(0, Math.min(4, raw.hitY)) : 1 };
}

export function battleRoute(state) {
  if (state.streaming || state.phase !== "exposed" && state.phase !== "throw") return null;
  const themes = [["ridge", "hurdle"], ["root", "lowgate"], ["washout", "beam"]];
  const lane = state.weakLane;
  const kind = themes[state.index][state.cycle % 2];
  const age = state.phase === "throw" ? state.routeAge + state.age : state.age;
  if (state.pace) {
    const id = `boss-${state.index}-${state.cycle}`;
    const hurdle = ["ridge", "root", "beam"][state.index];
    const obstacle = state.cycle % 2 ? { kind: hurdle, lane, d: state.pace * 0.80 } : null;
    return {
      distance: age * state.pace,
      obstacles: obstacle ? [obstacle] : [],
      fossils: [0.40, 0.57, 1.06].map((time, i) => ({
        d: time * state.pace, lane, y: 0.72, id: `${id}-fossil-${i}`,
      })),
      attack: { lane, d: state.pace * 1.43, y: 1.07 },
    };
  }
  const distance = age * ARENA_SPEED;
  const side = lane === 1 ? 2 * (state.cycle % 2) : 1;
  return {
    distance,
    obstacles: [{ kind, lane, d: ARENA_SPEED * 0.98 },
      { kind: themes[state.index][0], lane: side, d: ARENA_SPEED * 1.24 }],
    attack: { lane, d: ARENA_SPEED * 1.39, y: kind === "lowgate" || kind === "beam" ? 0.78 : 1.07 },
  };
}

function phase(state, name) {
  state.phase = name;
  state.age = 0;
}

function aim(run, state, course) {
  const attack = bossAttack(state);
  let first = Math.max(0, Math.min(2, Math.round(run.x / 3) + 1));
  if (course) {
    const windup = state.retargeted ? attack.windup - state.age : attack.windup;
    const lanes = course.lanes(run.distance + state.pace * (windup + contactAt[attack.kind]));
    const available = lanes.length ? lanes : [0, 1, 2];
    const safe = available.find(lane => lane !== first && Math.abs(lane - first) === 1)
      ?? available.find(lane => lane !== first) ?? first;
    if (first === safe) first = (first + 1) % 3;
    const alternate = [0, 1, 2].find(lane => lane !== safe && lane !== first);
    state.lanes = attack.count === 1 ? [first] : [first, alternate];
    state.weakLane = safe;
    return;
  }
  const second = (first + 1 + ((run.seed + state.cycle + state.beat) % 2)) % 3;
  state.lanes = attack.count === 1 ? [first] : [first, second];
  const clear = [0, 1, 2].filter(lane => !state.lanes.includes(lane));
  state.weakLane = clear[(run.seed + state.cycle) % clear.length];
}

function warn(run, state, course) {
  state.retargeted = false;
  aim(run, state, course);
  if (course) {
    state.strike = null;
    if (state.beat + 1 === waveFor(state).length) {
      const d = run.distance + state.pace * (bossAttack(state).windup + PHASE_MAX.impact + 1.16);
      const open = course.lanes(d, 14);
      const lane = open.includes(state.weakLane) ? state.weakLane : open[0] ?? state.weakLane;
      state.strike = { d, lane };
    }
  }
  phase(state, "warning");
}

export function advanceBoss(run, dt, hit, notify, course = null) {
  const state = run.boss;
  const attack = bossAttack(state);
  state.travel += course?.distance ?? dt * (state.pace || ARENA_SPEED);
  const previous = state.age;
  state.age += dt;
  switch (state.phase) {
    case "intro":
      if (state.age >= PHASE_MAX.intro) {
        if (course?.canAttack === false) state.age = PHASE_MAX.intro;
        else warn(run, state, course);
      }
      break;
    case "warning":
      if (attack.feint && !state.retargeted && state.age >= attack.feint) {
        state.retargeted = true;
        aim(run, state, course);
        notify("feint");
      }
      if (state.age < attack.windup) break;
      phase(state, "impact");
      if (attack.kind === "meteor") notify("meteor-fall");
      break;
    case "impact":
      if (previous < contactAt[attack.kind] && state.age >= contactAt[attack.kind]) {
        if (attack.kind === "meteor") notify("meteor-impact");
        if (state.lanes.some(lane => Math.abs(LANES[lane] - run.x) < 1.31) && !(attack.kind === "sweep" && run.y > 1.1)) {
          hit(attack.kind === "meteor" ? "meteor" : `boss-${attack.kind}`);
        } else {
          run.bonus += 56;
          notify("boss-dodge", 56);
        }
      }
      if (state.age < PHASE_MAX.impact) break;
      if (state.beat + 1 < waveFor(state).length) {
        state.beat++;
        warn(run, state, course);
      } else {
        state.routeMask = 0;
        phase(state, "exposed");
      }
      break;
    case "throw":
      if (state.age < PHASE_MAX.throw) break;
      state.hp--;
      run.bonus += 150;
      phase(state, state.hp ? "stagger" : "victory");
      notify("boss-strike", 150);
      break;
    case "exposed":
    case "stagger":
      const limit = state.phase === "exposed" ? BOSSES[state.index].opening : PHASE_MAX.stagger;
      if (state.age >= limit) {
        if (course?.canAttack === false) {
          state.age = limit;
          break;
        }
        state.cycle++;
        state.beat = 0;
        warn(run, state, course);
      }
      break;
    case "victory":
      if (state.age < PHASE_MAX.victory) break;
      run.bonus += 500 + 120 * state.index;
      if (run.practice) {
        run.won = true;
        run.done = true;
      } else {
        run.fossils += BOSSES[state.index].prize;
        run.grace = 0.82;
        run.nextBoss = state.index + 1;
        run.bossWins++;
        run.boss = null;
        notify("boss-clear", BOSSES[state.index]);
      }
      break;
  }
}

export function collectStrike(run, notify) {
  const state = run.boss;
  if (state?.phase !== "exposed") return false;
  state.hitFrom = run.x;
  state.hitY = run.y + 0.9;
  state.routeAge = state.age;
  phase(state, "throw");
  notify("boss-orb");
  return true;
}
