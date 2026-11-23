import { RANK_RULES, RANK_TICKS, replayRanked, verifyProofs } from "./engine/replay.js";

const allowedOrigin = origin => origin === "https://yricotf.github.io" || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "");
const isUuid = value => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);

async function limitedJson(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let body = "", length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return JSON.parse(body + decoder.decode());
    length += value.length;
    if (length > 220_000) { await reader.cancel(); return null; }
    body += decoder.decode(value, { stream: true });
  }
}

export function rankHandler({ url, serviceKey, request = fetch }) {
  const rpc = (action, args) => request(`${url}/rest/v1/rpc/${action}`, { method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(args), signal: AbortSignal.timeout(6500) });

  return async incoming => {
    const origin = incoming.headers.get("origin");
    const headers = { "Vary": "Origin", "Cache-Control": "no-store" };
    if (allowedOrigin(origin)) Object.assign(headers, { "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "apikey, authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" });
    const reply = (status, data) => Response.json(data, { status, headers });
    if (origin && !allowedOrigin(origin)) return reply(403, { error: "origin" });
    if (incoming.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (incoming.method !== "POST") return reply(405, { error: "method" });
    const credential = incoming.headers.get("authorization");
    if (!credential?.startsWith("Bearer ")) return reply(401, { error: "authentication" });
    if (!url || !serviceKey) return reply(503, { error: "configuration" });

    try {
      const identity = await request(`${url}/auth/v1/user`, {
        headers: { apikey: serviceKey, Authorization: credential }, signal: AbortSignal.timeout(6500),
      });
      if (!identity.ok) return reply(identity.status >= 429 ? 503 : 401, { error: "authentication" });
      const user = await identity.json();
      if (!isUuid(user.id)) return reply(401, { error: "authentication" });
      const data = await limitedJson(incoming).catch(() => null);
      if (!isUuid(data?.ticket) || !Number.isInteger(data.ticks) || data.ticks < 1 || data.ticks > RANK_TICKS
        || typeof data.nick !== "string" || Array.from(data.nick).length > 16) return reply(400, { error: "run" });
      const result = await rpc("dino_run_for_validation", { p_id: data.ticket, p_player: user.id });
      if (!result.ok) return reply(503, { error: "storage" });
      const entry = await result.json();
      if (entry?.rate_limited) return reply(429, { error: "rate" });
      if (entry?.blocked) return reply(403, { error: "blocked" });
      if (!entry || entry.attempts_exhausted || !Object.hasOwn(RANK_RULES, entry.version)) return reply(409, { error: "ticket" });
      if (entry.finished_at) return reply(200, { score: entry.score, distance: entry.distance, fossils: entry.fossils });
      const reject = async (status, reason) => {
        await rpc("dino_record_rejection", { p_id: data.ticket, p_player: user.id, p_reason: reason }).catch(() => {});
        return reply(status, { error: reason });
      };
      const started = Date.parse(entry.started_at);
      if (!Number.isFinite(started) || Date.now() - started > 14_400_000 || data.ticks * 10 > Date.now() - started + 2000) return reject(409, "timing");
      const replay = replayRanked(entry.seed, data.ticks, data.moves, entry.version);
      if (!replay) return reject(422, "replay");
      if (!await verifyProofs(data.ticks, data.moves, entry.proofs || [])) return reject(422, "checkpoint");
      const saved = await rpc("dino_finish_verified", { p_id: data.ticket, p_player: user.id, p_version: entry.version,
        p_ticks: data.ticks, p_nick: entry.version >= 3 ? "" : data.nick.replace(/[\p{Cc}\p{Cf}]/gu, ""), p_score: replay.score, p_distance: replay.distance, p_fossils: replay.fossils });
      if (!saved.ok) return reply([403, 409].includes(saved.status) ? saved.status : 503, { error: "storage" });
      return reply(200, await saved.json());
    } catch {
      return reply(503, { error: "unavailable" });
    }
  };
}
