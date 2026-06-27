import OpenAI from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";

type Achievement = {
  Key: string;
  Name: string;
  Description: string;
  PrimaryColour: string;
  Prestige: number;
  RosetteKey: string;
  RowNumber: number;
  Sort: number;
};

type AchievementGroup = {
  Group: string;
  Achievements: Achievement[];
};

type AchievementsConfig = {
  Achievements: {
    Items: AchievementGroup[];
  };
};

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INPUT_FILE = process.argv[2] ?? "./achievements.json";
const OUTPUT_DIR = process.argv[3] ?? "./achievement-medals";

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normaliseJson(content: string): string {
  const trimmed = content.trim();

  if (trimmed.startsWith("{")) {
    return trimmed.replace(/,\s*$/, "");
  }

  return `{${trimmed.replace(/,\s*$/, "")}}`;
}

async function readAchievements(filePath: string): Promise<Achievement[]> {
  console.log(`Loading achievements from: ${filePath}`);

  const content = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(normaliseJson(content)) as AchievementsConfig;

  const achievements = parsed.Achievements.Items.flatMap(
    (group) => group.Achievements
  );

  console.log(`Loaded ${achievements.length} achievements`);

  return achievements;
}

function outputPathFor(achievement: Achievement): string {
  return path.join(OUTPUT_DIR, `${achievement.Key}.png`);
}

function buildPrompt(achievement: Achievement): string {
  return [
    "Create a single circular metallic medallion centre-piece for a junior golf achievement rosette.",
    "The image must show only the circular central medal piece.",
    "Do not include ribbon petals, ribbon tails, fabric, background scenery, shadows outside the circle, text labels, words, letters, numbers, badges, banners, or captions.",
    "Use a polished brushed silver metal style with subtle 3D relief, bevelled edges, engraved details, raised rim, soft highlights, and clean studio lighting.",
    "The composition must be perfectly centred, front-facing, symmetrical, and suitable for placing inside the centre of a rosette.",
    "Use a transparent background.",
    "The medal should look like an engraved or embossed icon, not a cartoon scene.",
    "Use simple iconography only, with no facial detail and no readable text.",
    "Keep the design bold and legible at small size.",
    `Achievement name: ${achievement.Name}.`,
    `Achievement description: ${achievement.Description}.`,
    "Create an appropriate symbolic icon for this achievement in the same metallic engraved style."
  ].join(" ");
}

async function saveBase64Png(
  base64Data: string,
  outputFile: string
): Promise<void> {
  const buffer = Buffer.from(base64Data, "base64");
  await fs.writeFile(outputFile, buffer);
}

async function processAchievement(
  achievement: Achievement,
  index: number,
  total: number
): Promise<void> {
  const outputFile = outputPathFor(achievement);

  console.log("");
  console.log("==================================================");
  console.log(`[${index}/${total}] ${achievement.Name}`);
  console.log(`Key: ${achievement.Key}`);
  console.log(`Output: ${outputFile}`);

  if (await fileExists(outputFile)) {
    console.log("Status: SKIPPED (already exists)");
    return;
  }

  const prompt = buildPrompt(achievement);

  console.log("Building prompt...");
  console.log(`Achievement: ${achievement.Name}`);

  console.log("Calling OpenAI image generation...");

  const started = Date.now();

  const result = await client.images.generate({
    model: "gpt-image-1",
    prompt,
    background: "transparent",
    quality: "high",
    size: "1024x1024",
  });

  const elapsedSeconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`OpenAI response received (${elapsedSeconds}s)`);

  const image = result.data?.[0];

  if (!image?.b64_json) {
    throw new Error(`No image data returned for ${achievement.Key}`);
  }

  console.log("Saving image...");

  await saveBase64Png(image.b64_json, outputFile);

  console.log("Saved successfully");
}

async function main(): Promise<void> {
  console.log("");
  console.log("Achievement Medal Generator");
  console.log("===========================");
  console.log("");

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  console.log("OpenAI API key found");

  console.log(`Input file: ${INPUT_FILE}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);

  await ensureDirectory(OUTPUT_DIR);

  console.log("Output directory ready");

  const achievements = await readAchievements(INPUT_FILE);

  if (achievements.length === 0) {
    throw new Error("No achievements found.");
  }

  console.log("");
  console.log(`Found ${achievements.length} achievement(s)`);
  console.log("");

  let current = 1;

  for (const achievement of achievements) {
    try {
      await processAchievement(
        achievement,
        current,
        achievements.length
      );
    } catch (error) {
      console.error("");
      console.error(`FAILED: ${achievement.Name}`);
      console.error(error);

      throw error;
    }

    current++;
  }

  console.log("");
  console.log("==================================================");
  console.log("DONE");
  console.log(`Generated ${achievements.length} achievement images`);
  console.log("==================================================");
}

main().catch((error) => {
  console.error("");
  console.error("FATAL ERROR");
  console.error(error);
  process.exit(1);
});