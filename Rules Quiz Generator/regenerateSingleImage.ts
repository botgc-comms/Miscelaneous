import OpenAI from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";

type RegenerateSingleImageRequest = {
  outputDir: string;
  folderName: string;
  promptFileName?: string;
  instructions: string;
};

type RegenerateSingleImageResult = {
  success: true;
  folderName: string;
  imageFileName: string;
  promptFileName: string;
  resultFileName: string;
  imagePath: string;
};

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
const SIZE = process.env.OPENAI_IMAGE_SIZE ?? "1024x1024";
const QUALITY = process.env.OPENAI_IMAGE_QUALITY ?? "high";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function latestPromptFileName(folderPath: string): Promise<string> {
  const entries = await fs.readdir(folderPath);

  const promptFiles = entries
    .map((name) => {
      const match = /^final-prompt-v(\d+)\.txt$/i.exec(name);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((x): x is { name: string; version: number } => x !== null)
    .sort((a, b) => b.version - a.version);

  return promptFiles[0]?.name ?? "final-prompt-v2.txt";
}

function safeFolderName(folderName: string): string {
  const normalised = path.normalize(folderName);

  if (normalised.includes("..") || path.isAbsolute(normalised)) {
    throw new Error("Invalid folderName.");
  }

  return normalised;
}

async function nextVersion(folderPath: string): Promise<number> {
  for (let version = 3; version < 1000; version += 1) {
    const imagePath = path.join(folderPath, `illustration-v${version}.png`);

    if (!await pathExists(imagePath)) {
      return version;
    }
  }

  throw new Error("Could not find an available image version.");
}

function buildCorrectionPrompt(basePrompt: string, instructions: string): string {
  return [
    "Create a corrected version of the previous golf rules quiz image.",
    "",
    "STYLE LOCK:",
    "The finished image must match this target style: a realistic photographic golf course background with a clearly hand-drawn illustrated teenage golfer composited naturally into the scene.",
    "The background environment must look like a real professional golf-course photograph.",
    "The grass, putting green, fairway, bunker, water, trees, sky, clubhouse and surrounding landscape should appear photographic and realistic.",
    "The golfer must be a high-quality illustrated character, not a photorealistic person.",
    "The golfer should look like a polished hand-drawn children's educational publishing illustration placed into the realistic photograph.",
    "The golfer should have clean illustrated outlines, painted shading, expressive facial features, slightly enlarged eyes, friendly expression, natural body proportions and believable golf posture.",
    "The golfer should feel like a modern illustrated storybook or golf academy character layered into a real golf scene.",
    "The illustrated golfer must blend naturally with the lighting and perspective of the photographic background.",
    "Do not create a fully photorealistic human.",
    "Do not create anime, manga, comic-book, mascot, plastic 3D, grotesque caricature, or exaggerated cartoon style.",
    "",
    "BASE IMAGE PROMPT:",
    basePrompt,
    "",
    "CORRECTION INSTRUCTIONS:",
    instructions,
    "",
    "Apply the correction instructions even if they change the scene described in the base prompt.",
    "Where the correction instructions conflict with the base prompt, follow the correction instructions.",
    "Where the correction instructions conflict with the style lock, follow the style lock.",
    "Keep the Rules of Golf learning situation clear.",
    "Show one clear golf rules situation only.",
    "Do not include text, labels, numbers, arrows, captions, diagrams, badges, logos, watermarks, club crests, scorecards, written explanations, or speech bubbles.",
  ].join("\n");
}

async function generateImage(prompt: string): Promise<string> {
  const result = await client.images.generate({
    model: MODEL,
    prompt,
    size: SIZE as "1024x1024",
    quality: QUALITY as "high",
  });

  const image = result.data?.[0];

  if (!image?.b64_json) {
    throw new Error("Image generation did not return b64_json.");
  }

  return image.b64_json;
}

export async function regenerateSingleImage(request: RegenerateSingleImageRequest): Promise<RegenerateSingleImageResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  if (!request.instructions?.trim()) {
    throw new Error("instructions is required.");
  }

  const folderName = safeFolderName(request.folderName);
  const folderPath = path.join(request.outputDir, folderName);

  if (!await pathExists(folderPath)) {
    throw new Error(`Folder not found: ${folderName}`);
  }

  const sourcePromptFileName = request.promptFileName ?? await latestPromptFileName(folderPath);
  const sourcePromptPath = path.join(folderPath, sourcePromptFileName);

  if (!await pathExists(sourcePromptPath)) {
    throw new Error(`Prompt file not found: ${sourcePromptFileName}`);
  }

  const basePrompt = await fs.readFile(sourcePromptPath, "utf8");
  const version = await nextVersion(folderPath);

  const imageFileName = `illustration-v${version}.png`;
  const promptFileName = `final-prompt-v${version}.txt`;
  const resultFileName = `image-generation-v${version}.json`;

  const finalPrompt = buildCorrectionPrompt(basePrompt, request.instructions);

  await fs.writeFile(path.join(folderPath, promptFileName), finalPrompt, "utf8");

  const b64 = await generateImage(finalPrompt);

  await fs.writeFile(path.join(folderPath, imageFileName), Buffer.from(b64, "base64"));

  await fs.writeFile(path.join(folderPath, resultFileName), JSON.stringify({
    model: MODEL,
    size: SIZE,
    quality: QUALITY,
    sourcePromptFileName,
    promptFileName,
    imageFileName,
    correctionInstructions: request.instructions,
    generatedAtUtc: new Date().toISOString(),
  }, null, 2), "utf8");

  return {
    success: true,
    folderName,
    imageFileName,
    promptFileName,
    resultFileName,
    imagePath: `/${folderName}/${imageFileName}`,
  };
}