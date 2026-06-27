import OpenAI from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";

type Choice = {
  id: string;
  text: string;
};

type SourceProcessingState = {
  schemaVersion: number;
  sourceImageName: string;
  sourceImagePath: string;
  status: "in_progress" | "complete";
  extractedItems: ExtractedQuizItem[];
  reviewedItems: ExtractedQuizItem[];
  completedQuestionFolders: string[];
  updatedAtUtc: string;
};

type GolfSceneSpec = {
  setting:
    | "fairway"
    | "rough"
    | "bunker"
    | "penalty_area_edge"
    | "teeing_area"
    | "putting_green";
  golferAge: "teen";
  golferGender: "girl" | "boy";
  handedness: "right" | "left";

  ethnicity: "white" | "black" | "asian" | "mixed";
  skinTone: "light" | "medium" | "dark";

  clothingTopColour: string;
  clothingBottomColour: string;
  hat: boolean;

  action:
    | "addressing_ball"
    | "dropping_ball"
    | "replaying_shot"
    | "lifting_ball"
    | "standing_near_ball";

  clubInHand: "driver" | "fairway_wood" | "hybrid" | "iron" | "wedge" | "putter" | "none";

  ballCount: 1;
  stakeColour: "none" | "red" | "yellow" | "white";
  waterVisible: boolean;
  bunkerVisible: boolean;
  teeMarkerVisible: boolean;
  greenVisible: boolean;
  treesVisible: boolean;
  weather: "sunny" | "overcast";
  prohibitedElements: string[];
};

type ExtractedQuizItem = {
  schemaVersion: number;
  sourceImageName: string;
  ruleNumber: string;
  ruleName: string;
  group: string;
  title: string;
  question: string;
  type: "multiple_choice" | "multi_select";
  choices: Choice[];
  correctAnswers: string[];
  explanation: string;
  imagePrompt: string;
  imageAlt: string;
  sceneSpec: GolfSceneSpec;
};

type ExtractedQuizBatch = {
  schemaVersion: number;
  questions: ExtractedQuizItem[];
};

type ReviewedQuizBatch = {
  schemaVersion: number;
  questions: ExtractedQuizItem[];
};

type OutputMetadata = {
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
  imageVerification: ImageVerificationResult;
};

type ImageVerificationResult = {
  pass: boolean;
  score: number;
  issues: string[];
  repairPrompt: string;
};

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INPUT_DIR = process.argv[2] ?? "./input";
const OUTPUT_DIR = process.argv[3] ?? "./output";
const REFERENCE_DIR = process.argv[4] ?? "./golf-reference";

const EXTRACT_MODEL = process.env.OPENAI_EXTRACT_MODEL ?? "gpt-4.1";
const REVIEW_MODEL = process.env.OPENAI_REVIEW_MODEL ?? EXTRACT_MODEL;
const VERIFY_MODEL = process.env.OPENAI_VERIFY_MODEL ?? "gpt-4.1";

const IMAGE_RESPONSE_MODEL = process.env.OPENAI_IMAGE_RESPONSE_MODEL ?? "gpt-5.4";
const IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE ?? "1024x1024";
const MAX_IMAGE_ATTEMPTS = Number(process.env.OPENAI_MAX_IMAGE_ATTEMPTS ?? "3");
const MIN_IMAGE_SCORE = Number(process.env.OPENAI_MIN_IMAGE_SCORE ?? "85");

const ALLOWED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

const QUIZ_BATCH_SCHEMA = {
  name: "golf_rule_quiz_batch",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "questions"],
    properties: {
      schemaVersion: {
        type: "integer",
        enum: [1],
      },
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "schemaVersion",
            "sourceImageName",
            "ruleNumber",
            "ruleName",
            "group",
            "title",
            "question",
            "type",
            "choices",
            "correctAnswers",
            "explanation",
            "imagePrompt",
            "imageAlt",
            "sceneSpec",
          ],
          properties: {
            schemaVersion: {
              type: "integer",
              enum: [1],
            },
            sourceImageName: {
              type: "string",
              minLength: 1,
            },
            ruleNumber: {
              type: "string",
              minLength: 1,
            },
            ruleName: {
              type: "string",
              minLength: 1,
            },
            group: {
              type: "string",
              minLength: 1,
            },
            title: {
              type: "string",
              minLength: 1,
            },
            question: {
              type: "string",
              minLength: 1,
            },
            type: {
              type: "string",
              enum: ["multiple_choice", "multi_select"],
            },
            choices: {
              type: "array",
              minItems: 3,
              maxItems: 5,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "text"],
                properties: {
                  id: {
                    type: "string",
                    enum: ["a", "b", "c", "d", "e"],
                  },
                  text: {
                    type: "string",
                    minLength: 1,
                  },
                },
              },
            },
            correctAnswers: {
              type: "array",
              minItems: 1,
              maxItems: 5,
              items: {
                type: "string",
                enum: ["a", "b", "c", "d", "e"],
              },
            },
            explanation: {
              type: "string",
              minLength: 1,
            },
            imagePrompt: {
              type: "string",
              minLength: 1,
            },
            imageAlt: {
              type: "string",
              minLength: 1,
            },
            sceneSpec: {
              type: "object",
              additionalProperties: false,
              required: [
                "setting",
                "golferAge",
                "golferGender",
                "handedness",
                "action",
                "clubInHand",
                "ballCount",
                "stakeColour",
                "waterVisible",
                "bunkerVisible",
                "teeMarkerVisible",
                "greenVisible",
                "treesVisible",
                "weather",
                "prohibitedElements",
              ],
              properties: {
                setting: {
                  type: "string",
                  enum: [
                    "fairway",
                    "rough",
                    "bunker",
                    "penalty_area_edge",
                    "teeing_area",
                    "putting_green",
                  ],
                },
                golferAge: {
                  type: "string",
                  enum: ["teen"],
                },
                golferGender: {
                  type: "string",
                  enum: ["girl", "boy"],
                },
                handedness: {
                  type: "string",
                  enum: ["right", "left"],
                },
                action: {
                  type: "string",
                  enum: [
                    "addressing_ball",
                    "dropping_ball",
                    "replaying_shot",
                    "lifting_ball",
                    "standing_near_ball",
                  ],
                },
                clubInHand: {
                  type: "string",
                  enum: ["driver", "fairway_wood", "hybrid", "iron", "wedge", "putter", "none"],
                },
                ballCount: {
                  type: "integer",
                  enum: [1],
                },
                stakeColour: {
                  type: "string",
                  enum: ["none", "red", "yellow", "white"],
                },
                waterVisible: {
                  type: "boolean",
                },
                bunkerVisible: {
                  type: "boolean",
                },
                teeMarkerVisible: {
                  type: "boolean",
                },
                greenVisible: {
                  type: "boolean",
                },
                treesVisible: {
                  type: "boolean",
                },
                weather: {
                  type: "string",
                  enum: ["sunny", "overcast"],
                },
                prohibitedElements: {
                  type: "array",
                  items: {
                    type: "string",
                    minLength: 1,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const IMAGE_VERIFICATION_SCHEMA = {
  name: "golf_image_verification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["pass", "score", "issues", "repairPrompt"],
    properties: {
      pass: {
        type: "boolean",
      },
      score: {
        type: "integer",
        minimum: 0,
        maximum: 100,
      },
      issues: {
        type: "array",
        items: {
          type: "string",
          minLength: 1,
        },
      },
      repairPrompt: {
        type: "string",
        minLength: 1,
      },
    },
  },
} as const;

const EXTRACTION_PROMPT = [
  "You are creating Rules of Golf quiz content for children aged 12 to 17.",
  "Analyse the supplied page image from a golf rules guide.",
  "Extract multiple potential quiz questions from the content visible on that single page.",
  "Return between 2 and 6 questions, depending on how much distinct quiz-worthy content is present.",
  "Do not create duplicate questions that test the same exact point in slightly different wording.",
  "Questions should cover different ideas from the page where possible.",
  "Use British English.",
  "Use friendly, natural language suitable for ages 12 to 17.",
  "Prefer short scenario-based questions.",
  "Each title must be meaningful in its own right.",
  "The ruleNumber should be taken from the page if visible.",
  "The ruleName should be taken from the page topic if visible.",
  "The group should normally match the ruleName.",
  "The question must be answerable from the content shown in the image.",
  "Use either multiple_choice or multi_select as appropriate.",
  "For multiple_choice, correctAnswers must contain exactly one id.",
  "For multi_select, correctAnswers must contain all correct ids.",
  "Explanations must be concise, accurate, and easy to understand.",
  "The imagePrompt must describe a child-friendly illustration relevant to the question.",
  "Also produce sceneSpec using the defined enum values only.",
  "sceneSpec must describe a realistic golf scene that would help depict the question accurately.",
  "Use sceneSpec to constrain the image to one believable golf action.",
  "Prefer one golfer and exactly one golf ball.",
  "Unless the question explicitly requires otherwise, sceneSpec.ballCount must be 1.",
  "Do not ask for text inside the image.",
  "Do not mention page layouts, captions, callouts, logos, brands, or watermarks.",
  "Do not describe diagrams, dotted lines, rulers, measurement sticks, overlays, icons, or teaching graphics.",
  "Do not describe a second golf ball unless the rule absolutely requires it, and for this task it should not.",
  "Do not ask for a club to be laid on the ground for measurement.",
  "When the rule involves stakes, set sceneSpec.stakeColour correctly.",
  "When the rule involves a penalty area, use setting penalty_area_edge and set waterVisible appropriately.",
  "When the rule involves a bunker, set bunkerVisible true and usually setting bunker.",
  "When the rule involves a putting green, set greenVisible true and usually setting putting_green.",
  "When the rule involves teeing, set teeMarkerVisible true and usually setting teeing_area.",
  "Return only schema-valid JSON.",
].join(" ");

const REVIEW_PROMPT = [
  "You are reviewing previously generated golf quiz questions for children aged 12 to 17.",
  "You will receive a batch of questions extracted from one rules page.",
  "Improve them without changing the underlying rule facts.",
  "Check each question carefully for the following:",
  "1. The question must make sense when read naturally.",
  "2. The wording must not accidentally give away the answer.",
  "3. The choices must be distinct and plausible.",
  "4. The correct answer must clearly match the question.",
  "5. The explanation must match the corrected question and answer.",
  "6. The title must still make sense on its own.",
  "7. The language must suit ages 12 to 17 and use British English.",
  "8. Remove weak, repetitive, or confusing questions instead of keeping them.",
  "9. Keep variety across the batch.",
  "10. Preserve the same JSON shape.",
  "11. Keep sceneSpec realistic and tightly grounded in actual golf.",
  "12. sceneSpec must continue to show exactly one golf ball.",
  "13. If the imagePrompt is vague, improve it but keep it consistent with sceneSpec.",
  "Do not invent facts not supported by the source material.",
  "Return only the corrected batch as schema-valid JSON.",
].join(" ");

const IMAGE_STYLE_BASE = [
  "Create a polished educational golf illustration.",
  "The image should sit about 75% of the way from a full cartoon towards a real photo.",
  "It should remain clearly illustrated and slightly stylised, while still being grounded in believable golf reality.",
  "Use natural human proportions, believable golf posture, and authentic golf course features.",
  "Use clean shapes, soft shading, and a polished illustrated finish.",
  "Do not make it look like a photograph.",
  "Do not make it look like an exaggerated cartoon.",
  "Golf equipment, posture, course features, and ball position must be accurate to the game of golf.",
  "Do not cartoonise equipment shapes or invent unusual golf gear.",
  "Golf clubs must have one single realistic club head with believable shaft length and grip length.",
  "Golf clubs must be held naturally by the golfer or rest naturally on the ground when appropriate.",
  "Golf balls must be realistic in size and position.",
  "Penalty stakes, bunkers, greens, rough, tee markers, and fairway must look authentic.",
  "Show one clear golf action only.",
  "No diagrams, no dotted lines, no measurement guides, no teaching graphics.",
  "No text, no labels, no numbers, no logos, no watermarks.",
  "The golfer should be a teenager with natural human proportions.",
  "Show exactly one golf ball.",
  "Do not show duplicated balls, duplicated clubs, floating equipment, split club heads, malformed club heads, or impossible golf posture.",
  "Golf clubs must be full-length, realistic adult/teen golf clubs.",
  "The club shaft must extend from the golfer's hands to near the ground with believable golf proportions.",
  "Do not show short, toy-like, child-sized, cropped, stubby, or miniature golf clubs.",
  "The golf ball must be small and realistic: about the size of a real golf ball relative to the golfer, club head, shoes, and grass.",
  "Do not show oversized, football-sized, tennis-ball-sized, or cartoonishly large golf balls.",
].join(" ");

function describeSetting(setting: GolfSceneSpec["setting"]): string {
  switch (setting) {
    case "fairway":
      return "on a real fairway";
    case "rough":
      return "in light or medium rough on a real golf hole";
    case "bunker":
      return "in or beside a real sand bunker";
    case "penalty_area_edge":
      return "at the edge of a penalty area on a real golf course";
    case "teeing_area":
      return "in the teeing area of a real golf hole";
    case "putting_green":
      return "on or beside a real putting green";
  }
}

function describeClub(club: GolfSceneSpec["clubInHand"]): string {
  switch (club) {
    case "driver":
      return "holding a realistic modern driver";
    case "fairway_wood":
      return "holding a realistic fairway wood";
    case "hybrid":
      return "holding a realistic hybrid golf club";
    case "iron":
      return "holding a realistic iron golf club";
    case "wedge":
      return "holding a realistic wedge";
    case "putter":
      return "holding a realistic putter";
    case "none":
      return "with no club in hand";
  }
}

function describeAction(action: GolfSceneSpec["action"]): string {
  switch (action) {
    case "addressing_ball":
      return "addressing the ball naturally";
    case "dropping_ball":
      return "releasing one golf ball naturally from about knee height";
    case "replaying_shot":
      return "preparing to replay the shot from a believable previous spot";
    case "lifting_ball":
      return "bending naturally to lift or mark the ball";
    case "standing_near_ball":
      return "standing naturally near the ball";
  }
}

function buildGolfAccuracyConstraints(scene: GolfSceneSpec): string[] {
  const constraints: string[] = [
    "The scene must clearly resemble a real golf course.",
    "The golfer posture must be physically plausible for golf.",
    "Show exactly one golf ball and no others.",
    "Do not include extra clubs or strange equipment.",
    "Do not include symbols, arrows, overlays, or explanatory graphics.",
    "Do not show toy-like equipment.",
    "Do not show floating equipment.",
    "Do not show duplicated or split club heads.",
  ];

  if (scene.stakeColour === "red") {
    constraints.push("If stakes are shown, they must be realistic red penalty area stakes.");
  }

  if (scene.stakeColour === "yellow") {
    constraints.push("If stakes are shown, they must be realistic yellow penalty area stakes.");
  }

  if (scene.stakeColour === "white") {
    constraints.push("If stakes are shown, they must be realistic white out-of-bounds stakes.");
  }

  if (scene.action === "dropping_ball") {
    constraints.push("Show one golf ball being released naturally from about knee height.");
    constraints.push("Do not show a second golf ball on the ground.");
  }

  if (scene.setting === "bunker") {
    constraints.push("The bunker must look like a genuine golf bunker with real sand.");
  }

  if (scene.greenVisible) {
    constraints.push("The green must look like a real putting surface.");
  }

  if (scene.teeMarkerVisible) {
    constraints.push("If tee markers are visible, they must look realistic and belong in a teeing area.");
  }

  return constraints;
}

function buildFinalImagePrompt(item: ExtractedQuizItem, scene: GolfSceneSpec): string {
  const sceneBits: string[] = [
    IMAGE_STYLE_BASE,
    `Show a teenage ${scene.golferGender} ${describeSetting(scene.setting)}.`,
    `The golfer is ${describeAction(scene.action)} and is ${describeClub(scene.clubInHand)}.`,
    scene.handedness === "left"
      ? "The golfer should appear left-handed."
      : "The golfer should appear right-handed.",
    scene.weather === "overcast"
      ? "Use natural overcast daylight."
      : "Use natural bright daylight.",
  ];

  if (scene.waterVisible) {
    sceneBits.push("Water should be visibly present in the scene.");
  }

  if (scene.bunkerVisible) {
    sceneBits.push("A sand bunker should be visible.");
  }

  if (scene.greenVisible) {
    sceneBits.push("A putting green should be visible.");
  }

  if (scene.teeMarkerVisible) {
    sceneBits.push("Tee markers should be visible.");
  }

  if (scene.treesVisible) {
    sceneBits.push("Trees may be visible in the background in a natural way.");
  }

  if (scene.stakeColour !== "none") {
    sceneBits.push(`Show realistic ${scene.stakeColour} stakes only if they belong naturally in the scene.`);
  }

  for (const constraint of buildGolfAccuracyConstraints(scene)) {
    sceneBits.push(constraint);
  }

  for (const constraint of buildClubConstraints(scene.clubInHand)) {
    sceneBits.push(constraint);
  }

  if (scene.prohibitedElements.length > 0) {
    sceneBits.push(`Do not include: ${scene.prohibitedElements.join(", ")}.`);
  }

  sceneBits.push(
    `The golfer should appear as a ${scene.ethnicity} teenager with ${scene.skinTone} skin tone.`
  );

  sceneBits.push(
    `The golfer is wearing a ${scene.clothingTopColour} top and ${scene.clothingBottomColour} trousers or shorts.`
  );

  if (scene.hat) {
    sceneBits.push("The golfer is wearing a golf cap.");
  } else {
    sceneBits.push("The golfer is not wearing a hat.");
  }

  sceneBits.push(
    "Do not default to the same ethnicity, appearance, or clothing across images."
  );

  sceneBits.push(
    "Ensure visible variation in appearance, including skin tone and clothing colour."
  );

  sceneBits.push(`Illustration intent: ${sanitiseImagePromptText(item.imagePrompt)}`);

  return sceneBits.join(" ");
}

const IMAGE_VERIFICATION_PROMPT = [
  "You are checking whether a generated illustration is visually accurate to the game of golf.",
  "Be strict and practical.",
  "Return JSON only.",
  "Review the generated image against the supplied quiz item, scene specification, and prompt intent.",
  "Check all of the following:",
  "1. Does the image clearly depict a believable golf scene?",
  "2. Is there exactly one golf ball visible?",
  "3. If a club is present, does it have one single believable club head?",
  "4. If a specific club type was required, is the club visually consistent with that type?",
  "5. Is the shaft length, grip length, and overall proportion believable?",
  "6. Are there any duplicated, split, floating, bent, malformed, or toy-like clubs?",
  "7. If stakes are present, are they the correct colour?",
  "8. Does the golfer posture look natural and physically plausible for golf?",
  "9. Are course features such as bunker, rough, green, fairway, tee area, water, and stakes believable?",
  "10. Is the image suitable for teaching golf rules to children aged 12 to 17?",
  "11. Does the golfer appearance match the specified ethnicity and skin tone?",
  "12. Is the clothing colour clearly visible and consistent with the prompt?",
  "Return a score from 0 to 100.",
  "Set pass true only if the club and ball details are visually strong as well as the scene overall.",
  "If there are issues, provide a concise repairPrompt that can be appended to the original prompt to correct the faults.",
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

async function listReferenceFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(dir, entry.name))
      .filter((filePath) => ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function mimeTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      throw new Error(`Unsupported file type: ${filePath}`);
  }
}

async function fileToDataUrl(filePath: string): Promise<string> {
  const bytes = await fs.readFile(filePath);
  const mimeType = mimeTypeFor(filePath);
  const base64 = bytes.toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function padIndex(index: number): string {
  return String(index).padStart(3, "0");
}

function padRuleNumber(ruleNumber: string): string {
  const digits = (ruleNumber.match(/\d+/g) ?? []).join("");
  if (!digits) {
    return "000";
  }

  return digits.padStart(3, "0");
}

async function getUniqueDirectory(baseDir: string): Promise<string> {
  try {
    await fs.access(baseDir);
  } catch {
    return baseDir;
  }

  let suffix = 2;

  while (true) {
    const candidate = `${baseDir}__${String(suffix).padStart(2, "0")}`;

    try {
      await fs.access(candidate);
      suffix += 1;
    } catch {
      return candidate;
    }
  }
}

function normaliseChoices(choices: Choice[]): Choice[] {
  const ids = ["a", "b", "c", "d", "e"];

  return choices.map((choice, index) => ({
    id: ids[index] ?? choice.id,
    text: choice.text.trim(),
  }));
}

function dedupeByTitleAndQuestion(items: ExtractedQuizItem[]): ExtractedQuizItem[] {
  const seen = new Set<string>();
  const results: ExtractedQuizItem[] = [];

  for (const item of items) {
    const key = `${item.title.trim().toLowerCase()}||${item.question.trim().toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(item);
  }

  return results;
}

function normaliseSceneSpec(scene: GolfSceneSpec): GolfSceneSpec {
  return {
    ...scene,
    golferAge: "teen",
    ballCount: 1,
    prohibitedElements: Array.isArray(scene.prohibitedElements)
      ? scene.prohibitedElements.map((x) => x.trim()).filter(Boolean)
      : [],
  };
}

function normaliseQuizItem(item: ExtractedQuizItem, sourceImageName: string): ExtractedQuizItem {
  const choices = normaliseChoices(item.choices);
  const validIds = new Set(choices.map((x) => x.id));

  const dedupedCorrectAnswers = [...new Set(item.correctAnswers)]
    .filter((id) => validIds.has(id));

  if (dedupedCorrectAnswers.length === 0) {
    throw new Error(`No valid correct answers returned for question "${item.title}".`);
  }

  const type = item.type === "multiple_choice" ? "multiple_choice" : "multi_select";

  return {
    ...item,
    sourceImageName,
    type,
    choices,
    sceneSpec: applyDiversity(normaliseSceneSpec(item.sceneSpec)),
    correctAnswers: type === "multiple_choice"
      ? [dedupedCorrectAnswers[0]]
      : dedupedCorrectAnswers,
  };
}

function normaliseQuizBatch(batch: ExtractedQuizBatch, sourceImageName: string): ExtractedQuizItem[] {
  const items = batch.questions.map((item) => normaliseQuizItem(item, sourceImageName));
  return dedupeByTitleAndQuestion(items);
}

function toOutputMetadata(item: ExtractedQuizItem, imageVerification: ImageVerificationResult): OutputMetadata {
  return {
    schemaVersion: 1,
    sourceImageName: item.sourceImageName,
    ruleNumber: item.ruleNumber,
    ruleName: item.ruleName,
    group: item.group,
    title: item.title,
    question: item.question,
    type: item.type,
    choices: item.choices,
    correctAnswer: item.type === "multiple_choice"
      ? item.correctAnswers[0]
      : item.correctAnswers,
    correctAnswers: item.correctAnswers,
    explanation: item.explanation,
    imagePrompt: item.imagePrompt,
    imageAlt: item.imageAlt,
    sceneSpec: item.sceneSpec,
    imageVerification,
  };
}

function extractTextFromResponse(response: OpenAI.Responses.Response): string {
  const text = response.output_text?.trim();
  if (text) {
    return text;
  }

  for (const outputItem of response.output ?? []) {
    if (outputItem.type !== "message") {
      continue;
    }

    for (const contentItem of outputItem.content ?? []) {
      if (contentItem.type === "output_text" && contentItem.text) {
        return contentItem.text.trim();
      }
    }
  }

  throw new Error("No text content returned from Responses API.");
}

function extractGeneratedImageBase64(response: OpenAI.Responses.Response): string {
  for (const outputItem of response.output ?? []) {
    if (outputItem.type === "image_generation_call" && outputItem.result) {
      return outputItem.result;
    }
  }

  throw new Error("No generated image found in Responses API output.");
}

async function extractQuizItemsFromPage(inputFile: string): Promise<ExtractedQuizItem[]> {
  const dataUrl = await fileToDataUrl(inputFile);
  const fileName = path.basename(inputFile);

  const response = await client.responses.create({
    model: EXTRACT_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: EXTRACTION_PROMPT,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Create multiple quiz items from this rules page image: ${fileName}`,
          },
          {
            type: "input_image",
            image_url: dataUrl,
            detail: "high",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: QUIZ_BATCH_SCHEMA.name,
        schema: QUIZ_BATCH_SCHEMA.schema,
        strict: true,
      },
    },
  });

  const content = extractTextFromResponse(response);
  const parsed = JSON.parse(content) as ExtractedQuizBatch;
  const items = normaliseQuizBatch(parsed, fileName);

  if (items.length === 0) {
    throw new Error(`No quiz items were extracted from ${inputFile}`);
  }

  return items;
}

async function reviewQuizItems(items: ExtractedQuizItem[]): Promise<ExtractedQuizItem[]> {
  const response = await client.responses.create({
    model: REVIEW_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: REVIEW_PROMPT,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(
              {
                schemaVersion: 1,
                questions: items,
              },
              null,
              2,
            ),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: QUIZ_BATCH_SCHEMA.name,
        schema: QUIZ_BATCH_SCHEMA.schema,
        strict: true,
      },
    },
  });

  const content = extractTextFromResponse(response);
  const parsed = JSON.parse(content) as ReviewedQuizBatch;
  const sourceImageName = items[0]?.sourceImageName ?? "unknown";
  const reviewedItems = normaliseQuizBatch(parsed, sourceImageName);

  if (reviewedItems.length === 0) {
    throw new Error("Review pass removed all questions.");
  }

  return reviewedItems;
}

async function buildReferenceImages(scene: GolfSceneSpec): Promise<string[]> {
  const files = await listReferenceFiles(REFERENCE_DIR);
  const selected: string[] = [];
  const preferred: string[] = [];

  if (scene.clubInHand !== "none") {
    preferred.push(scene.clubInHand);
    preferred.push("club");
  }

  if (scene.stakeColour === "red") {
    preferred.push("red_stake");
  }

  if (scene.stakeColour === "yellow") {
    preferred.push("yellow_stake");
  }

  if (scene.stakeColour === "white") {
    preferred.push("white_stake");
  }

  if (scene.setting === "bunker" || scene.bunkerVisible) {
    preferred.push("bunker");
  }

  if (scene.setting === "putting_green" || scene.greenVisible) {
    preferred.push("green");
  }

  if (scene.setting === "teeing_area" || scene.teeMarkerVisible) {
    preferred.push("tee_marker");
    preferred.push("tee");
  }

  if (scene.setting === "penalty_area_edge" || scene.waterVisible) {
    preferred.push("water");
    preferred.push("penalty");
  }

  preferred.push("golf_ball");
  preferred.push("fairway");
  preferred.push("rough");

  for (const keyword of preferred) {
    const match = files.find((file) =>
      path.basename(file).toLowerCase().includes(keyword.toLowerCase()),
    );

    if (match && !selected.includes(match)) {
      selected.push(match);
    }

    if (selected.length >= 4) {
      break;
    }
  }

  return selected;
}

async function generateIllustration(
  item: ExtractedQuizItem,
  finalPrompt: string,
  referenceImages: string[],
): Promise<Buffer> {
  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail: "high" }
  > = [
    {
      type: "input_text",
      text: finalPrompt,
    },
  ];

  for (const referencePath of referenceImages) {
    content.push({
      type: "input_image",
      image_url: await fileToDataUrl(referencePath),
      detail: "high",
    });
  }

  const response = await client.responses.create({
    model: IMAGE_RESPONSE_MODEL,
    input: [
      {
        role: "user",
        content,
      },
    ],
    tools: [
      {
        type: "image_generation",
        size: IMAGE_SIZE,
        quality: "high",
        background: "opaque",
      },
    ],
    tool_choice: { type: "image_generation" },
  });

  const imageBase64 = extractGeneratedImageBase64(response);
  return Buffer.from(imageBase64, "base64");
}

async function verifyIllustration(
  item: ExtractedQuizItem,
  finalPrompt: string,
  imageBytes: Buffer,
): Promise<ImageVerificationResult> {
  const imageDataUrl = `data:image/png;base64,${imageBytes.toString("base64")}`;

  const response = await client.responses.create({
    model: VERIFY_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: IMAGE_VERIFICATION_PROMPT,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(
              {
                title: item.title,
                question: item.question,
                explanation: item.explanation,
                imagePrompt: item.imagePrompt,
                sceneSpec: item.sceneSpec,
                finalPrompt,
              },
              null,
              2,
            ),
          },
          {
            type: "input_image",
            image_url: imageDataUrl,
            detail: "high",
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: IMAGE_VERIFICATION_SCHEMA.name,
        schema: IMAGE_VERIFICATION_SCHEMA.schema,
        strict: true,
      },
    },
  });

  const content = extractTextFromResponse(response);
  return JSON.parse(content) as ImageVerificationResult;
}

async function generateVerifiedIllustration(
  item: ExtractedQuizItem,
): Promise<{ image: Buffer; verification: ImageVerificationResult; finalPrompt: string }> {
  const referenceImages = await buildReferenceImages(item.sceneSpec);
  let lastVerification: ImageVerificationResult | null = null;
  let lastImage: Buffer | null = null;
  let repairText = "";
  let usedSafeFallback = false;
  let lastPrompt = "";

  for (let attempt = 1; attempt <= MAX_IMAGE_ATTEMPTS; attempt += 1) {
    const basePrompt = usedSafeFallback
      ? buildSafeFallbackImagePrompt(item, item.sceneSpec)
      : buildFinalImagePrompt(item, item.sceneSpec);

    const finalPrompt = repairText
      ? `${basePrompt} Additional corrections for this attempt: ${sanitiseImagePromptText(repairText)}`
      : basePrompt;

    lastPrompt = finalPrompt;

    try {
      const image = await generateIllustration(item, finalPrompt, referenceImages);
      const verification = await verifyIllustration(item, finalPrompt, image);

      lastVerification = verification;
      lastImage = image;

      console.log(
        `Image attempt ${attempt}/${MAX_IMAGE_ATTEMPTS} for "${item.title}" scored ${verification.score} and pass=${verification.pass}`,
      );

      if (verification.pass && verification.score >= MIN_IMAGE_SCORE) {
        return {
          image,
          verification,
          finalPrompt,
        };
      }

      repairText = verification.repairPrompt.trim();
    } catch (error) {
      if (isModerationBlockedError(error)) {
        console.warn(
          `Image attempt ${attempt}/${MAX_IMAGE_ATTEMPTS} for "${item.title}" was blocked by moderation. Retrying with a safer prompt.`,
        );

        usedSafeFallback = true;
        repairText = "";
        continue;
      }

      throw error;
    }
  }

  if (!lastImage || !lastVerification) {
    throw new Error(`Failed to generate a verified image for "${item.title}" after ${MAX_IMAGE_ATTEMPTS} attempts.`);
  }

  return {
    image: lastImage,
    verification: lastVerification,
    finalPrompt: lastPrompt,
  };
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value, null, 2);
  await fs.writeFile(filePath, json, "utf8");
}

function buildQuestionFolderName(item: ExtractedQuizItem, questionIndex: number): string {
  const rulePart = padRuleNumber(item.ruleNumber);
  const indexPart = padIndex(questionIndex);
  const titlePart = slugify(item.title);
  return `${rulePart}_${indexPart}_${titlePart}`;
}

async function processImage(inputFile: string): Promise<void> {
  const sourceImageName = path.basename(inputFile);
  const completePath = buildSourceCompletePath(inputFile);
  const statePath = buildSourceStatePath(inputFile);

  if (await pathExists(completePath)) {
    console.log(`Skipping already completed source image: ${inputFile}`);
    return;
  }

  let state: SourceProcessingState;

  if (await pathExists(statePath)) {
    state = await readJsonFile<SourceProcessingState>(statePath);
    console.log(`Resuming source image from saved state: ${inputFile}`);
  } else {
    const extractedItems = await extractQuizItemsFromPage(inputFile);
    const reviewedItems = await reviewQuizItems(extractedItems);

    console.log(`Extracted ${extractedItems.length} question(s) from ${inputFile}`);
    console.log(`Kept ${reviewedItems.length} question(s) after review`);

    state = {
      schemaVersion: 1,
      sourceImageName,
      sourceImagePath: inputFile,
      status: "in_progress",
      extractedItems,
      reviewedItems,
      completedQuestionFolders: [],
      updatedAtUtc: new Date().toISOString(),
    };

    await writeSourceState(inputFile, state);
  }

  const completedQuestionFolders = new Set(state.completedQuestionFolders);

  for (let i = 0; i < state.reviewedItems.length; i += 1) {
    const item = state.reviewedItems[i];
    const questionFolderName = buildQuestionFolderName(item, i + 1);
    const targetDir = path.join(OUTPUT_DIR, questionFolderName);

    if (completedQuestionFolders.has(questionFolderName) && await isQuestionComplete(targetDir)) {
      console.log(`Skipping completed question: ${questionFolderName}`);
      continue;
    }

    if (await isQuestionComplete(targetDir)) {
      completedQuestionFolders.add(questionFolderName);
      state.completedQuestionFolders = [...completedQuestionFolders];
      await writeSourceState(inputFile, state);

      console.log(`Detected completed question and updated state: ${questionFolderName}`);
      continue;
    }

    try {
      await ensureDirectory(targetDir);

      const generated = await generateVerifiedIllustration(item);
      const metadata = toOutputMetadata(item, generated.verification);

      await fs.writeFile(path.join(targetDir, "illustration.png"), generated.image);
      await writeJsonFile(path.join(targetDir, "metadata.json"), metadata);
      await fs.writeFile(path.join(targetDir, "final-prompt.txt"), generated.finalPrompt, "utf8");

      completedQuestionFolders.add(questionFolderName);
      state.completedQuestionFolders = [...completedQuestionFolders];
      await writeSourceState(inputFile, state);

      console.log(`Created: ${targetDir}`);
    } catch (error) {
      if (isInsufficientQuotaError(error)) {
        console.error("OpenAI API quota has been exhausted. Stopping without marking this source image as complete.");
        await writeSourceState(inputFile, state);
        throw error;
      }

      console.error(`Failed to create illustration for "${item.title}"`, error);

      await ensureDirectory(targetDir);
      await writeJsonFile(path.join(targetDir, "error.json"), {
        title: item.title,
        question: item.question,
        imagePrompt: item.imagePrompt,
        sceneSpec: item.sceneSpec,
        error: error instanceof Error ? error.message : String(error),
        failedAtUtc: new Date().toISOString(),
      });

      console.log(`Skipped image for "${item.title}" and wrote error.json`);
    }
  }

  if (completedQuestionFolders.size === state.reviewedItems.length) {
    state = {
      ...state,
      status: "complete",
      completedQuestionFolders: [...completedQuestionFolders],
      updatedAtUtc: new Date().toISOString(),
    };

    await writeSourceState(inputFile, state);
    await writeJsonFile(completePath, state);

    console.log(`Completed source image: ${inputFile}`);
  } else {
    console.log(`Source image remains incomplete: ${inputFile}`);
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

  const referenceFiles = await listReferenceFiles(REFERENCE_DIR);
  if (referenceFiles.length > 0) {
    console.log(`Using ${referenceFiles.length} reference image(s) from ${REFERENCE_DIR}`);
  } else {
    console.log(`No reference images found in ${REFERENCE_DIR}; continuing without them`);
  }

  for (const file of files) {
    console.log(`Processing: ${file}`);

    try {
      await processImage(file);
    } catch (error) {
      if (isInsufficientQuotaError(error)) {
        console.error("OpenAI API quota exhausted. Restore quota, then rerun the same command to resume.");
        process.exit(1);
      }

      throw error;
    }
  }

  console.log("Done.");
}

function buildClubConstraints(club: GolfSceneSpec["clubInHand"]): string[] {
  switch (club) {
    case "driver":
      return [
        "Show exactly one realistic modern driver.",
        "The driver must have one single large wood-style club head.",
        "Do not show an iron head, wedge head, putter head, or split club head.",
        "Do not distort the shaft, grip, or club head.",
      ];
    case "fairway_wood":
      return [
        "Show exactly one realistic fairway wood.",
        "The club must have one single smaller wood-style club head than a driver.",
        "Do not show an iron head, wedge head, putter head, or split club head.",
      ];
    case "hybrid":
      return [
        "Show exactly one realistic hybrid golf club.",
        "The club head must look like a hybrid, not a driver, iron, wedge, or putter.",
        "Do not show a split club head or malformed shaft.",
      ];
    case "iron":
      return [
        "Show exactly one realistic iron golf club.",
        "The iron must have one single metal iron head.",
        "Do not show a wood-style head or putter head.",
      ];
    case "wedge":
      return [
        "Show exactly one realistic wedge.",
        "The wedge must have one single wedge-style club head.",
        "Do not show a wood-style head or putter head.",
      ];
    case "putter":
      return [
        "Show exactly one realistic putter.",
        "The putter head must clearly look like a putter head.",
        "Do not show a wood-style head or iron head.",
      ];
    case "none":
      return [
        "Do not show any golf club in the golfer's hands.",
      ];
  }
}

function sanitiseImagePromptText(value: string): string {
  return value
    .replace(/\bhandicap(s)?\b/gi, "golf scoring")
    .replace(/\bunplayable ball\b/gi, "ball in a difficult position")
    .replace(/\bpenalty\b/gi, "one-stroke consequence")
    .replace(/\bpunishment\b/gi, "result")
    .replace(/\brelief\b/gi, "next action")
    .replace(/\bdrop\b/gi, "drop the ball back into play")
    .replace(/\s+/g, " ")
    .trim();
}

function isModerationBlockedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as {
    code?: string;
    type?: string;
    error?: { code?: string; type?: string };
  };

  return maybeError.code === "moderation_blocked"
    || maybeError.type === "image_generation_user_error"
    || maybeError.error?.code === "moderation_blocked"
    || maybeError.error?.type === "image_generation_user_error";
}

function buildSafeFallbackImagePrompt(item: ExtractedQuizItem, scene: GolfSceneSpec): string {
  const parts: string[] = [
    "Create a polished educational golf illustration.",
    "The image should sit about 75% of the way from a full cartoon towards a real photo.",
    "Show a believable real golf course scene.",
    "Show one teenage golfer with natural human proportions.",
    "Show exactly one golf ball.",
    "Use realistic golf equipment and realistic course features.",
    "Do not include text, labels, symbols, logos, diagrams, extra balls, extra clubs, split club heads, or unusual equipment.",
    `Scene setting: ${scene.setting}.`,
    `Golfer action: ${scene.action}.`,
    `Club in hand: ${scene.clubInHand}.`,
  ];

  if (scene.stakeColour !== "none") {
    parts.push(`If stakes are visible, they must be ${scene.stakeColour}.`);
  }

  if (scene.waterVisible) {
    parts.push("Water may be visible.");
  }

  if (scene.bunkerVisible) {
    parts.push("A bunker may be visible.");
  }

  if (scene.greenVisible) {
    parts.push("A putting green may be visible.");
  }

  if (scene.teeMarkerVisible) {
    parts.push("Tee markers may be visible.");
  }

  parts.push(`Illustration goal: ${sanitiseImagePromptText(item.imagePrompt)}.`);

  return parts.join(" ");
}

const COLOURS = [
  "red", "blue", "green", "yellow", "orange",
  "purple", "black", "white", "grey", "navy"
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBoolean(): boolean {
  return Math.random() < 0.5;
}

function getDifferentColour(base: string): string {
  let colour: string;

  do {
    colour = randomItem(COLOURS);
  } while (colour === base);

  return colour;
}

function applyDiversity(scene: GolfSceneSpec): GolfSceneSpec {
  const top = randomItem(COLOURS);
  const bottom = getDifferentColour(top);

  return {
    ...scene,
    golferGender: randomItem(["boy", "girl"]),
    handedness: randomItem(["right", "left"]),

    ethnicity: randomItem(["white", "white", "black", "asian", "mixed"]),
    skinTone: randomItem(["light", "medium", "dark"]),

    clothingTopColour: top,
    clothingBottomColour: bottom,
    hat: randomBoolean(),
  };
}

function buildSourceKey(inputFile: string): string {
  return slugify(path.basename(inputFile, path.extname(inputFile)));
}

function buildSourceStateDir(inputFile: string): string {
  return path.join(OUTPUT_DIR, "_source-state", buildSourceKey(inputFile));
}

function buildSourceStatePath(inputFile: string): string {
  return path.join(buildSourceStateDir(inputFile), "state.json");
}

function buildSourceCompletePath(inputFile: string): string {
  return path.join(buildSourceStateDir(inputFile), "complete.json");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

async function writeSourceState(inputFile: string, state: SourceProcessingState): Promise<void> {
  const stateDir = buildSourceStateDir(inputFile);
  await ensureDirectory(stateDir);

  await writeJsonFile(buildSourceStatePath(inputFile), {
    ...state,
    updatedAtUtc: new Date().toISOString(),
  });
}

async function isQuestionComplete(targetDir: string): Promise<boolean> {
  const illustrationPath = path.join(targetDir, "illustration.png");
  const metadataPath = path.join(targetDir, "metadata.json");
  const promptPath = path.join(targetDir, "final-prompt.txt");

  return await pathExists(illustrationPath)
    && await pathExists(metadataPath)
    && await pathExists(promptPath);
}

function isInsufficientQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as {
    code?: string;
    type?: string;
    error?: { code?: string; type?: string };
  };

  return maybeError.code === "insufficient_quota"
    || maybeError.type === "insufficient_quota"
    || maybeError.error?.code === "insufficient_quota"
    || maybeError.error?.type === "insufficient_quota";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});