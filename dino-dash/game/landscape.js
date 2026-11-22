import { hash } from "./course.js?v=6";
import { VINE_GAP_END, VINE_GAP_START, VINE_GRIP } from "./movement.js?v=6";

const sides = [-1, 1];

function fern(scene, x, z, scale) {
  scene.box(x, 0.23 * scale, z, 0.19, 0.46 * scale, 0.23, "#536b53");
  for (const side of sides) {
    scene.box(x + side * 0.35 * scale, 0.48 * scale, z, 0.69 * scale, 0.16, 0.36 * scale, "#748c70");
    scene.box(x + side * 0.76 * scale, 0.65 * scale, z - side * 0.14, 0.20 * scale, 0.16, 0.31 * scale, "#90a388");
  }
}

export function vineTree(scene, x, z, side, grip = null, modern = true) {
  const root = side * Math.max(5.85, Math.abs(x) + 2.55);
  const anchor = 6.35;
  if (modern) {
    const middle = (VINE_GAP_START + VINE_GAP_END) / 2;
    ravine(scene, x, z - middle, VINE_GAP_END - VINE_GAP_START, true);
    scene.box(x, 0.025, z + 3.6, 2.14, 0.05, 0.16, "#859178");
  } else {
    scene.box(x, 0.013, z - 2.35, 2.92, 0.037, 5.85, "#405348");
    for (const edge of sides) scene.box(x, 0.038, z - 2.35 + edge * 2.84, 2.96, 0.074, 0.27, "#798b72");
  }
  scene.jungleTree(root, z - 0.29, 6.95, side > 0);
  scene.box(root, 0.29, z + 0.03, 1.7, 0.57, 1.21, "#646c56");
  const reach = root - x;
  scene.box(x + reach * 0.52, anchor + 0.23, z, Math.abs(reach) + 0.65, 0.66, 0.9, "#5a644e");
  scene.box(x + reach * 0.55, anchor + 0.65, z - 0.14, Math.abs(reach) + 1.6, 0.42, 1.76, "#71896c");
  scene.box(x + reach * 0.35, anchor + 0.97, z - 0.12, Math.abs(reach) * 0.73 + 0.43, 0.38, 1.42, "#899b80");
  scene.box(x, anchor - 0.02, z, 0.37, 0.34, 0.43, "#758168");

  const tip = grip || { y: modern ? VINE_GRIP : 1.44, z: z + (modern ? 1.1 : 0.18) };
  const links = grip ? 18 : 12;
  for (let i = 0; i < links; i++) {
    const t = (i + 0.5) / links;
    scene.box(x + Math.sin(t * Math.PI * 2) * 0.07, anchor + (tip.y - anchor) * t, z + (tip.z - z) * t,
      0.15, Math.abs(tip.y - anchor) / links + 0.13, Math.abs(tip.z - z) / links + 0.16, i % 2 ? "#55654c" : "#748969");
  }
  scene.box(x, tip.y, tip.z, 0.4, 0.18, 0.28, "#aebfa3");
}

export function ravine(scene, x, z, length, forest = false) {
  scene.box(x, -1.62, z, 3.03, 0.14, length, forest ? "#3f5148" : "#3d4945");
  for (const side of sides) {
    scene.box(x + side * 1.445, -0.78, z, 0.14, 1.54, length, forest ? "#67775e" : "#626e67");
    scene.box(x, -0.75, z + side * length / 2, 2.99, 1.48, 0.14, forest ? "#788469" : "#737c72");
    scene.box(x + side * 0.11, 0.038, z + side * (length / 2 + 0.16), 2.75, 0.076, 0.28, forest ? "#8e9b7b" : "#9f9b86");
    scene.box(x + side * 1.13, -0.12, z + side * 0.61, 0.53, 0.46, 0.78, forest ? "#697b62" : "#777f71");
  }
}

export function sandstone(scene, x, z, height, width = 1.8, side = 1) {
  for (let i = 0; i < 4; i++) {
    const size = width * (1 - i * 0.13);
    scene.box(x + i * side * 0.16, (i + 0.5) * height / 4, z + i * 0.11,
      size, height / 4 + 0.035, size * 0.83, ["#99937c", "#a79c81", "#b4a78d", "#a39a82"][i]);
  }
}

export function courseLandmark(scene, form, z, biome) {
  const wild = biome.id === "wild";
  const forest = biome.id === "jungle";
  const wood = forest ? "#596b51" : "#766d5e";
  const span = (x, height, depth) => {
    if (wild) {
      sandstone(scene, x, z + depth, height, 2.04, Math.sign(x) * -1);
      scene.rock(x + Math.sign(x) * 1.46, z + depth + 0.54, 0.86, true);
    } else if (forest) {
      scene.jungleTree(x, z + depth, height, x > 0);
      scene.box(x - Math.sign(x) * 0.22, 0.26, z + depth, 1.75, 0.51, 1.37, "#596950");
    } else {
      scene.box(x, height / 2, z + depth, 0.50, height, 0.82, wood);
      scene.box(x, height * 0.78, z + depth, 0.65, 0.25, 0.90, "#a2957b");
      scene.box(x, 0.19, z + depth, 0.92, 0.36, 1.14, "#676e63");
      scene.box(x - Math.sign(x) * 0.22, Math.min(height - 0.2, 2.72), z + depth + 0.48, 0.24, 0.39, 0.15, "#ecd49a");
    }
  };
  const bridge = (depth, height, style) => {
    for (const side of sides) span(side * 5.97, height, depth);
    if (wild) {
      for (const side of sides) {
        scene.box(side * 4.49, height + 0.17, z + depth, 2.64, 0.91, 1.56, "#a39880");
        scene.box(side * 3.08, height + 0.63, z + depth - 0.13, 2.88, 0.84, 1.33, "#b5a58a");
      }
      scene.box(0.24, height + 1.04, z + depth - 0.04, 5.95, 0.73, 1.31, "#a79f85");
    } else if (forest) {
      scene.box(-0.43, height + 0.08, z + depth, 11.65, 0.46, 0.88, wood);
      for (const side of sides) {
        scene.box(side * 2.6, height + 0.47, z + depth - 0.27, 5.3, 0.56, 2.5, "#708469");
        scene.box(side * 2.95, height + 0.92, z + depth - 0.20, 4.9, 0.42, 1.93, "#869a7d");
      }
    } else {
      scene.box(0, height + 0.06, z + depth, 12.45, 0.42, 0.76, wood);
      for (const side of sides) {
        scene.box(side * 5.37, height - 0.30, z + depth, 1.32, 0.22, 0.64, "#92836e");
        if (style === "arch") scene.box(side * 4.93, height - 0.62, z + depth, 0.25, 0.47, 0.26, "#dec795");
      }
    }
  };
  switch (form.id) {
    case "arch":
      bridge(0, wild ? 5.17 : 6.06, form.id);
      break;
    case "underpass":
    case "gates":
      for (const side of sides) {
        for (const offset of form.id === "gates" ? [-6.6, 6.6] : [-4.0, 4.0]) {
          span(side * (forest ? 7.08 : 5.93), offset, forest ? 4.94 : 2.85);
        }
        if (!wild) scene.box(side * 5.9, forest ? 3.32 : 1.33, z, forest ? 0.39 : 0.16, 0.23, form.id === "gates" ? 12.5 : 7.8, wood);
      }
      break;
    case "slalom":
      for (let i = 0; i < 4; i++) {
        const x = form.side * (i < 2 ? 6.12 : -6.12);
        const offset = 10 - i * 6.2;
        if (forest) scene.jungleTree(x + Math.sign(x) * .71, z + offset, 3.16 + i % 2, i % 2 === 0);
        else if (wild) sandstone(scene, x, z + offset, 1.5 + i % 2 * .76, 1.66, Math.sign(x));
        else scene.minerals(x, z + offset, 1.17 + i % 2 * .64);
      }
      break;
    case "double":
      for (const side of sides) {
        if (forest) {
          scene.jungleTree(side * 7.26, z - 1.72, 4.9, side > 0);
          scene.box(side * 5.97, .26, z + 1.3, .9, .47, 4.62, wood);
        } else if (wild) {
          sandstone(scene, side * 6.65, z + 3.65, .69, 2.12, side);
          sandstone(scene, side * 6.97, z - 3.72, 1.06, 2.42, side);
        } else {
          scene.minerals(side * 6.14, z - 3.34, 1.06);
          scene.box(side * 5.82, .22, z + 1.44, .85, .41, 2.46, wood);
        }
      }
      break;
    case "ravine":
      for (const side of sides) {
        if (forest) {
          scene.jungleTree(side * 7.75, z + 2.7, 4.4, side > 0);
          scene.rock(side * 5.75, z - 3.4, .76, true);
        } else if (wild) sandstone(scene, side * 6.58, z + 2.35, .68, 2.61, side);
        else {
          span(side * 6.1, 3.4, 1.65);
          scene.box(side * 5.89, .77, z, .18, .19, 5.7, wood);
        }
      }
      break;
  }
}

export function mountainPortal(scene, z, roof, seed) {
  const stone = ["#8b9690", "#76837b", "#838f86", "#68756f"];
  for (const side of sides) {
    const uneven = hash(seed, side) * 2 - 1;
    // Rock shelves slope away from the mouth and overlap the tunnel walls behind it.
    scene.box(side * 29, 1.7, z - 8, 26, 3.4, 28, stone[0]);
    scene.box(side * 20, 3.1, z - 6, 18, 6.2, 24, stone[2]);
    scene.box(side * (15.2 + uneven), 4.34, z - 9.3, 14.9, 8.68, 22, stone[1]);
    scene.box(side * (11.6 + uneven * 0.4), 5.1 + uneven * 0.4, z - 9.4, 12.5, 10.2 + uneven * 0.8, 20, stone[3]);
    scene.box(side * (8.05 + uneven * 0.18), 2.65, z + 0.27, 4.9, 5.3, 6.7, stone[2]);
    scene.box(side * 7.35, 6.4, z - 0.95, 3.8, 3.15, 4.85, stone[1]);
    scene.box(side * 5.65, 3.75, z + 0.65, 0.65, 6.85, 2.25, "#606d66");
    scene.box(side * 5.36, roof - 0.36, z - 0.55, 0.8, 1.18, 4.7, "#5e6b64");
    scene.box(side * 4.98, roof + 0.02, z + 0.27, 0.97, 0.95, 3.5, "#707d74");
    scene.box(side * 4.1, roof + 0.56, z - 0.4, 1.4, 1.04, 5.4, "#77847c");
    for (let band = 0; band < 3; band++) {
      const lift = 1.2 + band * 2.2 + uneven * 0.2;
      scene.box(side * (8.15 + band * 0.46), lift, z + 3.7 - band * 1.11, 3.48 - band * 0.34, 0.24, 1.18, stone[(band + 1) % stone.length]);
    }
    scene.box(side * 13.2, 1.35, z + 4.6, 6.4, 2.7, 6.0, stone[0]);
    scene.box(side * (11.7 + uneven), 2.65, z + 3.8, 3.69, 4.6, 4.2, stone[1]);
    scene.box(side * 11.3, 5.31, z + 1.4, 2.96, 2.0, 5.1, stone[2]);
    scene.box(side * 10.02, 7.15, z - 1.75, 2.8, 2.6, 6.0, stone[0]);
    scene.rock(side * 6.65, z + 5.9, 1.45, true);
    scene.rock(side * 9.12, z + 7.7, 0.73, true);
  }
  scene.box(0, roof + 0.54, z - 7.3, 11.85, 1.04, 16.2, "#505c56");
  scene.box(-0.7, roof + 2.02, z - 6.35, 15.4, 2.28, 15.8, "#77847b");
  scene.box(1.15, roof + 3.75, z - 8.22, 14.2, 1.73, 14.5, "#8b968c");
  scene.box(-1.85, roof + 5.12, z - 10.55, 11.0, 1.1, 11.3, "#9aa298");
  scene.box(-3.35, roof + 6.09, z - 10.95, 6.9, 0.92, 8.6, "#a4aaa0");
  scene.box(-4.13, roof + 6.91, z - 11.4, 3.62, 0.86, 6.7, "#aab0a7");
  scene.box(1.8, roof + 1.45, z + 1.1, 4.7, 0.64, 0.87, "#869187");
  scene.box(-2.55, roof + 1.09, z + 1.39, 2.7, 0.67, 0.85, "#68766c");
}

export function trackside(scene, biome, z, row, seed, arena, detailed, roof) {
  for (const side of sides) {
    const r = hash(seed ^ (side * 251), row);
    const x = side * (5.7 + r * 3.3);
    if (arena) {
      if (row % 2 === 0) scene.rock(side * (9.1 + r * 2), z, 0.36 + r * 0.27, biome.id !== "cave");
      if (biome.id !== "cave") continue;
    }
    if (biome.id === "jungle") {
      if (r < 0.46) {
        scene.jungleTree(x + side * 1.2, z, 3.9 + r * 5.8, side > 0);
        if (detailed) fern(scene, x, z + 1.15, 0.76 + r);
      } else if (r < 0.73) {
        scene.box(x + side * 0.7, 0.017, z, 3.05, 0.042, 3.3, "#859b89");
        scene.box(x + side * 0.71, 0.031, z + 0.5, 1.38, 0.011, 0.11, "#b4c2ad");
        if (detailed) fern(scene, x + side * 2.4, z - 0.7, 0.78);
      } else {
        const h = 1.0 + r * 1.8;
        scene.box(x + side * 0.65, h / 2, z, 1.27, h, 1.67, "#7b8270");
        scene.box(x + side * 0.5, h + 0.04, z + 0.15, 1.56, 0.25, 1.77, "#6d866a");
        scene.rock(x + side * 1.85, z - 1.75, 1.2, true);
      }
      if (row % 2 === 0) scene.jungleTree(side * (14.2 + r * 5.5), z - 2.7, 7.1 + r * 3, r > 0.5);
    } else if (biome.id === "cave") {
      const wall = side * (10.4 + r * 1.05);
      scene.box(wall, 3.08, z, 6.55, 6.25, 7.01, r < 0.5 ? "#5c6863" : "#69746e");
      scene.box(wall + side * 0.19, (6.02 + roof) / 2, z, 5.9, roof - 5.64, 7.0, "#626e68");
      if (arena) continue;
      if (r < 0.36) scene.minerals(x + side * 0.34, z, 0.93 + r * 1.9);
      else if (r > 0.78 && row % 2 === 0) {
        scene.box(side * 5.55, 1.89, z, 0.38, 3.83, 0.46, "#8d8170");
        scene.box(side * 6.55, 3.77, z, 2.46, 0.38, 0.54, "#9b8d77");
        scene.box(side * 6.02, 3.31, z, 0.23, 0.57, 0.21, "#554f46");
        scene.box(side * 6.02, 3.14, z, 0.35, 0.30, 0.3, "#decc9c");
        scene.box(side * 6.17, 0.31, z - 1.8, 0.89, 0.62, 0.91, "#928274");
      } else {
        scene.rock(side * 6.12, z + 0.48, 1.19, true);
        if (detailed) scene.box(wall - side * 3.08, 4.66, z + 0.61, 0.84, 2.71, 1.48, "#79857d");
      }
    } else {
      if (r < 0.35) scene.cactus(x, z, 0.55 + r * 2.55, side, true);
      else if (r > 0.72 && detailed) {
        scene.box(x + side * 1.03, 0.19, z, 1.1, 0.34, 3.3, "#c4c3b5");
        for (let rib = 0; rib < 3; rib++) {
          scene.box(x + side * 0.66, 0.46, z + rib * 0.6 - 0.57, 0.88, 0.3, 0.21, "#dddbce");
          scene.box(x + side * 0.28, 0.83 - rib * 0.11, z + rib * 0.6 - 0.57, 0.25, 0.52, 0.23, "#d2cfbe");
        }
      } else scene.rock(x, z, 0.34 + r * 0.64, true);
      if (row % 3 === 0) scene.mesa(side * (13 + r * 6), z - 1.6, 0.63 + r * 0.83, "#bfc2b4");
    }
  }
}

export function arenaEntrance(scene, z, biome) {
  for (const side of sides) {
    const stone = biome.id === "wild" ? "#858879" : biome.id === "jungle" ? "#7e8875" : "#747e77";
    scene.box(side * 6.15, 0.20, z, 1.83, 0.40, 1.83, stone);
    scene.box(side * 6.15, 0.88, z, 1.44, 1.4, 1.26, stone);
    scene.box(side * 6.23, 1.83, z - 0.06, 1.07, 0.63, 0.96, stone);
    scene.box(side * 6.39, 2.29, z - 0.11, 0.54, 0.39, 0.74, stone);
  }
}
