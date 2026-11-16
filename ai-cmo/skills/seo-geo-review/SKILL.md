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

## Judging the mechanical findings

The findings list is produced by a script and has no sense of importance. Before recommending a fix, read the page when the finding alone does not tell you what to write. Group the same issue across pages into one recommendation rather than one per page. Skip findings that do not matter: thin content on a login page, missing schema on a legal page.

## Writing the recommendation

- Title: the change, as an instruction ("Add a meta description to /pricing").
- Why: what you observed and what it costs, in one or two sentences.
- Action: specific enough to do without further research. When the fix is text, write the text: the proposed title tag, the description, the opening paragraph, the JSON-LD.
- Evidence: the URLs or commits it rests on.
- Priority: high when it blocks discovery of an important page or misstates the product; medium when it improves a page that carries intent; low for hygiene.
