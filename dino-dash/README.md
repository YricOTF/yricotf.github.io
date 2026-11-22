# DINO DASH · 像素荒原

[打开游戏](https://yricotf.github.io/dino-dash/)

- 方向键或 WASD 操作，空格也能跳跃。手机支持滑动和触屏按钮。
- 单人跑酷每 3060 米换图。最高速度为 34 米/秒，因此每张地图至少要跑 90 秒。各场首领战前留出 54 米、战后留出 44 米空地。战斗中保留障碍，捡到攻击道具会自动投掷。
- 化石弧线按普通跳跃轨迹布置。滑铲、跳跃、走完整条奖励线、完成藤蔓或矿车路线和首领战都能额外得分。最高分与最远里程各自保存。
- 宝箱支持单开和十连。首抽免费，之后每抽消耗 120 枚化石。化石商店可购买六种开局增益，选中的一份会在下一次新开的单人跑酷消耗。
- 「设置」可分别开关背景音乐和游戏音效，也可单独调节音量。背景音乐在首次操作后播放，随地图与首领战切换。
- 纪录、化石、检查点和装扮保存在浏览器中，可在「存档」导入或导出。
- GitHub Pages 版支持 2–4 人凭房间码进行 650 米竞速。新版每局使用同一地图，地图由房间种子选定。房主需要保持页面打开。

## Supabase 排行榜

启用后，首次加入须通过 Cloudflare Turnstile 真人验证，再创建本设备的匿名玩家账号。清除浏览器数据会失去该账号的登录状态。排位采用服务器签发的种子和固定时间步，长局会定期提交操作摘要。结束后 Edge Function 对比在线摘要并重放操作，重新计算分数、里程和本轮化石。榜单展示前 50 名，每人一条最佳成绩。普通单人、历史本地存档和多人竞速不写入排位榜。

玩家加入后，化石、万能碎片、专属碎片、开局增益和本地纪录会记录为私有快照。管理者可以在 SQL Editor 查询 `dino_private.resource_reconciliation`，对比最近一次上报和已校验的排位收入。快照来源是浏览器，本地钱包仍由游戏存档管理。

在目标 Supabase 项目中启用 Data API、匿名登录和 Auth 的 CAPTCHA Protection，提供程序设为 Turnstile。创建允许 `yricotf.github.io` 的免费 Turnstile 站点，将其 Secret key 仅填入 Supabase Auth。应用 `supabase/migrations/20261122000000_dino_rank.sql`，然后在 `dino-dash` 目录部署校验函数。

```sh
node supabase/build.mjs
supabase functions deploy dino-rank --use-api --project-ref YOUR_PROJECT_REF
```

在 `game/cloud-config.js` 填写项目 URL、**publishable key**（也支持旧版 `anon` key）和 Turnstile 的公开 **Site key**，再部署站点。管理员密钥由 Edge Function 环境提供。未配置时排行榜会显示待开通，现有玩法可继续使用。

管理者可在 `dino_private.runs` 查看校验失败原因，并通过 `dino_private.blocked_players` 人工限制作弊账号。回放校验可以拦截伪造数值或替换历史操作，有效操作仍可能来自实时自动化。

## 游戏提示约定

局内优先用动作、音效和路线引导玩家。界面保留必要的按键与状态。首领、道具和障碍的细节留给玩家发现，陨石阴影只在临落地时出现。

## 独立房间服务器

若需要房主关闭页面后仍能保存房间及恢复席位，可运行同仓库内的服务器版。它使用原有的房间协议和 SQLite，无需安装依赖。

用 Node.js 22.13 或更新版本，在 `dino-dash` 目录运行：

```sh
node backend/server.mjs
```

打开 `http://localhost:8080`。联机玩家需访问同一个服务器地址。部署到云主机时保留 `data/` 目录，或用 `DINO_DASH_DB` 指定持久化 SQLite 路径。可用 `PORT` 和 `HOST` 设置监听地址。
