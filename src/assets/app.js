const DATA_BASE = new URL("./", document.baseURI);
const VIEWS = new Set(["today", "feed", "catalog", "calendar", "topics", "projects", "benchmarks"]);
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
let projects;
let benchmarks;
let surveys;
let taxonomy;
let digest;
let digestIndex;
let archiveDigest = null;
let archiveDate = null;
let byId = new Map();
let topicById = new Map();
let currentView = "today";
let dialogOpenFor = null;
let toastTimer;
let lastMetaCheck = null;

const state = {
  feed: { kind: "all", topic: "all", q: "", range: "all", sort: "newest", security: false, limit: 18 },
  projectCategory: "all",
  projectSort: "stars",
  calendarMonth: null
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
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
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
  if (loading) loading.querySelector(".lead").textContent = "正在读取今日推送…";
  const freshMeta = await getJson("data/meta.json", true);
  const version = encodeURIComponent(freshMeta.checkedAt || freshMeta.builtAt || "1");
  const suffix = bust ? `?t=${Date.now()}` : `?v=${version}`;
  const [nextSite, nextItems, nextProjects, nextBenchmarks, nextSurveys, nextTaxonomy, nextDigest, nextDigestIndex, nextMeta] =
    await Promise.all([
      getJson(`data/site.json${suffix}`),
      getJson(`data/items.json${suffix}`),
      getJson(`data/projects.json${suffix}`),
      getJson(`data/benchmarks.json${suffix}`),
      getJson(`data/surveys.json${suffix}`),
      getJson(`data/taxonomy.json${suffix}`),
      getJson(`data/digests/${freshMeta.date}.json${suffix}`).catch(() => getJson(`data/digests/index.json${suffix}`)),
      getJson(`data/digests/index.json${suffix}`),
      getJson(`data/meta.json${suffix}`)
    ]);
  site = nextSite;
  items = Array.isArray(nextItems) ? nextItems : nextItems.items || [];
  projects = nextProjects;
  benchmarks = nextBenchmarks;
  surveys = nextSurveys;
  taxonomy = nextTaxonomy;
  digest = nextDigest.digests ? null : nextDigest;
  digestIndex = nextDigestIndex;
  meta = nextMeta;
  byId = new Map(items.map((item) => [item.id, item]));
  topicById = new Map(taxonomy.topics.map((topic) => [topic.id, topic]));
  if (!digest) {
    digest = {
      date: meta.date,
      lead: site.description,
      editorNote: "今天的内容正在整理。",
      picks: [],
      sections: [],
      window: { label: "最近更新" }
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

function updateScrollProgress() {
  const bar = $("#scroll-progress");
  if (!bar) return;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
}

function render(view = currentView, { scroll = true } = {}) {
  if (!site) return;
  currentView = VIEWS.has(view) ? view : "today";
  const titles = {
    today: "今日推送",
    feed: "全部动态",
    catalog: "研究目录",
    calendar: "日历",
    topics: "主题地图",
    projects: "项目与发布",
    benchmarks: "Benchmark"
  };
  document.title =
    currentView === "today" ? "智能体记忆推送" : `${titles[currentView]} · ${site.name}`;
  updateNav(currentView);
  const viewEl = $("#view");
  viewEl.innerHTML = renderView(currentView);
  if (currentView === "feed") renderFeedResults();
  updateScrollProgress();
  bindViewEvents();
  observeReveal();
  if (scroll) window.scrollTo({ top: 0, behavior: "auto" });
}

function renderView(view) {
  if (view === "feed") return renderFeed();
  if (view === "catalog") return renderCatalog();
  if (view === "calendar") return renderCalendar();
  if (view === "topics") return renderTopics();
  if (view === "projects") return renderProjects();
  if (view === "benchmarks") return renderBenchmarks();
  return renderToday();
}

function loadingMarkup() {
  return `<section class="loading-shell"><p class="kicker">AGENT MEMORY / DAILY PUSH</p><h1>智能体记忆推送</h1><p class="lead">正在读取今日推送…</p></section>`;
}

/* ---------- components ---------- */

function todayDigestItems() {
  const ids = new Set([
    ...(digest.picks || []).map((pick) => pick.id),
    ...(digest.sections || []).flatMap((section) => section.itemIds || [])
  ]);
  return [...ids].map((id) => byId.get(id)).filter(Boolean);
}

function todayDigestStats() {
  const list = todayDigestItems();
  return {
    items: list.length,
    papers: list.filter((item) => item.kind === "paper").length,
    news: list.filter((item) => item.kind === "news").length,
    releases: list.filter((item) => item.kind === "release").length,
    security: list.filter((item) => item.security).length
  };
}

function statusPanel() {
  const stats = meta.stats || {};
  const today = todayDigestStats();
  const checked = meta.checkedAt || site.snapshot.checkedAt;
  const next = nextRun();
  const stale = isStale();
  return `<aside class="status-panel reveal" aria-label="今日更新状态">
    <div class="status-head">
      <span class="mono">TODAY / ${esc(meta.date || digest.date)}</span>
      <span class="live ${stale ? "stale" : ""}">${stale ? "待更新" : "已更新"}</span>
    </div>
    <div class="status-main">
      <span class="status-number" data-count="${today.items}" data-pad="2">${String(today.items).padStart(2, "0")}</span>
      <span class="status-unit">条今日更新<br />${esc(digest.window?.label || "最近更新")}</span>
    </div>
    <div class="status-grid">
      <div class="status-cell"><b>${today.papers}</b><span>论文</span></div>
      <div class="status-cell"><b>${today.news}</b><span>新闻</span></div>
      <div class="status-cell"><b>${today.security}</b><span>安全</span></div>
    </div>
    <div class="status-foot">
      <span>更新于<br /><b>${esc(formatDate(checked, true))}</b></span>
      <span>下次更新<br /><b>${esc(formatDate(next.toISOString(), true))}</b></span>
      <span>已收录<br /><b>${stats.items ?? items.length} 条</b></span>
    </div>
  </aside>`;
}

function pickCard(pick, index) {
  const item = byId.get(pick.id);
  if (!item) return "";
  const featured = index === 0;
  return `<article class="pick-card ${featured ? "featured" : ""} reveal" style="--i:${index}">
    <div class="pick-index">${featured ? "01 / TODAY'S LEAD" : `${String(index + 1).padStart(2, "0")} / PICK`}</div>
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
  const today = todayDigestStats();
  const leadPick = digest.picks?.[0] ? byId.get(digest.picks[0].id) : null;
  const topTopics = Object.entries(meta.stats?.byTopic || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([id, count]) => ({ id, count, label: topicById.get(id)?.label || id }));
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
      <h1 class="daily-title">智能体记忆推送</h1>
      <p class="hero-tagline">记忆不该被遗忘。</p>
      <p class="lead">${esc(site.intro)}</p>
      <div class="hero-actions">
        <a class="button" href="#/feed">看全部动态 <span aria-hidden="true">→</span></a>
        <a class="button secondary" href="#/topics">看主题地图 <span aria-hidden="true">↗</span></a>
      </div>
      <div class="hero-meta">
        <span><strong>${today.items}</strong> 条今日更新</span>
        <span><strong>${stats.items ?? items.length}</strong> 条已收录</span>
        <span><strong>${today.papers}</strong> 篇论文</span>
        <span><strong>${today.security}</strong> 条安全</span>
      </div>
    </div>
    <div class="hero-visual">
      ${statusPanel()}
      ${leadPick ? `<a class="latest-float" href="${itemHref(leadPick.id)}"><span class="latest-kicker">TODAY'S LEAD</span><span class="latest-arrow" aria-hidden="true">↗</span><strong>${esc(itemTitle(leadPick))}</strong><em>${esc(leadPick.source)} · ${esc(formatDate(leadPick.published))}</em></a>` : ""}
    </div>
  </section>

  ${topicStrip(topTopics)}

  <section class="section">
    <div class="section-head">
      <div><p class="index">01 / THE DAILY PUSH</p><h2>今天，记忆界发生了什么</h2></div>
      <p class="section-note">今天检索窗口内的相关论文与动态都在这里：重点卡片是先看建议，分栏按方向列出完整清单。</p>
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
        <div class="aside-stat"><span>今日更新 / 已收录</span><b>${today.items} / ${stats.items ?? items.length}</b></div>
        <div class="aside-stat"><span>论文 / 新闻 / 发布</span><b>${today.papers} / ${today.news} / ${today.releases}</b></div>
        <div class="aside-stat"><span>安全相关</span><b>${today.security}</b></div>
        <div class="aside-stat"><span>更新节奏</span><b>每天 08:00</b></div>
      </aside>
    </div>
  </section>

  <section class="section">
    <div class="section-head">
      <div><p class="index">02 / ENTER THE INDEX</p><h2>按你关心的问题进入</h2></div>
      <p class="section-note">每一栏都是今天内容的不同切面。先看你在意的方向，再回到完整列表。</p>
    </div>
    <div class="quick-grid">
      ${quickCard("主题地图", `${taxonomy.topics.length} 个主题`, "从机制到具身、多模态", "#/topics", "accent", 0)}
      ${quickCard("项目与发布", `${projects.projects.length} 个项目`, "值得跟踪的项目与官方发布", "#/projects", "teal", 1)}
      ${quickCard("Benchmark", `${benchmarks.benchmarks.length} 个基准`, "评测基准与官方入口", "#/benchmarks", "blue", 2)}
    </div>
  </section>`;
}

function topicStrip(topics) {
  if (!topics.length) return "";
  return `<div class="topic-strip reveal" aria-label="今日关键词">
    <span class="topic-strip-label">今日关键词</span>
    <div class="topic-strip-scroll">
      ${topics.map((topic) => `<button class="topic-pill" type="button" data-action="set-topic" data-topic="${esc(topic.id)}">${esc(topic.label)}<span>${topic.count}</span></button>`).join("")}
    </div>
  </div>`;
}

function quickCard(title, value, note, href, tone, index = 0) {
  return `<a class="quick-card ${tone} reveal" style="--i:${index}" href="${href}">
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
  return `<article class="item-card reveal" data-id="${esc(item.id)}" style="--i:${index}">
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
      <div class="item-why"><b>推荐理由</b>${esc(item.why || "推荐理由整理中。")}</div>
      <div class="item-foot">
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
    : `<div class="empty"><strong>没有命中</strong><p>换一个关键词，或清空筛选。</p><button class="button secondary" type="button" data-action="clear-filters">清空筛选</button></div>`;
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
      <p class="section-note">按类型、主题、时间和关键词筛选，找到你关心的记忆研究。每条都附原文链接和来源说明。</p>
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
      <div class="select-wrap"><label for="feed-sort">排序</label><select id="feed-sort"><option value="newest"${state.feed.sort === "newest" ? " selected" : ""}>最新在前</option><option value="score"${state.feed.sort === "score" ? " selected" : ""}>推荐排序</option></select></div>
      <button class="chip" type="button" data-action="clear-filters">清空</button>
    </div>
    <div class="results-meta"><span id="feed-count"></span><span>更新于 ${esc(formatDate(meta.checkedAt, true))}</span></div>
    <div id="feed-results" class="item-list"></div>
    <div style="text-align:center;margin-top:24px"><button class="button secondary" id="feed-more" type="button" data-action="load-more" hidden>加载更多</button></div>
  </section>`;
}

function renderArchiveDigest(data) {
  const picks = (data.picks || []).map((pick, index) => pickCard(pick, index)).join("");
  const sections = (data.sections || []).map(digestSection).join("");
  return `<div class="archive-head">
    <p class="kicker">往日推送 · ${esc(data.date || archiveDate)}</p>
    <h3>${esc(data.title || "记忆日报")}</h3>
    <p class="lead">${esc(data.lead || "")}</p>
    <span class="mono">${esc(data.window?.label || "")}</span>
  </div>
  <div class="picks-grid">${picks}</div>
  <div class="digest-sections">${sections}</div>`;
}

async function openArchiveDay(date) {
  const container = $("#archive-day");
  if (!container) return;
  container.innerHTML = `<p class="muted">正在读取 ${esc(date)} 的推送…</p>`;
  try {
    const data = await getJson(`data/digests/${date}.json`, true);
    archiveDate = date;
    archiveDigest = data;
    container.innerHTML = renderArchiveDigest(data);
    document.querySelectorAll('[data-action="open-archive"]').forEach((button) => {
      button.classList.toggle("active", button.dataset.date === date);
    });
    container.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    container.innerHTML = `<div class="archive-placeholder"><strong>没有找到这一天的推送</strong><p>${esc(error.message)}</p></div>`;
  }
}

function renderCalendar() {
  const editions = [...(digestIndex?.digests || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const byDate = new Map(editions.map((edition) => [edition.date, edition]));
  const latest = editions[0]?.date || meta.date;
  if (!state.calendarMonth) state.calendarMonth = latest.slice(0, 7);
  const [year, month] = state.calendarMonth.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const offset = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let index = 0; index < offset; index += 1) cells.push(`<span class="calendar-blank"></span>`);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const entry = byDate.get(date);
    const classes = [
      "calendar-day",
      entry ? "has-entry" : "",
      date === meta.date ? "today" : "",
      date === archiveDate ? "active" : ""
    ]
      .filter(Boolean)
      .join(" ");
    cells.push(
      `<button class="${classes}" type="button" ${entry ? `data-action="open-archive" data-date="${date}"` : "disabled"} aria-label="${date}${entry ? " 有推送" : ""}">${day}${entry ? "<i></i>" : ""}</button>`
    );
  }
  const entries = editions
    .map(
      (edition) => `<button class="calendar-entry ${edition.date === archiveDate ? "active" : ""}" type="button" data-action="open-archive" data-date="${esc(edition.date)}">
        <span>${esc(edition.date)}</span>
        <strong>${esc(edition.title || edition.label || "记忆日报")}</strong>
        <em>${edition.picks || 0} 个重点 · ${edition.items || 0} 条</em>
      </button>`
    )
    .join("");
  const archiveHtml = archiveDigest
    ? renderArchiveDigest(archiveDigest)
    : `<div class="archive-placeholder"><strong>选择日期，回看当天推送</strong><p>有标记的日期已发布；日历会随每日日报自动累积。</p></div>`;
  return `<section class="section calendar-page" style="border-bottom:0;padding-top:44px">
    <div class="section-head">
      <div><p class="index">CALENDAR / ${editions.length} EDITIONS</p><h2>日历</h2></div>
      <p class="section-note">选择日期，回看当天的重点文章与分栏；新的日报会自动出现在这里。</p>
    </div>
    <div class="calendar-layout">
      <div class="calendar-panel">
        <div class="calendar-toolbar">
          <button class="icon-button" type="button" data-action="calendar-prev" aria-label="上个月">←</button>
          <strong>${year} 年 ${month} 月</strong>
          <button class="icon-button" type="button" data-action="calendar-next" aria-label="下个月">→</button>
        </div>
        <div class="calendar-weekdays">${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<span>${day}</span>`).join("")}</div>
        <div class="calendar-grid">${cells.join("")}</div>
        <div class="calendar-legend"><span class="calendar-dot"></span> 已发布 <span class="calendar-dot today"></span> 最新</div>
      </div>
      <aside class="calendar-list">
        <h3>已发布</h3>
        ${entries || `<p class="muted">还没有历史日报。</p>`}
        <a class="button secondary" href="#/today">回到今日推送</a>
      </aside>
    </div>
    <div id="archive-day" class="archive-day">${archiveHtml}</div>
  </section>`;
}

function renderCatalog() {
  const byTopic = new Map(taxonomy.topics.map((topic) => [topic.id, []]));
  for (const item of items) {
    for (const topic of item.topics || []) {
      if (byTopic.has(topic)) byTopic.get(topic).push(item);
    }
  }
  const latestFirst = (list) => [...list].sort((a, b) => String(b.published).localeCompare(String(a.published)));
  const typeCounts = {
    paper: items.filter((item) => item.kind === "paper").length,
    news: items.filter((item) => item.kind === "news").length,
    release: items.filter((item) => item.kind === "release").length
  };
  return `<section class="section" style="border-bottom:0;padding-top:44px">
    <div class="section-head">
      <div><p class="index">CATALOG / ${items.length} ITEMS</p><h2>研究目录</h2></div>
      <p class="section-note">按主题浏览已收录的论文、项目与动态。每个主题先列最新几条，点进去看摘要、来源与推荐理由。</p>
    </div>
    <div class="catalog-type-strip">
      <a class="chip active" href="#/feed">全部 <span class="count">${items.length}</span></a>
      <a class="chip" href="#/feed?kind=paper">论文 <span class="count">${typeCounts.paper}</span></a>
      <a class="chip" href="#/feed?kind=news">新闻 <span class="count">${typeCounts.news}</span></a>
      <a class="chip" href="#/feed?kind=release">发布 <span class="count">${typeCounts.release}</span></a>
    </div>
    <div class="catalog-index" aria-label="主题索引">
      ${taxonomy.topics
        .map(
          (topic) =>
            `<a class="catalog-pill" href="#catalog-${esc(topic.id)}" data-scroll="catalog-${esc(topic.id)}">${esc(topic.label)}<span>${byTopic.get(topic.id).length}</span></a>`
        )
        .join("")}
    </div>
    <div class="catalog-grid">
      ${taxonomy.topics
        .map((topic) => {
          const list = latestFirst(byTopic.get(topic.id));
          const preview = list.slice(0, 4);
          return `<section class="catalog-section" id="catalog-${esc(topic.id)}">
            <div class="catalog-head">
              <div>
                <span class="catalog-count">${list.length} ITEMS</span>
                <h3>${esc(topic.label)}</h3>
                <p>${esc(topic.desc)}</p>
              </div>
              <a class="text-link" href="#/feed?topic=${esc(topic.id)}">查看全部 →</a>
            </div>
            <div class="catalog-items">
              ${
                preview.length
                  ? preview
                      .map(
                        (item) => `<a class="catalog-item" href="${itemHref(item.id)}">
                          <div class="catalog-item-top">${kindBadge(item)}<span class="catalog-date">${esc(formatDate(item.published))}</span></div>
                          <strong>${esc(itemTitle(item))}</strong>
                          <p>${esc(truncate(itemSummary(item), 88))}</p>
                          <em>${esc(item.source)}</em>
                        </a>`
                      )
                      .join("")
                  : `<p class="catalog-empty">这个主题暂时没有条目。</p>`
              }
            </div>
          </section>`;
        })
        .join("")}
    </div>
    <p class="catalog-foot">目录随每日采集更新；想按时间浏览，去 <a href="#/feed">全部动态</a>。</p>
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
      return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="#2563eb" stroke-opacity="${count ? 0.22 : 0.08}" />
        <circle class="orbit-node" cx="${x}" cy="${y}" r="${size}" fill="${count ? "#2563eb" : "#8b9bb0"}" fill-opacity="${count ? 0.82 : 0.35}" />
        <text x="${labelX}" y="${labelY}" text-anchor="${anchor}">${esc(topic.short)}</text>
        <text class="orbit-count" x="${labelX}" y="${labelY + 12}" text-anchor="${anchor}">${count}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 400 400" role="img" aria-label="主题关系轨道图">
    <circle cx="200" cy="200" r="138" fill="none" stroke="#0f172a" stroke-opacity=".14" />
    <circle cx="200" cy="200" r="86" fill="none" stroke="#0f172a" stroke-opacity=".08" />
    <circle cx="200" cy="200" r="44" fill="none" stroke="#0f172a" stroke-opacity=".08" />
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
      <p class="section-note">按研究主题浏览；同一条内容可能出现在多个主题里。</p>
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
          <h3>Topic orbit / 当前收录条目数</h3>
          <div class="orbit">${renderOrbit()}</div>
          <p class="mono faint" style="margin-top:8px;line-height:1.7">圆点大小 = 当前收录条目数。轨道图只表示分布，不表示主题之间的因果或层级关系。</p>
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
      <div><p class="index">PROJECTS / INDEX</p><h2>项目与发布</h2></div>
      <p class="section-note">按方向和类别浏览项目；星标仅作参考。</p>
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
              <span>★ 更新于 ${esc(formatDate(project.starsCheckedAt))}</span>
            </div>
          </a>`
        )
        .join("")}
    </div>
    <div class="section" style="padding-bottom:0">
      <div class="section-head">
        <div><p class="index">RELEASES / ${releases.length} ITEMS</p><h2>官方发布</h2></div>
        <p class="section-note">官方版本发布；具体变更以 release note 为准。</p>
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
      <p class="section-note">评测基准与官方入口；分数与协议以官方页面为准。</p>
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
          <li>最后看时间。榜单会更新，分数以官方页面为准。</li>
        </ol>
        <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line)">
          <p class="mono faint" style="font-size:10px;line-height:1.8">相关条目：</p>
          ${related.map((item) => `<a class="text-link" style="display:block;margin-top:8px" href="${itemHref(item.id)}">${esc(itemTitle(item))} →</a>`).join("")}
        </div>
      </aside>
    </div>
  </section>`;
}

function openDetail(id) {
  const item = byId.get(id);
  if (!item) {
    showToast("没有找到这条内容。");
    return;
  }
  const related = items
    .filter((other) => other.id !== item.id)
    .map((other) => ({
      item: other,
      shared: (other.topics || []).filter((topic) => (item.topics || []).includes(topic)).length
    }))
    .filter((entry) => entry.shared > 0)
    .sort(
      (a, b) =>
        b.shared - a.shared ||
        String(b.item.published).localeCompare(String(a.item.published))
    )
    .slice(0, 3)
    .map((entry) => entry.item);
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
    <div class="detail-why"><b class="mono" style="color:var(--accent);font-size:9px;letter-spacing:.08em">推荐理由 / </b>${esc(item.why || "推荐理由整理中。")}</div>
    <div class="chips">${[...new Set([...(item.topicLabels || []), ...(item.tags || [])])].map((tagName) => `<span class="tag">${esc(tagName)}</span>`).join("")}</div>
    <dl class="detail-facts">
      <dt>证据等级</dt><dd>${esc(item.evidence || "未标注")}</dd>
      <dt>发表时间</dt><dd>${esc(formatDate(item.published, true))}</dd>
      <dt>来源</dt><dd>${esc(item.source)}</dd>
      <dt>原文摘要</dt><dd>${esc(item.summary || "未提供。")}</dd>
      ${item.security ? `<dt>安全角度</dt><dd>${esc(item.security.angles.map((angle) => ANGLE_LABELS[angle] || angle).join(" / "))}<br />${esc(item.security.note || "")}</dd>` : ""}
    </dl>
    ${related.length ? `<div class="detail-related"><h4>相关阅读</h4><div class="detail-related-list">${related.map((entry) => `<a href="${itemHref(entry.id)}"><span>${esc(itemTitle(entry))}</span><em>${esc(entry.source)} · ${esc(formatDate(entry.published))}</em></a>`).join("")}</div></div>` : ""}
    <div class="detail-actions">
      <a class="button" href="${safeUrl(item.url)}" target="_blank" rel="noopener">打开原文 ↗</a>
      <button class="button secondary" type="button" data-action="copy-link" data-id="${esc(item.id)}">复制条目链接</button>
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

function closeBookmark() {
  const pop = $("#bookmark-pop");
  if (!pop) return;
  pop.hidden = true;
  $("#bookmark-button")?.setAttribute("aria-expanded", "false");
}

async function handleBookmark() {
  const url = `${location.origin}${location.pathname}`;
  const title = document.title;
  try {
    if (window.external?.AddFavorite) {
      window.external.AddFavorite(url, title);
      return;
    }
    if (window.sidebar?.addPanel) {
      window.sidebar.addPanel(title, url, "");
      return;
    }
  } catch {
    // Fall through to the browser shortcut hint.
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(url);
    copied = true;
  } catch {
    copied = false;
  }
  const status = $("#bookmark-status");
  if (status) {
    status.textContent = copied
      ? "网址已复制。按快捷键加入收藏夹。"
      : "请复制地址栏网址，再按快捷键加入收藏夹。";
  }
  const pop = $("#bookmark-pop");
  if (pop) {
    pop.hidden = false;
    $("#bookmark-button")?.setAttribute("aria-expanded", "true");
  }
  const button = $("#bookmark-button");
  button?.classList.add("is-pulsing");
  setTimeout(() => button?.classList.remove("is-pulsing"), 450);
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
    } else if (action === "calendar-prev" || action === "calendar-next") {
      const [year, month] = String(state.calendarMonth || meta.date.slice(0, 7)).split("-").map(Number);
      const nextMonth = new Date(Date.UTC(year, month - 1 + (action === "calendar-next" ? 1 : -1), 1));
      state.calendarMonth = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, "0")}`;
      render("calendar", { scroll: false });
    } else if (action === "open-archive") {
      openArchiveDay(actionEl.dataset.date);
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

  $("#bookmark-button")?.addEventListener("click", async (event) => {
    event.stopPropagation();
    await handleBookmark();
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("#bookmark-pop") && !event.target.closest("#bookmark-button")) closeBookmark();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeBookmark();
  });

  $("#refresh-button")?.addEventListener("click", async () => {
    const button = $("#refresh-button");
    button.disabled = true;
    button.textContent = "…";
    try {
      const previous = meta?.checkedAt;
      await loadData({ bust: true });
      render(currentView, { scroll: false });
      showToast(meta.checkedAt !== previous ? "已刷新到最新内容。" : "已刷新；内容没有变化。");
    } catch (error) {
      showToast(`刷新失败：${error.message}`);
    } finally {
      button.disabled = false;
      button.innerHTML = `<span aria-hidden="true">↻</span><span class="sr-only">刷新今日推送</span>`;
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
  window.addEventListener("scroll", updateScrollProgress, { passive: true });
  window.addEventListener("resize", updateScrollProgress);
  document.addEventListener("pointermove", (event) => {
    const hero = event.target.closest?.(".hero");
    if (hero) {
      const rect = hero.getBoundingClientRect();
      hero.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      hero.style.setProperty("--my", `${event.clientY - rect.top}px`);
    }
    const card = event.target.closest?.(".pick-card");
    if (card) {
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    }
  }, { passive: true });
  updateScrollProgress();
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
    showToast("发现新内容，点右上角 ↻ 刷新。");
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
      showToast("这条内容不在今天的推送里。");
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
    $("#view").innerHTML = `<section class="section" style="padding-top:80px"><div class="empty"><strong>内容读取失败</strong><p>${esc(error.message)}</p><p>请刷新页面重试。</p><button class="button" type="button" onclick="location.reload()">重试</button></div></section>`;
  }
}

init();
