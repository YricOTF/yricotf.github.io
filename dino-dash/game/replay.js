import { control, newRun, runScore, stepRun } from "./runner.js?v=6";

export const REPLAY_VERSION = 1;
export const RANK_STEP = 0.01;
export const RANK_TICKS = 90_000;
export const RANK_MOVES = ["left", "right", "jump", "slide"];
export const MAX_MOVES = 12_000;
export const MOVES_PER_TICK = 4;
export const PROOF_INTERVAL = 2000;
const MAX_PROOF_GAP = 4500;

export async function hashMoves(moves) {
  const bytes = new TextEncoder().encode(JSON.stringify(moves));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
}

export async function verifyProofs(ticks, moves, proofs) {
  let last = 0, end = 0;
  for (const point of proofs) {
    if (point.tick <= last || point.tick > ticks || point.tick - last > MAX_PROOF_GAP) return false;
    while (end < moves.length && moves[end] < point.tick) end += 2;
    if (point.move_count !== end || await hashMoves(moves.slice(0, end)) !== point.move_hash) return false;
    last = point.tick;
  }
  return ticks - last <= MAX_PROOF_GAP;
}

export function replayRanked(seed, ticks, moves) {
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff || !Number.isInteger(ticks) || ticks < 1 || ticks > RANK_TICKS
    || !Array.isArray(moves) || moves.length > MAX_MOVES * 2 || moves.length % 2) return null;
  let prior = -1;
  let count = 0;
  for (let i = 0; i < moves.length; i += 2) {
    const tick = moves[i], input = moves[i + 1];
    if (!Number.isInteger(tick) || tick < prior || tick < 0 || tick >= ticks || !Number.isInteger(input) || !RANK_MOVES[input]) return null;
    count = tick === prior ? count + 1 : 1;
    if (count > MOVES_PER_TICK) return null;
    prior = tick;
  }
  const run = newRun(seed);
  let cursor = 0;
  for (let t = 0; t < ticks; t++) {
    if (run.done) return null;
    while (moves[cursor] === t) {
      if (!control(run, RANK_MOVES[moves[cursor + 1]])) return null;
      cursor += 2;
    }
    stepRun(run, RANK_STEP);
  }
  if (!run.done && ticks !== RANK_TICKS) return null;
  return { score: runScore(run), distance: Math.floor(run.distance), fossils: run.fossils };
}
