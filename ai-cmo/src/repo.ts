import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Commit {
  hash: string;
  date: string;
  subject: string;
  body: string;
  files: string[];
}

const SEP = "\u001f";
const END = "\u001e";

/** Commits in a local git clone since `since` (ISO date), newest first, capped at `limit`. */
export async function recentCommits(repoPath: string, since: string, limit = 60): Promise<Commit[]> {
  const { stdout } = await run(
    "git",
    ["-C", repoPath, "log", `--since=${since}`, `-n${limit}`, "--no-merges", "--name-only", `--format=${END}%h${SEP}%cI${SEP}%s${SEP}%b${SEP}`],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout
    .split(END)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [hash = "", date = "", subject = "", body = "", files = ""] = chunk.split(SEP);
      return {
        hash,
        date,
        subject,
        body: body.trim().slice(0, 600),
        files: files.split("\n").map((f) => f.trim()).filter(Boolean).slice(0, 25),
      };
    });
}

/**
 * Keeps a history-only mirror of a remote repository in `dir`: cloned on first use, fetched after.
 * File contents are not downloaded (`--filter=blob:none`); commit messages and file names are enough.
 * The token is passed to git through the environment, so it never appears in a process listing.
 */
export async function syncRepo(url: string, dir: string, token: string | null): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (token && /^https:\/\//.test(url)) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.extraHeader";
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }
  const git = (args: string[]) => run("git", args, { env, timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  try {
    await run("git", ["-C", dir, "rev-parse", "--git-dir"]);
  } catch {
    await git(["clone", "--bare", "--filter=blob:none", "--quiet", url, dir]);
    return;
  }
  await git(["-C", dir, "fetch", "--quiet", "--prune", url, "+refs/heads/*:refs/heads/*"]);
}
