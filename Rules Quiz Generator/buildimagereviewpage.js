import { promises as fs } from "node:fs";
import path from "node:path";
const OUTPUT_DIR = process.argv[2] ?? "./output";
const INPUT_DIR = process.argv[3] ?? "./input";
const REVIEW_FILE_NAME = process.argv[4] ?? "image-review.html";
const OLD_IMAGE_FILE_NAME = process.env.OLD_IMAGE_FILE_NAME ?? "illustration.png";
const NEW_IMAGE_FILE_NAME = process.env.NEW_IMAGE_FILE_NAME ?? "illustration-v2.png";
const OLD_PROMPT_FILE_NAME = process.env.OLD_PROMPT_FILE_NAME ?? "final-prompt.txt";
const NEW_PROMPT_FILE_NAME = process.env.NEW_PROMPT_FILE_NAME ?? "final-prompt-v2.txt";
const SUPPORTED_SOURCE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function readTextIfExists(filePath) {
    if (!await pathExists(filePath)) {
        return "";
    }
    return fs.readFile(filePath, "utf8");
}
function htmlEscape(value) {
    return (value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
function jsString(value) {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026");
}
function toRelativeWebPath(fromFile, targetFile) {
    return path.relative(path.dirname(fromFile), targetFile).split(path.sep).join("/");
}
function slugify(value) {
    return value
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/[\s-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();
}
async function findQuestionFolders(outputDir) {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });
    const folders = [];
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
async function resolveSourceImagePath(sourceImageName) {
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
function renderChoices(metadata) {
    const correct = new Set(metadata.correctAnswers ?? []);
    return metadata.choices.map((choice) => {
        const isCorrect = correct.has(choice.id);
        return `
      <li class="${isCorrect ? "choice choice--correct" : "choice"}">
        <span class="choice__id">${htmlEscape(choice.id.toUpperCase())}</span>
        <span class="choice__text">${htmlEscape(choice.text)}</span>
        ${isCorrect ? `<strong class="choice__correct">Correct</strong>` : ""}
      </li>`;
    }).join("");
}
function renderImage(label, imagePath, alt) {
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
function renderPrompt(title, prompt) {
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
function renderQuestionReview(item) {
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
    </section>`;
}
function renderImageReview(item) {
    return `
    <section class="image-feedback" data-review-panel="${htmlEscape(item.id)}">
      <h3>Image decision</h3>

      <fieldset>
        <legend>Image decision</legend>

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

      <div class="review-status" data-review-status="${htmlEscape(item.id)}">Not reviewed</div>
    </section>`;
}
function renderItem(item) {
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
            <h3>Question</h3>
            <p class="question-text">${htmlEscape(item.metadata.question)}</p>

            <h3>Answers</h3>
            <ol class="choices">
              ${renderChoices(item.metadata)}
            </ol>

            <h3>Explanation</h3>
            <p>${htmlEscape(item.metadata.explanation)}</p>

            ${renderQuestionReview(item)}
          </div>
        </section>

        <section class="review-column source-column">
          <div class="panel">
            ${renderImage("Original rules book page", item.sourceImagePath, item.metadata.sourceImageName)}
          </div>
        </section>

        <section class="review-column old-image-column">
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
      </div>
    </article>`;
}
async function buildReviewItems(folders, reviewFilePath) {
    const items = [];
    for (const folder of folders) {
        const folderName = path.basename(folder);
        const metadataPath = path.join(folder, "metadata.json");
        const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
        const oldImagePath = path.join(folder, OLD_IMAGE_FILE_NAME);
        const newImagePath = path.join(folder, NEW_IMAGE_FILE_NAME);
        const oldPromptPath = path.join(folder, OLD_PROMPT_FILE_NAME);
        const newPromptPath = path.join(folder, NEW_PROMPT_FILE_NAME);
        const sourceImagePath = await resolveSourceImagePath(metadata.sourceImageName);
        items.push({
            id: slugify(folderName),
            folderName,
            sourceImageName: metadata.sourceImageName,
            sourceImagePath: sourceImagePath ? toRelativeWebPath(reviewFilePath, sourceImagePath) : null,
            oldImagePath: await pathExists(oldImagePath) ? toRelativeWebPath(reviewFilePath, oldImagePath) : null,
            newImagePath: await pathExists(newImagePath) ? toRelativeWebPath(reviewFilePath, newImagePath) : null,
            oldPrompt: await readTextIfExists(oldPromptPath),
            newPrompt: await readTextIfExists(newPromptPath),
            metadata,
        });
    }
    return items;
}
function buildNavigation(items) {
    return items.map((item, index) => `
    <a class="nav-item" href="#${htmlEscape(item.id)}" data-nav-item="${htmlEscape(item.id)}">
      <span>${index + 1}</span>
      <strong>${htmlEscape(item.metadata.title)}</strong>
      <small>${htmlEscape(item.metadata.ruleNumber)} — ${htmlEscape(item.metadata.ruleName)}</small>
    </a>`).join("");
}
function buildHtml(items) {
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

    .filter-bar {
      display: grid;
      gap: 0.45rem;
      margin-top: 1rem;
      padding: 0.85rem;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.08);
    }

    .filter-bar label {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.9rem;
      color: #e2e8f0;
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

    .question-text {
      font-size: 1.1rem;
      font-weight: 700;
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

        .sort-bar {
      display: grid;
      gap: 0.45rem;
      margin-top: 1rem;
      padding: 0.85rem;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.08);
    }

    .sort-bar strong {
      color: #e2e8f0;
      font-size: 0.9rem;
    }

    .sort-bar label {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.9rem;
      color: #e2e8f0;
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
    .image-feedback {
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

      .source-column {
        grid-column: 2;
      }

      .old-image-column {
        grid-column: 3;
      }

      .new-image-column {
        grid-column: 4;
      }
    }

    @media (min-width: 2400px) {
      .review-grid {
        grid-template-columns:
          minmax(420px, 0.95fr)
          minmax(520px, 1.1fr)
          minmax(460px, 1fr)
          minmax(460px, 1fr);
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
      <p>Review the question, source page, old image and regenerated image. Your choices autosave in this browser.</p>

      <div class="summary-grid">
        <div class="summary-card"><strong id="summary-total">${items.length}</strong><span>Total</span></div>
        <div class="summary-card"><strong id="summary-reviewed">0</strong><span>Reviewed</span></div>
        <div class="summary-card"><strong id="summary-regenerate">0</strong><span>Regenerate</span></div>
        <div class="summary-card"><strong id="summary-question-work">0</strong><span>Question work</span></div>
      </div>

      <div class="toolbar">
        <button class="primary" type="button" id="export-json">Export feedback JSON</button>
        <button type="button" id="export-csv">Export feedback CSV</button>
        <button type="button" id="clear-feedback">Clear saved feedback</button>
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
        <p>Column 1 contains the question, answers and question feedback. Column 2 contains the rules book page. Column 3 contains the old image and prompt. Column 4 contains the new image, new prompt and image decision.</p>
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
        itemState.imageRegenerationComments ||
        itemState.questionComments
      );
    }

    function needsWork(itemState) {
      return itemState.imageDecision === "regenerate"
        || itemState.questionDecision === "questionNeedsWork"
        || itemState.questionDecision === "removeQuestion";
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

        if (itemState.questionDecision === "questionNeedsWork" || itemState.questionDecision === "removeQuestion") {
          questionWork += 1;
        }
      }

      document.getElementById("summary-reviewed").textContent = String(reviewed);
      document.getElementById("summary-regenerate").textContent = String(regenerate);
      document.getElementById("summary-question-work").textContent = String(questionWork);
    }

    function itemMatchesFilter(itemId, filter) {
      const itemState = getItemState(itemId);

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
        return itemState.questionDecision === "questionNeedsWork" || itemState.questionDecision === "removeQuestion";
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
          imageRegenerationComments: itemState.imageRegenerationComments ?? "",
          questionComments: itemState.questionComments ?? "",
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
        "Image Regeneration Comments",
        "Question Comments",
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
          row.imageRegenerationComments,
          row.questionComments,
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

    async function createQuizFromDescription() {
      const description = document.getElementById("create-question-description").value.trim();
      const button = document.getElementById("create-question-button");
      const status = document.getElementById("create-question-status");

      if (!description) {
        alert("Enter a rule description first.");
        return;
      }

      button.disabled = true;
      status.textContent = "Creating quiz, junior version and image...";

      try {
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

        status.textContent = "Created: " + result.folderName + ". Rebuild the review page, then refresh.";
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        button.disabled = false;
      }
    }

    document
      .getElementById("create-question-button")
      .addEventListener("click", createQuizFromDescription);
    
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

    document.getElementById("export-json").addEventListener("click", exportJson);
    document.getElementById("export-csv").addEventListener("click", exportCsv);

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
async function main() {
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
