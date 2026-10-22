export const ARXIV_BASE = "https://export.arxiv.org/api/query";

export const SOURCES = [
  {
    id: "arxiv-memory",
    name: "arXiv · 智能体记忆与自进化",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:10",
    note: "滚动 30 天检索记忆、情景、经验、反思、技能与智能体/持续学习的交集。",
    url: `${ARXIV_BASE}?search_query=${encodeURIComponent('(all:memory OR all:episodic OR all:experience OR all:reflection OR all:skill) AND (all:agent OR all:"recursive self-improvement" OR all:self-improving OR all:"continual learning")')}&sortBy=submittedDate&sortOrder=descending&max_results=100`,
    query: '(all:memory OR all:episodic OR all:experience OR all:reflection OR all:skill) AND (all:agent OR all:"recursive self-improvement" OR all:self-improving OR all:"continual learning")'
  },
  {
    id: "arxiv-embodied",
    name: "arXiv · 具身与多模态记忆",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:10",
    note: "记忆、记忆化与 VLA、具身、多模态、机器人、导航的交集。",
    url: `${ARXIV_BASE}?search_query=${encodeURIComponent('(all:memory OR all:memorization) AND (all:VLA OR all:"vision-language-action" OR all:embodied OR all:multimodal OR all:robot)')}&sortBy=submittedDate&sortOrder=descending&max_results=100`,
    query: '(all:memory OR all:memorization) AND (all:VLA OR all:"vision-language-action" OR all:embodied OR all:multimodal OR all:robot)'
  },
  {
    id: "arxiv-security",
    name: "arXiv · 记忆安全与评测",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:10",
    note: "投毒、持久注入、隐私外泄、防御、访问隔离、溯源与安全评测。",
    url: `${ARXIV_BASE}?search_query=${encodeURIComponent('(all:memory OR all:memorization OR all:"persistent state") AND (all:agent OR all:LLM OR all:"language model") AND (all:poisoning OR all:injection OR all:backdoor OR all:attack OR all:defense OR all:privacy OR all:exfiltration OR all:watermark OR all:provenance OR all:unlearning OR all:security)')}&sortBy=submittedDate&sortOrder=descending&max_results=100`,
    query: '(all:memory OR all:memorization OR all:"persistent state") AND (all:agent OR all:LLM OR all:"language model") AND (all:poisoning OR all:injection OR all:backdoor OR all:attack OR all:defense OR all:privacy OR all:exfiltration OR all:watermark OR all:provenance OR all:unlearning OR all:security)'
  },
  {
    id: "arxiv-models",
    name: "arXiv · 记忆专用模型",
    kind: "论文索引",
    type: "arxiv",
    cadence: "每日 08:10",
    note: "记忆写入、检索、压缩、管理模型的训练、微调、蒸馏与强化学习。",
    url: `${ARXIV_BASE}?search_query=${encodeURIComponent('(all:"memory writer" OR all:"memory writing" OR all:"memory manager" OR all:"memory management" OR all:"memory retriever" OR all:"memory compressor" OR all:"latent memory") AND (all:training OR all:learning OR all:"fine-tuning" OR all:distillation OR all:"reinforcement learning")')}&sortBy=submittedDate&sortOrder=descending&max_results=100`,
    query: '(all:"memory writer" OR all:"memory writing" OR all:"memory manager" OR all:"memory management" OR all:"memory retriever" OR all:"memory compressor" OR all:"latent memory") AND (all:training OR all:learning OR all:"fine-tuning" OR all:distillation OR all:"reinforcement learning")'
  },
  {
    id: "hf-daily",
    name: "Hugging Face · Daily Papers",
    kind: "论文索引",
    type: "hf",
    cadence: "每日 08:10",
    note: "社区每日推荐；按 arXiv 编号与 arXiv 结果合并。",
    url: "https://huggingface.co/api/daily_papers"
  },
  {
    id: "gh-mem0",
    name: "Mem0 · Releases",
    kind: "项目发布",
    type: "feed",
    cadence: "每日 08:10",
    note: "官方 GitHub Releases。",
    url: "https://github.com/mem0ai/mem0/releases.atom"
  },
  {
    id: "gh-letta",
    name: "Letta · Releases",
    kind: "项目发布",
    type: "feed",
    cadence: "每日 08:10",
    note: "官方 GitHub Releases。",
    url: "https://github.com/letta-ai/letta/releases.atom"
  },
  {
    id: "gh-graphiti",
    name: "Graphiti · Releases",
    kind: "项目发布",
    type: "feed",
    cadence: "每日 08:10",
    note: "官方 GitHub Releases。",
    url: "https://github.com/getzep/graphiti/releases.atom"
  },
  {
    id: "gh-langmem",
    name: "LangMem · Releases",
    kind: "项目发布",
    type: "feed",
    cadence: "每日 08:10",
    note: "官方 GitHub Releases。",
    url: "https://github.com/langchain-ai/langmem/releases.atom"
  },
  {
    id: "gh-search",
    name: "GitHub · Agent Memory 项目",
    kind: "项目索引",
    type: "github-search",
    cadence: "每周一 08:10",
    note: "GitHub Search API；配置 GITHUB_TOKEN 提高限额，未配置时跳过。",
    url: "https://api.github.com/search/repositories?q=agent+memory+in:name,description,readme&sort=stars&order=desc&per_page=30"
  },
  {
    id: "blog-langchain",
    name: "LangChain Blog",
    kind: "新闻 / 博客",
    type: "rss",
    cadence: "每日 08:10",
    note: "智能体记忆与上下文工程的官方技术博客。",
    url: "https://www.langchain.com/blog/rss.xml"
  },
  {
    id: "blog-msr",
    name: "Microsoft Research",
    kind: "新闻 / 博客",
    type: "rss",
    cadence: "每日 08:10",
    note: "研究博客；只保留同时涉及智能体与记忆的内容。",
    url: "https://www.microsoft.com/en-us/research/feed/"
  },
  {
    id: "news-qbit",
    name: "量子位",
    kind: "新闻 / 博客",
    type: "rss",
    cadence: "每日 08:10",
    note: "中文 AI 媒体；按智能体与记忆相关性筛选。",
    url: "https://www.qbitai.com/feed"
  },
  {
    id: "news-ithome",
    name: "IT之家",
    kind: "新闻 / 博客",
    type: "rss",
    cadence: "每日 08:10",
    note: "中文科技媒体；按智能体与记忆相关性筛选。",
    url: "https://www.ithome.com/rss/"
  },
  {
    id: "news-techcrunch",
    name: "TechCrunch",
    kind: "新闻 / 博客",
    type: "rss",
    cadence: "每日 08:10",
    note: "英文科技媒体；按智能体与记忆相关性筛选。",
    url: "https://techcrunch.com/feed/"
  }
];
