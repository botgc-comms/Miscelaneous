import OpenAI from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";
import { regenerateSingleImage } from "./regenerateSingleImage.js";
import { createJuniorVersionForMetadata } from "./createJuniorQuizVersions.js";

type Choice = {
  id: string;
  text: string;
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
  sceneSpec: unknown;
};

type CreateQuizResponse = Omit<Metadata, "schemaVersion" | "sourceImageName" | "correctAnswer">;

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_QUESTION_MODEL ?? "gpt-4.1";

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function nextFolderPath(outputDir: string, title: string): Promise<string> {
  const entries = await fs.readdir(outputDir, { withFileTypes: true });

  const existingNumbers = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => /^ai_(\d{3})_/i.exec(entry.name))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]));

  const nextNumber = existingNumbers.length === 0
    ? 1
    : Math.max(...existingNumbers) + 1;

  const titlePart = slugify(title || "Created_quiz_question");
  const base = `ai_${String(nextNumber).padStart(3, "0")}_${titlePart}`;

  for (let index = 1; index < 1000; index += 1) {
    const folderName = index === 1 ? base : `${base}_${index}`;
    const folderPath = path.join(outputDir, folderName);

    if (!await pathExists(folderPath)) {
      return folderPath;
    }
  }

  throw new Error("Could not create a unique output folder.");
}

function extractJson<T>(text: string): T {
  const trimmed = text.trim();

  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as T;
  }

  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);

  if (match) {
    return JSON.parse(match[1]) as T;
  }

  throw new Error("Model did not return JSON.");
}

function normaliseCorrectAnswers(value: string[]): string[] {
  return value.map((answer) => answer.trim().toLowerCase()).filter(Boolean);
}

function normaliseMetadata(created: CreateQuizResponse): Metadata {
  const correctAnswers = normaliseCorrectAnswers(created.correctAnswers);

  return {
    schemaVersion: 1,
    sourceImageName: "created-from-description",
    ruleNumber: created.ruleNumber?.trim() || "Unknown",
    ruleName: created.ruleName?.trim() || "Created rule question",
    group: created.group?.trim() || "Created Questions",
    title: created.title.trim(),
    question: created.question.trim(),
    type: created.type,
    choices: created.choices.map((choice) => ({
      id: choice.id.trim().toLowerCase(),
      text: choice.text.trim(),
    })),
    correctAnswer: correctAnswers.length === 1 ? correctAnswers[0] : correctAnswers,
    correctAnswers,
    explanation: created.explanation.trim(),
    imagePrompt: created.imagePrompt.trim(),
    imageAlt: created.imageAlt.trim(),
    sceneSpec: created.sceneSpec,
  };
}

async function createStandardMetadata(description: string): Promise<Metadata> {
  const response = await client.responses.create({
    model: MODEL,
    input: [
      {
        role: "system",
        content: [
          "You create standard golf Rules of Golf quiz metadata.",
          "Use British English.",
          "Create only the standard quiz metadata.",
          "Do not create the junior-friendly wording.",
          "The junior-friendly version is generated later by the existing junior generator.",
          "Create a clear imagePrompt using the established junior golf quiz illustration style.",
          "The image prompt must describe one clear golf rules situation only.",
          "The image prompt must require a polished modern semi-realistic illustration, about 75% realistic and 25% stylised.",
          "The image prompt must say not to include text, labels, numbers, arrows, captions, diagrams, badges, logos, watermarks, club crests, scorecards or speech bubbles.",
          "Wrong answers must be plausible.",
          "Return JSON only.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          description,
          returnExactly: {
            ruleNumber: "string",
            ruleName: "string",
            group: "string",
            title: "string",
            question: "string",
            type: "multiple_choice or multi_select",
            choices: [
              { id: "a", text: "string" },
              { id: "b", text: "string" },
              { id: "c", text: "string" },
              { id: "d", text: "string" },
            ],
            correctAnswers: ["a"],
            explanation: "string",
            sceneSpec: {
              setting: "string",
              players: "string",
              ballPosition: "string",
              ruleMoment: "string",
              educationalFocus: "string",
              mustShow: ["string"],
              mustNotShow: ["string"],
            },
            imagePrompt: "string",
            imageAlt: "string",
          },
        }, null, 2),
      },
    ],
  });

  if (!response.output_text) {
    throw new Error("No text returned from OpenAI.");
  }

  return normaliseMetadata(extractJson<CreateQuizResponse>(response.output_text));
}

async function latestGeneratedImagePath(folderPath: string, folderName: string): Promise<{
  imageFileName: string;
  imagePath: string;
}> {
  const entries = await fs.readdir(folderPath);

  const latest = entries
    .map((name) => {
      const match = /^illustration-v(\d+)\.png$/i.exec(name);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((item): item is { name: string; version: number } => item !== null)
    .sort((a, b) => b.version - a.version)[0];

  if (!latest) {
    throw new Error("Image was generated, but no illustration-v*.png file was found.");
  }

  return {
    imageFileName: latest.name,
    imagePath: `/assets/${encodeURIComponent(folderName)}/${encodeURIComponent(latest.name)}`,
  };
}

export async function createQuizFromRuleDescription(request: {
  outputDir: string;
  description: string;
}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  if (!request.description?.trim()) {
    throw new Error("description is required.");
  }

  const metadata = await createStandardMetadata(request.description);
  const folderPath = await nextFolderPath(request.outputDir, metadata.title);
  const folderName = path.basename(folderPath);

  await fs.mkdir(folderPath, { recursive: true });

  await fs.writeFile(
    path.join(folderPath, "metadata.json"),
    JSON.stringify(metadata, null, 2),
    "utf8"
  );

  await fs.writeFile(
    path.join(folderPath, "final-prompt-v2.txt"),
    metadata.imagePrompt,
    "utf8"
  );

  const juniorVersion = await createJuniorVersionForMetadata(metadata);

  await fs.writeFile(
    path.join(folderPath, "junior-version.json"),
    JSON.stringify({
      schemaVersion: 1,
      sourceMetadataPath: path.join(folderPath, "metadata.json"),
      sourceImageName: metadata.sourceImageName,
      ruleNumber: metadata.ruleNumber,
      ruleName: metadata.ruleName,
      title: metadata.title,
      question: metadata.question,
      choices: metadata.choices,
      correctAnswers: metadata.correctAnswers,
      explanation: metadata.explanation,
      juniorVersion,
      generatedAtUtc: new Date().toISOString(),
      model: process.env.OPENAI_JUNIOR_TEXT_MODEL ?? "gpt-4.1",
    }, null, 2),
    "utf8"
  );

  const image = await regenerateSingleImage({
    outputDir: request.outputDir,
    folderName,
    promptFileName: "final-prompt-v2.txt",
    instructions: "Generate the first illustration for this newly created quiz item using the existing junior golf quiz illustration style.",
  });

  const generatedImage = await latestGeneratedImagePath(folderPath, folderName);

  return {
    success: true,
    folderName,
    metadataPath: `/assets/${encodeURIComponent(folderName)}/metadata.json`,
    juniorVersionPath: `/assets/${encodeURIComponent(folderName)}/junior-version.json`,
    promptPath: `/assets/${encodeURIComponent(folderName)}/final-prompt-v2.txt`,
    imagePath: generatedImage.imagePath,
    imageFileName: generatedImage.imageFileName,
    image,
    metadata,
    juniorVersion,
  };
}
