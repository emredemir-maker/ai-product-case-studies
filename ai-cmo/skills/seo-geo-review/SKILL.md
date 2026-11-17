---
name: seo-geo-review
description: Review a website for search (SEO) and for AI answer engines (GEO, generative engine optimization) and turn observations into prioritized recommendations. Use in every site review.
---

# SEO and GEO review

SEO is being found and ranked by search engines. GEO is being read, understood and cited by AI assistants (ChatGPT, Claude, Perplexity, Google AI Overviews). They share a base: crawlable pages that state clearly what the product is. GEO adds: can a model lift an accurate, self-contained answer from this page, and is it allowed to fetch it?

## Order of work

1. **Access first.** A page that cannot be crawled gains nothing from better copy. Check: robots.txt blocking search or AI crawlers, noindex on pages that should rank, missing sitemap, non-200 pages, missing canonicals. These are high priority when they affect pages that matter.
2. **Changed pages next.** New and changed pages are where regressions enter: a redesign that dropped the H1, a new feature page without a title or description, a page missing from the sitemap.
3. **Pages that carry intent.** Home, pricing, product and feature pages, comparison pages, docs entry points. Mechanical issues on a legal page are low priority.
4. **Coverage gaps.** A feature that shipped (see the commits) with no page, no docs and no mention on the site cannot be found by anyone.

## What makes a page citable by AI

- The first paragraph says what the thing is, who it is for and what it does, in plain declarative sentences. Models quote definitions, not slogans.
- Facts are stated on the page as text: pricing, limits, supported platforms, integrations. Content that exists only in images, tabs loaded by script, or a PDF is often not read.
- Questions people ask are answered under headings phrased the way they ask them, each answer complete in itself.
- Structured data matches the visible content: Organization and WebSite on the home page, Product or SoftwareApplication with offers on product and pricing pages, FAQPage where there are real questions and answers, Article on posts, BreadcrumbList on deep pages.
- An `llms.txt` at the root lists the pages a model should read, with one line on each. Low cost; keep it in step with the site.
- Claims carry their source or their number. "Cuts setup from 2 days to 20 minutes" is citable; "blazing fast" is not.
- Dates are visible on content that ages.

## Using the audit reports

The review includes reports from external audit tools. They measure; they have no sense of what matters for this product. Take their checks as evidence, then decide. Before recommending a fix, read the page when the report alone does not tell you what to write. Group the same issue across pages into one recommendation. Skip what does not matter: thin content on a login page, missing schema on a legal page.

**GEO Optimizer** reports a 0-100 AI-readiness score with a breakdown by category (robots and crawler access, llms.txt, schema, meta, content, signals, AI discovery, brand entity) and per-check details. Lead with the categories that lost the most points on pages that carry intent. Its own tool can produce some fixes: `geo llms --base-url <site>` generates an llms.txt from the sitemap, `geo schema` generates JSON-LD, and `geo fix --url <site>` previews robots.txt rules, llms.txt, schema and meta tags without writing anything. When one of these fits, name the command in the prompt for the coding agent, and still state the content the result must contain. The score is that tool's rubric, not a ranking factor; do not promise outcomes from raising it.

**AI visibility reports** (for example from Canonry) show whether answer engines mention or cite the brand for tracked queries, and who they cite instead. A query where competitors are cited and the brand is not points to a missing or weak page for that question: recommend the page or the section, not "improve visibility".

## Writing the recommendation

- Title: the change, as an instruction ("Add a meta description to /pricing").
- Why: what you observed and what it costs, in one or two sentences.
- Action: specific enough to do without further research. When the fix is text, write the text: the proposed title tag, the description, the opening paragraph, the JSON-LD.
- Evidence: the URLs or commits it rests on.
- Priority: high when it blocks discovery of an important page or misstates the product; medium when it improves a page that carries intent; low for hygiene.
