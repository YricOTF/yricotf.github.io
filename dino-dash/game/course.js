import { improveRewardTrail, layoutGroup, LAYOUTS } from "./layouts.js?v=6";
import { MAX_SOLO_SPEED } from "./movement.js?v=6";

export const BIOME_LENGTH = 90 * MAX_SOLO_SPEED;
const SHORT_BIOME_LENGTH = 230;
export const GROUP_SPACING = 23;
export const FIRST_GROUP = 25;
export const biomeLength = (rules = 5, mode = "solo") => rules >= 5 ? (mode === "race" ? 650 : BIOME_LENGTH)
  : rules < 4 || mode === "race" ? SHORT_BIOME_LENGTH : 400;
export const BIOMES = [
  { id: "wild", name: "荒野", obstacles: ["cactus", "boulder", "straight", "ridge", "orbit"],
    ground: "#d7d8cf", road: "#d0d2c7", shoulder: "#b9bcae", line: "#a1a695", fog: [0.94, 0.94, 0.92] },
  { id: "jungle", name: "丛林", obstacles: ["log", "branch", "orbit", "root", "straight", "dive"],
    ground: "#aeb7a6", road: "#b9c3ad", shoulder: "#858e7c", line: "#909c85", fog: [0.76, 0.81, 0.74] },
  { id: "cave", name: "山洞", obstacles: ["ore", "stalactite", "cart", "boulder", "dive"],
    ground: "#777d7a", road: "#a0a6a0", shoulder: "#656e69", line: "#6d7771", fog: [0.36, 0.41, 0.40] },
];

export function hash(seed, index) {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export const trackDistance = (seed, index) => FIRST_GROUP + index * GROUP_SPACING + (index ? hash(seed, index * 11) * 3 : 0);

const maps = new Map();
export function biomeAt(seed, distance, rules = 5, mode = "solo") {
  if (rules >= 5 && mode === "race") return BIOMES[Math.floor(hash(seed ^ 0x1842fc, 5) * BIOMES.length)];
  const section = Math.max(0, Math.floor(distance / biomeLength(rules, mode)));
  if (section < 3) return BIOMES[section];
  let order = maps.get(seed);
  if (!order) {
    if (maps.size >= 18) maps.delete(maps.keys().next().value);
    order = [0, 1, 2];
    maps.set(seed, order);
  }
  while (order.length <= section) {
    const last = order.at(-1);
    order.push((last + 1 + Math.floor(hash(seed ^ 0x81b4fc, order.length) * 2)) % 3);
  }
  return BIOMES[order[section]];
}

export const isFlyer = kind => kind === "straight" || kind === "orbit" || kind === "dive";
const bound = (value, min, max) => Math.min(max, Math.max(min, value));

export function flightPose(mark, relative) {
  const origin = (mark.lane - 1) * 3;
  const mirror = mark.side || 1;
  if (mark.kind === "orbit") {
    const phase = relative * 0.28 + (mark.turn || 0);
    return {
      x: bound(origin + Math.sin(phase) * 1.35 * mirror, -3.42, 3.42),
      y: 1.67 + Math.cos(phase) * 0.21,
      z: relative * 1.07 + Math.cos(phase) * 4.2,
      yaw: Math.atan2(Math.cos(phase) * 0.378 * mirror, 1.07 - Math.sin(phase) * 1.176),
      bank: Math.sin(phase) * 0.52 * mirror,
    };
  }
  if (mark.kind === "dive") {
    const lift = bound(-relative / 21, 0, 1);
    return { x: origin + lift * mirror * 0.63, y: 1.49 + lift * lift * 5.4, z: relative * 1.37, yaw: -lift * 0.25 * mirror, bank: 0 };
  }
  return { x: origin, y: 1.57, z: relative * 1.29, yaw: 0, bank: 0 };
}

export function rideLength(kind) {
  return kind === "vine" ? 11 : 12.8;
}

export function rideHeight(kind, position, rules = 5) {
  const progress = bound(position, 0, 1);
  if (rules >= 5 && kind === "vine") return (1.08 + 1.27 * Math.sin(Math.PI * progress)) * bound((1 - progress) * 4.5, 0, 1);
  return kind === "vine" ? 1.18 + Math.sin(Math.PI * progress) * 1.5 : 0.73 + Math.sin(Math.PI * progress) * 0.12;
}

const terrainObstacles = {
  jungle: ["log", "branch", "root", "thorn", "mud", "idol", "pod", "orbit", "dive"],
  cave: ["ore", "stalactite", "beam", "washout", "pillar", "boulder", "dive"],
};
const hopObstacles = ["boulder", "ridge", "log", "root", "ore"];

export function courseGroup(seed, index, mode, distance, roll, powerIds, rules) {
  const biome = biomeAt(seed, distance, rules, mode);
  const length = biomeLength(rules, mode);
  const zone = Math.floor(distance / length);
  const start = zone * length;
  const local = distance - start;
  const terrain = rules >= 4 && terrainObstacles[biome.id];
  const pool = terrain || biome.obstacles;
  const safe = index < 2 ? (roll(2) < 0.5 ? 0 : 2) : Math.floor(roll(1) * 3);
  const order = [0, 1, 2].filter(lane => lane !== safe);
  if (roll(2) >= 0.5) order.reverse();
  const first = index === 0 ? 1 : order[0];
  const second = order.find(lane => lane !== first);
  let kind = index < 2 && (rules < 5 || biome.id === "wild") ? (roll(3) < 0.5 ? "cactus" : "boulder")
    : pool[Math.floor(roll(3) * pool.length)];
  if (biome.id === "wild") {
    if (index === 2) kind = "straight";
    if (index === 3) kind = "orbit";
    if (index === 4 || index > 5 && roll(10) > 0.88) kind = "meteor";
  }
  if (terrain) {
    const rideOffset = rules >= 5 && mode === "solo" ? 685 : 86;
    const rideIndex = Math.ceil((start + rideOffset - FIRST_GROUP) / GROUP_SPACING) + Math.floor(hash(seed ^ 0x4bc10, zone) * 2);
    if (rules < 6 && index === rideIndex) kind = biome.id === "jungle" ? "vine" : "minecart";
    if (rules < 6 && biome.id === "cave" && index === rideIndex + 3 && hash(seed ^ 0x76acf, zone) > 0.55) kind = "cart";
  } else if (rules === 3) {
    if (biome.id === "jungle" && (local < 30 || index % 4 === 1)) kind = "vine";
    if (biome.id === "cave" && (local < 30 || index % 4 === 2)) kind = "minecart";
  }
  const special = kind === "vine" || kind === "minecart";
  const layoutShift = Math.floor(hash(seed ^ 0x5ceee2, zone) * LAYOUTS.length);
  if (rules >= 5 && !special && index >= 6 && index % 3 === 0 && local > 32 && local < length - 30) {
    const layout = LAYOUTS[(Math.floor(index / 3) - 2 + layoutShift) % LAYOUTS.length];
    return layoutGroup(index, distance, mode, biome.id, roll, layout);
  }
  const obstacles = [{ id: `${index}a`, kind, d: distance, lane: first, turn: roll(8) * Math.PI * 2, side: roll(6) < 0.5 ? -1 : 1 }];
  const doubleChance = kind === "meteor" ? 0.48 : terrain ? (local < 25 ? 0.28 : 0.85) : 0.70;
  if (index > 2 && !special && !isFlyer(kind) && roll(4) < doubleChance) {
    const fixed = pool.filter(type => !isFlyer(type) && type !== "cart" && (!terrain || type !== kind));
    obstacles.push({ id: `${index}b`, kind: fixed[Math.floor(roll(5) * fixed.length)], d: distance + (roll(6) - 0.5) * 2.1, lane: second });
  }

  const hop = hopObstacles.includes(kind) && (index % 3 === 1 || roll(7) < 0.36);
  const curved = !special && !hop && index > 1;
  const lane = special || hop ? first : safe;
  const coins = special ? 7 : 6;
  const fossils = Array.from({ length: coins }, (_, n) => {
    let offset = -7.6 + n * 2.82;
    let x = (lane - 1) * 3;
    let y = 0.62;
    if (special) {
      offset = n === 0 ? -4.4 : (n - 1) * rideLength(kind) / 6 + 0.38;
      y = n === 0 ? 1.08 : rideHeight(kind, offset / rideLength(kind), rules) + 0.68;
    } else if (hop) {
      y += Math.sin(Math.PI * n / (coins - 1)) * 1.59;
    } else if (curved) {
      // Approach from an adjacent track before bending back around the obstacle.
      x += Math.sign(first - safe) * Math.pow(Math.abs(2 * n / (coins - 1) - 1), 2) * 0.88;
    }
    return { id: `${index}f${n}`, lane, x, d: distance + offset, y, chain: special || hop ? index : null };
  });
  const powers = index === 1 || index > 1 && index % 4 === 0 ? [{
    id: `${index}p`, kind: index === 1 ? "shield" : powerIds[Math.floor(roll(9) * powerIds.length)],
    lane: safe, d: distance - 2.5, y: 0.95,
  }] : [];
  const group = { obstacles, fossils, powers };
  return rules >= 5 && !special ? improveRewardTrail(group, index, distance, mode, obstacles[0], safe) : group;
}
