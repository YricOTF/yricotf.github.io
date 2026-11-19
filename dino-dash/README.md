# DINO DASH · 像素荒原

[打开游戏](https://yricotf.github.io/dino-dash/)

- 方向键或 WASD 换道、跳跃和滑铲，空格也能跳跃。手机可用手势和屏幕按钮。
- 单人纪录、化石、检查点和六种装扮保存在浏览器中。可在「存档」导出或导入备份。
- GitHub Pages 版可用房间码邀请好友进行 2–4 人竞速。房主需要保持游戏页面打开。它会通过 WebRTC 或加密 WebSocket 中继连接，在网络恢复后自动重连。

## 独立房间服务器

若需要房主关闭页面后仍能保存房间及恢复席位，可运行同仓库内的服务器版。它使用原有的房间协议和 SQLite，无需安装依赖。

用 Node.js 22.13 或更新版本，在 `dino-dash` 目录运行：

```sh
node backend/server.mjs
```

打开 `http://localhost:8080`。联机玩家需访问同一个服务器地址。部署到云主机时保留 `data/` 目录，或用 `DINO_DASH_DB` 指定持久化 SQLite 路径。可用 `PORT` 和 `HOST` 设置监听地址。
