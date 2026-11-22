import { cloudConfig } from "./cloud-config.js?v=7";
import { hashMoves, REPLAY_VERSION } from "./replay.js?v=7";

const SESSION_KEY = "dino-dash.cloud.v1";
const OUTBOX_KEY = "dino-dash.rank-outbox.v1";

class CloudError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

const lock = (key, task) => globalThis.navigator?.locks ? navigator.locks.request(key, task) : task();

function publicKey(key) {
  if (typeof key !== "string") return false;
  if (key.startsWith("sb_publishable_")) return true;
  try { return JSON.parse(atob(key.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"))).role === "anon"; }
  catch { return false; }
}

export class Cloud {
  constructor(config = cloudConfig) {
    const url = String(config.url || "").replace(/\/+$/, "");
    this.enabled = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) && publicKey(config.publishableKey);
    this.url = url;
    this.key = config.publishableKey;
    this.captchaSiteKey = config.captchaSiteKey || "";
    this.saved = read(SESSION_KEY, null);
    this.pending = read(OUTBOX_KEY, []);
    if (!Array.isArray(this.pending)) this.pending = [];
    this.syncedSnapshot = "";
  }

  get joined() { return Boolean(this.enabled && this.saved?.project === this.url && this.saved?.refresh_token && this.saved?.id); }

  async fetch(path, body, token) {
    if (!this.enabled) throw new CloudError(503, "排行榜等待服务器开通。");
    const headers = { apikey: this.key, "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(this.url + path, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const messages = { 400: "请求未通过校验。", 401: "云端身份已失效，请重新加入。", 403: "服务器拒绝了这项操作。",
        409: "这轮已过期或版本已更新。", 422: "这轮的操作记录或在线校验点未通过。", 429: "请求过快，请稍后再试。" };
      throw new CloudError(response.status, messages[response.status] || "云端暂时无法连接。");
    }
    return data;
  }

  session(data) {
    if (!data?.access_token || !data?.refresh_token || !data?.user?.id) throw new CloudError(503, "云端身份尚未就绪。");
    this.saved = { project: this.url, id: data.user.id, access_token: data.access_token, refresh_token: data.refresh_token,
      expires: Date.now() + (data.expires_in || 3600) * 1000 };
    write(SESSION_KEY, this.saved);
    return this.saved.access_token;
  }

  async join(captchaToken) {
    if (this.joined) return this.token();
    if (!this.captchaSiteKey || typeof captchaToken !== "string" || !captchaToken) throw new CloudError(400, "请先完成真人验证。");
    return lock(SESSION_KEY, async () => {
      const stored = read(SESSION_KEY, null);
      if (stored?.project === this.url && stored.refresh_token && stored.id) {
        this.saved = stored;
        return stored.access_token;
      }
      return this.session(await this.fetch("/auth/v1/signup", { data: {}, gotrue_meta_security: { captcha_token: captchaToken } }));
    });
  }

  async token(force = false) {
    if (!this.joined) throw new CloudError(401, "先加入排行榜。");
    if (!force && this.saved.expires > Date.now() + 60_000) return this.saved.access_token;
    if (!this.refresh) {
      const renew = async () => {
        const latest = read(SESSION_KEY, null);
        if (latest?.id === this.saved.id && latest?.project === this.url && latest.access_token !== this.saved.access_token
          && latest.expires > Date.now() + 60_000) {
          this.saved = latest;
          return latest.access_token;
        }
        try {
          return this.session(await this.fetch("/auth/v1/token?grant_type=refresh_token", { refresh_token: this.saved.refresh_token }));
        } catch (error) {
          if ([400, 401].includes(error.status)) { this.saved = null; write(SESSION_KEY, null); }
          throw error;
        }
      };
      this.refresh = Promise.resolve(lock(SESSION_KEY, renew)).finally(() => { this.refresh = null; });
    }
    return this.refresh;
  }

  async signed(path, args) {
    const token = await this.token();
    try { return await this.fetch(path, args, token); }
    catch (error) {
      if (error.status !== 401) throw error;
      return this.fetch(path, args, await this.token(true));
    }
  }

  board() {
    return this.fetch("/rest/v1/rpc/dino_leaderboard", {});
  }

  async start() {
    if (this.jobs().filter(item => item.project === this.url && item.user === this.saved.id).length >= 8) {
      throw new CloudError(429, "待上报的成绩较多，请先刷新排行榜重试上传。");
    }
    const ticket = await this.signed("/rest/v1/rpc/dino_start_run", { p_version: REPLAY_VERSION });
    if (!ticket?.id || !Number.isInteger(ticket?.seed)) throw new CloudError(503, "排位赛道暂不可用。");
    return ticket;
  }

  async checkpoint(ticket, tick, moves) {
    const count = moves.length;
    const hash = await hashMoves(moves);
    return this.signed("/rest/v1/rpc/dino_checkpoint", { p_id: ticket, p_tick: tick, p_count: count, p_hash: hash });
  }

  async snapshot(profile) {
    if (!this.joined) return;
    const total = { fossils: profile.fossils, universal: profile.universal, fragments: profile.fragments, boosts: profile.boosts,
      bestScore: profile.bestScore, bestDistance: profile.best };
    const signature = JSON.stringify(total);
    if (this.syncedSnapshot === signature) return;
    const applied = await this.signed("/rest/v1/rpc/dino_record_snapshot", { p_totals: total });
    if (applied) this.syncedSnapshot = signature;
    return applied;
  }

  async submit(ticket, ticks, moves, nick) {
    const job = { ticket, ticks, moves, nick };
    await this.editJobs(list => [...list, { project: this.url, user: this.saved.id, job }]);
    return this.send(job);
  }

  jobs() {
    const stored = read(OUTBOX_KEY, this.pending);
    return Array.isArray(stored) ? stored : [];
  }

  async editJobs(update) {
    await lock(OUTBOX_KEY, () => {
      this.pending = update(this.jobs());
      write(OUTBOX_KEY, this.pending);
    });
  }

  async send(job) {
    const remove = () => this.editJobs(list => list.filter(item => item.job?.ticket !== job.ticket));
    try {
      const accepted = await this.signed("/functions/v1/dino-rank", job);
      await remove();
      return accepted;
    } catch (error) {
      if ([400, 403, 404, 409, 422].includes(error.status)) await remove();
      throw error;
    }
  }

  async flush() {
    if (!this.joined) return;
    for (const item of this.jobs()) {
      if (item.project !== this.url || item.user !== this.saved.id) continue;
      try { await this.send(item.job); } catch (error) { if (!error.status || error.status >= 429) return; }
    }
  }
}
