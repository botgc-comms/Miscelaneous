import express from "express";
import open from "open";
import { regenerateSingleImage } from "./regenerateSingleImage.js";
import { suggestQuestionEdit } from "./suggestQuestionEdit.js";
import { createQuizFromRuleDescription } from "./createQuizFromRuleDescription.js";

const app = express();

const outputDir = process.argv[2] ?? "./output";
const inputDir = process.argv[3] ?? "./input";
const port = 4317;

app.use(express.json({ limit: "2mb" }));

app.use(express.static(outputDir));
app.use("/input", express.static(inputDir));

app.post("/api/create-quiz-from-description", async (req, res) => {
  try {
    const result = await createQuizFromRuleDescription({
      outputDir,
      description: req.body.description,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post("/api/suggest-question-edit", async (req, res) => {
  try {
    const result = await suggestQuestionEdit({
      outputDir,
      folderName: req.body.folderName,
      instructions: req.body.instructions,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.post("/api/regenerate-image", async (req, res) => {
  try {
    const result = await regenerateSingleImage({
      outputDir,
      folderName: req.body.folderName,
      promptFileName: req.body.promptFileName ?? "final-prompt-v2.txt",
      instructions: req.body.instructions,
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

app.listen(port, async () => {
  const url = `http://localhost:${port}/image-review.html`;
  console.log(`Review page: ${url}`);
  await open(url);
});