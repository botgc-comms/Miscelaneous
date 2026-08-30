import OpenAI from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
const OUTPUT_DIR = process.argv[2] ?? "./output";
const MODEL = process.env.OPENAI_JUNIOR_TEXT_MODEL ?? "gpt-4.1";
const CONCURRENCY = Math.max(1, Number(process.env.OPENAI_JUNIOR_CONCURRENCY ?? "4"));
const JUNIOR_FILE_NAME = process.env.JUNIOR_FILE_NAME ?? "junior-version.json";
const REPORT_CSV_FILE_NAME = process.env.JUNIOR_REPORT_CSV_FILE_NAME ?? "junior-version-report.csv";
const REPORT_JSON_FILE_NAME = process.env.JUNIOR_REPORT_JSON_FILE_NAME ?? "junior-version-report.json";
const OVERWRITE = process.env.OVERWRITE_JUNIOR_VERSIONS === "true";
const UPDATE_METADATA_JSON = process.env.UPDATE_METADATA_JSON === "true";
const STOP_ON_ERROR = process.env.STOP_ON_ERROR === "true";
const JUNIOR_SCHEMA = {
    name: "junior_golf_quiz_version",
    strict: true,
    schema: {
        type: "object",
        additionalProperties: false,
        required: ["juniorVersion"],
        properties: {
            juniorVersion: {
                type: "object",
                additionalProperties: false,
                required: [
                    "title",
                    "question",
                    "choices",
                    "correctAnswers",
                    "explanation",
                    "vocabulary",
                    "teachingTip",
                    "likelyMisconceptions",
                ],
                properties: {
                    title: {
                        type: "string",
                        minLength: 1,
                    },
                    question: {
                        type: "string",
                        minLength: 1,
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
                                    enum: ["a", "b", "c", "d", "e", "A", "B", "C", "D", "E"],
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
                            enum: ["a", "b", "c", "d", "e", "A", "B", "C", "D", "E"],
                        },
                    },
                    explanation: {
                        type: "string",
                        minLength: 1,
                    },
                    vocabulary: {
                        type: "array",
                        minItems: 0,
                        maxItems: 8,
                        items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["term", "simpleMeaning"],
                            properties: {
                                term: {
                                    type: "string",
                                    minLength: 1,
                                },
                                simpleMeaning: {
                                    type: "string",
                                    minLength: 1,
                                },
                            },
                        },
                    },
                    teachingTip: {
                        type: "string",
                        minLength: 1,
                    },
                    likelyMisconceptions: {
                        type: "array",
                        minItems: 0,
                        maxItems: 6,
                        items: {
                            type: "string",
                            minLength: 1,
                        },
                    },
                },
            },
        },
    },
};
const SYSTEM_PROMPT = [
    "You are rewriting junior golf quiz content for children aged around 8.",
    "The original quiz wording must be preserved conceptually but rewritten into language a typical 8-year-old golfer can understand.",
    "Keep the same rule meaning.",
    "Keep the same correct answer IDs.",
    "Keep the same number of answer choices.",
    "Keep each choice ID the same as the original.",
    "Do not make the correct answer easier by making the wrong answers silly.",
    "Use simple, concrete words.",
    "Use short sentences.",
    "Prefer examples like puddle, path, bunker, green, ball, feet, club, swing and drop.",
    "Avoid adult legal wording unless the technical term is important.",
    "When a technical golf term is important, include it in vocabulary and explain it simply.",
    "Do not invent a different rule.",
    "Do not add penalties or exceptions that are not in the original.",
    "Use British English.",
    "Return only schema-valid JSON.",
].join(" ");
async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function readJsonFile(filePath) {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
}
async function writeJsonFile(filePath, value) {
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}
async function findMetadataFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === "_source-state") {
            continue;
        }
        const metadataPath = path.join(dir, entry.name, "metadata.json");
        if (await pathExists(metadataPath)) {
            files.push(metadataPath);
        }
    }
    return files.sort((a, b) => a.localeCompare(b));
}
function normaliseId(id) {
    return id.trim().toLowerCase();
}
function normaliseChoices(originalChoices, juniorChoices) {
    const juniorById = new Map(juniorChoices.map((choice) => [normaliseId(choice.id), choice.text.trim()]));
    return originalChoices.map((originalChoice) => ({
        id: originalChoice.id,
        text: juniorById.get(normaliseId(originalChoice.id)) ?? originalChoice.text,
    }));
}
function normaliseJuniorVersion(metadata, response) {
    const originalCorrectAnswers = metadata.correctAnswers.map(normaliseId);
    const juniorChoices = normaliseChoices(metadata.choices, response.juniorVersion.choices);
    return {
        title: response.juniorVersion.title.trim(),
        question: response.juniorVersion.question.trim(),
        choices: juniorChoices,
        correctAnswers: originalCorrectAnswers,
        explanation: response.juniorVersion.explanation.trim(),
        vocabulary: response.juniorVersion.vocabulary.map((item) => ({
            term: item.term.trim(),
            simpleMeaning: item.simpleMeaning.trim(),
        })).filter((item) => item.term && item.simpleMeaning),
        teachingTip: response.juniorVersion.teachingTip.trim(),
        likelyMisconceptions: response.juniorVersion.likelyMisconceptions.map((item) => item.trim()).filter(Boolean),
    };
}
function extractTextFromResponse(response) {
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
export async function createJuniorVersionForMetadata(metadata) {
    const response = await client.responses.create({
        model: MODEL,
        input: [
            {
                role: "system",
                content: [
                    {
                        type: "input_text",
                        text: SYSTEM_PROMPT,
                    },
                ],
            },
            {
                role: "user",
                content: [
                    {
                        type: "input_text",
                        text: JSON.stringify({
                            ruleNumber: metadata.ruleNumber,
                            ruleName: metadata.ruleName,
                            title: metadata.title,
                            questionType: metadata.type,
                            originalTitle: metadata.title,
                            originalQuestion: metadata.question,
                            originalChoices: metadata.choices,
                            originalCorrectAnswers: metadata.correctAnswers,
                            originalExplanation: metadata.explanation,
                            task: "Create an alternative version of the title, question, choices and explanation for an 8-year-old golfer. Preserve the same answer IDs and the same correct answer IDs.",
                        }, null, 2),
                    },
                ],
            },
        ],
        text: {
            format: {
                type: "json_schema",
                name: JUNIOR_SCHEMA.name,
                schema: JUNIOR_SCHEMA.schema,
                strict: true,
            },
        },
    });
    const parsed = JSON.parse(extractTextFromResponse(response));
    return normaliseJuniorVersion(metadata, parsed);
}
function formatDuration(totalSeconds) {
    const seconds = Math.round(totalSeconds);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) {
        return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
}
function csvEscape(value) {
    return `"${value.replace(/"/g, "\"\"")}"`;
}
async function writeRunReports(results) {
    const sorted = [...results].sort((a, b) => a.index - b.index);
    const csv = [
        [
            "Index",
            "Total",
            "Status",
            "Rule Number",
            "Rule Name",
            "Title",
            "Folder",
            "Output Path",
            "Duration Seconds",
            "Error",
            "Completed At UTC",
        ].map(csvEscape).join(","),
        ...sorted.map((result) => [
            String(result.index),
            String(result.total),
            result.status,
            result.ruleNumber,
            result.ruleName,
            result.title,
            result.folder,
            result.outputPath,
            result.durationSeconds.toFixed(2),
            result.error,
            result.completedAtUtc,
        ].map(csvEscape).join(",")),
    ].join("\n");
    await fs.writeFile(path.join(OUTPUT_DIR, REPORT_CSV_FILE_NAME), csv, "utf8");
    await writeJsonFile(path.join(OUTPUT_DIR, REPORT_JSON_FILE_NAME), sorted);
}
async function processMetadataFile(metadataPath, index, total, workerId) {
    const startedAt = Date.now();
    const folder = path.dirname(metadataPath);
    const outputPath = path.join(folder, JUNIOR_FILE_NAME);
    const metadata = await readJsonFile(metadataPath);
    console.log("");
    console.log(`[worker ${workerId}] [${index}/${total}] ${metadata.title}`);
    console.log(`[worker ${workerId}] Rule: ${metadata.ruleNumber} - ${metadata.ruleName}`);
    if (!OVERWRITE && await pathExists(outputPath)) {
        const durationSeconds = (Date.now() - startedAt) / 1000;
        console.log(`[worker ${workerId}] [${index}/${total}] Skipped because ${JUNIOR_FILE_NAME} already exists.`);
        return {
            index,
            total,
            folder,
            title: metadata.title,
            ruleNumber: metadata.ruleNumber,
            ruleName: metadata.ruleName,
            status: "skipped",
            outputPath,
            durationSeconds,
            error: "",
            completedAtUtc: new Date().toISOString(),
        };
    }
    const juniorVersion = await createJuniorVersionForMetadata(metadata);
    await writeJsonFile(outputPath, {
        schemaVersion: 1,
        sourceMetadataPath: metadataPath,
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
        model: MODEL,
    });
    if (UPDATE_METADATA_JSON) {
        const backupPath = path.join(folder, "metadata.before-junior-version.json");
        if (!await pathExists(backupPath)) {
            await writeJsonFile(backupPath, metadata);
        }
        await writeJsonFile(metadataPath, {
            ...metadata,
            juniorVersion,
        });
    }
    const durationSeconds = (Date.now() - startedAt) / 1000;
    console.log(`[worker ${workerId}] [${index}/${total}] Complete in ${formatDuration(durationSeconds)}.`);
    return {
        index,
        total,
        folder,
        title: metadata.title,
        ruleNumber: metadata.ruleNumber,
        ruleName: metadata.ruleName,
        status: "success",
        outputPath,
        durationSeconds,
        error: "",
        completedAtUtc: new Date().toISOString(),
    };
}
async function createFailedResult(metadataPath, index, total, error) {
    let title = path.basename(path.dirname(metadataPath));
    let ruleNumber = "";
    let ruleName = "";
    try {
        const metadata = await readJsonFile(metadataPath);
        title = metadata.title;
        ruleNumber = metadata.ruleNumber;
        ruleName = metadata.ruleName;
    }
    catch {
    }
    return {
        index,
        total,
        folder: path.dirname(metadataPath),
        title,
        ruleNumber,
        ruleName,
        status: "failed",
        outputPath: path.join(path.dirname(metadataPath), JUNIOR_FILE_NAME),
        durationSeconds: 0,
        error: error instanceof Error ? error.message : String(error),
        completedAtUtc: new Date().toISOString(),
    };
}
function buildProgressLine(processed, total, succeeded, skipped, failed, startedAt) {
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const averageSeconds = processed > 0 ? elapsedSeconds / processed : 0;
    const remainingSeconds = averageSeconds * (total - processed);
    const percent = total > 0 ? (processed / total) * 100 : 100;
    return [
        `Progress ${processed}/${total}`,
        `${percent.toFixed(1)}%`,
        `Success ${succeeded}`,
        `Skipped ${skipped}`,
        `Failed ${failed}`,
        `Elapsed ${formatDuration(elapsedSeconds)}`,
        `ETA ${processed > 0 ? formatDuration(remainingSeconds) : "unknown"}`,
    ].join(" | ");
}
async function main() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not set.");
    }
    const metadataFiles = await findMetadataFiles(OUTPUT_DIR);
    if (metadataFiles.length === 0) {
        throw new Error(`No metadata.json files found in ${OUTPUT_DIR}`);
    }
    const startedAt = Date.now();
    const results = [];
    let nextIndex = 0;
    let processed = 0;
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    let fatalError = null;
    let reportWrite = Promise.resolve();
    const workerCount = Math.max(1, Math.min(CONCURRENCY, metadataFiles.length));
    console.log("Junior quiz version generation started.");
    console.log(`Output folder: ${OUTPUT_DIR}`);
    console.log(`Metadata files found: ${metadataFiles.length}`);
    console.log(`Model: ${MODEL}`);
    console.log(`Concurrency: ${workerCount}`);
    console.log(`Overwrite existing junior versions: ${OVERWRITE ? "yes" : "no"}`);
    console.log(`Update metadata.json: ${UPDATE_METADATA_JSON ? "yes" : "no"}`);
    const writeReportsQueued = async () => {
        const snapshot = [...results];
        reportWrite = reportWrite
            .catch(() => undefined)
            .then(() => writeRunReports(snapshot));
        await reportWrite;
    };
    async function worker(workerId) {
        while (true) {
            if (fatalError) {
                return;
            }
            const currentIndex = nextIndex;
            nextIndex += 1;
            if (currentIndex >= metadataFiles.length) {
                return;
            }
            const metadataPath = metadataFiles[currentIndex];
            const index = currentIndex + 1;
            try {
                const result = await processMetadataFile(metadataPath, index, metadataFiles.length, workerId);
                results.push(result);
                processed += 1;
                if (result.status === "success") {
                    succeeded += 1;
                }
                if (result.status === "skipped") {
                    skipped += 1;
                }
            }
            catch (error) {
                const result = await createFailedResult(metadataPath, index, metadataFiles.length, error);
                results.push(result);
                processed += 1;
                failed += 1;
                console.error(`[worker ${workerId}] [${index}/${metadataFiles.length}] Failed.`);
                console.error(result.error);
                if (STOP_ON_ERROR) {
                    fatalError = error;
                }
            }
            console.log(buildProgressLine(processed, metadataFiles.length, succeeded, skipped, failed, startedAt));
            await writeReportsQueued();
            if (STOP_ON_ERROR && fatalError) {
                return;
            }
        }
    }
    await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index + 1)));
    await reportWrite;
    if (fatalError) {
        throw fatalError;
    }
    console.log("");
    console.log("Junior quiz version generation finished.");
    console.log(`Total: ${metadataFiles.length}`);
    console.log(`Success: ${succeeded}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);
    console.log(`Report CSV: ${path.join(OUTPUT_DIR, REPORT_CSV_FILE_NAME)}`);
    console.log(`Report JSON: ${path.join(OUTPUT_DIR, REPORT_JSON_FILE_NAME)}`);
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
