import { PeerRoom, PeerRoomError } from "./peer-model.js?v=5";
import { readSession, writeSession } from "./storage.js?v=5";
import { connectRelay, RelayHost } from "./relay.js?v=5";

const ROOM_KEY = "dino-dash.peer-host.v1";
const ID_PREFIX = "yricotf-dino-dash-v1-";
const PROTOCOL = "dino-dash-1";
const delayError = () => new PeerRoomError(503, "连不上房间。请确认房主保持游戏页面打开，再重试。");

function wait(ms, attach, error = delayError) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(error()), ms);
    attach(
      value => { clearTimeout(timer); resolve(value); },
      reason => { clearTimeout(timer); reject(reason); },
    );
  });
}

let peerLibrary;
function getPeer() {
  if (window.peerjs?.Peer) return Promise.resolve(window.peerjs.Peer);
  if (!peerLibrary) {
    peerLibrary = wait(9000, (resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("../vendor/peerjs.min.js", import.meta.url).href;
      script.onload = () => {
        if (window.peerjs?.Peer) resolve(window.peerjs.Peer);
        else reject(new PeerRoomError(503, "未能加载联机组件。"));
      };
      script.onerror = () => reject(new PeerRoomError(503, "未能加载联机组件。"));
      document.head.append(script);
    }).catch(error => {
      peerLibrary = null;
      throw error;
    });
  }
  return peerLibrary;
}

export class PeerTransport {
  constructor() {
    this.room = null;
    this.peer = null;
    this.channel = null;
    this.relayChannel = null;
    this.relayHost = null;
    this.generation = 0;
    this.connections = new Set();
    this.serial = 0;
    this.pending = null;
    this.hostClosed = false;
    this.unseen = 0;
    this.persisted = readSession(ROOM_KEY);
  }

  async startPeer(id) {
    if (this.peer?.open && (!id || this.peer.id === id)) return this.peer;
    const generation = this.generation;
    const existing = this.peer;
    if (existing?.disconnected && !existing.destroyed && (!id || this.peerId === id)) {
      await wait(8200, (resolve, reject) => {
        existing.once("open", resolve);
        try { existing.reconnect(); } catch (error) { reject(error); }
      }).catch(() => {});
      if (existing.open) return existing;
    }
    existing?.destroy();
    const Peer = await getPeer();
    if (generation !== this.generation) throw delayError();
    const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
    this.peer = peer;
    this.peerId = id || "";
    peer.on("error", error => {
      if (this.openingError) this.openingError(error);
      if (error.type === "peer-unavailable" && this.dialError) this.dialError(error);
    });
    if (id) peer.on("connection", conn => this.serve(conn));
    try {
      await wait(9000, (resolve, reject) => {
        this.openingError = error => reject(new PeerRoomError(503, error.type === "unavailable-id"
          ? "房间正在恢复，请稍等片刻。" : "无法连接联机信令服务，请稍后再试。"));
        peer.once("open", resolve);
      });
      return peer;
    } catch (error) {
      peer.destroy();
      if (this.peer === peer) this.peer = null;
      throw error;
    } finally {
      this.openingError = null;
    }
  }

  async host() {
    const code = this.room.code;
    const current = this.room;
    if (!this.hostingRtc) {
      const background = this.startPeer(ID_PREFIX + code).finally(() => {
        if (this.hostingRtc === background) this.hostingRtc = null;
      });
      this.hostingRtc = background;
    }
    this.relayHost ||= new RelayHost(code, payload => {
      if (current !== this.room) throw new PeerRoomError(404, "房主已关闭房间。");
      return this.remote(payload);
    });
    try {
      await Promise.any([this.hostingRtc, this.relayHost.ensure()]);
    } catch {
      throw new PeerRoomError(503, "无法建立联机房间，请检查网络后再试。");
    }
  }

  remote(payload) {
    if (payload?.token === this.room.ownerToken) throw new PeerRoomError(403, "房主会话不可从访客连接操作。");
    return this.local(payload);
  }

  save() {
    if (this.room) writeSession(ROOM_KEY, this.room.data);
  }

  local(payload) {
    const result = this.room.handle(payload);
    if (result.close) {
      const active = [...this.connections];
      for (const channel of active) if (channel.open) {
        try { channel.send({ type: "closed" }); } catch {}
      }
      this.room = null;
      this.persisted = null;
      writeSession(ROOM_KEY, null);
      setTimeout(() => this.close(), 200);
    } else {
      this.save();
    }
    return result;
  }

  serve(channel) {
    if (channel.metadata?.protocol !== PROTOCOL) {
      channel.on("open", () => channel.close());
      return;
    }
    this.connections.add(channel);
    const remove = () => this.connections.delete(channel);
    channel.on("close", remove);
    channel.on("error", remove);
    channel.on("data", message => {
      if (!channel.open || !this.room || !message || message.type !== "request" || !Number.isSafeInteger(message.id)) return;
      let response;
      try {
        if (JSON.stringify(message.data).length > 4096) throw new PeerRoomError(400, "房间请求过长。");
        response = { data: this.remote(message.data) };
      } catch (error) {
        response = { status: error.status || 503, message: error.status ? error.message : "房间暂时不可用。" };
      }
      try { channel.send({ type: "response", id: message.id, ...response }); } catch {}
    });
  }

  async connect(code) {
    if (this.channel?.open && this.channel.peer === ID_PREFIX + code) return this.channel;
    this.channel?.close();
    const peer = await this.startPeer();
    const channel = peer.connect(ID_PREFIX + code, {
      serialization: "json", reliable: true, metadata: { protocol: PROTOCOL },
    });
    if (!channel) throw delayError();
    this.channel = channel;
    channel.on("data", message => {
      if (!message || typeof message !== "object") return;
      if (message.type === "closed") {
        this.hostClosed = true;
        this.pending?.reject(new PeerRoomError(404, "房主已关闭房间。"));
        channel.close();
      }
      if (message.type !== "response" || message.id !== this.pending?.id) return;
      if (message.status) this.pending.reject(new PeerRoomError(message.status, message.message));
      else this.pending.resolve(message.data);
    });
    channel.on("close", () => {
      if (this.channel === channel) {
        this.channel = null;
        this.pending?.reject(delayError());
      }
    });
    channel.on("error", () => this.pending?.reject(delayError()));
    try {
      await wait(11_000, (resolve, reject) => {
        this.dialError = () => reject(delayError());
        channel.once("open", resolve);
        channel.once("close", () => reject(delayError()));
        channel.once("error", () => reject(delayError()));
      });
      return channel;
    } catch (error) {
      channel.close();
      if (this.channel === channel) this.channel = null;
      throw error;
    } finally {
      this.dialError = null;
    }
  }

  async choose(code) {
    if (this.relayChannel?.code === code && this.relayChannel.broker.active) return "relay";
    if (this.channel?.open && this.channel.peer === ID_PREFIX + code) return "rtc";
    const generation = this.generation;
    const rtc = this.connect(code).then(() => "rtc");
    const relay = connectRelay(code).then(channel => {
      if (generation !== this.generation) {
        channel.close();
        throw delayError();
      }
      this.relayChannel?.close();
      this.relayChannel = channel;
      return "relay";
    });
    try {
      return await Promise.any([rtc, relay]);
    } catch {
      throw delayError();
    }
  }

  async askRtc(payload) {
    const channel = await this.connect(payload.code);
    const id = ++this.serial;
    try {
      return await wait(4100, (resolve, reject) => {
        this.pending = { id, resolve, reject };
        try { channel.send({ type: "request", id, data: payload }); } catch { reject(delayError()); }
      });
    } finally {
      this.pending = null;
    }
  }

  async request(payload) {
    if (payload.action === "create") {
      this.hostClosed = false;
      if (this.room?.ownerToken !== payload.token) {
        this.close();
        this.room = PeerRoom.create(payload.token, payload.name, payload.skin, Date.now(), payload.rules);
      }
      await this.host();
      this.save();
      return this.local({ ...payload, code: this.room.code, action: "sync" });
    }
    if (!this.room && this.persisted?.code === payload.code && this.persisted?.players.some(p => p.token === payload.token && p.id === this.persisted.host)) {
      this.room = new PeerRoom(this.persisted);
    }
    if (this.room?.code === payload.code && this.room.ownerToken === payload.token) {
      const available = this.peer?.open || [...(this.relayHost?.clients?.values() || [])].some(item => item.broker.active);
      if (available) this.host().catch(() => {});
      else await this.host();
      return this.local(payload);
    }
    if (payload.action === "join") {
      this.hostClosed = false;
      this.unseen = 0;
      if (this.room) { this.close(); this.room = null; }
    }
    if (this.hostClosed && payload.action === "sync") throw new PeerRoomError(404, "房主已关闭房间。");
    let path;
    try {
      path = await this.choose(payload.code);
      const result = path === "relay" ? await this.relayChannel.send(payload) : await this.askRtc(payload);
      this.unseen = 0;
      if (payload.action === "leave") this.close();
      return result;
    } catch (error) {
      if (!error.status || error.status >= 500) {
        if (path === "relay") {
          this.relayChannel?.close();
          this.relayChannel = null;
        } else {
          this.channel?.close();
          this.channel = null;
        }
        this.unseen ||= Date.now();
        if (payload.action === "sync" && Date.now() - this.unseen > 55_000) {
          throw new PeerRoomError(404, "房主长时间未响应，请重新加入房间。");
        }
      }
      throw error;
    }
  }

  close() {
    this.generation++;
    this.save();
    this.channel?.close();
    this.peer?.destroy();
    this.relayChannel?.close();
    this.relayHost?.close();
    this.relayChannel = null;
    this.relayHost = null;
    this.hostingRtc = null;
    this.channel = null;
    this.peer = null;
    this.connections.clear();
  }
}
