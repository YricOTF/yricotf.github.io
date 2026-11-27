export const JUMP_TIME = 0.84;
export const HIGH_JUMP_TIME = 1.02;
export const MAX_SOLO_SPEED = 34;
export const PACING_RULES = 10;
export const LONG_RAMP_RULES = 11;
export const RACE_SPEED = 18;
export const VINE_GRIP = 2.28;
export const VINE_GRAB_START = -3.6;
export const VINE_GRAB_END = 2.0;
export const VINE_GAP_START = 1.4;
export const VINE_GAP_END = 7.5;

export function jumpHeight(time, boosted = false) {
  const duration = boosted ? HIGH_JUMP_TIME : JUMP_TIME;
  return time > 0 && time < duration ? (boosted ? 3.22 : 2.46) * Math.sin(Math.PI * time / duration) : 0;
}

export function cruisingSpeed(distance, mode = "solo", rules = 0) {
  if (mode === "race") return RACE_SPEED;
  if (rules < PACING_RULES || distance <= 180) return Math.min(MAX_SOLO_SPEED, 15 + distance / 45);
  if (rules >= LONG_RAMP_RULES) return Math.min(MAX_SOLO_SPEED, 19 + (distance - 180) / 330);
  return Math.min(26, 19 + (distance - 180) / 150);
}

export function obstacleAction(kind) {
  if (["flyer", "straight", "orbit", "dive", "branch", "stalactite", "beam", "pod", "lowgate"].includes(kind)) return "slide";
  if (["cactus", "boulder", "root", "log", "ore", "ridge", "mud", "washout", "cart", "hurdle", "rift"].includes(kind)) return "jump";
  return "lane";
}
