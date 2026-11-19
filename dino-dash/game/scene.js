import { groupsNear, hash, LANES, SKINS, clamp } from "./runner.js";

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
    this.vertices = new Float32Array(36 * 6 * 680);
    this.gl = canvas.getContext("webgl", { alpha: true, antialias: true, depth: true, powerPreference: "low-power" });
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
    const density = Math.min(1.65, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * density));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * density));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl?.viewport(0, 0, width, height);
    }
    return width / height;
  }

  box(x, y, z, w, h, d, color, actor) {
    const dx = w / 2, dy = h / 2, dz = d / 2;
    const px = [x - dx, x + dx], py = [y - dy, y + dy], pz = [z - dz, z + dz];
    const corners = [
      [px[0], py[0], pz[0]], [px[1], py[0], pz[0]], [px[1], py[1], pz[0]], [px[0], py[1], pz[0]],
      [px[0], py[0], pz[1]], [px[1], py[0], pz[1]], [px[1], py[1], pz[1]], [px[0], py[1], pz[1]],
    ];
    if (actor) {
      for (const point of corners) {
        const xx = point[0] * actor.scale;
        const zz = point[2] * actor.scale;
        point[0] = actor.x + xx * actor.cos + zz * actor.sin;
        point[1] = actor.y + point[1] * actor.scale * actor.flatten;
        point[2] = actor.z + zz * actor.cos - xx * actor.sin;
      }
    }
    if (this.count + 216 > this.vertices.length) {
      const next = new Float32Array(this.vertices.length * 2);
      next.set(this.vertices);
      this.vertices = next;
    }
    const base = rgb(color);
    for (const face of faces) {
      const shade = base.map(component => Math.min(1, component * face[4]));
      for (const corner of triangles) {
        const point = corners[face[corner]];
        this.vertices.set(point, this.count);
        this.vertices.set(shade, this.count + 3);
        this.count += 6;
      }
    }
  }

  shadow(x, z, width, length, opacity = 1, ground = 0.015) {
    const shade = Math.round(213 - opacity * 36);
    const color = [shade / 255, (shade + 1) / 255, (shade - 3) / 255];
    this.box(x, ground, z, width * 0.66, 0.015, length, color);
    this.box(x, ground + 0.001, z, width, 0.015, length * 0.51, color);
  }

  dino(x, y, z, angle, scale, phase, skinId, options = {}) {
    const { slide = 0, flash = 0, ghost = false, grounded = true, idle = false } = options;
    const skin = SKINS.find(s => s.id === skinId) || SKINS[0];
    const bob = idle ? Math.sin(phase) * 0.043 : Math.abs(Math.sin(phase)) * 0.078;
    const actor = { x, y: y + bob, z, cos: Math.cos(angle), sin: Math.sin(angle), scale, flatten: slide ? 0.5 : 1 };
    const box = (left, up, forward, width, height, depth, color) => {
      let tint = color;
      if (ghost) tint = rgb(color).map(v => v * 0.46 + 0.48);
      if (flash && Math.floor(flash * 16) % 2) tint = rgb(tint).map(v => v * 0.42 + 0.38);
      this.box(left, up, forward, width, height, depth, tint, actor);
    };
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
      const eye = skinId === "visor" ? "#c9cac4" : "#eeeee7";
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
    if (skinId === "cap") {
      box(0, 2.48, -0.63, 1.03, 0.23, 0.82, "#151614");
      box(0, 2.41, -1.14, 1.14, 0.105, 0.59, "#141513");
      box(0, 2.61, -0.67, 0.18, 0.065, 0.19, "#85867e");
    } else if (skinId === "scarf") {
      box(0, 1.6, -0.45, 0.98, 0.18, 0.69, "#d5d5ca");
      for (const zz of [-0.66, -0.36, -0.08]) box(0.492, 1.61, zz, 0.055, 0.09, 0.12, "#767971");
      box(0.52, 1.46, 0.06, 0.11, 0.33, 0.27, "#b3b4a9");
    } else if (skinId === "pale") {
      for (const [yy, zz] of [[1.03, 0.27], [1.22, 0.08], [0.88, -0.13]]) box(0.526, yy, zz, 0.028, 0.125, 0.14, "#85877e");
    } else if (skinId === "visor") {
      box(0, 2.17, -0.87, 1.29, 0.22, 0.32, "#100f10");
      box(0.66, 2.2, -0.88, 0.035, 0.12, 0.19, "#c0c2bd");
      box(-0.66, 2.2, -0.88, 0.035, 0.12, 0.19, "#c0c2bd");
    } else if (skinId === "crown") {
      box(0, 2.45, -0.62, 1.02, 0.16, 0.69, "#b3b4ab");
      for (const xx of [-0.39, 0, 0.39]) box(xx, 2.59, -0.86, 0.2, 0.24, 0.18, "#d4d5ca");
      box(0, 2.69, -0.86, 0.115, 0.12, 0.12, "#d4d5ca");
    }
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
    const block = (left, up, w, h, color) => this.box(left, up, 0, w, h, 0.12, color, actor);
    block(0, 0, 0.42, 0.65, "#55584f");
    block(0, 0, 0.63, 0.43, "#55584f");
    block(0, 0, 0.42, 0.43, "#e4e5da");
    block(0, 0.12, 0.27, 0.09, "#74786d");
    block(0.1, 0, 0.077, 0.21, "#74786d");
    block(0.03, -0.1, 0.17, 0.08, "#74786d");
    block(-0.05, -0.037, 0.08, 0.08, "#74786d");
  }

  obstacle(mark, z, time, hit) {
    const x = LANES[mark.lane];
    if (hit) return;
    if (mark.kind === "cactus") {
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
    const target = closet ? [0, 1.33, -0.1] : [0, 0.85, 0];
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

  race(run, time, skin, rivals = [], particles = []) {
    const aspect = this.resize();
    this.count = 0;
    const cameraShift = run.x * 0.16;
    const zoomOut = Math.max(0, 1.2 / aspect - 1);
    const eye = [cameraShift, 4.35 + 1.45 * zoomOut, 7.3 + 5.4 * zoomOut];
    const target = [cameraShift * 0.82, 1.08, -11.8];
    const matrix = mul(perspective(aspect), lookAt(eye, target));
    this.box(0, -0.20, -54, 126, 0.32, 164, "#d7d8cf");
    this.box(0, -0.066, -57, 9.4, 0.13, 160, "#bec0b5");
    for (const [i, xx] of LANES.entries()) {
      this.box(xx, -0.03, -57, 2.94, 0.065, 160, i === 1 ? "#d1d2c8" : "#cfd0c5");
    }
    const distance = run.distance;
    const first = Math.floor(distance / 7);
    for (let i = first - 2; i < first + 18; i++) {
      const z = distance - i * 7;
      for (const x of [-4.67, 4.67]) {
        this.box(x, 0.008, z, 0.18, 0.022, 6.93, (i % 2) ? "#a6a99d" : "#b9bbaf");
      }
      for (const x of [-1.5, 1.5]) this.box(x, 0.012, z, 0.055, 0.025, 2.44, "#b1b4a7");
      for (const side of [-1, 1]) {
        const x = side * (5.62 + hash(run.seed + side, i) * 7);
        const r = hash(run.seed ^ 17, i * side);
        if (r < 0.34) this.cactus(x, z - 2.3, 0.47 + r * 2.54, side, true);
        else if (r > 0.47) this.rock(x, z - 0.27, 0.27 + r * 0.5, true);
        for (let j = 0; j < 3; j++) {
          const salt = i * 13 + j * side;
          const fx = side * (5.13 + hash(run.seed ^ 123, salt) * 17);
          this.box(fx, -0.03, z + j * 2, 0.08 + r * 0.18, 0.022, 0.08 + r * 0.09, "#aeb1a5");
        }
      }
    }

    const far = Math.floor(distance / 29);
    for (let i = far; i < far + 5; i++) {
      const z = distance - i * 29 - 14;
      const offset = hash(run.seed, i * 21) * 18;
      this.mesa(-21 - offset, z, 2.1, "#b2b4ab");
      this.mesa(20 + offset * 0.8, z - 9, 1.8, "#b7b9ae");
      if (z < -32) this.cloud((i % 2 ? -1 : 1) * (7 + offset), 8 + offset * 0.1, z, 2.0);
    }

    for (const group of groupsNear(run.seed, distance)) {
      for (const mark of group.obstacles) {
        const z = distance - mark.d;
        if (z > 5 || z < -115) continue;
        this.obstacle(mark, z, time, run.hit[mark.id] != null);
      }
      for (const pick of group.fossils) {
        const z = distance - pick.d;
        if (z > 5 || z < -113 || run.picked[pick.id] != null) continue;
        this.fossil(LANES[pick.lane], pick.y + Math.sin(time * 6 + pick.d) * 0.085, z, time * 2.6 + pick.d * 0.58, 0.92);
      }
    }
    for (const rival of rivals) {
      const z = distance - rival.visualDistance;
      if (z < -100 || z > 6 || Math.abs(z) < 0.8 && Math.abs(rival.visualX - run.x) < 0.77) continue;
      this.shadow(rival.visualX, z, 1.35, 1.48, 0.18);
      this.dino(rival.visualX, rival.visualY, z, 0, 0.82, time * 14, rival.skin, { slide: rival.slide, ghost: true, grounded: rival.visualY < 0.2 });
    }
    this.shadow(run.x, 0.25, 1.43 - run.y * 0.13, 1.93, 0.66 - run.y * 0.16);
    this.dino(run.x, run.y, 0, (LANES[run.lane] - run.x) * -0.16, 0.86, run.phase, skin, { slide: run.slide, flash: run.flash, grounded: run.y < 0.16 });
    if (run.y < 0.13 && !run.done) {
      for (let i = 0; i < 5; i++) {
        const p = (time * 2.16 + i * 0.22) % 1;
        const x = run.x + (i % 2 ? -1 : 1) * (0.22 + p * 0.24);
        const side = run.slide ? 1.45 : 1;
        const size = (1 - p) * 0.1 + 0.028;
        this.box(x, 0.04 + p * 0.36, 0.6 + p * 2.6 * side, size, size, size, "#8f9386");
      }
    }
    for (const part of particles) this.box(part.x, part.y, part.z, part.size, part.size, part.size, part.color);
    this.draw(matrix, 1);
  }

  draw(matrix, fog) {
    if (!this.gl) {
      this.drawFallback(matrix, fog);
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
    gl.uniform3fv(this.uniforms.uSky, FOG);
    gl.drawArrays(gl.TRIANGLES, 0, this.count / 6);
  }

  drawFallback(matrix, fog) {
    if (!this.pixel) return;
    const { width, height } = this.canvas;
    const ctx = this.pixel;
    ctx.clearRect(0, 0, width, height);
    const quads = [];
    for (let i = 0; i < this.count; i += 36) {
      const vertices = [];
      let depth = 0;
      let clipped = false;
      for (const corner of [0, 1, 2, 5]) {
        const index = i + corner * 6;
        const a = this.vertices[index], b = this.vertices[index + 1], c = this.vertices[index + 2];
        const w = matrix[3] * a + matrix[7] * b + matrix[11] * c + matrix[15];
        if (w < 0.18) { clipped = true; break; }
        const x = (matrix[0] * a + matrix[4] * b + matrix[8] * c + matrix[12]) / w;
        const y = (matrix[1] * a + matrix[5] * b + matrix[9] * c + matrix[13]) / w;
        depth += (matrix[2] * a + matrix[6] * b + matrix[10] * c + matrix[14]) / w / 4;
        vertices.push([(x + 1) * width / 2, (1 - y) * height / 2, w]);
      }
      if (clipped || vertices.every(v => v[0] < 0) || vertices.every(v => v[0] > width) || vertices.every(v => v[1] < 0) || vertices.every(v => v[1] > height)) continue;
      const haze = clamp((vertices[0][2] - 29) / 95, 0, 1) * fog;
      const color = FOG.map((shade, j) => Math.round((this.vertices[i + 3 + j] * (1 - haze) + shade * haze) * 255));
      quads.push({ depth, color, vertices });
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
