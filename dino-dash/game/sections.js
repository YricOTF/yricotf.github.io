import { biomeAt, biomeLength, hash } from "./course.js?v=10";

export const SECTION_RULES = 6;
export const RIVER_SWING = 16.5;
export const RIVER_RELEASE = 9.5;
export const RIVER_GRAB_BACK = 3.2;
export const RIVER_GRAB_FORWARD = 3.6;
export const SECTION_BUFFER = 19;

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

export function swingHeight(position) {
  const progress = Math.min(1, Math.max(0, position / RIVER_SWING));
  return 1.03 + Math.sin(Math.PI * progress) * 1.41 + progress * 0.53;
}

export function sectionFossils(section) {
  if (section.kind === "river") return section.vines.flatMap((rope, i) => [4, 9].map(offset => ({
    d: rope.d + offset, lane: rope.lane, y: swingHeight(offset) + 0.72, id: `${section.id}-${i}-${offset}`,
  })));
  return [{ lane: 1, d: section.start }, ...section.forks].flatMap((fork, i) => [2, 6, 10].map(offset => ({
    d: fork.d + offset, lane: fork.lane, y: 1.31, id: `${section.id}-${i}-${offset}`,
  })));
}
