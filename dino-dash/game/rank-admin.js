import { Cloud } from "./cloud.js?v=18";

const cloud = new Cloud();
const login = document.querySelector("#moderator-login");
const consoleView = document.querySelector("#moderator-console");
const status = document.querySelector("#moderator-status");
const filter = document.querySelector("#moderator-filter");
const list = document.querySelector("#moderator-rows");
const submit = login.querySelector("button");
let session = "";
let request = 0;

const rpc = (action, payload) => cloud.signed(`/rest/v1/rpc/dino_moderator_${action}`, payload);
const appealText = { pending: "待审核", approved: "已通过", rejected: "已驳回" };
const rejectionText = { checkpoint: "在线校验点不完整", replay: "重放校验失败", timing: "时限或计时校验失败" };
const time = value => new Date(value).toLocaleString("zh-CN", { hour12: false });

function reset() {
  request++;
  session = "";
  consoleView.hidden = true;
  login.hidden = false;
  list.replaceChildren();
}

async function load(message = "") {
  const current = ++request;
  const token = session;
  const data = filter.value;
  status.textContent = message || "正在读取记录…";
  try {
    const rows = await rpc("queue", { p_token: token, p_state: data });
    if (current !== request) return;
    list.replaceChildren(...rows.map(row => render(row, data)));
    status.textContent = message || (rows.length ? "" : "暂无记录。");
  } catch (error) {
    if (current !== request) return;
    if (error.status === 403 || error.status === 401) {
      reset();
      status.textContent = "审核会话已过期，请重新登录。";
    } else status.textContent = error.message || "暂时无法读取记录。";
  }
}

function render(row, view) {
  const item = document.createElement("li");
  const title = document.createElement("strong");
  const details = document.createElement("p");
  title.textContent = `${row.nick} · ${time(row.started_at)}`;
  const check = row.finished_at ? `${row.reviewed ? "人工复核入榜" : "已入榜"} · ${row.score} 分 · ${row.distance} 米 · ${row.fossils} 化石`
    : rejectionText[row.rejection] || "等待校验";
  details.textContent = [check, `${row.checkpoints} 个校验点`, row.last_tick == null ? "" : `最后校验 ${row.last_tick / 100} 秒`,
    row.version == null ? "" : `规则版本 ${row.version}`, appealText[row.status]].filter(Boolean).join(" · ");
  item.append(title, details);
  for (const [label, content] of [["申诉", row.message], ["审核意见", row.reply]]) {
    if (!content) continue;
    const paragraph = document.createElement("p");
    paragraph.textContent = `${label} · ${content}`;
    item.append(paragraph);
  }
  if (view !== "data" && row.status === "pending") {
    const form = document.createElement("form");
    const label = document.createElement("label");
    label.className = "rank-name";
    label.textContent = "审核意见";
    const reply = document.createElement("textarea");
    reply.rows = 2;
    reply.maxLength = 240;
    reply.required = true;
    label.append(reply);
    const controls = document.createElement("div");
    controls.className = "panel-actions";
    for (const [state, text] of [["approved", "通过申诉"], ["rejected", "驳回申诉"]]) {
      const button = document.createElement("button");
      button.type = "submit";
      button.value = state;
      button.className = "button compact";
      button.textContent = text;
      controls.append(button);
    }
    form.append(label, controls);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const decision = event.submitter?.value;
      if (!decision || !reply.value.trim()) return;
      const buttons = [...controls.querySelectorAll("button")];
      buttons.forEach(button => { button.disabled = true; });
      try {
        await rpc("review", { p_token: session, p_id: row.run, p_decision: decision, p_reply: reply.value.trim() });
        await load(`申诉${appealText[decision]}。`);
      } catch (error) {
        if (error.status === 401 || error.status === 403) reset();
        status.textContent = error.status === 409 ? "该申诉已处理，请刷新。" : error.message || "暂时无法保存审核。";
      } finally {
        buttons.forEach(button => { button.disabled = false; });
      }
    });
    item.append(form);
  }
  return item;
}

login.addEventListener("submit", async event => {
  event.preventDefault();
  if (submit.disabled) return;
  const password = login.elements.password;
  submit.disabled = true;
  try {
    session = await rpc("login", { p_password: password.value });
    if (!session) {
      status.textContent = "审核密码错误。";
      return;
    }
    login.hidden = true;
    consoleView.hidden = false;
    await load();
  } catch (error) {
    status.textContent = error.status === 503 ? "审核密码尚未配置。" : error.message || "暂时无法登录。";
  } finally {
    password.value = "";
    submit.disabled = false;
  }
});

if (!cloud.joined) {
  status.textContent = "请先在游戏的「账户」登录，再打开审核页。";
  submit.disabled = true;
}
filter.addEventListener("change", () => void load());
document.querySelector("#moderator-refresh").addEventListener("click", () => void load());
document.querySelector("#moderator-logout").addEventListener("click", () => {
  const token = session;
  reset();
  status.textContent = "";
  void rpc("logout", { p_token: token }).catch(() => {});
});
