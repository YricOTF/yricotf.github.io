import { readSession, writeSession } from "./storage.js?v=15";

const SESSION_KEY = "dino-dash.room.v1";

function token() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return Array.from(bytes, (n, i) => ([4, 6, 8, 10].includes(i) ? "-" : "") + n.toString(16).padStart(2, "0")).join("");
}

class RoomError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export class RoomClient {
  constructor(onRoom, onLink, getSample, transport = null) {
    this.transport = transport;
    this.onRoom = onRoom;
    this.onLink = onLink;
    this.getSample = getSample;
    this.session = null;
    this.room = null;
    this.link = "idle";
    this.queue = Promise.resolve();
    this.skew = 0;
    this.rtt = 0;
    this.timer = 0;
    this.retries = 0;
  }

  time() {
    return Date.now() + this.skew;
  }

  pending() {
    return readSession(SESSION_KEY);
  }

  enqueue(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }

  async request(data) {
    const sent = Date.now();
    const result = this.transport ? await this.transport.request(data) : await this.fetchRoom(data);
    const duration = Date.now() - sent;
    if (result.room) {
      const estimate = result.room.now - (sent + (duration > 1200 ? duration : duration / 2));
      this.skew = this.rtt && duration > this.rtt * 2.3 ? this.skew
        : this.rtt ? this.skew * 0.72 + estimate * 0.28 : estimate;
      this.rtt = this.rtt ? Math.round(this.rtt * 0.65 + duration * 0.35) : Math.min(duration, 1200);
    }
    return result;
  }

  async fetchRoom(data) {
    const response = await fetch("/api/room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      cache: "no-store",
      signal: AbortSignal.timeout(4300),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new RoomError(result?.error || "房间服务暂时不可用。", response.status);
    return result;
  }

  setLink(state, detail = "") {
    this.link = state;
    this.onLink(state, detail, this.rtt);
  }

  activate(session, keepClock = false) {
    this.session = session;
    this.room = null;
    if (!keepClock) {
      this.skew = 0;
      this.rtt = 0;
    }
    this.retries = 0;
    writeSession(SESSION_KEY, session);
  }

  apply(result, session) {
    if (!result.room || this.session !== session) return;
    this.room = result.room;
    this.retries = 0;
    this.setLink("connected");
    this.onRoom(result.room);
  }

  async enter(action, options) {
    const attempt = this.attempt?.action === action && this.attempt?.code === options.code
      ? this.attempt : { action, code: options.code, token: token() };
    this.attempt = attempt;
    return this.enqueue(async () => {
      try {
        const result = await this.request({ ...options, action, token: attempt.token });
        const session = { code: result.room.code, token: attempt.token };
        this.activate(session, true);
        this.apply(result, session);
        this.attempt = null;
        this.schedule();
        return result.room;
      } catch (error) {
        if (error.status >= 400 && error.status < 500) this.attempt = null;
        throw error;
      }
    });
  }

  resume(saved) {
    this.activate(saved);
    this.setLink("connecting");
    this.schedule(0);
  }

  schedule(delay = this.room?.phase === "race" || this.room?.phase === "countdown" ? (this.transport ? 235 : 520) : 1000) {
    clearTimeout(this.timer);
    if (this.session) this.timer = setTimeout(() => this.poll(), delay);
  }

  async poll() {
    const session = this.session;
    if (!session || this.polling) return;
    this.polling = true;
    let delay;
    try {
      await this.enqueue(async () => {
        if (this.session !== session) return;
        const result = await this.request({ ...session, action: "sync", sample: this.getSample() });
        this.apply(result, session);
      });
    } catch (error) {
      if (this.session !== session) return;
      if (error.status === 404 || error.status === 409) {
        this.disconnect();
        this.setLink("lost", error.message);
        return;
      }
      this.retries++;
      this.setLink("reconnecting");
      delay = Math.min(4000, 450 * 1.75 ** (this.retries - 1)) + Math.random() * 180;
    } finally {
      this.polling = false;
      if (this.session === session) this.schedule(delay);
    }
  }

  async command(action, fields = {}) {
    const session = this.session;
    if (!session) return;
    return this.enqueue(async () => {
      if (this.session !== session) return;
      const result = await this.request({ ...session, ...fields, action });
      this.apply(result, session);
      if (action === "leave") this.disconnect();
      else this.schedule();
      return result;
    });
  }

  nudge() {
    if (!this.polling) this.schedule(0);
  }

  disconnect() {
    clearTimeout(this.timer);
    this.session = null;
    this.room = null;
    writeSession(SESSION_KEY, null);
  }

  dispose() {
    clearTimeout(this.timer);
    this.session = null;
  }
}
