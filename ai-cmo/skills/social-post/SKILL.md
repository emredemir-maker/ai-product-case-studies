---
name: social-post
description: Write a single social media post for a specific channel (LinkedIn, X, Threads, Bluesky, Facebook, Instagram caption). Use before drafting any post.
---

# Social post

Write for the channel the post will be published on, not a generic "social" voice.

## Before writing

1. Know the one thing the reader should take away. If you cannot say it in a sentence, the post is not ready.
2. Check the channel's length limit with `get_channel_rules` when a connected channel is the target.
3. Decide the job of the post: teach, show proof, start a conversation, or announce. One job per post.

## Shape

- **First line carries the post.** It is what shows before "see more". Make it a specific claim, number or observation, not a question the reader has no reason to answer.
- **Body earns the first line.** Give the evidence, the example or the steps. Short paragraphs, one idea each.
- **End on something usable**: the takeaway restated, a concrete next step, or a real question you want answered. Skip "Thoughts?".

## Channel notes

- **LinkedIn**: 600-1,300 characters reads well. Line breaks between short paragraphs. Links in the body reduce reach less than they used to, but put the value in the post itself. At most 3 hashtags, at the end.
- **X**: one idea in under 280 characters, or a thread where every post stands alone. No hashtags unless they are the topic.
- **Threads / Bluesky**: conversational, under 300 characters, no hashtag blocks.
- **Instagram**: the caption supports an image; say what the image cannot. Hashtags in a final block.

## Image

A post may carry one image, described in `visual` when you save the draft. The image is drawn from a fixed branded layout, so you supply words, not a design. Add one when it gives the reader something the first line alone does not; a post that is a plain reply or a short remark needs none.

Pick the kind by what the post leads with:

- **stat**: the post opens on a number. Put that number in `stat` exactly as the brand writes numbers, the claim it supports in `headline`, and its source and scope in `source`. If the number has no source you can state, do not make a stat image.
- **statement**: the post turns on one sentence the reader should remember. That sentence, tightened, is the `headline`.
- **screenshot**: the post announces or explains something a person can see in the product. The image shows the real screen under a short `headline`. You cannot take the screenshot; the person who builds the product has a coding agent that can. Write `screenshot.prompt` for that agent, and choose the `screenshot.file` name the result will be saved under.

Keep the words on the image short: a headline of at most about ten words, one optional supporting line in `detail`. Do not repeat the post; the image is read first and the post second. No hashtags, links or calls to action on the image.

**Writing the screenshot prompt.** The coding agent has the product's repository and can run the product, but knows nothing about this post. Tell it: which screen or page, and how to reach it; the state it should be in (which tab open, which row selected); that it must use demo or fictional data and never a real customer's (name the demo dataset if the brand notes or materials mention one); the viewport, 1600 by 1000 pixels at 2x scale, cropped to the part that matters; the file name, PNG, and that it should be saved for the founder to place in the materials folder. Say what must be visible for the screenshot to do its job, so the agent can check its own result.

## Rules

- Every factual claim must come from the brand context or from research you did in this session. If you cannot support a claim, cut it.
- Follow the brand voice "do" and "don't" lists exactly.
- No filler openers ("In today's fast-paced world"), no "it's not X, it's Y" constructions, no emoji as bullet points unless the brand voice asks for them.
- Write in the brand's language.
