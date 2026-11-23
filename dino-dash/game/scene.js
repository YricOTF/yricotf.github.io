import { biomeAt, biomeLength, BIOMES, flightPose, isFlyer } from "./course.js?v=10";
import { ARENA_BOSS_DEPTH, ARENA_EXIT, ARENA_LEAD, arenaSites, runGroups, hash, LANES, clamp, tune } from "./runner.js?v=10";
import { skinInfo, unpackLook } from "./catalog.js?v=6";
import { battleRoute, bossAttack, BOSSES, chargeDepth, impactTime, sweepDepth } from "./challenge.js?v=10";
import { drawAccessories, drawSpecies, REX_FIT } from "./avatars.js?v=6";
import { arenaEntrance, courseLandmark, mountainPortal, ravine, sandstone, trackside, vineTree } from "./landscape.js?v=10";
import { VINE_GAP_END, VINE_GAP_START } from "./movement.js?v=6";
import { RIVER_RELEASE, RIVER_SWING, SECTION_RULES, sectionFossils, sectionsNear } from "./sections.js?v=10";

const FOG = [0.94, 0.94, 0.92];
const colors = new Map();
function rgb(hex) {
  if (Array.isArray(hex)) return hex;
  if (!colors.has(hex)) {
    colors.set(hex, [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255));
  }
  return colors.get(hex);
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vec = (a, b) => a.map((v, i) => v - b[i]);
const unit = a => a.map(v => v / Math.hypot(...a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function lookAt(eye, target) {
  const z = unit(vec(eye, target));
  const x = unit(cross([0, 1, 0], z));
  const y = cross(z, x);
  return [
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ];
}

function mul(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] = a[row] * b[col * 4] + a[row + 4] * b[col * 4 + 1] + a[row + 8] * b[col * 4 + 2] + a[row + 12] * b[col * 4 + 3];
    }
  }
  return out;
}

function perspective(aspect) {
  const f = 1 / Math.tan(0.77 / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, -1.0015, -1, 0, 0, -0.24, 0];
}

function ortho(aspect, height) {
  return [2 / (height * aspect), 0, 0, 0, 0, 2 / height, 0, 0, 0, 0, -2 / 90, 0, 0, 0, -1, 1];
}

const faces = [
  [0, 3, 2, 1, 0.69], [4, 5, 6, 7, 0.91],
  [0, 4, 7, 3, 0.74], [1, 2, 6, 5, 0.8],
  [3, 7, 6, 2, 1.12], [0, 1, 5, 4, 0.62],
];
const triangles = [0, 1, 2, 0, 2, 3];

function programFor(gl) {
  const shader = (type, source) => {
    const result = gl.createShader(type);
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
    return result;
  };
  const result = gl.createProgram();
  const vertex = shader(gl.VERTEX_SHADER, `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    uniform mat4 uMatrix;
    varying vec3 vColor;
    varying float vDepth;
    void main(void) {
      gl_Position = uMatrix * vec4(aPosition, 1.0);
      vColor = aColor;
      vDepth = gl_Position.w;
    }
  `);
  const fragment = shader(gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec3 vColor;
    varying float vDepth;
    uniform float uFog;
    uniform vec3 uSky;
    void main(void) {
      float fog = smoothstep(29.0, 124.0, vDepth) * uFog;
      gl_FragColor = vec4(mix(vColor, uSky, fog), 1.0);
    }
  `);
  gl.attachShader(result, vertex);
  gl.attachShader(result, fragment);
  gl.linkProgram(result);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
  return result;
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.width = canvas.clientWidth;
    this.height = canvas.clientHeight;
    if (typeof ResizeObserver === "function") {
      this.observer = new ResizeObserver(([entry]) => {
        this.width = entry.contentRect.width;
        this.height = entry.contentRect.height;
      });
      this.observer.observe(canvas);
    }
    this.vertices = new Float32Array(36 * 6 * 680);
    this.points = new Float32Array(8 * 3);
    this.touch = window.matchMedia("(pointer: coarse)").matches;
    this.game = canvas.id === "play-canvas";
    this.gl = canvas.getContext("webgl", { alpha: true, antialias: !(this.touch && this.game), depth: true, powerPreference: "low-power" });
    this.pixel = this.gl ? null : canvas.getContext("2d");
    if (this.gl) {
      const gl = this.gl;
      this.program = programFor(gl);
      this.buffer = gl.createBuffer();
      this.locations = Object.fromEntries(["aPosition", "aColor"].map(name => [name, gl.getAttribLocation(this.program, name)]));
      this.uniforms = Object.fromEntries(["uMatrix", "uFog", "uSky"].map(name => [name, gl.getUniformLocation(this.program, name)]));
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
    }
  }

  resize() {
    const cssWidth = this.observer ? this.width : this.canvas.clientWidth;
    const cssHeight = this.observer ? this.height : this.canvas.clientHeight;
    const pixelLimit = this.game ? Math.sqrt(1_400_000 / Math.max(1, cssWidth * cssHeight)) : 1.65;
    const density = Math.min(this.touch && this.game ? 1.35 : 1.65, window.devicePixelRatio || 1, pixelLimit);
    const width = Math.max(1, Math.floor(cssWidth * density));
    const height = Math.max(1, Math.floor(cssHeight * density));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl?.viewport(0, 0, width, height);
    }
    return width / height;
  }

  box(x, y, z, w, h, d, color, actor) {
    const dx = w / 2, dy = h / 2, dz = d / 2;
    const points = this.points;
    for (let corner = 0; corner < 8; corner++) {
      const px = x + (corner % 4 === 1 || corner % 4 === 2 ? dx : -dx);
      const py = y + (corner & 2 ? dy : -dy);
      const pz = z + (corner & 4 ? dz : -dz);
      const i = corner * 3;
      if (actor) {
        let right = px, up = py * actor.flatten, forward = pz;
        if (actor.tilt) {
          const { pitchCos, pitchSin, rollCos, rollSin } = actor.tilt;
          const pitchedY = up * pitchCos - forward * pitchSin;
          forward = up * pitchSin + forward * pitchCos;
          right = px * rollCos - pitchedY * rollSin;
          up = px * rollSin + pitchedY * rollCos;
        }
        points[i] = actor.x + (right * actor.cos + forward * actor.sin) * actor.scale;
        points[i + 1] = actor.y + up * actor.scale;
        points[i + 2] = actor.z + (forward * actor.cos - right * actor.sin) * actor.scale;
      } else {
        points[i] = px;
        points[i + 1] = py;
        points[i + 2] = pz;
      }
    }
    if (this.count + 216 > this.vertices.length) {
      const next = new Float32Array(this.vertices.length * 2);
      next.set(this.vertices);
      this.vertices = next;
    }
    const [r, g, b] = rgb(color);
    const vertices = this.vertices;
    let index = this.count;
    for (const face of faces) {
      const red = Math.min(1, r * face[4]);
      const green = Math.min(1, g * face[4]);
      const blue = Math.min(1, b * face[4]);
      for (const corner of triangles) {
        const offset = face[corner] * 3;
        vertices[index++] = points[offset];
        vertices[index++] = points[offset + 1];
        vertices[index++] = points[offset + 2];
        vertices[index++] = red;
        vertices[index++] = green;
        vertices[index++] = blue;
      }
    }
    this.count = index;
  }

  shadow(x, z, width, length, opacity = 1, ground = 0.015) {
    const shade = Math.round(213 - opacity * 36);
    const color = [shade / 255, (shade + 1) / 255, (shade - 3) / 255];
    this.box(x, ground, z, width * 0.66, 0.015, length, color);
    this.box(x, ground + 0.001, z, width, 0.015, length * 0.51, color);
  }

  dino(x, y, z, angle, scale, phase, skinId, options = {}) {
    const { slide = 0, flash = 0, ghost = false, grounded = true, idle = false, pitch = 0, roll = 0, flatten = 1 } = options;
    const look = unpackLook(skinId);
    const skin = skinInfo(look.skin);
    const bob = idle ? Math.sin(phase) * 0.043 : Math.abs(Math.sin(phase)) * 0.078;
    const actor = { x, y: y + bob, z, cos: Math.cos(angle), sin: Math.sin(angle), scale, flatten: slide ? 0.5 : flatten };
    if (pitch || roll) actor.tilt = { pitchCos: Math.cos(pitch), pitchSin: Math.sin(pitch), rollCos: Math.cos(roll), rollSin: Math.sin(roll) };
    const box = (left, up, forward, width, height, depth, color) => {
      let tint = color;
      if (ghost) tint = rgb(color).map(v => v * 0.46 + 0.48);
      if (flash && Math.floor(flash * 16) % 2) tint = rgb(tint).map(v => v * 0.42 + 0.38);
      this.box(left, up, forward, width, height, depth, tint, actor);
    };
    if (skin.species !== "rex") {
      const fit = drawSpecies(box, skin, phase, idle, grounded);
      drawAccessories(box, fit, look);
      return;
    }
    const body = skin.body, detail = skin.detail;
    const charcoal = skin.id === "pale" ? "#696b64" : "#272826";
    box(0, 1.04, 0.05, 1.03, 0.96, 1.23, body);
    box(0, 0.95, -0.48, 0.76, 0.77, 0.35, detail);
    box(0, 1.58, -0.44, 0.87, 0.85, 0.58, body);
    box(0, 2.07, -0.61, 1.18, 0.72, 0.94, body);
    box(0, 2.04, -1.15, 1.1, 0.49, 0.61, body);
    box(0, 1.77, -1.1, 1.04, 0.16, 0.65, charcoal);
    box(0, 1.63, -1.065, 1.04, 0.18, 0.66, body);
    box(0, 2.34, -0.74, 0.97, 0.11, 0.52, detail);
    for (const side of [-1, 1]) {
      const eye = "#eeeee7";
      box(side * 0.596, 2.17, -0.8, 0.057, 0.17, 0.15, eye);
      box(side * 0.557, 2.045, -1.31, 0.035, 0.069, 0.08, "#30322e");
      box(side * 0.509, 1.734, -1.17, 0.05, 0.072, 0.085, "#d8d9d1");
      box(side * 0.509, 1.734, -0.98, 0.05, 0.061, 0.072, "#d8d9d1");
      box(side * 0.54, 1.29, -0.49, 0.19, 0.24, 0.27, body);
      box(side * 0.605, 1.22, -0.66, 0.14, 0.13, 0.23, detail);
      const stride = idle ? 0 : Math.sin(phase + (side > 0 ? Math.PI : 0)) * (grounded ? 0.35 : 0.12);
      const lift = idle ? 0 : grounded ? Math.max(0, Math.sin(phase + (side > 0 ? Math.PI : 0))) * 0.17 : 0.14;
      box(side * 0.34, 0.58 + lift, 0.13 + stride * 0.65, 0.34, 0.65, 0.41, body);
      box(side * 0.36, 0.235 + lift, 0.25 + stride, 0.27, 0.38, 0.29, charcoal);
      box(side * 0.36, 0.105 + lift, 0.11 + stride, 0.37, 0.18, 0.52, body);
      box(side * 0.39, 0.13 + lift, -0.135 + stride, 0.2, 0.098, 0.067, detail);
    }
    box(0, 1.035, 0.767, 0.75, 0.54, 0.46, body);
    box(0, 1.045, 1.075, 0.57, 0.39, 0.38, body);
    box(0, 1.12, 1.4, 0.36, 0.28, 0.39, detail);
    box(0, 1.19, 1.66, 0.25, 0.19, 0.24, body);
    for (const [z, y, width] of [[0.02, 1.58, 0.32], [0.32, 1.56, 0.27], [0.61, 1.44, 0.22], [0.97, 1.31, 0.16]]) {
      box(0, y, z, width, 0.17, 0.19, detail);
    }
    if (skin.id === "pale") {
      for (const [yy, zz] of [[1.03, 0.27], [1.22, 0.08], [0.88, -0.13]]) box(0.526, yy, zz, 0.028, 0.125, 0.14, "#85877e");
    }
    if (skin.id === "shadow") {
      for (let i = 0; i < 4; i++) {
        box(0, 1.78 - i * 0.11, i * 0.29, 0.29, 0.38 - i * 0.052, 0.21, detail);
      }
    }
    drawAccessories(box, REX_FIT, look);
  }

  cactus(x, z, size = 1, flip = 1, soft = false) {
    const color = soft ? "#9b9e93" : "#5a5c54";
    const tip = soft ? "#aeb1a5" : "#797b71";
    const block = (xx, y, zz, w, h, d, tint = color) => this.box(x + xx * size * flip, y * size, z + zz * size, w * size, h * size, d * size, tint);
    block(0, 0.92, 0, 0.4, 1.84, 0.41);
    block(0, 1.88, 0, 0.28, 0.14, 0.32, tip);
    block(-0.32, 0.74, 0, 0.53, 0.23, 0.3);
    block(-0.54, 0.994, 0, 0.22, 0.59, 0.3);
    block(-0.54, 1.31, 0, 0.16, 0.11, 0.22, tip);
    block(0.35, 1.04, 0, 0.43, 0.22, 0.3);
    block(0.53, 1.29, 0, 0.22, 0.62, 0.3);
    block(0.53, 1.63, 0, 0.15, 0.12, 0.23, tip);
    block(0, 0.57, 0.214, 0.075, 0.74, 0.036, tip);
  }

  rock(x, z, size = 1, soft = false) {
    const base = soft ? "#a6a89f" : "#777b73";
    this.box(x, size * 0.22, z, size * 1.36, size * 0.44, size * 0.92, base);
    this.box(x - size * 0.13, size * 0.53, z - size * 0.06, size * 0.94, size * 0.34, size * 0.69, base);
    this.box(x - size * 0.25, size * 0.77, z - size * 0.08, size * 0.54, size * 0.19, size * 0.49, soft ? "#bcbeb4" : "#92968b");
    this.box(x + size * 0.79, size * 0.12, z + size * 0.16, size * 0.38, size * 0.24, size * 0.38, base);
  }

  cloud(x, y, z, scale, color = "#d2d3cb") {
    const block = (left, up, w, h) => this.box(x + left * scale, y + up * scale, z, w * scale, h * scale, 0.12, color);
    block(0, 0, 2.9, 0.19);
    block(-0.44, 0.2, 1.78, 0.21);
    block(-0.49, 0.42, 1.09, 0.24);
    block(0.62, 0.17, 1.17, 0.17);
  }

  mesa(x, z, scale, color = "#b4b6ad") {
    this.box(x, 0.35 * scale, z, 4.7 * scale, 0.7 * scale, 2.1 * scale, color);
    this.box(x + 0.17 * scale, 0.95 * scale, z, 3.7 * scale, 0.63 * scale, 1.67 * scale, color);
    this.box(x - 0.12 * scale, 1.46 * scale, z, 2.6 * scale, 0.47 * scale, 1.29 * scale, color);
  }

  fossil(x, y, z, angle, scale = 1) {
    const actor = { x, y, z, cos: Math.cos(angle), sin: Math.sin(angle), scale, flatten: 1 };
    const block = (left, up, depth, w, h, d, color) => this.box(left, up, depth, w, h, d, color, actor);
    block(-.04, -.07, 0, .67, .42, .29, "#77786c");
    block(.04, .14, .012, .49, .23, .26, "#919182");
    block(-.20, -.25, -.019, .28, .14, .24, "#707467");
    block(.25, .025, .026, .20, .19, .23, "#a1a18d");
    // The relief runs through the rock so both turning faces share the same voxel shape.
    block(-.14, .06, 0, .31, .10, .337, "#f0eedc");
    block(-.205, -.04, 0, .20, .12, .337, "#dedec8");
    block(.018, .026, 0, .145, .060, .338, "#e9e6d2");
    block(.12, -.032, 0, .137, .055, .338, "#e9e6d2");
    for (let i = 0; i < 2; i++) block(.024 + i * .086, -.054 - i * .043, 0, .038, .106, .338, "#cecfb8");
    block(-.205, .077, 0, .049, .046, .342, "#737b6c");
  }

  laneMark(x, z, width, length, time, safe = false) {
    const bright = safe ? "#f1f2e6" : "#393d35";
    const light = safe ? "#b4b8a8" : "#9a9d8d";
    const edge = width / 2;
    this.box(x, 0.013, z, width, 0.019, length, light);
    for (const side of [-1, 1]) {
      this.box(x + side * edge, 0.023, z, 0.094, 0.017, length, bright);
      this.box(x, 0.025, z + side * length / 2, width, 0.018, 0.13, bright);
    }
    const move = (time * 2.4) % 0.85;
    for (let i = -2; i <= 2; i++) {
      this.box(x, 0.027, z + i * length * 0.14 + move * length * 0.12, width * (safe ? 0.46 : 0.73), 0.019, safe ? 0.15 : 0.21, bright);
    }
  }

  meteor(x, z, fall, elapsed) {
    const t = clamp(fall, 0, 1);
    if (elapsed > 0.65) return;
    if (elapsed > 0) {
      this.shadow(x, z, 2.52, 2.32, 0.94, 0.034);
      for (let i = 0; i < 7; i++) {
        const direction = i * Math.PI * 2 / 7;
        const spread = 0.26 + elapsed * 2.7;
        const y = 0.1 + (1 - elapsed / 0.68) * (i % 3) * 0.32;
        this.box(x + Math.cos(direction) * spread, y, z + Math.sin(direction) * spread, 0.24, 0.22, 0.24, i % 2 ? "#687065" : "#eaecde");
      }
      return;
    }
    if (t <= 0) return;
    if (t >= 0.68) {
      const grow = (t - 0.68) / 0.32;
      this.shadow(x, z, 1.42 + grow * 1.03, 0.69 + grow * 1.55, 0.75, 0.035);
    }
    const y = 0.54 + Math.pow(1 - t, 1.55) * 13.8;
    const xx = x + 1.0 * (1 - t);
    this.box(xx, y, z, 1.2, 0.93, 1.02, "#53574c");
    this.box(xx - 0.01, y + 0.42, z - 0.02, 0.81, 0.27, 0.69, "#969b8b");
    this.box(xx - 0.19, y - 0.06, z + 0.52, 0.64, 0.35, 0.09, "#d7dacd");
    for (let i = 1; i <= 5; i++) {
      const size = 0.48 - i * 0.068;
      this.box(xx + i * 0.08, y + i * 0.47, z - i * 0.17, size, size, size, i % 2 ? "#e3e6da" : "#b1b6a7");
    }
  }

  power(x, z, pick, time) {
    const angle = time * 2 + pick.d;
    const actor = { x, y: pick.y + Math.sin(time * 4.8 + pick.d) * 0.115, z, cos: Math.cos(angle), sin: Math.sin(angle), scale: 1, flatten: 1 };
    const tile = (xx, y, w, h, color, depth = 0.25) => this.box(xx, y, 0, w, h, depth, color, actor);
    const dark = "#393d32", light = "#ebeddf";
    this.shadow(x, z, 0.93, 0.63, 0.27);
    if (pick.kind === "magnet") {
      tile(0, -0.21, 0.69, 0.23, dark);
      for (const side of [-1, 1]) {
        tile(side * 0.25, 0.03, 0.23, 0.42, dark);
        tile(side * 0.25, 0.29, 0.23, 0.14, light);
      }
    } else if (pick.kind === "shield") {
      tile(0, 0.13, 0.7, 0.42, dark);
      tile(0, -0.19, 0.47, 0.27, dark);
      tile(0, -0.31, 0.24, 0.16, dark);
      tile(0, 0.055, 0.16, 0.55, light, 0.28);
    } else if (pick.kind === "amber") {
      tile(0, 0, 0.75, 0.47, dark);
      tile(0, 0, 0.47, 0.74, dark);
      tile(0, 0.01, 0.49, 0.45, "#c0c3ae", 0.28);
      for (const side of [-1, 1]) tile(side * 0.12, 0, 0.09, 0.29, light, 0.31);
    } else {
      for (let i = 0; i < 4; i++) tile(0.15 - i * 0.12, 0.34 - i * 0.18, 0.42 - i * 0.065, 0.18, i % 2 ? "#a2a698" : "#e9ebdf");
      tile(-0.12, -0.27, 0.23, 0.13, dark);
    }
  }

  attackFossil(x, y, z, time, scale = 1) {
    const size = 0.56 * scale;
    this.box(x, y, z, size, size, size, "#c08b46");
    this.box(x, y, z + 0.035, size * 1.42, size * 0.36, size * 1.03, "#eed39b");
    this.box(x, y, z + 0.058, size * 0.37, size * 1.4, size * 1.01, "#e7bf77");
    for (let i = 0; i < 4; i++) {
      const angle = time * 5 + i * Math.PI / 2;
      const lift = Math.sin(angle) * 0.6;
      this.box(x + Math.cos(angle) * 0.71, y + lift, z + 0.05, 0.09, 0.09, 0.13, "#f4db9f");
    }
  }

  battle(run, time, roof, habitat) {
    const state = run.boss;
    const attack = bossAttack(state);
    const exposed = state.phase === "exposed";
    const throwing = state.phase === "throw";
    const striking = state.phase === "stagger" || state.phase === "victory";
    const aiming = state.phase === "warning" || state.phase === "impact";
    const weakness = LANES[state.weakLane];
    const leading = LANES[state.lanes[0]] ?? 0;
    const bossX = exposed || throwing || striking ? weakness : aiming ? leading : 0;
    let z = state.phase === "intro" ? tune(-ARENA_BOSS_DEPTH, -15.7, clamp(state.age / 1.55, 0, 1)) : -15.7;
    if (state.phase === "warning" && attack.kind !== "meteor") {
      const buildup = state.age / attack.windup;
      z -= (attack.feint && !state.retargeted ? 3.3 : 1.7) * Math.sin(buildup * Math.PI);
    }
    const impactAge = state.age + (run.death?.age || 0) * 0.88;
    if (attack.kind === "charge" && state.phase === "impact") z = chargeDepth(impactAge, state.index);
    if (exposed || throwing || striking) z -= 7 * (exposed ? clamp(state.age / 0.25, 0, 1) : 1);
    const collapse = state.phase === "victory" ? clamp(state.age / 0.74, 0, 1) : 0;
    const scale = 1.85;
    const tintFlash = striking ? 0.81 - state.age : 0;
    const yaw = attack.kind === "sweep" && state.phase === "impact" ? Math.PI - 0.7 : Math.PI + 0.06;
    this.shadow(bossX, z, 3.3 * scale, 2.9 * scale, 0.58);
    this.dino(bossX, collapse * 0.55, z, yaw + collapse * 0.19, scale, time * 9, BOSSES[state.index].skin,
      { grounded: !collapse, idle: collapse > 0.55, roll: collapse * 1.36,
        slide: state.phase === "warning" && attack.kind === "charge" && state.age > 0.12 && state.age < attack.windup - 0.1, flash: Math.max(0, tintFlash) });

    if (aiming) {
      for (const lane of state.lanes) {
        const x = LANES[lane];
        if (attack.kind !== "meteor" && state.phase === "warning") this.laneMark(x, -3.85, 2.75, 10.8, time);
        if (attack.kind === "meteor") this.meteor(x, -0.36,
          state.phase === "warning" ? Math.max(0, state.age / attack.windup * 0.51) : clamp(0.51 + 0.49 * impactAge / impactTime("meteor"), 0, 1),
          state.phase === "impact" ? Math.max(0, impactAge - impactTime("meteor")) : 0);
        if (attack.kind === "sweep" && state.phase === "impact" && impactAge < 0.51) {
          const front = sweepDepth(impactAge);
          this.box(x, 0.69, front, 2.52, 0.36, 0.54, "#565b50");
          this.box(x, 0.31, front - 0.45, 2.74, 0.16, 1.08, "#a5a591");
        }
      }
    }
    const route = battleRoute(state);
    if (route) {
      for (const mark of route.obstacles) this.obstacle(mark, route.distance - mark.d, time, false, roof, true, 0, habitat);
      for (const fossil of route.fossils || []) {
        const z = route.distance - fossil.d;
        if (z < 3 && run.picked[fossil.id] == null) this.fossil(LANES[fossil.lane], fossil.y, z, time * 2.8);
      }
      if (exposed) {
        const item = route.attack;
        const relative = route.distance - item.d;
        if (relative < 2) this.attackFossil(LANES[item.lane], item.y + 0.08 * Math.sin(time * 6), relative, time);
      }
    }
    if (throwing) {
      const travel = clamp(state.age / 0.46, 0, 1);
      this.attackFossil(tune(state.hitFrom, bossX, travel), tune(state.hitY, 2.24, travel) + Math.sin(Math.PI * travel) * 0.58,
        tune(-0.8, z + 1.2, travel), time, 0.83 + travel * 0.22);
    }
  }

  pterosaur(mark, relative, time) {
    const pose = flightPose(mark, relative);
    const { x, y, z, yaw, bank } = pose;
    const wing = Math.sin(time * 16 + mark.d) * 0.21;
    const actor = { x, y, z, cos: Math.cos(yaw), sin: Math.sin(yaw), scale: 1, flatten: 1 };
    const box = (xx, yy, zz, w, h, d, c) => this.box(xx, yy, zz, w, h, d, c, actor);
    this.shadow(x, z, 2.5, 1.27, y > 3 ? 0.19 : 0.38);
    box(0, 0, 0, 0.43, 0.36, 0.86, "#414640");
    box(0, 0.15, 0.43, 0.30, 0.26, 0.37, "#414640");
    box(0, 0.18, 0.75, 0.16, 0.12, 0.40, "#7e8174");
    box(0, 0.31, 0.22, 0.12, 0.25, 0.23, "#777e72");
    for (const side of [-1, 1]) {
      box(side * 0.168, 0.21, 0.51, 0.035, 0.068, 0.09, "#eeeee1");
      for (let i = 0; i < 4; i++) {
        const yy = wing * (i + 1) * 0.42 + side * bank * (i + 1) * 0.28;
        box(side * (0.42 + i * 0.30), yy, 0.16 - i * 0.19,
          0.39, 0.125 - i * 0.019, 0.75 - i * 0.136, i % 2 ? "#6a7268" : "#596258");
      }
    }
  }

  jungleTree(x, z, height, variant) {
    this.box(x, height * 0.48, z, 0.83, height, 0.89, "#5e6553");
    this.box(x + 0.29, height * 0.68, z + 0.18, 0.25, height * 0.46, 0.54, "#737b66");
    this.box(x, height * 0.84, z, 2.3, 0.46, 0.67, "#606a55");
    this.box(x + 0.29, height, z, 3.8, 0.76, 2.95, variant ? "#687e65" : "#637660");
    this.box(x - 0.71, height + 0.57, z + 0.1, 2.72, 0.61, 2.39, "#859480");
    this.box(x + 0.51, height + 1.02, z - 0.26, 1.77, 0.43, 1.63, "#94a18b");
  }

  minerals(x, z, size = 1) {
    for (let i = -1; i <= 1; i++) {
      const h = size * (i ? 0.56 : 1.0);
      this.box(x + i * size * 0.34, h * 0.49, z + Math.abs(i) * 0.22, 0.32 * size, h, 0.31 * size, "#91b0a6");
      this.box(x + i * size * 0.34, h * 1.02, z + Math.abs(i) * 0.22, 0.19 * size, 0.11 * size, 0.18 * size, "#c8dacf");
    }
  }

  rails(x, z, length, detailed) {
    this.box(x, 0.014, z, 1.09, 0.022, length, "#767d75");
    for (const side of [-1, 1]) this.box(x + side * 0.43, 0.05, z, 0.07, 0.048, length, "#adb4a8");
    for (let i = detailed ? -1 : 0; i <= (detailed ? 1 : 0); i++) {
      this.box(x, 0.026, z + length * i / 3, 1.26, 0.036, 0.14, "#575d55");
    }
  }

  riverSurface(start, end, distance, time, row) {
    const length = end - start;
    const z = distance - (start + end) / 2;
    this.box(0, -0.97, z, 126, 0.11, length + 0.02, row % 2 ? "#647e74" : "#698479");
    for (let i = 0; i < 8; i++) {
      const x = ((hash(51 + row, i) * 36 + time * 2.35) % 36) - 18;
      const ripple = hash(111 + row, i);
      this.box(x, -0.902, z + (ripple - 0.5) * length * 0.82, 0.8 + ripple * 2.3, 0.013,
        Math.min(length * 0.12, 0.19), i % 2 ? "#9bafa1" : "#829f92");
    }
  }

  sectionRails(section, start, end, distance, detailed) {
    const z = distance - (start + end) / 2;
    this.box(0, -1.16, z, 9.4, 0.18, end - start, "#485950");
    for (const x of [-32, 32]) this.box(x, -0.22, z, 54.4, 0.43, end - start, "#69766c");
    for (const [lane, x] of LANES.entries()) {
      let cursor = start;
      const cuts = section.forks.filter(fork => fork.lane !== lane && fork.d < end && fork.d + 7.1 > start);
      for (const cut of [...cuts, { d: end }]) {
        const limit = Math.min(end, cut.d);
        if (limit > cursor + 0.02) {
          const mid = distance - (limit + cursor) / 2;
          this.box(x, -0.18, mid, 1.75, 0.35, limit - cursor, "#6e7061");
          this.rails(x, mid, limit - cursor, detailed);
        }
        cursor = Math.max(cursor, cut.d + 7.1);
      }
    }
  }

  drawSection(section, run, time, roof) {
    const rel = d => run.distance - d;
    const near = z => z > -105 && z < 20;
    if (section.kind === "river") {
      for (const bank of [section.start, section.end]) {
        const z = rel(bank);
        if (!near(z)) continue;
        this.box(0, -0.47, z + (bank === section.start ? 0.30 : -0.30), 46, 0.94, 0.61, "#77836b");
        for (const x of [-6.2, 6.2]) this.jungleTree(x, z + (bank === section.start ? 2.2 : -2.2), 7.4, x > 0);
      }
      for (const rope of section.vines) {
        const z = rel(rope.d + 8);
        if (!near(z)) continue;
        const held = run.ride?.kind === "river" && run.ride.id === rope.id;
        const grip = held ? { y: run.y + 1.35, z: 0,
          ready: run.distance - rope.d >= RIVER_RELEASE && run.distance - rope.d <= RIVER_SWING } : null;
        vineTree(this, LANES[rope.lane], z, rope.side, grip, true, true);
      }
    } else {
      const z = rel(section.start);
      if (z < 0 && near(z)) this.cart(0, z);
      for (const fork of section.forks) {
        const x = LANES[fork.lane];
        const arrowZ = rel(fork.d - 8);
        if (!near(arrowZ)) continue;
        for (const other of LANES.filter(lane => lane !== x)) {
          const blocked = rel(fork.d - 0.18);
          this.box(other, 0.28, blocked, 1.68, 0.56, 0.40, "#9a845e");
          this.box(other, 0.44, blocked + 0.23, 1.39, 0.12, 0.07, "#c4aa76");
        }
        const post = x + (x === 3 ? -0.96 : 0.96);
        this.box(post, 1.37, arrowZ, 0.14, 2.74, 0.17, "#7d6b55");
        this.box(x, 2.67, arrowZ, 1.37, 0.66, 0.17, "#5b6858");
        this.box(x, 2.63, arrowZ + 0.11, 0.17, 0.30, 0.06, "#e4ca87");
        this.box(x, 2.78, arrowZ + 0.11, 0.55, 0.13, 0.06, "#e4ca87");
        this.box(x, 2.89, arrowZ + 0.11, 0.30, 0.11, 0.06, "#e4ca87");
      }
      for (const beam of section.beams) if (near(rel(beam.d))) this.obstacle(beam, rel(beam.d), time, false, roof, true, 0, "cave");
    }
    for (const mark of sectionFossils(section)) {
      const z = rel(mark.d);
      if (z > -72 && z < 4 && run.picked[mark.id] == null) this.fossil(LANES[mark.lane], mark.y, z, time * 2.4 + mark.d);
    }
  }

  cart(x, z, loaded = false) {
    this.box(x, 0.39, z, 1.29, 0.18, 1.66, "#625e53");
    this.box(x, 0.5, z, 1.02, 0.09, 1.36, "#524b40");
    for (const side of [-1, 1]) {
      const end = z + side * 0.63;
      this.box(x, 0.22, end, 1.49, 0.12, 0.12, "#4b5049");
      this.box(x, 0.57, z + side * 0.79, 1.30, 0.2, 0.12, "#82735f");
      this.box(x + side * 0.62, 0.58, z, 0.16, 0.19, 1.57, "#978671");
      this.box(x + side * 0.72, 0.76, z, 0.18, 0.20, 1.72, "#a49279");
      this.box(x + side * 0.74, 0.88, z, 0.16, 0.08, 1.8, "#5b5d52");
      for (const wheel of [-1, 1]) {
        this.box(x + wheel * 0.68, 0.21, end, 0.23, 0.29, 0.36, "#444d47");
        this.box(x + wheel * 0.68, 0.21, end, 0.23, 0.38, 0.24, "#444d47");
        this.box(x + wheel * 0.81, 0.212, end, 0.07, 0.12, 0.12, "#a2a192");
      }
      this.box(x + side * 0.76, 0.70, z + 0.41, 0.07, 0.33, 0.08, "#65665b");
      this.box(x + side * 0.76, 0.70, z - 0.41, 0.07, 0.33, 0.08, "#65665b");
    }
    if (loaded) {
      this.box(x, 0.94, z, 1.12, 0.48, 1.34, "#626a62");
      this.box(x - 0.31, 1.23, z + 0.18, 0.54, 0.35, 0.7, "#90978d");
      this.box(x + 0.23, 1.28, z - 0.23, 0.48, 0.52, 0.58, "#9aada2");
    }
  }

  obstacle(mark, z, time, hit, roof, modern = true, deathAge = 0, habitat = "wild") {
    const x = LANES[mark.lane];
    if (mark.kind === "meteor") {
      if (z < -43) return;
      const fall = clamp((z + 26) / 26, 0, 1);
      this.meteor(x, z, hit ? 1 : fall, hit ? deathAge : z > 0 ? z / 15 : 0);
      return;
    }
    if (hit && !["vine", "rift", "washout"].includes(mark.kind)) return;
    if (isFlyer(mark.kind)) {
      this.pterosaur(mark, z, time);
    } else if (mark.kind === "vine") {
      vineTree(this, x, z, x === 0 ? mark.side : Math.sign(x), null, modern);
    } else if (mark.kind === "cart" || mark.kind === "minecart") {
      this.cart(x, z * (mark.kind === "cart" ? 1.25 : 1), mark.kind === "cart");
    } else if (mark.kind === "rift" || mark.kind === "washout" && modern) {
      ravine(this, x, z, mark.kind === "rift" ? 5.1 : 3, habitat === "jungle");
    } else if (mark.kind === "hurdle") {
      this.shadow(x, z, 2.38, 1.0, 0.44);
      if (habitat === "wild") sandstone(this, x, z, .79, 2.3);
      else if (habitat === "jungle") {
        this.box(x, .34, z, 2.41, .53, .68, "#66674e");
        this.box(x + .27, .66, z - .04, 1.78, .26, .59, "#7c8966");
        this.box(x + .68, .21, z + .33, .87, .31, .61, "#5f6c52");
        this.box(x - .63, .45, z + .37, .22, .32, .056, "#a09b7d");
      } else {
        this.box(x, .37, z, 2.14, .74, .79, "#706455");
        this.box(x, .73, z, 2.18, .15, .85, "#ad9b7e");
        for (const side of [-1, 1]) this.box(x + side * .78, .38, z + .42, .17, .75, .075, "#918d78");
      }
    } else if (mark.kind === "lowgate") {
      this.shadow(x, z, 2.56, 1.17, 0.51);
      if (habitat === "wild") {
        for (const side of [-1, 1]) sandstone(this, x + side * 1.10, z, 1.59, .53, -side);
        this.box(x, 1.43, z - .04, 2.56, .51, .82, "#9e967e");
        this.box(x - .38, 1.80, z - .19, 1.58, .28, .68, "#b4a78a");
      } else if (habitat === "jungle") {
        for (const side of [-1, 1]) this.box(x + side * 1.20, .91, z + side * .17, .30, 1.81, .62, "#59634e");
        this.box(x, 1.41, z, 2.81, .47, .84, "#637253");
        this.box(x + .33, 1.81, z - .13, 2.55, .33, 1.09, "#7b9171");
        this.box(x - .72, 1.49, z + .52, .55, .30, .36, "#859b77");
      } else {
        for (const side of [-1, 1]) this.box(x + side * 1.11, 1.04, z, .21, 2.08, .61, "#736654");
        this.box(x, 1.41, z, 2.49, .49, .74, "#978267");
        this.box(x, 1.74, z, 2.39, .16, .61, "#6f6859");
        for (const side of [-1, 1]) this.box(x + side * .92, 1.53, z + .4, .13, .32, .058, "#dfcda4");
      }
    } else if (mark.kind === "mud" || mark.kind === "washout") {
      const mud = mark.kind === "mud";
      this.box(x, 0.02, z, 2.73, 0.03, 3.12, mud ? "#6b6d56" : "#3d4945");
      this.box(x + 0.14, 0.037, z + 0.11, 2.03, 0.012, 2.66, mud ? "#84816a" : "#303d39");
      for (const side of [-1, 1]) {
        this.box(x + side * 1.02, 0.12, z + side * 0.91, 0.45, 0.22, 0.61, mud ? "#a2a28a" : "#777d71");
        this.box(x + side * 0.35, 0.052, z - side * 1.52, 1.73, 0.071, 0.29, mud ? "#9b987e" : "#928370");
      }
    } else if (["thorn", "idol", "pillar"].includes(mark.kind)) {
      this.shadow(x, z, 2.47, 1.91, 0.58);
      if (mark.kind === "idol" && habitat === "wild") {
        sandstone(this, x, z, 3.84, 2.2);
      } else if (mark.kind === "thorn") {
        for (let i = -1; i <= 1; i++) {
          this.box(x + i * 0.69, 1.63 + i * 0.17, z, 0.21, 3.38 + i * 0.34, 0.41, "#646c53");
          this.box(x + i * 0.62, 2.07 - i * 0.71, z + 0.26, 0.72, 0.35, 0.63, "#859175");
        }
        this.box(x, 1.54, z, 2.1, 0.24, 0.46, "#747d62");
      } else {
        const idol = mark.kind === "idol";
        this.box(x, 0.29, z, 2.29, 0.58, 1.57, idol ? "#788071" : "#64716a");
        this.box(x + 0.17, 1.54, z, 1.78, 2.42, 1.26, idol ? "#8f9480" : "#77857c");
        this.box(x - 0.15, 3.05, z - 0.07, 1.44, 0.92, 1.43, idol ? "#787e6d" : "#919c93");
        this.box(x, 3.68, z - 0.16, 1.08, 0.55, 0.93, "#899587");
        for (const side of [-1, 1]) this.box(x + side * 0.36, idol ? 2.98 : 1.05, z + 0.68,
          idol ? 0.32 : 0.14, idol ? 0.18 : 0.51, 0.14, idol ? "#535e50" : "#a8bdb2");
      }
    } else if (mark.kind === "pod" || mark.kind === "beam") {
      const wood = mark.kind === "beam";
      for (const side of [-1, 1]) {
        this.box(x + side * 1.13, 1.68, z, 0.24, 3.36, 0.42, wood ? "#867762" : "#66745b");
        if (!wood) {
          this.box(x + side * 0.52, 2.62, z - 0.09, 0.14, 1.4, 0.15, "#647459");
          this.box(x + side * 0.52, 1.76, z, 0.71, 0.81, 0.63, "#a29c75");
          this.box(x + side * 0.52, 1.39, z, 0.5, 0.19, 0.44, "#787957");
        }
      }
      this.box(x, 3.33, z, 2.52, 0.33, 0.59, wood ? "#978773" : "#738368");
      if (wood) this.box(x, 1.53, z + 0.1, 2.4, 0.53, 0.45, "#a18d72");
    } else if (mark.kind === "ore") {
      this.minerals(x, z, 1.75);
    } else if (mark.kind === "log" || mark.kind === "root") {
      this.shadow(x, z, 2.25, 1.72, 0.53);
      this.box(x, 0.39, z, 2.25, 0.72, 1.18, mark.kind === "log" ? "#777268" : "#6a715e");
      this.box(x + 0.12, 0.79, z + 0.07, 1.87, 0.16, 0.76, "#989484");
      for (const offset of [-0.55, 0.27]) this.box(x + offset, 0.53, z + 0.62, 0.16, 0.24, 0.07, "#aea995");
    } else if (mark.kind === "branch" || mark.kind === "stalactite") {
      const stone = mark.kind === "stalactite";
      this.box(x, 2.54, z, stone ? 1.55 : 2.66, stone ? 1.67 : 0.46, 0.82, stone ? "#626f6a" : "#5e715b");
      this.box(x, 1.45, z, stone ? 0.55 : 2.06, 0.34, 0.72, stone ? "#89928c" : "#6e8368");
      if (stone) {
        this.box(x + 0.08, 4.19, z + 0.19, 2.31, 2.47, 1.47, "#5f6c66");
        this.box(x + 0.12, (5.3 + roof) / 2, z + 0.09, 2.75, Math.max(0.3, roof - 5.3), 1.75, "#68766e");
      }
      else this.box(x + 0.95, 2.82, z + 0.02, 1.09, 0.37, 1.35, "#81997b");
    } else if (mark.kind === "cactus") {
      this.shadow(x, z, 1.45, 0.88, 0.5);
      this.cactus(x - 0.17, z, 0.93, 1);
      this.cactus(x + 0.43, z - 0.2, 0.57, -1, true);
    } else if (mark.kind === "boulder") {
      this.shadow(x, z, 2.3, 1.19, 0.55);
      this.rock(x, z, 1.18);
    } else if (mark.kind === "ridge") {
      this.shadow(x, z, 2.25, 1.0, 0.5);
      this.box(x, 0.25, z, 1.98, 0.5, 0.61, "#73766a");
      this.box(x, 0.60, z + 0.02, 1.57, 0.32, 0.54, "#85887b");
      this.box(x - 0.19, 0.81, z - 0.01, 0.97, 0.18, 0.41, "#94978a");
    } else {
      const y = 1.63 + Math.sin(time * 5) * 0.14;
      const flap = Math.sin(time * 11 + mark.d) * 0.17;
      this.shadow(x, z, 2.28, 1.24, 0.36);
      this.box(x, y, z, 0.37, 0.37, 0.88, "#40443e");
      this.box(x, y + 0.16, z + 0.53, 0.29, 0.28, 0.39, "#3c4039");
      this.box(x, y + 0.095, z + 0.83, 0.17, 0.14, 0.28, "#676a60");
      this.box(x, y + 0.11, z + 0.65, 0.307, 0.064, 0.05, "#e7e8de");
      for (const side of [-1, 1]) {
        this.box(x + side * 0.48, y + flap * 0.4, z + 0.13, 0.67, 0.134, 0.73, "#64695f");
        this.box(x + side * 0.92, y + flap, z - 0.03, 0.39, 0.11, 0.55, "#585c52");
        this.box(x + side * 1.14, y + flap * 1.28, z - 0.15, 0.2, 0.086, 0.3, "#73776d");
      }
    }
  }

  menu(time, skin, closet = false) {
    const aspect = this.resize();
    this.count = 0;
    const eye = [9.5, 6.8, 13.7];
    const species = skinInfo(unpackLook(skin).skin).species;
    const lowProfile = species === "horn" || species === "stego" || species === "club";
    const target = closet ? [0, lowProfile ? 0.94 : 1.23, -0.1] : [0, 0.85, 0];
    const height = closet ? 4.15 : Math.max(6.7, 13.2 / aspect);
    const matrix = mul(ortho(aspect, height), lookAt(eye, target));
    if (closet) {
      this.box(0, -0.11, 0.04, 4.03, 0.22, 3.81, "#c9cac1");
      this.shadow(0, 0.26, 2.18, 2.94, 0.67);
      this.dino(0, 0.02, 0, -1.44 + Math.sin(time * 0.85) * 0.2, 1.05, time * 2.8, skin, { idle: true });
    } else {
      this.box(0, -0.43, 0, 9.7, 0.24, 6.15, "#c2c2b9");
      this.box(0, -0.22, 0, 10.36, 0.38, 6.75, "#b7b9ae");
      this.box(0, -0.022, 0, 10.45, 0.044, 6.83, "#d2d3c9");
      this.box(0.1, 0.004, 0.0, 5.75, 0.009, 6.79, "#d9dacf");
      for (const x of [-1.03, 1.08]) {
        for (let i = 0; i < 5; i++) this.box(x, 0.012, -2.61 + i * 1.34, 0.06, 0.01, 0.7, "#b1b3a7");
      }
      for (let i = 0; i < 49; i++) {
        const x = (hash(7, i) - 0.5) * 9.9;
        const z = (hash(9, i) - 0.5) * 6.5;
        if (Math.abs(x) < 2.2 && i % 4 !== 0) continue;
        const size = 0.045 + hash(22, i) * 0.13;
        this.box(x, 0.012, z, size * 1.75, 0.018, size, i % 2 ? "#aeb0a4" : "#c3c5b9");
      }
      this.shadow(0.33, 0.36, 3.33, 3.19, 0.74);
      this.shadow(-3.17, 0.44, 1.8, 0.92, 0.63);
      this.shadow(3.35, -1.86, 1.48, 0.89, 0.62);
      this.cactus(-3.59, 0.6, 1.12, -1);
      this.cactus(-4.12, 0.26, 0.57, 1, true);
      this.cactus(3.9, -2.19, 0.97, 1);
      this.cactus(4.34, -1.58, 0.61, -1, true);
      this.rock(3.33, 1.93, 0.54, true);
      this.rock(-2.85, -1.68, 0.51, true);
      this.rock(-4.46, 2.16, 0.38, true);
      this.fossil(2.53, 0.82 + Math.sin(time * 2.1) * 0.08, -0.18, -time * 1.0, 0.92);
      this.dino(0.18, 0.025, 0.11, -1.79, 1.39, time * 2.6, skin, { idle: true });
      this.cloud(-3.55, 2.91, -3.9, 0.66);
      this.cloud(4.3, 3.55, -3.61, 0.52, "#c4c5bb");
    }
    this.draw(matrix, 0);
  }

  drawRunner(run, skin, water = false) {
    const death = run.death;
    if (!death) {
      if (!water) this.shadow(run.x, 0.25, 1.43 - run.y * 0.13, 1.93, 0.66 - run.y * 0.16);
      const swinging = run.ride?.kind === "river";
      const pitch = swinging ? (run.distance - run.ride.d - 8) * 0.036 : 0;
      this.dino(run.x, run.y, 0, (LANES[run.lane] - run.x) * -0.16, 0.86, run.phase, skin, {
        slide: run.slide, flash: run.flash, grounded: run.y < 0.16, pitch, idle: swinging || run.ride?.kind === "rail",
      });
      return;
    }

    const progress = clamp(death.age / death.duration, 0, 1);
    const fall = Math.min(1, progress * 1.5);
    const impulse = Math.sin(Math.PI * fall);
    const side = death.side;
    let x = run.x, y = run.y * (1 - fall), z = 0, yaw = 0, pitch = 0, roll = 0, flatten = 1;
    switch (death.style) {
      case "fall":
        y -= Math.min(2.1, progress * progress * 7.4);
        z = -progress * 0.95;
        pitch = fall * 0.88;
        roll = side * fall * 0.29;
        break;
      case "charge":
        z = fall * 4.45;
        y += impulse * 1.68 + fall * 0.41;
        pitch = -fall * 1.19;
        roll = side * fall * 0.74;
        break;
      case "sweep":
        x += side * fall * 1.54;
        y += impulse * 0.92 + fall * 0.36;
        z = progress * 1.34;
        roll = side * fall * 1.57;
        yaw = side * fall * 0.60;
        break;
      case "air":
        x += side * fall * 0.97;
        y += impulse * 1.05 + fall * 0.25;
        z = progress * 1.8;
        roll = -side * fall * 1.55;
        yaw = -side * fall * 0.48;
        break;
      case "meteor":
        y = Math.max(0, run.y * (1 - fall * 4));
        flatten = Math.max(0.24, 1 - progress * 3.2);
        roll = side * impulse * 0.37;
        break;
      case "overhead":
        y += fall * 0.27;
        z = fall * 1.92;
        pitch = -fall * 1.27;
        yaw = side * fall * 0.31;
        flatten = 1 - fall * 0.22;
        break;
      case "crash":
        x += side * fall * 0.62;
        z = fall * 2.28;
        y += impulse * 0.42 + fall * 0.35;
        pitch = -fall * 0.52;
        roll = side * fall * 1.14;
        break;
      default:
        y += impulse * 0.58 + fall * 0.27;
        z = -fall * 1.35;
        pitch = fall * 1.48;
        yaw = side * fall * 0.36;
    }
    if (y >= -0.15 && !water) this.shadow(x, z, 1.6, 1.93, 0.60);
    this.dino(x, y, z, yaw, 0.86, run.phase, skin, { idle: true, grounded: false, pitch, roll, flatten });
    const dust = clamp(death.age * 2.1, 0, 1);
    for (let i = 0; dust < 1 && i < 9; i++) {
      const angle = i * Math.PI * 2 / 9;
      const spread = (death.style === "meteor" ? 4.2 : 2.3) * dust + 0.22;
      const height = Math.sin(dust * Math.PI) * (0.4 + i % 3 * 0.36);
      const size = (1 - dust) * (0.13 + i % 3 * 0.07);
      this.box(run.x + Math.cos(angle) * spread, 0.15 + height, Math.sin(angle) * spread + 0.21,
        size, size, size, i % 2 ? "#a4a18c" : "#e0dcc7");
    }
  }

  race(run, time, skin, rivals = [], particles = []) {
    const aspect = this.resize();
    this.count = 0;
    const cameraShift = run.x * 0.16;
    const zoomOut = Math.max(0, 1.16 / aspect - 1);
    const eye = [cameraShift, 4.5 + 1.75 * zoomOut, 7.3 + 8.0 * zoomOut];
    const target = [cameraShift * 0.82, 1.08, -11.8];
    const matrix = mul(perspective(aspect), lookAt(eye, target));
    const distance = run.distance;
    const length = biomeLength(run.rules, run.mode);
    const mapAt = spot => run.rules >= 3 ? biomeAt(run.seed, spot, run.rules, run.mode) : BIOMES[0];
    const first = Math.floor(distance / 7);
    const roof = Math.max(8.1, eye[1] + 1.27);
    const sites = run.mode === "solo" ? arenaSites(run.arenaRoute) : [];
    const groups = run.boss ? [] : runGroups(run, 105, 20);
    const modern = run.rules >= 5;
    const featured = run.rules >= SECTION_RULES;
    const sections = featured && !run.boss ? sectionsNear(run.seed, distance, 122, 30, run.mode)
      .filter(section => section.start >= run.bossExit) : [];
    const activeRoute = run.boss ? battleRoute(run.boss) : null;
    const ahead = groups.flatMap(group => group.obstacles);
    if (activeRoute) ahead.push(...activeRoute.obstacles.map(mark => ({ ...mark, d: distance + mark.d - activeRoute.distance })));
    const cuts = modern ? ahead.flatMap(mark => {
      if (mark.kind === "vine") return [{ lane: mark.lane, start: mark.d + VINE_GAP_START, end: mark.d + VINE_GAP_END }];
      const size = mark.kind === "rift" ? 2.55 : mark.kind === "washout" ? 1.5 : 0;
      return size ? [{ lane: mark.lane, start: mark.d - size, end: mark.d + size }] : [];
    }) : [];
    const boundary = Math.floor(distance / length) * length;
    const nearest = distance - boundary < length / 2 ? boundary : boundary + length;
    const blend = clamp((distance - nearest + 12) / 24, 0, 1);
    const oldMap = mapAt(nearest - 1);
    const newMap = mapAt(nearest);
    const tunnelHaze = newMap.id === "cave" && oldMap.id !== "cave" ? clamp((distance - nearest + 83) / 82, 0, 1) : blend;
    const fog = oldMap.fog.map((value, i) => tune(value, newMap.fog[i], tunnelHaze));
    const ground = rgb(oldMap.ground).map((value, i) => tune(value, rgb(newMap.ground)[i], blend));
    const rowsAhead = this.touch ? 15 : 18;
    const horizon = (first + rowsAhead) * 7 - 3.5;
    if (mapAt(horizon).id === "cave") {
      this.box(0, roof * 0.52, distance - horizon - 1, 22.0, roof * 1.08, 2.4, "#495b51");
    }
    const behind = Math.ceil((eye[2] + 6) / 7);
    for (let i = first - behind; i < first + rowsAhead; i++) {
      const spot = i * 7;
      const z = distance - spot;
      const local = mapAt(spot);
      const detailed = z > -57;
      const edge = spot - 3.5;
      const arena = sites.some(site => spot >= site - ARENA_LEAD && spot <= site + ARENA_EXIT)
        || !!run.boss?.pace && spot >= distance - run.boss.travel - ARENA_LEAD
        || !!run.bossExit && spot <= run.bossExit && spot >= run.bossExit - 170;
      const section = sections.find(item => item.start < edge + 7 && item.end > edge);
      const rowCuts = cuts.filter(cut => cut.end > edge && cut.start < edge + 7);
      const onRails = local.id === "cave" && !arena && !featured;
      if (section) {
        const start = Math.max(section.start, edge);
        const end = Math.min(section.end, edge + 7);
        if (section.kind === "river") this.riverSurface(start, end, distance, time, i);
        else this.sectionRails(section, start, end, distance, detailed);
        for (const [a, b] of [[edge, start], [end, edge + 7]]) {
          if (b - a < 0.01) continue;
          const middle = distance - (a + b) / 2;
          this.box(0, -0.20, middle, 126, 0.32, b - a, ground);
          this.box(0, -0.041, middle, 9.42, 0.083, b - a, local.road);
        }
      } else if (rowCuts.length) {
        for (const side of [-1, 1]) this.box(side * 33.75, -0.20, z, 58.5, 0.32, 7.01, ground);
        for (const [lane, x] of LANES.entries()) {
          const hole = rowCuts.find(cut => cut.lane === lane);
          const stretches = hole ? [[edge, Math.min(edge + 7, hole.start)], [Math.max(edge, hole.end), edge + 7]] : [[edge, edge + 7]];
          for (const [start, end] of stretches) {
            if (end - start < 0.03) continue;
            const middle = distance - (start + end) / 2;
            this.box(x, -0.041, middle, lane === 1 ? 3.002 : 3.005, 0.083, end - start, local.road);
            if (onRails) this.rails(x, middle, end - start, detailed);
          }
        }
        for (const side of [-1, 1]) this.box(side * 4.595, -0.04, z, 0.19, 0.08, 7, local.road);
      } else {
        this.box(0, -0.20, z, 126, 0.32, 7.01, ground);
        this.box(0, -0.041, z, 9.42, 0.083, 7, local.road);
        if (onRails) for (const lane of LANES) this.rails(lane, z, 6.98, detailed);
      }
      if (!section) {
        for (const x of [-4.67, 4.67]) this.box(x, 0.012, z, 0.18, 0.025, 6.99, local.shoulder);
        if (!arena) for (const x of [-1.5, 1.5]) this.box(x, 0.014, z, 0.055, 0.023, 2.44, local.line);
      }
      if (local.id === "cave") {
        const onMouth = !(run.mode === "race" && modern) && spot % length < 11;
        if (!onMouth) this.box(0, roof + 0.75, z, 20, 1.8, 7.02, i % 2 ? "#535e5a" : "#59645f");
        if (!onMouth && i % 3 === 0) {
          const ridge = (hash(run.seed ^ 0xa67d, i) - 0.5) * 7.6;
          this.box(ridge, roof - 0.31, z, 1.82, 0.79, 2.75, "#65716b");
          this.box(ridge + 0.22, roof - 0.79, z + 0.27, 1.03, 0.46, 1.65, "#6f7971");
        }
      }
      if (section?.kind !== "river") trackside(this, local, z, i, run.seed, arena, detailed, roof);
    }

    for (const edge of [boundary, boundary + length]) {
      const z = distance - edge;
      if (edge > 0 && !(modern && run.mode === "race") && z > -125 && z < eye[2] + 15 && mapAt(edge).id === "cave") mountainPortal(this, z, roof, run.seed ^ edge);
    }
    const far = Math.floor(distance / 29);
    for (let i = far; i < far + 5; i++) {
      if (mapAt(i * 29 + 14).id !== "wild") continue;
      const z = distance - i * 29 - 14;
      const offset = hash(run.seed, i * 21) * 18;
      this.mesa(-21 - offset, z, 2.1, "#b2b4ab");
      this.mesa(20 + offset * 0.8, z - 9, 1.8, "#b7b9ae");
      this.cloud((i % 2 ? -1 : 1) * (7 + offset), 8 + offset * 0.1, z, 2.0);
    }

    const gates = featured ? [...sites.map(site => site - ARENA_LEAD), run.bossExit].filter(Boolean)
      : sites.flatMap(site => [site - ARENA_LEAD, site + ARENA_EXIT]);
    for (const edge of gates) {
      const z = distance - edge;
      if (z < 18 && z > -105) arenaEntrance(this, z, mapAt(edge));
    }
    if (run.boss) {
      this.battle(run, time, roof, mapAt(distance).id);
    } else {
      const upcoming = sites[run.nextBoss];
      if (upcoming !== undefined && upcoming - distance < 76 && distance <= upcoming) {
        const z = distance - upcoming - ARENA_BOSS_DEPTH;
        this.shadow(0, z, 6.105, 5.365, 0.58);
        this.dino(0, 0, z, Math.PI + 0.06, 1.85, time * 9, BOSSES[run.nextBoss].skin, { grounded: true });
      }
      for (const group of groups) {
        if (group.formation) {
          const z = distance - group.formation.d;
          if (z > -82 && z < 15) courseLandmark(this, group.formation, z, mapAt(group.formation.d));
        }
        for (const mark of group.obstacles) {
          const z = distance - mark.d;
          if (z > 10 || z < -105) continue;
          if (mark.kind === "vine" && run.ride?.d === mark.d) continue;
          const impact = run.death?.kind === mark.kind && Math.abs(z) < 4 && Math.abs(run.x - LANES[mark.lane]) < 1.3;
          this.obstacle(mark, z, time + (impact ? run.death.age : 0), run.hit[mark.id] != null && (!impact || mark.kind === "meteor"),
            roof, modern, impact ? run.death.age : 0, mapAt(mark.d).id);
        }
        for (const pick of group.fossils) {
          const z = distance - pick.d;
          if (z > 5 || z < (modern ? -76 : -104) || run.picked[pick.id] != null) continue;
          const targetX = pick.x ?? LANES[pick.lane];
          const pull = run.powers.magnet ? clamp((z + 10) / 11, 0, 1) : 0;
          const scale = modern ? (pick.chain != null ? 1.05 : 0.81) * clamp((z + 76) / 16, 0, 1) : 0.92;
          this.fossil(tune(targetX, run.x, pull), pick.y + Math.sin(time * 6 + pick.d) * 0.055, z, time * 2.6 + pick.d * 0.58,
            scale);
        }
        for (const pick of group.powers) {
          const z = distance - pick.d;
          if (z > 4 || z < -94 || run.picked[pick.id] != null) continue;
          this.power(LANES[pick.lane], z, pick, time);
        }
      }
    }
    for (const rival of rivals) {
      const z = distance - rival.visualDistance;
      if (z < -100 || z > 6 || Math.abs(z) < 0.8 && Math.abs(rival.visualX - run.x) < 0.77) continue;
      this.shadow(rival.visualX, z, 1.35, 1.48, 0.18);
      this.dino(rival.visualX, rival.visualY, z, 0, 0.82, time * 14, rival.skin, { slide: rival.slide, ghost: true, grounded: rival.visualY < 0.2 });
    }
    for (const section of sections) this.drawSection(section, run, time, roof);
    if (run.ride?.kind === "minecart" || run.ride?.kind === "rail") this.cart(run.x, 0);
    if (run.ride?.kind === "vine") vineTree(this, LANES[run.ride.lane], distance - run.ride.d,
      run.ride.side || Math.sign(run.x) || 1, { z: 0, y: run.y + 1.37 }, modern);
    this.drawRunner(run, skin, sections.some(section => section.kind === "river" && distance >= section.start && distance < section.end));
    if (run.powers.shield) {
      for (let i = 0; i < 6; i++) {
        const a = time * 3 + i * Math.PI / 3;
        this.box(run.x + Math.cos(a) * 0.86, run.y + 0.55 + i % 2 * 0.34, Math.sin(a) * 1.05, 0.14, 0.22, 0.14, "#eeeeda");
      }
    }
    if (run.y < 0.13 && !run.done && !run.death) {
      for (let i = 0; i < 5; i++) {
        const p = (time * 2.16 + i * 0.22) % 1;
        const x = run.x + (i % 2 ? -1 : 1) * (0.22 + p * 0.24);
        const side = run.slide ? 1.45 : 1;
        const size = (1 - p) * 0.1 + 0.028;
        this.box(x, 0.04 + p * 0.36, 0.6 + p * 2.6 * side, size, size, size, "#8f9386");
      }
    }
    for (const part of particles) this.box(part.x, part.y, part.z, part.size, part.size, part.size, part.color);
    this.draw(matrix, 1, fog);
  }

  dispose() {
    this.observer?.disconnect();
    this.gl?.deleteBuffer(this.buffer);
    this.gl?.deleteProgram(this.program);
  }

  draw(matrix, fog, sky = FOG) {
    if (!this.gl) {
      this.drawFallback(matrix, fog, sky);
      return;
    }
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices.subarray(0, this.count), gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(this.locations.aPosition, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(this.locations.aColor, 3, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(this.locations.aPosition);
    gl.enableVertexAttribArray(this.locations.aColor);
    gl.uniformMatrix4fv(this.uniforms.uMatrix, false, matrix);
    gl.uniform1f(this.uniforms.uFog, fog);
    gl.uniform3fv(this.uniforms.uSky, sky);
    gl.drawArrays(gl.TRIANGLES, 0, this.count / 6);
  }

  drawFallback(matrix, fog, sky) {
    if (!this.pixel) return;
    const { width, height } = this.canvas;
    const ctx = this.pixel;
    ctx.clearRect(0, 0, width, height);
    const quads = [];
    for (let i = 0; i < this.count; i += 36) {
      const vertices = [];
      let depth = 0;
      let top = -Infinity;
      let bottom = Infinity;
      let clipped = false;
      for (const corner of [0, 1, 2, 5]) {
        const index = i + corner * 6;
        const a = this.vertices[index], b = this.vertices[index + 1], c = this.vertices[index + 2];
        top = Math.max(top, b);
        bottom = Math.min(bottom, b);
        const w = matrix[3] * a + matrix[7] * b + matrix[11] * c + matrix[15];
        if (w < 0.18) { clipped = true; break; }
        const x = (matrix[0] * a + matrix[4] * b + matrix[8] * c + matrix[12]) / w;
        const y = (matrix[1] * a + matrix[5] * b + matrix[9] * c + matrix[13]) / w;
        depth += (matrix[2] * a + matrix[6] * b + matrix[10] * c + matrix[14]) / w / 4;
        vertices.push([(x + 1) * width / 2, (1 - y) * height / 2, w]);
      }
      if (clipped || vertices.every(v => v[0] < 0) || vertices.every(v => v[0] > width) || vertices.every(v => v[1] < 0) || vertices.every(v => v[1] > height)) continue;
      const [a, b, c] = vertices;
      if ((b[0] - a[0]) * (c[1] - a[1]) >= (b[1] - a[1]) * (c[0] - a[0])) continue;
      if (top < 0.075 && top - bottom < 0.37 && i % 216 !== 144) continue;
      const haze = clamp((vertices[0][2] - 29) / 95, 0, 1) * fog;
      const color = sky.map((shade, j) => Math.round((this.vertices[i + 3 + j] * (1 - haze) + shade * haze) * 255));
      // Paint the shallow ground layers first so broad floor tiles cannot cover feet and rails.
      quads.push({ depth: top < 0.075 ? 2 - top : depth, color, vertices });
    }
    quads.sort((a, b) => b.depth - a.depth);
    for (const item of quads) {
      ctx.fillStyle = `rgb(${item.color.join(",")})`;
      ctx.beginPath();
      for (const [index, vertex] of item.vertices.entries()) {
        if (index === 0) ctx.moveTo(vertex[0], vertex[1]);
        else ctx.lineTo(vertex[0], vertex[1]);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}
