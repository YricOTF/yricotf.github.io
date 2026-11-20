export const LANES = [-3, 0, 3];

export const POWERUPS = {
  magnet: { name: "磁矿", effect: "自动吸取三条车道附近的化石", duration: 10, symbol: "磁" },
  shield: { name: "甲壳盾", effect: "抵挡一次撞击", duration: 18, symbol: "盾" },
  amber: { name: "双生琥珀", effect: "拾取的化石翻倍", duration: 12, symbol: "倍" },
  feather: { name: "风翼羽", effect: "跳得更高，滞空更久", duration: 10, symbol: "羽" },
};

const charge = { name: "冲撞", kind: "charge", count: 1, windup: 1.17 };
const sweep = { name: "扫尾", kind: "sweep", count: 2, windup: 1.23 };
const rain = { name: "双陨石", kind: "meteor", count: 2, windup: 1.34 };

export const BOSSES = [
  { name: "裂岩角龙", distance: 150, hp: 2, skin: "horn", prize: 8, hint: "离开角龙冲撞的车道", attacks: [charge] },
  { name: "疾影迅猛龙", distance: 375, hp: 3, skin: "raptor", prize: 12, hint: "换道或跳起避开扫尾", attacks: [sweep, charge] },
  { name: "陨脊暴龙", distance: 665, hp: 4, skin: "shadow", prize: 18, hint: "离开陨石砸落的车道", attacks: [rain, sweep, rain, charge] },
];

export const LANE_NAMES = ["左道", "中道", "右道"];
const BOSS_PHASES = ["intro", "warning", "impact", "exposed", "stagger", "victory"];
const PHASE_MAX = { intro: 1.55, warning: 1.35, impact: 0.33, exposed: 2.35, stagger: 0.65, victory: 0.85 };

export function bossAttack(state) {
  const { attacks } = BOSSES[state.index];
  return attacks[state.cycle % attacks.length];
}

export function beginBoss(index) {
  return { index, hp: BOSSES[index].hp, phase: "intro", age: 0, cycle: 0, lanes: [], weakLane: 1, travel: 0, strikeLane: 1 };
}

export function restoreBoss(raw, distance) {
  const spec = BOSSES[raw?.index];
  if (!spec || Math.abs(distance - spec.distance) > 0.01 || !BOSS_PHASES.includes(raw.phase)
    || !Number.isFinite(raw.age) || raw.age < 0 || raw.age > PHASE_MAX[raw.phase] + 0.1
    || !Number.isInteger(raw.hp) || raw.hp < (raw.phase === "victory" ? 0 : 1) || raw.hp > spec.hp
    || !Number.isSafeInteger(raw.cycle) || raw.cycle < 0 || ![0, 1, 2].includes(raw.weakLane)
    || !Array.isArray(raw.lanes) || raw.lanes.length > 2 || raw.lanes.some(lane => ![0, 1, 2].includes(lane))) return null;
  return { ...beginBoss(raw.index), hp: raw.hp, phase: raw.phase, age: raw.age,
    cycle: raw.cycle, lanes: [...new Set(raw.lanes)], weakLane: raw.weakLane,
    travel: Number.isFinite(raw.travel) ? Math.max(0, raw.travel) : 0,
    strikeLane: [0, 1, 2].includes(raw.strikeLane) ? raw.strikeLane : raw.weakLane };
}

function phase(state, name) {
  state.phase = name;
  state.age = 0;
}

function warn(run, state) {
  const attack = bossAttack(state);
  const first = run.lane;
  const second = (first + 1 + ((run.seed + state.cycle) % 2)) % 3;
  state.lanes = attack.count === 1 ? [first] : [first, second];
  const clear = [0, 1, 2].filter(lane => !state.lanes.includes(lane));
  state.weakLane = clear[(run.seed + state.cycle) % clear.length];
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
      if (state.age < attack.windup) break;
      phase(state, "impact");
      if (state.lanes.some(lane => Math.abs(LANES[lane] - run.x) < 1.38) && !(attack.kind === "sweep" && run.y > 1.1)) {
        hit(attack.kind === "meteor" ? "meteor" : "boss");
      }
      break;
    case "impact":
      if (state.age >= PHASE_MAX.impact) phase(state, "exposed");
      break;
    case "exposed":
    case "stagger":
      if (state.age >= PHASE_MAX[state.phase]) {
        state.cycle++;
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
