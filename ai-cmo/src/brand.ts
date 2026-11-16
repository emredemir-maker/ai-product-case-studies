import fs from "node:fs";
import { z } from "zod";

export const BrandSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  language: z.string().default("English"),
  audience: z.string().min(1),
  voice: z.object({
    tone: z.string().min(1),
    do: z.array(z.string()).default([]),
    dont: z.array(z.string()).default([]),
  }),
  products: z
    .array(z.object({ name: z.string(), summary: z.string(), url: z.string().optional() }))
    .default([]),
  goals: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export type Brand = z.infer<typeof BrandSchema>;

export function loadBrand(file: string): Brand {
  if (!fs.existsSync(file)) {
    throw new Error(`Brand file not found: ${file}. Copy brand.example.json to brand.json and edit it.`);
  }
  const parsed = BrandSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) {
    throw new Error(`Invalid brand file ${file}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join("\n");

export function renderBrand(brand: Brand): string {
  const parts = [
    `Name: ${brand.name}`,
    `What it is: ${brand.description}`,
    `Audience: ${brand.audience}`,
    `Language to write in: ${brand.language}`,
    `Voice: ${brand.voice.tone}`,
  ];
  if (brand.voice.do.length) parts.push(`Voice, do:\n${bullets(brand.voice.do)}`);
  if (brand.voice.dont.length) parts.push(`Voice, don't:\n${bullets(brand.voice.dont)}`);
  if (brand.products.length) {
    parts.push(
      `Products:\n${bullets(brand.products.map((p) => `${p.name}: ${p.summary}${p.url ? ` (${p.url})` : ""}`))}`,
    );
  }
  if (brand.goals.length) parts.push(`Marketing goals:\n${bullets(brand.goals)}`);
  if (brand.notes) parts.push(`Notes: ${brand.notes}`);
  return parts.join("\n\n");
}
