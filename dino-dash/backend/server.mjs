import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { roomAction } from "./rooms.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const filename = process.env.DINO_DASH_DB || resolve(root, "data/dino-dash.sqlite");
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";

if (filename !== ":memory:") await mkdir(dirname(filename), { recursive: true });
const sql = new DatabaseSync(filename);
sql.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 4000;");
if (sql.prepare("PRAGMA user_version").get().user_version < 2) {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  sql.exec("BEGIN IMMEDIATE");
  try {
    const version = sql.prepare("PRAGMA user_version").get().user_version;
    if (version === 0) sql.exec(schema);
    if (version === 1) sql.exec("ALTER TABLE race_rooms ADD COLUMN rules INTEGER NOT NULL DEFAULT 1");
    if (version < 2) sql.exec("PRAGMA user_version = 2");
    sql.exec("COMMIT");
  } catch (error) {
    sql.exec("ROLLBACK");
    throw error;
  }
}

const database = {
  prepare(statement) {
    const prepared = sql.prepare(statement);
    return {
      bind(...parameters) {
        return {
          first: () => prepared.get(...parameters),
          execute: () => /^\s*SELECT/i.test(statement)
            ? { results: prepared.all(...parameters), meta: {} }
            : { results: [], meta: prepared.run(...parameters) },
        };
      },
    };
  },
  async batch(commands) {
    sql.exec("BEGIN IMMEDIATE");
    try {
      const result = commands.map(command => command.execute());
      sql.exec("COMMIT");
      return result;
    } catch (error) {
      sql.exec("ROLLBACK");
      throw error;
    }
  },
};

const mime = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".ttf": "font/ttf",
};
const indexPage = (await readFile(resolve(root, "index.html"), "utf8"))
  .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-room-backend="server">');
const assets = /^\/(?:game\/[a-z-]+\.js|vendor\/peerjs\.min\.js|icons\/[a-z-]+\.png|game\.css|dash-pixel\.ttf|dino\.png)$/;

function reply(response, status, mimeType, data, head = false) {
  response.writeHead(status, {
    "Content-Type": mimeType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  });
  response.end(head ? undefined : data);
}

const json = (response, status, data) => reply(response, status, "application/json; charset=utf-8", JSON.stringify(data));

async function handle(request, response) {
  const path = new URL(request.url, "http://localhost").pathname;
  if (path === "/api/room" && request.method === "POST") {
    let input = "";
    let incoming;
    try {
      request.setEncoding("utf8");
      for await (const chunk of request) {
        input += chunk;
        if (input.length > 4096) return json(response, 413, { error: "房间请求过长。" });
      }
      incoming = JSON.parse(input);
    } catch {
      return json(response, 400, { error: "无法读取房间请求。" });
    }
    const result = await roomAction(database, incoming);
    return json(response, result.status, result.data);
  }
  if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "无效操作。" });
  const head = request.method === "HEAD";
  if (path === "/" || path === "/index.html") return reply(response, 200, mime[".html"], indexPage, head);
  if (assets.test(path)) {
    try {
      const data = await readFile(resolve(root, "." + path));
      return reply(response, 200, mime[extname(path)], data, head);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return reply(response, 404, "text/plain; charset=utf-8", "找不到这个页面。", head);
}

const server = createServer((request, response) => {
  handle(request, response).catch(error => {
    console.error(error.message);
    if (!response.headersSent) json(response, 503, { error: "房间服务暂时繁忙，请重试。" });
    else response.end();
  });
});
server.listen(port, host, () => console.log(`DINO DASH at http://${host}:${server.address().port}`));
