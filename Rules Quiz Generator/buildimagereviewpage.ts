import { promises as fs } from "node:fs";
import path from "node:path";

type Choice = {
  id: string;
  text: string;
};

type VocabularyItem = {
  term: string;
  simpleMeaning: string;
};

type JuniorVersion = {
  title: string;
  question: string;
  choices: Choice[];
  correctAnswers: string[];
  explanation: string;
  vocabulary: VocabularyItem[];
  teachingTip: string;
  likelyMisconceptions: string[];
};

type JuniorVersionFile = {
  juniorVersion: JuniorVersion;
};

type Metadata = {
  schemaVersion?: number;
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

type ReviewItem = {
  id: string;
  folderName: string;
  sourceImageName: string;
  sourceImagePath: string | null;
  oldImagePath: string | null;
  newImagePath: string | null;
  oldPrompt: string;
  newPrompt: string;
  metadata: Metadata;
  juniorVersion: JuniorVersion | null;
};

const OUTPUT_DIR = process.argv[2] ?? "./output";
const INPUT_DIR = process.argv[3] ?? "./input";
const REVIEW_FILE_NAME = process.argv[4] ?? "image-review.html";

const OLD_IMAGE_FILE_NAME = process.env.OLD_IMAGE_FILE_NAME ?? "illustration.png";
const NEW_IMAGE_FILE_NAME = process.env.NEW_IMAGE_FILE_NAME ?? "illustration-v2.png";
const OLD_PROMPT_FILE_NAME = process.env.OLD_PROMPT_FILE_NAME ?? "final-prompt.txt";
const NEW_PROMPT_FILE_NAME = process.env.NEW_PROMPT_FILE_NAME ?? "final-prompt-v2.txt";
const JUNIOR_FILE_NAME = process.env.JUNIOR_FILE_NAME ?? "junior-version.json";

const SUPPORTED_SOURCE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

async function latestJuniorQuestionPath(folder: string): Promise<string | null> {
  const entries = await fs.readdir(folder);

  const questions = entries
    .map((name) => {
      const match = /^junior-question-v(\d+)\.json$/i.exec(name);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((x): x is { name: string; version: number } => x !== null)
    .sort((a, b) => b.version - a.version);

  return questions.length > 0 ? path.join(folder, questions[0].name) : null;
}

async function latestQuestionPath(folder: string): Promise<string | null> {
  const entries = await fs.readdir(folder);

  const questions = entries
    .map((name) => {
      const match = /^question-v(\d+)\.json$/i.exec(name);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((x): x is { name: string; version: number } => x !== null)
    .sort((a, b) => b.version - a.version);

  return questions.length > 0 ? path.join(folder, questions[0].name) : null;
}

async function latestImagePath(folder: string): Promise<string | null> {
  const entries = await fs.readdir(folder);

  const images = entries
    .map((name) => {
      const match = /^illustration-v(\d+)\.png$/i.exec(name);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((x): x is { name: string; version: number } => x !== null)
    .sort((a, b) => b.version - a.version);

  if (images.length > 0) {
    return path.join(folder, images[0].name);
  }

  const fallback = path.join(folder, NEW_IMAGE_FILE_NAME);
  return await pathExists(fallback) ? fallback : null;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath: string): Promise<string> {
  if (!await pathExists(filePath)) {
    return "";
  }

  return fs.readFile(filePath, "utf8");
}

async function readJuniorVersionIfExists(filePath: string): Promise<JuniorVersion | null> {
  if (!await pathExists(filePath)) {
    return null;
  }

  const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as JuniorVersionFile;
  return parsed.juniorVersion ?? null;
}

function htmlEscape(value: string | undefined | null): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function jsString(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function toRelativeWebPath(fromFile: string, targetFile: string): string {
  return path.relative(path.dirname(fromFile), targetFile).split(path.sep).join("/");
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

async function findQuestionFolders(outputDir: string): Promise<string[]> {
  const entries = await fs.readdir(outputDir, { withFileTypes: true });
  const folders: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "_source-state") {
      continue;
    }

    const folderPath = path.join(outputDir, entry.name);
    const metadataPath = path.join(folderPath, "metadata.json");

    if (await pathExists(metadataPath)) {
      folders.push(folderPath);
    }
  }

  return folders.sort((a, b) => a.localeCompare(b));
}

async function resolveSourceImagePath(sourceImageName: string): Promise<string | null> {
  const directPath = path.join(INPUT_DIR, sourceImageName);

  if (await pathExists(directPath)) {
    return directPath;
  }

  const baseName = path.basename(sourceImageName, path.extname(sourceImageName));
  const entries = await fs.readdir(INPUT_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();

    if (!SUPPORTED_SOURCE_EXTENSIONS.has(ext)) {
      continue;
    }

    if (path.basename(entry.name, ext).toLowerCase() === baseName.toLowerCase()) {
      return path.join(INPUT_DIR, entry.name);
    }
  }

  return null;
}

function renderChoices(choices: Choice[], correctAnswers: string[]): string {
  const correct = new Set(correctAnswers.map((x) => x.toLowerCase()));

  return choices.map((choice) => {
    const isCorrect = correct.has(choice.id.toLowerCase());

    return `
      <li class="${isCorrect ? "choice choice--correct" : "choice"}">
        <span class="choice__id">${htmlEscape(choice.id.toUpperCase())}</span>
        <span class="choice__text">${htmlEscape(choice.text)}</span>
        ${isCorrect ? `<strong class="choice__correct">Correct</strong>` : ""}
      </li>`;
  }).join("");
}

function renderImage(label: string, imagePath: string | null, alt: string): string {
  if (!imagePath) {
    return `
      <div class="image-block image-block--missing">
        <div class="image-block__header">
          <h3>${htmlEscape(label)}</h3>
        </div>
        <div class="missing">Missing image</div>
      </div>`;
  }

  return `
    <div class="image-block">
      <div class="image-block__header">
        <h3>${htmlEscape(label)}</h3>
        <a href="${htmlEscape(imagePath)}" target="_blank" rel="noopener">Open</a>
      </div>
      <div class="image-frame">
        <div class="image-loading">Image will load when visible</div>
        <img class="lazy-image" data-src="${htmlEscape(imagePath)}" alt="${htmlEscape(alt)}">
      </div>
    </div>`;
}

function renderPrompt(title: string, prompt: string): string {
  if (!prompt.trim()) {
    return `
      <details class="prompt-box">
        <summary>${htmlEscape(title)}</summary>
        <p class="muted">No prompt file found.</p>
      </details>`;
  }

  return `
    <details class="prompt-box">
      <summary>${htmlEscape(title)}</summary>
      <p>${htmlEscape(prompt)}</p>
    </details>`;
}

function renderQuestionReview(item: ReviewItem): string {
  return `
    <section class="question-feedback" data-review-panel="${htmlEscape(item.id)}">
      <h3>Question feedback</h3>

      <fieldset>
        <legend>Question decision</legend>

        <label class="option-card">
          <input type="radio" name="questionDecision-${htmlEscape(item.id)}" value="questionAccepted" data-review-field="questionDecision">
          <span><strong>Question acceptable</strong><small>The question, answers and explanation are good.</small></span>
        </label>

        <label class="option-card">
          <input type="radio" name="questionDecision-${htmlEscape(item.id)}" value="questionNeedsWork" data-review-field="questionDecision">
          <span><strong>Question needs work</strong><small>The wording, answers or explanation need changing.</small></span>
        </label>

        <label class="option-card">
          <input type="radio" name="questionDecision-${htmlEscape(item.id)}" value="removeQuestion" data-review-field="questionDecision">
          <span><strong>Remove question</strong><small>This question should not be used.</small></span>
        </label>
      </fieldset>

      <label class="textarea-label">
        Question comments
        <textarea data-review-field="questionComments" placeholder="Describe any changes needed to the rule question, answers or explanation."></textarea>
      </label>

      <button
        type="button"
        class="suggest-question-button"
        data-question-folder="${htmlEscape(item.folderName)}"
        data-question-target="${htmlEscape(item.id)}">
        Suggest question rewrite
        </button>

      <div class="suggest-question-status" data-question-status="${htmlEscape(item.id)}"></div>

      <label class="textarea-label">
        Additional quiz questions noticed on this rules page
        <textarea data-review-field="additionalQuestionIdeas" placeholder="Add any extra quiz questions you think should exist for this rules book page."></textarea>
      </label>
    </section>`;
}

function renderJuniorVersion(item: ReviewItem): string {
  const junior = item.juniorVersion;

  if (!junior) {
    return `
      <section class="review-column junior-column">
        <div class="panel junior-panel junior-panel--missing">
          <h3>Junior friendly version</h3>
          <p class="muted">No ${htmlEscape(JUNIOR_FILE_NAME)} file found for this question.</p>
        </div>
      </section>`;
  }

  return `
    <section class="review-column junior-column">
      <div class="panel junior-panel">
        <p class="junior-label">For younger juniors</p>
        <h3>${htmlEscape(junior.title)}</h3>

        <h4>Question</h4>
        <p class="question-text junior-question">${htmlEscape(junior.question)}</p>

        <h4>Answers</h4>
        <ol class="choices">
          ${renderChoices(junior.choices, junior.correctAnswers)}
        </ol>

        <h4>Explanation</h4>
        <p>${htmlEscape(junior.explanation)}</p>

        ${junior.vocabulary.length > 0 ? `
          <h4>Words explained</h4>
          <dl class="vocabulary-list">
            ${junior.vocabulary.map((item) => `
              <div>
                <dt>${htmlEscape(item.term)}</dt>
                <dd>${htmlEscape(item.simpleMeaning)}</dd>
              </div>`).join("")}
          </dl>
        ` : ""}

        ${junior.teachingTip ? `
          <h4>Teaching tip</h4>
          <p>${htmlEscape(junior.teachingTip)}</p>
        ` : ""}

        ${junior.likelyMisconceptions.length > 0 ? `
          <details class="prompt-box">
            <summary>Likely misconceptions</summary>
            <ul class="misconceptions">
              ${junior.likelyMisconceptions.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}
            </ul>
          </details>
        ` : ""}

        <section class="junior-feedback" data-review-panel="${htmlEscape(item.id)}">
          <h4>Junior version decision</h4>

          <fieldset>
            <legend>Junior wording decision</legend>

            <label class="option-card">
              <input type="radio" name="juniorDecision-${htmlEscape(item.id)}" value="juniorAccepted" data-review-field="juniorDecision">
              <span><strong>Junior version acceptable</strong><small>The younger-junior wording is good.</small></span>
            </label>

            <label class="option-card">
              <input type="radio" name="juniorDecision-${htmlEscape(item.id)}" value="juniorNeedsWork" data-review-field="juniorDecision">
              <span><strong>Junior version needs work</strong><small>The wording is too difficult, unclear, or changes the meaning.</small></span>
            </label>
          </fieldset>

          <label class="textarea-label">
            Junior version comments
            <textarea data-review-field="juniorComments" placeholder="Describe any changes needed to the junior friendly wording."></textarea>
          </label>
        </section>
      </div>
    </section>`;
}

function renderImageReview(item: ReviewItem): string {
  return `
    <section class="image-feedback" data-review-panel="${htmlEscape(item.id)}">
      <h3>Image decision</h3>

      <fieldset>
        <label class="option-card">
          <input type="radio" name="imageDecision-${htmlEscape(item.id)}" value="oldAccepted" data-review-field="imageDecision">
          <span><strong>Use old image</strong><small>The original generated image is acceptable.</small></span>
        </label>

        <label class="option-card">
          <input type="radio" name="imageDecision-${htmlEscape(item.id)}" value="newAccepted" data-review-field="imageDecision">
          <span><strong>Use new image</strong><small>The regenerated image is acceptable.</small></span>
        </label>

        <label class="option-card">
          <input type="radio" name="imageDecision-${htmlEscape(item.id)}" value="bothAcceptable" data-review-field="imageDecision">
          <span><strong>Both acceptable</strong><small>Either image could be used.</small></span>
        </label>

        <label class="option-card">
          <input type="radio" name="imageDecision-${htmlEscape(item.id)}" value="regenerate" data-review-field="imageDecision">
          <span><strong>Regenerate completely</strong><small>The image needs another attempt.</small></span>
        </label>
      </fieldset>

      <label class="textarea-label">
        Image regeneration comments
        <textarea data-review-field="imageRegenerationComments" placeholder="Describe what is wrong with the image and how it should be regenerated."></textarea>
      </label>

      <button
        type="button"
        class="regenerate-image-button"
        data-regenerate-folder="${htmlEscape(item.folderName)}"
        data-regenerate-target="${htmlEscape(item.id)}">
        Regenerate image
        </button>

      <div class="regenerate-status" data-regenerate-status="${htmlEscape(item.id)}"></div>

      <div class="review-status" data-review-status="${htmlEscape(item.id)}">Not reviewed</div>
    </section>`;
}

function renderItem(item: ReviewItem): string {
  return `
    <article class="question-card" id="${htmlEscape(item.id)}" data-item-id="${htmlEscape(item.id)}">
      <header class="question-card__header">
        <div>
          <p class="source">${htmlEscape(item.metadata.sourceImageName)}</p>
          <p class="rule">${htmlEscape(item.metadata.ruleNumber)} — ${htmlEscape(item.metadata.ruleName)}</p>
          <h2>${htmlEscape(item.metadata.title)}</h2>
        </div>
        <a class="jump-link" href="#top">Back to top</a>
      </header>

      <div class="review-grid">
        <section class="review-column question-column">
          <div class="panel">
            <h3>Original question</h3>
            <p class="question-text">${htmlEscape(item.metadata.question)}</p>

            <h3>Answers</h3>
            <ol class="choices">
              ${renderChoices(item.metadata.choices, item.metadata.correctAnswers)}
            </ol>

            <h3>Explanation</h3>
            <p>${htmlEscape(item.metadata.explanation)}</p>

            ${renderQuestionReview(item)}
          </div>
        </section>

        ${renderJuniorVersion(item)}
 
        <section class="review-column old-image-column" style="display: none;">
           <div class="panel">
             ${renderImage("Old generated image", item.oldImagePath, item.metadata.imageAlt ?? item.metadata.title)}
             ${renderPrompt("Old image prompt", item.oldPrompt || item.metadata.imagePrompt)}
           </div>
         </section>
         

        <section class="review-column new-image-column">
          <div class="panel">
            ${renderImage("New generated image", item.newImagePath, item.metadata.imageAlt ?? item.metadata.title)}
            ${renderPrompt("New image prompt", item.newPrompt)}
            ${renderImageReview(item)}
          </div>
        </section>

         <section class="review-column source-column">
          <div class="panel">
            ${renderImage("Original rules book page", item.sourceImagePath, item.metadata.sourceImageName)}
          </div>
        </section>
      </div>
    </article>`;
}

async function buildReviewItems(folders: string[], reviewFilePath: string): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];

  for (const folder of folders) {
    const folderName = path.basename(folder);
    const metadataPath = path.join(folder, "metadata.json");
    const originalMetadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Metadata;
    const latestQuestionFile = await latestQuestionPath(folder);
    const latestJuniorQuestionFile = await latestJuniorQuestionPath(folder);

    const latestJuniorQuestion = latestJuniorQuestionFile
    ? JSON.parse(await fs.readFile(latestJuniorQuestionFile, "utf8")).juniorSuggestion
    : null;

    const latestQuestion = latestQuestionFile
    ? JSON.parse(await fs.readFile(latestQuestionFile, "utf8")).suggestion
    : null;

    const metadata: Metadata = latestQuestion
    ? {
        ...originalMetadata,
        title: latestQuestion.title,
        question: latestQuestion.question,
        choices: latestQuestion.choices,
        correctAnswers: latestQuestion.correctAnswers,
        explanation: latestQuestion.explanation,
        }
    : originalMetadata;

    const oldImagePath = path.join(folder, OLD_IMAGE_FILE_NAME);
    const newImagePath = path.join(folder, NEW_IMAGE_FILE_NAME);
    const oldPromptPath = path.join(folder, OLD_PROMPT_FILE_NAME);
    const newPromptPath = path.join(folder, NEW_PROMPT_FILE_NAME);
    const juniorPath = path.join(folder, JUNIOR_FILE_NAME);
    const sourceImagePath = await resolveSourceImagePath(metadata.sourceImageName);

    items.push({
      id: slugify(folderName),
      folderName,
      sourceImageName: metadata.sourceImageName,
      sourceImagePath: sourceImagePath ? toRelativeWebPath(reviewFilePath, sourceImagePath) : null,
      oldImagePath: await pathExists(oldImagePath) ? toRelativeWebPath(reviewFilePath, oldImagePath) : null,
      newImagePath: await latestImagePath(folder).then((latest) =>
        latest ? toRelativeWebPath(reviewFilePath, latest) : null
      ),
      oldPrompt: await readTextIfExists(oldPromptPath),
      newPrompt: await latestPromptPath(folder).then((latest) =>
        latest ? readTextIfExists(latest) : ""
     ),
      metadata,
      juniorVersion: latestJuniorQuestion ?? await readJuniorVersionIfExists(juniorPath),
    });
  }

  return items;
}

async function latestPromptPath(folder: string): Promise<string | null> {
  const entries = await fs.readdir(folder);

  const prompts = entries
    .map((name) => {
      const match = /^final-prompt-v(\d+)\.txt$/i.exec(name);
      return match ? { name, version: Number(match[1]) } : null;
    })
    .filter((x): x is { name: string; version: number } => x !== null)
    .sort((a, b) => b.version - a.version);

  if (prompts.length > 0) {
    return path.join(folder, prompts[0].name);
  }

  const fallback = path.join(folder, NEW_PROMPT_FILE_NAME);
  return await pathExists(fallback) ? fallback : null;
}

function buildNavigation(items: ReviewItem[]): string {
  return items.map((item, index) => `
    <a class="nav-item" href="#${htmlEscape(item.id)}" data-nav-item="${htmlEscape(item.id)}">
      <span>${index + 1}</span>
      <strong>${htmlEscape(item.metadata.title)}</strong>
      <small>${htmlEscape(item.metadata.ruleNumber)} — ${htmlEscape(item.metadata.ruleName)}</small>
    </a>`).join("");
}

function buildHtml(items: ReviewItem[]): string {
  const content = items.map(renderItem).join("\n");
  const nav = buildNavigation(items);

  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Golf Rules Quiz Review</title>
  <style>
    :root {
      --bg: #eef2f7;
      --panel: #ffffff;
      --panel-soft: #f8fafc;
      --border: #d6dde8;
      --border-strong: #9aa8bb;
      --text: #111827;
      --muted: #5b6472;
      --brand: #123c69;
      --brand-soft: #e8f1fb;
      --junior: #7c2d12;
      --junior-soft: #fff7ed;
      --good: #166534;
      --good-bg: #ecfdf5;
      --warning: #92400e;
      --warning-bg: #fffbeb;
      --shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
      --radius: 16px;
    }

    * {
      box-sizing: border-box;
    }

    html {
      scroll-behaviour: smooth;
    }

    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }

    a {
      color: var(--brand);
    }

    .page-shell {
      display: grid;
      grid-template-columns: 340px 1fr;
      min-height: 100vh;
    }

    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      overflow: auto;
      background: #0f172a;
      color: white;
      padding: 1.25rem;
    }

    .sidebar h1 {
      margin: 0 0 0.5rem;
      font-size: 1.35rem;
      line-height: 1.2;
    }

    .sidebar p {
      margin: 0 0 1rem;
      color: #cbd5e1;
      font-size: 0.95rem;
    }

    .toolbar {
      display: grid;
      gap: 0.6rem;
      margin: 1rem 0;
    }

    .toolbar button {
      width: 100%;
      border: 0;
      border-radius: 10px;
      padding: 0.75rem 0.9rem;
      cursor: pointer;
      background: #e2e8f0;
      color: #0f172a;
      font-weight: 700;
    }

    .toolbar button.primary {
      background: #38bdf8;
      color: #082f49;
    }

    .filter-bar,
    .sort-bar {
      display: grid;
      gap: 0.45rem;
      margin-top: 1rem;
      padding: 0.85rem;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.08);
    }

    .filter-bar label,
    .sort-bar label {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.9rem;
      color: #e2e8f0;
    }

    .sort-bar strong {
      color: #e2e8f0;
      font-size: 0.9rem;
    }

    .global-feedback {
      margin-top: 1rem;
      padding: 0.85rem;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.08);
    }

    .global-feedback label {
      display: grid;
      gap: 0.45rem;
      color: #e2e8f0;
      font-weight: 700;
    }

    .global-feedback textarea {
      min-height: 140px;
      width: 100%;
      resize: vertical;
      font: inherit;
      border: 1px solid #64748b;
      border-radius: 10px;
      padding: 0.75rem;
      background: #f8fafc;
      color: #111827;
    }

    .suggest-question-button {
        width: 100%;
        margin-top: 0.85rem;
        border: 0;
        border-radius: 10px;
        padding: 0.75rem 0.9rem;
        cursor: pointer;
        background: #123c69;
        color: white;
        font-weight: 800;
        }

        .suggest-question-button:disabled {
        cursor: wait;
        opacity: 0.65;
        }

        .suggest-question-status {
        margin-top: 0.6rem;
        color: var(--muted);
        font-size: 0.9rem;
        font-weight: 700;
        }

        .question-suggestion-box {
        margin-top: 1rem;
        padding: 0.85rem;
        border: 1px solid var(--border);
        border-radius: 12px;
        background: white;
        }

        .question-suggestion-box h4 {
        margin-top: 0;
        }

        .question-suggestion-box pre {
        white-space: pre-wrap;
        word-break: break-word;
        font: inherit;
        }

    .regenerate-image-button {
        width: 100%;
        margin-top: 0.85rem;
        border: 0;
        border-radius: 10px;
        padding: 0.75rem 0.9rem;
        cursor: pointer;
        background: #123c69;
        color: white;
        font-weight: 800;
        }

        .regenerate-image-button:disabled {
        cursor: wait;
        opacity: 0.65;
        }

        .regenerate-status {
        margin-top: 0.6rem;
        color: var(--muted);
        font-size: 0.9rem;
        font-weight: 700;
        }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.6rem;
      margin: 1rem 0;
    }

    .summary-card {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 12px;
      padding: 0.75rem;
    }

    .summary-card strong {
      display: block;
      font-size: 1.25rem;
    }

    .summary-card span {
      display: block;
      color: #cbd5e1;
      font-size: 0.8rem;
    }

    .nav-list {
      display: grid;
      gap: 0.45rem;
      margin-top: 1rem;
    }

    .nav-item {
      display: grid;
      grid-template-columns: 2rem 1fr;
      gap: 0.55rem;
      text-decoration: none;
      padding: 0.65rem;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.06);
      color: white;
      border: 1px solid transparent;
    }

    .nav-item:hover,
    .nav-item:focus {
      border-color: #38bdf8;
      background: rgba(56, 189, 248, 0.14);
      outline: none;
    }

    .nav-item.is-reviewed {
      border-color: rgba(34, 197, 94, 0.6);
    }

    .nav-item.needs-work {
      border-color: rgba(245, 158, 11, 0.75);
    }

    .nav-item span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.14);
      font-weight: 700;
    }

    .nav-item strong {
      display: block;
      font-size: 0.9rem;
      line-height: 1.2;
    }

    .nav-item small {
      display: block;
      color: #cbd5e1;
      margin-top: 0.2rem;
    }

    main {
      min-width: 0;
      padding: 2rem;
    }

    .top-banner {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 1.25rem 1.5rem;
      margin-bottom: 2rem;
    }

    .top-banner h2 {
      margin: 0 0 0.4rem;
      font-size: 1.6rem;
    }

    .top-banner p {
      margin: 0;
      color: var(--muted);
    }

    .question-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 1.5rem;
      margin-bottom: 2rem;
      content-visibility: auto;
      contain-intrinsic-size: 1000px;
    }

    .question-card.is-hidden {
      display: none;
    }

    .question-card__header {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
      margin-bottom: 1.25rem;
    }

    .source {
      margin: 0 0 0.25rem;
      color: var(--muted);
      font-size: 0.9rem;
      font-weight: 700;
    }

    .rule {
      margin: 0 0 0.35rem;
      color: var(--brand);
      font-size: 0.98rem;
      font-weight: 800;
    }

    h2 {
      margin: 0;
      font-size: 1.45rem;
      line-height: 1.25;
    }

    h3 {
      margin: 1rem 0 0.5rem;
      font-size: 1rem;
    }

    h4 {
      margin: 1rem 0 0.4rem;
      font-size: 0.95rem;
    }

    .jump-link {
      white-space: nowrap;
      font-weight: 700;
      text-decoration: none;
    }

    .review-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 1rem;
      align-items: start;
    }

    .panel {
      background: var(--panel-soft);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 1rem;
      min-width: 0;
    }

    .junior-panel {
      background: var(--junior-soft);
      border-color: #fed7aa;
    }

    .junior-label {
      display: inline-block;
      margin: 0 0 0.5rem;
      padding: 0.25rem 0.5rem;
      border-radius: 999px;
      background: #fed7aa;
      color: var(--junior);
      font-size: 0.8rem;
      font-weight: 800;
    }

    .question-text {
      font-size: 1.1rem;
      font-weight: 700;
    }

    .junior-question {
      color: var(--junior);
    }

    .choices {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 0.5rem;
    }

    .choice {
      display: grid;
      grid-template-columns: 2rem 1fr auto;
      gap: 0.65rem;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.7rem;
      background: white;
    }

    .choice--correct {
      border-color: #22c55e;
      background: var(--good-bg);
    }

    .choice__id {
      width: 2rem;
      height: 2rem;
      border-radius: 999px;
      display: inline-flex;
      justify-content: center;
      align-items: center;
      background: #e5e7eb;
      font-weight: 800;
    }

    .choice--correct .choice__id {
      background: #bbf7d0;
      color: var(--good);
    }

    .choice__correct {
      color: var(--good);
      font-size: 0.85rem;
    }

    .vocabulary-list {
      display: grid;
      gap: 0.5rem;
      margin: 0;
    }

    .vocabulary-list div {
      background: #ffffff;
      border: 1px solid #fed7aa;
      border-radius: 10px;
      padding: 0.65rem;
    }

    .vocabulary-list dt {
      font-weight: 800;
      color: var(--junior);
    }

    .vocabulary-list dd {
      margin: 0.2rem 0 0;
    }

    .misconceptions {
      margin: 0.75rem 0 0;
      padding-left: 1.2rem;
    }

    fieldset {
      border: 0;
      padding: 0;
      margin: 0 0 1rem;
      display: grid;
      gap: 0.5rem;
    }

    legend {
      font-weight: 800;
      margin-bottom: 0.35rem;
    }

    .option-card {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.7rem;
      align-items: start;
      background: white;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.75rem;
      cursor: pointer;
    }

    .option-card:hover {
      border-color: var(--brand);
      background: var(--brand-soft);
    }

    .option-card input {
      width: 1.25rem;
      height: 1.25rem;
      margin-top: 0.1rem;
    }

    .option-card strong,
    .option-card small {
      display: block;
    }

    .option-card small {
      color: var(--muted);
      margin-top: 0.15rem;
    }

    .textarea-label {
      display: grid;
      gap: 0.35rem;
      margin-top: 0.85rem;
      font-weight: 800;
    }

    textarea {
      width: 100%;
      min-height: 90px;
      resize: vertical;
      font: inherit;
      border: 1px solid var(--border-strong);
      border-radius: 10px;
      padding: 0.75rem;
      background: white;
    }

    .review-status {
      margin-top: 1rem;
      border-radius: 999px;
      padding: 0.45rem 0.7rem;
      background: #e5e7eb;
      color: #374151;
      font-weight: 800;
      text-align: center;
    }

    .create-question-box {
  margin-top: 1rem;
  padding: 0.85rem;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
}

.create-question-box label {
  display: grid;
  gap: 0.45rem;
  color: #e2e8f0;
  font-weight: 700;
  font-size: 0.9rem;
}

.create-question-box textarea {
  width: 100%;
  min-height: 150px;
  resize: vertical;
  font: inherit;
  border: 1px solid #64748b;
  border-radius: 10px;
  padding: 0.75rem;
  background: #f8fafc;
  color: #111827;
}

.create-question-box button {
  width: 100%;
  margin-top: 0.75rem;
  border: 0;
  border-radius: 10px;
  padding: 0.75rem 0.9rem;
  cursor: pointer;
  background: #38bdf8;
  color: #082f49;
  font-weight: 800;
}

.create-question-box button:disabled {
  cursor: wait;
  opacity: 0.65;
}

#create-question-status {
  margin-top: 0.6rem;
  color: #cbd5e1;
  font-size: 0.9rem;
  font-weight: 700;
}

    .review-status.is-reviewed {
      background: var(--good-bg);
      color: var(--good);
    }

    .review-status.needs-work {
      background: var(--warning-bg);
      color: var(--warning);
    }

    .image-block {
      min-width: 0;
    }

    .image-block__header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 1rem;
      margin-bottom: 0.75rem;
    }

    .image-block__header h3 {
      margin: 0;
    }

    .image-frame {
      position: relative;
      min-height: 280px;
      border-radius: 10px;
      background: #f1f5f9;
      border: 1px solid var(--border);
      overflow: hidden;
    }

    .search-bar {
        margin-top: 1rem;
        padding: 0.85rem;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.08);
        }

        .search-bar label {
        display: grid;
        gap: 0.45rem;
        color: #e2e8f0;
        font-weight: 700;
        font-size: 0.9rem;
        }

        .search-bar input {
        width: 100%;
        border: 1px solid #64748b;
        border-radius: 10px;
        padding: 0.65rem 0.75rem;
        font: inherit;
        }

    .image-loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      font-weight: 800;
      padding: 1rem;
      text-align: center;
    }

    .image-frame img {
      position: relative;
      z-index: 2;
      display: block;
      width: 100%;
      height: auto;
      border-radius: 10px;
      background: white;
      opacity: 0;
      transition: opacity 180ms ease;
    }

    .image-frame img.is-loaded {
      opacity: 1;
    }

    .missing {
      min-height: 240px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px dashed var(--border-strong);
      border-radius: 10px;
      color: var(--muted);
      background: #f1f5f9;
      font-weight: 800;
    }

    .prompt-box {
      margin-top: 1rem;
      background: white;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 0.75rem;
    }

    .prompt-box summary {
      cursor: pointer;
      font-weight: 800;
    }

    .prompt-box p {
      color: #374151;
      font-size: 0.92rem;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .muted {
      color: var(--muted);
    }

    .question-feedback,
    .image-feedback,
    .junior-feedback {
      margin-top: 1.25rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
    }

    .save-indicator {
      position: fixed;
      right: 1rem;
      bottom: 1rem;
      z-index: 20;
      background: #0f172a;
      color: white;
      border-radius: 999px;
      padding: 0.65rem 0.95rem;
      box-shadow: var(--shadow);
      font-weight: 800;
      opacity: 0;
      transform: translateY(12px);
      transition: opacity 180ms ease, transform 180ms ease;
    }

    .save-indicator.is-visible {
      opacity: 1;
      transform: translateY(0);
    }

    @media (min-width: 1150px) {
      .review-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (min-width: 1700px) {
      .review-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }

      .question-column {
        grid-column: 1;
      }

      .junior-column {
        grid-column: 2;
      }

      .source-column {
        grid-column: 4;
      }

      .old-image-column {
        grid-column: 5;
      }

      .new-image-column {
        grid-column: 3;
      }
    }

    @media (min-width: 2400px) {
    .review-grid {
            grid-template-columns:
            minmax(400px, 0.95fr)
            minmax(400px, 0.95fr)
            minmax(500px, 1.1fr)
            minmax(430px, 1fr);
     }

      .image-frame {
        min-height: 360px;
      }
    }

    @media (max-width: 1199px) {
      .page-shell {
        grid-template-columns: 1fr;
      }

      .sidebar {
        position: relative;
        height: auto;
      }

      .nav-list {
        max-height: 320px;
        overflow: auto;
      }
    }

    @media (max-width: 900px) {
      main {
        padding: 1rem;
      }

      .question-card__header {
        display: grid;
      }
    }
  </style>
</head>
<body>
  <div class="page-shell" id="top">
    <aside class="sidebar">
      <h1>Quiz image review</h1>
      <p>Review the original question, junior wording, source page, old image and regenerated image. Your choices autosave in this browser.</p>

      <div class="summary-grid">
        <div class="summary-card"><strong id="summary-total">${items.length}</strong><span>Total</span></div>
        <div class="summary-card"><strong id="summary-reviewed">0</strong><span>Reviewed</span></div>
        <div class="summary-card"><strong id="summary-regenerate">0</strong><span>Regenerate</span></div>
        <div class="summary-card"><strong id="summary-question-work">0</strong><span>Question work</span></div>
      </div>

      <div class="toolbar">
        <button class="primary" type="button" id="export-json">Export feedback JSON</button>
        <button type="button" id="import-json">Import feedback JSON</button>
        <button type="button" id="export-csv">Export feedback CSV</button>
        <button type="button" id="clear-feedback">Clear saved feedback</button>

        <input
            type="file"
            id="import-json-file"
            accept=".json,application/json"
            style="display:none">
      </div>

      <div class="search-bar">
        <label>
            Search questions and answers
            <input id="review-search" type="search" placeholder="e.g. bunker, relief, penalty">
        </label>
      </div>

      <div class="filter-bar">
        <label><input type="radio" name="reviewFilter" value="all" checked> Show all</label>
        <label><input type="radio" name="reviewFilter" value="unreviewed"> Unreviewed only</label>
        <label><input type="radio" name="reviewFilter" value="needsWork"> Needs work only</label>
        <label><input type="radio" name="reviewFilter" value="regenerate"> Regenerate only</label>
        <label><input type="radio" name="reviewFilter" value="questionWork"> Question work only</label>
      </div>

      <div class="sort-bar">
        <strong>Sort by</strong>
        <label><input type="radio" name="reviewSort" value="default" checked> Current order</label>
        <label><input type="radio" name="reviewSort" value="sourcePage"> Rules book page</label>
      </div>

      <div class="create-question-box">
        <label>
            Create quiz from rule description
            <textarea id="create-question-description" placeholder="Paste or type the rule situation here."></textarea>
        </label>

        <button type="button" id="create-question-button">
            Create quiz question
        </button>

        <div id="create-question-status"></div>
      </div>

      <!--
      <div class="global-feedback">
        <label>
          Overall review comments
          <textarea id="global-comments" placeholder="General comments about the whole batch, recurring image problems, prompt strategy, rule quality, or anything that applies across multiple questions."></textarea>
        </label>
      </div>
      -->

      <nav class="nav-list" aria-label="Questions">
        ${nav}
      </nav>
    </aside>

    <main>
      <section class="top-banner">
        <h2>Golf Rules Quiz Review</h2>
        <p>Column 1 contains the original question. Column 2 contains the junior friendly version. Column 3 contains the rules book page. Column 4 contains the old image. Column 5 contains the new image and image decision.</p>
      </section>

      ${content}
    </main>
  </div>

  <div class="save-indicator" id="save-indicator">Saved</div>

  <script>
    const reviewItems = ${jsString(items.map((item, index) => ({
      id: item.id,
      originalIndex: index,
      folderName: item.folderName,
      sourceImageName: item.sourceImageName,
      ruleNumber: item.metadata.ruleNumber,
      ruleName: item.metadata.ruleName,
      title: item.metadata.title,
      question: item.metadata.question,
      searchText: [
        item.metadata.title,
        item.metadata.question,
        item.metadata.explanation,
        ...item.metadata.choices.map((choice) => choice.text),
        item.juniorVersion?.title ?? "",
        item.juniorVersion?.question ?? "",
        item.juniorVersion?.explanation ?? "",
        ...(item.juniorVersion?.choices.map((choice) => choice.text) ?? []),
        ].join(" ").toLowerCase(),
    })))};

    const storageKey = "golf-rules-quiz-image-review-v2";
    const globalCommentsKey = "golf-rules-quiz-image-review-global-comments-v1";
    const saveIndicator = document.getElementById("save-indicator");

    function loadState() {
      try {
        const raw = localStorage.getItem(storageKey);
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    }

    function saveState(state) {
      localStorage.setItem(storageKey, JSON.stringify(state));
      showSaved();
    }

    function showSaved() {
      saveIndicator.classList.add("is-visible");
      window.clearTimeout(showSaved.timeoutId);
      showSaved.timeoutId = window.setTimeout(() => {
        saveIndicator.classList.remove("is-visible");
      }, 900);
    }

    function getItemState(itemId) {
      const state = loadState();
      return state[itemId] ?? {};
    }

    function updateItemState(itemId, patch) {
      const state = loadState();
      state[itemId] = {
        ...(state[itemId] ?? {}),
        ...patch,
        itemId,
        updatedAtUtc: new Date().toISOString(),
      };
      saveState(state);
      updateSummary();
      updateVisualState(itemId);
      applyCurrentFilter();
    }

    function fieldValue(element) {
      if (element.type === "radio") {
        return element.checked ? element.value : null;
      }

      return element.value;
    }

    function restoreFormState() {
      const state = loadState();

      for (const item of reviewItems) {
        const itemState = state[item.id] ?? {};
        const panels = document.querySelectorAll('[data-review-panel="' + item.id + '"]');

        for (const panel of panels) {
          const fields = panel.querySelectorAll("[data-review-field]");

          for (const field of fields) {
            const fieldName = field.getAttribute("data-review-field");

            if (!(fieldName in itemState)) {
              continue;
            }

            if (field.type === "radio") {
              field.checked = field.value === itemState[fieldName];
            } else {
              field.value = itemState[fieldName] ?? "";
            }
          }
        }

        updateVisualState(item.id);
      }

      updateSummary();
      applyCurrentFilter();
    }

    function attachAutosave() {
      document.querySelectorAll("[data-review-panel]").forEach((panel) => {
        const itemId = panel.getAttribute("data-review-panel");

        panel.addEventListener("input", (event) => {
          const target = event.target;

          if (!target || !target.getAttribute) {
            return;
          }

          const fieldName = target.getAttribute("data-review-field");

          if (!fieldName) {
            return;
          }

          const value = fieldValue(target);

          if (value === null) {
            return;
          }

          updateItemState(itemId, {
            [fieldName]: value,
          });
        });

        panel.addEventListener("change", (event) => {
          const target = event.target;

          if (!target || !target.getAttribute) {
            return;
          }

          const fieldName = target.getAttribute("data-review-field");

          if (!fieldName) {
            return;
          }

          const value = fieldValue(target);

          if (value === null) {
            return;
          }

          updateItemState(itemId, {
            [fieldName]: value,
          });
        });
      });
    }

    function attachGlobalCommentsAutosave() {
      const globalComments = document.getElementById("global-comments");

      if (!globalComments) {
        return;
      }

      const savedValue = localStorage.getItem(globalCommentsKey) ?? "";

      globalComments.value = savedValue;
      globalComments.textContent = savedValue;

      globalComments.addEventListener("input", () => {
        localStorage.setItem(globalCommentsKey, globalComments.value);
        globalComments.textContent = globalComments.value;
        showSaved();
      });

      globalComments.addEventListener("change", () => {
        localStorage.setItem(globalCommentsKey, globalComments.value);
        globalComments.textContent = globalComments.value;
        showSaved();
      });
    }

    function getGlobalComments() {
      const globalComments = document.getElementById("global-comments");
      return globalComments ? globalComments.value : "";
    }

    function isReviewed(itemState) {
      return Boolean(
        itemState.imageDecision ||
        itemState.questionDecision ||
        itemState.juniorDecision ||
        itemState.imageRegenerationComments ||
        itemState.questionComments ||
        itemState.juniorComments ||
        itemState.additionalQuestionIdeas
      );
    }

    function needsWork(itemState) {
      return itemState.imageDecision === "regenerate"
        || itemState.questionDecision === "questionNeedsWork"
        || itemState.questionDecision === "removeQuestion"
        || itemState.juniorDecision === "juniorNeedsWork";
    }

    function updateVisualState(itemId) {
      const state = getItemState(itemId);
      const status = document.querySelector('[data-review-status="' + itemId + '"]');
      const navItem = document.querySelector('[data-nav-item="' + itemId + '"]');

      if (status) {
        status.classList.remove("is-reviewed", "needs-work");

        if (needsWork(state)) {
          status.textContent = "Needs work";
          status.classList.add("needs-work");
        } else if (isReviewed(state)) {
          status.textContent = "Reviewed";
          status.classList.add("is-reviewed");
        } else {
          status.textContent = "Not reviewed";
        }
      }

      if (navItem) {
        navItem.classList.remove("is-reviewed", "needs-work");

        if (needsWork(state)) {
          navItem.classList.add("needs-work");
        } else if (isReviewed(state)) {
          navItem.classList.add("is-reviewed");
        }
      }
    }

    function updateSummary() {
      const state = loadState();
      let reviewed = 0;
      let regenerate = 0;
      let questionWork = 0;

      for (const item of reviewItems) {
        const itemState = state[item.id] ?? {};

        if (isReviewed(itemState)) {
          reviewed += 1;
        }

        if (itemState.imageDecision === "regenerate") {
          regenerate += 1;
        }

        if (
          itemState.questionDecision === "questionNeedsWork" ||
          itemState.questionDecision === "removeQuestion" ||
          itemState.juniorDecision === "juniorNeedsWork"
        ) {
          questionWork += 1;
        }
      }

      document.getElementById("summary-reviewed").textContent = String(reviewed);
      document.getElementById("summary-regenerate").textContent = String(regenerate);
      document.getElementById("summary-question-work").textContent = String(questionWork);
    }

    function itemMatchesFilter(itemId, filter) {
      const itemState = getItemState(itemId);
      const search = document.getElementById("review-search");
      const searchTerm = search ? search.value.trim().toLowerCase() : "";
      const item = reviewItems.find((x) => x.id === itemId);

      if (searchTerm && (!item || !item.searchText.includes(searchTerm))) {
        return false;
      }

      if (filter === "all") {
        return true;
      }

      if (filter === "unreviewed") {
        return !isReviewed(itemState);
      }

      if (filter === "needsWork") {
        return needsWork(itemState);
      }

      if (filter === "regenerate") {
        return itemState.imageDecision === "regenerate";
      }

      if (filter === "questionWork") {
        return itemState.questionDecision === "questionNeedsWork"
          || itemState.questionDecision === "removeQuestion"
          || itemState.juniorDecision === "juniorNeedsWork";
      }

      return true;
    }

    function getCurrentSortMode() {
      const selected = document.querySelector('input[name="reviewSort"]:checked');
      return selected ? selected.value : "default";
    }

    function sortedReviewItems() {
      const mode = getCurrentSortMode();
      const copy = [...reviewItems];

      if (mode === "sourcePage") {
        copy.sort((a, b) =>
          a.sourceImageName.localeCompare(b.sourceImageName, undefined, { numeric: true, sensitivity: "base" }) ||
          a.ruleNumber.localeCompare(b.ruleNumber, undefined, { numeric: true, sensitivity: "base" }) ||
          a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" })
        );

        return copy;
      }

      copy.sort((a, b) => a.originalIndex - b.originalIndex);
      return copy;
    }

    function applyCurrentSort() {
      const sorted = sortedReviewItems();
      const main = document.querySelector("main");
      const navList = document.querySelector(".nav-list");

      if (!main || !navList) {
        return;
      }

      for (const item of sorted) {
        const card = document.querySelector('[data-item-id="' + item.id + '"]');
        const navItem = document.querySelector('[data-nav-item="' + item.id + '"]');

        if (card) {
          main.appendChild(card);
        }

        if (navItem) {
          navList.appendChild(navItem);
        }
      }
    }

    function applyCurrentFilter() {
      const selected = document.querySelector('input[name="reviewFilter"]:checked');
      const filter = selected ? selected.value : "all";

      for (const item of reviewItems) {
        const card = document.querySelector('[data-item-id="' + item.id + '"]');
        const navItem = document.querySelector('[data-nav-item="' + item.id + '"]');
        const visible = itemMatchesFilter(item.id, filter);

        if (card) {
          card.classList.toggle("is-hidden", !visible);
        }

        if (navItem) {
          navItem.style.display = visible ? "" : "none";
        }
      }
    }

    function buildExportRows() {
      const state = loadState();

      return reviewItems.map((item) => {
        const itemState = state[item.id] ?? {};

        return {
          itemId: item.id,
          folderName: item.folderName,
          sourceImageName: item.sourceImageName,
          ruleNumber: item.ruleNumber,
          ruleName: item.ruleName,
          title: item.title,
          question: item.question,
          imageDecision: itemState.imageDecision ?? "",
          questionDecision: itemState.questionDecision ?? "",
          juniorDecision: itemState.juniorDecision ?? "",
          imageRegenerationComments: itemState.imageRegenerationComments ?? "",
          questionComments: itemState.questionComments ?? "",
          juniorComments: itemState.juniorComments ?? "",
          additionalQuestionIdeas: itemState.additionalQuestionIdeas ?? "",
          updatedAtUtc: itemState.updatedAtUtc ?? "",
        };
      });
    }

    function downloadText(fileName, content, mimeType) {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(url);
    }

    function csvEscape(value) {
      return '"' + String(value ?? "").replace(/"/g, '""') + '"';
    }

    function exportJson() {
      const rows = buildExportRows();

      downloadText(
        "quiz-image-review-feedback.json",
        JSON.stringify({
          exportedAtUtc: new Date().toISOString(),
          totalItems: rows.length,
          overallComments: getGlobalComments(),
          items: rows,
        }, null, 2),
        "application/json"
      );
    }

    async function importJson(file) {

        const text = await file.text();
        const json = JSON.parse(text);

        if (!json.items || !Array.isArray(json.items)) {
            alert("This does not appear to be a review export.");
            return;
        }

        const state = {};

        for (const item of json.items) {

            state[item.itemId] = {
                itemId: item.itemId,
                imageDecision: item.imageDecision,
                questionDecision: item.questionDecision,
                juniorDecision: item.juniorDecision,
                imageRegenerationComments: item.imageRegenerationComments,
                questionComments: item.questionComments,
                juniorComments: item.juniorComments,
                additionalQuestionIdeas: item.additionalQuestionIdeas,
                updatedAtUtc: item.updatedAtUtc
            };

        }

        localStorage.setItem(storageKey, JSON.stringify(state));

        if (json.overallComments) {
            localStorage.setItem(globalCommentsKey, json.overallComments);
        }

        alert("Review imported successfully.");

        location.reload();
    }

    function exportCsv() {
      const rows = buildExportRows();
      const headers = [
        "Item Id",
        "Folder Name",
        "Source Image Name",
        "Rule Number",
        "Rule Name",
        "Title",
        "Question",
        "Image Decision",
        "Question Decision",
        "Junior Decision",
        "Image Regeneration Comments",
        "Question Comments",
        "Junior Comments",
        "Additional Question Ideas",
        "Updated At UTC",
      ];

      const csv = [
        headers.map(csvEscape).join(","),
        ...rows.map((row) => [
          row.itemId,
          row.folderName,
          row.sourceImageName,
          row.ruleNumber,
          row.ruleName,
          row.title,
          row.question,
          row.imageDecision,
          row.questionDecision,
          row.juniorDecision,
          row.imageRegenerationComments,
          row.questionComments,
          row.juniorComments,
          row.additionalQuestionIdeas,
          row.updatedAtUtc,
        ].map(csvEscape).join(",")),
      ].join("\\n");

      downloadText("quiz-image-review-feedback.csv", csv, "text/csv");
    }

    function initialiseLazyImages() {
      const images = Array.from(document.querySelectorAll("img.lazy-image"));

      if (!("IntersectionObserver" in window)) {
        for (const image of images) {
          loadImage(image);
        }

        return;
      }

      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }

          loadImage(entry.target);
          observer.unobserve(entry.target);
        }
      }, {
        rootMargin: "900px 0px",
        threshold: 0.01,
      });

      for (const image of images) {
        observer.observe(image);
      }
    }

    function renderQuestionSuggestion(result) {
        const suggestion = result.suggestion ?? result.questionSuggestion ?? result;

        const lines = [];

        lines.push("TITLE:");
        lines.push(suggestion.title ?? "");
        lines.push("");
        lines.push("QUESTION:");
        lines.push(suggestion.question ?? "");
        lines.push("");
        lines.push("ANSWERS:");

        (suggestion.choices ?? []).forEach((choice) => {
            lines.push(String(choice.id).toUpperCase() + ". " + choice.text);
        });

        lines.push("");
        lines.push("CORRECT:");
        lines.push((suggestion.correctAnswers ?? []).join(", "));
        lines.push("");
        lines.push("EXPLANATION:");
        lines.push(suggestion.explanation ?? "");

        return lines.join("\\n");
    }

    async function suggestQuestionRewrite(button) {
        const itemId = button.getAttribute("data-question-target");
        const folderName = button.getAttribute("data-question-folder");
        const status = document.querySelector('[data-question-status="' + itemId + '"]');
        const comments = document.querySelector('[data-review-panel="' + itemId + '"] textarea[data-review-field="questionComments"]');

        const instructions = comments ? comments.value.trim() : "";

        if (!instructions) {
            alert("Add question comments first.");
            return;
        }

        button.disabled = true;

        if (status) {
            status.textContent = "Creating suggested rewrite...";
        }

        try {
            const response = await fetch("/api/suggest-question-edit", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    folderName: folderName,
                    instructions: instructions
                })
            });

            const result = await response.json();

            if (!response.ok || result.success === false) {
                throw new Error(result.error || "Question suggestion failed.");
            }

            const panel = button.closest(".question-feedback");

            let suggestionBox = panel.querySelector(".question-suggestion-box");

            if (!suggestionBox) {
                suggestionBox = document.createElement("div");
                suggestionBox.className = "question-suggestion-box";
                panel.appendChild(suggestionBox);
            }

            suggestionBox.innerHTML = "";

            const heading = document.createElement("h4");
            heading.textContent = "Suggested rewrite";

            const pre = document.createElement("pre");
            pre.textContent = renderQuestionSuggestion(result);

            const suggestion = result.suggestion ?? result.questionSuggestion ?? result.suggestedQuestion ?? result.data ?? result;
            const juniorSuggestion = result.juniorSuggestion ?? null;
            const card = document.querySelector('[data-item-id="' + itemId + '"]');

            if (card && suggestion) {
                const title = card.querySelector(".question-column h3 + .question-text");
                const choices = card.querySelectorAll(".question-column .choices .choice");

                if (title) {
                    title.textContent = suggestion.question ?? title.textContent;
                }

                if (suggestion.choices) {
                    suggestion.choices.forEach((choice, index) => {
                        const choiceText = choices[index]?.querySelector(".choice__text");

                        if (choiceText) {
                            choiceText.textContent = choice.text;
                        }
                    });
                }

                const explanationHeading = Array.from(card.querySelectorAll(".question-column h3"))
                    .find((heading) => heading.textContent === "Explanation");

                const explanation = explanationHeading?.nextElementSibling;

                if (explanation && suggestion.explanation) {
                    explanation.textContent = suggestion.explanation;
                }
            }

            if (card && juniorSuggestion) {
                const juniorColumn = card.querySelector(".junior-column");

                if (juniorColumn) {
                    const juniorTitle = juniorColumn.querySelector(".junior-panel h3");
                    const juniorQuestion = juniorColumn.querySelector(".junior-question");
                    const juniorChoices = juniorColumn.querySelectorAll(".junior-column .choices .choice");

                    if (juniorTitle && juniorSuggestion.title) {
                        juniorTitle.textContent = juniorSuggestion.title;
                    }

                    if (juniorQuestion && juniorSuggestion.question) {
                        juniorQuestion.textContent = juniorSuggestion.question;
                    }

                    if (juniorSuggestion.choices) {
                        juniorSuggestion.choices.forEach((choice, index) => {
                            const choiceText = juniorChoices[index]?.querySelector(".choice__text");

                            if (choiceText) {
                                choiceText.textContent = choice.text;
                            }
                        });
                    }
                }
            }

            if (status) {
                status.textContent = "Suggestion created.";
            }
        }
        catch (error) {
            if (status) {
                status.textContent = error instanceof Error
                    ? error.message
                    : String(error);
            }
        }
        finally {
            button.disabled = false;
        }
    }

    document.querySelectorAll(".suggest-question-button").forEach((button) => {
        button.addEventListener("click", () => suggestQuestionRewrite(button));
    });

    function loadImage(image) {
      const src = image.getAttribute("data-src");

      if (!src || image.getAttribute("src")) {
        return;
      }

      image.addEventListener("load", () => {
        image.classList.add("is-loaded");
        const frame = image.closest(".image-frame");
        const loading = frame ? frame.querySelector(".image-loading") : null;

        if (loading) {
          loading.style.display = "none";
        }
      }, { once: true });

      image.setAttribute("src", src);
    }
    
    function appendText(parent, tag, className, text) {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        element.textContent = text || "";
        parent.appendChild(element);
        return element;
    }

    function appendChoices(parent, choices, correctAnswers) {
        const list = document.createElement("ol");
        list.className = "choices";

        const correct = new Set((correctAnswers || []).map(function (x) {
            return String(x).toLowerCase();
        }));

        (choices || []).forEach(function (choice) {
            const item = document.createElement("li");
            item.className = correct.has(String(choice.id).toLowerCase()) ? "choice choice--correct" : "choice";

            appendText(item, "span", "choice__id", String(choice.id).toUpperCase());
            appendText(item, "span", "choice__text", choice.text);

            if (correct.has(String(choice.id).toLowerCase())) {
                appendText(item, "strong", "choice__correct", "Correct");
            }

            list.appendChild(item);
        });

        parent.appendChild(list);
    }

    async function createQuizRequest(description, status) {
        try {
            status.textContent = "Creating quiz in the background...";

            const response = await fetch("/api/create-quiz-from-description", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    description,
                }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.error || "Quiz creation failed.");
            }

            appendCreatedQuestion(result);

            status.textContent = "Question created. You can enter another rule description.";
        } catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
        }
    }

    function appendCreatedQuestion(result) {
        const folderName = result.folderName;
        const metadata = result.metadata;
        const junior = result.juniorVersion;
        const itemId = folderName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        const imagePath = result.imagePath;

        if (!imagePath) {
            throw new Error("The server did not return imagePath.");
        }

        const article = document.createElement("article");
        article.className = "question-card";
        article.id = itemId;
        article.setAttribute("data-item-id", itemId);

        const header = document.createElement("header");
        header.className = "question-card__header";

        const headerText = document.createElement("div");
        appendText(headerText, "p", "source", metadata.sourceImageName);
        appendText(headerText, "p", "rule", metadata.ruleNumber + " — " + metadata.ruleName);
        appendText(headerText, "h2", "", metadata.title);
        header.appendChild(headerText);
        article.appendChild(header);

        const grid = document.createElement("div");
        grid.className = "review-grid";

        const questionColumn = document.createElement("section");
        questionColumn.className = "review-column question-column";

        const questionPanel = document.createElement("div");
        questionPanel.className = "panel";

        appendText(questionPanel, "h3", "", "Original question");
        appendText(questionPanel, "p", "question-text", metadata.question);
        appendText(questionPanel, "h3", "", "Answers");
        appendChoices(questionPanel, metadata.choices, metadata.correctAnswers);
        appendText(questionPanel, "h3", "", "Explanation");
        appendText(questionPanel, "p", "", metadata.explanation);

        questionColumn.appendChild(questionPanel);
        grid.appendChild(questionColumn);

        const juniorColumn = document.createElement("section");
        juniorColumn.className = "review-column junior-column";

        const juniorPanel = document.createElement("div");
        juniorPanel.className = "panel junior-panel";

        appendText(juniorPanel, "p", "junior-label", "For younger juniors");
        appendText(juniorPanel, "h3", "", junior.title);
        appendText(juniorPanel, "h4", "", "Question");
        appendText(juniorPanel, "p", "question-text junior-question", junior.question);
        appendText(juniorPanel, "h4", "", "Answers");
        appendChoices(juniorPanel, junior.choices, junior.correctAnswers);
        appendText(juniorPanel, "h4", "", "Explanation");
        appendText(juniorPanel, "p", "", junior.explanation);

        juniorColumn.appendChild(juniorPanel);
        grid.appendChild(juniorColumn);

        const imageColumn = document.createElement("section");
        imageColumn.className = "review-column new-image-column";

        const imagePanel = document.createElement("div");
        imagePanel.className = "panel";

        const imageBlock = document.createElement("div");
        imageBlock.className = "image-block";

        const imageHeader = document.createElement("div");
        imageHeader.className = "image-block__header";
        appendText(imageHeader, "h3", "", "New generated image");

        const openLink = document.createElement("a");
        openLink.href = imagePath;
        openLink.target = "_blank";
        openLink.rel = "noopener";
        openLink.textContent = "Open";
        imageHeader.appendChild(openLink);

        const frame = document.createElement("div");
        frame.className = "image-frame";

        const image = document.createElement("img");
        image.className = "is-loaded";
        image.src = imagePath + "?t=" + Date.now();
        image.alt = metadata.imageAlt || metadata.title;

        frame.appendChild(image);
        imageBlock.appendChild(imageHeader);
        imageBlock.appendChild(frame);
        imagePanel.appendChild(imageBlock);
        imageColumn.appendChild(imagePanel);
        grid.appendChild(imageColumn);

        article.appendChild(grid);

        document.querySelector(".top-banner").insertAdjacentElement("afterend", article);

        document.getElementById("summary-total").textContent = String(document.querySelectorAll(".question-card").length);

        article.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }
    
    async function createQuizFromDescription() {
        const descriptionBox = document.getElementById("create-question-description");
        const button = document.getElementById("create-question-button");
        const status = document.getElementById("create-question-status");
        const description = descriptionBox.value.trim();

        if (!description) {
            alert("Enter a rule description first.");
            return;
        }

        descriptionBox.value = "";
        status.textContent = "Queued. You can enter another rule description now.";

        createQuizRequest(description, status);
    }

    document.getElementById("create-question-button").addEventListener("click", createQuizFromDescription);
    document.getElementById("export-json").addEventListener("click", exportJson);
    document.getElementById("export-csv").addEventListener("click", exportCsv);
    document.getElementById("review-search").addEventListener("input", applyCurrentFilter);

    const importButton = document.getElementById("import-json");
    const importFile = document.getElementById("import-json-file");

    importButton.addEventListener("click", () => {
        importFile.click();
    });

    importFile.addEventListener("change", async () => {

        if (!importFile.files.length) {
            return;
        }

        await importJson(importFile.files[0]);

        importFile.value = "";

    });

    document.getElementById("clear-feedback").addEventListener("click", () => {
      const confirmed = window.confirm("Clear all saved review feedback from this browser?");

      if (!confirmed) {
        return;
      }

      localStorage.removeItem(storageKey);
      localStorage.removeItem(globalCommentsKey);
      window.location.reload();
    });

    document.querySelectorAll('input[name="reviewFilter"]').forEach((input) => {
      input.addEventListener("change", applyCurrentFilter);
    });

    document.querySelectorAll('input[name="reviewSort"]').forEach((input) => {
      input.addEventListener("change", () => {
        applyCurrentSort();
        applyCurrentFilter();
      });
    });
    
    async function regenerateImage(button) {
        const itemId = button.getAttribute("data-regenerate-target");
        const folderName = button.getAttribute("data-regenerate-folder");
        const status = document.querySelector('[data-regenerate-status="' + itemId + '"]');
        const comments = document.querySelector('[data-review-panel="' + itemId + '"] textarea[data-review-field="imageRegenerationComments"]');

        const instructions = comments ? comments.value.trim() : "";

        if (!instructions) {
            alert("Add regeneration instructions first.");
            return;
        }

        button.disabled = true;

        if (status) {
            status.textContent = "Regenerating image...";
        }

        try {
            const response = await fetch("/api/regenerate-image", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                folderName,
                instructions,
                }),
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
            throw new Error(result.error || "Image regeneration failed.");
            }

            const card = document.querySelector('[data-item-id="' + itemId + '"]');
            const image = card ? card.querySelector(".new-image-column img.lazy-image") : null;

            if (image) {
            image.setAttribute("data-src", result.imagePath);
            image.setAttribute("src", result.imagePath + "?t=" + Date.now());
            image.classList.add("is-loaded");
            }

            if (status) {
            status.textContent = "Regenerated: " + result.imageFileName;
            }
        } catch (error) {
            if (status) {
            status.textContent = error instanceof Error ? error.message : String(error);
            }
        } finally {
            button.disabled = false;
        }
        }

        document.querySelectorAll(".regenerate-image-button").forEach((button) => {
        button.addEventListener("click", () => regenerateImage(button));
        });

    attachGlobalCommentsAutosave();
    attachGlobalCommentsAutosave();
    attachAutosave();
    restoreFormState();
    applyCurrentSort();
    applyCurrentFilter();
    initialiseLazyImages();
  </script>
</body>
</html>`;
}

async function main(): Promise<void> {
  const reviewFilePath = path.join(OUTPUT_DIR, REVIEW_FILE_NAME);
  const folders = await findQuestionFolders(OUTPUT_DIR);

  if (folders.length === 0) {
    throw new Error(`No question folders containing metadata.json were found in ${OUTPUT_DIR}`);
  }

  const items = await buildReviewItems(folders, reviewFilePath);
  const html = buildHtml(items);

  await fs.writeFile(reviewFilePath, html, "utf8");

  console.log(`Wrote ${reviewFilePath}`);
  console.log(`Questions: ${items.length}`);
  console.log(`Open: ${reviewFilePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});