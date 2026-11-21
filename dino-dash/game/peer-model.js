import { clamp, randomSeed, RACE_LIMIT_MS, RACE_METRES, normalizeRaceRules } from "./runner.js?v=4";
import { normalizeLook } from "./catalog.js?v=4";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const LIVE_MS = 26_000;
const HOLD_MS = 120_000;
const LEAD_IN = 4300;
const SPEED = 0.018;
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = () => crypto.randomUUID();
const range = (value, min, max) => Number.isFinite(value) ? clamp(value, min, max) : min;

export class PeerRoomError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class PeerRoom {
  constructor(saved) {
    this.data = saved;
  }

  static create(token, name, skin, now = Date.now(), rules = 1) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), n => ALPHABET[n & 31]).join("");
    const owner = { ...PeerRoom.player(token, name, skin, now) };
    return new PeerRoom({ code, rules: normalizeRaceRules(rules), seed: randomSeed(), host: owner.id, start: 0, round: 0, players: [owner] });
  }

  static player(token, name, skin, now) {
    const tag = typeof name === "string" ? name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 16) : "";
    return {
      id: uuid(), token, name: tag || "小恐龙", skin: normalizeLook(skin), joined: now, seen: now,
      ready: false, seq: 0, distance: 0, x: 0, y: 0, slide: false, done: false, finish: 0,
    };
  }

  get code() { return this.data.code; }
  get ownerToken() { return this.data.players.find(player => player.id === this.data.host)?.token; }

  phase(now) {
    const { start, players } = this.data;
    if (!start) return "lobby";
    if (now < start) return "countdown";
    return now > start + RACE_LIMIT_MS || players.every(player => player.done) ? "results" : "race";
  }

  snapshot(me, now) {
    const { code, host, seed, start, round, rules = 1, players } = this.data;
    return {
      room: { code, host, seed, start, round, rules, self: me.id, now, phase: this.phase(now),
        target: RACE_METRES, deadline: start ? start + RACE_LIMIT_MS : 0,
        players: players.map(({ token: _token, ...player }) => ({
          ...player, online: player.seen > now - LIVE_MS,
        })),
      },
    };
  }

  updateRace(player, sample, now) {
    const { start, round } = this.data;
    if (!sample || sample.round !== round || !Number.isSafeInteger(sample.seq) || sample.seq <= player.seq || player.done) return;
    const plausible = (Math.min(RACE_LIMIT_MS, now - start) + 250) * SPEED;
    const distance = range(sample.distance, 0, RACE_METRES);
    player.seq = sample.seq;
    player.distance = Math.max(player.distance, Math.min(distance, plausible));
    player.x = range(sample.x, -3, 3);
    player.y = range(sample.y, 0, 3.5);
    player.slide = sample.slide === true;
    if (distance >= RACE_METRES && plausible >= RACE_METRES) {
      const earliest = Math.ceil(RACE_METRES / SPEED - 250);
      const end = Number.isSafeInteger(sample.finishAt) ? Math.min(now, sample.finishAt) : now;
      player.finish = clamp(end - start, earliest, RACE_LIMIT_MS);
      player.done = true;
    }
  }

  handle(payload, now = Date.now()) {
    if (!payload || typeof payload.token !== "string" || !tokenPattern.test(payload.token) || payload.code !== this.code) {
      throw new PeerRoomError(400, "无效的房间请求。");
    }
    const room = this.data;
    const phase = this.phase(now);
    const isLobby = phase === "lobby";
    let player = room.players.find(item => item.token === payload.token);
    if (!player && payload.action === "join") {
      if ((room.rules || 1) > normalizeRaceRules(payload.rules)) {
        throw new PeerRoomError(409, "房间已启用新版赛道，请刷新游戏后加入。");
      }
      if (!isLobby) throw new PeerRoomError(409, "这一轮已经开始，请等房主回到大厅。");
      room.players = room.players.filter(item => item.id === room.host || item.seen > now - HOLD_MS);
      if (room.players.length >= 4) throw new PeerRoomError(409, "房间已满，最多 4 人。");
      player = PeerRoom.player(payload.token, payload.name, payload.skin, now);
      room.players.push(player);
    }
    if (!player) throw new PeerRoomError(404, "房间席位已失效，请重新加入。");
    player.seen = now;
    const isHost = player.id === room.host;
    const online = () => room.players.filter(item => item.seen > now - LIVE_MS);
    switch (payload.action) {
      case "join": break;
      case "sync":
        if (phase === "race" || phase === "results") this.updateRace(player, payload.sample, now);
        break;
      case "ready":
        if (isLobby) player.ready = payload.ready === true;
        break;
      case "start":
        if (!isHost) throw new PeerRoomError(403, "房主可以开始竞速。");
        if (isLobby) {
          const riders = online();
          if (riders.length < 2 || riders.some(item => !item.ready)) throw new PeerRoomError(409, "至少 2 位在线玩家且全员准备后才能开始。");
          room.players = riders;
          room.start = now + LEAD_IN;
          room.round++;
        }
        break;
      case "reset":
        if (isHost && phase === "results") {
          room.seed = randomSeed();
          room.start = 0;
          room.players = room.players.filter(item => item.id === room.host || item.seen > now - HOLD_MS).map(item => ({
            ...item, ready: false, seq: 0, distance: 0, x: 0, y: 0, slide: false, finish: 0, done: false,
          }));
        }
        break;
      case "leave":
        if (isHost) return { left: true, close: true };
        if (isLobby) room.players = room.players.filter(item => item !== player);
        else Object.assign(player, { done: true, seen: 0 });
        return { left: true };
      default: throw new PeerRoomError(400, "未知的房间操作。");
    }
    return this.snapshot(player, now);
  }
}
