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
- 重启坑：`kill` 主进程后，旧 `next-server` 子进程仍占着 30141，新实例会 `EADDRINUSE` 退出——先 `ss -tlnp | grep 30141` 清掉残留子进程再启动。
- 本轮（2026-08-01）：两项任务已完成并部署，用户实测通过；知识沉淀见 `AGENTS.md` "Other-project running quick-switch box" 一节。

## 下一轮任务（已完成，2026-08-01）

### 1. 悬浮框移入左侧边栏 ✅

- 去掉 `createPortal` 与 fixed 定位，改为直接渲染在会话列表容器顶部（项目树上方），随侧边栏收起逻辑隐藏（移动端抽屉 transform 问题自然消失）。
- 样式改为内联紧凑形式（无卡片边框/阴影）。

### 2. 跨项目点击后会话不加载 ✅（根因：竞态）

**根因**：点击框条目时 `handleSelectSessionFromList` 先 `setSelectedCwd(s.cwd)` 再 `onSelectSession(s)`（同一批次）。提交后侧边栏的 cwd-notify effect 触发 `onCwdChange` → `handleCwdChange`，发现项目变化，把刚选中的会话清掉（`setSelectedSession(null)` + `sessionKey+1` + `router.replace("/")`）——最终 URL 被重置、聊天区空。同项目点击不触发是因为 `handleCwdChange` 的同项目 early return。

**修复**（`components/AppShell.tsx` `handleSelectSession`）：跨项目选择时复用 `isRestore` 已有的 `suppressCwdBumpRef` 机制抑制这次 cwd 同步的清场动作，同时补上被抑制的 `handleCwdChange` 本该做的文件标签清理（`setFileTabs([])` 等）。URL 的 `?session=` 保留。

**验证**（dev server 30149 + headless Chrome CDP 实测）：
- 框出现在侧边栏内（static 定位，x=0）
- 点击 star-cube-nexus 条目：URL 保持 `?session=019fb7d7...`，消息区显示该会话内容，`/api/agent/[id]/events` SSE 连接建立
- 反向切回 pi-web 正常；框内容随当前项目动态重算
- `tsc --noEmit`、`npm run lint` 通过

**未做**：重新 build 部署到全局 `.next`（仓库改动仍在 dev 验证阶段，部署流程见上轮）。

## 相关既有行为备忘

- 切换项目时 URL 会被清为 `/`（`handleCwdChange`），刷新页面会丢当前会话——既有行为，非本需求引入。
- 悬浮框在 `selectedCwd` 为 null（首次加载未选定项目）时会把所有运行中会话都当"其他项目"显示，随后自动选定项目后收敛——短暂闪烁，可接受。
