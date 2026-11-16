# AI CMO

A self-hosted marketing agent for a product you build and change often. It does two jobs:

1. **Watches your site and your commits**, and on a schedule tells you what to do next for search (SEO), AI answer engines (GEO) and product-led growth (PLG).
2. **Plans and writes social posts**, from a brief or from a feature it saw you ship, and puts them in a review queue. A person approves each post before it is sent to [Postiz](https://github.com/gitroomhq/postiz-app) for publishing.

Both land in one local interface, the growth desk.

![Growth desk](docs/growth-desk.png)

```
your site ──crawl──┐
                   ├──> Claude agent ──> recommendations ──> you: done / dismiss (with a reason)
your repos ─git log┘         │
                             └────────> post drafts ──────> you: approve ──> Postiz ──> channels
```

## Design

- **The agent cannot publish.** Its tools read channels, load skills and save drafts. Sending a post to Postiz happens only in `cmo approve`, which a person runs.
- **One agent, many skills.** Channel and task expertise lives in `SKILL.md` playbooks the agent loads on demand, not in separate agents. Two are included; `npm run skills:install` adds the MIT-licensed [marketingskills](https://github.com/coreyhaines31/marketingskills) set (copywriting, SEO, CRO, email, ads and more).
- **Postiz stays a separate service.** This project talks to its public HTTP API only. Postiz is AGPL-3.0; none of its code is included or linked here.
- **Rejections are feedback.** Rejecting a post or dismissing a recommendation stores your reason, and the agent reads it before its next run.
- **Scripts measure, the agent judges.** A crawler collects page facts (titles, descriptions, headings, structured data, robots.txt rules for AI crawlers, sitemap, `llms.txt`) and diffs them against the last check. The agent decides which of them matter, reads pages where it needs to, and writes the fix.
- **Local and single-user.** The interface listens on `127.0.0.1` only, and accepts writes only from its own page.

## Setup

Requires Node 20+.

```bash
npm install
cp .env.example .env                 # add ANTHROPIC_API_KEY; POSTIZ_API_KEY is optional
cp brand.example.json brand.json     # describe your brand, audience and voice
cp watch.example.json watch.json     # your site URL and the local paths of your app repos
npm run skills:install               # optional: more marketing skills
```

Without a Postiz key the agent still plans and drafts by platform name; you need the key to list channels and to approve.

## Use

### Watch the site and the product

```bash
npm run cmo -- ui --every 24         # open http://localhost:4321 and check once a day
npm run cmo -- review                # or run one check now from the terminal
npm run cmo -- todo                  # list open recommendations
```

`watch.json` names the site to crawl and the git clones to read commits from:

```json
{
  "site": { "url": "https://example.com", "maxPages": 30 },
  "repos": [{ "name": "app", "path": "../my-app" }]
}
```

Each check crawls the site (sitemap first, links otherwise), compares it with the previous check, reads the commits made since, and saves at most eight recommendations, each with the reason, the concrete change and the evidence. The first check treats the whole site as new. `ui --every` keeps the process running; to schedule without it, run `npm run cmo -- review` from cron.

"PLG 2.0" and "PLG 3.0" have no single agreed definition. `skills/plg-review/SKILL.md` states the one used here (product-led with sales and lifecycle assistance; AI-native products that are also usable by agents); edit it to match yours.

### Posts

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

Approving and rejecting also work from the interface.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Claude API key |
| `POSTIZ_API_URL` | `https://api.postiz.com/public/v1` | Postiz public API; for self-hosted use `https://<backend>/public/v1` |
| `POSTIZ_API_KEY` | | Postiz API key, from your Postiz settings |
| `CMO_MODEL` | `claude-opus-5-5` | Model for the agent |
| `CMO_EFFORT` | `high` | `low` to `max`; lower is faster and cheaper |
| `CMO_WEB_SEARCH` | on | Set `0` to disable web research |
| `CMO_UI_PORT` | `4321` | Port of the local interface |
| `CMO_BRAND_FILE`, `CMO_WATCH_FILE`, `CMO_SKILLS_DIR`, `CMO_DATA_DIR` | `brand.json`, `watch.json`, `skills/`, `data/` | File locations |

## Layout

| Path | What it holds |
|---|---|
| `src/agent.ts` | Post-planning prompt and tools, the tool-runner loop |
| `src/review.ts` | The site and product review: inputs, prompt, tools, run record |
| `src/site.ts` | Crawler, page signals, mechanical checks, snapshot diff |
| `src/repo.ts` | Recent commits from a local git clone |
| `src/recommendations.ts` | Recommendation list (JSON file) |
| `src/ui.ts`, `src/ui.html` | The local interface |
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

- The review sees the public site and commit messages only: no analytics, no Search Console, no logged-in product. It says so when a recommendation depends on a number it cannot see.
- Pages are fetched without running JavaScript, so content rendered only in the browser is not seen. That is also how most AI crawlers see the site.
- Text posts only; no images or video yet.
- Everything is stored in local JSON files, for one user on one machine.
- Some Postiz providers require settings (for example who can reply on X). The agent reads the schema from Postiz and fills them in, and Postiz validates them on approve.
