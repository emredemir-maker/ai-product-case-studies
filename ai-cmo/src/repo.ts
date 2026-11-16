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
