export const ARXIV_BASE = "https://export.arxiv.org/api/query";

const ARXIV_CATEGORIES =
  "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:cs.RO OR cat:cs.CV OR cat:cs.MA OR cat:cs.SE OR cat:cs.IR OR cat:cs.HC OR cat:cs.CR OR cat:cs.NE OR cat:eess.SY OR cat:stat.ML)";

function arxivUrl(query) {
  return `${ARXIV_BASE}?search_query=${encodeURIComponent(`(${query}) AND ${ARXIV_CATEGORIES}`)}&sortBy=submittedDate&sortOrder=descending&max_results=100`;
}

export const SOURCES = [
  {
    id: "arxiv-memory",
    name: "arXiv · 智能体记忆与自进化",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:00",
    note: "检索窗口内自动翻页；记忆、情景、经验、反思、技能与智能体/持续学习的交集。",
    url: arxivUrl('(ti:memory OR ti:memories OR ti:episodic OR ti:experience OR ti:reflection OR ti:skill) AND (abs:agent OR abs:"recursive self-improvement" OR abs:self-improving OR abs:"continual learning")'),
    query: '(ti:memory OR ti:memories OR ti:episodic OR ti:experience OR ti:reflection OR ti:skill) AND (abs:agent OR abs:"recursive self-improvement" OR abs:self-improving OR abs:"continual learning")'
  },
  {
    id: "arxiv-embodied",
    name: "arXiv · 具身与多模态记忆",
    topicHint: "embodied",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:00",
    note: "检索窗口内自动翻页；记忆、记忆化与 VLA、具身、多模态、机器人、导航的交集。",
    url: arxivUrl('(ti:memory OR ti:memories OR ti:memorization) AND (abs:VLA OR abs:"vision-language-action" OR abs:embodied OR abs:multimodal OR abs:robot)'),
    query: '(ti:memory OR ti:memories OR ti:memorization) AND (abs:VLA OR abs:"vision-language-action" OR abs:embodied OR abs:multimodal OR abs:robot)'
  },
  {
    id: "arxiv-security",
    name: "arXiv · 记忆安全与评测",
    topicHint: "security",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:00",
    note: "检索窗口内自动翻页；投毒、持久注入、隐私外泄、防御、访问隔离、溯源与安全评测。",
    url: arxivUrl('(ti:memory OR ti:memories OR abs:"persistent state") AND (abs:agent OR abs:LLM OR abs:"language model") AND (abs:poisoning OR abs:injection OR abs:backdoor OR abs:attack OR abs:defense OR abs:privacy OR abs:exfiltration OR abs:watermark OR abs:provenance OR abs:unlearning OR abs:security)'),
    query: '(ti:memory OR ti:memories OR abs:"persistent state") AND (abs:agent OR abs:LLM OR abs:"language model") AND (abs:poisoning OR abs:injection OR abs:backdoor OR abs:attack OR abs:defense OR abs:privacy OR abs:exfiltration OR abs:watermark OR abs:provenance OR abs:unlearning OR abs:security)'
  },
  {
    id: "arxiv-models",
    name: "arXiv · 记忆专用模型",
    topicHint: "mechanism",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:00",
    note: "检索窗口内自动翻页；记忆写入、检索、压缩、管理模型的训练、微调、蒸馏与强化学习。",
    url: arxivUrl('(abs:"memory writer" OR abs:"memory writing" OR abs:"memory manager" OR abs:"memory management" OR abs:"memory retriever" OR abs:"memory compressor" OR abs:"latent memory") AND (abs:training OR abs:learning OR abs:"fine-tuning" OR abs:distillation OR abs:"reinforcement learning")'),
    query: '(abs:"memory writer" OR abs:"memory writing" OR abs:"memory manager" OR abs:"memory management" OR abs:"memory retriever" OR abs:"memory compressor" OR abs:"latent memory") AND (abs:training OR abs:learning OR abs:"fine-tuning" OR abs:distillation OR abs:"reinforcement learning")'
  },
  {
    id: "arxiv-broad",
    name: "arXiv · 智能体记忆泛检索",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:00",
    note: "检索窗口内自动翻页；不限定子方向，检索 agent memory、long-term memory、persistent memory 等表述的最近论文。",
    url: arxivUrl('(abs:"agent memory" OR abs:"memory agent" OR abs:"long-term memory" OR abs:"persistent memory" OR abs:"episodic memory" OR abs:"memory system") AND (abs:agent OR abs:LLM OR abs:"language model")'),
    query: '(abs:"agent memory" OR abs:"memory agent" OR abs:"long-term memory" OR abs:"persistent memory" OR abs:"episodic memory" OR abs:"memory system") AND (abs:agent OR abs:LLM OR abs:"language model")'
  },
  {
    id: "arxiv-multimodal",
    name: "arXiv · 多模态记忆",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:00",
    topicHint: "multimodal",
    note: "检索窗口内自动翻页；视觉、视频、音频、图像与记忆的交叉；独立检索，避免被具身或评测方向淹没。",
    url: arxivUrl('(ti:memory OR ti:memories OR abs:"agent memory" OR abs:"long-term memory" OR abs:"episodic memory") AND (abs:multimodal OR abs:"multi-modal" OR abs:"vision-language" OR abs:visual OR abs:video OR abs:audio OR abs:image)'),
    query: '(ti:memory OR ti:memories OR abs:"agent memory" OR abs:"long-term memory" OR abs:"episodic memory") AND (abs:multimodal OR abs:"multi-modal" OR abs:"vision-language" OR abs:visual OR abs:video OR abs:audio OR abs:image)'
  },
  {
    id: "arxiv-eval",
    name: "arXiv · 记忆评测",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:00",
    topicHint: "evaluation",
    note: "检索窗口内自动翻页；记忆基准、评测方法、诊断和失败分析。",
    url: arxivUrl('(ti:memory OR ti:memories OR abs:"agent memory" OR abs:"long-term memory") AND (abs:benchmark OR abs:evaluation OR abs:evaluating OR abs:diagnosis OR abs:metric)'),
    query: '(ti:memory OR ti:memories OR abs:"agent memory" OR abs:"long-term memory") AND (abs:benchmark OR abs:evaluation OR abs:evaluating OR abs:diagnosis OR abs:metric)'
  },
  {
    id: "arxiv-personal",
    name: "arXiv · 对话与个性化记忆",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:00",
    topicHint: "personal",
    note: "检索窗口内自动翻页；长期对话、用户画像、偏好与个性化记忆。",
    url: arxivUrl('(ti:memory OR ti:memories OR abs:"agent memory" OR abs:"long-term memory") AND (abs:personalization OR abs:"user profile" OR abs:"user preference" OR abs:conversation OR abs:dialogue OR abs:assistant)'),
    query: '(ti:memory OR ti:memories OR abs:"agent memory" OR abs:"long-term memory") AND (abs:personalization OR abs:"user profile" OR abs:"user preference" OR abs:conversation OR abs:dialogue OR abs:assistant)'
  },
  {
    id: "arxiv-survey",
    name: "arXiv · 记忆综述",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:00",
    topicHint: "survey",
    note: "检索窗口内自动翻页；综述、分类体系和研究议程。",
    url: arxivUrl('(abs:survey OR abs:"systematic review") AND ti:memory AND (abs:agent OR abs:LLM)'),
    query: '(abs:survey OR abs:"systematic review") AND ti:memory AND (abs:agent OR abs:LLM)'
  },
  {
    id: "hf-daily",
    name: "Hugging Face · Daily Papers",
    kind: "论文索引",
    type: "hf",
    cadence: "每日 08:00",
    note: "社区每日推荐；按 arXiv 编号与 arXiv 结果合并。",
    url: "https://huggingface.co/api/daily_papers"
  },
  {
    id: "gh-mem0",
    name: "Mem0 · Releases",
    kind: "项目发布",
    type: "feed",
    cadence: "每日 08:00",
    note: "官方 GitHub Releases。",
    url: "https://github.com/mem0ai/mem0/releases.atom"
  },
  {
    id: "gh-letta",
    name: "Letta · Releases",
    kind: "项目发布",
    type: "feed",
    cadence: "每日 08:00",
    note: "官方 GitHub Releases。",
    url: "https://github.com/letta-ai/letta/releases.atom"
  },
  {
    id: "gh-graphiti",
    name: "Graphiti · Releases",
    kind: "项目发布",
    type: "feed",
    cadence: "每日 08:00",
    note: "官方 GitHub Releases。",
    url: "https://github.com/getzep/graphiti/releases.atom"
  },
  {
    id: "gh-langmem",
    name: "LangMem · Releases",
    kind: "项目发布",
    type: "feed",
    cadence: "每日 08:00",
    note: "官方 GitHub Releases。",
    url: "https://github.com/langchain-ai/langmem/releases.atom"
  },
  {
    id: "gh-search",
    name: "GitHub · Agent Memory 项目",
    kind: "项目索引",
    type: "github-search",
    cadence: "每周一 08:00",
    note: "GitHub Search API；配置 GITHUB_TOKEN 提高限额，未配置时跳过。",
    url: "https://api.github.com/search/repositories?q=agent+memory+in:name,description,readme&sort=stars&order=desc&per_page=30"
  },
  {
    id: "blog-langchain",
    name: "LangChain Blog",
    kind: "新闻 / 博客",
    type: "rss",
    cadence: "每日 08:00",
    note: "智能体记忆与上下文工程的官方技术博客。",
    url: "https://www.langchain.com/blog/rss.xml"
  },
  {
    id: "blog-msr",
    name: "Microsoft Research",
    kind: "新闻 / 博客",
    type: "rss",
    cadence: "每日 08:00",
    note: "研究博客；只保留同时涉及智能体与记忆的内容。",
    url: "https://www.microsoft.com/en-us/research/feed/"
  },
  {
    id: "news-qbit",
    name: "量子位",
    kind: "新闻 / 博客",
    type: "rss",
    cadence: "每日 08:00",
    note: "中文 AI 媒体；按智能体与记忆相关性筛选。",
    url: "https://www.qbitai.com/feed"
  },
  {
    id: "news-ithome",
    name: "IT之家",
    kind: "新闻 / 博客",
    type: "rss",
    cadence: "每日 08:00",
    note: "中文科技媒体；按智能体与记忆相关性筛选。",
    url: "https://www.ithome.com/rss/"
  },
  {
    id: "news-techcrunch",
    name: "TechCrunch",
    kind: "新闻 / 博客",
    type: "rss",
    cadence: "每日 08:00",
    note: "英文科技媒体；按智能体与记忆相关性筛选。",
    url: "https://techcrunch.com/feed/"
  }
];
