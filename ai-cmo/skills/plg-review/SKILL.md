---
name: plg-review
description: Review a product's website and recent product changes through a product-led growth lens (self-serve PLG, product-led sales "PLG 2.0", AI-native "PLG 3.0") and recommend changes to acquisition, activation, expansion and virality. Use in every site review.
---

# Product-led growth review

Product-led growth means the product itself does the acquiring, converting and expanding. The terms "PLG 2.0" and "PLG 3.0" have no single agreed definition; this skill uses them as follows.

- **PLG 1.0, self-serve.** A visitor can understand, try and buy without talking to anyone: free tier or trial, public pricing, signup in one step, value before a paywall.
- **PLG 2.0, product-led with assistance.** Usage decides where human and lifecycle effort goes: product-qualified leads, upgrade prompts at the moment a limit is reached, onboarding by role or use case, team invites and sharing as growth loops, usage-based or seat-based expansion.
- **PLG 3.0, AI-native.** The product does the first piece of work for the user, so value arrives in minutes without setup; onboarding is a conversation or a generated starting point, not a tour; and the product is reachable by AI agents as well as people, through an API, an MCP server, and docs a model can read.

## What you can see, and what you cannot

You see the public site and the commit history. You do not see analytics, funnels or the logged-in product. Recommend from evidence you have, and say when a recommendation depends on a number you cannot see (for example "if activation is below X"). Do not invent metrics.

## What to look at

**From the site**
- Can a first-time visitor tell within one screen what the product does and start using it? Count the steps between landing and first value.
- Is pricing public, and does it show a free path and what triggers an upgrade?
- Is there a visible way to try before signing up: a demo, a sandbox, a sample output?
- Do feature pages lead to the feature inside the product, or only to "contact us"?
- Is there a changelog or "what's new"? A product that ships often and shows it converts returning visitors and gives AI assistants fresh facts.
- Are there shareable artefacts: public links, embeds, templates, a gallery? These are the loops.
- For agents: public API docs, an MCP server, an OpenAPI file, `llms.txt`.

**From the commits**
- Each user-facing change is a marketing event the site may not reflect yet. For a shipped feature ask: is it on the site, in the docs, in the changelog, in onboarding, in pricing if it is gated? Recommend the missing ones, and save a post draft announcing it when it is worth announcing.
- Changes to signup, onboarding, billing, invites, sharing or limits are PLG changes in themselves. Check that the site's promises (pricing page, plan limits, screenshots) still match.
- Internal work (refactors, dependency bumps, tests) needs no marketing action. Say nothing about it.

## Writing the recommendation

Follow the same form as other recommendations: an instruction as the title, what you observed and why it matters, a specific action, the evidence. Prefer the smallest change that tests the idea ("add a 'Try it with sample data' button on /funnels that opens the demo workspace") over a programme of work ("build a PLG motion"). One person works on this product; a recommendation should fit in a sitting or say plainly that it does not.
