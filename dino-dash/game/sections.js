import { biomeAt, biomeLength, hash } from "./course.js?v=10";

export const SECTION_RULES = 6;
export const RIVER_SWING = 16.5;
export const RIVER_RELEASE = 9.5;
export const RIVER_GRAB_BACK = 3.2;
export const RIVER_GRAB_FORWARD = 3.6;
export const SECTION_BUFFER = 19;
export const RIVER_RULES = 9;

const originalRiver = Object.freeze({ swing: RIVER_SWING, release: RIVER_RELEASE, back: RIVER_GRAB_BACK,
  forward: RIVER_GRAB_FORWARD, reach: 1.03, height: 0.49, approach: 5, lip: 0, buffer: 0 });
const forgivingRiver = Object.freeze({ swing: 19, release: 9, back: 8.1,
  forward: 6.2, reach: 1.42, height: 0.28, approach: 8, lip: 1.8, buffer: 5 });

export function riverTiming(rules) {
  return rules >= RIVER_RULES ? forgivingRiver : originalRiver;
}

export function sectionsNear(seed, distance, ahead = 0, behind = 0, mode = "solo") {
  const length = biomeLength(SECTION_RULES, mode);
  const min = distance - behind;
  const max = distance + ahead;
  const sections = [];
  for (let zone = Math.max(0, Math.floor(min / length)); zone <= Math.floor(max / length); zone++) {
    if (mode === "race" && zone !== 0) break;
    const biome = biomeAt(seed, zone * length, SECTION_RULES, mode).id;
    if (biome === "wild") continue;
    const start = zone * length + (mode === "race" ? 188 : 510) + Math.floor(hash(seed ^ 0x32c47, zone) * 7) * 7;
    const mirror = hash(seed ^ 0x762bf, zone) < 0.5 ? -1 : 1;
    const kind = biome === "jungle" ? "river" : "rail";
    const end = start + (kind === "river" ? 91 : 153);
    if (start - SECTION_BUFFER > max || end + SECTION_BUFFER < min) continue;
    const section = { kind, start, end, id: `${kind}-${zone}` };
    if (kind === "river") {
      section.vines = [1, 1 + mirror, 1, 1 - mirror].map((lane, i) => ({
        lane, d: start + 2 + 24 * i, side: lane === 1 ? (i ? -mirror : mirror) : Math.sign(lane - 1),
        id: `${section.id}-rope-${i}`,
      }));
    } else {
      section.forks = [1 + mirror, 1, 1 - mirror, 1].map((lane, i) => ({
        lane, d: start + 30 + 31 * i,
      }));
      section.beams = [0, 2].map(i => ({ lane: section.forks[i].lane, d: section.forks[i].d + 14, kind: "beam" }));
    }
    sections.push(section);
  }
  return sections;
}

export function swingHeight(position, swing = RIVER_SWING) {
  const progress = Math.min(1, Math.max(0, position / swing));
  return 1.03 + Math.sin(Math.PI * progress) * 1.41 + progress * 0.53;
}

export function sectionFossils(section, rules) {
  if (section.kind === "river") return section.vines.flatMap((rope, i) => [4, 9].map(offset => ({
    d: rope.d + offset, lane: rope.lane, y: swingHeight(offset, riverTiming(rules).swing) + 0.72, id: `${section.id}-${i}-${offset}`,
  })));
  return [{ lane: 1, d: section.start }, ...section.forks].flatMap((fork, i) => [2, 6, 10].map(offset => ({
    d: fork.d + offset, lane: fork.lane, y: 1.31, id: `${section.id}-${i}-${offset}`,
  })));
}

const side = (current, target) => current > target ? "左" : "右";

export function sectionLesson(run, completed) {
  if (run.done || run.death || run.launch || run.mode !== "solo") return "";
  const [section] = sectionsNear(run.seed, run.distance);
  if (!section || run.distance < section.start - 17 || run.distance >= section.end
    || section.start < run.bossExit || !run.practiceSection && completed.includes(section.kind)
    || run.practice && !run.practiceSection) return "";
  if (section.kind === "river") {
    const held = run.ride?.kind === "river" ? run.ride : null;
    if (!held && run.distance < section.start - 1) {
      if (run.lane !== 1) return "先到中间";
      return run.distance < section.start - (run.rules >= RIVER_RULES ? 10 : 7) ? "准备起跳接藤" : "现在上划 · 接藤";
    }
    if (!held) return "保持方向 · 接住下一根";
    const next = section.vines[section.vines.findIndex(rope => rope.id === held.id) + 1];
    if (next && run.lane !== next.lane) return `向${side(run.lane, next.lane)}划 · 对准下一根`;
    const timing = riverTiming(run.rules);
    if (run.distance - held.d < timing.release - timing.buffer) return "等待握点亮起";
    return next ? "现在上划 · 跃向下一根" : "现在上划 · 跃上河岸";
  }
  if (run.ride?.kind !== "rail") return "对准中间 · 上矿车";
  const fork = section.forks.find(turn => turn.d > run.distance);
  const beam = section.beams.find(mark => mark.d >= run.distance && mark.d - run.distance <= 15 && mark.lane === run.lane);
  if (beam) return "下划 · 躲开横梁";
  if (!fork) return "保持中间 · 驶离矿道";
  return run.lane === fork.lane ? "保持这条轨道" : `向${side(run.lane, fork.lane)}划 · 避开断轨`;
}
