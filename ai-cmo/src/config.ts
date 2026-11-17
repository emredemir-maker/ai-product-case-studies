import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface Config {
  root: string;
  brandFile: string;
  skillsDir: string;
  draftsFile: string;
  recommendationsFile: string;
  runsFile: string;
  snapshotsDir: string;
  watchFile: string;
  uiPort: number;
  /** Address to listen on. Anything but loopback requires a password and a public URL. */
  uiHost: string;
  /** The address people open when the interface runs on a server, e.g. https://cmo.example.com. */
  publicUrl: string | null;
  password: string | null;
  sessionSecretFile: string;
  /** Where repositories given by URL in watch.json are cloned. */
  reposDir: string;
  /** Token for cloning private repositories over HTTPS. */
  gitToken: string | null;
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
    recommendationsFile: path.join(dataDir, "recommendations.json"),
    runsFile: path.join(dataDir, "runs.json"),
    snapshotsDir: path.join(dataDir, "snapshots"),
    watchFile: env.CMO_WATCH_FILE ?? path.join(root, "watch.json"),
    uiPort: Number(env.CMO_UI_PORT ?? 4321),
    uiHost: env.CMO_HOST ?? "127.0.0.1",
    publicUrl: env.CMO_PUBLIC_URL || null,
    password: env.CMO_PASSWORD || null,
    sessionSecretFile: path.join(dataDir, "session-secret"),
    reposDir: path.join(dataDir, "repos"),
    gitToken: env.CMO_GIT_TOKEN || null,
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
