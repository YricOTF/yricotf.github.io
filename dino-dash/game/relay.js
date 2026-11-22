import { PeerRoomError } from "./peer-model.js?v=5";

const SERVERS = ["wss://broker.emqx.io:8084/mqtt", "wss://test.mosquitto.org:8081/mqtt"];
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const failure = () => new PeerRoomError(503, "联机中继暂时不可用，正在尝试恢复。");
const bytes = (...array) => Uint8Array.from(array);
const utf8 = value => encoder.encode(value);
const word = value => bytes(value >> 8, value & 255);
const b64 = data => btoa(String.fromCharCode(...new Uint8Array(data)));
const unb64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
const idOf = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), n => n.toString(16).padStart(2, "0")).join("");
const roomTopic = code => `dino-dash/yricotf/v1/${code}`;
const clientIdMatch = /^[0-9a-f]{20}$/;

function merge(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function mqttString(value) {
  const data = utf8(value);
  return merge(word(data.length), data);
}

function sendPacket(socket, type, ...parts) {
  const payload = merge(...parts);
  const length = [];
  let left = payload.length;
  do {
    const digit = left % 128;
    left = Math.floor(left / 128);
    length.push(digit + (left ? 128 : 0));
  } while (left);
  socket.send(merge(bytes(type, ...length), payload));
}

function awaitReply(ms, register) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(failure()), ms);
    register(
      value => { clearTimeout(timeout); resolve(value); },
      error => { clearTimeout(timeout); reject(error || failure()); },
    );
  });
}

class Broker {
  constructor(url, topic, onMessage) {
    this.topic = topic;
    this.onMessage = onMessage;
    this.url = url;
    this.socket = null;
    this.active = false;
    this.input = new Uint8Array(0);
    this.heartbeat = 0;
  }

  start() {
    const socket = new WebSocket(this.url, "mqtt");
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    return awaitReply(6200, (open, fail) => {
      socket.onopen = () => {
        sendPacket(socket, 0x10, mqttString("MQTT"), bytes(4, 2), word(38), mqttString(`dd-${idOf()}`));
      };
      socket.onmessage = event => {
        if (!(event.data instanceof ArrayBuffer) || event.data.byteLength > 64_000) return;
        this.parse(new Uint8Array(event.data), (type, content) => {
          if (type === 2 && content[1] === 0) {
            sendPacket(socket, 0x82, word(1), mqttString(this.topic), bytes(0));
          } else if (type === 2) {
            fail();
            this.close();
          } else if (type === 9 && content[2] === 0) {
            this.active = true;
            this.lastMessage = Date.now();
            this.heartbeat = setInterval(() => {
              if (Date.now() - this.lastMessage > 46_000) this.close();
              else if (this.active) sendPacket(socket, 0xc0);
            }, 17_000);
            open(this);
          } else if (type === 3 && this.active) {
            const size = content[0] * 256 + content[1];
            if (content.length < size + 2 || decoder.decode(content.subarray(2, 2 + size)) !== this.topic) return;
            const raw = decoder.decode(content.subarray(2 + size));
            if (raw.length <= 13_000) {
              try { this.onMessage(JSON.parse(raw), this); } catch {}
            }
          }
          this.lastMessage = Date.now();
        });
      };
      socket.onerror = () => fail();
      socket.onclose = () => {
        this.active = false;
        clearInterval(this.heartbeat);
        fail();
      };
    }).catch(error => { this.close(); throw error; });
  }

  parse(data, handle) {
    this.input = merge(this.input, data);
    if (this.input.length > 64_000) {
      this.close();
      return;
    }
    let cursor = 0;
    while (cursor + 1 < this.input.length) {
      const start = cursor;
      const type = this.input[cursor++] >> 4;
      let length = 0;
      let more = true;
      for (let i = 0; i < 4 && cursor < this.input.length && more; i++) {
        const digit = this.input[cursor++];
        length += (digit & 127) * 128 ** i;
        more = (digit & 128) !== 0;
      }
      if (more || cursor + length > this.input.length) {
        cursor = start;
        break;
      }
      handle(type, this.input.subarray(cursor, cursor + length));
      cursor += length;
    }
    this.input = this.input.slice(cursor);
  }

  publish(topic, packet) {
    if (!this.active || this.socket?.readyState !== WebSocket.OPEN) throw failure();
    sendPacket(this.socket, 0x30, mqttString(topic), utf8(JSON.stringify(packet)));
  }

  close() {
    this.active = false;
    clearInterval(this.heartbeat);
    this.socket?.close();
  }
}

async function makeKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
  const wire = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { pair, wire };
}

async function commonKey(keys, wire) {
  if (typeof wire !== "string" || wire.length !== 88) throw failure();
  const publicKey = await crypto.subtle.importKey("raw", unb64(wire), { name: "ECDH", namedCurve: "P-256" }, false, []);
  return crypto.subtle.deriveKey({ name: "ECDH", public: publicKey }, keys.pair.privateKey,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function context(code, id, serial, direction) {
  return utf8(`dino-dash:${code}:${id}:${serial}:${direction}`);
}

async function seal(key, aad, message) {
  const salt = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: salt, additionalData: aad }, key, utf8(JSON.stringify(message)));
  return { iv: b64(salt), wire: b64(encrypted) };
}

async function open(key, aad, packet) {
  const decoded = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(packet.iv), additionalData: aad },
    key, unb64(packet.wire));
  return JSON.parse(decoder.decode(decoded));
}

export class RelayHost {
  constructor(code, handle) {
    this.code = code;
    this.handle = handle;
    this.chats = new Map();
    this.clients = new Map();
    this.keys = makeKeys();
    this.closed = false;
  }

  ensure() {
    if (this.closed) return Promise.reject(failure());
    const candidates = SERVERS.map(url => {
      const old = this.clients.get(url);
      if (old?.broker.active || old?.pending) return old.pending || Promise.resolve(old.broker);
      if (old?.failedAt && Date.now() - old.failedAt < 4300) return Promise.reject(failure());
      const broker = new Broker(url, roomTopic(this.code) + "/in", (message, conn) => {
        this.receive(message, conn).catch(() => {});
      });
      const state = { broker, pending: null, failedAt: 0 };
      state.pending = broker.start().catch(error => { state.failedAt = Date.now(); throw error; }).finally(() => { state.pending = null; });
      this.clients.set(url, state);
      return state.pending;
    });
    return Promise.any(candidates).catch(() => { throw failure(); });
  }

  async receive(packet, broker) {
    if (this.closed || !packet || !clientIdMatch.test(packet.id)) return;
    const reply = roomTopic(this.code) + "/out/" + packet.id;
    const chatId = broker.url + "#" + packet.id;
    if (packet.type === "hi") {
      if (this.chats.size > 28) {
        const cutoff = Date.now() - 90_000;
        for (const [id, chat] of this.chats) if (chat.seen < cutoff) this.chats.delete(id);
        if (this.chats.size > 28 && !this.chats.has(chatId)) return;
      }
      const keys = await this.keys;
      const existing = this.chats.get(chatId);
      if (!existing || existing.peerKey !== packet.pub) {
        const key = await commonKey(keys, packet.pub);
        this.chats.set(chatId, { key, peerKey: packet.pub, serial: 0, seen: Date.now() });
      }
      broker.publish(reply, { type: "hi", pub: keys.wire });
      return;
    }
    const chat = this.chats.get(chatId);
    if (packet.type !== "q" || !chat || !Number.isSafeInteger(packet.serial) || packet.serial <= chat.serial) return;
    const serial = packet.serial;
    const request = await open(chat.key, context(this.code, packet.id, serial, "q"), packet);
    if (serial <= chat.serial || this.closed) return;
    chat.serial = serial;
    chat.seen = Date.now();
    let response;
    try {
      if (JSON.stringify(request).length > 4096) throw new PeerRoomError(400, "房间请求过长。");
      response = { data: this.handle(request) };
    } catch (error) {
      response = { status: error.status || 503, message: error.status ? error.message : "房间暂时不可用。" };
    }
    const sealed = await seal(chat.key, context(this.code, packet.id, serial, "a"), response);
    broker.publish(reply, { type: "a", serial, ...sealed });
  }

  close() {
    this.closed = true;
    for (const state of this.clients.values()) state.broker.close();
    this.clients.clear();
    this.chats.clear();
  }
}

class RelayChannel {
  constructor(code, url) {
    this.code = code;
    this.id = idOf();
    this.destination = roomTopic(code) + "/in";
    this.receiveTopic = roomTopic(code) + "/out/" + this.id;
    this.serial = 0;
    this.broker = new Broker(url, this.receiveTopic, packet => this.receive(packet).catch(() => {}));
  }

  async start() {
    this.keys = await makeKeys();
    await this.broker.start();
    try {
      await awaitReply(3500, (resolve, reject) => {
        this.hello = { resolve, reject };
        this.broker.publish(this.destination, { type: "hi", id: this.id, pub: this.keys.wire });
      });
      return this;
    } finally {
      this.hello = null;
    }
  }

  async receive(packet) {
    if (packet?.type === "hi" && this.hello) {
      const key = await commonKey(this.keys, packet.pub);
      if (!this.hello) return;
      this.key = key;
      this.hello.resolve();
    } else if (packet?.type === "a" && this.waiting?.serial === packet.serial) {
      const pending = this.waiting;
      const result = await open(this.key, context(this.code, this.id, packet.serial, "a"), packet);
      if (this.waiting !== pending) return;
      if (result.status) pending.reject(new PeerRoomError(result.status, result.message));
      else pending.resolve(result.data);
    }
  }

  async send(data) {
    const serial = ++this.serial;
    const sealed = await seal(this.key, context(this.code, this.id, serial, "q"), data);
    try {
      return await awaitReply(3200, (resolve, reject) => {
        this.waiting = { serial, resolve, reject };
        this.broker.publish(this.destination, { type: "q", id: this.id, serial, ...sealed });
      });
    } finally {
      this.waiting = null;
    }
  }

  close() {
    this.broker.close();
  }
}

export async function connectRelay(code) {
  const channels = SERVERS.map(server => new RelayChannel(code, server));
  let winner;
  try {
    winner = await Promise.any(channels.map(channel => channel.start()));
    return winner;
  } catch {
    throw failure();
  } finally {
    for (const channel of channels) if (channel !== winner) channel.close();
  }
}
