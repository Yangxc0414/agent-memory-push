import path from "node:path";
import {
  DATA,
  ROOT,
  canonicalId,
  classifyTopics,
  cleanText,
  dayInZone,
  fetchText,
  isAgentMemoryRelevant,
  isAgentMemoryStrict,
  loadEnvFile,
  normalizeUrl,
  parseArxiv,
  parseFeed,
  parseHuggingFace,
  readJson,
  scoreItem,
  securityAngles,
  topicLabel,
  truncate,
  uniqueBy,
  writeJson
} from "./lib.mjs";
import { SOURCES } from "./sources.mjs";

loadEnvFile();

const PROBE = process.argv.includes("--probe");
const USE_LLM = process.argv.includes("--llm") || Boolean(process.env.LLM_API_KEY);
const ARXIV_LOOKBACK_DAYS = Math.max(1, Number(process.env.ARXIV_LOOKBACK_DAYS || 14));
const ARXIV_MAX_PAGES = PROBE ? 1 : Math.max(1, Number(process.env.ARXIV_MAX_PAGES || 12));
const ARXIV_PAGE_SIZE = PROBE
  ? 30
  : Math.min(100, Math.max(1, Number(process.env.ARXIV_PAGE_SIZE || 100)));
const ARXIV_PAGE_DELAY_MS = PROBE
  ? 0
  : Math.max(0, Number(process.env.ARXIV_PAGE_DELAY_MS || 3000));
const ARXIV_FETCH_TIMEOUT_MS = Math.max(
  15000,
  Number(process.env.ARXIV_FETCH_TIMEOUT_MS || 45000)
);
const COLLECT_CUTOFF = Date.now() - ARXIV_LOOKBACK_DAYS * 86400000;
const ARXIV_ALLOWED_CATEGORY = /^(cs\.|eess\.|stat\.ML$)/;
const LLM_ENRICH_LIMIT = Math.max(1, Number(process.env.LLM_ENRICH_LIMIT || 60));
const LLM_BATCH_SIZE = Math.max(1, Number(process.env.LLM_BATCH_SIZE || 4));
const LLM_TIMEOUT_MS = Math.max(10000, Number(process.env.LLM_TIMEOUT_MS || 120000));
const NOW = new Date().toISOString();
const FETCH_OPTIONS = PROBE
  ? { timeout: 10000, retries: 1 }
  : { timeout: 15000, retries: 2 };
const taxonomy = readJson(path.join(DATA, "taxonomy.json"));

async function mapLimit(list, limit, worker) {
  const results = new Array(list.length);
  let index = 0;
  async function next() {
    const current = index;
    index += 1;
    if (current >= list.length) return;
    results[current] = await worker(list[current], current);
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => next()));
  return results;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sourceTierFor(source, kind) {
  if (kind === "release" || source.type === "github-search") return "official";
  if (source.type === "arxiv" || source.type === "hf" || source.type === "rss" && source.id === "arxiv-announce")
    return "preprint";
  return "media";
}

function evidenceFor(source, kind) {
  if (kind === "release") return "官方发布";
  if (kind === "paper") return "预印本 · 原文可核验";
  if (source.type === "rss") return "媒体报道";
  return "公开来源";
}

function autoWhy(item) {
  const label = topicLabel(taxonomy, item.topics[0]);
  if (item.kind === "paper") return `新预印本，主题命中「${label}」；摘要已按原文整理，等待人工复核。`;
  if (item.kind === "release") return `官方发布，主题命中「${label}」；具体变更以 release note 为准。`;
  return `公开报道，主题命中「${label}」；数字与结论需回到原文核对。`;
}

let arxivQueue = Promise.resolve();
let lastArxivRequestAt = 0;

async function fetchArxivPage(url) {
  const run = arxivQueue.then(async () => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const wait = Math.max(0, lastArxivRequestAt + ARXIV_PAGE_DELAY_MS - Date.now());
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      lastArxivRequestAt = Date.now();
      try {
        return await fetchText(url, {
          ...FETCH_OPTIONS,
          retries: 0,
          timeout: ARXIV_FETCH_TIMEOUT_MS
        });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= 2 || !/HTTP (429|503)|timeout/i.test(message)) throw error;
        const pause = 8000 * (attempt + 1);
        console.log(`  arXiv ${message}; retry ${attempt + 1}/2 in ${pause / 1000}s`);
        await new Promise((resolve) => setTimeout(resolve, pause));
      }
    }
    throw lastError;
  });
  arxivQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function arxivPageUrl(source, page) {
  const url = new URL(source.url);
  url.searchParams.set("start", String(page * ARXIV_PAGE_SIZE));
  url.searchParams.set("max_results", String(ARXIV_PAGE_SIZE));
  return url.toString();
}

function freshArxivEntries(entries) {
  return entries.filter((entry) => {
    const published = Date.parse(entry.published);
    return !Number.isFinite(published) || published >= COLLECT_CUTOFF;
  });
}

async function collectArxiv(source) {
  const entries = [];
  let rawCount = 0;
  let pages = 0;
  for (let page = 0; page < ARXIV_MAX_PAGES; page += 1) {
    let xml;
    try {
      xml = await fetchArxivPage(arxivPageUrl(source, page));
    } catch (error) {
      if (page === 0) throw error;
      console.log(`  ${source.name}: page ${page + 1} failed, keeping previous pages (${error.message})`);
      break;
    }
    pages = page + 1;
    const pageEntries = parseArxiv(xml);
    rawCount += pageEntries.length;
    entries.push(...freshArxivEntries(pageEntries));
    if (pageEntries.length < ARXIV_PAGE_SIZE) break;
    const publishedTimes = pageEntries
      .map((entry) => Date.parse(entry.published))
      .filter(Number.isFinite);
    if (publishedTimes.length && Math.min(...publishedTimes) < COLLECT_CUTOFF) break;
  }
  const collected = entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    url: entry.url,
    published: normalizeDate(entry.published),
    summary: truncate(entry.summary, 700),
    authors: entry.authors,
    categories: entry.categories || [],
    primaryCategory: entry.primaryCategory || "",
    sourceId: source.id,
    kind: "paper"
  }));
  console.log(
    `  ${source.name}: ${collected.length} in ${ARXIV_LOOKBACK_DAYS}d window (${rawCount} fetched, ${pages} page${pages === 1 ? "" : "s"})`
  );
  return { entries: collected, rawCount, pages };
}

async function collectRss(source, xml) {
  const entries = parseFeed(xml);
  return entries.map((entry) => ({
    id: `web:${normalizeUrl(entry.url || entry.guid)}`,
    title: entry.title,
    url: entry.url || entry.guid,
    published: normalizeDate(entry.published),
    summary: truncate(entry.summary, 700),
    sourceId: source.id,
    kind: source.kind.includes("项目") ? "release" : "news"
  }));
}

async function collectHf(source) {
  const json = JSON.parse(await fetchText(source.url, FETCH_OPTIONS));
  const entries = parseHuggingFace(json);
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    url: entry.url,
    published: normalizeDate(entry.published),
    summary: truncate(entry.summary, 700),
    authors: entry.authors,
    sourceId: source.id,
    kind: "paper"
  }));
}

async function collectGithubSearch(source) {
  const headers = {};
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const json = JSON.parse(await fetchText(source.url, { ...FETCH_OPTIONS, headers }));
  const repos = Array.isArray(json.items) ? json.items : [];
  return repos.map((repo) => ({
    fullName: repo.full_name,
    name: repo.name,
    url: repo.html_url,
    description: repo.description || "",
    stars: repo.stargazers_count,
    language: repo.language || "",
    license: repo.license?.spdx_id || "",
    updatedAt: repo.updated_at,
    archived: Boolean(repo.archived),
    fork: Boolean(repo.fork)
  }));
}

async function runSource(source) {
  const started = Date.now();
  try {
    let entries = [];
    let rawCount = 0;
    if (source.type === "arxiv") {
      const collected = await collectArxiv(source);
      entries = collected.entries;
      rawCount = collected.rawCount;
    } else if (source.type === "hf") {
      entries = await collectHf(source);
      rawCount = entries.length;
    } else if (source.type === "feed" || source.type === "rss") {
      const xml = await fetchText(source.url, FETCH_OPTIONS);
      rawCount = (xml.match(/<item\b/g) || []).length + (xml.match(/<entry\b/g) || []).length;
      entries = await collectRss(source, xml);
    } else if (source.type === "github-search") {
      entries = await collectGithubSearch(source);
      rawCount = entries.length;
    }
    return {
      source,
      entries,
      status: "ok",
      rawCount,
      error: null,
      latencyMs: Date.now() - started
    };
  } catch (error) {
    return {
      source,
      entries: [],
      status: "error",
      rawCount: 0,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - started
    };
  }
}

function toItem(entry, source, result) {
  const kind = entry.kind;
  if (
    kind === "paper" &&
    entry.categories?.length &&
    !entry.categories.some((category) => ARXIV_ALLOWED_CATEGORY.test(category))
  ) {
    return null;
  }
  const topics = classifyTopics(`${entry.title} ${entry.summary || ""}`, source.topicHint);
  const topic = topics[0];
  const angles = securityAngles(`${entry.title} ${entry.summary || ""}`);
  const sourceTier = sourceTierFor(source, kind);
  const published = entry.published || (kind === "release" ? NOW : null);
  if (!published) return null;
  const item = {
    id: entry.id,
    title: cleanText(entry.title),
    titleZh: null,
    url: entry.url,
    kind,
    source: source.name,
    sourceId: source.id,
    sourceTier,
    published,
    summary: truncate(cleanText(entry.summary), 700),
    summaryZh: null,
    why: "",
    topics: [topic],
    tags: [topicLabel(taxonomy, topic)],
    security: angles
      ? { angles, note: "规则命中关键词，等待人工复核。" }
      : null,
    evidence: evidenceFor(source, kind),
    score: 0,
    curated: false,
    collectedAt: NOW,
    provenance: source.id
  };
  item.why = autoWhy(item);
  item.score = scoreItem(item);
  return item;
}

function mergeItems(existing, incoming) {
  const map = new Map(existing.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  for (const raw of incoming) {
    const id = canonicalId(raw);
    const item = { ...raw, id };
    const current = map.get(id);
    if (!current) {
      map.set(id, item);
      added += 1;
      continue;
    }
    updated += 1;
    map.set(id, {
      ...item,
      ...current,
      id,
      title: current.title || item.title,
      url: current.url || item.url,
      published: current.published || item.published,
      summary: current.summary || item.summary,
      summaryZh: current.summaryZh || item.summaryZh,
      why: current.why || item.why,
      tags: current.tags?.length ? current.tags : item.tags,
      topics: current.topics?.length ? current.topics : item.topics,
      security: current.security || item.security,
      score: current.score || item.score,
      curated: Boolean(current.curated)
    });
  }
  return {
    items: [...map.values()].sort((a, b) => String(b.published).localeCompare(String(a.published))),
    added,
    updated
  };
}

async function enrichWithLlm(items) {
  if (!USE_LLM || !process.env.LLM_API_KEY) return { items, used: false, error: null };
  const base = (process.env.LLM_BASE_URL || "https://api.agnes-ai.cn/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || "agnes-3.0-flash";
  const targets = items
    .filter((item) => !item.curated && (!item.summaryZh || !item.titleZh))
    .slice(0, LLM_ENRICH_LIMIT);
  if (!targets.length) return { items, used: true, error: null };
  console.log(`LLM enrichment: ${targets.length} items in batches of ${LLM_BATCH_SIZE}`);
  let lastError = null;
  for (let index = 0; index < targets.length; index += LLM_BATCH_SIZE) {
    const batch = targets.slice(index, index + LLM_BATCH_SIZE);
    try {
      const prompt = `你在编辑一份中文的 Agent Memory 每日推送。请为下面每条内容写：
1. titleZh：一个短中文标题，保留方法名/模型名/产品名，不夸大，不添加原文没有的结论。
2. summaryZh：1-2 句中文概括，只写原文明确支持的内容；不要写“首个/唯一/空白”；不要补充数字或结论；如果是厂商自测或媒体报道，要点明。
3. why：一句“为什么推送”，说明它相对同行的新增点或阅读价值。
只输出 JSON 数组，每项 {"id":"...","titleZh":"...","summaryZh":"...","why":"..."}，不要输出其他文字。
内容：${JSON.stringify(batch.map((item) => ({ id: item.id, title: item.title, summary: item.summary, source: item.source, kind: item.kind, evidence: item.evidence })))}`;
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LLM_API_KEY}`
        },
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 2200,
          messages: [
            { role: "system", content: "你是严谨的中文科技编辑，拒绝夸大，拒绝编造。" },
            { role: "user", content: prompt }
          ]
        })
      });
      if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content || "";
      const cleaned = content.replace(/```json|```/g, "").trim();
      const start = cleaned.indexOf("[");
      const end = cleaned.lastIndexOf("]");
      const parsed = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
      if (!Array.isArray(parsed)) throw new Error("LLM output is not an array");
      const byId = new Map(parsed.map((row) => [row.id, row]));
      for (const item of batch) {
        const row = byId.get(item.id);
        if (!row) continue;
        if (typeof row.titleZh === "string" && row.titleZh.trim().length >= 4) {
          item.titleZh = row.titleZh.trim();
        }
        if (typeof row.summaryZh === "string" && row.summaryZh.length >= 12) {
          item.summaryZh = row.summaryZh.trim();
          item.summaryZhBasis = "原文摘要";
        }
        if (typeof row.why === "string" && row.why.length >= 8) item.why = row.why.trim();
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.log(`LLM batch ${index / LLM_BATCH_SIZE + 1} failed: ${lastError}`);
    }
  }
  return { items, used: true, error: lastError };
}

function sourceRecord(result) {
  const { source } = result;
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    cadence: source.cadence,
    note: source.note,
    url: source.url,
    status: result.status,
    lastCheckedAt: NOW,
    lastSuccessAt: result.status === "ok" ? NOW : null,
    returned: result.entries.length,
    scanned: result.rawCount,
    latencyMs: result.latencyMs,
    error: result.error
  };
}

async function main() {
  const previousSources = readJson(path.join(DATA, "sources.json")).sources || [];
  const previousSuccess = new Map(
    previousSources.filter((source) => source.lastSuccessAt).map((source) => [source.id, source.lastSuccessAt])
  );
  const results = [];
  const collected = await mapLimit(SOURCES, PROBE ? 4 : 3, async (source) => {
    const result = await runSource(source);
    const label = result.status === "ok" ? `${result.entries.length} 条` : result.error;
    console.log(`${result.status === "ok" ? "OK " : "ERR"} ${source.name} — ${label}`);
    return result;
  });
  results.push(...collected);

  const records = results.map((result) => {
    const record = sourceRecord(result);
    if (record.status !== "ok" && previousSuccess.has(record.id)) {
      record.lastSuccessAt = previousSuccess.get(record.id);
    }
    return record;
  });
  writeJson(path.join(DATA, "sources.json"), {
    checkedAt: NOW,
    probe: PROBE,
    note: "每次采集后写入的源状态；失败会保留上次成功时间，不隐藏错误。",
    sources: records
  });

  if (PROBE) {
    console.log("Probe complete. Source status written, items untouched.");
    return;
  }

  const raw = [];
  for (const result of results) {
    if (result.status !== "ok") continue;
    if (result.source.type === "github-search") continue;
    for (const entry of result.entries) {
      const item = toItem(entry, result.source, result);
      if (!item) continue;
      if (Date.parse(item.published) < COLLECT_CUTOFF) continue;
      const relevant = result.source.strict ? isAgentMemoryStrict(item) : isAgentMemoryRelevant(item);
      if (!relevant) continue;
      raw.push(item);
    }
  }

  const deduped = uniqueBy(raw, (item) => canonicalId(item));
  const stored = readJson(path.join(DATA, "items.json"));
  const existing = stored.filter((item) => isAgentMemoryRelevant(item));
  if (existing.length !== stored.length) {
    console.log(`Pruned ${stored.length - existing.length} stored items that no longer pass relevance`);
  }
  const existingIds = new Set(existing.map((item) => item.id));
  const newItems = deduped
    .filter((item) => !existingIds.has(item.id))
    .sort((a, b) => String(b.published).localeCompare(String(a.published)));
  const addedIds = newItems.map((item) => item.id);
  const topicCounts = {};
  for (const item of newItems) {
    const primary = item.topics?.[0] || "adjacent";
    topicCounts[primary] = (topicCounts[primary] || 0) + 1;
  }
  console.log(`Relevant in window: ${deduped.length}; new: ${newItems.length}`);
  console.log("New by primary topic:", JSON.stringify(topicCounts));
  const merged = mergeItems(existing, deduped);
  const enriched = await enrichWithLlm(merged.items);
  writeJson(path.join(DATA, "items.json"), enriched.items);

  const github = results.find((result) => result.source.type === "github-search");
  if (github?.status === "ok" && github.entries.length) {
    const projectFile = path.join(DATA, "projects.json");
    const current = readJson(projectFile);
    const byName = new Map(current.projects.map((project) => [project.fullName, project]));
    for (const repo of github.entries) {
      if (!repo.fullName || repo.archived || repo.fork) continue;
      const prev = byName.get(repo.fullName);
      if (prev) {
        prev.stars = repo.stars;
        prev.updatedAt = repo.updatedAt;
        prev.starsCheckedAt = NOW;
      } else {
        byName.set(repo.fullName, {
          fullName: repo.fullName,
          name: repo.name,
          url: repo.url,
          descriptionZh: repo.description || "GitHub 项目，描述待编辑补全。",
          why: "GitHub Search 自动收录；等待人工确认其是否为完整记忆系统。",
          stars: repo.stars,
          language: repo.language,
          license: repo.license,
          updatedAt: repo.updatedAt,
          starsCheckedAt: NOW,
          category: "社区项目"
        });
      }
    }
    current.checkedAt = NOW;
    current.starsCheckedAt = NOW;
    current.projects = [...byName.values()]
      .sort((a, b) => Number(b.stars || 0) - Number(a.stars || 0))
      .slice(0, 30);
    writeJson(projectFile, current);
  }

  const okCount = records.filter((record) => record.status === "ok").length;
  const metaPath = path.join(DATA, "meta.json");
  const previousMeta = readJson(metaPath);
  const meta = {
    ...previousMeta,
    version: 1,
    checkedAt: okCount > 0 ? NOW : previousMeta.checkedAt,
    lastSuccessAt: okCount > 0 ? NOW : previousMeta.lastSuccessAt,
    generatedAt: NOW,
    timezone: "Asia/Shanghai",
    date: okCount > 0 ? dayInZone(NOW) : previousMeta.date,
    seed: okCount > 0 ? false : previousMeta.seed,
    added: merged.added,
    addedIds,
    updated: merged.updated,
    items: enriched.items.length,
    sourcesOk: okCount,
    sourcesTotal: records.length,
    llm: enriched.used ? { used: true, error: enriched.error } : { used: false, error: null }
  };
  writeJson(metaPath, meta);
  console.log(
    `Done. ${merged.added} new, ${merged.updated} updated, ${enriched.items.length} total; ${okCount}/${records.length} sources ok.`
  );
  if (okCount === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
