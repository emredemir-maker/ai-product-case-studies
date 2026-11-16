import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { DraftStore } from "../src/drafts.ts";
import { PostizClient, PostizError } from "../src/postiz.ts";
import { approveDraft } from "../src/publish.ts";
import { fakePostiz, future, tmpDir } from "./helpers.ts";

const setup = async () => {
  const server = await fakePostiz();
  const store = new DraftStore(path.join(tmpDir(), "drafts.json"));
  return { server, store, postiz: new PostizClient(`${server.url}/public/v1/`, "test-key") };
};

test("approve schedules the draft in Postiz, resolving the channel by platform", async () => {
  const { server, store, postiz } = await setup();
  const when = future();
  const draft = store.create({ platform: "linkedin", content: "Hello", scheduledAt: when, rationale: "r", settings: { foo: 1 } });

  const result = await approveDraft(store, postiz, draft.id);

  const post = server.requests.find((r) => r.method === "POST")!;
  assert.equal(post.headers.authorization, "test-key");
  assert.deepEqual(post.body, {
    type: "schedule",
    date: when,
    shortLink: false,
    tags: [],
    posts: [{ integration: { id: "ch1" }, value: [{ content: "Hello", image: [] }], settings: { foo: 1, __type: "linkedin" } }],
  });
  assert.equal(result.status, "scheduled");
  assert.equal(result.integrationId, "ch1");
  await assert.rejects(approveDraft(store, postiz, draft.id), /is scheduled, not pending/);
  await server.close();
});

test("approve --now publishes immediately even when the scheduled time has passed", async () => {
  const { server, store, postiz } = await setup();
  const draft = store.create({ platform: "linkedin", content: "Late", scheduledAt: future(-1), rationale: "r" });

  await assert.rejects(approveDraft(store, postiz, draft.id), /in the past/);
  assert.equal(server.requests.some((r) => r.method === "POST"), false);

  await approveDraft(store, postiz, draft.id, { now: true });
  assert.equal(server.requests.find((r) => r.method === "POST")!.body.type, "now");
  await server.close();
});

test("approve refuses without Postiz, with an unknown channel, or with no matching platform", async () => {
  const { server, store, postiz } = await setup();
  const x = store.create({ platform: "x", content: "Hi", scheduledAt: future(), rationale: "r" });
  const bad = store.create({ platform: "linkedin", integrationId: "gone", content: "Hi", scheduledAt: future(), rationale: "r" });

  await assert.rejects(approveDraft(store, null, x.id), /Postiz is not configured/);
  await assert.rejects(approveDraft(store, postiz, x.id), /0 connected "x" channels/);
  await assert.rejects(approveDraft(store, postiz, bad.id), /gone is not connected/);
  assert.equal(store.list("pending").length, 2);
  await server.close();
});

test("Postiz errors surface with status and body", async () => {
  const server = await fakePostiz();
  const client = new PostizClient(`${server.url}/public/v1`, "wrong");
  await assert.rejects(client.listIntegrations(), (e) => e instanceof PostizError && e.status === 401 && /Invalid API key/.test(e.message));
  await server.close();
});
