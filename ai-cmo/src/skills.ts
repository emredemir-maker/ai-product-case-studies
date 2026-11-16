import fs from "node:fs";
import path from "node:path";

export interface Skill {
  name: string;
  description: string;
  file: string;
}

const MAX_DEPTH = 4;

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    // Top-level `key: value` pairs only; nested blocks (metadata:) are ignored.
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (!kv || !kv[2]) continue;
    meta[kv[1]!] = kv[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return { meta, body: text.slice(match[0].length) };
}

/** Finds every SKILL.md under `dir`. The first skill found with a given name wins. */
export function discoverSkills(dir: string): Skill[] {
  const found = new Map<string, Skill>();
  const walk = (current: string, depth: number) => {
    if (depth > MAX_DEPTH || !fs.existsSync(current)) return;
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const skillFile = entries.find((e) => e.isFile() && e.name === "SKILL.md");
    if (skillFile) {
      const file = path.join(current, "SKILL.md");
      const { meta } = parseFrontmatter(fs.readFileSync(file, "utf8"));
      const name = meta.name ?? path.basename(current);
      if (!found.has(name)) found.set(name, { name, description: meta.description ?? "", file });
      return;
    }
    // Shallow directories first, so skills shipped in this repo beat vendored ones.
    for (const e of entries) {
      if (e.isDirectory() && e.name !== "vendor" && !e.name.startsWith(".")) walk(path.join(current, e.name), depth + 1);
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name === "vendor") walk(path.join(current, e.name), depth + 1);
    }
  };
  walk(dir, 0);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function readSkill(skill: Skill): string {
  return parseFrontmatter(fs.readFileSync(skill.file, "utf8")).body.trim();
}

export function renderSkillIndex(skills: Skill[]): string {
  return skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}
