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
];

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
];

export const WARDROBE = [...SKINS, ...ACCESSORIES];
export const CHEST_COST = 12;
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
  if (own > used) profile.universal += own - used;
  delete profile.fragments[item.id];
  (item.slot ? profile.accessories : profile.unlocked).push(item.id);
  return true;
}

export function openChest(profile, random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) {
  if (!profile.chestOpened) profile.chestOpened = true;
  else if (profile.fossils >= CHEST_COST) profile.fossils -= CHEST_COST;
  else return null;

  const roll = random();
  const group = roll < 0.48 ? "skin" : roll < 0.82 ? "gear" : "wildcard";
  const pool = rewards.filter(item => (group === "skin" ? !item.slot : group === "gear" && item.slot) && !owns(profile, item) && fragmentBalance(profile, item) < item.cost);
  if (!pool.length) {
    const count = 2 + Math.floor(random() * 3);
    profile.universal += count;
    return { item: null, count };
  }
  const item = pool[Math.floor(random() * pool.length)];
  const previous = fragmentBalance(profile, item);
  const count = 3 + Math.floor(random() * 3);
  profile.fragments[item.id] = previous + count;
  return { item, count };
}
