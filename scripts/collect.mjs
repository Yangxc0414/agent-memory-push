import path from "node:path";
import {
  DATA,
  ROOT,
  canonicalId,
  classify,
  cleanText,
  dayInZone,
  fetchText,
  isMemoryRelevant,
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

const PROBE = process.argv.includes("--probe");
const USE_LLM = process.argv.includes("--llm") || Boolean(process.env.LLM_API_KEY);
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

async function collectArxiv(source, xml) {
  const entries = parseArxiv(xml);
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
      const xml = await fetchText(source.url, FETCH_OPTIONS);
      rawCount = (xml.match(/<entry>/g) || []).length;
      entries = await collectArxiv(source, xml);
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
  const topic = classify(`${entry.title} ${entry.summary || ""}`);
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
  const base = (process.env.LLM_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const model = process.env.LLM_MODEL || "deepseek-chat";
  const targets = items.filter((item) => !item.curated && !item.summaryZh).slice(0, 24);
  if (!targets.length) return { items, used: true, error: null };
  try {
    for (let index = 0; index < targets.length; index += 6) {
      const batch = targets.slice(index, index + 6);
      const prompt = `你在编辑一份中文的 Agent Memory 每日推送。请为下面每条内容写：
1. summaryZh：1-2 句中文概括，只写原文明确支持的内容；不要写“首个/唯一/空白”；不要补充数字或结论；如果是厂商自测或媒体报道，要点明。
2. why：一句“为什么推送”，说明它相对同行的新增点或阅读价值。
只输出 JSON 数组，每项 {"id":"...","summaryZh":"...","why":"..."}，不要输出其他文字。
内容：${JSON.stringify(batch.map((item) => ({ id: item.id, title: item.title, summary: item.summary, source: item.source, kind: item.kind, evidence: item.evidence })))}`;
      const response = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.LLM_API_KEY}`
        },
        signal: AbortSignal.timeout(90000),
        body: JSON.stringify({
          model,
          temperature: 0.2,
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
      const parsed = JSON.parse(cleaned);
      if (!Array.isArray(parsed)) throw new Error("LLM output is not an array");
      const byId = new Map(parsed.map((row) => [row.id, row]));
      for (const item of batch) {
        const row = byId.get(item.id);
        if (!row) continue;
        if (typeof row.summaryZh === "string" && row.summaryZh.length >= 12) {
          item.summaryZh = row.summaryZh.trim();
          item.summaryZhBasis = "原文摘要";
        }
        if (typeof row.why === "string" && row.why.length >= 8) item.why = row.why.trim();
      }
    }
    return { items, used: true, error: null };
  } catch (error) {
    return { items, used: true, error: error instanceof Error ? error.message : String(error) };
  }
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
      const text = `${item.title} ${item.summary}`;
      if (item.kind !== "release" && !isMemoryRelevant(text)) continue;
      raw.push(item);
    }
  }

  const deduped = uniqueBy(raw, (item) => canonicalId(item));
  const existing = readJson(path.join(DATA, "items.json"));
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
