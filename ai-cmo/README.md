# AI CMO

A self-hosted marketing agent: give it a brief, it researches, plans and writes finished social posts, and puts them in a review queue. A person approves each post before it is sent to [Postiz](https://github.com/gitroomhq/postiz-app) for scheduling and publishing.

```
brief ──> Claude agent ──> review queue ──> person approves ──> Postiz ──> social channels
            │  ▲                 │
   skills, brand, web search     └── rejected, with a reason the agent reads next run
```

## Design

- **The agent cannot publish.** Its tools read channels, load skills and save drafts. Sending a post to Postiz happens only in `cmo approve`, which a person runs.
- **One agent, many skills.** Channel and task expertise lives in `SKILL.md` playbooks the agent loads on demand, not in separate agents. Two are included; `npm run skills:install` adds the MIT-licensed [marketingskills](https://github.com/coreyhaines31/marketingskills) set (copywriting, SEO, CRO, email, ads and more).
- **Postiz stays a separate service.** This project talks to its public HTTP API only. Postiz is AGPL-3.0; none of its code is included or linked here.
- **Rejections are feedback.** `cmo reject <id> "reason"` stores the reason, and the agent reads past rejections before planning.

## Setup

Requires Node 20+.

```bash
npm install
cp .env.example .env                 # add ANTHROPIC_API_KEY; POSTIZ_API_KEY is optional
cp brand.example.json brand.json     # describe your brand, audience and voice
npm run skills:install               # optional: more marketing skills
```

Without a Postiz key the agent still plans and drafts by platform name; you need the key to list channels and to approve.

## Use

```bash
npm run cmo -- plan "One week of LinkedIn posts for the Funnels launch, 3 posts"
npm run cmo -- drafts pending
npm run cmo -- show a1b2c3
npm run cmo -- approve a1b2c3                  # schedule at the draft's time
npm run cmo -- approve a1b2c3 --now            # publish immediately
npm run cmo -- approve a1b2c3 --at 2026-12-01T09:00:00+03:00 --channel <id>
npm run cmo -- reject a1b2c3 "Too salesy, lead with the customer result"
npm run cmo -- channels
npm run cmo -- skills
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Claude API key |
| `POSTIZ_API_URL` | `https://api.postiz.com/public/v1` | Postiz public API; for self-hosted use `https://<backend>/public/v1` |
| `POSTIZ_API_KEY` | | Postiz API key, from your Postiz settings |
| `CMO_MODEL` | `claude-opus-5-5` | Model for the agent |
| `CMO_EFFORT` | `high` | `low` to `max`; lower is faster and cheaper |
| `CMO_WEB_SEARCH` | on | Set `0` to disable web research |
| `CMO_BRAND_FILE`, `CMO_SKILLS_DIR`, `CMO_DATA_DIR` | `brand.json`, `skills/`, `data/` | File locations |

## Layout

| Path | What it holds |
|---|---|
| `src/agent.ts` | System prompt, agent tools, the tool-runner loop |
| `src/publish.ts` | Approve and reject: the only path from a draft to Postiz |
| `src/postiz.ts` | Postiz public API client |
| `src/drafts.ts` | Review queue (JSON file) |
| `src/skills.ts`, `skills/` | Skill discovery and the included playbooks |
| `src/brand.ts` | Brand file schema |
| `src/cli.ts` | Command line |

## Tests

```bash
npm test          # runs against local fake Postiz and Claude API servers; no keys needed
npm run typecheck
```

## Limits

- Text posts only; no images or video yet.
- Drafts live in a local JSON file, for one user on one machine.
- Some Postiz providers require settings (for example who can reply on X). The agent reads the schema from Postiz and fills them in, and Postiz validates them on approve.
