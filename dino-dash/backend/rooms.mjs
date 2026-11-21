import { RACE_LIMIT_MS, RACE_METRES, normalizeRaceRules, clamp, randomSeed } from "../game/runner.js";
import { normalizeLook } from "../game/catalog.js";

const CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_FORMAT = /^[2-9A-HJ-NP-Z]{6}$/;
const TOKEN_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE_MS = 26_000;
const HOLD_MS = 120_000;
const COUNTDOWN_MS = 4_300;
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_RACE_METRES_PER_MS = 0.018;
const FINISH_LEEWAY_MS = 250;
const EARLIEST_FINISH_MS = Math.ceil(RACE_METRES / MAX_RACE_METRES_PER_MS - FINISH_LEEWAY_MS);

const query = (db, sql, ...params) => db.prepare(sql).bind(...params);
const fail = (status, error) => ({ status, data: { error } });
const integer = (value, min, max) => Number.isSafeInteger(value) ? clamp(value, min, max) : min;
const number = (value, min, max) => Number.isFinite(value) ? clamp(value, min, max) : min;

function roomCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => CODE_CHARS[n & 31]).join("");
}

async function secretOf(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, "0")).join("");
}

function playerInfo(data) {
  const name = typeof data.name === "string" ? Array.from(data.name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim()).slice(0, 16).join("") : "";
  return [name || "小恐龙", normalizeLook(data.skin)];
}

function hasFinished(room, players, now) {
  return now > room.start + RACE_LIMIT_MS || players.length > 0 && players.every(player => player.done);
}

async function snapshot(db, code, secret, now, writes = []) {
  const out = await db.batch([
    ...writes,
    query(db, `SELECT r.code, r.seed, r.host, r.start, r.round, r.rules, me.id AS self
      FROM race_rooms r JOIN race_players me ON me.code = r.code
      WHERE r.code = ? AND me.secret = ?`, code, secret),
    query(db, `SELECT p.id, p.name, p.skin, p.joined, p.seen, p.ready, p.seq, p.distance, p.x, p.y, p.slide, p.done, p.finish
      FROM race_players p JOIN race_rooms r ON r.code = p.code
      WHERE p.code = ?
        AND ((r.start = 0 AND p.seen > ?) OR (r.start > 0 AND p.round = r.round))
      ORDER BY p.joined ASC, p.id ASC`, code, now - HOLD_MS),
  ]);
  const room = out.at(-2).results[0];
  if (!room) return fail(404, "房间或席位已失效。请重新加入。");
  const players = out.at(-1).results.map(player => ({
    ...player,
    online: player.seen > now - LIVE_MS,
    ready: !!player.ready,
    slide: !!player.slide,
    done: !!player.done,
  }));
  const eligible = players.some(player => player.id === room.self);
  if (!eligible) return fail(409, "这一轮已经开始，请等下一场。");
  let phase = "lobby";
  if (room.start) phase = now < room.start ? "countdown" : hasFinished(room, players, now) ? "results" : "race";
  return {
    status: 200,
    data: {
      room: {
        ...room, phase, players, now, target: RACE_METRES, deadline: room.start ? room.start + RACE_LIMIT_MS : 0,
      },
    },
    changes: out[0]?.meta?.changes ?? 0,
  };
}

function election(db, code, now) {
  return query(db, `UPDATE race_rooms
    SET host = (
      SELECT id FROM race_players WHERE code = ? AND seen > ?
        AND (race_rooms.start = 0 OR round = race_rooms.round)
      ORDER BY joined, id LIMIT 1
    )
    WHERE code = ?
      AND (start = 0 OR start + ? < ? OR NOT EXISTS (
        SELECT 1 FROM race_players WHERE code = ? AND round = race_rooms.round AND done = 0
      ))
      AND NOT EXISTS (SELECT 1 FROM race_players WHERE code = ? AND id = race_rooms.host AND seen > ?)
      AND EXISTS (
        SELECT 1 FROM race_players WHERE code = ? AND seen > ?
          AND (race_rooms.start = 0 OR round = race_rooms.round)
      )`, code, now - LIVE_MS, code, RACE_LIMIT_MS, now, code, code, now - LIVE_MS, code, now - LIVE_MS);
}

async function create(db, secret, info, now, rules) {
  const existing = await query(db, "SELECT code FROM race_players WHERE secret = ?", secret).first();
  if (existing) return snapshot(db, existing.code, secret, now, [
    query(db, "UPDATE race_players SET seen = ? WHERE secret = ?", now, secret),
  ]);
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = roomCode();
    const id = crypto.randomUUID();
    const result = await snapshot(db, code, secret, now, [
      query(db, "DELETE FROM race_rooms WHERE created < ?", now - ROOM_TTL_MS),
      query(db, `INSERT OR IGNORE INTO race_rooms (code, seed, host, created, rules)
        SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM race_players WHERE secret = ?)`, code, randomSeed(), id, now, rules, secret),
      query(db, `INSERT OR IGNORE INTO race_players (code, id, secret, name, skin, joined, seen)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM race_rooms WHERE code = ? AND host = ?)`,
      code, id, secret, ...info, now, now, code, id),
    ]);
    if (result.status === 200) return result;
    const retry = await query(db, "SELECT code FROM race_players WHERE secret = ?", secret).first();
    if (retry) return snapshot(db, retry.code, secret, now);
  }
  return fail(503, "暂时无法创建房间，请再试一次。");
}

async function join(db, code, secret, info, now, rules) {
  const [name, skin] = info;
  const result = await snapshot(db, code, secret, now, [
    query(db, `DELETE FROM race_players WHERE code = ? AND seen < ? AND secret <> ?
      AND EXISTS (SELECT 1 FROM race_rooms WHERE code = ? AND start = 0)`, code, now - HOLD_MS, secret, code),
    query(db, `UPDATE race_players SET seen = ?, name = ?, skin = ?
      WHERE code = ? AND secret = ? AND EXISTS (SELECT 1 FROM race_rooms WHERE code = ? AND start = 0)`,
    now, name, skin, code, secret, code),
    query(db, `INSERT OR IGNORE INTO race_players (code, id, secret, name, skin, joined, seen)
      SELECT ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM race_rooms WHERE code = ? AND start = 0 AND created >= ? AND rules <= ?)
        AND (SELECT count(*) FROM race_players WHERE code = ?) < 4`,
    code, crypto.randomUUID(), secret, name, skin, now, now, code, now - ROOM_TTL_MS, rules, code),
    election(db, code, now),
  ]);
  if (result.status !== 404) return result;
  const room = await query(db, "SELECT start, created, rules FROM race_rooms WHERE code = ?", code).first();
  if (!room || room.created < now - ROOM_TTL_MS) return fail(404, "找不到这个房间，请核对房间码。");
  if (room.rules > rules) return fail(409, "房间已启用新版赛道，请刷新游戏后加入。");
  if (room.start) return fail(409, "这一轮已经开始。房主回到大厅后即可加入。");
  return fail(409, "房间已满，最多 4 人。");
}

async function sync(db, code, secret, sample, now) {
  const writes = [query(db, "UPDATE race_players SET seen = ? WHERE code = ? AND secret = ?", now, code, secret)];
  if (sample && typeof sample === "object") {
    const seq = integer(sample.seq, 0, Number.MAX_SAFE_INTEGER);
    const round = integer(sample.round, 0, 100_000);
    const distance = number(sample.distance, 0, RACE_METRES);
    const x = number(sample.x, -3, 3);
    const y = number(sample.y, 0, 3.5);
    const slide = sample.slide === true ? 1 : 0;
    const finishAt = integer(sample.finishAt, 0, now) || now;
    if (seq && round) {
      const maxDistance = `max(0, (min(?, start + ?) - start + ${FINISH_LEEWAY_MS}) * ${MAX_RACE_METRES_PER_MS})`;
      writes.push(query(db, `UPDATE race_players SET
        seq = ?, distance = max(distance, min(?, (SELECT ${maxDistance} FROM race_rooms WHERE code = ?))),
        x = ?, y = ?, slide = ?,
        done = CASE WHEN ? >= ? AND (SELECT ${maxDistance} FROM race_rooms WHERE code = ?) >= ? THEN 1 ELSE done END,
        finish = CASE WHEN ? >= ? AND (SELECT ${maxDistance} FROM race_rooms WHERE code = ?) >= ?
          THEN (SELECT max(${EARLIEST_FINISH_MS}, min(? - start, ?)) FROM race_rooms WHERE code = ?) ELSE finish END
        WHERE code = ? AND secret = ? AND round = ? AND seq < ? AND done = 0
          AND EXISTS (SELECT 1 FROM race_rooms WHERE code = ? AND round = ? AND start > 0 AND start <= ?)`,
      seq, distance, now, RACE_LIMIT_MS, code, x, y, slide,
      distance, RACE_METRES, now, RACE_LIMIT_MS, code, RACE_METRES,
      distance, RACE_METRES, now, RACE_LIMIT_MS, code, RACE_METRES, finishAt, RACE_LIMIT_MS, code,
      code, secret, round, seq, code, round, now));
    }
  }
  writes.push(election(db, code, now));
  return snapshot(db, code, secret, now, writes);
}

export async function roomAction(db, body, now = Date.now()) {
  if (!body || typeof body !== "object" || typeof body.token !== "string" || !TOKEN_FORMAT.test(body.token)) {
    return fail(400, "无效的玩家会话。");
  }
  const secret = await secretOf(body.token);
  const rules = normalizeRaceRules(body.rules);
  if (body.action === "create") return create(db, secret, playerInfo(body), now, rules);
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  if (!CODE_FORMAT.test(code)) return fail(400, "请输入 6 位有效房间码。");

  switch (body.action) {
    case "join":
      return join(db, code, secret, playerInfo(body), now, rules);
    case "sync":
      return sync(db, code, secret, body.sample, now);
    case "ready":
      return snapshot(db, code, secret, now, [
        query(db, `UPDATE race_players SET ready = ?, seen = ? WHERE code = ? AND secret = ?
          AND EXISTS (SELECT 1 FROM race_rooms WHERE code = ? AND start = 0)`, body.ready === true ? 1 : 0, now, code, secret, code),
      ]);
    case "start": {
      const start = now + COUNTDOWN_MS;
      const result = await snapshot(db, code, secret, now, [
        query(db, `UPDATE race_rooms SET start = ?, round = round + 1
          WHERE code = ? AND start = 0
            AND host = (SELECT id FROM race_players WHERE code = ? AND secret = ?)
            AND (SELECT count(*) FROM race_players WHERE code = ? AND seen > ?) >= 2
            AND NOT EXISTS (SELECT 1 FROM race_players WHERE code = ? AND seen > ? AND ready = 0)`,
        start, code, code, secret, code, now - LIVE_MS, code, now - LIVE_MS),
        query(db, `UPDATE race_players SET round = (SELECT round FROM race_rooms WHERE code = ?),
            seq = 0, distance = 0, x = 0, y = 0, slide = 0, done = 0, finish = 0
          WHERE code = ? AND seen > ? AND ready = 1
            AND EXISTS (SELECT 1 FROM race_rooms WHERE code = ? AND start = ?
              AND host = (SELECT id FROM race_players WHERE code = ? AND secret = ?))`,
        code, code, now - LIVE_MS, code, start, code, secret),
      ]);
      return result.status === 200 && result.data.room.phase === "lobby"
        ? fail(409, "至少需要 2 位在线玩家，且全员准备后才能开始。") : result;
    }
    case "reset": {
      const seed = randomSeed();
      return snapshot(db, code, secret, now, [
        query(db, `UPDATE race_rooms SET start = 0, seed = ?, round = round + 1
          WHERE code = ? AND start > 0
            AND host = (SELECT id FROM race_players WHERE code = ? AND secret = ?)
            AND (start + ? < ? OR NOT EXISTS (
              SELECT 1 FROM race_players WHERE code = ? AND round = race_rooms.round AND done = 0
            ))`, seed, code, code, secret, RACE_LIMIT_MS, now, code),
        query(db, `UPDATE race_players SET ready = 0, distance = 0, x = 0, y = 0, seq = 0, done = 0, finish = 0, slide = 0
          WHERE code = ? AND EXISTS (SELECT 1 FROM race_rooms WHERE code = ? AND start = 0 AND seed = ?
            AND host = (SELECT id FROM race_players WHERE code = ? AND secret = ?))`, code, code, seed, code, secret),
      ]);
    }
    case "leave": {
      await db.batch([
        query(db, `DELETE FROM race_players WHERE code = ? AND secret = ?
          AND EXISTS (SELECT 1 FROM race_rooms WHERE code = ? AND start = 0)`, code, secret, code),
        query(db, "UPDATE race_players SET done = 1, seen = 0 WHERE code = ? AND secret = ?", code, secret),
        election(db, code, now),
        query(db, `DELETE FROM race_rooms WHERE code = ? AND start = 0
          AND NOT EXISTS (SELECT 1 FROM race_players WHERE code = ?)`, code, code),
      ]);
      return { status: 200, data: { left: true } };
    }
    default:
      return fail(400, "未知的房间操作。");
  }
}
