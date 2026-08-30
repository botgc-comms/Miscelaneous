import OpenAI from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";
import { assertSafeFolderName } from "./quizFiles.js";

type Choice = { id: string; text: string };

type Metadata = {
  sourceImageName: string;
  ruleNumber: string;
  ruleName: string;
  group?: string;
  title: string;
  question: string;
  type: "multiple_choice" | "multi_select";
  choices: Choice[];
  correctAnswer?: string | string[];
  correctAnswers: string[];
  explanation: string;
  imagePrompt: string;
  imageAlt?: string;
};

type VocabularyItem = {
  term: string;
  simpleMeaning: string;
};

type QuestionSuggestion = {
  title: string;
  question: string;
  choices: Choice[];
  correctAnswers: string[];
  explanation: string;
};

type JuniorQuestionSuggestion = QuestionSuggestion & {
  vocabulary: VocabularyItem[];
  teachingTip: string;
  likelyMisconceptions: string[];
};

type SuggestQuestionEditRequest = {
  outputDir: string;
  folderName: string;
  instructions: string;
};

type SuggestQuestionEditResult = {
  success: true;
  folderName: string;
  questionFileName: string;
  juniorQuestionFileName: string;
  questionPath: string;
  juniorQuestionPath: string;
  suggestion: QuestionSuggestion;
  juniorSuggestion: JuniorQuestionSuggestion;
};

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = process.env.OPENAI_QUESTION_MODEL ?? "gpt-4.1";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function latestQuestionVersionPath(folderPath: string): Promise<string | null> {
  const entries = await fs.readdir(folderPath);

  const questions = entries
    .map((name) => {
      const match = /^question-v(\d+)\.json$/i.exec(name);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((x): x is { name: string; version: number } => x !== null)
    .sort((a, b) => b.version - a.version);

  return questions[0] ? path.join(folderPath, questions[0].name) : null;
}

async function nextQuestionVersion(folderPath: string): Promise<number> {
  for (let version = 2; version < 1000; version += 1) {
    const questionPath = path.join(folderPath, `question-v${version}.json`);
    const juniorPath = path.join(folderPath, `junior-question-v${version}.json`);

    if (!await pathExists(questionPath) && !await pathExists(juniorPath)) {
      return version;
    }
  }

  throw new Error("Could not find an available question version.");
}

function normaliseId(value: string): string {
  return value.trim().toLowerCase();
}

function normaliseQuestion(metadata: Metadata, suggestion: QuestionSuggestion): QuestionSuggestion {
  const suggestedChoices = new Map(
    suggestion.choices.map((choice) => [normaliseId(choice.id), choice.text.trim()])
  );

  return {
    title: suggestion.title.trim(),
    question: suggestion.question.trim(),
    choices: metadata.choices.map((choice) => ({
      id: choice.id,
      text: suggestedChoices.get(normaliseId(choice.id)) ?? choice.text,
    })),
    correctAnswers: metadata.correctAnswers.map(normaliseId),
    explanation: suggestion.explanation.trim(),
  };
}

function normaliseJuniorQuestion(metadata: Metadata, suggestion: JuniorQuestionSuggestion): JuniorQuestionSuggestion {
  const official = normaliseQuestion(metadata, suggestion);

  return {
    ...official,
    vocabulary: (suggestion.vocabulary ?? [])
      .map((item) => ({
        term: item.term.trim(),
        simpleMeaning: item.simpleMeaning.trim(),
      }))
      .filter((item) => item.term && item.simpleMeaning),
    teachingTip: suggestion.teachingTip?.trim() ?? "",
    likelyMisconceptions: (suggestion.likelyMisconceptions ?? [])
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

function buildOfficialPrompt(metadata: Metadata, instructions: string): string {
  return [
    "You are helping review junior golf Rules of Golf quiz content.",
    "Create a corrected official quiz version.",
    "Use British English.",
    "Preserve the same rule meaning.",
    "Do not change which answer is correct.",
    "Do not change the answer IDs.",
    "Do not add or remove answer choices.",
    "Wrong answers should remain plausible.",
    "Return JSON only.",
    "",
    "Current quiz item:",
    JSON.stringify({
      ruleNumber: metadata.ruleNumber,
      ruleName: metadata.ruleName,
      title: metadata.title,
      question: metadata.question,
      type: metadata.type,
      choices: metadata.choices,
      correctAnswers: metadata.correctAnswers,
      explanation: metadata.explanation,
    }, null, 2),
    "",
    "Reviewer instructions:",
    instructions,
    "",
    "Return exactly:",
    JSON.stringify({
      title: "string",
      question: "string",
      choices: metadata.choices.map((choice) => ({ id: choice.id, text: "string" })),
      correctAnswers: metadata.correctAnswers,
      explanation: "string",
    }, null, 2),
  ].join("\n");
}

function buildJuniorPrompt(metadata: Metadata, officialSuggestion: QuestionSuggestion): string {
  return [
    "Create a matching junior-friendly version of this golf quiz for an intelligent 8-year-old golfer.",
    "Use British English.",
    "Keep the same correct answer IDs.",
    "Keep the same answer IDs.",
    "Keep the same number of choices.",
    "Do not change the rule meaning.",
    "Use simple concrete wording.",
    "Wrong answers should remain plausible, not silly.",
    "Return JSON only.",
    "",
    "Official corrected quiz item:",
    JSON.stringify({
      ruleNumber: metadata.ruleNumber,
      ruleName: metadata.ruleName,
      title: officialSuggestion.title,
      question: officialSuggestion.question,
      type: metadata.type,
      choices: officialSuggestion.choices,
      correctAnswers: officialSuggestion.correctAnswers,
      explanation: officialSuggestion.explanation,
    }, null, 2),
    "",
    "Return exactly:",
    JSON.stringify({
      title: "string",
      question: "string",
      choices: officialSuggestion.choices.map((choice) => ({ id: choice.id, text: "string" })),
      correctAnswers: officialSuggestion.correctAnswers,
      explanation: "string",
      vocabulary: [{ term: "string", simpleMeaning: "string" }],
      teachingTip: "string",
      likelyMisconceptions: ["string"],
    }, null, 2),
  ].join("\n");
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

async function askJson<T>(prompt: string): Promise<T> {
  const response = await client.responses.create({
    model: MODEL,
    input: prompt,
  });

  if (!response.output_text) {
    throw new Error("No text returned from OpenAI.");
  }

  return extractJson<T>(response.output_text);
}

export async function suggestQuestionEdit(request: SuggestQuestionEditRequest): Promise<SuggestQuestionEditResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  if (!request.instructions?.trim()) {
    throw new Error("instructions is required.");
  }

  const folderName = assertSafeFolderName(request.folderName);
  const folderPath = path.join(request.outputDir, folderName);
  const metadataPath = path.join(folderPath, "metadata.json");

  if (!await pathExists(metadataPath)) {
    throw new Error(`metadata.json not found for ${folderName}.`);
  }

  const originalMetadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Metadata;
  const latestQuestionPath = await latestQuestionVersionPath(folderPath);

  const latestQuestionJson = latestQuestionPath
    ? JSON.parse(await fs.readFile(latestQuestionPath, "utf8"))
    : null;

  const latestQuestion = latestQuestionJson?.suggestion ?? latestQuestionJson;

  const metadata: Metadata = latestQuestion
    ? {
        ...originalMetadata,
        title: latestQuestion.title ?? originalMetadata.title,
        question: latestQuestion.question ?? originalMetadata.question,
        choices: latestQuestion.choices ?? originalMetadata.choices,
        correctAnswers: latestQuestion.correctAnswers ?? originalMetadata.correctAnswers,
        explanation: latestQuestion.explanation ?? originalMetadata.explanation,
      }
    : originalMetadata;

  const officialRaw = await askJson<QuestionSuggestion>(buildOfficialPrompt(metadata, request.instructions));
  const suggestion = normaliseQuestion(metadata, officialRaw);

  const juniorRaw = await askJson<JuniorQuestionSuggestion>(buildJuniorPrompt(metadata, suggestion));
  const juniorSuggestion = normaliseJuniorQuestion(metadata, juniorRaw);

  const version = await nextQuestionVersion(folderPath);

  const questionFileName = `question-v${version}.json`;
  const juniorQuestionFileName = `junior-question-v${version}.json`;

  const questionPath = path.join(folderPath, questionFileName);
  const juniorQuestionPath = path.join(folderPath, juniorQuestionFileName);

  await fs.writeFile(questionPath, JSON.stringify({
    generatedAtUtc: new Date().toISOString(),
    model: MODEL,
    reviewerInstructions: request.instructions,
    sourceMetadataPath: metadataPath,
    sourceQuestionPath: latestQuestionPath,
    original: {
      title: metadata.title,
      question: metadata.question,
      choices: metadata.choices,
      correctAnswers: metadata.correctAnswers,
      explanation: metadata.explanation,
    },
    suggestion,
  }, null, 2), "utf8");

  await fs.writeFile(juniorQuestionPath, JSON.stringify({
    generatedAtUtc: new Date().toISOString(),
    model: MODEL,
    reviewerInstructions: request.instructions,
    sourceQuestionFileName: questionFileName,
    juniorSuggestion,
  }, null, 2), "utf8");

  return {
    success: true,
    folderName,
    questionFileName,
    juniorQuestionFileName,
    questionPath: `/assets/${encodeURIComponent(folderName)}/${encodeURIComponent(questionFileName)}`,
    juniorQuestionPath: `/assets/${encodeURIComponent(folderName)}/${encodeURIComponent(juniorQuestionFileName)}`,
    suggestion,
    juniorSuggestion,
  };
}
