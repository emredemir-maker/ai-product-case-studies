import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface Config {
  root: string;
  brandFile: string;
  skillsDir: string;
  draftsFile: string;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  webSearch: boolean;
  postiz: { baseUrl: string; apiKey: string } | null;
}

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const effort = env.CMO_EFFORT ?? "high";
  if (!EFFORTS.includes(effort as Config["effort"])) {
    throw new Error(`CMO_EFFORT must be one of ${EFFORTS.join(", ")}`);
  }
  const dataDir = env.CMO_DATA_DIR ?? path.join(root, "data");
  return {
    root,
    brandFile: env.CMO_BRAND_FILE ?? path.join(root, "brand.json"),
    skillsDir: env.CMO_SKILLS_DIR ?? path.join(root, "skills"),
    draftsFile: path.join(dataDir, "drafts.json"),
    model: env.CMO_MODEL ?? "claude-opus-5-5",
    effort: effort as Config["effort"],
    webSearch: env.CMO_WEB_SEARCH !== "0",
    postiz: env.POSTIZ_API_KEY
      ? {
          baseUrl: env.POSTIZ_API_URL ?? "https://api.postiz.com/public/v1",
          apiKey: env.POSTIZ_API_KEY,
        }
      : null,
  };
}
