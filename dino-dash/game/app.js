import { control, groupsNear, loadRun, newPractice, newRun, RACE_METRES, RACE_RULES, stepRun, tune } from "./runner.js?v=2";
import { ACCESSORIES, CHEST_COST, fragmentBalance, openChest, owns, packLook, SKINS, unlock, unpackLook, WARDROBE } from "./catalog.js?v=2";
import { bossAttack, BOSSES, LANE_NAMES, POWERUPS } from "./challenge.js?v=2";
import { Scene } from "./scene.js?v=2";
import { normalizeSave, readSession, Save, writeSession } from "./storage.js?v=2";
import { RoomClient } from "./network.js";

const RACE_SAVE = "dino-dash.race.v1";
const CODE_FORMAT = /^[2-9A-HJ-NP-Z]{6}$/;
const keys = {
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
  ArrowUp: "jump", Space: "jump", KeyW: "jump", ArrowDown: "slide", KeyS: "slide", KeyX: "strike",
};
const digits = (n, width = 2) => String(Math.floor(n)).padStart(width, "0");

function ranking(players) {
  return [...players].sort((a, b) => {
    if (a.finish && b.finish) return a.finish - b.finish;
    if (a.finish || b.finish) return a.finish ? -1 : 1;
    return b.distance - a.distance || a.joined - b.joined;
  });
}

class Sound {
  constructor() {
    this.active = true;
    this.context = null;
  }

  unlock() {
    if (!this.active) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      this.context ||= new Audio();
      if (this.context.state === "suspended") this.context.resume().catch(() => {});
    } catch {
      this.context = null;
    }
  }

  play(which) {
    if (!this.active || this.context?.state !== "running") return;
    const tones = {
      jump: [330, 590, 0.12], fossil: [720, 1130, 0.103], hit: [145, 57, 0.21],
      tick: [440, 440, 0.081], go: [600, 900, 0.148], unlock: [470, 920, 0.21],
      power: [325, 960, 0.18], shield: [450, 185, 0.15], "boss-strike": [180, 710, 0.18],
      "boss-clear": [490, 1170, 0.27], "boss-enter": [125, 340, 0.24],
    };
    const [start, end, time] = tones[which] || tones.tick;
    const ctx = this.context;
    const beginning = ctx.currentTime;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(start, beginning);
    oscillator.frequency.exponentialRampToValueAtTime(end, beginning + time);
    gain.gain.setValueAtTime(0.033, beginning);
    gain.gain.exponentialRampToValueAtTime(0.0002, beginning + time);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(beginning);
    oscillator.stop(beginning + time + 0.01);
  }

  dispose() {
    this.context?.close().catch(() => {});
  }
}

export function mount(root, { roomTransport = null } = {}) {
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const nodes = Object.fromEntries([...root.querySelectorAll("[id]")].map(el => [el.id, el]));
  const buttons = name => [...root.querySelectorAll(`[data-action="${name}"]`)];
  const panels = [...root.querySelectorAll("[data-panel]")];
  const views = [...root.querySelectorAll("[data-view]")];
  const wardrobeTiles = new Map();
  const powerChips = new Map();
  const dialog = nodes.panel;
  const save = new Save();
  const sound = new Sound();
  const heroCanvas = nodes["hero-canvas"];
  const gameCanvas = nodes["play-canvas"];
  const closetCanvas = nodes["closet-canvas"];
  let hero = new Scene(heroCanvas);
  let scene;
  let closet;
  let panel = "";
  let mode = "menu";
  let run = null;
  let race = null;
  let selected = save.current.skin;
  let wardrobeSlot = "skin";
  let bossHudKey = "";
  let practiceIndex = 0;
  let imported = null;
  let startAt = 0;
  let goAt = 0;
  let countdownNumber = 0;
  let pausedAt = 0;
  let paused = false;
  let lastSaved = 0;
  let raf;
  let lastFrame = 0;
  let lastDraw = 0;
  let toastTimer;
  let feedbackTimer;
  let lobbyBusy = false;
  let entering = false;
  let leaving = false;
  let swipe;
  let feedbackUntil = 0;
  let rosterSignature = "";
  let resultSignature = "";
  let raceJournaled = "";
  let rivalModels = new Map();
  let particles = [];
  let score = { distance: -1, fossils: -1 };
  const listeners = new AbortController();
  const on = (node, event, fn, opts = {}) => node.addEventListener(event, fn, { ...opts, signal: listeners.signal });
  const text = (id, value) => { if (nodes[id].textContent !== String(value)) nodes[id].textContent = value; };
  const setHidden = (node, hidden) => { if (node.hidden !== hidden) node.hidden = hidden; };
  const show = (id, yes) => setHidden(nodes[id], !yes);

  const client = new RoomClient(onRoom, onLink, getSample, roomTransport);

  function displayToast(message) {
    text("toast", message);
    show("toast", true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => show("toast", false), 2400);
  }

  function feedback(message, time = 1050) {
    text("run-feedback", message);
    show("run-feedback", true);
    feedbackUntil = performance.now() + time;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => show("run-feedback", false), time);
  }

  function updateMenu() {
    const profile = save.current;
    text("best-distance", digits(profile.best, 4));
    text("fossil-total", digits(profile.fossils));
    text("skin-total", `${profile.unlocked.length + profile.accessories.length} / ${WARDROBE.length}`);
    for (const btn of buttons("continue")) if (btn.classList.contains("continue")) setHidden(btn, !profile.checkpoint);
    if (profile.checkpoint) text("continue-distance", `· ${Math.floor(profile.checkpoint.distance)} m`);
    sound.active = profile.sound;
    const [soundButton] = buttons("sound");
    soundButton.setAttribute("aria-pressed", String(!profile.sound));
    soundButton.setAttribute("aria-label", profile.sound ? "静音" : "开启声音");
    soundButton.title = profile.sound ? "静音" : "开启声音";
    soundButton.firstElementChild.className = `icon icon-${profile.sound ? "sound" : "muted"}`;
  }

  function openPanel(name) {
    panel = name;
    for (const section of panels) setHidden(section, section.dataset.panel !== name);
    const heading = panels.find(section => section.dataset.panel === name)?.querySelector("h2");
    dialog.setAttribute("aria-label", heading?.textContent || "游戏菜单");
    for (const button of buttons("close")) {
      if (button.classList.contains("panel-close")) setHidden(button, name === "end" || name === "results");
    }
    if (!dialog.open) dialog.showModal();
    if (name === "lobby") renderLobby(client.room);
    if (name === "closet") {
      closet ||= new Scene(closetCanvas);
      renderCloset();
    }
    if (name === "save") renderSave();
    if (name === "chest") renderChest();
  }

  function hidePanel() {
    panel = "";
    if (dialog.open) dialog.close();
  }

  function closePanel() {
    if (panel === "end" || panel === "results") return;
    if (panel === "replace") {
      imported = null;
      openPanel("save");
      return;
    }
    hidePanel();
    if (mode === "solo" && paused && !run?.done) resumeSolo();
  }

  function view(next) {
    mode = next;
    for (const el of views) setHidden(el, next === "menu" ? el.dataset.view !== "menu" : el.dataset.view !== "play");
    const canPlay = next !== "menu";
    root.classList.toggle("is-playing", canPlay);
    show("race-status", next === "race");
    if (canPlay) scene ||= new Scene(gameCanvas);
    for (const btn of buttons("pause")) {
      btn.setAttribute("aria-label", next === "race" ? "离开竞速" : "暂停");
      btn.title = next === "race" ? "离开竞速" : "暂停";
      btn.firstElementChild.className = `icon icon-${next === "race" ? "close" : "pause"}`;
      setHidden(btn, !canPlay);
    }
  }

  function snapshotSolo() {
    if (mode !== "solo" || !run || run.done || run.practice) return;
    save.change(profile => { profile.checkpoint = loadRun(run); });
    updateMenu();
    lastSaved = performance.now();
  }

  function resetHud() {
    startAt = 0;
    goAt = 0;
    countdownNumber = 0;
    score = { distance: -1, fossils: -1 };
    particles = [];
    feedbackUntil = 0;
    paused = false;
    show("run-feedback", false);
    show("countdown", false);
    show("boss-hud", false);
    show("strike-controls", false);
    show("strike-key", false);
    show("meteor-warning", false);
    show("active-powers", false);
    bossHudKey = "";
  }

  function haltToMenu() {
    if (mode === "solo" && !run?.done) snapshotSolo();
    if (mode === "race") snapshotRace();
    run = null;
    race = null;
    rivalModels = new Map();
    resetHud();
    hidePanel();
    view("menu");
    updateMenu();
  }

  function launchSolo(continuing = false, replace = false) {
    if (mode === "race" || client.session) return;
    const profile = save.read();
    if (!continuing && profile.checkpoint && !replace) {
      openPanel("new-run");
      return;
    }
    const checkpoint = continuing ? loadRun(profile.checkpoint) : null;
    if (continuing && !checkpoint) {
      displayToast("没有可继续的单人存档。");
      return;
    }
    beginSolo(checkpoint || newRun(), 2450);
    snapshotSolo();
  }

  function beginSolo(next, countdown) {
    sound.unlock();
    run = next;
    resetHud();
    hidePanel();
    view("solo");
    startAt = performance.now() + countdown;
    updateHud();
  }

  function launchPractice(index) {
    if (mode === "race" || client.session) return;
    const encounter = newPractice(index);
    if (!encounter) return;
    if (mode === "solo") snapshotSolo();
    practiceIndex = index;
    beginSolo(encounter, 1620);
  }

  function pauseSolo() {
    if (mode !== "solo" || !run || run.done) return;
    if (!paused) {
      paused = true;
      pausedAt = performance.now();
      snapshotSolo();
    }
    text("pause-text", run.practice ? "首领练习已暂停。" : save.available ? "单人进度已保存。" : "本轮进度已暂停。浏览器存储暂不可用。");
    openPanel("pause");
  }

  function resumeSolo() {
    if (!run || run.done || mode !== "solo") return;
    if (paused && startAt > pausedAt) startAt += performance.now() - pausedAt;
    paused = false;
    hidePanel();
    sound.unlock();
  }

  function endSolo() {
    const distance = Math.floor(run.distance);
    const gain = run.fossils;
    paused = true;
    pausedAt = performance.now();
    show("practice-retry", run.practice);
    show("end-retry", !run.practice);
    if (run.practice) {
      text("end-title", run.won ? "挑战成功" : "挑战结束");
      text("end-distance", run.boss.hp);
      nodes["end-distance"].parentElement.hidden = true;
      text("end-summary", run.won ? `已击败${BOSSES[practiceIndex].name}。` : `首领还剩 ${run.boss.hp} 格生命。先避开攻击，再到亮色车道反击。`);
    } else {
      let record = false;
      save.change(profile => {
        record = distance > profile.best;
        profile.best = Math.max(distance, profile.best);
        profile.total += distance;
        profile.fossils += gain;
        profile.checkpoint = null;
      });
      text("end-title", run.lastHit === "meteor" ? "被陨石击中" : "跑酷结束");
      nodes["end-distance"].parentElement.hidden = false;
      text("end-distance", distance);
      const wins = run.bossWins ? ` · 击败 ${run.bossWins} 位首领` : "";
      text("end-summary", `收集 ${gain} 枚化石${wins}${record ? " · 刷新了单人纪录！" : ""}`);
    }
    updateMenu();
    openPanel("end");
  }

  function selectedOutfit() {
    return WARDROBE.find(item => item.id === selected);
  }

  function currentLook(profile = save.current) {
    return packLook(profile.skin, profile.head, profile.neck);
  }

  function previewLook() {
    const profile = save.current;
    if (wardrobeSlot === "head") return packLook(profile.skin, selected, profile.neck);
    if (wardrobeSlot === "neck") return packLook(profile.skin, profile.head, selected);
    return packLook(selected, profile.head, profile.neck);
  }

  function stamp(id) {
    const span = document.createElement("span");
    span.className = "wardrobe-stamp";
    span.setAttribute("aria-hidden", "true");
    const n = WARDROBE.findIndex(item => item.id === id);
    if (n < 0) span.classList.add("empty");
    else {
      span.style.setProperty("--sheet-x", `${100 * n / (WARDROBE.length - 1)}%`);
      span.style.setProperty("--sheet-size", `${100 * WARDROBE.length}%`);
    }
    return span;
  }

  function wardrobeSlotIsEquipped(profile, id) {
    return profile[wardrobeSlot] === id;
  }

  function fillCloset() {
    const category = wardrobeSlot === "skin" ? SKINS : ACCESSORIES.filter(item => item.slot === wardrobeSlot);
    const choices = wardrobeSlot === "skin" ? category : [{ id: "", name: "无装饰" }, ...category];
    wardrobeTiles.clear();
    for (const item of choices) {
      const button = document.createElement("button");
      const name = document.createElement("span");
      const status = document.createElement("span");
      button.type = "button";
      button.className = "skin-tile";
      button.dataset.outfit = item.id;
      name.className = "skin-label";
      name.textContent = item.name;
      status.className = "skin-cost";
      button.append(stamp(item.id), name, status);
      wardrobeTiles.set(item.id, { button, status });
    }
    nodes["wardrobe-grid"].replaceChildren(...Array.from(wardrobeTiles.values(), item => item.button));
    for (const tab of root.querySelectorAll("[data-wardrobe-slot]")) {
      tab.setAttribute("aria-pressed", String(tab.dataset.wardrobeSlot === wardrobeSlot));
    }
  }

  function setWardrobeSlot(slot) {
    wardrobeSlot = slot;
    selected = save.current[slot];
    fillCloset();
    text("closet-hint", "");
    renderCloset();
  }

  function renderCloset() {
    const profile = save.current;
    const item = selectedOutfit();
    const selectedEquipped = wardrobeSlotIsEquipped(profile, selected);
    const equip = nodes["equip-button"];
    const hasItem = !item || owns(profile, item);
    const fragments = item ? fragmentBalance(profile, item) : 0;
    const required = item ? Math.max(0, item.cost - fragments) : 0;
    text("closet-universal", profile.universal);
    text("skin-name", item?.name ?? "无装饰");
    text("skin-description", item?.item ?? "保留当前皮肤的外观");
    text("wardrobe-progress", item && !hasItem ? `专属碎片 ${Math.min(fragments, item.cost)} / ${item.cost}` : "");

    equip.disabled = selectedEquipped || (!hasItem && profile.universal < required);
    equip.textContent = selectedEquipped ? "已装备" : !item ? "卸下装饰"
      : hasItem ? "装备" : required > profile.universal ? `还差 ${required - profile.universal} 片`
      : required ? `合成并装备 · 用 ${required} 片万能` : "合成并装备";

    for (const [id, tile] of wardrobeTiles) {
      const choice = WARDROBE.find(entry => entry.id === id);
      tile.button.setAttribute("aria-pressed", String(id === selected));
      tile.status.textContent = wardrobeSlotIsEquipped(profile, id) ? "已装备"
        : !choice || owns(profile, choice) ? "可装备" : `${Math.min(choice.cost, fragmentBalance(profile, choice))} / ${choice.cost} 片`;
    }
  }

  function equip() {
    const item = selectedOutfit();
    let equipped = false;
    save.change(profile => {
      if (item && !unlock(profile, item)) return;
      if (profile[wardrobeSlot] === selected) return;
      profile[wardrobeSlot] = selected;
      equipped = true;
    });
    if (equipped) {
      text("closet-hint", item ? `已装备「${item.name}」。` : "已卸下装饰。");
      sound.play("unlock");
    }
    updateMenu();
    renderCloset();
  }

  function renderChest() {
    const profile = save.current;
    text("chest-fossils", profile.fossils);
    text("chest-universal", profile.universal);
    nodes["chest-open"].disabled = profile.chestOpened && profile.fossils < CHEST_COST;
    text("chest-open", !profile.chestOpened ? "免费开启" : profile.fossils >= CHEST_COST
      ? `开启 · ${CHEST_COST} 枚化石` : `还差 ${CHEST_COST - profile.fossils} 枚化石`);
  }

  function openFossilChest() {
    let reward;
    save.change(profile => { reward = openChest(profile); });
    if (!reward) return;
    const label = reward.item ? `${reward.item.name}碎片` : "万能碎片";
    const preview = nodes["chest-preview"];
    preview.classList.remove("opened");
    void preview.offsetWidth;
    preview.classList.add("opened");
    text("chest-reward", `获得 ${reward.count} 片${label}`);
    text("chest-hint", save.available ? "" : "浏览器存储不可用，当前奖励可从存档导出。");
    sound.play("power");
    updateMenu();
    renderChest();
  }

  function renderSave() {
    const profile = save.current;
    text("save-best", `${profile.best} m`);
    text("save-total", `${profile.total} m`);
    text("save-fossils", `${profile.fossils} 枚`);
    text("save-checkpoint", profile.checkpoint ? `${Math.floor(profile.checkpoint.distance)} m` : "暂无");
    text("save-description", save.available ? "成绩、化石和装扮会自动保存到当前浏览器。" : "浏览器存储不可用。可以导出本次会话的备份。");
  }

  function exportSave() {
    const data = JSON.stringify(save.current, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "dino-dash-save.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 7000);
    text("save-hint", "已导出备份。");
  }

  async function readImport(file) {
    if (!file) return;
    try {
      if (file.size > 750_000) throw new Error();
      const raw = JSON.parse(await file.text());
      if (![1, 2].includes(raw?.version) || !Array.isArray(raw.unlocked) || !Number.isFinite(raw.fossils)) throw new Error();
      imported = normalizeSave(raw);
      openPanel("replace");
    } catch {
      text("save-hint", "这个文件不是有效的 DINO DASH 存档。");
    }
    nodes["import-file"].value = "";
  }

  function tellRoomURL(code) {
    const url = new URL(location.href);
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    if (url.href !== location.href) history.replaceState(history.state, "", url.href);
    return url.href;
  }

  function openOnline(invite = "") {
    if (mode === "solo" && !run?.done) {
      snapshotSolo();
      haltToMenu();
    }
    if (client.room?.phase === "lobby") {
      openPanel("lobby");
      return;
    }
    nodes.nickname.value = save.current.nick || "";
    if (invite) nodes["room-input"].value = invite;
    text("online-hint", client.session ? "正在恢复房间…" : "");
    buttons("create")[0].disabled = !!client.session;
    nodes["join-button"].disabled = !!client.session;
    openPanel("online");
  }

  async function enterRoom(which) {
    if (entering || client.session) return;
    const code = nodes["room-input"].value.trim().toUpperCase();
    if (which === "join" && !CODE_FORMAT.test(code)) {
      text("online-hint", "请输入 6 位有效房间码。");
      nodes["room-input"].focus();
      return;
    }
    entering = true;
    nodes["create-button"].disabled = true;
    nodes["join-button"].disabled = true;
    const name = nodes.nickname.value.trim() || "小恐龙";
    save.change(profile => { profile.nick = name; });
    text("online-hint", which === "create" ? "正在创建房间…" : "正在加入房间…");
    try {
      await client.enter(which, { code: which === "join" ? code : undefined, name, skin: currentLook(), rules: RACE_RULES });
      text("online-hint", "");
    } catch (error) {
      text("online-hint", error.status ? error.message : "连接超时。可以再试一次。");
    } finally {
      entering = false;
      nodes["create-button"].disabled = !!client.session;
      nodes["join-button"].disabled = !!client.session;
    }
  }

  function onLink(state, detail, latency) {
    const label = state === "connected" ? `已连接 · ${latency} ms`
      : state === "connecting" ? "正在连接" : "正在重连";
    text("room-network", label);
    text("race-network", label);
    if (panel === "lobby" && client.room) renderLobby(client.room);
    if (state === "lost") {
      const wasRacing = mode === "race";
      haltToMenu();
      writeSession(RACE_SAVE, null);
      tellRoomURL("");
      if (wasRacing) {
        text("connection-error", detail);
        openPanel("error");
      } else {
        openOnline();
        text("online-hint", detail);
      }
    }
  }

  function playerRow(player, detail, index) {
    const li = document.createElement("li");
    li.className = "room-player";
    if (index != null) {
      const order = document.createElement("span");
      order.className = "player-place";
      order.textContent = digits(index + 1);
      li.append(order);
    }
    const icon = stamp(unpackLook(player.skin).skin);
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;
    const status = document.createElement("span");
    status.className = "player-status";
    status.textContent = detail;
    li.append(icon, name, status);
    return li;
  }

  function renderLobby(room) {
    if (!room) return;
    const { players, host, self } = room;
    const me = players.find(player => player.id === self);
    const active = players.filter(player => player.online);
    const stale = client.link !== "connected";
    text("room-code", room.code);
    text("room-count", `${players.length} / 4`);
    const rows = players.map(player => {
      const status = [player.id === host ? "房主" : "", player.id === self ? "你" : "",
        player.online ? (player.ready ? "已准备" : "待准备") : "暂离"].filter(Boolean).join(" · ");
      return [player, status];
    });
    const signature = JSON.stringify(rows.map(([player, status]) => [player.id, player.skin, player.name, status]));
    if (signature !== rosterSignature) {
      nodes["room-roster"].replaceChildren(...rows.map(([player, status]) => playerRow(player, status)));
      rosterSignature = signature;
    }
    nodes["ready-button"].disabled = lobbyBusy || stale;
    text("ready-button", me?.ready ? "取消准备" : "准备");
    show("start-button", host === self);
    if (roomTransport) text("lobby-leave", host === self ? "关闭房间" : "离开");
    nodes["start-button"].disabled = lobbyBusy || stale || active.length < 2 || !active.every(player => player.ready);
  }

  async function lobbyCommand(which, fields) {
    if (lobbyBusy || !client.session) return;
    lobbyBusy = true;
    renderLobby(client.room);
    text("lobby-hint", "");
    try {
      await client.command(which, fields);
    } catch (error) {
      const message = error.status ? error.message : "网络暂时不可用，请重试。";
      text("lobby-hint", message);
      if (panel === "results") displayToast(message);
    } finally {
      lobbyBusy = false;
      if (client.room?.phase === "lobby") renderLobby(client.room);
    }
  }

  async function leaveRoom() {
    if (leaving) return;
    leaving = true;
    const leave = client.command("leave");
    try {
      await leave;
    } catch {
      client.disconnect();
    }
    leaving = false;
    haltToMenu();
    writeSession(RACE_SAVE, null);
    tellRoomURL("");
  }

  async function inviteRoom() {
    if (!client.room) return;
    const url = tellRoomURL(client.room.code);
    try {
      await navigator.clipboard.writeText(url);
      text("lobby-hint", "已复制邀请链接。也可以分享上方房间码。");
    } catch {
      text("lobby-hint", url);
    }
  }

  function raceKey(room) { return `${room.code}#${room.round}`; }

  function beginRace(room) {
    const key = raceKey(room);
    const state = readSession(RACE_SAVE);
    const cached = state?.key === key ? loadRun({ ...state.run, done: false }, "race") : null;
    const me = room.players.find(player => player.id === room.self);
    const rules = room.rules === RACE_RULES ? RACE_RULES : 1;
    run = cached?.rules === rules ? cached : newRun(room.seed, "race", rules);
    if (me && me.distance > run.distance) {
      run.distance = me.distance;
      run.lane = Math.max(0, Math.min(2, Math.round(me.x / 3) + 1));
      run.x = me.x;
      run.y = 0;
    }
    resetHud();
    race = { key, round: room.round, deadline: room.deadline, start: room.start, seq: Math.max(me?.seq || 0, state?.key === key ? state.seq || 0 : 0) };
    if (me?.done || run.distance >= RACE_METRES) run.done = true;
    if (state?.key === key && Number.isFinite(state.finishAt)) race.finishAt = state.finishAt;
    startAt = room.start;
    rivalModels = new Map();
    raceJournaled = "";
    hidePanel();
    view("race");
    updateHud();
  }

  function onRoom(room) {
    tellRoomURL(room.code);
    if (room.phase === "lobby") {
      const comingBack = mode === "race" || panel === "online" || panel === "results";
      if (mode === "race") {
        haltToMenu();
        writeSession(RACE_SAVE, null);
      }
      if (comingBack) openPanel("lobby");
      renderLobby(room);
      return;
    }
    if (!race || race.key !== raceKey(room)) beginRace(room);
    race.deadline = room.deadline;
    race.start = room.start;
    const me = room.players.find(player => player.id === room.self);
    if (me?.done && !run.done) {
      run.distance = Math.max(run.distance, me.distance);
      run.done = true;
    }
    updateRivals(room);
    if (room.phase === "results") renderResults(room);
  }

  function updateRivals(room) {
    const now = performance.now();
    const kept = new Map();
    for (const player of room.players) {
      if (player.id === room.self) continue;
      const last = rivalModels.get(player.id);
      const elapsed = last ? now - last.at : 0;
      const velocity = last && elapsed > 100 ? Math.max(0, Math.min(19, (player.distance - last.distance) / (elapsed / 1000))) : 0;
      kept.set(player.id, {
        ...player,
        at: now,
        velocity: player.online && !player.done ? velocity : 0,
        visualDistance: last?.visualDistance ?? player.distance,
        visualX: last?.visualX ?? player.x,
        visualY: last?.visualY ?? player.y,
      });
    }
    rivalModels = kept;
    const lines = ranking(room.players).map(player => {
      const line = document.createElement("div");
      line.className = `standing${player.id === room.self ? " self" : ""}`;
      const name = document.createElement("span");
      name.textContent = player.id === room.self ? "你" : player.name;
      const dist = document.createElement("span");
      dist.textContent = player.finish ? "完成" : `${Math.floor(player.distance)} m`;
      line.append(name, dist);
      return line;
    });
    nodes["race-standings"].replaceChildren(...lines);
  }

  function renderResults(room) {
    const sorted = ranking(room.players);
    const target = room.target || RACE_METRES;
    if (raceJournaled !== race.key) {
      save.change(profile => {
        if (profile.races.includes(race.key)) return;
        profile.fossils += run.fossils;
        const mine = sorted.find(player => player.id === room.self);
        profile.total += Math.floor(mine?.distance || 0);
        profile.races = [...profile.races, race.key].slice(-30);
      });
      raceJournaled = race.key;
      updateMenu();
      snapshotRace();
    }
    run.done = true;
    show("countdown", false);
    show("run-feedback", false);
    const place = sorted.findIndex(player => player.id === room.self);
    text("results-summary", `第 ${place + 1} 名 · 本轮收集 ${run.fossils} 枚化石`);
    const signature = JSON.stringify(sorted.map(p => [p.id, p.finish, p.distance, p.name, p.skin]));
    if (signature !== resultSignature) {
      const rows = sorted.map((player, index) => playerRow(player,
        player.finish ? `${target} m · ${(player.finish / 1000).toFixed(2)} 秒` : `${Math.floor(player.distance)} m`, index));
      nodes["result-roster"].replaceChildren(...rows);
      resultSignature = signature;
    }
    show("rematch-button", room.host === room.self);
    if (panel !== "results" && !leaving) openPanel("results");
  }

  function snapshotRace() {
    if (race && run) writeSession(RACE_SAVE, { key: race.key, run, seq: race.seq, finishAt: race.finishAt });
  }

  function getSample() {
    if (mode !== "race" || !race || !run || client.time() < race.start) return null;
    const sample = { round: race.round, seq: ++race.seq, distance: run.distance, x: run.x, y: run.y, slide: run.slide > 0, finishAt: race.finishAt };
    snapshotRace();
    return sample;
  }

  function action(which) {
    sound.unlock();
    if (leaving || entering && which !== "sound") return;
    switch (which) {
      case "home":
        if (mode === "race") {
          if (panel === "results") void leaveRoom();
          else openPanel("leave");
        } else if (client.session) {
          hidePanel();
        } else haltToMenu();
        break;
      case "solo": launchSolo(); break;
      case "new-solo": launchSolo(false, true); break;
      case "practice-retry": launchPractice(practiceIndex); break;
      case "continue": launchSolo(true); break;
      case "pause": if (mode === "race") openPanel("leave"); else pauseSolo(); break;
      case "resume": resumeSolo(); break;
      case "close": closePanel(); break;
      case "online": openOnline(); break;
      case "create": void enterRoom("create"); break;
      case "invite": void inviteRoom(); break;
      case "leave-room":
      case "leave-race": void leaveRoom(); break;
      case "ready": {
        const me = client.room?.players.find(p => p.id === client.room.self);
        if (me) void lobbyCommand("ready", { ready: !me.ready });
        break;
      }
      case "start-room": void lobbyCommand("start"); break;
      case "rematch": void lobbyCommand("reset"); break;
      case "sound":
        save.change(profile => { profile.sound = !profile.sound; });
        updateMenu();
        sound.unlock();
        break;
      case "save":
      case "guide":
      case "chest":
      case "closet":
        if (mode === "race" || client.session) {
          displayToast("退出当前房间后即可打开。");
          break;
        }
        if (mode === "solo" && !run?.done && !paused) {
          pausedAt = performance.now();
          paused = true;
          snapshotSolo();
        }
        if (which === "closet") {
          setWardrobeSlot("skin");
        } else if (which === "save") text("save-hint", "");
        else if (which === "chest") text("chest-hint", "");
        openPanel(which);
        break;
      case "equip": equip(); break;
      case "open-chest": openFossilChest(); break;
      case "export-save": exportSave(); break;
      case "import-save": nodes["import-file"].click(); break;
      case "replace-save":
        if (imported) {
          if (mode !== "menu") haltToMenu();
          save.write(imported);
          imported = null;
          updateMenu();
          openPanel("save");
          text("save-hint", save.available ? "备份已恢复。" : "已载入本次会话。浏览器存储不可用。");
        }
        break;
    }
  }

  function expireRace(clock) {
    if (race && clock >= race.deadline && !run.done) {
      run.done = true;
      client.nudge();
      feedback("比赛时间到 · 正在结算", 4000);
    }
  }

  function runEvent(event, detail) {
    sound.play(event);
    if (event === "fossil") {
      for (let i = 0; i < 7; i++) {
        particles.push({
          x: run.x, y: run.y + 0.8, z: -0.21,
          vx: (Math.random() - 0.5) * 4, vy: 1 + Math.random() * 2,
          life: 0.34 + Math.random() * 0.28, size: 0.09 + Math.random() * 0.045, color: i % 2 ? "#73786a" : "#f1f2e6",
        });
      }
    }
    if (event === "power") feedback(`${POWERUPS[detail].name} · ${POWERUPS[detail].effect}`, 1400);
    if (event === "shield") feedback("甲壳盾抵挡了一次撞击");
    if (event === "boss-clear") feedback(`击败${detail.name} · 获得 ${detail.prize} 枚化石`, 1800);
    if (event === "hit" && mode === "race") feedback(detail === "meteor" ? "被陨石击中 · 减速" : "撞到障碍 · 减速");
  }

  function applyInput(move) {
    if (mode === "menu" || paused || !run || run.done || dialog.open && panel !== "leave") return;
    if (startAt && (mode === "race" ? client.time() : performance.now()) < startAt) return;
    sound.unlock();
    const moved = control(run, move, runEvent);
    if (moved && move === "jump") sound.play("jump");
    if (!moved && move === "strike" && run.boss?.phase === "exposed") feedback(`到${LANE_NAMES[run.boss.weakLane]}后反击`);
  }

  function buildGuide() {
    for (const power of Object.values(POWERUPS)) {
      const li = document.createElement("li");
      const icon = document.createElement("span");
      const copy = document.createElement("div");
      const name = document.createElement("strong");
      const effect = document.createElement("small");
      icon.className = "power-symbol";
      icon.textContent = power.symbol;
      icon.setAttribute("aria-hidden", "true");
      name.textContent = power.name;
      effect.textContent = `${power.effect} · ${power.duration} 秒`;
      copy.append(name, effect);
      li.append(icon, copy);
      nodes["guide-powers"].append(li);
    }
    for (const [index, boss] of BOSSES.entries()) {
      const li = document.createElement("li");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const details = document.createElement("small");
      const button = document.createElement("button");
      title.textContent = boss.name;
      details.textContent = `${boss.distance} m · ${boss.hint}`;
      button.type = "button";
      button.className = "button compact";
      button.dataset.practice = String(index);
      button.textContent = "练习";
      button.setAttribute("aria-label", `练习挑战${boss.name}`);
      copy.append(title, details);
      li.append(stamp(boss.skin), copy, button);
      nodes["guide-bosses"].append(li);
    }
  }

  function buildPowerHud() {
    for (const [id, power] of Object.entries(POWERUPS)) {
      const chip = document.createElement("div");
      const legend = document.createElement("b");
      const timer = document.createElement("span");
      chip.className = "power-chip";
      chip.title = power.name;
      chip.hidden = true;
      legend.textContent = power.symbol;
      chip.append(legend, timer);
      powerChips.set(id, { chip, timer });
      nodes["active-powers"].append(chip);
    }
  }

  function updateChallengeHud(distance) {
    const hasPower = Object.keys(run.powers).length > 0;
    if (hasPower || !nodes["active-powers"].hidden) {
      for (const [id, { chip, timer }] of powerChips) {
        const seconds = Math.ceil(run.powers[id] || 0);
        setHidden(chip, !seconds);
        if (seconds && timer.textContent !== `${seconds}s`) timer.textContent = `${seconds}s`;
      }
    }
    show("active-powers", hasPower);

    const state = run.boss;
    const active = !!state;
    show("boss-hud", active);
    show("strike-controls", active);
    show("strike-key", active);
    if (active) {
      const label = `${state.index}:${state.phase}:${state.hp}:${state.lanes.join(",")}:${state.weakLane}`;
      if (label === bossHudKey) return;
      bossHudKey = label;
      const boss = BOSSES[state.index];
      const incident = bossAttack(state);
      const instructions = {
        intro: "先看首领的攻击车道",
        warning: `${incident.name} · 避开${state.lanes.map(lane => LANE_NAMES[lane]).join("、")}`,
        impact: `${incident.name}！`,
        exposed: `破绽 · 到${LANE_NAMES[state.weakLane]}反击`,
        stagger: "反击命中",
        victory: "首领已击败",
      };
      text("boss-name", boss.name);
      text("boss-count", `${state.hp} / ${boss.hp}`);
      text("boss-prompt", instructions[state.phase]);
      nodes["boss-hud"].dataset.phase = state.phase;
      nodes["strike-button"].disabled = state.phase !== "exposed";
      nodes["boss-health"].replaceChildren(...Array.from({ length: boss.hp }, (_, i) => {
        const segment = document.createElement("i");
        if (i < state.hp) segment.className = "active";
        return segment;
      }));
      show("meteor-warning", false);
      return;
    }
    if (distance === score.distance && !bossHudKey) return;
    bossHudKey = "";
    const meteor = groupsNear(run.seed, run.distance, 33, 0, run.mode, run.rules).flatMap(group => group.obstacles)
      .filter(mark => mark.kind === "meteor" && mark.d > run.distance && mark.d - run.distance <= 30)
      .sort((a, b) => a.d - b.d)[0];
    if (meteor) text("meteor-warning", `陨石落点 · ${LANE_NAMES[meteor.lane]}`);
    show("meteor-warning", !!meteor);
  }

  function updateHud() {
    const distance = Math.floor(run.distance);
    if (distance !== score.distance) text("run-distance", digits(distance, 4));
    if (run.fossils !== score.fossils) text("run-fossils", digits(run.fossils));
    updateChallengeHud(distance);
    score = { distance, fossils: run.fossils };
  }

  function animate(now) {
    const dt = Math.min(0.072, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    const canDraw = now - lastDraw >= (mode === "menu" ? 30 : 11);
    if (canDraw) lastDraw = now;
    if (mode === "menu") {
      if (canDraw && !dialog.open) hero.menu(motionPreference.matches ? 0 : now / 1000, currentLook());
    } else if (run) {
      const clock = mode === "race" ? client.time() : now;
      const timerClock = mode === "solo" && paused ? pausedAt : clock;
      if (startAt && timerClock < startAt) {
        const n = Math.ceil((startAt - timerClock) / 1000);
        if (n !== countdownNumber) {
          countdownNumber = n;
          text("count-message", mode === "race" ? "竞速即将开始" : run.practice ? "准备挑战" : "准备开跑");
          text("count-number", n);
          show("countdown", true);
          if (!paused) sound.play("tick");
        }
      } else if (startAt) {
        startAt = 0;
        goAt = now;
        text("count-message", "开跑！");
        text("count-number", "");
        show("countdown", !run.done);
        if (!run.done) sound.play("go");
      } else if (goAt && now - goAt > 620) {
        show("countdown", false);
        goAt = 0;
      }

      if (race) {
        expireRace(clock);
        text("race-clock", `${Math.max(0, Math.ceil((race.deadline - Math.max(clock, race.start)) / 1000))} 秒 / ${RACE_METRES} m`);
        for (const rival of rivalModels.values()) {
          const extrapolation = 0.3 + Math.min(0.74, (now - rival.at) / 1000);
          const blend = 1 - Math.exp(-10 * dt);
          rival.visualDistance = tune(rival.visualDistance, Math.min(RACE_METRES, rival.distance + rival.velocity * extrapolation), blend);
          rival.visualX = tune(rival.visualX, rival.x, blend);
          rival.visualY = tune(rival.visualY, rival.y, blend);
        }
      }

      if (!paused && !startAt && !run.done) {
        for (let remaining = dt; remaining > 0.0001 && !run.done;) {
          const step = Math.min(remaining, 1 / 100);
          stepRun(run, step, runEvent);
          remaining -= step;
        }
        updateHud();
        if (run.done && mode === "solo") endSolo();
        if (run.done && mode === "race") {
          race.finishAt = Math.round(client.time());
          snapshotRace();
          client.nudge();
          feedback("冲线！等待其他玩家", 5000);
        }
      }
      if (!paused && mode === "solo" && !run.done && !run.practice && now - lastSaved > 1050) snapshotSolo();
      if (!paused) {
        for (const particle of particles) {
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
          particle.vy -= dt * 7.4;
          particle.z += dt * 2.8;
          particle.life -= dt;
        }
        particles = particles.filter(particle => particle.life > 0);
      }
      if (feedbackUntil && now > feedbackUntil) {
        show("run-feedback", false);
        feedbackUntil = 0;
      }
      if (canDraw) scene.race(run, paused ? pausedAt / 1000 : now / 1000, currentLook(), [...rivalModels.values()], particles);
    }
    if (canDraw && panel === "closet") closet.menu(motionPreference.matches ? 0 : now / 1000, previewLook(), true);
    raf = requestAnimationFrame(animate);
  }

  on(root, "click", event => {
    const slot = event.target.closest("[data-wardrobe-slot]");
    if (slot) { setWardrobeSlot(slot.dataset.wardrobeSlot); return; }
    const outfit = event.target.closest("[data-outfit]");
    if (outfit) {
      selected = outfit.dataset.outfit;
      text("closet-hint", "");
      renderCloset();
      return;
    }
    const practice = event.target.closest("[data-practice]");
    if (practice) { launchPractice(Number(practice.dataset.practice)); return; }
    const move = event.target.closest("[data-move]");
    if (move && event.detail === 0) applyInput(move.dataset.move);
    const button = event.target.closest("[data-action]");
    if (button) action(button.dataset.action);
  });
  on(root, "pointerdown", event => {
    const button = event.target.closest("[data-move]");
    if (button && !button.disabled && event.isPrimary && event.button === 0) applyInput(button.dataset.move);
  });
  on(nodes["join-form"], "submit", event => {
    event.preventDefault();
    sound.unlock();
    void enterRoom("join");
  });
  on(nodes["import-file"], "change", event => void readImport(event.target.files[0]));
  on(dialog, "cancel", event => { event.preventDefault(); closePanel(); });
  on(window, "keydown", event => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (dialog.open) closePanel();
      else if (mode === "solo") pauseSolo();
      else if (mode === "race") openPanel("leave");
      return;
    }
    if (dialog.open || event.target instanceof HTMLElement && event.target.matches("input, textarea, [contenteditable]")) return;
    if (mode === "menu" && !client.session && event.code === "Space" && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      launchSolo();
      return;
    }
    const move = keys[event.code];
    if (move && mode !== "menu") {
      event.preventDefault();
      applyInput(move);
    }
  });
  function swipeInput(event) {
    if (swipe?.id !== event.pointerId || swipe.fired) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    const horizontal = Math.abs(dx) > Math.abs(dy);
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    if (distance < 10 || (distance < 16 && distance < 1.22 * Math.min(Math.abs(dx), Math.abs(dy)))) return;
    swipe.fired = true;
    applyInput(horizontal ? (dx < 0 ? "left" : "right") : (dy < 0 ? "jump" : "slide"));
  }
  on(gameCanvas, "pointerdown", event => {
    if (!event.isPrimary || event.button !== 0) return;
    swipe = { x: event.clientX, y: event.clientY, id: event.pointerId, fired: false };
    try { gameCanvas.setPointerCapture(event.pointerId); } catch {}
  });
  on(gameCanvas, "pointermove", swipeInput);
  on(gameCanvas, "pointerup", event => {
    swipeInput(event);
    if (swipe?.id === event.pointerId) swipe = null;
  });
  on(gameCanvas, "pointercancel", event => { if (swipe?.id === event.pointerId) swipe = null; });
  for (const [canvas, replace] of [
    [heroCanvas, () => { hero.dispose(); hero = new Scene(heroCanvas); }],
    [gameCanvas, () => { scene?.dispose(); scene = new Scene(gameCanvas); }],
    [closetCanvas, () => { closet?.dispose(); closet = new Scene(closetCanvas); }],
  ]) {
    on(canvas, "webglcontextlost", event => event.preventDefault());
    on(canvas, "webglcontextrestored", replace);
  }
  on(window, "online", () => client.nudge());
  on(window, "offline", () => { if (client.session) client.setLink("reconnecting"); });
  on(document, "visibilitychange", () => {
    if (document.hidden && mode === "solo" && !paused && !run?.done) pauseSolo();
    if (document.hidden && mode === "race") snapshotRace();
    if (!document.hidden) client.nudge();
  });
  on(window, "pagehide", () => {
    if (mode === "solo" && !run?.done) snapshotSolo();
    if (mode === "race") snapshotRace();
    roomTransport?.close();
  });
  on(window, "storage", event => {
    if (!save.matches(event)) return;
    save.read();
    updateMenu();
    if (panel === "save") renderSave();
    if (panel === "closet") renderCloset();
    if (panel === "chest") renderChest();
  });

  buildGuide();
  buildPowerHud();
  updateMenu();
  const incoming = new URL(location.href).searchParams.get("room")?.toUpperCase() || "";
  const remembered = client.pending();
  if (remembered && CODE_FORMAT.test(remembered.code) && (!incoming || incoming === remembered.code)) {
    client.resume(remembered);
    openOnline(remembered.code);
  } else if (CODE_FORMAT.test(incoming)) {
    openOnline(incoming);
  }
  raf = requestAnimationFrame(animate);

  return () => {
    listeners.abort();
    client.dispose();
    roomTransport?.close();
    sound.dispose();
    hero.dispose();
    scene?.dispose();
    closet?.dispose();
    clearTimeout(toastTimer);
    clearTimeout(feedbackTimer);
    cancelAnimationFrame(raf);
  };
}
