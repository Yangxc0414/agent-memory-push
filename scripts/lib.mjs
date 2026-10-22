import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");
export const SRC = path.join(ROOT, "src");
export const DATA = path.join(SRC, "data");
export const DIST = path.join(ROOT, "dist");

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readText(file) {
  return fs.readFileSync(file, "utf8");
}

export function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

export function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

export function decodeEntities(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function stripHtml(value = "") {
  return decodeEntities(String(value))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanText(value = "") {
  return stripHtml(value).replace(/\s+/g, " ").trim();
}

export function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return match ? decodeEntities(match[1]).trim() : "";
}

export function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>(?:<\/link>)?/gi)];
  for (const link of links) {
    const attrs = link[1];
    const href = attrs.match(/href=["']([^"']+)["']/i)?.[1];
    const rel = attrs.match(/rel=["']([^"']+)["']/i)?.[1] || "alternate";
    if (href && rel === "alternate") return href;
  }
  const first = links[0]?.[1]?.match(/href=["']([^"']+)["']/i)?.[1];
  return first || "";
}

export async function fetchText(url, options = {}) {
  const { timeout = 25000, retries = 2, headers = {} } = options;
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "AgentMemoryPushBot/1.0 (+https://yangxc0414.github.io/agent-memory-push/)",
          Accept: "application/atom+xml, application/rss+xml, application/json, text/xml, */*",
          ...headers
        },
        signal: AbortSignal.timeout(timeout)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw lastError;
}

export function parseArxiv(xml) {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((match) => {
    const block = match[1];
    const rawId = tag(block, "id");
    const abs = rawId.match(/abs\/([^v]+)(?:v\d+)?$/)?.[1] || rawId;
    const authors = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map(
      (item) => cleanText(item[1])
    );
    return {
      id: `arxiv:${abs}`,
      arxivId: abs,
      title: cleanText(tag(block, "title")),
      summary: cleanText(tag(block, "summary")),
      url: atomLink(block) || `https://arxiv.org/abs/${abs}`,
      published: tag(block, "published"),
      updated: tag(block, "updated"),
      authors
    };
  });
  return entries.filter((entry) => entry.title && entry.arxivId);
}

export function parseFeed(xml) {
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => {
    const block = match[1];
    const link = tag(block, "link") || block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] || "";
    return {
      title: cleanText(tag(block, "title")),
      summary: cleanText(tag(block, "description") || tag(block, "content:encoded") || tag(block, "summary")),
      url: decodeEntities(link).trim(),
      published: tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || tag(block, "dc:date"),
      guid: tag(block, "guid") || tag(block, "id") || link
    };
  });
  if (items.length) return items;

  return [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => {
    const block = match[1];
    return {
      title: cleanText(tag(block, "title")),
      summary: cleanText(tag(block, "summary") || tag(block, "content")),
      url: atomLink(block) || tag(block, "id"),
      published: tag(block, "published") || tag(block, "updated"),
      guid: tag(block, "id")
    };
  });
}

export function parseHuggingFace(json) {
  const rows = Array.isArray(json) ? json : Array.isArray(json?.dailyPapers) ? json.dailyPapers : [];
  return rows
    .map((row) => {
      const paper = row.paper || row;
      const arxivId = paper.id || row.paper?.id;
      if (!arxivId) return null;
      return {
        id: `arxiv:${arxivId}`,
        arxivId,
        title: cleanText(paper.title || row.title),
        summary: cleanText(paper.summary || row.summary),
        url: `https://arxiv.org/abs/${arxivId}`,
        published: paper.publishedAt || row.publishedAt || row.date,
        updated: paper.publishedAt || row.publishedAt || row.date,
        authors: (paper.authors || []).map((author) => author.name || author).filter(Boolean)
      };
    })
    .filter(Boolean);
}

const MEMORY_TERMS = [
  "memory",
  "memories",
  "memor",
  "episodic",
  "experiential",
  "context engineering",
  "persistent state",
  "long-term context",
  "long-term knowledge",
  "memory bank",
  "memory layer",
  "记忆"
];

const AGENT_TERMS = [
  "agent",
  "llm",
  "language model",
  "assistant",
  "robot",
  "tool",
  "mcp",
  "智能体",
  "大模型",
  "语言模型",
  "助手"
];

const TOPIC_RULES = [
  { id: "security", words: ["security", "attack", "poison", "injection", "privacy", "defense", "defence", "provenance", "unlearning", "leak", "安全", "攻击", "隐私", "防护", "注入"] },
  { id: "survey", words: ["survey", "systematic review", "taxonomy", "综述"] },
  { id: "evaluation", words: ["benchmark", "evaluat", "diagnos", "metric", "testbed", "评测", "基准", "诊断"] },
  { id: "embodied", words: ["robot", "embodied", "navigation", "spatial", "manipulation", "vla", "具身", "机器人", "空间"] },
  { id: "multimodal", words: ["multimodal", "multi-modal", "visual", "video", "audio", "image", "vision-language", "多模态", "视觉", "视频"] },
  { id: "personal", words: ["personal", "personali", "conversation", "dialogue", "user profile", "user preference", "assistant", "个性化", "对话", "用户画像"] },
  { id: "tools", words: ["release", "sdk", "mcp", "plugin", "framework", "发布", "版本"] },
  { id: "mechanism", words: ["memory", "retrieval", "retrieve", "context", "experience", "state", "cache", "记忆", "检索"] }
];

const SECURITY_RULES = [
  { angle: "attack", words: ["attack", "poison", "injection", "backdoor", "exfiltration", "攻击", "投毒", "注入"] },
  { angle: "defense", words: ["defense", "defence", "protect", "guard", "filter", "isolation", "authority", "防御", "防护", "隔离", "权限"] },
  { angle: "privacy", words: ["privacy", "leak", "disclosure", "personal information", "隐私", "泄漏", "披露"] },
  { angle: "provenance", words: ["provenance", "origin", "source", "audit", "trace", "来源", "溯源", "审计"] },
  { angle: "evaluation", words: ["benchmark", "evaluat", "test", "评测", "基准", "测试"] }
];

export function isMemoryRelevant(text) {
  const lower = String(text).toLowerCase();
  const hasMemory = MEMORY_TERMS.some((term) => lower.includes(term));
  const hasAgent = AGENT_TERMS.some((term) => lower.includes(term));
  return hasMemory && hasAgent;
}

export function classify(text) {
  const lower = String(text).toLowerCase();
  for (const rule of TOPIC_RULES) {
    if (rule.words.some((word) => lower.includes(word))) return rule.id;
  }
  return "adjacent";
}

export function securityAngles(text) {
  const lower = String(text).toLowerCase();
  const hits = SECURITY_RULES.filter((rule) => rule.words.some((word) => lower.includes(word))).map(
    (rule) => rule.angle
  );
  return hits.length ? hits : null;
}

export function topicLabel(taxonomy, id) {
  return taxonomy.topics.find((topic) => topic.id === id)?.label || "相关智能体研究";
}

export function scoreItem(item) {
  const ageDays = Math.max(0, (Date.now() - Date.parse(item.published || 0)) / 86400000);
  const freshness = ageDays <= 7 ? 20 : ageDays <= 30 ? 14 : ageDays <= 180 ? 8 : 4;
  const source =
    item.sourceTier === "official"
      ? 20
      : item.sourceTier === "preprint"
        ? 16
        : item.sourceTier === "media"
          ? 10
          : 6;
  const evidence =
    item.kind === "paper" ? 10 : item.sourceTier === "official" ? 9 : item.sourceTier === "media" ? 5 : 2;
  const security = item.security ? 4 : 0;
  const relevance = item.kind === "paper" || item.kind === "release" ? 36 : 32;
  return Math.max(0, Math.min(100, relevance + freshness + source + evidence + security));
}

export function normalizeUrl(value = "") {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref|source|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(value).trim();
  }
}

export function canonicalId(item) {
  const arxiv = String(item.id || "").match(/arxiv:(.+)/)?.[1];
  if (arxiv) return `arxiv:${arxiv.split("v")[0]}`;
  return `web:${normalizeUrl(item.url)}`;
}

export function formatRssDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString();
}

export function formatDate(value, timeZone = "Asia/Shanghai") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function formatDateTime(value, timeZone = "Asia/Shanghai") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function dayInZone(value, timeZone = "Asia/Shanghai") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

export function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

export function truncate(value, length = 280) {
  const text = String(value || "");
  return text.length <= length ? text : `${text.slice(0, length - 1).trim()}…`;
}
