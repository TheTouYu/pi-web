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
  - `AppShell` 侧边栏底部有「切换账号」按钮（所有角色可见）：调 `POST /api/web-auth/logout` 清 cookie + 清 localStorage 的 `pi-web-role`，跳回登录页重新选身份

### 只读密码

配置在 `~/.config/systemd/user/pi-web.service` 的 `PI_WEB_READONLY_PASSWORD` 环境变量（或 `~/.pi/agent/pi-web-readonly-password.json` 文件）。改密码后需 `daemon-reload` + 重启。注意：密码简单易被猜到，只读账号虽无写权限，但能看到全部聊天记录和文件，敏感环境请用强密码。

## 三、微信访问提示"请在浏览器中打开"

- **原因**：`dongzhi.dpdns.org` 没有 ICP 备案（境外服务器/Cloudflare），微信内置浏览器对未备案的个人域名一律拦截提示。`*.trycloudflare.com` 是 Cloudflare 官方域名，虽也未备案但属于知名境外域名，微信放行。
- **对策**：
  - 微信内分享用 quick tunnel 临时链接（`python3 /home/h/.pi/agent/skills/cloudflare-tunnel/scripts/tunnel_helper.py quick --url http://localhost:30141`），缺点是重启会变、关机失效
  - 固定域名只能引导用户"在浏览器打开"
  - 备案需国内服务器 + 实名 + 数周审核，个人项目不划算

## 四、移动端实时性（手机浏览器看 observed 会话慢几十秒）

**现象**：终端已跑完，手机网页端还显示"正在思考..."，几十秒后突然全部出现并结束。

**原因**：不是服务端慢，也不是程序 bug——服务端链路（pi → companion → hub → SSE）逐事件实时转发，实测本地 1-11ms、公网 190-800ms。真正原因是**移动网络（运营商代理/浏览器）对 SSE 长连接的数据缓冲**：事件积压后批量 flush，网页端"突然全部加载"。桌面浏览器还可能叠加后台标签页节流。

**已做的优化**（`hooks/useAgentSession.ts` + `app/api/agent/[id]/route.ts`）：
- observed 会话的 `GET /api/agent/[id]` 现在返回 `liveMessages`（hub 快照里的进行中消息）
- 网页端 reconcile 轮询（observed 模式 5 秒 / web 模式 15 秒）用幂等合并（`mergeObservedMessages`，按 role+文本前缀/toolCallId 匹配尾部消息）把快照消息并入列表，SSE 停滞超 3 秒时才覆盖 streaming bubble（避免回退）
- 短连接 GET 不会被代理缓冲，所以轮询成了移动端的实际同步主路径；SSE 正常时轮询只是无害兜底

**局限**：轮询最多 5 秒一跳，看逐字输出仍不如终端流畅；要根治需换 WebSocket（改动大，暂未做）。

## 五、会话切换卡顿排查与优化（2026-08）

**现象**：网页端切换会话要等 4~5 秒才显示聊天记录。

### 排查结论（用数据定位）

切换链路是 `AppShell.handleSelectSession → ChatWindow 重挂 → loadSession → GET /api/sessions/[id] → lib/session-reader.ts 读 .jsonl`。用 curl + headless Chrome 实测：

- **API 层不是瓶颈**：最大的会话（397 条 UI 消息、58 万字符、866KB JSON）`GET /api/sessions/[id]` 只要 50~170ms；`GET /state` 12~19ms。
- **瓶颈在浏览器端渲染**：整页加载该会话时主线程 longtask 合计 **1553ms**；其中**代码块高亮是大头**——大会话有 220 个代码块，每个都用 `react-syntax-highlighter`（Prism）渲染，还开了 `showLineNumbers`。微基准：220 个小代码块 `SyntaxHighlighter`+行号 **760ms**、无行号 421ms、纯 `<pre>` 仅 2ms。

### 优化点（已上线）

1. **代码块高亮轻量化**（`components/MermaidBlock.tsx` + 新增 `lib/syntax-highlight.ts` + `app/globals.css`）：
   - 弃用 `react-syntax-highlighter`（它加载 `refractor/all` 全语言集 + 每 token 建 React 元素 + 行号 DOM，inline style 使 HTML 膨胀到 663KB/220 块）
   - 直接用底层 `refractor` 高亮，手写 hast→HTML（~20 行），`dangerouslySetInnerHTML` 渲染，React 每块只建 1 个元素
   - 高亮结果按 `lang+code` 缓存（上限 1000 条，超了整体清空）——来回切换同一会话时零重算
   - token 颜色改为 CSS class（亮/暗两套，跟随 `html.dark`），不再用 inline style；**行号去掉**（其成本占原渲染近一半）
2. **`GET /api/sessions/[id]` 响应缓存**（`app/api/sessions/[id]/route.ts`）：按 `文件路径+defer 参数` 键控、`mtime+size` 校验，命中时完全跳过 .jsonl 解析与构建（含 tree 投影、context 转换、JSON 序列化）。实测 50~170ms → **8ms**。上限 200 条整体清空。注意：缓存命中依赖文件 mtime/size 不变，agent 写会话文件后自动失效。

### 复测数据（headless Chrome longtask 合计）

| 场景 | 优化前 | 优化后 |
|---|---|---|
| 整页加载 397 消息大会话 | 1553ms | 814~930ms |
| 点击切换（内容首现） | 689ms | 182ms |
| 点击切换（内容稳定） | 2.2s | 1.44s |
| 大会话 API 读取 | 50~170ms | 8ms（缓存命中） |

### 第二轮优化：会话实例保留 + 首屏增量渲染（2026-08）

两个体验优化：**切回已看过的会话不再重新渲染**、**首次打开先渲染最近一小部分，上滚增量加载**。

1. **多会话实例保留**（`components/AppShell.tsx`）：切换会话不再 `sessionKey+1` 重挂 ChatWindow，改为保留最近 3 个会话实例（LRU，超出卸载最久未访问的），非活跃实例 `display:none` 但 DOM/状态不卸载——切回时原样显示（消息 DOM 节点是同一批，滚动位置、折叠状态都在）。
   - `ChatWindow`/`useAgentSession` 新增 `active` prop：非活跃实例断开 SSE、停 reconcile 轮询；恢复活跃时重新 `loadSession` + 按需重连。
   - **指纹跳过重渲染**（`hooks/useAgentSession.ts`）：`loadSession` 用 `leafId + 消息数 + entryIds` 做指纹，与已渲染数据一致时跳过全部 setState（memo 全命中，零重渲染）；数据变了才更新。
   - 切回时**不闪 loading**：已有数据时 `showLoading=false`（否则 spinner 会卸载消息 DOM 强制重渲染）。
   - 跨项目切换（handleCwdChange）、项目信任通过、插件重载时清空保留实例（这些场景需要干净重挂）。新会话（New）与 fork 仍走 fallback 单实例路径（key=sessionKey），不受影响。
2. **首屏增量渲染**（`lib/chat-lazy-load.ts`）：初始可见窗口从 50 条降到 **20 条**（`INITIAL_VISIBLE_COUNT`），向上滚动到顶触发 sentinel 每次再加载 50 条（原有机制）。首屏 longtask 从 ~800ms 降到 ~590ms（含页面水合）。

**实测**：切回已加载会话 = 0 重渲染（longtask 仅 ~50ms，消息 DOM 节点引用不变）；首屏 20 条渲染后上滚增量加载正常（代码块 52 → 136）。

### 遗留项

- 剩余渲染时间主要花在 react-markdown 解析（58 万字符）+ 页面水合，暂未动；若后续仍嫌慢，方向是可见窗口调小（`VISIBLE_PAGE_SIZE`）或代码块懒高亮（IntersectionObserver）。
- 若用户在意行号，可在 `lib/syntax-highlight.ts` 里用 CSS `counter` 给行号（成本远低于现方案）。
- `components/FileViewer.tsx` 仍用 `react-syntax-highlighter`（一次只渲染一个文件，不是切换会话热点），保持不动。
