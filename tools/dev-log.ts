/**
 * Dev Log - post the calculator dev log to Discord under its own webhook,
 * pinging the dev-log role. Reads a finished post (written in the style of
 * docs/internal/dev_log_style_guide.md) from a file or stdin, lints it, previews it,
 * and on --send posts it with the role ping scoped via allowed_mentions.
 * Splits on category (`## `) boundaries only if it exceeds the message limit.
 *
 * Usage:
 *   npx tsx tools/dev-log.ts                    # lint + preview, send nothing
 *   npx tsx tools/dev-log.ts --send             # preview, confirm, then post
 *   npx tsx tools/dev-log.ts --send --yes       # post without the confirm prompt
 *   npx tsx tools/dev-log.ts --input <file>     # draft file (default below)
 *   npx tsx tools/dev-log.ts --stdin            # read the draft from stdin
 *
 * Config (untracked): webhook in tools/dev-log.webhook.local or env
 * COS_DEV_LOG_DISCORD_WEBHOOK; role id in tools/dev-log.config.local.json
 * ({"roleId": "..."}) or env COS_DEV_LOG_ROLE_ID.
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { readWebhook, sendDiscordMessages } from "./lib/toolkit";
import { lint, splitPost } from "./lib/devLog";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const WEBHOOK_ENV = "COS_DEV_LOG_DISCORD_WEBHOOK";
const WEBHOOK_FILE = path.join(TOOLS, "dev-log.webhook.local");
const CONFIG_FILE = path.join(TOOLS, "dev-log.config.local.json");
const DEFAULT_DRAFT = path.join(TOOLS, "dev-log.draft.local.md");
const USER_AGENT = "cos-calc-dev-log";

interface Args {
  send: boolean;
  yes: boolean;
  stdin: boolean;
  input: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { send: false, yes: false, stdin: false, input: DEFAULT_DRAFT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--send") args.send = true;
    else if (a === "--yes") args.yes = true;
    else if (a === "--stdin") args.stdin = true;
    else if (a === "--input") args.input = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function loadDraft(args: Args): string {
  return fs.readFileSync(args.stdin ? 0 : args.input, "utf8");
}

function resolveRoleId(): string | null {
  const fromEnv = process.env.COS_DEV_LOG_ROLE_ID?.trim();
  if (fromEnv) return fromEnv;
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as { roleId?: string };
    return cfg.roleId?.trim() || null;
  } catch {
    return null;
  }
}

function preview(messages: string[]): void {
  messages.forEach((m, i) => {
    console.log(`----- message ${i + 1}/${messages.length} (${m.length} chars) -----`);
    console.log(m);
    console.log();
  });
}

function confirmProceed(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const draft = loadDraft(args);
  const messages = splitPost(draft);

  preview(messages);

  const { errors, warnings } = lint(draft);
  warnings.forEach((w) => console.warn(`warn: ${w}`));
  errors.forEach((e) => console.error(`error: ${e}`));

  if (!args.send) {
    const status = errors.length ? `${errors.length} error(s) to fix before --send` : "clean";
    console.log(`Preview only (${status}). ${messages.length} message(s). Re-run with --send to post.`);
    return;
  }

  if (errors.length) throw new Error(`${errors.length} lint error(s); fix them before sending.`);

  const webhook = readWebhook(WEBHOOK_ENV, WEBHOOK_FILE);
  if (!webhook) throw new Error(`No webhook. Set ${WEBHOOK_ENV} or write ${WEBHOOK_FILE}.`);
  const roleId = resolveRoleId();
  if (!roleId) throw new Error(`No role id. Set COS_DEV_LOG_ROLE_ID or write ${CONFIG_FILE}.`);

  if (!args.yes && !(await confirmProceed(`Post ${messages.length} message(s) and ping <@&${roleId}>?`))) {
    console.log("Aborted.");
    return;
  }

  await sendDiscordMessages(webhook, messages, USER_AGENT, { parse: [], roles: [roleId] });
  console.log(`Posted ${messages.length} message(s).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
