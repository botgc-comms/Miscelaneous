import OpenAI from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";

type Choice = {
  id: string;
  text: string;
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
};

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INPUT_DIR = process.argv[2] ?? "./input";
const OUTPUT_DIR = process.argv[3] ?? "./output";

const EXTRACT_MODEL = process.env.OPENAI_EXTRACT_MODEL ?? "gpt-4.1";
const REVIEW_MODEL = process.env.OPENAI_REVIEW_MODEL ?? EXTRACT_MODEL;
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
const IMAGE_SIZE = "1024x1024";

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
          },
        },
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
  "The imagePrompt must describe a child-friendly illustration relevant to the question, but it does not need to recreate the page diagram.",
  "Prefer simple visual ideas such as a ball behind a tree, a golfer dropping a ball, or a golfer replaying a shot.",
  "Do not describe measuring relief visually unless the question specifically requires that concept.",
  "Do not ask for a club to be laid on the ground for measurement.",
  "Do not describe a second golf ball as a reference point.",
  "Unless the question explicitly requires otherwise, the image must show exactly one golf ball.",
  "Do not ask for any text inside the image.",
  "Do not mention page layouts, captions, callouts, logos, brands, or watermarks.",
  "Return only schema-valid JSON.",
  "When writing imagePrompt:",
  "- Describe a real golf scene, not a diagram.",
  "- Focus on what someone would actually see on a golf course.",
  "- Do not mention dotted lines, measurement graphics, rulers, or measuring sticks.",
  "- Do not describe abstract teaching aids.",
  "- Keep the scene simple, with one clear action.",
  "- Make the prompt visually specific enough to generate a believable golf illustration.",
  "- Where appropriate, vary whether the golfer is a girl or a boy.",
  "- Prefer examples like: 'A teenage girl dropping a golf ball beside red penalty stakes near water while holding a club naturally'.",
  "- If the rule or question refers to a specific stake colour, include that exact colour in the imagePrompt.",
  "- Unless the question explicitly requires more than one ball, the imagePrompt must describe exactly one golf ball only.",
  "- Do not describe one ball in the air and another on the ground.",
  "- Do not use a second ball to illustrate a previous or future position.",
  "- Do not describe clubs being placed on the ground for measuring.",
].join(" ");

const REVIEW_PROMPT = [
  "You are reviewing previously generated golf quiz questions for children aged 12 to 17.",
  "You will receive a batch of questions extracted from one rules page.",
  "Your job is to improve them without changing the underlying rule facts.",
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
  "Do not invent facts not supported by the source material.",
  "Return only the corrected batch as schema-valid JSON.",
].join(" ");

const ILLUSTRATION_STYLE_PROMPT = [
  "Create a clean, colourful, semi-realistic vector illustration for a golf rules quiz for ages 12 to 17.",
  "The style should feel slightly stylised and friendly, but still grounded in real golf.",
  "Aim for a balance between realism and illustration, around 40% between cartoon and realistic.",
  "Use realistic golf posture, realistic equipment, and believable course scenery.",
  "Use clean outlines, soft shading, and smooth shapes.",
  "Use bright natural colours with a polished educational illustration feel.",
  "Human proportions should be natural, not exaggerated.",
  "Golf clubs must look correct and have a single realistic club head.",
  "Golf clubs must be held naturally by the golfer or resting naturally on the ground.",
  "Do not show floating clubs or impossible golf equipment.",
  "Golf balls must be shown in realistic positions and actions.",
  "If a ball is being dropped, show it being released naturally from about knee height.",
  "Penalty area stakes must use the correct colour for the situation described in the prompt, such as red, yellow or white.",
  "Show one clear golf action only.",
  "No diagrams, no dotted measurement lines, no measuring aids, no symbols.",
  "No text, labels, numbers, logos, or watermarks.",
  "Vary gender and appearance naturally across images.",
  "Do not always depict a boy.",
  "Keep the visual style consistent across the full set of quiz images.",
  "Show exactly one golf ball unless the question explicitly requires more than one.",
  "Never show one ball being dropped while another ball is already on the ground, unless the question explicitly requires two balls.",
  "If a club is shown, it must either be held naturally by the golfer or resting naturally on the ground.",
  "Do not show a club being used as a measuring marker unless the question explicitly requires that and the scene can still be shown naturally.",
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
    correctAnswers: type === "multiple_choice"
      ? [dedupedCorrectAnswers[0]]
      : dedupedCorrectAnswers,
  };
}

function normaliseQuizBatch(batch: ExtractedQuizBatch, sourceImageName: string): ExtractedQuizItem[] {
  const items = batch.questions.map((item) => normaliseQuizItem(item, sourceImageName));
  return dedupeByTitleAndQuestion(items);
}

function toOutputMetadata(item: ExtractedQuizItem): OutputMetadata {
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
  };
}

async function extractQuizItemsFromPage(inputFile: string): Promise<ExtractedQuizItem[]> {
  const dataUrl = await fileToDataUrl(inputFile);
  const fileName = path.basename(inputFile);

  const completion = await client.chat.completions.create({
    model: EXTRACT_MODEL,
    messages: [
      {
        role: "system",
        content: EXTRACTION_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Create multiple quiz items from this rules page image: ${fileName}`,
          },
          {
            type: "image_url",
            image_url: {
              url: dataUrl,
            },
          },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: QUIZ_BATCH_SCHEMA,
    },
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error(`No structured content returned for ${inputFile}`);
  }

  const parsed = JSON.parse(content) as ExtractedQuizBatch;
  const items = normaliseQuizBatch(parsed, fileName);

  if (items.length === 0) {
    throw new Error(`No quiz items were extracted from ${inputFile}`);
  }

  return items;
}

async function reviewQuizItems(items: ExtractedQuizItem[]): Promise<ExtractedQuizItem[]> {
  const completion = await client.chat.completions.create({
    model: REVIEW_MODEL,
    messages: [
      {
        role: "system",
        content: REVIEW_PROMPT,
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            schemaVersion: 1,
            questions: items,
          },
          null,
          2,
        ),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: QUIZ_BATCH_SCHEMA,
    },
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error("No reviewed structured content returned.");
  }

  const parsed = JSON.parse(content) as ReviewedQuizBatch;
  const sourceImageName = items[0]?.sourceImageName ?? "unknown";
  const reviewedItems = normaliseQuizBatch(parsed, sourceImageName);

  if (reviewedItems.length === 0) {
    throw new Error("Review pass removed all questions.");
  }

  return reviewedItems;
}

async function generateIllustration(prompt: string): Promise<Buffer> {
  const finalPrompt = `${ILLUSTRATION_STYLE_PROMPT} ${prompt}`;

  const result = await client.images.generate({
    model: IMAGE_MODEL,
    prompt: finalPrompt,
    size: IMAGE_SIZE,
    quality: "high",
    background: "opaque",
  });

  const image = result.data?.[0];

  if (!image?.b64_json) {
    throw new Error("No image data returned from image generation.");
  }

  return Buffer.from(image.b64_json, "base64");
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
  const extractedItems = await extractQuizItemsFromPage(inputFile);
  const reviewedItems = await reviewQuizItems(extractedItems);

  console.log(`Extracted ${extractedItems.length} question(s) from ${inputFile}`);
  console.log(`Kept ${reviewedItems.length} question(s) after review`);

  for (let i = 0; i < reviewedItems.length; i += 1) {
    const item = reviewedItems[i];
    const questionFolderName = buildQuestionFolderName(item, i + 1);
    const targetDir = await getUniqueDirectory(path.join(OUTPUT_DIR, questionFolderName));

    await ensureDirectory(targetDir);

    const illustration = await generateIllustration(item.imagePrompt);
    const metadata = toOutputMetadata(item);

    await fs.writeFile(path.join(targetDir, "illustration.png"), illustration);
    await writeJsonFile(path.join(targetDir, "metadata.json"), metadata);

    console.log(`Created: ${targetDir}`);
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