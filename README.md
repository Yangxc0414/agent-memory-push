# Agent Memory 推送

> 每天把智能体记忆领域值得看的新论文、新项目与新动态，推到你的眼前。不是信息流，是一份有取舍的每日记忆。

- 发布后地址：<https://yangxc0414.github.io/agent-memory-push/>（本地仓库尚未推送）
- 数据快照：见页面右下角或 `dist/data/meta.json`
- 订阅：`/feed.xml`（RSS）、`/api/v1/items.json`（JSON）、`/llms.txt`（Agent 入口）
- 更新：GitHub Actions，每天北京时间 **08:10**（`10 0 * * *`）

## 它是什么

一个纯静态的“每日推送”站：

- **页面**：今日推送、全部动态、记忆安全、主题地图、项目与发布、Benchmark、信源与推送、方法与反思。
- **数据**：论文 / 新闻 / 官方发布三类条目，带中文摘要、推送理由、证据等级、主题标签和安全角度。
- **推送**：RSS、JSON、飞书 / Telegram（可选）、GitHub Watch；没有 Web Push，也不假装有。
- **编辑**：所有内容先落成可以 diff、可以回滚的文件，再由 GitHub Pages 发布；读者打开页面不触发任何模型调用。

它不是实时系统，不是同行评审，不是投资建议，也不是安全认证。论文多为预印本；厂商自测与媒体报道单独标注证据等级。

## 推送是怎么发生的

```text
arXiv API / HF Daily Papers / GitHub Releases / RSS
                    │
        scripts/collect.mjs（Actions，每天 08:10）
                    │  归一化、去重、分类、评分
                    ▼
     src/data/items.json / sources.json / meta.json
                    │
        scripts/build.mjs（校验、成刊、构建）
                    │  HTML/CSS/JS + feed.xml + api/v1/*.json + llms.txt
                    ▼
              GitHub Pages
                    ├── 读者：页面筛选 / 搜索 / 详情
                    ├── 订阅器：RSS 轮询
                    ├── Agent：JSON / llms.txt
                    └── scripts/notify.mjs → 飞书 / Telegram（可选）
```

每个栏目都有一份“推送契约”：触发、来源、产物、新鲜度字段、失败方式。完整表格在页面 `#/pipeline`，这里给摘要：

| 栏目 | 触发 | 产物 | 新鲜度 | 失败时 |
| --- | --- | --- | --- | --- |
| 今日推送 | 每天 08:10 | `data/digests/YYYY-MM-DD.json` | `generatedAt` / `checkedAt` | 保留上一期，标 stale |
| 全部动态 | 随快照 | `data/items.json` | `checkedAt` | 旧快照继续可读 |
| 记忆安全 | 规则 + 编辑复核 | `security.angles` | 随条目 | 没有命中就不显示 |
| 主题地图 | 构建时汇总 | counts + orbit | `taxonomyVersion` | 构建失败不发布 |
| 项目 | 每日 / 每周 | `data/projects.json` | `starsCheckedAt` | 保留上次星数 |
| Benchmark | 人工核对 | `data/benchmarks.json` | `checkedAt` | 不自动改分 |
| 信源状态 | 每次采集 | `data/sources.json` | `lastCheckedAt` / `lastSuccessAt` | 错误直接展示 |
| RSS | 构建后 | `feed.xml` | `lastBuildDate` / `pubDate` | 旧缓存继续用 |
| 飞书 / Telegram | 成刊后 | 卡片 / 消息 | 按日期去重 | 重试 3 次，失败只记日志 |
| Web Push | 不支持 | — | — | 不提供假开关 |

## 对参考站的反思

参考站 [Agent Memory Hot](https://agent-memory-hot.pale-rook-5118.chatgpt.site/) 的“推送”不在浏览器里：

- 前端没有 Service Worker、`pushManager`、`Notification`，也没有轮询定时器；页面只 `fetch` 四个接口，加一个手动“刷新列表”。
- 真正的更新发生在服务端：每天定时采集一批公开源，去重、审核、写中文摘要、分类，生成一份带 `checkedAt` 的快照；页面、RSS、JSON 都读这份快照。
- “每日速览”“历史归档”“记忆安全”“主题地图”是同一份 items 的不同切片；项目、Benchmark、综述有各自的接口和时间戳。
- 它的优点是**失败可见**：源状态、分页截断、候选数与扫描数分开写；缺点是全量快照、`no-store`、无增量、无 Web Push。

本站保留了这个结构，但把运行时换成了构建产物：

| 能力 | 参考站 / AIHOT | 本站 |
| --- | --- | --- |
| 运行时 | Node / Fastify / Postgres / worker | 纯静态 + GitHub Actions |
| 采集 | 每分钟检查到期源 | 每天一次批量 |
| 成刊 | 数据库存 revisions | 按日期静态 JSON |
| RSS | 按请求生成，带 ETag | 构建时生成 |
| MCP | 匿名 Streamable HTTP | 无，不假装支持 |
| Web Push | 没有 | 没有；用 RSS + 飞书 / Telegram 替代 |

更完整的分析写在站点的 `#/method` 页面，以及 [docs/push-contract.md](docs/push-contract.md)。

## 本地运行

需要 Node.js ≥ 22（推荐 24）。没有数据库，没有 npm 依赖。

```bash
# 1. 探测信源，写 src/data/sources.json（不会合并条目）
npm run probe

# 2. 构建 dist/（校验数据、生成 RSS / JSON / llms.txt / sitemap）
npm run build

# 3. 本地预览（按 GitHub Pages 子路径 /agent-memory-push/ 提供）
npm run serve
# http://127.0.0.1:4173/agent-memory-push/
```

其他命令：

```bash
npm run collect          # 采集并合并新条目（可选配置 LLM 中文摘要）
npm run notify           # 按环境变量推送；没配置频道时只打印 skip
node scripts/notify.mjs --dry-run
npm test                 # 本地 mock webhook，验证飞书卡片结构与按日期去重
```

`npm run collect` 的行为：

- 对 arXiv、HF Daily Papers、GitHub Releases、RSS 做归一化与去重；同一篇论文按 arXiv ID 合并。
- 只保留同时涉及“记忆/情景/经验”和“智能体/LLM”的内容；官方 release 例外。
- 新条目默认保留英文摘要，`summaryZh` 为 `null`；配置 `LLM_API_KEY` 后会生成 1–2 句中文概括。
- 已有条目里人工写的 `summaryZh`、`why`、`tags`、`security` 不会被覆盖（`curated: true`）。
- 所有源状态写入 `src/data/sources.json`；失败保留上次成功时间，不隐藏错误。

## 部署到 GitHub Pages

推荐新建一个**独立仓库** `agent-memory-push`。这样 `.github/workflows/pages.yml` 可以直接运行，URL 就是 `https://yangxc0414.github.io/agent-memory-push/`。

1. 在 GitHub 新建仓库 `agent-memory-push`。
2. 把本目录推到该仓库的 `main`。
3. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
4. 打开 **Actions → Build and deploy Agent Memory 推送 → Run workflow**，或等每天的定时任务。
5. 站点地址：`https://yangxc0414.github.io/agent-memory-push/`。

不推荐把本目录放进现有的 `yangxc0414.github.io` 仓库：GitHub 只读取用户站根目录的 `.github/workflows/`，你还需要移动工作流并调整工作目录，容易和主页互相影响。

工作流 `.github/workflows/pages.yml` 做这些事：

- `schedule` / `workflow_dispatch` 时运行 `collect`，然后 `build`、`notify`，把数据变更提交回仓库，再部署 `dist/`。
- `push` 时只 `build` + 部署，不采集、不通知（避免每次改样式都发一条群消息）。
- 采集步骤 `continue-on-error: true`：某个源挂了不会阻止上一次的好数据继续发布。
- 提交数据使用 `GITHUB_TOKEN`，不会再触发一轮工作流。

## 可选配置（GitHub Secrets）

在 **Settings → Secrets and variables → Actions** 里添加；本地开发放在 `.env` 或直接导出环境变量。不要提交密钥。

| Secret | 作用 |
| --- | --- |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI 兼容接口，给新条目写中文摘要。不配置时保留英文摘要。 |
| `FEISHU_WEBHOOK` | 飞书自定义机器人 webhook；每天成刊后发一张卡片。 |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram 推送。 |
| `GITHUB_TOKEN` | Actions 自带；用于 GitHub Search API 的项目索引。 |

飞书卡片的结构和去重逻辑可以用 `npm test` 验证；测试只连本地 mock，不访问外部服务。

## 数据与编辑

```text
src/data/
  site.json         站点文案、时区、推送通道
  taxonomy.json     9 个主题 + 5 个辅助维度
  items.json        条目（种子 + 采集结果）
  digest.json       种子期的手工日报
  digests/          按日期冻结的日报（YYYY-MM-DD.json）
  sources.json      信源状态（collect 生成）
  projects.json     GitHub 项目快照
  benchmarks.json   Benchmark 索引（不含分数）
  surveys.json      综述坐标
  meta.json         快照时间、统计（collect 生成）
```

新增一条人工条目时，最少需要：

```json
{
  "id": "arxiv:2610.28093",
  "title": "ClawMMU: Protection-Coherent Virtual Memory for Stateful LLM Agents",
  "titleZh": "ClawMMU：给有状态智能体的记忆加上权限边界",
  "url": "https://arxiv.org/abs/2610.28093",
  "kind": "paper",
  "source": "arXiv",
  "sourceTier": "preprint",
  "published": "2026-10-20T12:09:53.000Z",
  "summary": "原文摘要或一句话英文概括。",
  "summaryZh": "1–2 句中文概括，只写原文支持的内容。",
  "why": "为什么推送。",
  "topics": ["mechanism", "security"],
  "tags": ["记忆机制与系统", "完整性与抗攻击"],
  "security": { "angles": ["defense", "provenance"], "note": "证据边界。" },
  "evidence": "预印本 · 原文可核验",
  "score": 94,
  "curated": true
}
```

注意：

- `kind` 只能是 `paper` / `news` / `release`；`topics` 必须在 `taxonomy.json` 里。
- `summaryZh` 不要写“首个/唯一/空白”这类无法证伪的话；厂商自测和媒体报道要降级。
- 日报是冻结的：同一天重复构建会复用 `src/data/digests/YYYY-MM-DD.json`；新的一天由 `build.mjs` 自动成刊。
- 种子期的 `digest.json` 已复制到 `digests/2026-10-22.json`，不会被后续采集覆盖。

## 已知限制

- **没有 Web Push**：GitHub Pages 没有服务端保存订阅或签名 VAPID。需要真 Push 时，得加 Cloudflare Worker、VPS，或直接用 AIHOT 本身。
- **没有实时性**：每天一次快照；arXiv 公告和 GitHub release 可能延迟一天。
- **没有全文**：只展示摘要和原文链接，不做全文转载。
- **没有个性化**：没有用户系统，也没有“只推我关心的主题”。
- **模型摘要需要密钥**：不配置 `LLM_API_KEY` 时，新条目保留英文摘要。
- **本地探针可能误报**：在受限网络里，GitHub / Hugging Face 可能超时；首次 Actions 运行后状态会更新。
- **Actions cron 不是精确时钟**：页面上的“下次推送”是计划时间，不是承诺。
- **种子数据不是全量索引**：37 条种子来自 2026-10-20/21 的公开论文、官方发布与报道，中文摘要经过编辑整理；不代表同行评审结论。

## 目录结构

```text
.
├── src/
│   ├── index.html          页面壳
│   ├── assets/             CSS / JS / 图标 / OG 图
│   └── data/               内容与状态
├── scripts/
│   ├── lib.mjs             解析、分类、评分、日期工具
│   ├── sources.mjs         信源定义
│   ├── collect.mjs         采集 / 探测
│   ├── build.mjs           校验、成刊、构建 dist
│   ├── notify.mjs          飞书 / Telegram
│   ├── test-notify.mjs     mock webhook 测试
│   └── serve.mjs           本地静态服务器
├── .github/workflows/pages.yml
├── docs/push-contract.md   每个栏目的推送契约与参考站分析
└── README.md
```

## 许可与致谢

- 代码：MIT，见 [LICENSE](LICENSE)。
- 站点结构参考 [AIHOT](https://github.com/KKKKhazix/AIHOT)（MIT）；版式与栏目设置参考 [Agent Memory Hot](https://agent-memory-hot.pale-rook-5118.chatgpt.site/)，但不使用它们的名字和 Logo。
- 数据来自公开论文、官方博客与 GitHub；原文版权归各来源所有。若你是来源方，希望更正或下架，请通过仓库 Issue 联系。
