import OpenAI, { toFile } from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INPUT_DIR = process.argv[2] ?? "./input";
const OUTPUT_DIR = process.argv[3] ?? "./output";

const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
const IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE ?? "1024x1024";

const INPUT_PADDING_RATIO = 0.24;
const OUTPUT_SIDE_PADDING_RATIO = 0.015;
const OUTPUT_TOP_PADDING_RATIO = 0.015;
const ALPHA_CUTOFF = 20;

const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

const BASE_PROMPT_PARTS = [
  "Recreate the supplied trophy photograph as a clean, highly accurate vector-style illustration.",
  "The supplied trophy is the sole source of truth for the trophy's identity, structure, materials, ornamentation and proportions.",
  "Preserve the recognisable shape, proportions, silhouette and structural design of the original trophy.",
  "Render the trophy as a strict straight-on frontal elevation at shelf height.",
  "Use an orthographic-looking presentation with no downward-looking, overhead or three-quarter camera angle.",
  "Correct perspective from the source photograph where necessary so the finished trophy is suitable for placement directly onto a horizontal shelf.",
  "The centre line of the trophy must be vertical.",
  "Vertical edges must remain upright and parallel.",
  "Horizontal edges must remain level and symmetrical.",
  "Do not show the top face of the lowest base or bottom plinth.",
  "Do not render the lowest base as an upward-facing ellipse or disc.",
  "The lowest base must terminate in one broad, flat, perfectly horizontal bottom contact edge.",
  "The full width of the lowest footprint must sit on the same horizontal baseline.",
  "Do not show any underside, feet, raised centre, recessed bottom, cast shadow or visible space beneath the lowest base.",
  "The lowest visible opaque pixels of the trophy must belong to the flat bottom contact edge of the base.",
  "The trophy must look physically capable of resting directly on a glass shelf without hovering.",
  "Do not redesign, crop, rotate, stretch, simplify or add or remove structural elements.",
  "Keep the complete trophy fully visible.",
  "Use smooth metallic shading with controlled soft gradients.",
  "Light the trophy with one warm display spotlight positioned directly above its centre.",
  "Use consistent top-down illumination across the entire trophy.",
  "Keep the lighting subtle and suitable for a premium wooden trophy cabinet.",
  "Upper-facing details may be brighter and lower areas may be slightly darker.",
  "Use clean generic metallic highlights caused only by the overhead display light.",
  "Do not reflect rooms, windows, people, furniture, scenery or surrounding objects.",
  "Do not add wooden reflections or a reflected image of the cabinet.",
  "Do not add photographic texture, noise, grain, scratches or environmental reflections.",
  "Preserve fine engraved, embossed, decorative and structural detail visible in the source.",
  "Use clean, crisp edges with subtle outline definition.",
  "Preserve the original metal colour of the trophy.",
  "Retain the original base colour and materials, rendered as a clean illustration.",
  "The result must be a newly rendered vector-style illustration rather than a filtered or traced photograph.",
  "Apply one consistent illustration treatment across the entire trophy.",
  "Do not generate readable text, lettering, engraving, dates or names on the trophy or base.",
  "Do not add a cast shadow, contact shadow, glow, vignette, floor, table, shelf, wall, scenery, props or surrounding objects.",
  "Place the isolated trophy against one perfectly flat, uniform chroma-key green background.",
  "Every background pixel must be exactly RGB 0, 255, 0, hex #00FF00.",
  "Do not add gradients, texture, noise, shadows or colour variation to the green background.",
  "Do not use green anywhere on the trophy itself.",
  "Do not add green reflections, spill, fringe, highlights or halo around the trophy.",
  "Keep the boundary between the trophy and green background crisp and clean.",
  "The spaces inside handles, loops, cut-outs and pierced decorative elements must remain open and transparent.",
  "Any opening that passes completely through the original trophy must remain empty.",
  "Do not fill holes, cut-outs, handle interiors or decorative openings with metal, black material or shading.",
  "Areas visible through openings in the original trophy should remain part of the background.",
  "Preserve all negative space and internal voids exactly as shown in the source photograph.",
];

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function listInputFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter((filePath) =>
      ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
    )
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

async function readOptionalTextOverride(
  inputFile: string,
): Promise<string | null> {
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
      `Use exactly this text and no other text: ${JSON.stringify(textOverride)}.`,
      "Do not invent, correct, expand, abbreviate, paraphrase or change the wording.",
      "Match the placement, scale, alignment and orientation of the original text.",
      "If the supplied wording cannot be reproduced cleanly and accurately, omit it rather than guessing.",
    );
  }

  return promptParts.join(" ");
}

async function prepareImageForUpload(inputFile: string): Promise<Buffer> {
  const source = sharp(inputFile).rotate().ensureAlpha();
  const metadata = await source.metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image dimensions for ${inputFile}`);
  }

  const longestSide = Math.max(metadata.width, metadata.height);
  const padding = Math.ceil(longestSide * INPUT_PADDING_RATIO);
  const canvasSize = longestSide + padding * 2;

  return await source
    .resize({
      width: canvasSize,
      height: canvasSize,
      fit: "contain",
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      },
    })
    .png()
    .toBuffer();
}

function isBackgroundGreen(red: number, green: number, blue: number): boolean {
  const maximumOther = Math.max(red, blue);
  return green >= 70 && green - maximumOther >= 18 && green >= maximumOther * 1.12;
}

function pixelIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

async function removeGreenBackgroundAndCrop(
  source: Buffer,
  outputFile: string,
): Promise<void> {
  const { data, info } = await sharp(source)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels !== 4) {
    throw new Error(
      `Expected four RGBA channels but received ${info.channels}.`,
    );
  }

  const remove = new Uint8Array(info.width * info.height);

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = pixelIndex(x, y, info.width);
      const offset = index * 4;

      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];

      if (isBackgroundGreen(red, green, blue)) {
        remove[index] = 1;
      }
    }
  }

  const expandedRemove = new Uint8Array(remove);

  for (let y = 1; y < info.height - 1; y += 1) {
    for (let x = 1; x < info.width - 1; x += 1) {
      const index = pixelIndex(x, y, info.width);

      if (remove[index] !== 0) {
        continue;
      }

      const touchesRemovedPixel =
        remove[pixelIndex(x - 1, y, info.width)] !== 0 ||
        remove[pixelIndex(x + 1, y, info.width)] !== 0 ||
        remove[pixelIndex(x, y - 1, info.width)] !== 0 ||
        remove[pixelIndex(x, y + 1, info.width)] !== 0 ||
        remove[pixelIndex(x - 1, y - 1, info.width)] !== 0 ||
        remove[pixelIndex(x + 1, y - 1, info.width)] !== 0 ||
        remove[pixelIndex(x - 1, y + 1, info.width)] !== 0 ||
        remove[pixelIndex(x + 1, y + 1, info.width)] !== 0;

      if (!touchesRemovedPixel) {
        continue;
      }

      const offset = index * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];

      if (green > Math.max(red, blue) + 6) {
        expandedRemove[index] = 1;
      }
    }
  }

  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = pixelIndex(x, y, info.width);
      const offset = index * 4;

      if (expandedRemove[index] !== 0) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
        continue;
      }

      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];

      if (green > Math.max(red, blue)) {
        data[offset + 1] = Math.max(red, blue);
      }

      if (data[offset + 3] < ALPHA_CUTOFF) {
        data[offset] = 0;
        data[offset + 1] = 0;
        data[offset + 2] = 0;
        data[offset + 3] = 0;
        continue;
      }

      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    throw new Error("The generated image contains no visible trophy pixels.");
  }

  const contentWidth = right - left + 1;
  const contentHeight = bottom - top + 1;

  const sidePadding = Math.max(
    1,
    Math.round(contentWidth * OUTPUT_SIDE_PADDING_RATIO),
  );

  const topPadding = Math.max(
    1,
    Math.round(contentHeight * OUTPUT_TOP_PADDING_RATIO),
  );

  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .extract({
      left,
      top,
      width: contentWidth,
      height: contentHeight,
    })
    .extend({
      top: topPadding,
      bottom: 0,
      left: sidePadding,
      right: sidePadding,
      background: {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      },
    })
    .png({
      compressionLevel: 9,
      adaptiveFiltering: true,
    })
    .toFile(outputFile);
}

async function processImage(inputFile: string): Promise<void> {
  const outputFile = outputPathFor(inputFile);

  if (await fileExists(outputFile)) {
    console.log(`Skipping: ${outputFile} already exists`);
    return;
  }

  const preparedBytes = await prepareImageForUpload(inputFile);
  const baseName = path.basename(inputFile, path.extname(inputFile));
  const upload = await toFile(preparedBytes, `${baseName}.png`, {
    type: "image/png",
  });

  const prompt = await buildPrompt(inputFile);

  const result = await client.images.edit({
    model: MODEL,
    image: upload,
    prompt,
    quality: "high",
    size: IMAGE_SIZE,
  });

  const generatedImage = result.data?.[0];

  if (!generatedImage?.b64_json) {
    throw new Error(`No image data returned for ${inputFile}`);
  }

  const generatedBuffer = Buffer.from(
    generatedImage.b64_json,
    "base64",
  );

  await removeGreenBackgroundAndCrop(generatedBuffer, outputFile);

  const textOverride = await readOptionalTextOverride(inputFile);

  console.log(
    textOverride
      ? `Saved: ${outputFile} (with text override)`
      : `Saved: ${outputFile}`,
  );
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

  console.log(`Using model: ${MODEL}`);
  console.log(`Using output size: ${IMAGE_SIZE}`);
  console.log(`Found ${files.length} image(s) in ${INPUT_DIR}`);

  for (const file of files) {
    console.log(`Processing: ${file}`);

    try {
      await processImage(file);
    } catch (error) {
      console.error(`Failed to process ${file}:`, error);
    }
  }

  console.log("Done.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
