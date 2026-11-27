import { POWERUPS } from "./challenge.js?v=16";

export const SKINS = [
  { id: "classic", name: "原色暴龙", item: "石墨色与方形长吻", species: "rex", body: "#383937", detail: "#525350", cost: 0 },
  { id: "pale", name: "月岩暴龙", item: "浅灰岩纹", species: "rex", body: "#aaaba4", detail: "#c4c5bd", cost: 7 },
  { id: "raptor", name: "疾影迅猛龙", item: "细长尾巴与条纹", species: "raptor", body: "#4e5149", detail: "#848779", cost: 9 },
  { id: "horn", name: "裂岩角龙", item: "三根尖角与骨盾", species: "horn", body: "#6e7166", detail: "#a8aa9b", cost: 10 },
  { id: "stego", name: "灰脊剑龙", item: "一列岩片状背板", species: "stego", body: "#585b51", detail: "#929688", cost: 10 },
  { id: "club", name: "石甲龙", item: "层叠背甲与尾锤", species: "club", body: "#565a54", detail: "#9a9d93", cost: 10 },
  { id: "crest", name: "风冠龙", item: "向后伸展的长冠", species: "crest", body: "#85877a", detail: "#c2c3b3", cost: 8 },
  { id: "shadow", name: "陨脊暴龙", item: "深色皮肤与碎岩棘", species: "rex", body: "#272922", detail: "#8c8d7d", cost: 12 },
  { id: "dune", name: "流砂迅猛龙", item: "砂岩色与浅纹", species: "raptor", body: "#a0a293", detail: "#c3c6b7", cost: 9 },
  { id: "fern-rex", name: "蕨原暴龙", item: "深绿鳞片与浅绿背纹", species: "rex", body: "#536156", detail: "#a5b193", cost: 8 },
  { id: "ember-raptor", name: "赤曜迅猛龙", item: "红褐条纹与金色短羽", species: "raptor", body: "#6d524b", detail: "#c0a688", cost: 10 },
  { id: "glacier-horn", name: "霜岩角龙", item: "冷色骨盾与雪白尖角", species: "horn", body: "#6f7b81", detail: "#cdd7d8", cost: 11 },
  { id: "sun-stego", name: "落日剑龙", item: "暖色背板与沙金边缘", species: "stego", body: "#5d5550", detail: "#c6aa90", cost: 10 },
  { id: "jade-club", name: "苔玉甲龙", item: "青灰鳞甲与玉色尾锤", species: "club", body: "#4c6160", detail: "#b1c5be", cost: 11 },
  { id: "violet-crest", name: "暮紫冠龙", item: "紫灰鳞片与淡紫长冠", species: "crest", body: "#55505c", detail: "#aea4b2", cost: 12 },
].map(item => ({ ...item, cost: item.cost * 2 }));

export const ACCESSORIES = [
  { id: "cap", name: "探险帽", item: "硬挺帽檐", slot: "head", cost: 6 },
  { id: "visor", name: "单片护目镜", item: "横向镜片", slot: "head", cost: 7 },
  { id: "crown", name: "化石王冠", item: "三枚骨尖", slot: "head", cost: 9 },
  { id: "helmet", name: "石纹头盔", item: "带护颊的岩盔", slot: "head", cost: 8 },
  { id: "comet", name: "陨星发箍", item: "发箍上的星形碎岩", slot: "head", cost: 7 },
  { id: "leaf", name: "蕨叶头饰", item: "向后舒展的叶片", slot: "head", cost: 6 },
  { id: "scarf", name: "格纹围巾", item: "宽格纹短围巾", slot: "neck", cost: 6 },
  { id: "pendant", name: "琥珀吊坠", item: "包裹化石的吊坠", slot: "neck", cost: 7 },
  { id: "ruff", name: "羽绒围领", item: "一圈灰白细羽", slot: "neck", cost: 8 },
  { id: "wing-crest", name: "翼羽冠", item: "三枚翼羽向后展开", slot: "head", cost: 8 },
  { id: "gem-goggles", name: "翠晶风镜", item: "两枚翠晶镜片", slot: "head", cost: 8 },
  { id: "sun-hat", name: "沙原遮阳帽", item: "宽檐和琥珀色帽带", slot: "head", cost: 7 },
  { id: "bone-mask", name: "化石面具", item: "带齿骨纹的面甲", slot: "head", cost: 9 },
  { id: "fern-cloak", name: "蕨叶披肩", item: "颈后垂落的三道叶片", slot: "neck", cost: 8 },
  { id: "shell-collar", name: "贝壳项圈", item: "沙色壳片串成的项圈", slot: "neck", cost: 7 },
  { id: "river-band", name: "河纹领带", item: "蓝灰色布条和浅色河纹", slot: "neck", cost: 7 },
  { id: "ore-charm", name: "矿晶护符", item: "由三枚小矿晶组成", slot: "neck", cost: 9 },
].map(item => ({ ...item, cost: item.cost * 2 }));

export const WARDROBE = [...SKINS, ...ACCESSORIES];
export const CHEST_COST = 120;
export const SHARD_RECYCLE = CHEST_COST / 4 * 0.30;
export const OPENING_BOOSTS = {
  flight: { name: "翼龙起航", cost: 440, launch: { kind: "flight", distance: 450 }, effects: {} },
  dash: { name: "迅猛冲刺", cost: 300, launch: { kind: "dash", distance: 260 }, effects: { magnet: 16 } },
  trail: { name: "化石寻迹", cost: 340, effects: { magnet: 36, amber: 36 } },
  scout: { name: "岩翼护航", cost: 380, launch: { kind: "flight", distance: 250 }, effects: { shield: 36, feather: 24 } },
  magnet: { ...POWERUPS.magnet, cost: 180, effects: { magnet: 37 } },
  shield: { ...POWERUPS.shield, cost: 220, effects: { shield: 42 } },
  amber: { ...POWERUPS.amber, cost: 240, effects: { amber: 37 } },
  feather: { ...POWERUPS.feather, cost: 180, effects: { feather: 40 } },
};
const LEGACY_GEAR = new Set(["cap", "visor", "crown", "scarf"]);
const skins = new Map(SKINS.map(item => [item.id, item]));
const gear = new Map(ACCESSORIES.map(item => [item.id, item]));
const rewards = WARDROBE.filter(item => item.cost > 0);

export function unpackLook(value) {
  const [candidate, head, neck] = typeof value === "string" ? value.split("~", 3) : [];
  if (LEGACY_GEAR.has(candidate)) {
    const slot = gear.get(candidate).slot;
    return { skin: "classic", head: "", neck: "", [slot]: candidate };
  }
  return {
    skin: skins.has(candidate) ? candidate : "classic",
    head: gear.get(head)?.slot === "head" ? head : "",
    neck: gear.get(neck)?.slot === "neck" ? neck : "",
  };
}

export function packLook(skin, head = "", neck = "") {
  const look = unpackLook(`${skin}~${head}~${neck}`);
  return look.head || look.neck ? `${look.skin}~${look.head}~${look.neck}` : look.skin;
}

export function normalizeLook(value) {
  const look = unpackLook(value);
  return packLook(look.skin, look.head, look.neck);
}

export function skinInfo(id) {
  return skins.get(id) || SKINS[0];
}

export function owns(profile, item) {
  return (item.slot ? profile.accessories : profile.unlocked).includes(item.id);
}

export function fragmentBalance(profile, item) {
  return profile.fragments[item.id] || 0;
}

export function unlock(profile, item) {
  if (owns(profile, item)) return true;
  const own = fragmentBalance(profile, item);
  const used = Math.min(own, item.cost);
  const wildcard = item.cost - used;
  if (profile.universal < wildcard) return false;
  profile.universal -= wildcard;
  profile.fossils += (own - used) * SHARD_RECYCLE;
  delete profile.fragments[item.id];
  (item.slot ? profile.accessories : profile.unlocked).push(item.id);
  return true;
}

export function chestPrice(profile, count) {
  return (count - (profile.chestOpened ? 0 : 1)) * CHEST_COST;
}

export function buyOpeningBoost(profile, id) {
  if (!Object.hasOwn(OPENING_BOOSTS, id)) return false;
  const { cost } = OPENING_BOOSTS[id];
  const stock = profile.boosts[id] || 0;
  if (stock >= 9999 || profile.fossils < cost) return false;
  profile.fossils -= cost;
  profile.boosts[id] = stock + 1;
  return true;
}

const BOOSTS = Object.keys(OPENING_BOOSTS);
const randomUnit = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;

function chestReward(profile, roll) {
  const tier = roll();
  if (tier >= 0.95) {
    const count = 2 + Math.floor(roll() * 3);
    profile.universal += count;
    return { type: "wildcard", id: "", count };
  }
  if (tier >= 0.77) {
    const eligible = BOOSTS.filter(id => (profile.boosts[id] || 0) < 9999);
    if (!eligible.length) {
      profile.fossils += CHEST_COST;
      return { type: "fossil", id: "", count: CHEST_COST };
    }
    const id = eligible[Math.floor(roll() * eligible.length)];
    profile.boosts[id] = (profile.boosts[id] || 0) + 1;
    return { type: "boost", id, count: 1 };
  }

  const category = rewards.filter(item => !!item.slot === (tier >= 0.47));
  const unfinished = category.filter(item => !owns(profile, item) && fragmentBalance(profile, item) < item.cost);
  const pool = unfinished.length ? unfinished : category;
  const item = pool[Math.floor(roll() * pool.length)];
  const drawn = 3 + Math.floor(roll() * 3);
  const accepted = owns(profile, item) ? 0 : Math.min(drawn, Math.max(0, item.cost - fragmentBalance(profile, item)));
  const recycled = (drawn - accepted) * SHARD_RECYCLE;
  if (accepted) profile.fragments[item.id] = fragmentBalance(profile, item) + accepted;
  profile.fossils += recycled;
  return accepted ? { type: "shard", id: item.id, count: accepted, recycled } : { type: "fossil", id: item.id, count: recycled };
}

export function openChests(profile, count, roll = randomUnit) {
  if (count !== 1 && count !== 10) return null;
  const price = chestPrice(profile, count);
  if (profile.fossils < price) return null;
  profile.fossils -= price;
  profile.chestOpened = true;
  profile.chestReceipt = Array.from({ length: count }, () => chestReward(profile, roll));
  return profile.chestReceipt;
}

export function restoreRewards(receipt) {
  if (!Array.isArray(receipt)) return [];
  return receipt.slice(0, 10).filter(reward =>
    Number.isInteger(reward?.count) && reward.count >= 1 && reward.count <= (reward.type === "fossil" ? CHEST_COST : 5) &&
    (reward.type === "fossil" || reward.type === "wildcard" || reward.type === "boost" && BOOSTS.includes(reward.id) ||
     reward.type === "shard" && rewards.some(item => item.id === reward.id)))
    .map(({ type, id, count, recycled }) => ({ type, id, count, recycled: type === "shard" && Number.isInteger(recycled) ? Math.max(0, Math.min(45, recycled)) : 0 }));
}
