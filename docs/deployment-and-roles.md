# 部署与只读账号运维笔记

> 本文记录 Pi Web 的部署方式、运维陷阱和只读账号机制的完整设计，供后续维护时查阅。

## 一、部署架构

- **公网入口**：`https://pi.dongzhi.dpdns.org`（Cloudflare Tunnel named mode，固定域名）
- **本地服务**：`http://localhost:30141`
- **两个 systemd 用户级服务**（`~/.config/systemd/user/`）：
  - `pi-web.service`：主服务，`ExecStart=/home/h/.npm-dlabal/bin/pi-web --no-open`
  - `cloudflared-pi-web.service`：隧道，`ExecStart=/home/h/.local/bin/cloudflared tunnel --config /home/h/pi-web/.cloudflare-tunnel/pi-web.yml run pi-web`
- 两者都是 `enabled`，开机自动启动（用户登录后；如需不登录也运行需 `sudo loginctl enable-linger h`）
- 隧道日志：`journalctl --user -u cloudflared-pi-web`

### 改代码如何生效（重要）

`@agegr/pi-web` npm 包是**软链**到 `/home/h/pi-web` 的，但服务用 `next start` 跑 `.next/` 构建产物：

```bash
cd /home/h/pi-web
npm run build          # 必须重新 build，改的代码才会进产物
systemctl --user kill -s KILL pi-web   # 见下方陷阱，restart 会卡死
systemctl --user reset-failed pi-web
systemctl --user start pi-web
```

注意：AGENTS.md 说开发时别跑 `npm run build`（会污染 `.next/` 影响 `npm run dev`）。只在服务处于 production 模式且 dev server 未运行时 build。

### 运维陷阱：restart 卡在 deactivating

`systemctl --user restart pi-web` 经常卡在 `deactivating (final-sigterm)`，node 进程不响应 SIGTERM。**必须用 KILL**：

```bash
systemctl --user kill -s KILL pi-web
systemctl --user reset-failed pi-web
systemctl --user start pi-web
```

隧道同理（重启 pi-web 后隧道会短暂 502，重启 cloudflared-pi-web 即可恢复）。

## 二、只读账号（readonly role）

### 机制总览

- **认证**：登录 cookie payload 带 `role: "admin" | "readonly"`。升级前的旧 cookie 没有 role 字段，`cookieRole()` 视为 admin（兼容）。
- **两种密码**：
  - 管理员：`~/.pi/agent/pi-web-password.json`（scrypt）或 `PI_WEB_PASSWORD`
  - 只读：`PI_WEB_READONLY_PASSWORD` 环境变量（当前在 systemd 配置里）或 `~/.pi/agent/pi-web-readonly-password.json`
- **登录**：`POST /api/web-auth/login`，body `{ password, mode: "admin" | "readonly" }`，响应 `{ ok, role }` 并种带角色的 cookie。
- **查询角色**：`GET /api/web-auth/me` → `{ role, readonlyConfigured }`

### 安全边界在服务端（关键设计）

真正拦住只读账号的是 `proxy.ts` 中间件：**readonly 角色的一切非 GET/HEAD 的 `/api/*` 请求直接 403**（`/api/web-auth/logout` 除外）。这覆盖了发消息、终端输入、fork、compact、delete、新建会话、改配置等所有写操作——因为终端输入也走 `POST /api/agent/[id]` 的 prompt/custom 命令。

前端隐藏控件**只是体验层**，即使被绕过，服务端也会拦。localStorage 的 `pi-web-role` 被篡改不影响安全。

### 前端隐藏（体验层）

- `hooks/useRole.tsx`：`RoleProvider` 从 localStorage 读 `pi-web-role`（登录页写入），提供 `useRole()`
- 隐藏清单：
  - `ChatInput`：readonly 时整个输入栏替换为"🔒 只读模式"提示条
  - `ChatWindow`：fork 按钮、onEditContent、扩展面板（终端）全部禁用/不渲染
  - `AppShell`：BranchNavigator、system prompt 按钮、底部 models/skills/plugins 配置按钮、onNewSession/onSessionDeleted 回调
  - `SessionSidebar`：新建按钮禁用、hover 改名/删除按钮隐藏（`canWrite` prop 透传）

### 只读密码

当前值：`piread`（配置在 `~/.config/systemd/user/pi-web.service` 的 `PI_WEB_READONLY_PASSWORD`）。改密码后需 `daemon-reload` + 重启。注意：密码简单易被猜到，只读账号虽无写权限，但能看到全部聊天记录和文件，敏感环境请用强密码。

## 三、微信访问提示"请在浏览器中打开"

- **原因**：`dongzhi.dpdns.org` 没有 ICP 备案（境外服务器/Cloudflare），微信内置浏览器对未备案的个人域名一律拦截提示。`*.trycloudflare.com` 是 Cloudflare 官方域名，虽也未备案但属于知名境外域名，微信放行。
- **对策**：
  - 微信内分享用 quick tunnel 临时链接（`python3 /home/h/.pi/agent/skills/cloudflare-tunnel/scripts/tunnel_helper.py quick --url http://localhost:30141`），缺点是重启会变、关机失效
  - 固定域名只能引导用户"在浏览器打开"
  - 备案需国内服务器 + 实名 + 数周审核，个人项目不划算
