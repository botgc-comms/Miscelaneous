import OpenAI from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";

type Choice = {
  id: string;
  text: string;
};

type GolfSceneSpec = {
  setting: string;
  golferAge?: string;
  golferGender?: string;
  handedness?: string;
  ethnicity?: string;
  skinTone?: string;
  clothingTopColour?: string;
  clothingBottomColour?: string;
  hat?: boolean;
  action: string;
  clubInHand: string;
  ballCount?: number;
  stakeColour?: string;
  waterVisible?: boolean;
  bunkerVisible?: boolean;
  teeMarkerVisible?: boolean;
  greenVisible?: boolean;
  treesVisible?: boolean;
  weather?: string;
  prohibitedElements?: string[];
};

type Metadata = {
  schemaVersion: number;
  sourceImageName: string;
  ruleNumber: string;
  ruleName: string;
  group: string;
  title: string;
  question: string;
  type: "multiple_choice" | "multi_select";
  choices: Choice[];
  correctAnswer: string | string[];
  correctAnswers: string[];
  explanation: string;
  imagePrompt: string;
  imageAlt: string;
  sceneSpec: GolfSceneSpec;
};

type RunResult = {
  index: number;
  total: number;
  folder: string;
  title: string;
  ruleNumber: string;
  ruleName: string;
  status: "success" | "skipped" | "failed";
  imagePath: string;
  promptPath: string;
  resultPath: string;
  durationSeconds: number;
  error: string;
  completedAtUtc: string;
};

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const OUTPUT_DIR = process.argv[2] ?? "./output";

const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
const SIZE = process.env.OPENAI_IMAGE_SIZE ?? "1024x1024";
const QUALITY = process.env.OPENAI_IMAGE_QUALITY ?? "high";
const CONCURRENCY = Math.max(1, Number(process.env.OPENAI_IMAGE_CONCURRENCY ?? "6"));

const IMAGE_FILE_NAME = process.env.OPENAI_REGENERATED_IMAGE_NAME ?? "illustration-v2.png";
const PROMPT_FILE_NAME = process.env.OPENAI_REGENERATED_PROMPT_NAME ?? "final-prompt-v2.txt";
const RESULT_FILE_NAME = process.env.OPENAI_REGENERATED_RESULT_NAME ?? "image-generation-v2.json";

const RUN_REPORT_CSV_FILE_NAME = process.env.RUN_REPORT_CSV_FILE_NAME ?? "image-regeneration-report.csv";
const RUN_REPORT_JSON_FILE_NAME = process.env.RUN_REPORT_JSON_FILE_NAME ?? "image-regeneration-report.json";

const OVERWRITE = process.env.OVERWRITE_REGENERATED_IMAGES === "true";
const STOP_ON_ERROR = process.env.STOP_ON_ERROR === "true";

const ETHNICITY_ROTATION = [
  "Black British",
  "South Asian British",
  "East Asian",
  "mixed-ethnicity",
  "white British",
  "Middle Eastern",
  "Black",
  "British Asian",
];

const SKIN_TONE_ROTATION = [
  "dark brown skin",
  "medium brown skin",
  "light brown skin",
  "olive skin",
  "fair skin",
  "deep brown skin",
  "warm beige skin",
  "medium tan skin",
];

const GENDER_ROTATION = [
  "girl",
  "boy",
  "girl",
  "boy",
  "teenager",
  "girl",
  "boy",
  "teenager",
];

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function deterministicIndex(seed: string, length: number): number {
  let hash = 0;

  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash) % length;
}

function pickDeterministic<T>(items: T[], seed: string): T {
  return items[deterministicIndex(seed, items.length)];
}

function describeSetting(scene: GolfSceneSpec): string {
  switch (scene.setting) {
    case "fairway":
      return "on a real fairway";
    case "rough":
      return "in light or medium rough";
    case "bunker":
      return "in or beside a real sand bunker";
    case "penalty_area_edge":
      return "beside a clearly marked penalty area on a real golf course";
    case "teeing_area":
      return "on a real teeing area";
    case "putting_green":
      return "on or beside a real putting green";
    default:
      return "on a real golf course";
  }
}

function describeAction(scene: GolfSceneSpec): string {
  switch (scene.action) {
    case "addressing_ball":
      return "addressing the ball naturally";
    case "dropping_ball":
      return "dropping one ball naturally from knee height";
    case "replaying_shot":
      return "preparing to replay a shot";
    case "lifting_ball":
      return "bending naturally to lift or mark the ball";
    case "standing_near_ball":
      return "standing naturally near the ball";
    default:
      return "demonstrating a simple golf rules situation";
  }
}

function describeClub(scene: GolfSceneSpec): string {
  switch (scene.clubInHand) {
    case "driver":
      return "holding one realistic modern driver";
    case "fairway_wood":
      return "holding one realistic fairway wood";
    case "hybrid":
      return "holding one realistic hybrid golf club";
    case "iron":
      return "holding one realistic iron";
    case "wedge":
      return "holding one realistic wedge";
    case "putter":
      return "holding one realistic putter";
    case "none":
      return "with no club in hand";
    default:
      return "with realistic golf equipment";
  }
}

function describeGolfer(metadata: Metadata): string {
  const scene = metadata.sceneSpec;
  const seed = `${metadata.ruleNumber}-${metadata.title}-${metadata.sourceImageName}`;

  const gender = scene.golferGender?.trim() || pickDeterministic(GENDER_ROTATION, `${seed}-gender`);
  const ethnicity = scene.ethnicity?.trim() || pickDeterministic(ETHNICITY_ROTATION, `${seed}-ethnicity`);
  const skinTone = scene.skinTone?.trim() || pickDeterministic(SKIN_TONE_ROTATION, `${seed}-skin`);
  const age = scene.golferAge?.trim() || "aged around 12 to 17";

  return `a ${ethnicity} ${gender}, ${age}, with ${skinTone}`;
}

function buildPrompt(metadata: Metadata): string {
  const scene = metadata.sceneSpec;

  const choices = metadata.choices
    .map((choice) => `${choice.id}. ${choice.text}`)
    .join(" ");

  const correctAnswers = metadata.correctAnswers.join(", ");
  const golferDescription = describeGolfer(metadata);

  const parts = [
    "Create a high-quality square educational golf image for a junior Rules of Golf quiz.",
    "The finished image must match this target style: a realistic photographic golf course background with a clearly hand-drawn illustrated teenage golfer composited naturally into the scene.",
    "The background environment must look like a real professional golf-course photograph.",
    "The grass, putting green, fairway, bunker, water, trees, sky, clubhouse and surrounding landscape should appear photographic and realistic.",
    "The golfer must be a high-quality illustrated character, not a photorealistic person.",
    "The golfer should look like a polished hand-drawn children's educational publishing illustration placed into the realistic photograph.",
    "The golfer should have clean illustrated outlines, painted shading, expressive facial features, slightly enlarged eyes, friendly expression, natural body proportions and believable golf posture.",
    "The golfer should feel like a modern illustrated storybook or golf academy character layered into a real golf scene.",
    "The illustrated golfer must blend naturally with the lighting and perspective of the photographic background.",
    "Do not create a fully photorealistic human.",
    "Do not create an anime, manga, comic-book, mascot, plastic 3D, grotesque caricature, or exaggerated cartoon style.",
    "Show one clear golf rules situation only.",
    "Do not include any text, labels, numbers, arrows, captions, diagrams, badges, logos, watermarks, club crests, or speech bubbles.",
    "Do not include scorecards or written rule explanations.",
    "The image must work as a standalone illustration beside the quiz question.",
    "Use diverse representation across the image set. Do not default to white golfers.",
    `Golfer: show ${golferDescription}.`,
    `Quiz title: ${metadata.title}.`,
    `Rule: ${metadata.ruleNumber} - ${metadata.ruleName}.`,
    `Question: ${metadata.question}`,
    `Choices: ${choices}`,
    `Correct answer ids: ${correctAnswers}.`,
    `Explanation to support visually: ${metadata.explanation}`,
    `Original illustration idea: ${metadata.imagePrompt}`,
    `Scene: show one teenage golfer ${describeSetting(scene)}.`,
    `Action: the golfer is ${describeAction(scene)}.`,
    `Club: the golfer is ${describeClub(scene)}.`,
    "Show exactly one visible golf ball.",
    "The golf ball must be small and realistic in size compared with the golfer, shoes, grass, and club head.",
    "Do not show extra balls, duplicated balls, oversized balls, tennis-ball-sized balls, or football-sized balls.",
    "Golf posture must be physically plausible.",
    "Golf equipment must be realistic.",
    "Any club shown must have one single realistic club head, one continuous shaft, and believable proportions.",
    "Do not show split club heads, bent shafts, floating clubs, toy clubs, miniature clubs, or malformed equipment.",
  ];

  if (scene.handedness === "left") {
    parts.push("The golfer should appear left-handed.");
  }

  if (scene.handedness === "right") {
    parts.push("The golfer should appear right-handed.");
  }

  if (scene.stakeColour && scene.stakeColour !== "none") {
    parts.push(`If stakes are shown, they must be realistic ${scene.stakeColour} golf course stakes.`);
  }

  if (scene.waterVisible) {
    parts.push("Water should be visible only if it naturally belongs in the scene.");
  }

  if (scene.bunkerVisible) {
    parts.push("A realistic sand bunker should be visible.");
  }

  if (scene.greenVisible) {
    parts.push("A realistic putting green should be visible.");
  }

  if (scene.teeMarkerVisible) {
    parts.push("Realistic tee markers should be visible.");
  }

  if (scene.treesVisible) {
    parts.push("Trees may appear naturally in the photographic background.");
  }

  if (scene.weather === "overcast") {
    parts.push("Use natural overcast daylight.");
  } else {
    parts.push("Use natural bright daylight.");
  }

  if (scene.prohibitedElements && scene.prohibitedElements.length > 0) {
    parts.push(`Do not include: ${scene.prohibitedElements.join(", ")}.`);
  }

  parts.push(
    "Composition: square image, subject clearly visible, clean uncluttered photographic golf background, enough space around the illustrated golfer for use in a learning pack.",
    "Final quality check: realistic photographic golf setting, one hand-drawn illustrated teenage golfer, one ball, accurate equipment, diverse representation, no text, no diagrams, no logos."
  );

  return parts.join(" ");
}

async function findMetadataFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (!entry.isDirectory()) {
      continue;
    }

    if (entry.name === "_source-state") {
      continue;
    }

    const metadataPath = path.join(fullPath, "metadata.json");

    if (await pathExists(metadataPath)) {
      files.push(metadataPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
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

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "unknown";
  }

  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

async function writeRunReports(results: RunResult[]): Promise<void> {
  const csvPath = path.join(OUTPUT_DIR, RUN_REPORT_CSV_FILE_NAME);
  const jsonPath = path.join(OUTPUT_DIR, RUN_REPORT_JSON_FILE_NAME);
  const sortedResults = [...results].sort((a, b) => a.index - b.index);

  const csvRows = [
    [
      "Index",
      "Total",
      "Status",
      "Title",
      "Rule Number",
      "Rule Name",
      "Folder",
      "Image Path",
      "Prompt Path",
      "Result Path",
      "Duration Seconds",
      "Error",
      "Completed At UTC",
    ].map(csvEscape).join(","),
    ...sortedResults.map((result) => [
      String(result.index),
      String(result.total),
      result.status,
      result.title,
      result.ruleNumber,
      result.ruleName,
      result.folder,
      result.imagePath,
      result.promptPath,
      result.resultPath,
      result.durationSeconds.toFixed(2),
      result.error,
      result.completedAtUtc,
    ].map(csvEscape).join(",")),
  ].join("\n");

  await fs.writeFile(csvPath, csvRows, "utf8");
  await fs.writeFile(jsonPath, JSON.stringify(sortedResults, null, 2), "utf8");
}

function buildProgressLine(
  processed: number,
  total: number,
  succeeded: number,
  skipped: number,
  failed: number,
  startedAt: number,
): string {
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const averageSeconds = processed > 0 ? elapsedSeconds / processed : 0;
  const remainingItems = total - processed;
  const remainingSeconds = averageSeconds * remainingItems;
  const percent = total > 0 ? (processed / total) * 100 : 100;

  return [
    `Progress ${processed}/${total}`,
    formatPercent(percent),
    `Success ${succeeded}`,
    `Skipped ${skipped}`,
    `Failed ${failed}`,
    `Elapsed ${formatDuration(elapsedSeconds)}`,
    `ETA ${processed > 0 ? formatDuration(remainingSeconds) : "unknown"}`,
  ].join(" | ");
}

async function regenerate(
  metadataPath: string,
  index: number,
  total: number,
  workerId: number,
): Promise<RunResult> {
  const itemStartedAt = Date.now();
  const folder = path.dirname(metadataPath);
  const imagePath = path.join(folder, IMAGE_FILE_NAME);
  const promptPath = path.join(folder, PROMPT_FILE_NAME);
  const resultPath = path.join(folder, RESULT_FILE_NAME);

  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Metadata;

  console.log("");
  console.log(`[worker ${workerId}] [${index}/${total}] ${metadata.title}`);
  console.log(`[worker ${workerId}] Rule: ${metadata.ruleNumber} - ${metadata.ruleName}`);
  console.log(`[worker ${workerId}] Folder: ${folder}`);

  if (!OVERWRITE && await pathExists(imagePath)) {
    const durationSeconds = (Date.now() - itemStartedAt) / 1000;

    console.log(`[worker ${workerId}] [${index}/${total}] Skipped because ${IMAGE_FILE_NAME} already exists.`);

    return {
      index,
      total,
      folder,
      title: metadata.title,
      ruleNumber: metadata.ruleNumber,
      ruleName: metadata.ruleName,
      status: "skipped",
      imagePath,
      promptPath,
      resultPath,
      durationSeconds,
      error: "",
      completedAtUtc: new Date().toISOString(),
    };
  }

  const prompt = buildPrompt(metadata);

  await fs.writeFile(promptPath, prompt, "utf8");

  console.log(`[worker ${workerId}] [${index}/${total}] Calling image model ${MODEL}...`);

  const b64 = await generateImage(prompt);
  const imageBytes = Buffer.from(b64, "base64");

  await fs.writeFile(imagePath, imageBytes);

  const durationSeconds = (Date.now() - itemStartedAt) / 1000;

  await fs.writeFile(resultPath, JSON.stringify({
    model: MODEL,
    size: SIZE,
    quality: QUALITY,
    imageFileName: IMAGE_FILE_NAME,
    promptFileName: PROMPT_FILE_NAME,
    sourceMetadataPath: metadataPath,
    generatedAtUtc: new Date().toISOString(),
    title: metadata.title,
    ruleNumber: metadata.ruleNumber,
    ruleName: metadata.ruleName,
    durationSeconds,
  }, null, 2), "utf8");

  console.log(`[worker ${workerId}] [${index}/${total}] Complete in ${formatDuration(durationSeconds)}.`);
  console.log(`[worker ${workerId}] Image: ${imagePath}`);

  return {
    index,
    total,
    folder,
    title: metadata.title,
    ruleNumber: metadata.ruleNumber,
    ruleName: metadata.ruleName,
    status: "success",
    imagePath,
    promptPath,
    resultPath,
    durationSeconds,
    error: "",
    completedAtUtc: new Date().toISOString(),
  };
}

async function createFailedResult(
  metadataFile: string,
  index: number,
  total: number,
  error: unknown,
): Promise<RunResult> {
  let title = "";
  let ruleNumber = "";
  let ruleName = "";

  try {
    const metadata = JSON.parse(await fs.readFile(metadataFile, "utf8")) as Metadata;
    title = metadata.title;
    ruleNumber = metadata.ruleNumber;
    ruleName = metadata.ruleName;
  } catch {
    title = path.basename(path.dirname(metadataFile));
  }

  const folder = path.dirname(metadataFile);
  const errorMessage = error instanceof Error ? error.message : String(error);

  return {
    index,
    total,
    folder,
    title,
    ruleNumber,
    ruleName,
    status: "failed",
    imagePath: path.join(folder, IMAGE_FILE_NAME),
    promptPath: path.join(folder, PROMPT_FILE_NAME),
    resultPath: path.join(folder, RESULT_FILE_NAME),
    durationSeconds: 0,
    error: errorMessage,
    completedAtUtc: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const metadataFiles = await findMetadataFiles(OUTPUT_DIR);

  if (metadataFiles.length === 0) {
    throw new Error(`No metadata.json files found in ${OUTPUT_DIR}`);
  }

  const startedAt = Date.now();
  const results: RunResult[] = [];

  let processed = 0;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;
  let nextIndex = 0;
  let fatalError: unknown = null;
  let reportWrite = Promise.resolve();

  const writeReportsQueued = async (): Promise<void> => {
    const snapshot = [...results];

    reportWrite = reportWrite
      .catch(() => undefined)
      .then(() => writeRunReports(snapshot));

    await reportWrite;
  };

  const workerCount = Math.max(1, Math.min(CONCURRENCY, metadataFiles.length));

  console.log("Image regeneration started.");
  console.log(`Output folder: ${OUTPUT_DIR}`);
  console.log(`Metadata files found: ${metadataFiles.length}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Size: ${SIZE}`);
  console.log(`Quality: ${QUALITY}`);
  console.log(`New image filename: ${IMAGE_FILE_NAME}`);
  console.log(`Overwrite existing regenerated images: ${OVERWRITE ? "yes" : "no"}`);
  console.log(`Stop on error: ${STOP_ON_ERROR ? "yes" : "no"}`);
  console.log(`Concurrency: ${workerCount}`);

  async function worker(workerId: number): Promise<void> {
    while (true) {
      if (fatalError) {
        return;
      }

      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= metadataFiles.length) {
        return;
      }

      const metadataFile = metadataFiles[currentIndex];
      const index = currentIndex + 1;

      try {
        const result = await regenerate(metadataFile, index, metadataFiles.length, workerId);

        results.push(result);
        processed += 1;

        if (result.status === "success") {
          succeeded += 1;
        }

        if (result.status === "skipped") {
          skipped += 1;
        }
      } catch (error) {
        processed += 1;
        failed += 1;

        const failedResult = await createFailedResult(metadataFile, index, metadataFiles.length, error);

        console.error(`[worker ${workerId}] [${index}/${metadataFiles.length}] Failed.`);
        console.error(failedResult.error);

        results.push(failedResult);

        if (STOP_ON_ERROR) {
          fatalError = error;
        }
      }

      console.log(buildProgressLine(
        processed,
        metadataFiles.length,
        succeeded,
        skipped,
        failed,
        startedAt,
      ));

      await writeReportsQueued();

      if (STOP_ON_ERROR && fatalError) {
        return;
      }
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, (_, index) => worker(index + 1))
  );

  await reportWrite;

  if (fatalError) {
    throw fatalError;
  }

  const elapsedSeconds = (Date.now() - startedAt) / 1000;

  console.log("");
  console.log("Image regeneration finished.");
  console.log(`Total: ${metadataFiles.length}`);
  console.log(`Success: ${succeeded}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log(`Elapsed: ${formatDuration(elapsedSeconds)}`);
  console.log(`Report CSV: ${path.join(OUTPUT_DIR, RUN_REPORT_CSV_FILE_NAME)}`);
  console.log(`Report JSON: ${path.join(OUTPUT_DIR, RUN_REPORT_JSON_FILE_NAME)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});