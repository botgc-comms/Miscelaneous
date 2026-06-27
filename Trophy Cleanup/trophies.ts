import OpenAI, { toFile } from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INPUT_DIR = process.argv[2] ?? "./input";
const OUTPUT_DIR = process.argv[3] ?? "./output";
const INPUT_PADDING_RATIO = 0.24;

const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

const BASE_PROMPT_PARTS = [
  "Recreate the provided trophy as a clean vector-style illustration.",
  "Preserve exact shape, proportions, silhouette, and composition of the original trophy.",
  "Do not redesign, reinterpret, crop, rotate, or add or remove structural elements.",
  "Smooth metallic shading using soft gradients only.",
  "No photographic texture, noise, or grain, but preserve fine engraved and structural detail from the original trophy.",
  "No environmental reflections, including curtains, room reflections, or booth artefacts.",
  "Clean, crisp edges with subtle outline definition.",
  "Preserve the original metal colour of the trophy as shown in the source image.",
  "Retain base colour where present, but simplify and clean it.",
  "Fully transparent background.",
  "No checkerboard, no grey background, no shadow, no glow, no vignette.",
  "Clean vector-style illustration with preserved internal detail, not a processed photograph.",
  "Apply exactly the same treatment consistently.",
  "Do not generate any readable text, lettering, engraving, or names on the trophy or base.",
  "Edges must be rendered directly into transparency.", 
  "Do not composite the object against any background before output.",
  "Do not use white, grey, or any colour as an intermediate background.", 
  "Alpha channel must be clean, with no halos, fringing, or semi-transparent edge pixels."
];


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

function textOverridePathFor(inputFile: string): string {
  const baseName = path.basename(inputFile, path.extname(inputFile));
  return path.join(path.dirname(inputFile), `${baseName}.txt`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function saveBase64Png(base64Data: string, outputFile: string): Promise<void> {
  const buffer = Buffer.from(base64Data, "base64");
  await fs.writeFile(outputFile, buffer);
}

async function readOptionalTextOverride(inputFile: string): Promise<string | null> {
  const overridePath = textOverridePathFor(inputFile);

  try {
    const content = await fs.readFile(overridePath, "utf8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

async function buildPrompt(inputFile: string): Promise<string> {
  const textOverride = await readOptionalTextOverride(inputFile);
  const promptParts = [...BASE_PROMPT_PARTS];

  if (textOverride) {
    promptParts.push(
      "Override the no-text rule for this image only.",
      "Render readable trophy text only where text genuinely appears on the original object.",
      `Use exactly this text and no other: ${JSON.stringify(textOverride)}.`,
      "Do not invent, correct, expand, abbreviate, paraphrase, or restyle the wording.",
      "If the text cannot be reproduced cleanly and accurately, omit it rather than guessing."
    );
  }

  return promptParts.join(" ");
}

async function prepareImageForUpload(inputFile: string): Promise<Buffer> {
  const image = sharp(inputFile).ensureAlpha();
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image dimensions for ${inputFile}`);
  }

  const longestSide = Math.max(metadata.width, metadata.height);
  const padding = Math.ceil(longestSide * INPUT_PADDING_RATIO);
  const canvasSize = longestSide + (padding * 2);

  return await image
    .resize({
      width: canvasSize,
      height: canvasSize,
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function processImage(inputFile: string): Promise<void> {
  const outputFile = outputPathFor(inputFile);

  if (await fileExists(outputFile)) {
    console.log(`Skipping: ${outputFile} already exists`);
    return;
  }

  const preparedBytes = await prepareImageForUpload(inputFile);
  const fileName = `${path.basename(inputFile, path.extname(inputFile))}.png`;
  const prompt = await buildPrompt(inputFile);

  const upload = await toFile(preparedBytes, fileName, { type: "image/png" });

  const result = await client.images.edit({
    model: "gpt-image-1",
    image: upload,
    prompt,
    background: "transparent",
    quality: "high",
    size: "1024x1024",
  });

  const image = result.data?.[0];

  if (!image?.b64_json) {
    throw new Error(`No image data returned for ${inputFile}`);
  }

  await saveBase64Png(image.b64_json, outputFile);

  const textOverride = await readOptionalTextOverride(inputFile);

  if (textOverride) {
    console.log(`Saved: ${outputFile} (with text override)`);
  } else {
    console.log(`Saved: ${outputFile}`);
  }
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