// Generic plumbing shared by the data tools: read a Discord webhook, POST
// messages, and commit + push a set of paths to prod. Parameterised so each
// tool supplies its own webhook, commit message, branch, and signature.
// (wiki-sync still carries its own copies; unifying it is deferred.)

import { execFileSync } from "node:child_process";
import fs from "node:fs";

export function readWebhook(envVar: string, file: string): string | null {
  const fromEnv = process.env[envVar]?.trim();
  if (fromEnv) return fromEnv;
  try {
    return fs.readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export interface AllowedMentions {
  parse?: string[];
  roles?: string[];
  users?: string[];
}

export async function sendDiscordMessages(
  webhookUrl: string,
  messages: string[],
  userAgent: string,
  allowedMentions?: AllowedMentions,
): Promise<void> {
  for (let i = 0; i < messages.length; i++) {
    const body: { content: string; allowed_mentions?: AllowedMentions } = {
      content: messages[i],
    };
    // Mentions fire on the first message only; later messages suppress every
    // mention so a handle in their text can't ping a second time.
    if (allowedMentions) body.allowed_mentions = i === 0 ? allowedMentions : { parse: [] };
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": userAgent },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Discord webhook returned ${res.status}`);
  }
}

/**
 * Pack a header plus per-item blocks into as few messages as fit under Discord's
 * limit, never splitting a block. The footer, if given, is appended to the last
 * message (or its own trailing message when it would overflow).
 */
export function chunkDiscordMessages(
  header: string,
  blocks: string[],
  footer = "",
  limit = 1800,
): string[] {
  const messages: string[] = [];
  let current = header;
  for (const block of blocks) {
    if (!block) continue;
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > limit && current) {
      messages.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (footer) {
    const withFooter = `${current}\n\n${footer}`;
    if (withFooter.length > limit && current) {
      messages.push(current);
      messages.push(footer);
    } else {
      current = withFooter;
    }
  }
  if (current) messages.push(current);
  return messages;
}

function git(root: string, args: string[], inherit = false): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  }) as unknown as string;
}

export function gitStatusFor(root: string, paths: string[]): string {
  return git(root, ["status", "--porcelain", "--", ...paths]).trim();
}

export function currentBranch(root: string): string {
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (!branch || branch === "HEAD") {
    throw new Error("push requires a checked-out branch, not detached HEAD");
  }
  return branch;
}

/** Throw if any of `paths` already has uncommitted changes - so a push only
 *  ever commits what this run produced, never a pre-existing edit. */
export function ensurePathsClean(root: string, paths: string[], flag: string): void {
  const status = gitStatusFor(root, paths);
  if (status) {
    throw new Error(
      [`${flag} requires these paths clean before the run.`, "Existing changes:", status].join("\n"),
    );
  }
}

/**
 * Stage, commit (only these paths), and push to origin/<branch>. Returns false
 * if there was nothing to commit. Requires being on `branch`.
 */
export function commitAndPushPaths(
  root: string,
  paths: string[],
  message: string,
  branch: string,
): boolean {
  if (!gitStatusFor(root, paths)) return false;
  const on = currentBranch(root);
  if (on !== branch) {
    throw new Error(`push targets ${branch}, but the current branch is ${on}. Switch branches or set the push-branch env.`);
  }
  git(root, ["add", "--", ...paths], true);
  git(root, ["commit", "--only", "-m", message, "--", ...paths], true);
  git(root, ["push", "origin", branch], true);
  return true;
}
