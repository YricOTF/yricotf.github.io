import { biomeAt, BIOMES } from "./course.js?v=16";
import { applyOpeningBoost, control, normalizeRaceRules, loadRun, newPractice, newRun, newSectionPractice, RACE_METRES, RACE_RULES, runScore, stepRun, tune } from "./runner.js?v=16";
import { ACCESSORIES, buyOpeningBoost, chestPrice, OPENING_BOOSTS, fragmentBalance, openChests, owns, packLook, SKINS, unlock, unpackLook, WARDROBE } from "./catalog.js?v=13";
import { BOSSES, POWERUPS } from "./challenge.js?v=16";
import { Scene } from "./scene.js?v=16";
import { normalizeSave, readSession, Save, writeSession } from "./storage.js?v=16";
import { RoomClient } from "./network.js?v=16";
import { Sound } from "./audio.js?v=11";
import { Cloud } from "./cloud.js?v=18";
import { HumanCheck } from "./human-check.js?v=18";
import { MAX_MOVES, MOVES_PER_TICK, PROOF_HEADROOM, PROOF_INTERVAL, RANK_MOVES, RANK_STEP, RANK_TICKS, RANK_RULES } from "./replay.js?v=16";
import { sectionLesson } from "./sections.js?v=16";

const RACE_SAVE = "dino-dash.race.v1";
const CODE_FORMAT = /^[2-9A-HJ-NP-Z]{6}$/;
const keys = {
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
  ArrowUp: "jump", Space: "jump", KeyW: "jump", ArrowDown: "slide", KeyS: "slide",
};
const digits = (n, width = 2) => String(Math.floor(n)).padStart(width, "0");

function ranking(players) {
  return [...players].sort((a, b) => {
    if (a.finish && b.finish) return a.finish - b.finish;
    if (a.finish || b.finish) return a.finish ? -1 : 1;
    return b.distance - a.distance || a.joined - b.joined;
  });
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
  const cloud = new Cloud();
  const heroCanvas = nodes["hero-canvas"];
  const gameCanvas = nodes["play-canvas"];
  const closetCanvas = nodes["closet-canvas"];
  let hero = new Scene(heroCanvas);
  let scene;
  let closet;
  let panel = "";
  let mode = "menu";
  let run = null;
  let ranked = null;
  let rankRequest = 0;
  let historyRequest = 0;
  let appealTicket = "";
  let appealToken = "";
  let appealBusy = false;
  let historyReturn = "rank";
  let boardKind = "score";
  let rankSignupOpen = null;
  let cloudName = "";
  let accountSession = 0;
  let nicknamePending = false;
  let cloudTimer;
  let rankRetryTimer;
  let rankFlush;
  let captchaToken = "";
  let race = null;
  let selected = save.current.skin;
  let wardrobeSlot = "skin";
  let bossHudKey = "";
  let currentBiome = "";
  let biomeTimer;
  let launching = false;
  let chestBusy = false;
  let drawTimer;
  let drawFinish;
  let shownReceipt = "";
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
  let score = { distance: -1, fossils: -1, points: -1 };
  const listeners = new AbortController();
  const on = (node, event, fn, opts = {}) => node.addEventListener(event, fn, { ...opts, signal: listeners.signal });
  const text = (id, value) => { if (nodes[id].textContent !== String(value)) nodes[id].textContent = value; };
  const setHidden = (node, hidden) => { if (node.hidden !== hidden) node.hidden = hidden; };
  const show = (id, yes) => setHidden(nodes[id], !yes);
  const humanCheck = new HumanCheck(nodes["rank-captcha"], (token, message) => {
    captchaToken = token;
    nodes["rank-join"].disabled = !token;
    text("rank-captcha-status", message);
  });
  const appealCheck = new HumanCheck(nodes["rank-appeal-captcha"], (token, message) => {
    appealToken = token;
    nodes["rank-appeal-send"].disabled = !token || appealBusy;
    text("rank-appeal-captcha-status", message);
  });

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
    text("best-score", `${digits(profile.bestScore)} 分`);
    text("fossil-total", digits(profile.fossils));
    text("skin-total", `${profile.unlocked.length + profile.accessories.length} / ${WARDROBE.length}`);
    for (const btn of buttons("continue")) if (btn.classList.contains("continue")) setHidden(btn, !profile.checkpoint);
    if (profile.checkpoint) text("continue-distance", `· ${Math.floor(profile.checkpoint.distance)} m`);
    sound.configure(profile.audio);
    queueCloudSnapshot();
  }

  function openPanel(name) {
    if (panel === "account" && name !== "account") humanCheck.hide();
    if (panel === "rank-history" && name !== "rank-history") closeAppeal();
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
    if (name === "shop") renderShop();
    if (name === "settings") renderAudioSettings();
    if (name === "rank") void refreshBoard();
    if (name === "rank-history") void refreshRankHistory();
    if (name === "account") void refreshAccount();
  }

  function queueCloudSnapshot(delay = 2700) {
    if (!cloud.joined || cloudTimer) return;
    cloudTimer = setTimeout(async () => {
      const profile = save.current;
      let retry = 0;
      try { if (await cloud.snapshot(profile) === false) retry = 2700; }
      catch (error) { if (!error.status || error.status >= 429) retry = 15000; }
      cloudTimer = null;
      if (retry || profile !== save.current) queueCloudSnapshot(retry || 2700);
    }, delay);
  }

  function retryRankUploads() {
    if (rankFlush) return rankFlush;
    clearTimeout(rankRetryTimer);
    rankFlush = cloud.flush(showRankResult).finally(() => {
      rankFlush = null;
      if (cloud.pendingCount() && !document.hidden && navigator.onLine) {
        rankRetryTimer = setTimeout(retryRankUploads, 15000);
      }
    });
    return rankFlush;
  }

  function showRankResult(ticket, result) {
    if (ranked?.id === ticket && panel === "end") {
      text("rank-submit-status", `排位已上报 · ${result.score} 分 · +${result.fossils} 化石`);
    }
  }

  function rememberName(nick, persist = false) {
    cloudName = typeof nick === "string" ? nick : "";
    if (persist && cloudName && save.current.nick !== cloudName) save.change(profile => { profile.nick = cloudName; });
  }

  function rankControls() {
    show("rank-controls", cloud.enabled);
    show("rank-start", cloud.joined && !!cloudName);
    show("rank-account", cloud.enabled);
    text("rank-account", cloudName ? `账户 · ${cloudName}` : "在「账户」设置昵称后即可排位。");
  }

  function accountControls() {
    const verify = cloud.enabled && !cloud.joined && panel === "account";
    show("account-form", cloud.joined);
    show("rank-human-check", verify);
    show("rank-join", verify);
    show("account-rank-start", cloud.joined && !!cloudName);
    text("account-state", cloud.joined ? (cloudName ? `当前昵称 · ${cloudName}` : "设置一个全服唯一的昵称。")
      : cloud.enabled ? "通过真人验证即可创建本设备的账户。上榜会公开昵称和成绩。" : "云端账户暂未开放。");
    nodes["rank-join"].disabled = !verify || !rankSignupOpen || !captchaToken;
    if (verify && rankSignupOpen) void humanCheck.show(cloud.captchaSiteKey);
    else {
      humanCheck.hide();
      if (verify) text("rank-captcha-status", rankSignupOpen === null ? "正在检查注册状态…" : "注册暂未开放。");
    }
  }

  async function refreshAccount() {
    const request = ++accountSession;
    text("account-status", "");
    nodes["account-name"].value = save.current.nick || cloudName;
    accountControls();
    if (!cloud.enabled) return;
    try {
      const current = cloud.joined ? await cloud.profile() : await cloud.signupOpen();
      if (request !== accountSession || panel !== "account") return;
      if (typeof current === "boolean") rankSignupOpen = current;
      else {
        rememberName(current?.nick);
        nodes["account-name"].value = save.current.nick || cloudName;
      }
      accountControls();
    } catch {
      if (panel === "account") text("account-status", "暂时无法读取账户，请稍后再试。");
    }
  }

  async function saveNickname(event) {
    event.preventDefault();
    if (!cloud.joined || nicknamePending) return;
    const name = nodes["account-name"].value.normalize("NFKC").trim().replace(/\s+/gu, " ");
    if (Array.from(name).length > 16 || !/^[\p{L}\p{N}_ -]+$/u.test(name) || !/[\p{L}\p{N}]/u.test(name)) {
      text("account-status", "请填写 1–16 个有效字符。");
      return;
    }
    nicknamePending = nodes["account-save"].disabled = true;
    try {
      const saved = await cloud.setNickname(name);
      rememberName(saved.nick, true);
      if (panel === "account") {
        nodes["account-name"].value = cloudName;
        text("account-status", "昵称已保存，历史成绩也会显示新昵称。");
        accountControls();
      }
      if (panel === "rank") void refreshBoard();
    } catch (error) {
      if (panel === "account") text("account-status", error.status === 409 ? "这个昵称已有人使用。" : error.status === 400 ? "昵称格式不符合要求。" : error.message || "暂时无法保存。");
    } finally {
      nicknamePending = nodes["account-save"].disabled = false;
    }
  }

  async function refreshBoard() {
    const request = ++rankRequest;
    const fossils = boardKind === "fossils";
    for (const button of root.querySelectorAll("[data-board]")) button.setAttribute("aria-pressed", String(button.dataset.board === boardKind));
    show("fossil-board-note", fossils);
    show("rank-personal", fossils);
    const waiting = cloud.pendingCount();
    text("rank-personal", `本地余额 ${save.current.fossils} 枚${waiting ? ` · ${waiting} 局待上传` : ""}`);
    show("rank-table", false);
    show("rank-distance-col", !fossils);
    text("rank-main-col", fossils ? "化石" : "分数");
    nodes["rank-table"].setAttribute("aria-label", fossils ? "排位累计化石前 50 名" : "单人排位前 50 名");
    rankControls();
    if (!cloud.enabled) {
      text("rank-status", "排行榜待开通。仍可正常游玩单人和联机。");
      return;
    }
    text("rank-status", "正在读取云端成绩…");
    nodes["rank-refresh"].disabled = true;
    try {
      await retryRankUploads();
      const [rows, profile] = await Promise.all([
        cloud.board(fossils ? "fossils" : "score"),
        cloud.joined ? cloud.profile().catch(() => null) : null,
      ]);
      if (request !== rankRequest || panel !== "rank") return;
      if (profile) rememberName(profile.nick);
      rankControls();
      if (fossils && cloud.joined) {
        const verified = profile?.rankedFossils ?? rows.find(row => row.nick === cloudName)?.fossils;
        const pending = cloud.pendingCount();
        const totals = [`本地余额 ${save.current.fossils} 枚`];
        if (profile && Object.hasOwn(profile, "walletFossils") && profile.walletFossils !== save.current.fossils) {
          totals.push("余额同步中");
          queueCloudSnapshot();
        }
        if (Number.isFinite(verified)) totals.push(`排位已入榜 ${verified} 枚`);
        if (pending) totals.push(`${pending} 局待上传`);
        text("rank-personal", totals.join(" · "));
      }
      nodes["rank-rows"].replaceChildren(...rows.map(row => {
        const line = document.createElement("tr");
        const values = [row.place, row.reviewed ? `${row.nick} · 人工复核` : row.nick, fossils ? `${row.fossils} 枚` : row.score];
        if (!fossils) values.push(`${row.distance} m`);
        for (const value of values) {
          const cell = document.createElement("td");
          cell.textContent = value;
          line.append(cell);
        }
        return line;
      }));
      show("rank-table", rows.length > 0);
      text("rank-status", rows.length ? "" : fossils ? "还没有可计入的排位化石。" : "还没有通过校验的排位成绩。");
    } catch (error) {
      if (request === rankRequest && panel === "rank") text("rank-status", error.status ? error.message : "无法连接排行榜，请重试。");
    } finally {
      if (request === rankRequest) nodes["rank-refresh"].disabled = false;
    }
  }

  async function joinRank() {
    const button = nodes["rank-join"];
    if (button.disabled || !rankSignupOpen) return;
    button.disabled = true;
    text("account-status", "正在创建玩家账户…");
    try {
      await cloud.join(captchaToken);
      queueCloudSnapshot();
      if (panel === "account") await refreshAccount();
    } catch (error) {
      if (panel === "account") text("account-status", error.status === 400 ? "真人验证或登录失败，请重试。" : error.status ? error.message : "连接失败，请重试。");
    } finally {
      humanCheck.reset();
    }
  }

  async function refreshRankHistory(message = "") {
    const request = ++historyRequest;
    closeAppeal();
    const list = nodes["rank-history-rows"];
    list.replaceChildren();
    text("rank-history-status", message || "正在读取排位记录…");
    try {
      const rows = await cloud.history();
      if (request !== historyRequest || panel !== "rank-history") return;
      const pending = new Map(cloud.ownJobs().map(entry => [entry.job.ticket, entry]));
      const failed = new Map(cloud.rejectedJobs().map(entry => [entry.job.ticket, entry]));
      const known = new Set(rows.map(row => row.id));
      const entries = [...[...pending.values()].filter(item => !known.has(item.job.ticket)).map(item => ({ id: item.job.ticket, can_retry: true })), ...rows];
      for (const row of entries) {
        const local = pending.get(row.id) ?? failed.get(row.id);
        const item = document.createElement("li");
        const heading = document.createElement("strong");
        const detail = document.createElement("p");
        const controls = document.createElement("div");
        controls.className = "panel-actions";
        const score = row.score ?? local?.summary?.score;
        const distance = row.distance ?? local?.summary?.distance;
        const time = row.started_at ? new Date(row.started_at).toLocaleString("zh-CN", { hour12: false }) : "本机待上传";
        heading.textContent = score === undefined ? time : `${score} 分 · ${distance} 米 · ${time}`;
        const failure = { checkpoint: "在线校验点不完整", replay: "重放校验失败", timing: "排位票据时限或计时校验失败" }[row.rejection];
        const review = { pending: "申诉待审核", approved: "申诉已通过", rejected: "申诉未通过" }[row.appeal];
        detail.textContent = [row.reviewed ? "人工复核入榜" : row.finished_at ? "已入榜" : failure ?? "待上传", review, row.reply,
          !row.finished_at && row.rejection && !local ? "本机没有完整操作记录" : ""].filter(Boolean).join(" · ");
        if (!row.finished_at) {
          const retry = document.createElement("button");
          retry.type = "button";
          retry.className = "button compact";
          retry.textContent = "重试上传";
          retry.disabled = !local || !row.can_retry;
          retry.addEventListener("click", async () => {
            retry.disabled = true;
            text("rank-history-status", "正在重新校验…");
            try {
              await cloud.retry(row.id);
              if (panel === "rank-history") void refreshRankHistory("此局已通过校验。");
            } catch (error) {
              if (panel !== "rank-history") return;
              text("rank-history-status", error.message || "暂时无法重试，请稍后再试。");
              setTimeout(() => { retry.disabled = false; }, 4200);
            }
          });
          controls.append(retry);
          if (row.rejection && !row.appeal) {
            const appeal = document.createElement("button");
            appeal.type = "button";
            appeal.className = "button compact";
            appeal.textContent = "申诉";
            appeal.addEventListener("click", () => void openAppeal(row.id));
            controls.append(appeal);
          }
        }
        item.append(heading, detail, controls);
        list.append(item);
      }
      text("rank-history-status", message || (entries.length ? "" : "暂无排位记录。"));
    } catch (error) {
      if (request === historyRequest && panel === "rank-history") text("rank-history-status", error.message || "暂时无法读取排位记录。");
    }
  }

  function closeAppeal() {
    appealTicket = "";
    appealCheck.hide();
    show("rank-appeal-form", false);
  }

  async function openAppeal(ticket) {
    if (appealBusy) return;
    closeAppeal();
    appealTicket = ticket;
    nodes["rank-appeal-message"].value = "";
    show("rank-appeal-form", true);
    nodes["rank-appeal-message"].focus();
    try {
      const cData = await cloud.appealContext(ticket);
      if (appealTicket === ticket) await appealCheck.show(cloud.captchaSiteKey, { action: "rank_appeal", cData });
    } catch {
      if (appealTicket === ticket) text("rank-appeal-captcha-status", "真人验证暂时无法加载。");
    }
  }

  async function submitAppeal(event) {
    event.preventDefault();
    const button = nodes["rank-appeal-send"];
    const message = nodes["rank-appeal-message"].value.trim();
    if (!appealTicket || !appealToken || !message || button.disabled || appealBusy) return;
    const ticket = appealTicket;
    appealBusy = true;
    button.disabled = true;
    try {
      await cloud.appeal(ticket, message, appealToken);
      if (panel === "rank-history") void refreshRankHistory("申诉已提交。");
    } catch (error) {
      if (panel === "rank-history") text("rank-history-status", error.message || "申诉提交失败。");
    } finally {
      appealBusy = false;
      if (appealTicket === ticket) appealCheck.reset();
    }
  }

  async function launchRanked() {
    if (mode === "race" || client.session || launching) return;
    if (!cloud.enabled) { openPanel("rank"); return; }
    if (!cloud.joined) { openPanel("account"); return; }
    launching = true;
    for (const button of buttons("rank-start")) button.disabled = true;
    const status = { rank: "rank-status", account: "account-status", end: "rank-submit-status" }[panel] || "rank-launch-status";
    text(status, "正在领取排位赛道…");
    try {
      if (!cloudName) {
        rememberName((await cloud.profile())?.nick);
        if (!cloudName) { openPanel("account"); return; }
      }
      void retryRankUploads();
      const ticket = await cloud.start();
      const nick = cloudName;
      beginSolo(newRun(ticket.seed, "solo", RANK_RULES[ticket.version]), 2020, { id: ticket.id, nick, ticks: 0, moves: [], carry: 0, lastInput: -1, sameTick: 0,
        nextProof: PROOF_INTERVAL, retryProofAt: 0, proof: null, proofPending: null });
    } catch (error) {
      if (!cloud.joined) {
        openPanel("account");
      } else {
        const message = error.status ? error.message : "暂时无法领取赛道，请重试。";
        if (status === "rank-launch-status") displayToast(message);
        else text(status, message);
      }
      rankControls();
    } finally {
      launching = false;
      for (const button of buttons("rank-start")) button.disabled = false;
      text("rank-launch-status", "");
    }
  }

  function sendRankProof(attempt, now) {
    if (!attempt.proof || attempt.proofPending || now < attempt.retryProofAt) return;
    const proof = attempt.proof;
    attempt.proofPending = cloud.checkpoint(attempt.id, proof.tick, proof.moves).then(() => {
      attempt.proof = null;
      attempt.nextProof = proof.tick + PROOF_INTERVAL;
      return true;
    }).catch(() => {
      attempt.retryProofAt = performance.now() + 2200;
      return false;
    }).finally(() => { attempt.proofPending = null; });
  }

  function waitingForRankProof() {
    return ranked && ranked.ticks >= ranked.nextProof + PROOF_HEADROOM;
  }

  function advanceRanked(dt, now) {
    if (waitingForRankProof()) ranked.carry = 0;
    else ranked.carry += dt;
    while (ranked.carry >= RANK_STEP && !run.done && !waitingForRankProof()) {
      stepRun(run, RANK_STEP, runEvent);
      ranked.carry -= RANK_STEP;
      ranked.ticks++;
      if (ranked.ticks === ranked.nextProof) ranked.proof = { tick: ranked.ticks, moves: ranked.moves.slice() };
      if (ranked.ticks >= RANK_TICKS) run.done = true;
    }
    if (!run.done) sendRankProof(ranked, now);
    const waiting = waitingForRankProof();
    text("ranked-badge", waiting ? "校验同步中 · 已暂停" : "排位");
    if (waiting) ranked.carry = 0;
  }

  function hidePanel() {
    if (panel === "account") humanCheck.hide();
    if (panel === "rank-history") closeAppeal();
    panel = "";
    if (dialog.open) dialog.close();
  }

  function closePanel() {
    if (panel === "end" || panel === "results") return;
    if (panel === "rank-history") { openPanel(historyReturn); return; }
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
    show("ranked-badge", next === "solo" && !!ranked);
    text("ranked-badge", "排位");
    if (canPlay) scene ||= new Scene(gameCanvas);
    for (const btn of buttons("pause")) {
      btn.setAttribute("aria-label", next === "race" ? "离开竞速" : "暂停");
      btn.title = next === "race" ? "离开竞速" : "暂停";
      btn.firstElementChild.className = `icon icon-${next === "race" ? "close" : "pause"}`;
      setHidden(btn, !canPlay);
    }
  }

  function snapshotSolo() {
    if (mode !== "solo" || !run || run.done || run.practice || ranked) return;
    save.change(profile => { profile.checkpoint = loadRun(run); });
    updateMenu();
    lastSaved = performance.now();
  }

  function resetHud() {
    startAt = 0;
    goAt = 0;
    countdownNumber = 0;
    score = { distance: -1, fossils: -1, points: -1 };
    particles = [];
    feedbackUntil = 0;
    paused = false;
    show("run-feedback", false);
    show("lesson-hud", false);
    show("countdown", false);
    show("boss-hud", false);
    show("biome-title", false);
    clearTimeout(biomeTimer);
    currentBiome = "";
    show("active-powers", false);
    bossHudKey = "";
  }

  function haltToMenu() {
    if (mode === "solo" && !run?.done) snapshotSolo();
    if (mode === "race") snapshotRace();
    run = null;
    ranked = null;
    race = null;
    rivalModels = new Map();
    resetHud();
    hidePanel();
    view("menu");
    updateMenu();
  }

  async function launchSolo(continuing = false, replace = false) {
    if (mode === "race" || client.session || launching) return;
    launching = true;
    try {
      const next = await save.exclusive(() => {
        const profile = save.read();
        if (continuing) return loadRun(profile.checkpoint);
        if (profile.checkpoint && !replace) return "confirm";
        const started = newRun();
        const boost = profile.boostSelected;
        if (boost && profile.boosts[boost] > 0) {
          profile.boosts[boost]--;
          profile.boostSelected = "";
          applyOpeningBoost(started, boost);
        }
        profile.checkpoint = started;
        profile.savedAt = Date.now();
        save.write(profile);
        return started;
      });
      if (next === "confirm") openPanel("new-run");
      else if (!next) displayToast("没有单人存档。");
      else {
        beginSolo(next, 2020);
        lastSaved = performance.now();
      }
    } finally {
      launching = false;
    }
  }

  function beginSolo(next, countdown, challenge = null) {
    sound.unlock();
    run = next;
    ranked = challenge;
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

  function launchSectionPractice(kind) {
    if (mode === "race" || client.session) return;
    const practice = newSectionPractice(kind);
    if (!practice) return;
    if (mode === "solo") snapshotSolo();
    beginSolo(practice, 1450);
  }

  function pauseSolo() {
    if (mode !== "solo" || !run || run.done) return;
    if (!paused) {
      paused = true;
      pausedAt = performance.now();
      snapshotSolo();
    }
    text("pause-text", ranked ? "排位已暂停。退出会结束本轮。" : run.practice ? "练习已暂停。" : save.available ? "单人进度已保存。" : "本轮进度已暂停。浏览器存储暂不可用。");
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
    const points = runScore(run);
    paused = true;
    pausedAt = performance.now();
    show("practice-retry", run.practice);
    show("end-retry", !run.practice);
    show("rank-submit-status", !!ranked || !run.practice && cloud.enabled);
    show("end-rank-history", !!ranked);
    if (!ranked) text("rank-submit-status", "单人局 · 未计入排行榜");
    if (run.practice) {
      text("end-title", run.won ? "挑战成功" : "挑战结束");
      nodes["end-distance"].parentElement.hidden = true;
      if (run.practiceSection) {
        const structure = run.practiceSection === "river" ? "藤蔓渡河" : "山洞矿车";
        text("end-summary", run.won ? `已完成${structure}。` : `${structure}还可以再试一次。`);
      } else text("end-summary", run.won ? `已击败${BOSSES[practiceIndex].name}。` : `首领剩余 ${run.boss.hp} 格生命。`);
    } else {
      let record = false;
      let scoreRecord = false;
      save.change(profile => {
        record = distance > profile.best;
        scoreRecord = points > profile.bestScore;
        profile.best = Math.max(distance, profile.best);
        profile.bestScore = Math.max(points, profile.bestScore);
        profile.total += distance;
        profile.fossils += gain;
        if (!ranked) profile.checkpoint = null;
      });
      text("end-title", run.lastHit === "meteor" ? "被陨石击中" : "跑酷结束");
      nodes["end-distance"].parentElement.hidden = false;
      text("end-distance", distance);
      const wins = run.bossWins ? ` · 击败 ${run.bossWins} 位首领` : "";
      const newRecord = record && scoreRecord ? " · 里程和分数新纪录" : record ? " · 里程新纪录" : scoreRecord ? " · 分数新纪录" : "";
      text("end-summary", `收集 ${gain} 枚化石${wins}${newRecord}`);
    }
    text("end-score", `${points} 分`);
    updateMenu();
    openPanel("end");
    if (ranked) {
      const result = ranked;
      text("rank-submit-status", "正在校验排位成绩…");
      cloud.submit(result.id, result.ticks, result.moves, result.nick, result.proof, result.proofPending, { score: points, distance, fossils: gain }).then(accepted => {
        showRankResult(result.id, accepted);
      }).catch(error => {
        if (ranked === result) text("rank-submit-status", error.status && error.status < 429 ? error.message : "上传暂缓，游戏会自动重试。");
        if (cloud.pendingCount()) void retryRankUploads();
      });
    }
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

  function rewardIcon(id) {
    const icon = document.createElement("span");
    icon.className = "reward-icon";
    icon.dataset.icon = id;
    icon.setAttribute("aria-hidden", "true");
    return icon;
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

  function drawReceipt(receipt) {
    if (shownReceipt === JSON.stringify(receipt)) return;
    shownReceipt = JSON.stringify(receipt);
    const tray = nodes["chest-results"];
    tray.replaceChildren(...receipt.map((reward, index) => {
      const card = document.createElement("div");
      const symbol = reward.type === "shard" ? stamp(reward.id) : rewardIcon(reward.type === "boost" ? reward.id : reward.type);
      const label = document.createElement("strong");
      const amount = document.createElement("small");
      card.className = "reward-card";
      card.dataset.reward = reward.type;
      card.style.setProperty("--order", index);
      symbol.classList.add("reward-symbol");
      if (reward.type === "shard") symbol.append(rewardIcon("shard"));
      const item = WARDROBE.find(entry => entry.id === reward.id);
      label.textContent = reward.type === "boost" ? OPENING_BOOSTS[reward.id].name
        : reward.type === "fossil" ? "化石" : item ? item.name : "万能碎片";
      amount.textContent = reward.type === "shard" ? `${reward.count} 片${reward.recycled ? ` · +${reward.recycled} 化石` : ""}` : `×${reward.count}`;
      card.append(symbol, label, amount);
      return card;
    }));
    tray.dataset.count = String(receipt.length);
    nodes["chest-preview"].classList.toggle("opened", receipt.length > 0);
  }

  function renderBoosts(profile) {
    const slots = Object.keys(OPENING_BOOSTS).filter(id => profile.boosts[id] > 0);
    show("boost-rack", slots.length > 0);
    nodes["boost-options"].replaceChildren(...slots.map(id => {
      const option = document.createElement("button");
      option.className = "boost-option";
      option.type = "button";
      option.dataset.boost = id;
      option.append(rewardIcon(id), `×${profile.boosts[id]}`);
      option.setAttribute("aria-label", `${OPENING_BOOSTS[id].name} ×${profile.boosts[id]}`);
      option.setAttribute("aria-pressed", String(profile.boostSelected === id));
      option.title = OPENING_BOOSTS[id].name;
      return option;
    }));
  }

  function renderChest() {
    const profile = save.current;
    text("chest-fossils", profile.fossils);
    text("chest-universal", profile.universal);
    const single = chestPrice(profile, 1);
    const ten = chestPrice(profile, 10);
    nodes["chest-open"].disabled = chestBusy || profile.fossils < single;
    nodes["chest-ten"].disabled = chestBusy || profile.fossils < ten;
    text("chest-open", single ? `单开 · ${single}` : "免费开");
    text("chest-ten", `十连 · ${ten}`);
    drawReceipt(profile.chestReceipt);
    renderBoosts(profile);
  }

  async function selectBoost(id) {
    if (!Object.hasOwn(OPENING_BOOSTS, id) || chestBusy) return;
    await save.exclusive(() => save.change(profile => {
      if (profile.boosts[id]) profile.boostSelected = profile.boostSelected === id ? "" : id;
    }));
    if (panel === "chest") renderChest();
    if (panel === "shop") renderShop(`[data-boost="${id}"]`);
  }

  function renderShop(restoreFocus) {
    const profile = save.current;
    text("shop-fossils", profile.fossils);
    nodes["shop-items"].replaceChildren(...Object.entries(OPENING_BOOSTS).map(([id, boost]) => {
      const row = document.createElement("li");
      const copy = document.createElement("div");
      const heading = document.createElement("strong");
      const detail = document.createElement("small");
      const controls = document.createElement("div");
      const arm = document.createElement("button");
      const buy = document.createElement("button");
      heading.textContent = `${boost.name} ×${profile.boosts[id]}`;
      const effects = Object.entries(boost.effects).map(([power, duration]) => `${POWERUPS[power].name} ${duration} 秒`);
      if (boost.launch) effects.unshift(`${boost.launch.kind === "flight" ? "骑翼龙飞越" : "无碰撞冲刺"} ${boost.launch.distance} 米`);
      detail.textContent = effects.join(" + ");
      arm.type = buy.type = "button";
      arm.className = buy.className = "button compact";
      arm.dataset.boost = buy.dataset.buyBoost = id;
      const selected = profile.boostSelected === id;
      arm.textContent = selected ? "已选" : "选用";
      arm.setAttribute("aria-label", `开局选用${boost.name}`);
      arm.setAttribute("aria-pressed", String(selected));
      arm.disabled = profile.boosts[id] === 0;
      buy.textContent = `${boost.cost} 化石`;
      buy.setAttribute("aria-label", `购买${boost.name}，${boost.cost} 枚化石`);
      buy.disabled = profile.fossils < boost.cost || profile.boosts[id] >= 9999;
      copy.append(heading, detail);
      controls.append(arm, buy);
      row.append(rewardIcon(id), copy, controls);
      return row;
    }));
    if (restoreFocus) nodes["shop-items"].querySelector(restoreFocus)?.focus();
  }

  let buyingBoost = false;
  async function buyBoost(id) {
    if (buyingBoost || !Object.hasOwn(OPENING_BOOSTS, id)) return;
    buyingBoost = true;
    try {
      let bought = false;
      await save.exclusive(() => save.change(profile => { bought = buyOpeningBoost(profile, id); }));
      updateMenu();
      if (panel === "shop") {
        renderShop(`[data-boost="${id}"]`);
        text("shop-hint", bought ? `已购买${OPENING_BOOSTS[id].name} ×1` : "余额不足或库存已满。");
      }
      if (bought) sound.play("shop");
    } finally {
      buyingBoost = false;
    }
  }

  function renderAudioSettings() {
    const audio = save.current.audio;
    for (const key of ["music", "effects"]) {
      nodes[`${key}-enabled`].checked = audio[key];
      nodes[`${key}-volume`].value = audio[`${key}Volume`];
      text(`${key}-percent`, `${audio[`${key}Volume`]}%`);
    }
  }

  async function openFossilChest(count) {
    if (chestBusy) return;
    chestBusy = true;
    const preview = nodes["chest-preview"];
    renderChest();
    try {
      let rewards;
      await save.exclusive(() => save.change(profile => { rewards = openChests(profile, count); }));
      if (!rewards) return;
      shownReceipt = "";
      preview.classList.remove("opened", "drawing");
      void preview.offsetWidth;
      preview.classList.add("drawing");
      text("chest-reward", `抽取 ${rewards.length} 件奖励`);
      text("chest-hint", save.available ? "" : "当前奖励可从存档导出。");
      sound.play("chest");
      updateMenu();
      renderChest();
      if (!motionPreference.matches) {
        await new Promise(resolve => {
          drawFinish = resolve;
          drawTimer = setTimeout(resolve, count === 10 ? 1610 : 620);
        });
      }
    } finally {
      clearTimeout(drawTimer);
      drawFinish = null;
      preview.classList.remove("drawing");
      chestBusy = false;
      if (panel === "chest") renderChest();
    }
  }

  function renderSave() {
    const profile = save.current;
    text("save-best", `${profile.best} m`);
    text("save-best-score", `${profile.bestScore} 分`);
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
    nodes.nickname.value = cloudName || save.current.nick;
    nodes.nickname.readOnly = !!cloudName;
    if (cloud.joined) void cloud.profile().then(profile => {
      if (panel !== "online" || !profile?.nick) return;
      rememberName(profile.nick);
      nodes.nickname.value = cloudName;
      nodes.nickname.readOnly = true;
    }).catch(() => {});
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
    const name = cloudName || nodes.nickname.value.trim() || "小恐龙";
    save.change(profile => { profile.nick = name; });
    text("online-hint", which === "create" ? "正在创建房间…" : "正在加入房间…");
    try {
      const options = { code: which === "join" ? code : undefined, name, skin: currentLook(), rules: RACE_RULES };
      for (const rules of [RACE_RULES, 5, 4, 3, 2]) {
        try {
          await client.enter(which, { ...options, rules });
          break;
        } catch (error) {
          if (which !== "join" || rules === 2 || error.status !== 409 || !error.message.includes("新版赛道")) throw error;
        }
      }
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
    const rules = normalizeRaceRules(room.rules);
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
    text("results-summary", `第 ${place + 1} 名 · ${runScore(run)} 分 · ${run.fossils} 枚化石`);
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
    if (leaving || entering || launching) return;
    switch (which) {
      case "home":
        if (mode === "race") {
          if (panel === "results") void leaveRoom();
          else openPanel("leave");
        } else if (client.session) {
          hidePanel();
        } else haltToMenu();
        break;
      case "solo": if (ranked && panel === "end") void launchRanked(); else launchSolo(); break;
      case "new-solo": launchSolo(false, true); break;
      case "practice-retry":
        if (run?.practiceSection) launchSectionPractice(run.practiceSection);
        else launchPractice(practiceIndex);
        break;
      case "practice-river": launchSectionPractice("river"); break;
      case "practice-rail": launchSectionPractice("rail"); break;
      case "continue": launchSolo(true); break;
      case "pause": if (mode === "race") openPanel("leave"); else pauseSolo(); break;
      case "resume": resumeSolo(); break;
      case "account": if (mode === "menu" && !client.session) openPanel("account"); break;
      case "rank": if (mode === "menu" && !client.session) openPanel("rank"); break;
      case "rank-refresh": void refreshBoard(); break;
      case "rank-history":
        if (!cloud.joined) { openPanel("account"); break; }
        historyReturn = panel === "end" ? "end" : "rank";
        openPanel("rank-history");
        break;
      case "rank-history-back": openPanel(historyReturn); break;
      case "rank-appeal-cancel": closeAppeal(); break;
      case "rank-join": void joinRank(); break;
      case "rank-start": void launchRanked(); break;
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
      case "settings":
        if (mode === "solo" && !run?.done && !paused) {
          pausedAt = performance.now();
          paused = true;
          snapshotSolo();
        }
        openPanel("settings");
        break;
      case "shop":
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
        else if (which === "shop") text("shop-hint", "");
        openPanel(which);
        break;
      case "equip": equip(); break;
      case "open-chest": void openFossilChest(1); break;
      case "open-ten": void openFossilChest(10); break;
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

  function runEvent(event, points) {
    sound.play(event === "boss-save" ? "shield" : event);
    if (event === "boss-save") feedback("已用掉本场容错", 1150);
    if (event === "section-clear" && !ranked && !run.practice && run.mode === "solo" && !save.current.lessons.includes(points)) {
      save.change(profile => { if (!profile.lessons.includes(points)) profile.lessons.push(points); });
    }
    if (event === "section-enter" && (ranked || run.mode === "race" || save.current.lessons.includes(points))) feedback(points === "river" ? "起跳接藤 · 变道再跳" : "矿车 · 变道选轨", 2100);
    if (["skill", "chain", "ride-clear", "boss-strike"].includes(event) && Number.isFinite(points)) feedback(`+${points} 分`, 830);
    if (["fossil", "chain", "ride", "ride-clear", "boss-orb"].includes(event)) {
      for (let i = 0; i < (event === "chain" ? 18 : 7); i++) {
        particles.push({
          x: run.x, y: run.y + 0.8, z: -0.21,
          vx: (Math.random() - 0.5) * 4, vy: 1 + Math.random() * 2,
          life: 0.34 + Math.random() * 0.28, size: 0.09 + Math.random() * 0.045, color: i % 2 ? "#bcab77" : "#ece4bc",
        });
      }
    }
  }

  function applyInput(move) {
    if (mode === "menu" || paused || !run || run.done || dialog.open && panel !== "leave") return;
    if (startAt && (mode === "race" ? client.time() : performance.now()) < startAt) return;
    sound.unlock();
    if (waitingForRankProof() || ranked && (ranked.moves.length >= MAX_MOVES * 2 || ranked.lastInput === ranked.ticks && ranked.sameTick >= MOVES_PER_TICK)) return;
    const moved = control(run, move, runEvent);
    if (ranked && moved) {
      ranked.sameTick = ranked.lastInput === ranked.ticks ? ranked.sameTick + 1 : 1;
      ranked.lastInput = ranked.ticks;
      ranked.moves.push(ranked.ticks, RANK_MOVES.indexOf(move));
    }
    if (moved) sound.play(move === "left" || move === "right" ? "lane" : move);
  }

  function buildGuide() {
    for (const [index, boss] of BOSSES.entries()) {
      const li = document.createElement("li");
      const copy = document.createElement("div");
      const title = document.createElement("strong");
      const button = document.createElement("button");
      title.textContent = boss.name;
      button.type = "button";
      button.className = "button compact";
      button.dataset.practice = String(index);
      button.textContent = "练习";
      button.setAttribute("aria-label", `练习挑战${boss.name}`);
      copy.append(title);
      li.append(stamp(boss.skin), copy, button);
      nodes["guide-bosses"].append(li);
    }
  }

  function buildPowerHud() {
    for (const [id, power] of Object.entries(POWERUPS)) {
      const chip = document.createElement("div");
      const legend = rewardIcon(id);
      const timer = document.createElement("span");
      chip.className = "power-chip";
      chip.title = power.name;
      chip.hidden = true;
      chip.append(legend, timer);
      powerChips.set(id, { chip, timer });
      nodes["active-powers"].append(chip);
    }
  }

  function updateChallengeHud() {
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
    show("boss-safety", !!state?.mercy);
    if (active) {
      const label = `${state.index}:${state.phase}:${state.hp}:${state.lanes.join(",")}:${state.weakLane}`;
      if (label === bossHudKey) return;
      bossHudKey = label;
      const boss = BOSSES[state.index];
      text("boss-name", boss.name);
      text("boss-count", `${state.hp} / ${boss.hp}`);
      nodes["boss-hud"].dataset.phase = state.phase;
      nodes["boss-health"].replaceChildren(...Array.from({ length: boss.hp }, (_, i) => {
        const segment = document.createElement("i");
        if (i < state.hp) segment.className = "active";
        return segment;
      }));
    } else {
      bossHudKey = "";
    }
    const biome = run.rules >= 3 ? biomeAt(run.seed, run.distance, run.rules, run.mode) : BIOMES[0];
    if (currentBiome === biome.id) return;
    currentBiome = biome.id;
    gameCanvas.parentElement.dataset.biome = biome.id;
    clearTimeout(biomeTimer);
    if (!run.practice) {
      text("biome-title", biome.name);
      show("biome-title", true);
      biomeTimer = setTimeout(() => show("biome-title", false), 1420);
    }
  }

  function updateHud() {
    const distance = Math.max(0, Math.floor(run.distance - (run.practice ? run.practiceOrigin ?? BOSSES[practiceIndex].distance : 0)));
    const points = runScore(run);
    if (distance !== score.distance) text("run-distance", digits(distance, 4));
    if (run.fossils !== score.fossils) text("run-fossils", digits(run.fossils));
    if (points !== score.points) text("run-score", digits(points));
    updateChallengeHud();
    score = { distance, fossils: run.fossils, points };
  }

  function animate(now) {
    const quiet = document.hidden || run?.done || run?.death;
    const theme = quiet ? null : mode === "menu" || panel === "settings" ? "menu" : paused ? null
      : run?.boss ? "boss" : run && run.rules >= 3 ? biomeAt(run.seed, run.distance, run.rules, run.mode).id : "wild";
    sound.update(theme);
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
          text("count-message", "");
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

      const lesson = !ranked && !paused && !startAt ? sectionLesson(run, save.current.lessons) : "";
      show("lesson-hud", !!lesson);
      if (lesson) text("lesson-hud", lesson);
      if (!paused && !startAt && !run.done) {
        if (ranked) advanceRanked(dt, now);
        else for (let remaining = lesson ? dt * 0.48 : dt; remaining > 0.0001 && !run.done;) {
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
      if (!ranked && !paused && mode === "solo" && !run.done && !run.practice && now - lastSaved > 1050) snapshotSolo();
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
    const tab = event.target.closest("[data-board]");
    if (tab && tab.dataset.board !== boardKind && panel === "rank") {
      boardKind = tab.dataset.board;
      void refreshBoard();
      return;
    }
    const purchase = event.target.closest("[data-buy-boost]");
    if (purchase) { void buyBoost(purchase.dataset.buyBoost); return; }
    const boost = event.target.closest("[data-boost]");
    if (boost) { void selectBoost(boost.dataset.boost); return; }
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
  for (const key of ["music", "effects"]) {
    const toggle = nodes[`${key}-enabled`];
    const volume = nodes[`${key}-volume`];
    const volumeKey = `${key}Volume`;
    on(toggle, "change", () => {
      save.change(profile => { profile.audio[key] = toggle.checked; });
      sound.configure(save.current.audio);
      sound.unlock();
      if (key === "effects" && toggle.checked) sound.play("fossil");
    });
    on(volume, "input", () => {
      sound.configure({ ...save.current.audio, [volumeKey]: Number(volume.value) });
      text(`${key}-percent`, `${volume.value}%`);
    });
    on(volume, "change", () => {
      save.change(profile => { profile.audio[volumeKey] = Number(volume.value); });
      sound.configure(save.current.audio);
      sound.unlock();
      if (key === "effects") sound.play("fossil");
    });
  }
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
  on(window, "online", () => { client.nudge(); queueCloudSnapshot(); void retryRankUploads(); });
  on(window, "offline", () => { if (client.session) client.setLink("reconnecting"); });
  on(document, "visibilitychange", () => {
    if (document.hidden) sound.update(null);
    if (document.hidden && mode === "solo" && !paused && !run?.done) pauseSolo();
    if (document.hidden && mode === "race") snapshotRace();
    if (!document.hidden) {
      client.nudge();
      queueCloudSnapshot();
      void retryRankUploads();
    }
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
    if (panel === "shop") renderShop();
    if (panel === "settings") renderAudioSettings();
  });

  on(nodes["account-form"], "submit", saveNickname);
  on(nodes["rank-appeal-form"], "submit", submitAppeal);
  buildGuide();
  buildPowerHud();
  updateMenu();
  void retryRankUploads();
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
    humanCheck.hide();
    appealCheck.hide();
    hero.dispose();
    scene?.dispose();
    closet?.dispose();
    clearTimeout(toastTimer);
    clearTimeout(cloudTimer);
    clearTimeout(rankRetryTimer);
    clearTimeout(feedbackTimer);
    clearTimeout(biomeTimer);
    drawFinish?.();
    cancelAnimationFrame(raf);
  };
}
