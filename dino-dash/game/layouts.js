import { cruisingSpeed, JUMP_TIME, jumpHeight, obstacleAction } from "./movement.js?v=16";

export const LAYOUTS = ["arch", "underpass", "slalom", "double", "ravine", "gates"];
const lanes = [0, 1, 2];
const pads = { wild: "ridge", jungle: "root", cave: "ore" };
const blocks = { wild: "idol", jungle: "thorn", cave: "pillar" };

export function fossilTrail(index, lane, distance, mode, action, rules) {
  if (action === "jump") {
    const speed = cruisingSpeed(distance, mode, rules);
    return Array.from({ length: 11 }, (_, n) => {
      const time = JUMP_TIME * n / 10;
      return { id: `${index}r${n}`, lane, d: distance + (time - JUMP_TIME / 2) * speed, y: jumpHeight(time) + 0.72, chain: index };
    });
  }
  return Array.from({ length: 9 }, (_, n) => ({
    id: `${index}r${n}`, lane, d: distance - 9 + n * 2.18, y: 0.56, chain: index,
  }));
}

const flatFossil = (id, lane, d) => ({ id, lane, d, y: 0.72 });

export function layoutGroup(index, distance, mode, biome, roll, id, rules) {
  const outer = roll(2) < 0.5 ? 0 : 2;
  const other = 2 - outer;
  const lane = Math.floor(roll(1) * 3);
  const safe = lanes.find(value => value !== lane);
  const formation = { id, d: distance, lane, side: outer === 0 ? -1 : 1 };
  const obstacles = [];
  const mark = (kind, lane, offset, risk = false) => {
    const item = { id: `${index}l${obstacles.length}`, kind, lane, d: distance + offset, risk };
    obstacles.push(item);
  };
  const sideFossils = [flatFossil(`${index}s0`, safe, distance - 6), flatFossil(`${index}s1`, safe, distance + 5)];
  let fossils;
  switch (id) {
    case "arch":
      mark("hurdle", lane, 0, true);
      fossils = fossilTrail(index, lane, distance, mode, "jump", rules);
      break;
    case "underpass":
      mark("lowgate", lane, 0, true);
      fossils = fossilTrail(index, lane, distance, mode, "slide", rules);
      break;
    case "double": {
      const half = cruisingSpeed(distance, mode, rules) * 0.112;
      mark(pads[biome], lane, -half, true);
      mark("hurdle", lane, half, true);
      fossils = fossilTrail(index, lane, distance, mode, "jump", rules);
      break;
    }
    case "ravine":
      mark("rift", lane, 0, true);
      fossils = fossilTrail(index, lane, distance, mode, "jump", rules);
      break;
    case "slalom":
    case "gates": {
      const stagger = id === "slalom" ? 7.8 : 6.6;
      formation.lane = outer;
      mark(blocks[biome], 1, -stagger);
      mark(blocks[biome], outer, stagger);
      if (id === "gates") mark("hurdle", other, -stagger, true);
      fossils = Array.from({ length: 10 }, (_, n) => {
        const t = n / 9;
        const curve = Math.max(0, Math.min(1, (t - 0.24) / 0.52));
        const x = (outer - 1) * 3 * (1 - curve * curve * (3 - 2 * curve));
        return { id: `${index}r${n}`, lane: t < 0.5 ? outer : 1, x,
          d: distance + (t - 0.5) * 25, y: 0.72, chain: index };
      });
      sideFossils.length = 0;
      sideFossils.push(flatFossil(`${index}s0`, other, distance + 0.5), flatFossil(`${index}s1`, other, distance + 5.5));
      break;
    }
  }
  return { formation, obstacles, fossils: [...fossils, ...sideFossils], powers: [] };
}

export function improveRewardTrail(group, index, distance, mode, primary, safe, rules) {
  const action = obstacleAction(primary.kind);
  for (const mark of group.obstacles) mark.risk = obstacleAction(mark.kind) !== "lane";
  if (action === "lane") return group;
  return { ...group, fossils: [...fossilTrail(index, primary.lane, distance, mode, action, rules),
    flatFossil(`${index}s0`, safe, distance - 3.8), flatFossil(`${index}s1`, safe, distance + 4.7)] };
}
