import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { z } from "zod";

/**
 * Branded images for posts, drawn from a few fixed layouts and rendered without a browser
 * (satori lays the layout out as SVG, resvg turns it into a PNG).
 *
 * The layouts never invent what the product looks like. A picture of the product is a real
 * screenshot that a person supplies; until it exists the image shows a placeholder.
 */

export const SIZE = 1200;

/** File names for screenshots: a plain name in the materials folder, PNG or JPEG. */
const SCREENSHOT_NAME = /^[\w][\w.-]*\.(png|jpe?g)$/i;

export const VisualSchema = z
  .object({
    kind: z
      .enum(["stat", "statement", "screenshot"])
      .describe("stat: one number carries the image. statement: one sentence carries it. screenshot: a real screen of the product under a headline."),
    headline: z.string().min(1).max(140).describe("The line on the image. Shorter than the post's first line; no hashtags or links"),
    stat: z.string().max(10).optional().describe('For kind "stat": the number as it should appear, e.g. "%49,9" or "8.024"'),
    detail: z.string().max(160).optional().describe("One supporting line under the headline or the number"),
    source: z.string().max(180).optional().describe("Source and scope of any number on the image, as the brand rules require"),
    screenshot: z
      .object({
        file: z.string().regex(SCREENSHOT_NAME).describe("File name the screenshot will be saved under in the materials folder, e.g. kok-neden-raporu.png"),
        prompt: z
          .string()
          .min(1)
          .describe("A self-contained brief for the coding agent that builds the product: which screen, in which state, with which demo data, at what size, saved under which file name"),
      })
      .optional()
      .describe('For kind "screenshot"'),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "stat" && !v.stat) ctx.addIssue({ code: "custom", message: 'kind "stat" needs stat' });
    if (v.kind === "screenshot" && !v.screenshot) ctx.addIssue({ code: "custom", message: 'kind "screenshot" needs screenshot' });
  });
export type Visual = z.infer<typeof VisualSchema>;

/** Colours and marks for the images; set under "visual" in brand.json. */
export const VisualStyleSchema = z.object({
  background: z.string().default("#101828"),
  foreground: z.string().default("#FFFFFF"),
  /** Secondary text: detail and source lines. */
  muted: z.string().default("#B4BDCC"),
  /** The number on a stat image and the rule above the footer. */
  accent: z.string().default("#7CD4FD"),
  /** PNG logo in the materials folder. Without one the brand name is written out. */
  logo: z.string().optional(),
  /** Text at the bottom right, usually the site address. */
  footer: z.string().optional(),
});
export type VisualStyle = z.infer<typeof VisualStyleSchema>;

interface Node {
  type: string;
  props: { style?: Record<string, unknown>; children?: unknown; [key: string]: unknown };
}

const el = (type: string, style: Record<string, unknown>, ...children: unknown[]): Node => ({
  type,
  props: { style, children: children.flat().filter((c) => c !== null && c !== undefined && c !== false) },
});

const require = createRequire(import.meta.url);
let fonts: { name: string; data: Buffer; weight: 400 | 600 | 700; style: "normal" }[] | undefined;

/**
 * Inter, bundled with the package so rendering needs no network. The font ships in subsets: ğ, ş
 * and İ live in the latin-ext files. satori keeps one font per name and weight, so the two subsets
 * need different names; the layout asks for both and missing glyphs fall through to the second.
 */
function loadFonts() {
  if (fonts) return fonts;
  const dir = path.join(path.dirname(require.resolve("@fontsource/inter/package.json")), "files");
  fonts = ([400, 600, 700] as const).flatMap((weight) =>
    (
      [
        ["latin", "Inter"],
        ["latin-ext", "Inter Ext"],
      ] as const
    ).map(([subset, name]) => ({ name, data: fs.readFileSync(path.join(dir, `inter-${subset}-${weight}-normal.woff`)), weight, style: "normal" as const })),
  );
  return fonts;
}

/** Width and height of a PNG, read from its header. */
function pngSize(data: Buffer): { width: number; height: number } | null {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

const dataUri = (file: string, data: Buffer) => `data:image/${/\.png$/i.test(file) ? "png" : "jpeg"};base64,${data.toString("base64")}`;

function readMaterial(materialsDir: string, name: string | undefined): Buffer | null {
  if (!name || path.basename(name) !== name) return null;
  const file = path.join(materialsDir, name);
  return fs.existsSync(file) && fs.statSync(file).isFile() ? fs.readFileSync(file) : null;
}

export const screenshotExists = (materialsDir: string, visual: Visual | undefined) =>
  visual?.kind !== "screenshot" || readMaterial(materialsDir, visual.screenshot?.file) !== null;

function headlineSize(text: string, large: number): number {
  if (text.length <= 45) return large;
  if (text.length <= 90) return Math.round(large * 0.8);
  return Math.round(large * 0.64);
}

export interface RenderInput {
  visual: Visual;
  style: VisualStyle;
  brandName: string;
  materialsDir: string;
}

function layout({ visual, style, brandName, materialsDir }: RenderInput): Node {
  const pad = 84;
  const logoData = readMaterial(materialsDir, style.logo);
  const logoSize = logoData ? pngSize(logoData) : null;
  const logoHeight = 52;

  const footer = el(
    "div",
    { display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `3px solid ${style.accent}`, paddingTop: 30, marginTop: 36 },
    logoData && logoSize
      ? { type: "img", props: { src: dataUri(style.logo!, logoData), width: Math.round((logoSize.width / logoSize.height) * logoHeight), height: logoHeight } }
      : el("div", { display: "flex", fontSize: 34, fontWeight: 700, color: style.foreground }, brandName),
    style.footer ? el("div", { display: "flex", fontSize: 28, color: style.muted }, style.footer) : null,
  );

  const source = visual.source ? el("div", { display: "flex", fontSize: 24, lineHeight: 1.4, color: style.muted, marginTop: 28 }, visual.source) : null;
  const detail = (size: number) => (visual.detail ? el("div", { display: "flex", fontSize: size, lineHeight: 1.35, color: style.muted, marginTop: 26 }, visual.detail) : null);
  const headline = (size: number) => el("div", { display: "flex", fontSize: headlineSize(visual.headline, size), fontWeight: 700, lineHeight: 1.14, letterSpacing: -1.5, color: style.foreground }, visual.headline);

  let body: Node;
  if (visual.kind === "stat") {
    body = el(
      "div",
      { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" },
      el("div", { display: "flex", fontSize: 250, fontWeight: 700, lineHeight: 1, letterSpacing: -8, color: style.accent }, visual.stat ?? ""),
      el("div", { display: "flex", marginTop: 34 }, headline(64)),
      detail(34),
      source,
    );
  } else if (visual.kind === "statement") {
    body = el("div", { display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }, headline(92), detail(38), source);
  } else {
    const shot = readMaterial(materialsDir, visual.screenshot?.file);
    // The frame (see below) takes the screenshot's own proportions, up to the space the layout has; a taller
    // screenshot is cropped from the bottom. The size of a JPEG is not read, so it gets the full height.
    const shotWidth = SIZE - pad * 2 - 4;
    const natural = shot ? pngSize(shot) : null;
    const shotHeight = Math.min(600, natural ? Math.round((shotWidth * natural.height) / natural.width) : 600);
    const frame = { display: "flex", height: shotHeight + 4, marginTop: 40, borderRadius: 18, overflow: "hidden", border: `2px solid ${style.muted}`, backgroundColor: "#FFFFFF" };
    body = el(
      "div",
      { display: "flex", flexDirection: "column", flexGrow: 1 },
      headline(60),
      detail(30),
      shot
        ? el("div", frame, { type: "img", props: { src: dataUri(visual.screenshot!.file, shot), width: shotWidth, height: shotHeight, style: { objectFit: "cover", objectPosition: "top left" } } })
        : el(
            "div",
            { ...frame, height: 520, backgroundColor: "transparent", borderStyle: "dashed", alignItems: "center", justifyContent: "center", flexDirection: "column" },
            el("div", { display: "flex", fontSize: 34, fontWeight: 600, color: style.foreground }, "Ekran görüntüsü bekleniyor"),
            el("div", { display: "flex", fontSize: 26, color: style.muted, marginTop: 14 }, visual.screenshot?.file ?? ""),
          ),
      source,
    );
  }

  // satori sizes the root as a content box: width and height exclude the padding.
  const inner = SIZE - pad * 2;
  return el("div", { display: "flex", flexDirection: "column", width: inner, height: inner, padding: pad, backgroundColor: style.background, fontFamily: "Inter, Inter Ext" }, body, footer);
}

/** Renders a post's image as a 1200 x 1200 PNG. */
export async function renderVisual(input: RenderInput): Promise<Buffer> {
  // satori takes React-shaped elements; plain objects of the same shape work and avoid the dependency.
  const svg = await satori(layout(input) as unknown as Parameters<typeof satori>[0], { width: SIZE, height: SIZE, fonts: loadFonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: SIZE } }).render().asPng());
}
