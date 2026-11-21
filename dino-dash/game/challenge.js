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
  { name: "裂岩角龙", distance: 150, hp: 3, skin: "horn", prize: 10, opening: 1.85, attacks: [[lunge], [heavy], [lunge, lunge]] },
  { name: "疾影迅猛龙", distance: 620, hp: 4, skin: "raptor", prize: 16, opening: 1.48, attacks: [[drag], [lunge, cut], [cut], [heavy, cut]] },
  { name: "陨脊暴龙", distance: 1020, hp: 5, skin: "shadow", prize: 24, opening: 1.23, attacks: [[rain], [cut, lunge], [heavy, rain], [rain, cut]] },
];

const BOSS_PHASES = ["intro", "warning", "impact", "exposed", "stagger", "victory"];
const PHASE_MAX = { intro: 1.55, warning: 1.52, impact: 0.33, exposed: 2.35, stagger: 0.65, victory: 0.85 };
const waveFor = state => BOSSES[state.index].attacks[state.cycle % BOSSES[state.index].attacks.length];

export function bossAttack(state) {
  return waveFor(state)[state.beat || 0];
}

export function beginBoss(index) {
  return { index, hp: BOSSES[index].hp, phase: "intro", age: 0, cycle: 0, beat: 0, retargeted: false, lanes: [], weakLane: 1, travel: 0, strikeLane: 1 };
}

export function restoreBoss(raw, distance, site) {
  const spec = BOSSES[raw?.index];
  if (!spec || !Number.isFinite(site) || Math.abs(distance - site) > 0.01 || !BOSS_PHASES.includes(raw.phase)
    || !Number.isFinite(raw.age) || raw.age < 0 || raw.age > PHASE_MAX[raw.phase] + 0.1
    || !Number.isInteger(raw.hp) || raw.hp < (raw.phase === "victory" ? 0 : 1) || raw.hp > spec.hp
    || !Number.isSafeInteger(raw.cycle) || raw.cycle < 0 || ![0, 1, 2].includes(raw.weakLane)
    || !Array.isArray(raw.lanes) || raw.lanes.length > 2 || raw.lanes.some(lane => ![0, 1, 2].includes(lane))) return null;
  return { ...beginBoss(raw.index), hp: raw.hp, phase: raw.phase, age: raw.age,
    cycle: raw.cycle,
    beat: raw.beat === 1 && BOSSES[raw.index].attacks[raw.cycle % BOSSES[raw.index].attacks.length].length > 1 ? 1 : 0,
    retargeted: raw.retargeted === true, lanes: [...new Set(raw.lanes)], weakLane: raw.weakLane,
    travel: Number.isFinite(raw.travel) ? Math.max(0, raw.travel) : 0,
    strikeLane: [0, 1, 2].includes(raw.strikeLane) ? raw.strikeLane : raw.weakLane };
}

function phase(state, name) {
  state.phase = name;
  state.age = 0;
}

function aim(run, state) {
  const attack = bossAttack(state);
  const first = Math.max(0, Math.min(2, Math.round(run.x / 3) + 1));
  const second = (first + 1 + ((run.seed + state.cycle + state.beat) % 2)) % 3;
  state.lanes = attack.count === 1 ? [first] : [first, second];
  const clear = [0, 1, 2].filter(lane => !state.lanes.includes(lane));
  state.weakLane = clear[(run.seed + state.cycle) % clear.length];
}

function warn(run, state) {
  state.retargeted = false;
  aim(run, state);
  phase(state, "warning");
}

export function advanceBoss(run, dt, speed, hit, notify) {
  const state = run.boss;
  const attack = bossAttack(state);
  state.travel += dt * speed * 0.74;
  state.age += dt;
  switch (state.phase) {
    case "intro":
      if (state.age >= PHASE_MAX.intro) warn(run, state);
      break;
    case "warning":
      if (attack.feint && !state.retargeted && state.age >= attack.feint) {
        state.retargeted = true;
        aim(run, state);
        notify("feint");
      }
      if (state.age < attack.windup) break;
      phase(state, "impact");
      if (state.lanes.some(lane => Math.abs(LANES[lane] - run.x) < 1.38) && !(attack.kind === "sweep" && run.y > 1.1)) {
        hit(attack.kind === "meteor" ? "meteor" : "boss");
      }
      break;
    case "impact":
      if (state.age < PHASE_MAX.impact) break;
      if (state.beat + 1 < waveFor(state).length) {
        state.beat++;
        warn(run, state);
      } else phase(state, "exposed");
      break;
    case "exposed":
    case "stagger":
      if (state.age >= (state.phase === "exposed" ? BOSSES[state.index].opening : PHASE_MAX.stagger)) {
        state.cycle++;
        state.beat = 0;
        warn(run, state);
      }
      break;
    case "victory":
      if (state.age < PHASE_MAX.victory) break;
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

export function strikeBoss(run, notify) {
  const state = run.boss;
  if (state?.phase !== "exposed") return false;
  if (Math.abs(run.x - LANES[state.weakLane]) >= 1.12) return false;
  state.hitFrom = run.x;
  state.strikeLane = state.weakLane;
  state.hp--;
  phase(state, state.hp ? "stagger" : "victory");
  notify("boss-strike", state.hp);
  return true;
}
