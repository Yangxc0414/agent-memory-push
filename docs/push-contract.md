# 推送契约：每个栏目如何更新、如何失败

这份文档回答三个问题：

1. 参考站 [Agent Memory Hot](https://agent-memory-hot.pale-rook-5118.chatgpt.site/) 的“推送”实际发生在哪里？
2. 本站每个栏目的触发、来源、产物、新鲜度和失败方式是什么？
3. 从 AIHOT 这样的服务端框架搬到 GitHub Pages，哪些能力保留、哪些必须降级？

## 一、参考站观察

观察时间：2026-10-22。结论来自页面脚本、公开接口和 RSS，不涉及任何私有后台。

### 1. 浏览器里没有 Push

页面没有：

- Service Worker 注册；
- `pushManager` / `Notification`；
- WebSocket / SSE；
- 轮询定时器。

页面脚本只做四类数据请求：

- `GET /api/items`
- `GET /api/projects`
- `GET /api/benchmarks`
- `GET /api/surveys`

外加一个手动“刷新列表”按钮。RSS 在 `/feed.xml`，全量导出在 `/api/export`。

### 2. 推送发生在服务端快照

服务端每天定时采集一批公开源（arXiv、Hugging Face Daily Papers、GitHub Releases、媒体 RSS），做归一化、去重、摘要审核、中文概括、分类和安全审核，然后写一份带时间戳的快照。页面、RSS、JSON 都读这份快照。

这意味着：

- “最新动态”“每日速览”“历史归档”“记忆安全”“主题地图”不是五个独立推送，而是同一份 items 的五个切片。
- “GitHub 项目”“Benchmark”“综述”有独立接口和独立时间戳，更新节奏与 items 不同。
- 读者侧的“推送”只有 RSS 和手动刷新；没有浏览器通知。

### 3. 它的新鲜度字段

| 字段 | 含义 |
| --- | --- |
| `checkedAt` | 本次快照时间 |
| `lastSuccessAt` | 上次成功采集时间 |
| `persistedAt` | 快照写入时间 |
| `sources[].lastCheckedAt` / `lastSuccessAt` / `status` / `error` | 每个源的检查结果 |
| `projects[].starsCheckedAt` | 星标快照时间 |
| `benchmarks.verifiedAt` | Benchmark 人工核对时间 |
| `surveys.checkedAt` | 综述引用核对时间 |

### 4. 值得学和不值得学

值得学：

- 失败可见：源状态直接展示，不隐藏错误；分页截断会标“需补查”。
- 时间口径分离：首次提交、正式公告、修订、新闻发布、星标快照各有各的时间。
- 栏目分层：即时条目与长期坐标分开，不把所有内容塞进一条时间流。

不值得照搬：

- 每次全量拉取、`no-store`，没有增量接口。
- 没有 ETag / 条件请求。
- 没有 Web Push，也没有离线能力。
- Benchmark 分数靠人工维护，页面不解释版本和基座模型差异。

## 二、本站的推送契约

本站把运行时换成 GitHub Actions，把数据库换成 JSON 文件。每个栏目必须能回答五个问题：

1. **触发**：什么时候运行？
2. **来源**：读什么？
3. **产物**：写出哪个文件？
4. **新鲜度**：读者看哪个时间字段？
5. **失败**：旧数据怎么办？

| 栏目 | 触发 | 来源 | 产物 | 新鲜度 | 失败时 |
| --- | --- | --- | --- | --- | --- |
| 今日推送 | Actions cron `10 0 * * *`，北京时间 08:10 | `src/data/items.json` | `src/data/digests/YYYY-MM-DD.json` | `generatedAt` / `checkedAt` | 保留上一期；页面按 36 小时判断 stale |
| 全部动态 | 随构建 | `src/data/items.json` | `dist/data/items.json` + `dist/api/v1/items.json` | `checkedAt` | 旧快照继续可读 |
| 记忆安全 | 采集时规则命中 + 编辑复核 | 条目的 `security.angles` / `note` | 条目字段 | 随条目 | 没有命中就不显示，不硬凑 |
| 主题地图 | 构建时汇总 | `taxonomy.json` + items | 计数、轨道图、维度说明 | `taxonomyVersion` | 分类非法则构建失败，不发布 |
| 项目 | 每日 / 每周一 | GitHub Releases Atom + GitHub Search API | `src/data/projects.json` | `starsCheckedAt` | 保留上次星数并标时间 |
| Benchmark | 人工核对 | 官方仓库 / 论文 | `src/data/benchmarks.json` | `checkedAt` | 不自动改分；保留上一定义 |
| 信源状态 | 每次采集 | 每个源的请求结果 | `src/data/sources.json` | `lastCheckedAt` / `lastSuccessAt` | 错误直接展示，保留上次成功时间 |
| RSS | 构建后 | items + digest | `dist/feed.xml` | `lastBuildDate` / `pubDate` | 订阅器继续读旧缓存 |
| JSON | 构建后 | items + digest | `dist/api/v1/*.json` | `generatedAt` | 静态 404，不影响页面 |
| 飞书 / Telegram | 成刊后 | `dist/api/v1/digest.json` | webhook 请求 | 按日期去重 | 3 次重试；失败只记日志 |
| ntfy | 成刊后 | `dist/api/v1/digest.json` | `NTFY_SERVER` JSON 消息 | 按日期去重 | 3 次重试；失败只记日志 |
| Web Push | 不支持 | 无服务端订阅存储 | — | — | 不提供假开关 |

### 1. 今日推送与真实采集

每次 `collect.mjs` 会拉取 9 个 arXiv 查询（泛检索、智能体记忆与自进化、具身、多模态、安全、记忆专用模型、评测、对话与个性化、综述）、HF Daily Papers、GitHub Releases 和 RSS；每次最多合并 36 条新内容，并且每个主主题最多 5 条，避免单一方向挤占其他方向。配置 `LLM_API_KEY` 时，Agnes 给新条目写 `titleZh` / `summaryZh` / `why`。`build.mjs` 再从当前 items 自动成刊，不存在“前端预写死条目”。

触发：

- GitHub Actions `schedule`（`10 0 * * *`，北京时间 08:10）。
- 手动 `workflow_dispatch`，可选择强制重新通知。

流程：

1. `collect.mjs` 拉取信源，写 `items.json` / `sources.json` / `meta.json`。
2. `build.mjs` 先找 `src/data/digests/<meta.date>.json`。
3. 找不到时，如果 `meta.seed` 为 true 且 `digest.json` 的日期匹配，就用种子期手工日报。
4. 否则自动成刊：在 24 小时窗口内按分数排序，每个主题最多 2 条，选 8 条重点，再按主题分栏。
5. 生成 `dist/data/digests/<date>.json` 和 `dist/api/v1/digest.json`。

失败：

- 采集全部失败时，`meta.checkedAt` 不更新，`meta.date` 不前进；构建继续使用上一份快照。
- 页面在 `checkedAt` 超过 36 小时时显示 `STALE`。
- 日报文件一旦写下，同一天重复构建不会覆盖；需要重做时手动删除该日文件。

### 2. 全部动态

同一份 items 的前端切片。筛选、搜索、排序全部在浏览器完成：

- 类型：论文 / 新闻 / 发布；
- 主题：9 个主题；
- 时间：全部 / 近 7 天 / 近 30 天 / 今天；
- 排序：最新在前 / 推送分；
- 关键词：标题、中文摘要、英文摘要、来源、标签。

没有分页接口；前端先显示 18 条，点击“加载更多”追加。数据量到几千条时，应改为构建时预分页或客户端索引，目前没有做。

### 3. 记忆安全

安全角度不是单独的采集源，而是条目上的标记：

- `attack`：攻击面 / 注入 / 投毒；
- `defense`：防御 / 隔离 / 权限；
- `privacy`：隐私 / 披露 / 泄漏；
- `provenance`：来源 / 审计 / 溯源；
- `evaluation`：安全评测。

采集时用关键词规则命中，编辑可以补充 `note`。没有命中的条目不进入安全页；不为了填满页面而硬凑。

### 4. 主题地图

- `taxonomy.json` 定义 9 个主主题和 5 个辅助维度。
- 条目可以有一个主主题和多个标签；跨领域内容不被强行塞进单一主题。
- 构建时计算每个主题的条目数，生成轨道图。
- 分类非法（未知 topic）会让构建失败，不发布半成品。

### 5. 项目与发布

- Releases 来自 GitHub Atom feed；项目索引来自 GitHub Search API。
- 星数是快照，不是热度结论；`starsCheckedAt` 必须展示。
- 基础设施项目（如向量数据库）会被标注“不是完整记忆框架”。
- GitHub API 失败时保留 `projects.json` 里的上次值，不把空数组写回去。

### 6. Benchmark

- 只做索引：名称、测什么、官方链接、覆盖维度。
- **不复刻分数**。榜单会变，基座模型和协议不同，跨表比较经常没有意义。
- `checkedAt` 表示定义核对时间，不是成绩时间。
- 更新方式：人工修改 `benchmarks.json`；没有自动抓榜。

### 7. 信源状态

- 每个源独立请求、独立超时、独立记录。
- `status`：`ok` / `error` / `planned`。
- `returned`：本次解析出的条目数；`scanned`：原始候选数（如果可得）。
- 失败时保留 `lastSuccessAt`，让读者知道上次成功是什么时候。
- 本地受限网络下 GitHub / Hugging Face 可能超时；本次本地为 10/15 正常，Actions 会重试并更新。

### 8. RSS、JSON、llms.txt

- RSS：RSS 2.0，`pubDate` 用原始发表时间；`guid` 用条目 id；描述包含中文摘要、推送理由、证据等级和本站链接。
- JSON：`api/v1/items.json`、`latest.json`、`digest.json`、`sources.json`、`projects.json`、`benchmarks.json`、`surveys.json`。
- `llms.txt`：给 Agent 的入口，说明数据位置、更新节奏、引用规则。
- 所有文件在构建时生成，GitHub Pages 只负责静态托管；没有按需 API、没有 ETag 逻辑（由 Pages 自己处理缓存）。

### 9. 飞书 / Telegram

- 触发：`build` 之后，`notify.mjs` 读取 `dist/api/v1/digest.json`。
- 飞书：自定义机器人 webhook，交互卡片 1.0，包含标题、日期、统计、6 条重点和“打开今日推送”按钮。
- Telegram：`sendMessage` HTML，5 条重点。
- 去重：`.state/notified.json` 按频道 + 日期记录；`--force` 可重发。
- 重试：3 次，指数退避；失败只记日志，不阻塞部署。
- 测试：`npm test` 启动本地 mock webhook，验证 payload 结构和去重，不访问外部服务。

### 10. ntfy（真实推送）

- 触发：`build` 之后，`notify.mjs` 读取 `dist/api/v1/digest.json`，向 `NTFY_SERVER`（默认 `https://ntfy.sh`）POST JSON。
- 字段：`topic`、`title`、`message`（日报摘要 + 6 条重点 + 站点链接）、`priority`、`tags`、`click`。
- 订阅：手机安装 ntfy app，或打开 `https://ntfy.sh/<topic>`；站点在构建时读取 `NTFY_TOPIC`，在 `#/pipeline` 显示订阅链接。
- 去重：`.state/notified.json` 按频道 + 日期记录；`--force` 可重发。
- 测试：`npm test` 同时验证飞书和 ntfy 的 payload 与去重，只连本地 mock，不向公网发送。
- topic 是公开地址，不是密码；用长随机串，避免被猜到。需要鉴权时换自建 ntfy 或改用飞书 / Telegram。

IndexNow 未实现：它需要 key 文件、部署后回调与提交记录，当前不提供假开关。

### 11. Web Push

不做。原因：

- GitHub Pages 没有服务端保存订阅；
- 没有地方安全地持有 VAPID 私钥并发送通知；
- 用 Service Worker 在本地“模拟通知”，用户关掉页面就失效，是假 Push。

替代：

- ntfy（推荐，真实手机/浏览器推送）；
- RSS；
- 飞书 / Telegram（Actions 发出）；
- GitHub Watch（数据提交时通知）；
- 页面打开时的快照巡检（发现新快照提示刷新，不自动改内容）。

## 三、从 AIHOT 借了什么

AIHOT 是服务端框架，本站是静态站；下面这些机制被保留或改写：

| AIHOT 机制 | 代码位置 | 本站对应 |
| --- | --- | --- |
| pg-boss cron、时区、missed-run | `apps/worker/src/schedules.ts` | GitHub Actions cron；没有补跑 |
| 日报规则成刊、周报月报汇编 | `packages/backend/src/reports/compose.ts` | `build.mjs` 的 `generateDigest()`；没有周报月报 |
| 多种 RSS | `packages/backend/src/publication/feeds.ts` | 单一 `feed.xml`，构建时生成 |
| JSON API + ETag | `apps/api/src/routes/v1.ts` | 静态 `api/v1/*.json`；缓存交给 Pages |
| 飞书卡片 + 去重 + 重试 | `packages/backend/src/notify/selected-content.ts` | `scripts/notify.mjs` |
| 外部内容推入 | `apps/api/src/routes/ingest.ts` | 无在线 ingest；用 JSON / PR 提交 |
| MCP | `apps/api/src/routes/mcp.ts` | 无；需要运行时，Pages 不提供 |
| llms.txt / sitemap / IndexNow | `publication/llms.ts`、`operations/indexnow.ts` | `llms.txt` / `sitemap.xml` 保留；IndexNow 未实现 |
| 热点、聚簇、故事页 | `events/hot.ts`、`jobs/events.ts` | 未实现；静态站不做实时热度 |

原则：**能在构建时算的，不在浏览器算；需要服务端的，明确降级，不做假开关。**

## 四、失败处理手册

| 情况 | 页面表现 | 处理 |
| --- | --- | --- |
| 单个源超时 | 信源表显示 `error` + 错误文本；其他源正常 | 等下次运行；必要时调大该源超时或换源 |
| 全部源失败 | 快照时间不前进；页面可能显示 stale | 检查网络 / API 限额；保留上一版 |
| 构建校验失败 | 工作流失败，Pages 保留上一版 | 看日志里的 ID / 日期 / topic 错误 |
| 通知失败 | 站点正常发布；Actions 日志有重试记录 | 检查 webhook / token；用 `--force` 重发 |
| 模型摘要失败 | 新条目保留英文摘要；`meta.llm.error` 记录 | 检查 LLM 密钥 / 配额；不影响发布 |
| 当天日报已存在 | 不会覆盖 | 删除 `src/data/digests/<date>.json` 后重新构建 |

## 五、验证清单

每次改动后至少跑：

```bash
npm run build
npm test
npm run serve
```

然后在浏览器里检查：

- 今日推送：hero、状态面板、8 个 picks、6 个分栏；
- 全部动态：类型 / 主题 / 时间 / 排序 / 搜索 / 加载更多；
- 记忆安全：生命周期、角度筛选；
- 主题地图：9 个主题、轨道图、综述；
- 项目 / Benchmark：分类、排序、外链；
- 信源与推送：12 行契约表、15 行源状态、6 个通道；
- 方法：参考站分析、AIHOT 对照、局限；
- 390px 与 1440px 无横向溢出；
- `feed.xml`、`api/v1/items.json`、`llms.txt` 可访问；
- 详情弹窗可打开、关闭、复制链接。
