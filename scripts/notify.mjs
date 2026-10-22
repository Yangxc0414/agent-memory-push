import fs from "node:fs";
import path from "node:path";
import { DIST, ROOT, readJson, writeJson } from "./lib.mjs";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const FORCE = args.has("--force");
const site = readJson(path.join(ROOT, "src", "data", "site.json"));
const digest = readJson(path.join(DIST, "api", "v1", "digest.json"));
const stateFile = process.env.NOTIFY_STATE || path.join(ROOT, ".state", "notified.json");
const state = fs.existsSync(stateFile) ? readJson(stateFile) : {};

function log(message) {
  console.log(`[notify] ${message}`);
}

function markSent(channel) {
  state[channel] = digest.date;
  if (!DRY_RUN) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    writeJson(stateFile, state);
  }
}

function alreadySent(channel) {
  return !FORCE && state[channel] === digest.date;
}

async function postJson(url, body, label, headers = {}) {
  if (DRY_RUN) {
    log(`${label} dry-run payload (${JSON.stringify(body).length} bytes)`);
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        signal: AbortSignal.timeout(20000),
        body: JSON.stringify(body)
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // Some webhook mocks return plain text.
      }
      if (json && json.code !== undefined && json.code !== 0) {
        throw new Error(`webhook code ${json.code}: ${json.msg || text.slice(0, 200)}`);
      }
      if (json && json.ok === false) throw new Error(`telegram error: ${text.slice(0, 200)}`);
      log(`${label} sent (${text.length} bytes response)`);
      return;
    } catch (error) {
      lastError = error;
      log(`${label} attempt ${attempt + 1} failed: ${error instanceof Error ? error.message : error}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function topPicks(count = 5) {
  return digest.picks.slice(0, count);
}

function feishuPayload() {
  const picks = topPicks(6);
  const pickText = picks
    .map(
      (pick, index) =>
        `**${index + 1}. ${pick.titleZh || pick.title}**\n${pick.summaryZh || ""}\n[原文](${pick.url}) · ${pick.source} · ${pick.evidence || ""}`
    )
    .join("\n\n");
  const stats = digest.stats || {};
  return {
    msg_type: "interactive",
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: "green",
        title: { tag: "plain_text", content: `${site.name} · ${digest.date}` }
      },
      elements: [
        {
          tag: "div",
          text: { tag: "lark_md", content: digest.lead }
        },
        { tag: "hr" },
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: `**本期 ${stats.items || 0} 条 · ${stats.papers || 0} 篇论文 · ${stats.news || 0} 条新闻 · ${stats.security || 0} 条安全**\n${digest.window.label}`
          }
        },
        { tag: "div", text: { tag: "lark_md", content: pickText } },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: { tag: "plain_text", content: "打开今日推送" },
              type: "primary",
              url: site.url
            }
          ]
        }
      ]
    }
  };
}

function telegramPayload() {
  const picks = topPicks(5);
  const text = [
    `<b>${site.name} · ${digest.date}</b>`,
    digest.lead,
    "",
    ...picks.map(
      (pick, index) =>
        `${index + 1}. <a href="${pick.url}">${pick.titleZh || pick.title}</a>\n${pick.summaryZh || ""}\n<i>${pick.source} · ${pick.evidence || ""}</i>`
    ),
    "",
    `<a href="${site.url}">打开今日推送</a>`
  ].join("\n");
  return {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
}

async function main() {
  let sent = 0;
  if (process.env.FEISHU_WEBHOOK) {
    if (alreadySent("feishu")) log(`feishu already sent for ${digest.date}, skip`);
    else {
      await postJson(process.env.FEISHU_WEBHOOK, feishuPayload(), "feishu");
      markSent("feishu");
      sent += 1;
    }
  } else {
    log("FEISHU_WEBHOOK not set, skip feishu");
  }

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    if (alreadySent("telegram")) log(`telegram already sent for ${digest.date}, skip`);
    else {
      await postJson(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        telegramPayload(),
        "telegram"
      );
      markSent("telegram");
      sent += 1;
    }
  } else {
    log("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set, skip telegram");
  }

  if (!sent && !DRY_RUN) log("no channel sent");
}

main().catch((error) => {
  console.error(`[notify] failed: ${error instanceof Error ? error.stack : error}`);
  process.exitCode = 1;
});
