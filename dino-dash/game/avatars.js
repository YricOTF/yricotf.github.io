const BONE = "#deded1";
const DARK = "#282a25";
const STONE = "#989b8e";

function gait(phase, idle, grounded) {
  const sway = idle ? 0 : Math.sin(phase);
  return { stride: sway * (grounded ? 0.32 : 0.15), lift: idle ? 0 : grounded ? Math.max(0, sway) * 0.16 : 0.1 };
}

function biped(box, skin, phase, idle, grounded) {
  const { body, detail, species } = skin;
  const crested = species === "crest";
  box(0, 0.97, 0.03, 0.86, 0.79, 1.38, body);
  box(0, 1.37, -0.48, 0.58, 0.82, 0.72, body);
  box(0, 1.62, -0.87, 0.55, 0.65, 0.62, detail);
  box(0, 1.95, -1.03, 0.78, 0.49, 0.82, body);
  box(0, 1.87, -1.55, 0.7, 0.25, 0.51, body);
  box(0, 1.71, -1.51, 0.62, 0.13, 0.5, crested ? detail : DARK);
  for (const side of [-1, 1]) {
    const { stride, lift } = gait(phase + (side > 0 ? Math.PI : 0), idle, grounded);
    box(side * 0.405, 2.02, -1.16, 0.056, 0.142, 0.15, BONE);
    box(side * 0.43, 1.15, -0.65, 0.18, 0.17, 0.5, detail);
    box(side * 0.35, 0.53 + lift, 0.13 + stride, 0.26, 0.69, 0.43, body);
    box(side * 0.35, 0.17 + lift, -0.045 + stride, 0.29, 0.24, 0.56, DARK);
    box(side * 0.35, 0.095 + lift, -0.31 + stride, 0.25, 0.11, 0.13, detail);
    if (!crested) for (let i = 0; i < 3; i++) {
      box(side * 0.439, 1.04 + (i % 2) * 0.115, -0.34 + i * 0.34, 0.034, 0.42, 0.12, detail);
    }
  }
  for (let i = 0; i < 4; i++) {
    box(0, 0.84 + i * 0.12, 0.74 + i * 0.4, 0.58 - i * 0.117, 0.34 - i * 0.057, 0.52, i % 2 ? detail : body);
  }
  if (crested) {
    box(0, 2.25, -0.9, 0.66, 0.23, 0.65, detail);
    box(0, 2.35, -0.53, 0.49, 0.27, 0.49, body);
    box(0, 2.5, -0.23, 0.37, 0.28, 0.37, detail);
  }
  return { top: 2.2, headZ: crested ? -1.32 : -1.07, width: 0.81, hatDepth: crested ? 0.76 : 1,
    eye: 2.02, eyeZ: -1.16, eyeWidth: 0.89, faceZ: -1.805, faceY: 1.88,
    neckY: 1.49, neckZ: -0.56, neckWidth: 0.64, neckDepth: 0.78, shoulderX: 0.46 };
}

function quadruped(box, skin, phase, idle, grounded) {
  const { body, detail, species } = skin;
  const horned = species === "horn";
  const plated = species === "stego";
  const headHeight = horned ? 1.14 : plated ? 1.0 : 0.84;
  const width = horned ? 1.16 : 1.02;
  box(0, 0.94, 0.21, width, 0.91, 1.68, body);
  box(0, 0.83, -0.66, width * 0.83, 0.55, 0.69, detail);
  box(0, headHeight, -1.11, horned ? 0.94 : 0.71, 0.48, horned ? 0.87 : 0.64, body);
  box(0, headHeight - 0.13, -1.45, 0.64, 0.24, 0.48, body);
  for (const side of [-1, 1]) {
    const eyeX = horned ? 0.486 : 0.369;
    box(side * eyeX, headHeight + 0.08, -1.28, 0.057, 0.119, 0.138, BONE);
    for (const z of [-0.38, 0.65]) {
      const { stride, lift } = gait(phase + (side * z > 0 ? Math.PI : 0), idle, grounded);
      const x = side * (width / 2 - 0.14);
      box(x, 0.42 + lift, z + stride * 0.65, 0.34, 0.56, 0.45, body);
      box(x, 0.15 + lift, z - 0.06 + stride, 0.31, 0.22, 0.4, DARK);
    }
  }
  for (let i = 0; i < 3; i++) box(0, 0.93 - i * 0.03, 1.08 + i * 0.36, 0.65 - i * 0.15, 0.45 - i * 0.1, 0.47, body);
  if (horned) {
    box(0, 1.4, -0.76, 1.56, 0.58, 0.29, detail);
    box(0, 1.76, -0.76, 1.25, 0.25, 0.24, body);
    for (const side of [-1, 1]) {
      box(side * 0.58, 1.59, -0.76, 0.28, 0.24, 0.26, BONE);
      box(side * 0.32, 1.45, -1.28, 0.2, 0.23, 0.48, BONE);
      box(side * 0.32, 1.42, -1.63, 0.12, 0.13, 0.26, STONE);
    }
    box(0, 1.25, -1.61, 0.17, 0.22, 0.18, BONE);
  } else if (plated) {
    for (let i = 0; i < 5; i++) {
      const height = [0.43, 0.66, 0.76, 0.48, 0.29][i];
      const z = -0.5 + i * 0.39;
      const x = i % 2 ? 0.14 : -0.14;
      box(x, 1.4 + height * 0.15, z, 0.25, height, 0.31, detail);
      box(x, 1.39 + height * 0.67, z - 0.04, 0.145, height * 0.36, 0.2, STONE);
    }
    for (const x of [-0.3, 0.3]) box(x, 0.99, 1.8, 0.26, 0.13, 0.38, BONE);
  } else {
    box(0, 1.39, 0.18, 1.16, 0.31, 1.41, detail);
    for (let i = 0; i < 3; i++) {
      for (const x of [-0.36, 0, 0.36]) box(x, 1.57, -0.25 + i * 0.45, 0.24, 0.14, 0.26, i % 2 ? STONE : BONE);
    }
    box(0, 0.8, 1.98, 0.76, 0.42, 0.48, detail);
    box(0, 0.79, 2.1, 0.6, 0.56, 0.36, body);
  }
  return { top: horned ? 1.89 : headHeight + 0.24, headZ: horned ? -0.76 : -1.19,
    width: horned ? 1.24 : 0.73, hatDepth: horned ? 0.68 : 0.83, frill: horned,
    eye: headHeight + 0.08, eyeZ: -1.28, eyeWidth: horned ? 1.05 : 0.815,
    faceZ: -1.69, faceY: headHeight - 0.11,
    neckY: horned ? 0.95 : headHeight - 0.02, neckZ: -0.68,
    neckWidth: width * 0.83 + 0.07, neckDepth: 0.75, shoulderX: (horned ? 1.16 : plated ? 1.02 : 1.16) / 2 + 0.05 };
}

export function drawSpecies(box, skin, phase, idle, grounded) {
  return skin.species === "raptor" || skin.species === "crest"
    ? biped(box, skin, phase, idle, grounded)
    : quadruped(box, skin, phase, idle, grounded);
}

export const REX_FIT = { top: 2.41, headZ: -0.73, width: 1.18, hatDepth: 1,
  eye: 2.17, eyeZ: -0.80, eyeWidth: 1.27, faceZ: -1.455, faceY: 2.04,
  neckY: 1.53, neckZ: -0.44, neckWidth: 0.94, neckDepth: 0.66, shoulderX: 0.58 };

export function drawAccessories(box, fit, look) {
  const { top, headZ, width, hatDepth, frill, eye, eyeZ, eyeWidth, faceZ, faceY,
    neckY, neckZ, neckWidth, neckDepth, shoulderX } = fit;
  const hat = (x, y, z, w, h, d, color) => box(x, top + y, headZ + z * hatDepth, w, h, d * hatDepth, color);
  const sides = [-1, 1];
  const collar = (y, height, color) => {
    for (const side of sides) box(side * neckWidth / 2, y, neckZ, 0.075, height, neckDepth, color);
    box(0, y, neckZ - neckDepth / 2, neckWidth, height, 0.075, color);
    box(0, y, neckZ + neckDepth / 2, neckWidth, height, 0.075, color);
  };
  const collarFront = neckZ - neckDepth / 2;
  switch (look.head) {
    case "cap":
      hat(0, 0.12, 0, width * 0.93, 0.23, 0.65, DARK);
      hat(0, 0.05, -0.48, width * 1.03, 0.105, 0.58, "#171816");
      hat(0, 0.26, -0.02, 0.18, 0.065, 0.18, STONE);
      break;
    case "visor":
      for (const side of sides) {
        box(side * eyeWidth / 2, eye, eyeZ, 0.075, 0.23, 0.35, "#181918");
        box(side * (eyeWidth / 2 + 0.045), eye + 0.035, eyeZ, 0.025, 0.10, 0.23, BONE);
      }
      break;
    case "crown":
      hat(0, 0.08, 0, width * 0.92, 0.16, 0.61, STONE);
      for (const side of [-1, 0, 1]) hat(side * width * 0.31, 0.25, -0.18, 0.17, side ? 0.25 : 0.33, 0.17, BONE);
      break;
    case "helmet":
      hat(0, 0.12, 0, width + 0.19, 0.25, 0.7, "#666b60");
      hat(0, 0.30, 0, width * 0.75, 0.14, 0.46, STONE);
      for (const side of sides) hat(side * (width / 2 + 0.071), frill ? 0.05 : -0.09, frill ? -0.24 : 0.11,
        0.13, frill ? 0.21 : 0.44, 0.24, STONE);
      break;
    case "comet":
      hat(0, 0.045, 0, width + 0.05, 0.09, 0.44, DARK);
      hat(0.12, 0.28, -0.14, 0.45, 0.14, 0.14, BONE);
      hat(0.12, 0.28, -0.14, 0.14, 0.45, 0.14, BONE);
      hat(0.12, 0.12, -0.05, 0.08, 0.25, 0.08, STONE);
      break;
    case "leaf":
      hat(0, 0.065, 0, width + 0.05, 0.13, 0.39, "#4f5248");
      for (let i = 0; i < 4; i++) hat(0.06 + i * 0.04, 0.20 + i * 0.09, i * 0.16, 0.46 - i * 0.079, 0.15, 0.35, i % 2 ? STONE : BONE);
      break;
    case "wing-crest":
      hat(0, .06, 0, width * .98, .12, .53, "#59676b");
      for (const side of [-1, 0, 1]) {
        for (let i = 0; i < 3; i++) hat(side * width * .31, .20 + i * .12, i * .19,
          .18, .22 - i * .033, .30, side ? "#9cb5b8" : "#d5ddd3");
      }
      break;
    case "gem-goggles":
      for (const side of sides) {
        box(side * eyeWidth / 2, eye, eyeZ, .069, .12, .53, "#314b44");
        box(side * (eyeWidth / 2 + .045), eye, eyeZ - .04, .095, .27, .29, "#41695f");
        box(side * (eyeWidth / 2 + .102), eye, eyeZ - .04, .035, .17, .19, "#a9cabb");
      }
      break;
    case "sun-hat":
      hat(0, .06, 0, width * 1.43, .105, .91, "#a98c58");
      hat(0, .20, 0, width * .79, .25, .58, "#ceb481");
      hat(0, .16, -.03, width * .85, .079, .60, "#8a6143");
      break;
    case "bone-mask":
      box(0, faceY, faceZ - .079, width * (frill ? .50 : .91), .31, .16, BONE);
      for (const side of sides) {
        const cheek = width * (frill ? .19 : .31);
        box(side * cheek, faceY + .10, faceZ - .11, .17, .16, .13, STONE);
        box(side * cheek, faceY - .21, faceZ - .13, .10, .21, .11, "#dbd2b8");
      }
      break;
  }
  if (look.neck === "scarf") {
    collar(neckY, 0.18, BONE);
    for (const z of [-0.22, 0.05, 0.28]) box(neckWidth / 2 + 0.043, neckY + 0.02, neckZ + z, 0.045, 0.11, 0.12, "#777a70");
    box(shoulderX, neckY - 0.17, neckZ + 0.29, 0.13, 0.32, 0.29, STONE);
  } else if (look.neck === "pendant") {
    collar(neckY + 0.03, 0.09, STONE);
    box(0, neckY - 0.17, collarFront - 0.041, 0.35, 0.37, 0.11, DARK);
    box(0, neckY - 0.17, collarFront - 0.11, 0.26, 0.26, 0.08, BONE);
  } else if (look.neck === "ruff") {
    collar(neckY, 0.25, BONE);
    for (const side of sides) {
      for (let i = 0; i < 3; i++) box(side * (neckWidth / 2 + 0.05), neckY - 0.109 + (i % 2) * 0.04,
        neckZ - 0.23 + 0.23 * i, 0.095, 0.24, 0.12, STONE);
    }
  } else if (look.neck === "fern-cloak") {
    collar(neckY, .17, "#4c6551");
    for (const side of sides) {
      box(side * (neckWidth / 2 + shoulderX) / 2, neckY, neckZ + .31, shoulderX - neckWidth / 2 + .12, .15, .25, "#4c6551");
      for (let i = 0; i < 4; i++) box(side * shoulderX, neckY - .13 * i, neckZ + .40 + i * .105,
        .15, .18, .38 - i * .05, i % 2 ? "#72916f" : "#8aa681");
    }
  } else if (look.neck === "shell-collar") {
    collar(neckY + .04, .10, "#716b56");
    for (let i = -2; i <= 2; i++) box(i * neckWidth * .19, neckY - .07, collarFront - .052,
      neckWidth * .16, .19 + (2 - Math.abs(i)) * .08, .11, i % 2 ? "#c7ae8d" : "#e2d0ad");
  } else if (look.neck === "river-band") {
    collar(neckY, .19, "#587384");
    box(0, neckY + .04, collarFront - .045, neckWidth * .97, .047, .04, "#b0c8cb");
    box(shoulderX, neckY - .21, neckZ + .29, .17, .31, .14, "#83a1a9");
  } else if (look.neck === "ore-charm") {
    collar(neckY + .04, .08, "#5a6064");
    for (const i of [-1, 0, 1]) box(i * neckWidth * .16, neckY - .19, collarFront - .062,
      .14, i ? .23 : .39, .13, i ? "#8fa0b6" : "#b3cbd9");
  }
}
