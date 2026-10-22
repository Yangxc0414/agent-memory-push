const DATA_BASE = new URL("./", document.baseURI);
const VIEWS = new Set(["today", "feed", "security", "topics", "projects", "benchmarks", "pipeline", "method"]);
const KIND_LABELS = { paper: "论文", news: "新闻", release: "发布" };
const ANGLE_LABELS = {
  attack: "攻击面",
  defense: "防御",
  privacy: "隐私",
  provenance: "溯源",
  evaluation: "评测"
};
const RANGE_LABELS = { all: "全部时间", "7": "近 7 天", "30": "近 30 天", today: "今天" };

let site;
let meta;
let items = [];
let sources;
let projects;
let benchmarks;
let surveys;
let taxonomy;
let digest;
let byId = new Map();
let topicById = new Map();
let currentView = "today";
let dialogOpenFor = null;
let toastTimer;
let lastMetaCheck = null;

const state = {
  feed: { kind: "all", topic: "all", q: "", range: "all", sort: "newest", security: false, limit: 18 },
  securityAngle: "all",
  projectCategory: "all",
  projectSort: "stars"
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function esc(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(value = "") {
  try {
    const url = new URL(value, location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "#";
  } catch {
    return "#";
  }
}

function formatDate(value, long = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期未提供";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(long ? { hour: "2-digit", minute: "2-digit", hour12: false } : {})
  })
    .format(date)
    .replace(/\//g, long ? "-" : ".");
}

function relative(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日期未提供";
  const diff = Date.now() - date.getTime();
  if (diff < 0) return formatDate(value, true);
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return formatDate(value);
}

function truncate(value, length = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function itemTitle(item) {
  return item.titleZh || item.title || "未命名条目";
}

function itemSummary(item) {
  return item.summaryZh || item.summary || "这条内容还没有中文摘要，请打开原文核对。";
}

function topicLabel(id) {
  return topicById.get(id)?.label || "相关智能体研究";
}

function kindBadge(item, onPaper = false) {
  return `<span class="badge ${item.kind}${onPaper ? " on-paper" : ""}">${KIND_LABELS[item.kind] || item.kind}</span>`;
}

function securityBadge(item, onPaper = false) {
  if (!item.security) return "";
  return `<span class="badge security${onPaper ? " on-paper" : ""}">安全</span>`;
}

function evidenceBadge(item) {
  return `<span class="evidence">${esc(item.evidence || "证据未标注")}</span>`;
}

function scoreBar(item) {
  const score = Number(item.score || 0);
  return `<span class="score" title="推送分：按相关性、时效、来源、证据和主题加权，仅作编辑排序">
    <span class="mono">PUSH ${score}</span>
    <span class="score-track"><i style="width:${Math.max(0, Math.min(100, score))}%"></i></span>
  </span>`;
}

function starFmt(value) {
  const number = Number(value || 0);
  if (number >= 1000) return `${(number / 1000).toFixed(1)}k`;
  return String(number);
}

function itemHref(id) {
  return `#/item/${encodeURIComponent(id)}`;
}

function siteItemUrl(id) {
  return `${location.origin}${location.pathname}#/item/${encodeURIComponent(id)}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text, query) {
  const safe = esc(text);
  if (!query || query.trim().length < 2) return safe;
  try {
    return safe.replace(new RegExp(`(${escapeRegExp(esc(query.trim()))})`, "gi"), "<mark>$1</mark>");
  } catch {
    return safe;
  }
}

function nextRun() {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 10, 0)
  );
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function isStale() {
  const checked = new Date(meta?.checkedAt || 0).getTime();
  return Number.isFinite(checked) && Date.now() - checked > 36 * 3600000;
}

async function getJson(path, bust = false) {
  const url = new URL(path, DATA_BASE);
  if (bust) url.searchParams.set("t", String(Date.now()));
  const response = await fetch(url, { cache: bust ? "no-store" : "default" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function loadData({ bust = false } = {}) {
  const loading = $("#view .loading-shell");
  if (loading) loading.querySelector(".lead").textContent = "正在读取每日快照…";
  const freshMeta = await getJson("data/meta.json", true);
  const version = encodeURIComponent(freshMeta.checkedAt || freshMeta.builtAt || "1");
  const suffix = bust ? `?t=${Date.now()}` : `?v=${version}`;
  const [nextSite, nextItems, nextSources, nextProjects, nextBenchmarks, nextSurveys, nextTaxonomy, nextDigest, nextMeta] =
    await Promise.all([
      getJson(`data/site.json${suffix}`),
      getJson(`data/items.json${suffix}`),
      getJson(`data/sources.json${suffix}`),
      getJson(`data/projects.json${suffix}`),
      getJson(`data/benchmarks.json${suffix}`),
      getJson(`data/surveys.json${suffix}`),
      getJson(`data/taxonomy.json${suffix}`),
      getJson(`data/digests/${freshMeta.date}.json${suffix}`).catch(() => getJson(`data/digests/index.json${suffix}`)),
      getJson(`data/meta.json${suffix}`)
    ]);
  site = nextSite;
  items = Array.isArray(nextItems) ? nextItems : nextItems.items || [];
  sources = nextSources;
  projects = nextProjects;
  benchmarks = nextBenchmarks;
  surveys = nextSurveys;
  taxonomy = nextTaxonomy;
  digest = nextDigest.digests ? null : nextDigest;
  meta = nextMeta;
  byId = new Map(items.map((item) => [item.id, item]));
  topicById = new Map(taxonomy.topics.map((topic) => [topic.id, topic]));
  if (!digest) {
    digest = {
      date: meta.date,
      lead: site.description,
      editorNote: "快照已生成，但这一期还没有 digest。",
      picks: [],
      sections: [],
      window: { label: "最近快照" }
    };
  }
  lastMetaCheck = meta.checkedAt;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart = ""] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const first = segments[0] || "today";
  if (first === "item") {
    return {
      view: VIEWS.has(currentView) ? currentView : "today",
      itemId: decodeURIComponent(segments.slice(1).join("/")),
      params: new URLSearchParams(queryPart)
    };
  }
  return {
    view: VIEWS.has(first) ? first : "today",
    itemId: null,
    params: new URLSearchParams(queryPart)
  };
}

function setHash(view, params = {}, { replace = false } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "" && value !== "all") query.set(key, value);
  }
  const hash = `#/${view}${query.toString() ? `?${query}` : ""}`;
  if (replace) {
    history.replaceState(null, "", hash);
    return true;
  }
  if (location.hash === hash) return false;
  location.hash = hash;
  return true;
}

function applyFeedParams(params) {
  state.feed.kind = ["paper", "news", "release"].includes(params.get("kind")) ? params.get("kind") : "all";
  state.feed.topic = params.get("topic") && topicById.has(params.get("topic")) ? params.get("topic") : "all";
  state.feed.q = params.get("q") || "";
  state.feed.range = ["7", "30", "today"].includes(params.get("range")) ? params.get("range") : "all";
  state.feed.sort = params.get("sort") === "score" ? "score" : "newest";
  state.feed.security = params.get("security") === "1";
  state.feed.limit = 18;
}

function feedParams() {
  return {
    kind: state.feed.kind,
    topic: state.feed.topic,
    q: state.feed.q,
    range: state.feed.range,
    sort: state.feed.sort === "score" ? "score" : "",
    security: state.feed.security ? "1" : ""
  };
}

function updateNav(view) {
  $$(".nav a").forEach((link) => {
    const active = link.dataset.nav === view;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function render(view = currentView, { scroll = true } = {}) {
  if (!site) return;
  currentView = VIEWS.has(view) ? view : "today";
  const titles = {
    today: "今日推送",
    feed: "全部动态",
    security: "记忆安全",
    topics: "主题地图",
    projects: "项目与发布",
    benchmarks: "Benchmark",
    pipeline: "信源与推送",
    method: "方法与反思"
  };
  document.title = `${titles[currentView]} · ${site.name}`;
  updateNav(currentView);
  const viewEl = $("#view");
  viewEl.innerHTML = renderView(currentView);
  if (currentView === "feed") renderFeedResults();
  bindViewEvents();
  observeReveal();
  if (scroll) window.scrollTo({ top: 0, behavior: "auto" });
}

function renderView(view) {
  if (view === "feed") return renderFeed();
  if (view === "security") return renderSecurity();
  if (view === "topics") return renderTopics();
  if (view === "projects") return renderProjects();
  if (view === "benchmarks") return renderBenchmarks();
  if (view === "pipeline") return renderPipeline();
  if (view === "method") return renderMethod();
  return renderToday();
}

function loadingMarkup() {
  return `<section class="loading-shell"><p class="kicker">AGENT MEMORY / DAILY PUSH</p><h1>记忆不该被遗忘。</h1><p class="lead">正在读取每日快照…</p></section>`;
}

/* ---------- components ---------- */

function statusPanel() {
  const stats = meta.stats || {};
  const sourcesOk = meta.sourcesOk ?? sources.sources.filter((source) => source.status === "ok").length;
  const sourcesTotal = meta.sourcesTotal ?? sources.sources.length;
  const checked = meta.checkedAt || site.snapshot.checkedAt;
  const next = nextRun();
  const stale = isStale();
  const statusLabel = meta.seed ? "SEED SNAPSHOT" : stale ? "STALE" : "DAILY SNAPSHOT";
  return `<aside class="status-panel reveal" aria-label="推送状态">
    <div class="status-head">
      <span class="mono">PUSH STATUS / ${esc(meta.date || digest.date)}</span>
      <span class="live ${stale ? "stale" : ""}">${statusLabel}</span>
    </div>
    <div class="status-main">
      <span class="status-number">${String(stats.items ?? items.length).padStart(2, "0")}</span>
      <span class="status-unit">条本期条目<br />本期 ${esc(digest.window?.label || "快照")}</span>
    </div>
    <div class="status-grid">
      <div class="status-cell"><b>${stats.papers ?? "—"}</b><span>论文</span></div>
      <div class="status-cell"><b>${stats.security ?? "—"}</b><span>安全相关</span></div>
      <div class="status-cell"><b>${sourcesOk}/${sourcesTotal}</b><span>信源正常</span></div>
    </div>
    <div class="status-track" aria-label="推送流程">
      <span>01 采集</span><span>02 去重</span><span>03 分级</span><span>04 成刊</span><span>05 部署</span><span>06 分发</span>
    </div>
    <div class="status-foot">
      <span>上次快照<br /><b>${esc(formatDate(checked, true))}</b></span>
      <span>下次推送<br /><b>${esc(formatDate(next.toISOString(), true))}</b></span>
    </div>
  </aside>`;
}

function pickCard(pick, index) {
  const item = byId.get(pick.id);
  if (!item) return "";
  return `<article class="pick-card reveal">
    <div class="pick-index">${String(index + 1).padStart(2, "0")} / PICK</div>
    <div class="pick-kind">${kindBadge(item, true)} ${securityBadge(item, true)}</div>
    <h3><a href="${itemHref(item.id)}">${esc(itemTitle(item))}</a></h3>
    <p>${esc(truncate(itemSummary(item), 220))}</p>
    <div class="pick-note">${esc(pick.note || item.why || "")}</div>
    <div class="pick-foot">
      <span>${esc(item.source)} · ${esc(formatDate(item.published))}</span>
      <a href="${safeUrl(item.url)}" target="_blank" rel="noopener">原文 ↗</a>
    </div>
  </article>`;
}

function digestSection(section, sectionIndex) {
  const rows = (section.itemIds || [])
    .map((id, index) => {
      const item = byId.get(id);
      if (!item) return "";
      return `<div class="digest-row">
        <span class="row-index">${String(index + 1).padStart(2, "0")}</span>
        <div>
          <h4><a href="${itemHref(item.id)}">${esc(itemTitle(item))}</a></h4>
          <div class="row-summary">${esc(truncate(itemSummary(item), 105))}</div>
        </div>
        <div class="row-meta">${esc(item.source)}<br />${esc(formatDate(item.published))}</div>
      </div>`;
    })
    .join("");
  return `<section class="digest-section reveal" id="digest-section-${sectionIndex + 1}">
    <div class="digest-section-head">
      <h3>${esc(section.title)}</h3>
      <span class="mono faint">${String(section.count || section.itemIds?.length || 0).padStart(2, "0")} 条</span>
    </div>
    <p class="section-intro">${esc(section.intro || "")}</p>
    ${rows}
  </section>`;
}

function renderToday() {
  const stats = meta.stats || {};
  const picks = (digest.picks || []).map((pick, index) => pickCard(pick, index)).join("");
  const sections = (digest.sections || []).map(digestSection).join("");
  const sectionsToc = (digest.sections || [])
    .map(
      (section, index) =>
        `<li><button class="toc-button" type="button" data-action="scroll-to" data-target="digest-section-${index + 1}">${esc(section.title)}</button></li>`
    )
    .join("");
  return `<section class="hero">
    <div class="hero-copy reveal">
      <p class="kicker">AGENT MEMORY / DAILY PUSH · ${esc(digest.date || meta.date)}</p>
      <h1>记忆不该<br />被<span class="accent">遗忘</span>。</h1>
      <p class="lead">${esc(site.intro)}</p>
      <div class="hero-actions">
        <a class="button" href="#/feed">看全部动态 <span aria-hidden="true">→</span></a>
        <a class="button secondary" href="feed.xml">订阅 RSS <span aria-hidden="true">↗</span></a>
        <a class="button secondary" href="#/pipeline">推送怎么做</a>
      </div>
      <div class="hero-meta">
        <span><strong>${stats.items ?? items.length}</strong> 条本期</span>
        <span><strong>${stats.papers ?? "—"}</strong> 篇论文</span>
        <span><strong>${stats.security ?? "—"}</strong> 条安全</span>
        <span><strong>${esc(site.schedule.label)}</strong></span>
      </div>
    </div>
    ${statusPanel()}
  </section>

  <section class="section">
    <div class="section-head">
      <div><p class="index">01 / THE DAILY PUSH</p><h2>今天，记忆界发生了什么</h2></div>
      <p class="section-note">不是把所有新论文堆在一起。先按证据分级，再选出今天值得占你几分钟的几条。</p>
    </div>
    <div class="digest-shell">
      <div>
        <p class="digest-lead reveal">${esc(digest.lead)}</p>
        <p class="digest-note reveal">${esc(digest.editorNote)}</p>
        <div class="picks-grid">${picks}</div>
        <div class="digest-sections">${sections}</div>
      </div>
      <aside class="digest-aside reveal">
        <h3>本期目录</h3>
        <ol>${sectionsToc || "<li>暂无分栏</li>"}</ol>
        <div class="aside-stat"><span>本期条目</span><b>${stats.items ?? items.length}</b></div>
        <div class="aside-stat"><span>论文 / 新闻 / 发布</span><b>${stats.papers ?? "—"} / ${stats.news ?? "—"} / ${stats.releases ?? "—"}</b></div>
        <div class="aside-stat"><span>安全相关</span><b>${stats.security ?? "—"}</b></div>
        <div class="aside-stat"><span>信源正常</span><b>${meta.sourcesOk ?? "—"} / ${meta.sourcesTotal ?? "—"}</b></div>
        <div class="aside-stat"><span>页面模型调用</span><b>0 次</b></div>
      </aside>
    </div>
  </section>

  <section class="section">
    <div class="section-head">
      <div><p class="index">02 / ENTER THE INDEX</p><h2>按你关心的问题进入</h2></div>
      <p class="section-note">每个栏目都是同一份快照的不同切片；数据源、刷新节奏和失败方式写在“信源与推送”里。</p>
    </div>
    <div class="quick-grid">
      ${quickCard("记忆安全", `${stats.security ?? 0} 条`, "攻击、隐私、来源与治理", "#/security", "coral")}
      ${quickCard("主题地图", `${taxonomy.topics.length} 个主题`, "从机制到具身、多模态", "#/topics", "accent")}
      ${quickCard("项目与发布", `${projects.projects.length} 个项目`, "GitHub 星标快照与官方 release", "#/projects", "teal")}
      ${quickCard("Benchmark", `${benchmarks.benchmarks.length} 个基准`, "只做索引，不复刻分数", "#/benchmarks", "blue")}
    </div>
  </section>`;
}

function quickCard(title, value, note, href, tone) {
  return `<a class="quick-card ${tone} reveal" href="${href}">
    <span class="quick-value">${esc(value)}</span>
    <h3>${esc(title)}</h3>
    <p>${esc(note)}</p>
    <span class="quick-arrow" aria-hidden="true">↗</span>
  </a>`;
}

function itemCard(item, index, query = "") {
  const searchQuery = query || "";
  const tags = (item.topicLabels || (item.topics || []).map(topicLabel))
    .map((label, tagIndex) => {
      const topic = item.topics?.[tagIndex];
      return topic
        ? `<button class="tag" type="button" data-action="set-topic" data-topic="${esc(topic)}">${esc(label)}</button>`
        : `<span class="tag">${esc(label)}</span>`;
    })
    .join("");
  const extraTags = (item.tags || [])
    .filter((tagName) => !(item.topicLabels || []).includes(tagName))
    .slice(0, 3)
    .map((tagName) => `<span class="tag">${esc(tagName)}</span>`)
    .join("");
  return `<article class="item-card reveal" data-id="${esc(item.id)}">
    <div class="item-index">${String(index + 1).padStart(2, "0")}</div>
    <div class="item-main">
      <div class="item-top">
        ${kindBadge(item)}
        ${securityBadge(item)}
        <span class="item-source">${esc(item.source)}</span>
        <span class="item-date">${esc(formatDate(item.published))}</span>
        <span class="item-date">${esc(relative(item.published))}</span>
      </div>
      <h3 class="item-title"><a href="${itemHref(item.id)}">${highlight(itemTitle(item), searchQuery)}</a></h3>
      ${item.titleZh ? `<p class="item-subtitle">${esc(item.title)}</p>` : ""}
      <p class="item-summary">${highlight(truncate(itemSummary(item), 240), searchQuery)}</p>
      <div class="item-tags">${tags}${extraTags}</div>
      <div class="item-why"><b>WHY PUSH</b>${esc(item.why || "等待编辑补全推送理由。")}</div>
      <div class="item-foot">
        ${scoreBar(item)}
        ${evidenceBadge(item)}
        <a class="text-link" href="${safeUrl(item.url)}" target="_blank" rel="noopener">原文 ↗</a>
        <a class="text-link" href="${itemHref(item.id)}">详情 / 证据 →</a>
        ${item.security ? `<span class="mono" style="color:var(--coral)">SEC · ${esc(item.security.angles.map((angle) => ANGLE_LABELS[angle] || angle).join(" / "))}</span>` : ""}
      </div>
      <details class="item-details">
        <summary>展开原文摘要、来源与时间</summary>
        <div class="detail-body">
          <dl class="detail-block">
            <dt>原文摘要</dt><dd>${esc(item.summary || "未提供原文摘要。")}</dd>
            <dt>证据等级</dt><dd>${esc(item.evidence || "未标注")}</dd>
            <dt>发表时间</dt><dd>${esc(formatDate(item.published, true))} · ${esc(item.source)}</dd>
            <dt>推送分</dt><dd>${esc(String(item.score ?? "—"))} / 100（编辑排序，不是质量评分）</dd>
            ${item.security ? `<dt>安全备注</dt><dd>${esc(item.security.note || "")}</dd>` : ""}
          </dl>
        </div>
      </details>
    </div>
  </article>`;
}

function filteredItems() {
  const now = Date.now();
  const query = state.feed.q.trim().toLowerCase();
  let list = items.filter((item) => {
    if (state.feed.kind !== "all" && item.kind !== state.feed.kind) return false;
    if (state.feed.topic !== "all" && !(item.topics || []).includes(state.feed.topic)) return false;
    if (state.feed.security && !item.security) return false;
    if (state.feed.range !== "all") {
      const published = Date.parse(item.published);
      if (!Number.isFinite(published)) return false;
      if (state.feed.range === "today") {
        if (formatDate(item.published) !== formatDate(new Date().toISOString())) return false;
      } else {
        const days = Number(state.feed.range);
        if (now - published > days * 86400000) return false;
      }
    }
    if (query) {
      const haystack = [item.title, item.titleZh, item.summary, item.summaryZh, item.source, ...(item.tags || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  list = list.sort((a, b) =>
    state.feed.sort === "score"
      ? Number(b.score || 0) - Number(a.score || 0)
      : String(b.published).localeCompare(String(a.published))
  );
  return list;
}

function renderFeedResults() {
  const container = $("#feed-results");
  if (!container) return;
  const list = filteredItems();
  const visible = list.slice(0, state.feed.limit);
  const count = $("#feed-count");
  if (count) count.textContent = `${list.length} 条 · 显示 ${visible.length} 条`;
  container.innerHTML = visible.length
    ? visible.map((item, index) => itemCard(item, index, state.feed.q)).join("")
    : `<div class="empty"><strong>没有命中</strong><p>换一个关键词，或清空筛选。也可以直接看 <a href="feed.xml">RSS</a>。</p><button class="button secondary" type="button" data-action="clear-filters">清空筛选</button></div>`;
  const more = $("#feed-more");
  if (more) {
    more.hidden = visible.length >= list.length;
    more.textContent = `加载更多（还有 ${Math.max(0, list.length - visible.length)} 条）`;
  }
  bindViewEvents();
  observeReveal();
}

function renderFeed() {
  const count = items.length;
  const topicOptions = taxonomy.topics
    .map((topic) => {
      const topicCount = meta.stats?.byTopic?.[topic.id] ?? items.filter((item) => item.topics?.includes(topic.id)).length;
      return `<option value="${esc(topic.id)}"${state.feed.topic === topic.id ? " selected" : ""}>${esc(topic.label)} (${topicCount})</option>`;
    })
    .join("");
  return `<section class="section" style="border-bottom:0;padding-top:44px">
    <div class="section-head">
      <div><p class="index">THE INDEX / ${count} ITEMS</p><h2>全部动态</h2></div>
      <p class="section-note">同一份每日快照，按类型、主题、时间和关键词切片。所有排序都在浏览器里完成，不触发模型调用。</p>
    </div>
    <div class="filterbar">
      <div class="chips" role="group" aria-label="类型筛选">
        ${["all", "paper", "news", "release"].map((kind) => `<button class="chip ${state.feed.kind === kind ? "active" : ""}" type="button" data-action="set-kind" data-kind="${kind}">${kind === "all" ? "全部" : KIND_LABELS[kind]} <span class="count">${kind === "all" ? count : (meta.stats?.byKind?.[kind] ?? items.filter((item) => item.kind === kind).length)}</span></button>`).join("")}
        <button class="chip ${state.feed.security ? "active" : ""}" type="button" data-action="toggle-security">只看安全 <span class="count">${meta.stats?.security ?? items.filter((item) => item.security).length}</span></button>
      </div>
      <div class="search-wrap">
        <label class="sr-only" for="feed-search">搜索标题、摘要与来源</label>
        <input id="feed-search" type="search" placeholder="搜索标题、摘要、来源…" value="${esc(state.feed.q)}" autocomplete="off" />
      </div>
      <div class="select-wrap"><label for="feed-topic">主题</label><select id="feed-topic"><option value="all">全部主题</option>${topicOptions}</select></div>
      <div class="select-wrap"><label for="feed-range">时间</label><select id="feed-range">${Object.entries(RANGE_LABELS).map(([value, label]) => `<option value="${value}"${state.feed.range === value ? " selected" : ""}>${label}</option>`).join("")}</select></div>
      <div class="select-wrap"><label for="feed-sort">排序</label><select id="feed-sort"><option value="newest"${state.feed.sort === "newest" ? " selected" : ""}>最新在前</option><option value="score"${state.feed.sort === "score" ? " selected" : ""}>推送分</option></select></div>
      <button class="chip" type="button" data-action="clear-filters">清空</button>
    </div>
    <div class="results-meta"><span id="feed-count"></span><span>快照 ${esc(formatDate(meta.checkedAt, true))} · 不调用模型</span></div>
    <div id="feed-results" class="item-list"></div>
    <div style="text-align:center;margin-top:24px"><button class="button secondary" id="feed-more" type="button" data-action="load-more" hidden>加载更多</button></div>
  </section>`;
}

function renderSecurity() {
  const securityItems = items.filter((item) => item.security);
  const angleCounts = Object.fromEntries(
    Object.keys(ANGLE_LABELS).map((angle) => [
      angle,
      securityItems.filter((item) => item.security.angles.includes(angle)).length
    ])
  );
  const list =
    state.securityAngle === "all"
      ? securityItems
      : securityItems.filter((item) => item.security.angles.includes(state.securityAngle));
  return `<section class="section" style="border-bottom:0;padding-top:44px">
    <div class="section-head">
      <div><p class="index">SECURITY / ${securityItems.length} ITEMS</p><h2>记忆安全</h2></div>
      <p class="section-note">记忆一旦写入，就会在会话结束后继续存在。安全不是一个过滤器，而是写入、存储、检索、执行与遗忘的整条生命周期。</p>
    </div>
    <div class="security-banner">
      <div class="security-quote reveal">
        <p>“攻击者不需要一直在线。一次成功的写入，<em>可以在很多轮对话之后</em>才被触发。”</p>
        <span>这也是为什么单轮提示注入防御不够：评测要看载荷在会话结束后的存活。</span>
      </div>
      <div class="security-quote reveal">
        <p style="font-size:20px">${securityItems.length} 条安全相关</p>
        <span>${Object.entries(angleCounts).map(([angle, value]) => `${ANGLE_LABELS[angle]} ${value}`).join(" · ")}<br />按规则命中与编辑复核标注，不等同于安全认证。</span>
      </div>
    </div>
    <div class="lifecycle">
      ${[
        ["01", "写入", "哪些内容有资格进入记忆？谁授权？"],
        ["02", "存储", "来源、版本、权限与加密是否随内容保存？"],
        ["03", "检索", "低信任内容会不会被当成用户指令？"],
        ["04", "执行", "动作提交前是否比较来源与替代方案？"],
        ["05", "遗忘", "删除、回滚与审计是否真的可验证？"]
      ]
        .map(([number, title, note]) => `<div class="lifecycle-stage reveal"><b>${number} / LIFECYCLE</b><h4>${title}</h4><p>${note}</p></div>`)
        .join("")}
    </div>
    <div class="filterbar" style="position:static;margin-bottom:18px">
      <div class="chips" role="group" aria-label="安全角度筛选">
        <button class="chip ${state.securityAngle === "all" ? "active" : ""}" type="button" data-action="set-angle" data-angle="all">全部角度 <span class="count">${securityItems.length}</span></button>
        ${Object.entries(ANGLE_LABELS).map(([angle, label]) => `<button class="chip ${state.securityAngle === angle ? "active" : ""}" type="button" data-action="set-angle" data-angle="${angle}">${label} <span class="count">${angleCounts[angle]}</span></button>`).join("")}
      </div>
    </div>
    <div class="item-list">${list.map((item, index) => itemCard(item, index)).join("") || `<div class="empty"><strong>这个角度暂无条目</strong><p>换一个角度，或者回到全部动态。</p></div>`}</div>
  </section>`;
}

function renderOrbit() {
  const counts =
    meta.stats?.byTopic ||
    Object.fromEntries(taxonomy.topics.map((topic) => [topic.id, items.filter((item) => item.topics?.includes(topic.id)).length]));
  const max = Math.max(1, ...Object.values(counts));
  const center = 200;
  const radius = 138;
  const topics = taxonomy.topics;
  const nodes = topics
    .map((topic, index) => {
      const angle = (Math.PI * 2 * index) / topics.length - Math.PI / 2;
      const x = center + Math.cos(angle) * radius;
      const y = center + Math.sin(angle) * radius;
      const count = counts[topic.id] || 0;
      const size = 4 + (count / max) * 12;
      const labelX = center + Math.cos(angle) * (radius + 28);
      const labelY = center + Math.sin(angle) * (radius + 28);
      const anchor = Math.cos(angle) > 0.2 ? "start" : Math.cos(angle) < -0.2 ? "end" : "middle";
      return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="#d7ff4f" stroke-opacity="${count ? 0.16 : 0.06}" />
        <circle cx="${x}" cy="${y}" r="${size}" fill="${count ? "#d7ff4f" : "#6e786f"}" fill-opacity="${count ? 0.85 : 0.35}" />
        <text x="${labelX}" y="${labelY}" text-anchor="${anchor}">${esc(topic.short)}</text>
        <text class="orbit-count" x="${labelX}" y="${labelY + 12}" text-anchor="${anchor}">${count}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 400 400" role="img" aria-label="主题关系轨道图">
    <circle cx="200" cy="200" r="138" fill="none" stroke="#ece7da" stroke-opacity=".15" />
    <circle cx="200" cy="200" r="86" fill="none" stroke="#ece7da" stroke-opacity=".08" />
    <circle cx="200" cy="200" r="44" fill="none" stroke="#ece7da" stroke-opacity=".08" />
    ${nodes}
    <text class="orbit-center" x="200" y="196" text-anchor="middle">AGENT</text>
    <text class="orbit-center" x="200" y="214" text-anchor="middle">MEMORY</text>
  </svg>`;
}

function renderTopics() {
  const counts =
    meta.stats?.byTopic ||
    Object.fromEntries(taxonomy.topics.map((topic) => [topic.id, items.filter((item) => item.topics?.includes(topic.id)).length]));
  const max = Math.max(1, ...Object.values(counts));
  return `<section class="section" style="border-bottom:0;padding-top:44px">
    <div class="section-head">
      <div><p class="index">TOPIC MAP / ${taxonomy.topics.length} TOPICS</p><h2>主题地图</h2></div>
      <p class="section-note">分类是阅读导航，不是论文质量评分。一个条目可以保留多个标签；跨领域内容不会被强行塞进单一主题。</p>
    </div>
    <div class="topic-layout">
      <div>
        <div class="topic-grid">
          ${taxonomy.topics
            .map((topic) => {
              const count = counts[topic.id] || 0;
              return `<button class="topic-card reveal" type="button" data-action="set-topic" data-topic="${esc(topic.id)}">
                <span class="topic-count">${String(count).padStart(2, "0")} ITEMS</span>
                <h3>${esc(topic.label)}</h3>
                <p>${esc(topic.desc)}</p>
                <span class="topic-bar"><i style="width:${Math.max(3, (count / max) * 100)}%"></i></span>
              </button>`;
            })
            .join("")}
        </div>
        <div class="survey-list">
          ${surveys.surveys
            .map(
              (survey) => `<a class="survey-row reveal" href="${safeUrl(survey.url)}" target="_blank" rel="noopener">
                <span class="refs">${survey.referenceCount || "—"}<br /><span class="mono faint">refs</span></span>
                <div><h4>${esc(survey.titleZh || survey.title)}</h4><p>${esc(survey.note || "")}</p></div>
                <span class="survey-meta">${esc(survey.published || "")}<br />arXiv ↗</span>
              </a>`
            )
            .join("")}
        </div>
      </div>
      <aside>
        <div class="orbit-panel reveal">
          <h3>Topic orbit / 本期条目数</h3>
          <div class="orbit">${renderOrbit()}</div>
          <p class="mono faint" style="margin-top:8px;line-height:1.7">圆点大小 = 本期条目数。轨道图只表示分布，不表示主题之间的因果或层级关系。</p>
        </div>
        <div class="orbit-panel reveal" style="position:static;margin-top:16px">
          <h3>五个辅助维度</h3>
          <div class="dimension-list">
            ${taxonomy.dimensions
              .map(
                (dimension) => `<div class="dimension-row"><b>${esc(dimension.label)}</b><span>${esc(dimension.question)}<br />${dimension.terms.map(esc).join(" · ")}</span></div>`
              )
              .join("")}
          </div>
        </div>
      </aside>
    </div>
  </section>`;
}

function renderProjects() {
  const categories = [...new Set(projects.projects.map((project) => project.category).filter(Boolean))].sort();
  let list = projects.projects.filter(
    (project) => state.projectCategory === "all" || project.category === state.projectCategory
  );
  list = list.sort((a, b) =>
    state.projectSort === "name"
      ? String(a.fullName).localeCompare(String(b.fullName))
      : state.projectSort === "recent"
        ? String(b.updatedAt).localeCompare(String(a.updatedAt))
        : Number(b.stars || 0) - Number(a.stars || 0)
  );
  const releases = items.filter((item) => item.kind === "release").sort((a, b) => String(b.published).localeCompare(String(a.published)));
  return `<section class="section" style="border-bottom:0;padding-top:44px">
    <div class="section-head">
      <div><p class="index">PROJECTS / GITHUB SNAPSHOT</p><h2>项目与发布</h2></div>
      <p class="section-note">Stars 是 GitHub 快照，不是热度结论。基础设施项目会被标注，避免把“向量库”误当成完整的记忆系统。</p>
    </div>
    <div class="filterbar" style="position:static;margin-bottom:18px">
      <div class="chips" role="group" aria-label="项目分类">
        <button class="chip ${state.projectCategory === "all" ? "active" : ""}" type="button" data-action="set-project-category" data-category="all">全部分类</button>
        ${categories.map((category) => `<button class="chip ${state.projectCategory === category ? "active" : ""}" type="button" data-action="set-project-category" data-category="${esc(category)}">${esc(category)}</button>`).join("")}
      </div>
      <div class="section-tools" style="margin-left:auto">
        <button class="sort-button ${state.projectSort === "stars" ? "active" : ""}" type="button" data-action="set-project-sort" data-sort="stars">Stars</button>
        <button class="sort-button ${state.projectSort === "recent" ? "active" : ""}" type="button" data-action="set-project-sort" data-sort="recent">最近更新</button>
        <button class="sort-button ${state.projectSort === "name" ? "active" : ""}" type="button" data-action="set-project-sort" data-sort="name">名称</button>
      </div>
    </div>
    <div class="project-grid">
      ${list
        .map(
          (project, index) => `<a class="project-card reveal" href="${safeUrl(project.url)}" target="_blank" rel="noopener">
            <div class="project-top">
              <span class="project-rank">${String(index + 1).padStart(2, "0")} / ${esc(project.category || "PROJECT")}</span>
              <span class="project-stars">★ ${starFmt(project.stars)}</span>
            </div>
            <h3>${esc(project.fullName)}<small>${esc(project.descriptionZh || "")}</small></h3>
            <p>${esc(project.why || "")}</p>
            <div class="project-why"><b>收录理由</b>${project.note ? esc(project.note) : "与 Agent 记忆直接相关，或构成其检索基础设施。"}</div>
            <div class="project-meta">
              <span>${esc(project.language || "语言未标注")}</span>
              <span>${esc(project.license || "许可未标注")}</span>
              <span>更新 ${esc(formatDate(project.updatedAt))}</span>
              <span>★ 快照 ${esc(formatDate(project.starsCheckedAt))}</span>
            </div>
          </a>`
        )
        .join("")}
    </div>
    <div class="section" style="padding-bottom:0">
      <div class="section-head">
        <div><p class="index">RELEASES / ${releases.length} ITEMS</p><h2>官方发布</h2></div>
        <p class="section-note">只收官方 release；版本变更以 release note 为准，本站不推断兼容性。</p>
      </div>
      <div class="release-list">
        ${releases
          .map(
            (item) => `<div class="release-row">
              <span class="release-source">${esc(item.source)}</span>
              <div><h4><a href="${itemHref(item.id)}">${esc(itemTitle(item))}</a></h4><p>${esc(truncate(item.why || item.summaryZh || "", 120))}</p></div>
              <time>${esc(formatDate(item.published))}</time>
            </div>`
          )
          .join("")}
      </div>
    </div>
  </section>`;
}

function renderBenchmarks() {
  const dimensionById = new Map(benchmarks.dimensions.map((dimension) => [dimension.id, dimension]));
  const related = items.filter((item) => (item.topics || []).includes("evaluation") || item.topics?.includes("survey")).slice(0, 5);
  return `<section class="section" style="border-bottom:0;padding-top:44px">
    <div class="section-head">
      <div><p class="index">BENCHMARKS / INDEX ONLY</p><h2>Benchmark</h2></div>
      <p class="section-note">本站只做评测索引：链接到官方仓库或论文，不复刻榜单分数。覆盖维度是编辑整理，不是官方评分。</p>
    </div>
    <div class="bench-layout">
      <div>
        <div class="bench-grid">
          ${benchmarks.benchmarks
            .map(
              (benchmark) => `<a class="bench-card reveal" href="${safeUrl(benchmark.url)}" target="_blank" rel="noopener">
                <span class="bench-kind">${esc(benchmark.kind || "评测")} / OFFICIAL ↗</span>
                <h3>${esc(benchmark.name)}</h3>
                <p>${esc(benchmark.desc)}</p>
                <div class="bench-covers">${(benchmark.covers || []).map((id) => `<span>${esc(dimensionById.get(id)?.label || id)}</span>`).join("")}</div>
                <p class="mono faint" style="font-size:10px">${esc(benchmark.note || "")}</p>
              </a>`
            )
            .join("")}
        </div>
        <div class="matrix-wrap reveal">
          <table class="matrix">
            <thead><tr><th>Benchmark</th>${benchmarks.dimensions.map((dimension) => `<th>${esc(dimension.label)}</th>`).join("")}</tr></thead>
            <tbody>
              ${benchmarks.benchmarks
                .map(
                  (benchmark) => `<tr>
                    <td><a class="bench-name" href="${safeUrl(benchmark.url)}" target="_blank" rel="noopener">${esc(benchmark.name)}</a></td>
                    ${benchmarks.dimensions.map((dimension) => `<td><span class="dot ${benchmark.covers?.includes(dimension.id) ? "" : "dim"}"></span></td>`).join("")}
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
      <aside class="bench-note reveal">
        <h3>怎么读榜</h3>
        <ol>
          <li>先看基座模型。同一个记忆系统换模型，分数会变；跨表比较往往没有意义。</li>
          <li>再看协议。长期对话、任务闭环、多模态和安全评测不是同一个东西。</li>
          <li>再看提交方式。官方提交、作者自测、厂商新闻稿要分开看。</li>
          <li>最后看时间。榜单会更新，本站不复制分数，避免把旧数字当结论。</li>
        </ol>
        <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line)">
          <p class="mono faint" style="font-size:10px;line-height:1.8">相关条目：</p>
          ${related.map((item) => `<a class="text-link" style="display:block;margin-top:8px" href="${itemHref(item.id)}">${esc(itemTitle(item))} →</a>`).join("")}
        </div>
      </aside>
    </div>
  </section>`;
}

function flowRow(column, trigger, source, artifact, freshness, failure) {
  return `<tr><td>${esc(column)}</td><td>${esc(trigger)}</td><td>${esc(source)}</td><td>${esc(artifact)}</td><td>${esc(freshness)}</td><td>${esc(failure)}</td></tr>`;
}

function renderPipeline() {
  const sourceList = sources.sources || [];
  const okCount = sourceList.filter((source) => source.status === "ok").length;
  const stats = meta.stats || {};
  return `<section class="section" style="border-bottom:0;padding-top:44px">
    <div class="pipeline-hero">
      <div class="pipeline-copy reveal">
        <p class="kicker">PIPELINE / HOW THE PUSH WORKS</p>
        <h2>推送不是一个按钮，<br />是一条有状态的流水线。</h2>
        <p>GitHub Pages 只负责托管静态文件。真正的“推送”发生在 Actions：定时采集、去重、分类、成刊、构建，再把 JSON、RSS 和页面一起部署。读者打开页面时不会触发模型调用，也不会访问外部 API。</p>
      </div>
      <div class="pipeline-stats reveal">
        <div class="pipeline-stat"><b>${okCount}/${sourceList.length}</b><span>信源正常</span></div>
        <div class="pipeline-stat"><b>${stats.items ?? items.length}</b><span>本期条目</span></div>
        <div class="pipeline-stat"><b>08:10</b><span>北京时间 / 每日</span></div>
        <div class="pipeline-stat"><b>0</b><span>页面模型调用</span></div>
      </div>
    </div>

    <div class="pipeline-track reveal" aria-label="推送流水线">
      ${[
        ["01", "采集", "daily 08:10", "arXiv / HF / Releases / RSS", "按源设置超时、重试与分页上限；失败写入状态。"],
        ["02", "归一化", "同一运行", "标题、摘要、日期、arXiv ID", "合并 arXiv 与 HF 的同一篇论文；保留原始链接。"],
        ["03", "筛选", "规则 + 可选模型", "相关性、主题、证据等级", "缺少 Agent/记忆交集的条目丢弃；厂商自测降级。"],
        ["04", "成刊", "同一运行", "digest + picks", "今日重点按主题分散；不把同一主题塞满。"],
        ["05", "构建", "同一运行", "JSON / RSS / llms.txt", "校验 ID、日期和栏目引用；构建失败不覆盖旧站。"],
        ["06", "分发", "部署后", "RSS / 飞书 / Telegram", "按日期去重；通知失败不影响站点发布。"]
      ]
        .map(
          ([number, title, cadence, artifact, note]) => `<div class="station">
            <span class="station-no">${number}</span>
            <h4>${title}</h4>
            <div class="station-cadence">${esc(cadence)}</div>
            <p><strong style="color:var(--muted)">${esc(artifact)}</strong><br />${esc(note)}</p>
          </div>`
        )
        .join("")}
    </div>

    <div class="section-head">
      <div><p class="index">CONTRACT / PER COLUMN</p><h2>每个栏目怎么推送</h2></div>
      <p class="section-note">每个栏目都写清触发、来源、产物、新鲜度字段和失败方式。没有产物的栏目，不做假开关。</p>
    </div>
    <div class="flow-table-wrap reveal">
      <table class="flow-table">
        <thead><tr><th>栏目</th><th>触发</th><th>来源</th><th>产物</th><th>新鲜度</th><th>失败时</th></tr></thead>
        <tbody>
          ${flowRow("今日推送", "每天 08:10（cron）", "同一份 items 快照", "data/digests/YYYY-MM-DD.json", "generatedAt / checkedAt", "保留上一期，页面显示 stale")}
          ${flowRow("全部动态", "随快照", "data/items.json", "data/items.json + api/v1/items.json", "checkedAt", "旧快照继续可读")}
          ${flowRow("记忆安全", "规则 + 编辑复核", "items 的 security 字段", "security.angles + note", "随条目", "没有命中就不显示，不硬凑")}
          ${flowRow("主题地图", "构建时汇总", "taxonomy + items", "counts / topic orbit", "taxonomyVersion", "分类失败则不发布该构建")}
          ${flowRow("项目", "每日 / 每周一", "GitHub Releases + Search API", "data/projects.json", "starsCheckedAt", "保留上次星数并标时间")}
          ${flowRow("Benchmark", "人工核对", "官方仓库 / 论文", "data/benchmarks.json", "checkedAt", "不自动改分；保留上一定义")}
          ${flowRow("信源状态", "每次采集", "每个源的请求结果", "data/sources.json", "lastCheckedAt / lastSuccessAt", "错误直接展示，不隐藏")}
          ${flowRow("RSS", "构建后", "items + digest", "feed.xml", "lastBuildDate / pubDate", "订阅器继续读旧缓存")}
          ${flowRow("JSON", "构建后", "items + digest", "api/v1/*.json", "generatedAt", "静态 404，不影响页面")}
          ${flowRow("飞书 / Telegram", "成刊后", "notify.mjs", "卡片 / 消息", "按日期去重", "3 次重试；失败只记日志")}
          ${flowRow("IndexNow", "部署后（可选）", "sitemap URL", "提交请求", "提交记录", "失败不影响站点")}
          ${flowRow("Web Push", "不支持", "无服务端订阅存储", "—", "—", "不提供假开关")}
        </tbody>
      </table>
    </div>

    <div class="section" style="padding-bottom:0">
      <div class="section-head">
        <div><p class="index">SOURCE HEALTH</p><h2>信源状态</h2></div>
        <p class="section-note">${esc(sources.note || "失败可见，是推送系统的一部分。时间均为本次构建读取到的状态。")}</p>
      </div>
      <div class="source-table-wrap">
        <table class="source-table">
          <thead><tr><th>信源</th><th>类型</th><th>本次候选</th><th>检查时间</th><th>上次成功</th><th>状态</th></tr></thead>
          <tbody>
            ${sourceList
              .map((source) => {
                const statusLabel = source.status === "ok" ? "正常" : source.status === "error" ? "失败" : "等待运行";
                return `<tr>
                  <td><div class="source-name"><span class="status-dot ${esc(source.status)}"></span><span>${esc(source.name)}<small>${esc(source.note || "")}</small></span></div></td>
                  <td>${esc(source.kind || "")}</td>
                  <td>${source.returned ?? "—"}${source.scanned ? `<br /><span class="mono faint">扫描 ${source.scanned}</span>` : ""}</td>
                  <td>${esc(source.lastCheckedAt ? formatDate(source.lastCheckedAt, true) : "—")}</td>
                  <td>${esc(source.lastSuccessAt ? formatDate(source.lastSuccessAt, true) : "—")}</td>
                  <td><span class="source-${source.status === "ok" ? "ok" : "error"}">${statusLabel}${source.error ? `<br />${esc(source.error)}` : ""}</span></td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="section" style="padding-bottom:0">
      <div class="section-head">
        <div><p class="index">CHANNELS</p><h2>读者侧的推送通道</h2></div>
        <p class="section-note">能做的做，不能做的不装。RSS 和 JSON 是承诺；飞书 / Telegram 需要配置密钥；Web Push 在纯静态站上不成立。</p>
      </div>
      <div class="channel-grid">
        ${site.channels
          .map(
            (channel) => `<div class="channel-card reveal">
              <div class="channel-top"><h4>${esc(channel.name)}</h4><span class="channel-state ${esc(channel.state)}">${channel.state === "on" ? "ON" : channel.state === "optional" ? "OPTIONAL" : "OFF"}</span></div>
              <p>${esc(channel.detail)}</p>
              <span class="channel-cadence">${esc(channel.cadence)}</span>
            </div>`
          )
          .join("")}
      </div>
      <div class="callout reveal">
        <h4>为什么没有 Web Push</h4>
        <p>Web Push 需要一个服务端保存订阅、持有 VAPID 私钥并发送通知。GitHub Pages 只托管静态文件，没有这个服务端。用 Service Worker 在本地“模拟”通知，用户关掉页面就失效，那是假 Push。这里的替代方案是 RSS、飞书 / Telegram（Actions 发出）和页面打开时的快照巡检。</p>
      </div>
    </div>

    <div class="section" style="padding-bottom:0">
      <div class="section-head">
        <div><p class="index">ONE RUN</p><h2>一次推送的时序</h2></div>
        <p class="section-note">时间以北京时间为准。GitHub Actions 的 cron 可能延迟几分钟，页面不承诺秒级。</p>
      </div>
      <div class="timeline">
        ${[
          ["08:10", "触发", "Actions 按 cron 启动；也可以手动 workflow_dispatch。"],
          ["08:10–08:12", "采集", "并发请求 arXiv、HF、GitHub Releases 与 RSS；每个源独立超时。"],
          ["08:12", "归一化", "合并 arXiv / HF 的同一篇论文，清理追踪参数，保留原始链接。"],
          ["08:13", "筛选与分级", "相关性规则；厂商自测、评论文章、媒体报道分别标注证据等级。"],
          ["08:14", "成刊", "选 picks，按主题分散；写入 digest 与栏目引用。"],
          ["08:15", "构建", "生成 JSON、RSS、llms.txt、sitemap；校验 ID 与日期。"],
          ["08:16", "部署", "上传 Pages artifact 并发布；失败时保留上一版。"],
          ["08:17", "通知", "可选：飞书卡片 / Telegram；按日期去重。"],
          ["08:20", "索引", "可选：IndexNow 提交 URL；失败只记日志。"]
        ]
          .map(([time, title, note]) => `<div class="timeline-step"><time>${time}</time><h4>${title}</h4><p>${note}</p></div>`)
          .join("")}
      </div>
    </div>

    <div class="section" style="padding-bottom:0">
      <div class="section-head">
        <div><p class="index">REPRODUCE</p><h2>本地复现</h2></div>
        <p class="section-note">不需要数据库，不需要框架。Node 24 直接跑。</p>
      </div>
      <div class="prose" style="margin:0;max-width:none">
        <pre style="overflow:auto;border:1px solid var(--line);background:var(--surface);padding:18px;font-family:var(--mono);font-size:12px;line-height:1.8;color:var(--muted)">node scripts/collect.mjs          # 采集真实信源，写 src/data
node scripts/build.mjs            # 生成 dist、RSS、JSON、llms.txt
node scripts/notify.mjs --dry-run # 打印飞书卡片，不发送
node scripts/serve.mjs            # http://127.0.0.1:4173/agent-memory-push/</pre>
        <p><a href="https://github.com/yangxc0414/agent-memory-push" rel="noopener">仓库与 Actions 配置 ↗</a></p>
      </div>
    </div>
  </section>`;
}

function renderMethod() {
  return `<section class="method-hero">
    <p class="kicker">METHOD / A REFLECTION ON PUSH</p>
    <h1>把“推送”拆开看，<br />它其实是一份契约。</h1>
    <p class="lead">参考站看起来像在“每天推送”，但浏览器里没有 Push API，也没有 WebSocket。它做的是一件事：在服务端定时生成一份快照，然后把快照以页面、RSS 和 JSON 三种形式摆出来。读者是否回来，是读者的动作；站点能做的是把“新鲜”和“失败”说清楚。</p>
    <div class="method-meta"><span>READING TIME ≈ 12 MIN</span><span>SNAPSHOT ${esc(formatDate(meta.checkedAt, true))}</span><span>NO MODEL CALLS IN BROWSER</span></div>
    <div class="method-toc">
      <a href="#/method" data-scroll="method-reference">参考站怎么做的</a>
      <a href="#/method" data-scroll="method-columns">每个栏目的契约</a>
      <a href="#/method" data-scroll="method-aihot">AIHOT 里借了什么</a>
      <a href="#/method" data-scroll="method-pages">搬到 Pages 变了什么</a>
      <a href="#/method" data-scroll="method-limits">局限</a>
    </div>
  </section>
  <section class="section">
    <article class="prose">
      <p class="prose-hero-quote">“推送”不是把内容塞给读者，而是让读者在回来的时候，能一眼判断：这是什么时候的、从哪里来的、值不值得信。</p>

      <h2 id="method-reference">一、参考站是怎么“推送”的</h2>
      <p>我检查了 <a href="https://agent-memory-hot.pale-rook-5118.chatgpt.site/" target="_blank" rel="noopener">Agent Memory Hot</a> 的前端：没有 Service Worker，没有 <code>pushManager</code>，没有 <code>Notification</code>，也没有轮询定时器。页面脚本只做四类请求：<code>/api/items</code>、<code>/api/projects</code>、<code>/api/benchmarks</code>、<code>/api/surveys</code>，外加一个手动“刷新列表”按钮。RSS 是 <code>/feed.xml</code>，全量数据在 <code>/api/export</code>。</p>
      <p>所以它的“推送”发生在服务端，而不是浏览器：按日采集一批公开源，去重、审核、写中文摘要、分类，生成一个带 <code>checkedAt</code> 的快照；页面和 RSS 只是读取这个快照。每日速览、历史归档、记忆安全、主题地图这些栏目，本质上都是同一份 items 的不同切片；项目、Benchmark、综述则各有自己的接口和时间戳。</p>
      <div class="table-wrap"><table>
        <thead><tr><th>参考站栏目</th><th>数据从哪来</th><th>实际更新方式</th><th>读者感知</th></tr></thead>
        <tbody>
          <tr><td>最新动态</td><td><code>/api/items</code> 全量快照</td><td>服务端每日采集；页面手动刷新</td><td>刷新按钮 + 条目时间</td></tr>
          <tr><td>每日速览</td><td>同一份 items，按日期切片</td><td>浏览器端计算，没有单独日报文件</td><td>当天条目聚合</td></tr>
          <tr><td>历史归档</td><td>同一份 items，按天分组</td><td>浏览器端计算</td><td>日期目录</td></tr>
          <tr><td>记忆安全</td><td><code>securityReview</code> 字段</td><td>采集时审核写入</td><td>安全角度筛选</td></tr>
          <tr><td>主题地图</td><td>taxonomy + 硬编码 roadmap + <code>/api/surveys</code></td><td>部分静态，部分接口</td><td>主题节点与综述引用</td></tr>
          <tr><td>Benchmark</td><td><code>/api/benchmarks</code></td><td>人工核对，<code>verifiedAt</code></td><td>榜单表格与协议切换</td></tr>
          <tr><td>GitHub 项目</td><td><code>/api/projects</code></td><td>GitHub API 快照，<code>starsCheckedAt</code></td><td>星数与更新时间</td></tr>
          <tr><td>信源管理</td><td><code>sources</code> 数组</td><td>每次采集写状态</td><td>正常 / 失败 / 截断</td></tr>
          <tr><td>RSS</td><td><code>/feed.xml</code></td><td>服务端生成</td><td>订阅器轮询</td></tr>
        </tbody>
      </table></div>
      <p>这个设计有几个值得学的地方：<strong>失败是可见的</strong>。源状态会显示“读取失败”“分页截断，需补查”，候选数和扫描数分开写；<strong>时间口径是明确的</strong>。论文首次提交、正式公告、修订、新闻发布、项目星标各有各的时间；<strong>栏目不是越多越好</strong>。它把“每天有什么”与“长期坐标”分开，避免所有内容都挤进一个时间流。</p>
      <p>它也有明显的边界：每次取全量快照（<code>no-store</code>），没有增量接口；没有 ETag / 条件请求；Web Push 不存在；Benchmark 分数是人工维护的；页面刷新是手动的。它是一份<em>每日编辑产品</em>，不是实时系统。</p>

      <h2 id="method-columns">二、每个栏目应该有一份推送契约</h2>
      <p>“这个栏目怎么更新”不能只写一句“每天更新”。至少要说清五件事：触发是什么、数据从哪来、产物是什么、新鲜度看哪个字段、失败时读者看到什么。本站把这份契约直接放在“信源与推送”页里，下面是摘要：</p>
      <div class="table-wrap"><table>
        <thead><tr><th>栏目</th><th>触发</th><th>产物</th><th>新鲜度</th><th>失败时</th></tr></thead>
        <tbody>
          <tr><td>今日推送</td><td>每天 08:10</td><td><code>data/digests/YYYY-MM-DD.json</code></td><td><code>generatedAt</code></td><td>保留上一期，标 stale</td></tr>
          <tr><td>全部动态</td><td>随快照</td><td><code>data/items.json</code></td><td><code>checkedAt</code></td><td>旧快照继续可读</td></tr>
          <tr><td>记忆安全</td><td>规则 + 复核</td><td><code>security.angles</code></td><td>随条目</td><td>不硬凑条目</td></tr>
          <tr><td>主题地图</td><td>构建时</td><td>counts + orbit</td><td><code>taxonomyVersion</code></td><td>构建失败不发布</td></tr>
          <tr><td>项目</td><td>每日 / 每周</td><td><code>projects.json</code></td><td><code>starsCheckedAt</code></td><td>保留上次星数</td></tr>
          <tr><td>Benchmark</td><td>人工</td><td><code>benchmarks.json</code></td><td><code>checkedAt</code></td><td>不自动改分</td></tr>
          <tr><td>信源</td><td>每次采集</td><td><code>sources.json</code></td><td><code>lastCheckedAt</code></td><td>错误直接展示</td></tr>
          <tr><td>RSS</td><td>构建后</td><td><code>feed.xml</code></td><td><code>lastBuildDate</code></td><td>旧缓存继续用</td></tr>
        </tbody>
      </table></div>
      <p>这份表也解释了为什么有些“推送”不该做：如果一个栏目没有独立的数据源和产物，就不要给它单独做一个推送开关。那只是把同一个快照切了两次，增加了维护面，没有增加信息。</p>

      <h2 id="method-aihot">三、AIHOT 仓库里，哪些机制值得借</h2>
      <p>这个站点的结构参考了 <a href="https://github.com/KKKKhazix/AIHOT" target="_blank" rel="noopener">AIHOT</a> 的公开引擎。它把“采集 → 筛选 → 写作 → 聚簇 → 成刊 → 分发”拆成了独立步骤，下面这些机制在本次静态化里被保留或改写：</p>
      <ul>
        <li><strong>排程</strong>：AIHOT 用 <code>apps/worker/src/schedules.ts</code> 的 pg-boss cron，日报默认 08:00、周报周一 10:00、月报 1 日 10:30（<code>Asia/Shanghai</code>）。本站把它换成 GitHub Actions 的 <code>10 0 * * *</code>，即北京时间 08:10；没有数据库，也没有 missed-run 补跑。</li>
        <li><strong>成刊</strong>：AIHOT 的 <code>packages/backend/src/reports/compose.ts</code> 里，日报是规则成刊，不调用模型；周报月报从日报汇编，只让模型写总述。本站的 digest 也是规则选 picks，模型只在可选的摘要步骤出现。</li>
        <li><strong>RSS</strong>：AIHOT 在 <code>packages/backend/src/publication/feeds.ts</code> 提供精选、全部、全文、日报、周报、月报和分类 RSS，并按请求生成。本站只保留一个 <code>feed.xml</code>，在构建时生成，避免 Pages 没有运行时的问题。</li>
        <li><strong>JSON API</strong>：AIHOT 的 <code>apps/api/src/routes/v1.ts</code> 有 <code>/api/v1/items</code>、<code>/hot-topics</code>、<code>/stories/:id</code>、<code>/dailies</code> 等接口，带 ETag 和 60–300 秒缓存。本站把它降级成静态 <code>api/v1/*.json</code>，用构建时间做版本。</li>
        <li><strong>飞书推送</strong>：AIHOT 的 <code>packages/backend/src/notify/selected-content.ts</code> 只推新入选、非补录、12 小时内、未被静音的条目，卡片包含标题、来源、摘要、推荐理由和两个按钮。本站的 <code>scripts/notify.mjs</code> 保留“只推一次、按日期去重、失败重试”的骨架，但把触发放在 Actions。</li>
        <li><strong>外部内容推入</strong>：AIHOT 的 <code>apps/api/src/routes/ingest.ts</code> 提供 <code>POST /api/ingest/items</code>，Bearer Token，单次最多 50 条。本站没有服务端，改用“提交 JSON / PR”而不是在线 ingest；这是能力上的明确降级。</li>
        <li><strong>给 Agent 的出口</strong>：AIHOT 有 MCP、Agent Markdown、<code>llms.txt</code>、sitemap、IndexNow。本站保留 <code>llms.txt</code>、sitemap 和静态 JSON，没有 MCP 服务端；MCP 需要运行时，Pages 不提供。</li>
      </ul>

      <h2 id="method-pages">四、搬到 GitHub Pages 后，什么变了</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>能力</th><th>参考站 / AIHOT</th><th>本站</th><th>结论</th></tr></thead>
        <tbody>
          <tr><td>运行时</td><td>Node / Fastify / Postgres / worker</td><td>纯静态 + Actions</td><td>没有数据库和按需 API</td></tr>
          <tr><td>采集</td><td>每分钟检查到期源</td><td>每天一次批量</td><td>延迟更高，成本更低</td></tr>
          <tr><td>模型调用</td><td>worker 内按任务调用</td><td>仅在可选摘要步骤</td><td>读者打开页面 0 调用</td></tr>
          <tr><td>日报</td><td>数据库存 revisions</td><td>按日期静态 JSON</td><td>不可在线改稿，改稿靠提交</td></tr>
          <tr><td>RSS</td><td>按请求生成，ETag</td><td>构建时生成</td><td>订阅可用，粒度更粗</td></tr>
          <tr><td>MCP</td><td>匿名 Streamable HTTP</td><td>无</td><td>不假装支持</td></tr>
          <tr><td>Web Push</td><td>没有</td><td>没有</td><td>用 RSS + 飞书 / Telegram 替代</td></tr>
          <tr><td>失败恢复</td><td>重试、告警、补跑</td><td>保留上次构建 + 状态页</td><td>没有自动补跑</td></tr>
        </tbody>
      </table></div>
      <p>核心变化不是“功能变少”，而是<strong>把在线服务换成了构建产物</strong>。一旦接受这个约束，很多设计反而更清楚：每个栏目都必须有一个可以提交、可以 diff、可以回滚的文件；每个时间戳都必须写进文件，而不是只存在于内存；每次失败都必须留下状态，而不是静默重试。</p>

      <h2 id="method-limits">五、局限与下一步</h2>
      <p>这份站点的种子数据来自 2026-10-20 至 10-21 的公开论文、官方发布与报道，中文摘要经过编辑整理；它不是全量索引，也不代表同行评审结论。正式运行后，Actions 会用 <code>scripts/collect.mjs</code> 抓取自己的信源，但仍有几个限制：</p>
      <ul>
        <li><strong>没有实时性</strong>：每天一次快照，arXiv 公告和 GitHub release 可能延迟一天。</li>
        <li><strong>没有全文</strong>：只展示摘要和链接，不做全文转载；这是版权和成本的双重选择。</li>
        <li><strong>没有个性化</strong>：没有用户系统，也没有“只推我关心的主题”。</li>
        <li><strong>没有真正的 Web Push</strong>：如果需要，得加一个服务端（Cloudflare Worker、VPS 或 AIHOT 本身）来保存订阅和签名。</li>
        <li><strong>模型摘要需要密钥</strong>：不配置 <code>LLM_API_KEY</code> 时，新条目保留英文摘要；配置后才生成中文概括。</li>
        <li><strong>GitHub Actions 可能延迟</strong>：cron 不是精确时钟；页面上的“下次推送”是计划时间，不是承诺。</li>
      </ul>
      <p>下一步最值得做的，不是加更多栏目，而是把“证据等级”做得更硬：给每条论文补上是否同行评审、是否有公开代码、是否在官方榜提交；给每条新闻补上原始来源和二次转载链；给每个 Benchmark 补上协议版本。推送的价值不在于更快，而在于<strong>让读者少花时间判断这条消息该不该信</strong>。</p>

      <h2 id="method-about">关于本站</h2>
      <p>本站由 <a href="https://yangxc0414.github.io/" rel="me">YXC</a> 维护，使用纯静态 HTML/CSS/JS 与 Node 脚本，部署在 GitHub Pages。结构参考 <a href="https://github.com/KKKKhazix/AIHOT" target="_blank" rel="noopener">AIHOT</a>（MIT），版式和栏目设置参考 <a href="https://agent-memory-hot.pale-rook-5118.chatgpt.site/" target="_blank" rel="noopener">Agent Memory Hot</a>，但不使用它们的名字和 Logo。数据来自公开论文、官方博客与 GitHub；原文版权归各来源所有。若你是来源方，希望更正或下架，请通过 GitHub 仓库联系。</p>
    </article>
  </section>`;
}

/* ---------- detail dialog ---------- */

function openDetail(id) {
  const item = byId.get(id);
  if (!item) {
    showToast("没有找到这条内容。");
    return;
  }
  const dialog = $("#detail-dialog");
  const content = $("#detail-content");
  content.innerHTML = `<div class="detail-inner">
    <div class="detail-top">
      <div class="chips">${kindBadge(item)} ${securityBadge(item)} <span class="badge">${esc(item.evidence || "证据未标注")}</span></div>
      <button class="detail-close" type="button" data-action="close-detail" aria-label="关闭">×</button>
    </div>
    <h2>${esc(itemTitle(item))}</h2>
    <p class="detail-sub">${esc(item.title)}<br />${esc(item.source)} · ${esc(formatDate(item.published, true))} · ${esc(item.evidence || "")}</p>
    <p class="detail-summary">${esc(itemSummary(item))}</p>
    <div class="detail-why"><b class="mono" style="color:var(--accent);font-size:9px;letter-spacing:.08em">WHY PUSH / </b>${esc(item.why || "等待编辑补全。")}</div>
    <div class="chips">${[...new Set([...(item.topicLabels || []), ...(item.tags || [])])].map((tagName) => `<span class="tag">${esc(tagName)}</span>`).join("")}</div>    <dl class="detail-facts">
      <dt>证据等级</dt><dd>${esc(item.evidence || "未标注")}</dd>
      <dt>发表时间</dt><dd>${esc(formatDate(item.published, true))}</dd>
      <dt>来源</dt><dd>${esc(item.source)}</dd>
      <dt>推送分</dt><dd>${esc(String(item.score ?? "—"))} / 100（编辑排序，不是质量评分）</dd>
      <dt>原文摘要</dt><dd>${esc(item.summary || "未提供。")}</dd>
      ${item.security ? `<dt>安全角度</dt><dd>${esc(item.security.angles.map((angle) => ANGLE_LABELS[angle] || angle).join(" / "))}<br />${esc(item.security.note || "")}</dd>` : ""}
    </dl>
    <div class="detail-actions">
      <a class="button" href="${safeUrl(item.url)}" target="_blank" rel="noopener">打开原文 ↗</a>
      <button class="button secondary" type="button" data-action="copy-link" data-id="${esc(item.id)}">复制本站链接</button>
      <button class="button secondary" type="button" data-action="close-detail">关闭</button>
    </div>
  </div>`;
  dialogOpenFor = id;
  if (!dialog.open) dialog.showModal();
  bindViewEvents();
}

function closeDetail() {
  const dialog = $("#detail-dialog");
  if (dialog.open) dialog.close();
  dialogOpenFor = null;
}

async function copyItemLink(id) {
  const url = siteItemUrl(id);
  try {
    await navigator.clipboard.writeText(url);
    showToast("链接已复制。");
  } catch {
    showToast("复制失败，请手动复制地址栏。");
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

/* ---------- events ---------- */

function bindViewEvents() {
  const view = $("#view");
  if (!view || view.dataset.bound === "1") {
    // Rebind is cheap; keep delegation on the container but avoid duplicate listeners.
  }
}

function setupEvents() {
  document.addEventListener("click", (event) => {
    const scrollEl = event.target.closest("[data-scroll]");
    if (scrollEl) {
      event.preventDefault();
      const target = document.getElementById(scrollEl.dataset.scroll || "");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    if (action === "set-kind") {
      state.feed.kind = actionEl.dataset.kind || "all";
      state.feed.limit = 18;
      updateFeedHash();
      render("feed", { scroll: false });
    } else if (action === "toggle-security") {
      state.feed.security = !state.feed.security;
      state.feed.limit = 18;
      updateFeedHash();
      render("feed", { scroll: false });
    } else if (action === "set-topic") {
      state.feed.topic = actionEl.dataset.topic || "all";
      state.feed.limit = 18;
      state.feed.kind = "all";
      setHash("feed", feedParams());
    } else if (action === "set-angle") {
      state.securityAngle = actionEl.dataset.angle || "all";
      render("security", { scroll: false });
    } else if (action === "clear-filters") {
      state.feed = { kind: "all", topic: "all", q: "", range: "all", sort: "newest", security: false, limit: 18 };
      updateFeedHash();
      render("feed", { scroll: false });
    } else if (action === "load-more") {
      state.feed.limit += 18;
      renderFeedResults();
    } else if (action === "set-project-category") {
      state.projectCategory = actionEl.dataset.category || "all";
      render("projects", { scroll: false });
    } else if (action === "set-project-sort") {
      state.projectSort = actionEl.dataset.sort || "stars";
      render("projects", { scroll: false });
    } else if (action === "close-detail") {
      closeDetail();
      if (location.hash.startsWith("#/item/")) {
        setHash(currentView, currentView === "feed" ? feedParams() : {}, { replace: true });
      }
    } else if (action === "scroll-to") {
      const target = document.getElementById(actionEl.dataset.target || "");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (action === "copy-link") {
      copyItemLink(actionEl.dataset.id);
    } else if (action === "copy-feed") {
      navigator.clipboard
        ?.writeText(new URL("feed.xml", DATA_BASE).toString())
        .then(() => showToast("RSS 地址已复制。"))
        .catch(() => showToast("复制失败，请手动复制。"));
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.id !== "feed-search") return;
    state.feed.q = event.target.value;
    state.feed.limit = 18;
    updateFeedHash();
    clearTimeout(window.__searchTimer);
    window.__searchTimer = setTimeout(() => renderFeedResults(), 120);
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "feed-topic") {
      state.feed.topic = event.target.value;
      state.feed.limit = 18;
      updateFeedHash();
      render("feed", { scroll: false });
    } else if (event.target.id === "feed-range") {
      state.feed.range = event.target.value;
      state.feed.limit = 18;
      updateFeedHash();
      render("feed", { scroll: false });
    } else if (event.target.id === "feed-sort") {
      state.feed.sort = event.target.value;
      updateFeedHash();
      render("feed", { scroll: false });
    }
  });

  $("#refresh-button")?.addEventListener("click", async () => {
    const button = $("#refresh-button");
    button.disabled = true;
    button.textContent = "…";
    try {
      const previous = meta?.checkedAt;
      await loadData({ bust: true });
      render(currentView, { scroll: false });
      showToast(meta.checkedAt !== previous ? "已刷新到新快照。" : "已刷新；快照没有变化。");
    } catch (error) {
      showToast(`刷新失败：${error.message}`);
    } finally {
      button.disabled = false;
      button.innerHTML = `<span aria-hidden="true">↻</span><span class="sr-only">刷新快照</span>`;
    }
  });

  $("#menu-button")?.addEventListener("click", () => {
    const nav = $("#nav");
    const open = nav.classList.toggle("open");
    $("#menu-button").setAttribute("aria-expanded", String(open));
  });

  $("#nav")?.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      $("#nav").classList.remove("open");
      $("#menu-button")?.setAttribute("aria-expanded", "false");
    }
  });

  $("#detail-dialog")?.addEventListener("click", (event) => {
    if (event.target === $("#detail-dialog")) closeDetail();
  });

  $("#detail-dialog")?.addEventListener("close", () => {
    dialogOpenFor = null;
  });

  window.addEventListener("hashchange", handleRoute);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkForFreshSnapshot();
  });
  setInterval(checkForFreshSnapshot, 10 * 60 * 1000);
}

function updateFeedHash() {
  if (currentView !== "feed") return;
  setHash("feed", feedParams(), { replace: true });
}

async function checkForFreshSnapshot() {
  if (document.hidden) return;
  try {
    const fresh = await getJson("data/meta.json", true);
    if (!fresh.checkedAt || fresh.checkedAt === lastMetaCheck) return;
    lastMetaCheck = fresh.checkedAt;
    showToast("巡检发现新快照，点右上角 ↻ 刷新。");
  } catch {
    // The page stays on the last good snapshot.
  }
}

function observeReveal() {
  const nodes = $$(".reveal");
  if (!("IntersectionObserver" in window)) {
    nodes.forEach((node) => node.classList.add("in"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.02 }
  );
  nodes.forEach((node) => {
    if (node.classList.contains("in")) return;
    const rect = node.getBoundingClientRect();
    if (rect.top < window.innerHeight * 1.15) {
      node.classList.add("in");
      return;
    }
    observer.observe(node);
  });
  setTimeout(() => {
    nodes.forEach((node) => node.classList.add("in"));
  }, 2500);
}

function handleRoute() {
  const { view, itemId, params } = parseHash();
  if (itemId) {
    if (document.readyState === "loading" || !site) return;
    if (!byId.has(itemId)) {
      showToast("这条内容不在当前快照里。");
      return;
    }
    if (!document.querySelector("#view .hero")) render(currentView, { scroll: false });
    openDetail(itemId);
    return;
  }
  closeDetail();
  if (view === "feed") applyFeedParams(params);
  if (currentView !== view) window.scrollTo({ top: 0, behavior: "instant" });
  render(view, { scroll: false });
}

async function init() {
  try {
    await loadData();
    const { view, itemId, params } = parseHash();
    currentView = view;
    if (view === "feed") applyFeedParams(params);
    render(view);
    if (itemId) openDetail(itemId);
    setupEvents();
    observeReveal();
  } catch (error) {
    console.error(error);
    $("#view").innerHTML = `<section class="section" style="padding-top:80px"><div class="empty"><strong>快照读取失败</strong><p>${esc(error.message)}</p><p>你仍然可以直接打开 <a href="feed.xml">RSS</a> 或 <a href="api/v1/items.json">JSON</a>。</p><button class="button" type="button" onclick="location.reload()">重试</button></div></section>`;
  }
}

init();
