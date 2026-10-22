import fs from "node:fs";
import path from "node:path";
import {
  DATA,
  DIST,
  ROOT,
  SRC,
  copyDir,
  dayInZone,
  escapeXml,
  formatRssDate,
  loadEnvFile,
  readJson,
  readText,
  writeJson,
  writeText
} from "./lib.mjs";

loadEnvFile();

const site = readJson(path.join(DATA, "site.json"));
const meta = readJson(path.join(DATA, "meta.json"));
const items = readJson(path.join(DATA, "items.json"));
const sources = readJson(path.join(DATA, "sources.json"));
const projects = readJson(path.join(DATA, "projects.json"));
const benchmarks = readJson(path.join(DATA, "benchmarks.json"));
const surveys = readJson(path.join(DATA, "surveys.json"));
const taxonomy = readJson(path.join(DATA, "taxonomy.json"));
const seedDigest = readJson(path.join(DATA, "digest.json"));
let digest;
const builtAt = new Date().toISOString();
const baseUrl = site.url.endsWith("/") ? site.url : `${site.url}/`;

function fail(message) {
  throw new Error(message);
}

function validate() {
  const ids = new Set();
  for (const item of items) {
    if (!item.id) fail(`item missing id: ${item.title}`);
    if (ids.has(item.id)) fail(`duplicate item id: ${item.id}`);
    ids.add(item.id);
    if (!item.url) fail(`item missing url: ${item.id}`);
    if (!item.published || Number.isNaN(Date.parse(item.published)))
      fail(`item has invalid published date: ${item.id}`);
  }
  for (const pick of digest.picks || []) {
    if (!ids.has(pick.id)) fail(`digest pick not found: ${pick.id}`);
  }
  for (const section of digest.sections || []) {
    for (const id of section.itemIds || []) {
      if (!ids.has(id)) fail(`digest section "${section.title}" references missing item: ${id}`);
    }
  }
  const topicIds = new Set(taxonomy.topics.map((topic) => topic.id));
  for (const item of items) {
    for (const topic of item.topics || []) {
      if (!topicIds.has(topic)) fail(`unknown topic "${topic}" on ${item.id}`);
    }
  }
}

function statsFor(list) {
  const byKind = { paper: 0, news: 0, release: 0 };
  const byTopic = Object.fromEntries(taxonomy.topics.map((topic) => [topic.id, 0]));
  let security = 0;
  for (const item of list) {
    byKind[item.kind] = (byKind[item.kind] || 0) + 1;
    if (item.security) security += 1;
    for (const topic of item.topics || []) {
      if (byTopic[topic] !== undefined) byTopic[topic] += 1;
    }
  }
  const sorted = [...list].sort((a, b) => String(b.published).localeCompare(String(a.published)));
  return {
    items: list.length,
    papers: byKind.paper || 0,
    news: byKind.news || 0,
    releases: byKind.release || 0,
    security,
    byKind,
    byTopic,
    latestPublished: sorted[0]?.published || null,
    earliestPublished: sorted.at(-1)?.published || null
  };
}

function publicItem(item) {
  return {
    ...item,
    topicLabels: (item.topics || []).map(
      (topic) => taxonomy.topics.find((entry) => entry.id === topic)?.label || topic
    ),
    siteUrl: `${baseUrl}#/item/${encodeURIComponent(item.id)}`
  };
}

function groupForItem(item) {
  const topic = item.topics?.[0] || "adjacent";
  if (topic === "security") return "security";
  if (topic === "evaluation") return "evaluation";
  if (topic === "embodied" || topic === "multimodal") return "embodied";
  if (topic === "tools") return "tools";
  if (topic === "survey" || topic === "personal" || topic === "adjacent") return "context";
  return "mechanism";
}

const GROUPS = [
  ["mechanism", "机制：把控制权放回运行框架", "记忆不只是检索命中率，也是写入权限、状态边界和成本。"],
  ["security", "安全：攻击在会话结束后仍然存在", "从持久注入、隐私循环到来源与权限，安全沿记忆生命周期展开。"],
  ["evaluation", "评测：从问答正确率到任务闭环", "记住事实不等于完成任务；失败需要分阶段定位。"],
  ["embodied", "具身与多模态：记忆要能指导行动", "空间、事件、视频和工具证据进入记忆，检验的是下一步动作。"],
  ["tools", "工程：记忆成为有状态基础设施", "官方发布与产品更新，关注接入方式和运维边界。"],
  ["context", "坐标：综述、个性化与周边", "把今天的工作放回长期记忆的研究脉络里。"]
];

function generateDigest() {
  const to = new Date(meta.checkedAt || Date.now());
  const windows = [24, 48, 24 * 7];
  let hours = windows[0];
  let candidates = [];
  for (const candidateHours of windows) {
    hours = candidateHours;
    candidates = items.filter((item) => {
      const published = Date.parse(item.published);
      return (
        Number.isFinite(published) &&
        published <= to.getTime() &&
        published >= to.getTime() - candidateHours * 3600000
      );
    });
    if (candidates.length >= 8) break;
  }
  if (!candidates.length) {
    hours = null;
    candidates = [...items].sort((a, b) => String(b.published).localeCompare(String(a.published))).slice(0, 8);
  }

  const sorted = [...candidates].sort(
    (a, b) => Number(b.score || 0) - Number(a.score || 0) || String(b.published).localeCompare(String(a.published))
  );
  const picks = [];
  const picked = new Set();
  const topicUse = {};
  for (const item of sorted) {
    const topic = item.topics?.[0] || "adjacent";
    if ((topicUse[topic] || 0) >= 2) continue;
    picks.push(item);
    picked.add(item.id);
    topicUse[topic] = (topicUse[topic] || 0) + 1;
    if (picks.length >= 8) break;
  }
  for (const item of sorted) {
    if (picks.length >= 8) break;
    if (picked.has(item.id)) continue;
    picks.push(item);
    picked.add(item.id);
  }

  const sectionPool = [...picks];
  for (const item of sorted) {
    if (sectionPool.length >= 24) break;
    if (!sectionPool.some((entry) => entry.id === item.id)) sectionPool.push(item);
  }

  const counts = { paper: 0, news: 0, release: 0 };
  for (const item of candidates) counts[item.kind] = (counts[item.kind] || 0) + 1;
  const top = picks[0];
  const label = hours ? `过去 ${hours} 小时` : "最近快照";
  const lead = top
    ? `${label}，共 ${candidates.length} 条新内容：${counts.paper || 0} 篇论文、${counts.news || 0} 条新闻${counts.release ? `、${counts.release} 个发布` : ""}。最值得先看的是《${top.titleZh || top.title}》。`
    : site.description;

  const sections = GROUPS.map(([id, title, intro]) => ({
    title,
    intro,
    itemIds: sectionPool
      .filter((item) => groupForItem(item) === id)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .map((item) => item.id)
  })).filter((section) => section.itemIds.length);

  const llmNote = meta.llm?.used ? "由 Agnes 辅助概括" : "来自条目或保留英文原文";
  return {
    date: meta.date,
    seed: false,
    window: {
      from: hours ? new Date(to.getTime() - hours * 3600000).toISOString() : null,
      to: to.toISOString(),
      hours: hours || null,
      label
    },
    lead,
    editorNote: `本期按相关性、时效、来源与证据等级排序，并按主题分散重点；中文摘要${llmNote}。厂商自测与媒体报道单独标注，不进入结论区。`,
    picks: picks.map((item) => ({ id: item.id, note: item.why || "与记忆的写入、读取或治理直接相关。" })),
    sections
  };
}

function resolveDigest() {
  const file = path.join(DATA, "digests", `${meta.date}.json`);
  if (fs.existsSync(file)) return readJson(file);
  if (meta.seed && seedDigest.date === meta.date) return seedDigest;
  const generated = generateDigest();
  writeJson(file, generated);
  console.log(`Generated digest ${file} (${generated.picks.length} picks, ${generated.sections.length} sections)`);
  return generated;
}

function buildDigestIndex() {
  const dir = path.join(DATA, "digests");
  const entries = [];
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
      const entry = readJson(path.join(dir, file));
      entries.push({
        date: entry.date || file.slice(0, 10),
        label: entry.window?.label || "",
        picks: entry.picks?.length || 0,
        items: (entry.sections || []).reduce((sum, section) => sum + (section.itemIds?.length || 0), 0),
        url: `${baseUrl}data/digests/${file}`
      });
    }
  }
  if (!entries.some((entry) => entry.date === digest.date)) {
    entries.push({
      date: digest.date,
      label: digest.window?.label || "",
      picks: digest.picks?.length || 0,
      items: (digest.sections || []).reduce((sum, section) => sum + (section.itemIds?.length || 0), 0),
      url: `${baseUrl}data/digests/${digest.date}.json`
    });
  }
  return { digests: entries.sort((a, b) => String(b.date).localeCompare(String(a.date))) };
}

function buildDigest() {
  const pickIds = new Set((digest.picks || []).map((pick) => pick.id));
  const sectionIds = new Set((digest.sections || []).flatMap((section) => section.itemIds || []));
  const uncovered = items.filter((item) => !pickIds.has(item.id) && !sectionIds.has(item.id));
  const picks = (digest.picks || []).map((pick) => {
    const item = items.find((entry) => entry.id === pick.id);
    return {
      ...pick,
      title: item.title,
      titleZh: item.titleZh,
      url: item.url,
      siteUrl: `${baseUrl}#/item/${encodeURIComponent(item.id)}`,
      summaryZh: item.summaryZh,
      why: item.why,
      kind: item.kind,
      source: item.source,
      evidence: item.evidence
    };
  });
  return {
    ...digest,
    generatedAt: builtAt,
    checkedAt: meta.checkedAt,
    stats: statsFor(items),
    picks,
    sections: (digest.sections || []).map((section) => ({
      ...section,
      count: (section.itemIds || []).length
    })),
    uncovered: uncovered.map((item) => item.id)
  };
}

function buildRss(publicItems) {
  const sorted = [...publicItems].sort((a, b) => String(b.published).localeCompare(String(a.published))).slice(0, 60);
  const entries = sorted
    .map((item) => {
      const link = item.url;
      const description = [
        item.summaryZh || item.summary || "",
        item.why ? `为什么推送：${item.why}` : "",
        `证据等级：${item.evidence || "未标注"}`,
        `本站条目：${item.siteUrl}`
      ]
        .filter(Boolean)
        .join("\n\n");
      const categories = (item.tags || []).map((tagName) => `      <category>${escapeXml(tagName)}</category>`).join("\n");
      return `    <item>
      <title>${escapeXml(item.titleZh || item.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(item.id)}</guid>
      <pubDate>${formatRssDate(item.published)}</pubDate>
      <description>${escapeXml(description)}</description>
${categories}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(site.name)}</title>
    <link>${escapeXml(baseUrl)}</link>
    <atom:link href="${escapeXml(`${baseUrl}feed.xml`)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(site.description)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${formatRssDate(meta.checkedAt)}</lastBuildDate>
    <generator>agent-memory-push</generator>
    <ttl>60</ttl>
${entries}
  </channel>
</rss>
`;
}

function buildLlms(publicDigest) {
  const latest = publicDigest.picks.slice(0, 8);
  return `# ${site.name}

> ${site.description}

- 站点：${baseUrl}
- 数据快照：${meta.checkedAt || site.snapshot.checkedAt}
- 更新节奏：${site.schedule.label}
- 编辑原则：证据分级；论文多为预印本；厂商自测与媒体报道单独标注；不复刻榜单分数。
- 语言：中文；条目保留原文标题与链接。

## 公开数据

- 全部条目（JSON）：${baseUrl}api/v1/items.json
- 最新条目（JSON）：${baseUrl}api/v1/latest.json
- 今日推送（JSON）：${baseUrl}api/v1/digest.json
- RSS：${baseUrl}feed.xml
- 信源状态：${baseUrl}api/v1/sources.json
- 项目索引：${baseUrl}api/v1/projects.json
- Benchmark 索引：${baseUrl}api/v1/benchmarks.json

## 今日重点

${latest.map((pick, index) => `${index + 1}. ${pick.titleZh || pick.title} — ${pick.why || ""} (${pick.url})`).join("\n")}

## 使用说明

- 免费、匿名、只读；不需要 API Key。
- 引用时请保留原文链接，并注明快照时间；不要把预印本写成已同行评审。
- 不要根据本站标题推断论文结论；请回到原文核验。
- 本站不提供 Web Push；订阅请使用 RSS。
`;
}

function buildSitemap() {
  const urls = [
    { loc: baseUrl, lastmod: meta.checkedAt },
    { loc: `${baseUrl}feed.xml`, lastmod: meta.checkedAt },
    { loc: `${baseUrl}llms.txt`, lastmod: meta.checkedAt },
    { loc: `${baseUrl}api/v1/items.json`, lastmod: meta.checkedAt },
    { loc: `${baseUrl}api/v1/digest.json`, lastmod: meta.checkedAt }
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${new Date(entry.lastmod).toISOString()}</lastmod>
  </url>`
  )
  .join("\n")}
</urlset>
`;
}

function replaceTemplate(html) {
  const ogImage = `${baseUrl}assets/og.png`;
  return html
    .replaceAll("{{SITE_NAME}}", site.name)
    .replaceAll("{{SITE_SHORT_NAME}}", site.shortName)
    .replaceAll("{{SITE_DESCRIPTION}}", site.description)
    .replaceAll("{{SITE_URL}}", baseUrl)
    .replaceAll("{{OG_IMAGE}}", ogImage)
    .replaceAll("{{BUILD_TIME}}", builtAt)
    .replaceAll("{{CHECKED_AT}}", meta.checkedAt || site.snapshot.checkedAt)
    .replaceAll("{{SCHEDULE}}", site.schedule.label);
}

function main() {
  digest = resolveDigest();
  validate();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const publicItems = items.map(publicItem).sort((a, b) => String(b.published).localeCompare(String(a.published)));
  const publicDigest = buildDigest();
  const stats = statsFor(items);
  const publicMeta = {
    ...meta,
    builtAt,
    stats,
    sourcesOk: sources.sources.filter((source) => source.status === "ok").length,
    sourcesTotal: sources.sources.length,
    ntfy: process.env.NTFY_TOPIC
      ? {
          server: (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, ""),
          topic: process.env.NTFY_TOPIC
        }
      : null
  };

  copyDir(path.join(SRC, "assets"), path.join(DIST, "assets"));
  writeText(
    path.join(DIST, "index.html"),
    replaceTemplate(readText(path.join(SRC, "index.html")))
  );

  writeJson(path.join(DIST, "data", "site.json"), site);
  writeJson(path.join(DIST, "data", "items.json"), publicItems);
  writeJson(path.join(DIST, "data", "meta.json"), publicMeta);
  writeJson(path.join(DIST, "data", "sources.json"), sources);
  writeJson(path.join(DIST, "data", "projects.json"), { ...projects, checkedAt: projects.checkedAt || meta.checkedAt });
  writeJson(path.join(DIST, "data", "benchmarks.json"), benchmarks);
  writeJson(path.join(DIST, "data", "surveys.json"), surveys);
  writeJson(path.join(DIST, "data", "taxonomy.json"), taxonomy);
  writeJson(path.join(DIST, "data", "digests", "index.json"), buildDigestIndex());
  writeJson(path.join(DIST, "data", "digests", `${digest.date}.json`), publicDigest);

  writeJson(path.join(DIST, "api", "v1", "items.json"), {
    version: 1,
    generatedAt: builtAt,
    checkedAt: meta.checkedAt,
    count: publicItems.length,
    items: publicItems
  });
  writeJson(path.join(DIST, "api", "v1", "latest.json"), {
    version: 1,
    generatedAt: builtAt,
    checkedAt: meta.checkedAt,
    items: publicItems.slice(0, 20)
  });
  writeJson(path.join(DIST, "api", "v1", "digest.json"), publicDigest);
  writeJson(path.join(DIST, "api", "v1", "sources.json"), sources);
  writeJson(path.join(DIST, "api", "v1", "projects.json"), projects);
  writeJson(path.join(DIST, "api", "v1", "benchmarks.json"), benchmarks);
  writeJson(path.join(DIST, "api", "v1", "surveys.json"), surveys);

  writeText(path.join(DIST, "feed.xml"), buildRss(publicItems));
  writeText(path.join(DIST, "llms.txt"), buildLlms(publicDigest));
  writeText(path.join(DIST, "sitemap.xml"), buildSitemap());
  writeText(
    path.join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${baseUrl}sitemap.xml\n`
  );
  writeJson(path.join(DIST, "manifest.webmanifest"), {
    name: site.name,
    short_name: site.shortName,
    description: site.description,
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: "#f7f4ec",
    theme_color: "#0f6b4f",
    icons: [
      {
        src: "assets/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      }
    ]
  });
  writeText(path.join(DIST, ".nojekyll"), "");
  writeText(
    path.join(DIST, "404.html"),
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>404 · ${site.name}</title><style>body{background:#f7f4ec;color:#161b17;font:16px/1.7 system-ui;display:grid;place-items:center;min-height:100vh;margin:0}a{color:#0f6b4f}</style><main><p>这一页没有被记住。</p><p><a href="./">回到 ${site.name}</a></p></main></html>`
  );

  console.log(`Built ${publicItems.length} items, ${digest.picks.length} picks, ${sources.sources.length} sources -> ${DIST}`);
  console.log(`Stats: ${JSON.stringify(stats)}`);
}

main();
