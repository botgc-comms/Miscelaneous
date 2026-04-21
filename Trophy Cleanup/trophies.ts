import OpenAI from "openai";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";

//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

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INPUT_DIR = process.argv[2] ?? "./input";
const OUTPUT_DIR = process.argv[3] ?? "./output";

const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

const LOCKED_PROMPT = [
  "Transform the provided trophy image into a clean vector-style illustration.",
  "Preserve the exact shape, proportions, silhouette, and composition of the original trophy.",
  "Do not redesign, reinterpret, crop, rotate, or add/remove structural elements.",
  "Remove all environmental reflections, including curtains, room reflections, and booth artefacts.",
  "Use smooth metallic shading with soft gradients only.",
  "No photographic texture, no noise, no grain, no micro-detail, no photorealism.",
  "Use clean, crisp edges with subtle outline definition.",
  "Use neutral silver and greyscale for metal surfaces.",
  "Retain any existing red base elements, but simplify and clean them.",
  "Output must have a fully transparent background.",
  "No checkerboard, no grey background, no shadow, no glow, no vignette, no ambient occlusion.",
  "The result must look like a flat or semi-flat illustration, not a processed photograph.",
  "Apply the exact same treatment consistently as previous images."
].join(" ");

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function listInputFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter((filePath) => ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

function outputPathFor(inputFile: string): string {
  const baseName = path.basename(inputFile, path.extname(inputFile));
  return path.join(OUTPUT_DIR, `${baseName}.png`);
}

async function saveBase64Png(base64Data: string, outputFile: string): Promise<void> {
  const buffer = Buffer.from(base64Data, "base64");
  await fs.writeFile(outputFile, buffer);
}

async function processImage(inputFile: string): Promise<void> {
  const result = await client.images.edit({
    model: "gpt-image-1.5",
    image: [createReadStream(inputFile)],
    prompt: LOCKED_PROMPT,
    input_fidelity: "high",
    background: "transparent",
    output_format: "png",
    quality: "high",
    size: "1024x1024",
  });

  const image = result.data?.[0];

  if (!image?.b64_json) {
    throw new Error(`No image data returned for ${inputFile}`);
  }

  const outputFile = outputPathFor(inputFile);
  await saveBase64Png(image.b64_json, outputFile);
  console.log(`Saved: ${outputFile}`);
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  await ensureDirectory(OUTPUT_DIR);

  const files = await listInputFiles(INPUT_DIR);

  if (files.length === 0) {
    throw new Error(`No supported image files found in ${INPUT_DIR}`);
  }

  console.log(`Found ${files.length} image(s) in ${INPUT_DIR}`);

  for (const file of files) {
    console.log(`Processing: ${file}`);
    await processImage(file);
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});