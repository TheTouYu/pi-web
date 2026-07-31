# 交接文档：其他项目运行会话快速切换

> 2026-07-31 · 本轮已完成实现并部署，下一轮做交互优化（见文末"下一轮任务"）。

## 背景

- 上一需求：终端启动 agent 后，网页端能看到流式输出（Live Integration，见 `docs/live-integration.md`）。
- 本需求：网页端打开项目 A 时，终端同时运行着其他项目（B、C…）的 agent，网页端要能监听到，并出现一个小框，点击快速切换到对应对话。此前要查看其他项目的流式输出必须新开页面或先切项目再切对话，操作繁琐。

## 实现方案

### 数据流

```
终端 agent (Live Hub) ─┐
                       ├─▶ /api/agent/running/events (SSE) ─▶ SessionSidebar ─▶ 悬浮框
Web 启动的会话 (registry) ┘        running: [{id, cwd}]              │ (createPortal 到 body)
                                                                     └─▶ 点击 → handleSelectSessionFromList → 切项目+切会话
```

### 服务端

| 文件 | 改动 |
|---|---|
| `lib/rpc-manager.ts` | 新增 `getRunningRpcSessions(): {id, cwd}[]`（registry 内运行中会话）；`getRunningRpcSessionIds()` 改为基于它 |
| `app/api/agent/running/events/route.ts` | SSE 载荷从 `{type, runningSessionIds}` 扩展为 `{type, runningSessionIds, running: [{id, cwd}]}`。终端观察会话的 cwd 通过 `getObservedSession(id)` 取 hub 快照（Promise.all 并发，失败则该项不带 cwd）。`encodeRunning` 变 async，用 `generation` 计数器防异步竞态（慢的旧调用不得覆盖新快照）。**向后兼容**：`runningSessionIds` 字段保留，旧客户端不受影响 |

### 客户端（`components/SessionSidebar.tsx`）

- 新增 state `runningCwdById: Map<id, cwd>`，SSE onmessage 时同步更新。
- `otherProjectRunning: SessionInfo[]`（useMemo）：
  - 排除当前正在查看的会话（`selectedSessionId`）；
  - 会话项目 root = `allSessions` 匹配项 `projectRoot ?? cwd`，找不到（终端新会话文件未落盘）时回退 SSE 的 cwd；
  - root 与当前项目 root（`projectRootFor(selectedCwd)`）相同 → 跳过（树里已可见）；不同 → 进列表；
  - cwd 完全未知 → 跳过。
- 悬浮框用 `createPortal(..., document.body)` 渲染（`position: fixed; right: 16; bottom: 88`）。**必须 portal**：移动端侧边栏关闭时容器带 `transform: translateX(-100%)`，fixed 子元素会跟着被移出屏幕。
- 框内容：脉冲圆点 + 标题"其他项目正在运行" + ✕（忽略）+ 每行（项目名 basename + 首条消息预览）。点击复用 `handleSelectSessionFromList`（与侧边栏树点击同一条路径：`setSelectedCwd(s.cwd)` + `onSelectSession(s)`）。
- ✕ 忽略后，仅当**新的**会话 id 出现时才重新弹出（`seenOtherIdsRef` 记录已见过的 id）。
- i18n：`lib/i18n/messages/en.ts`、`zh-CN.ts` 新增 `otherProjects.running` / `otherProjects.switch` / `otherProjects.dismiss`。

## 验证记录

- 临时 dev server（30149）+ headless Chrome（CDP）实测：
  - SSE 新格式正确：`running` 数组含 id+cwd（实测 portable-knowledge、pi-web 两个会话）。
  - 悬浮框正确显示其他项目会话（star-cube-nexus、portable-knowledge 都出现过）；切走后原项目会话会反过来出现在框里（动态重算正确）。
  - 点击后 Network 日志：`POST /api/agent/[id]` + `GET /api/agent/[id]/events` 均发出（observed 会话的流式连接已建立）。
- `tsc --noEmit`、`npm run lint` 通过。
- 已部署：仓库 `npm run build` → `.next` 覆盖全局 `/home/h/.npm-dlabal/lib/node_modules/@agegr/pi-web/.next` → 重启 `pi-web --no-open`（旧 `.next` 备份在 `/tmp/piweb-next-backup`，tmpfs 重启即失，回滚需重新 build）。仓库 `.next` 已删除，`npm run dev` 不受污染。

## 已知问题 / 用户反馈（下一轮任务）

### 1. 悬浮框位置要放进左侧边栏

用户倾向把框放到最左侧栏（与项目树合并），不要右下角浮动。注意：
- portal 渲染位置与视觉位置无关，改 `style` 即可（或干脆不 portal、直接渲染在侧边栏容器内——但移动端抽屉 `transform` 问题要重新考虑）。
- 侧边栏关闭时框应仍可见（或跟随侧边栏收起逻辑）。

### 2. 点击后只切了项目、没进会话（重要）

用户实测：点击框条目后项目切过去了，但对话没切到目标会话，看不到实时输出。

上一轮 CDP 实测的线索（当时误判为成功）：
- 点击后 `POST /api/agent/[id]`（两次）+ `GET /api/agent/[id]/events`（两次）都发出了，说明 ChatWindow 挂载并建立了 observed 流式连接；
- 但 chat 区 innerText 只有工具栏（"Full history / Generate title / Branches / System / π / Send / 模型选择…"），**没有任何消息内容**；
- URL 被重置为 `/`（`AppShell.handleCwdChange` 里跨项目切换时 `router.replace("/")`，与侧边栏树点击跨项目会话行为一致，属既有行为）。

建议排查方向：
- `hooks/useAgentSession.ts` 对 `runtime: "observed"` 的处理：`GET /api/agent/[id]` 返回的 `state` 来自 `AttachmentSnapshot.state`（`app/api/agent/[id]/route.ts`），确认其中 `messages` 的字段结构与正常加载路径是否一致（`normalizeToolCalls` 的坑见 AGENTS.md）。
- `AppShell.handleSelectSession` → `router.replace(?session=...)` 与 `handleCwdChange` 的 `router.replace("/")` 竞态：最终 URL 无 `session` 参数，若 ChatWindow 或 useAgentSession 依赖 URL 参数恢复，会被二次导航打断（`sessionKey` 已 bump，理论上不依赖 URL）。
- 侧边栏点击同项目会话正常、跨项目点击异常 → 对比两条路径差异（`selectedCwd` 先切换、worktree fetch 触发、`handleCwdChange` 的 `suppressCwdBumpRef` 逻辑）。

## 相关既有行为备忘

- 切换项目时 URL 会被清为 `/`（`handleCwdChange`），刷新页面会丢当前会话——既有行为，非本需求引入。
- 悬浮框在 `selectedCwd` 为 null（首次加载未选定项目）时会把所有运行中会话都当"其他项目"显示，随后自动选定项目后收敛——短暂闪烁，可接受。
