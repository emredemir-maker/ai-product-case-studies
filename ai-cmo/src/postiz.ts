/**
 * Minimal client for the Postiz public API (`/public/v1`).
 * Shapes follow apps/backend/src/public-api/routes/v1/public.integrations.controller.ts
 * in gitroomhq/postiz-app. Postiz runs as a separate service; this talks to it over HTTP only.
 */

export interface PostizIntegration {
  id: string;
  name: string;
  /** Provider identifier, e.g. "linkedin", "x". */
  identifier: string;
  disabled: boolean;
  profile?: string;
}

export interface PostizChannelRules {
  rules?: string;
  maxLength: number;
  /** JSON schema of the provider's settings, or a string saying none are needed. */
  settings: unknown;
}

export interface CreatePostInput {
  type: "schedule" | "now";
  date: string;
  integrationId: string;
  identifier: string;
  content: string;
  settings?: Record<string, unknown>;
}

export class PostizError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Postiz API ${status}: ${body.slice(0, 500)}`);
  }
}

export class PostizClient {
  private readonly baseUrl: string;
  private readonly rulesCache = new Map<string, PostizChannelRules>();

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async listIntegrations(): Promise<PostizIntegration[]> {
    return (await this.request("GET", "/integrations")) as PostizIntegration[];
  }

  async getChannelRules(integrationId: string): Promise<PostizChannelRules> {
    const cached = this.rulesCache.get(integrationId);
    if (cached) return cached;
    const res = (await this.request("GET", `/integration-settings/${encodeURIComponent(integrationId)}`)) as {
      output: PostizChannelRules;
    };
    this.rulesCache.set(integrationId, res.output);
    return res.output;
  }

  async createPost(input: CreatePostInput): Promise<unknown> {
    return this.request("POST", "/posts", {
      type: input.type,
      date: input.date,
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: input.integrationId },
          value: [{ content: input.content, image: [] }],
          settings: { ...input.settings, __type: input.identifier },
        },
      ],
    });
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      // Postiz expects the raw API key, without a "Bearer" prefix.
      headers: { Authorization: this.apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new PostizError(res.status, text);
    return text ? JSON.parse(text) : null;
  }
}
