import OpenAI from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const ROOT = path.resolve(process.argv[2] ?? ".");
const OVERWRITE = process.argv.includes("--overwrite");

const packIndex = process.argv.indexOf("--pack");

const TARGET_PACK =
  packIndex >= 0
    ? process.argv[packIndex + 1]
    : null;

type PackPage = {
  id: string;
  title: string;
  file: string;
  type?: string;
};

type PackJson = {
  id: string;
  title: string;
  summary?: string;
  pages: PackPage[];
};

type VisualStrategy = {
  composition: string;
  subject: string;
};

const COMPOSITIONS = [
  "wide scene",
  "flat lay",
  "close up",
  "comparison",
  "action shot",
  "still life",
  "environment"
];

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(
    await fs.readFile(filePath, "utf8")
  ) as T;
}

async function findPackFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(
    dir,
    { withFileTypes: true }
  );

  const results: string[] = [];

  for (const entry of entries) {
    const full = path.join(
      dir,
      entry.name
    );

    if (entry.isDirectory()) {
      results.push(
        ...await findPackFiles(full)
      );
    }

    if (
      entry.isFile() &&
      entry.name === "pack.json"
    ) {
      results.push(full);
    }
  }

  return results.sort();
}

function chooseComposition(
  previousCompositions: string[]
): string {
  const available =
    COMPOSITIONS.find(
      x =>
        !previousCompositions.includes(
          x
        )
    );

  if (available) {
    return available;
  }

  return COMPOSITIONS[
    previousCompositions.length %
    COMPOSITIONS.length
  ];
}

function classifySubject(
  pack: PackJson,
  page: PackPage
): string {
  const text = (
    `${pack.title} ${page.title}`
  ).toLowerCase();

  if (
    text.includes("putter")
  ) {
    return "real golf putter on a practice green";
  }

  if (
    text.includes("wedge")
  ) {
    return "real golf wedge beside golf balls on short grass";
  }

  if (
    text.includes("wood") ||
    text.includes("iron") ||
    text.includes("hybrid")
  ) {
    return "real golf clubs arranged for comparison";
  }

  if (
    text.includes("bag")
  ) {
    return "junior golf bag with clubs";
  }

  if (
    text.includes("fitting")
  ) {
    return "junior golf club beside adult golf club showing size difference";
  }

  if (
    text.includes("app") ||
    text.includes("voucher")
  ) {
    return "junior golfer using club mobile app";
  }

  return "junior golf learning scene";
}

function buildPagePrompt(
  pack: PackJson,
  page: PackPage,
  previousTitles: string[]
): string {
  return `
Create one page of a junior golf learning pack.

Audience:
- brand new junior golfers
- non-golfing parents

Rules:
- Use British English.
- Only page 00 may introduce the pack.
- Never say welcome after page 00.
- Assume the previous pages have already been read.
- Continue the learning journey naturally.
- Avoid repetition.

Pack:
${pack.title}

Previous pages:
${previousTitles.join(", ")}

Current page:
${page.title}

Start with:

# ${page.title}
`.trim();
}

async function generateMarkdown(
  pack: PackJson,
  page: PackPage,
  previousTitles: string[]
): Promise<string> {
  const response =
    await client.responses.create({
      model: "gpt-4o-mini",
      input:
        buildPagePrompt(
          pack,
          page,
          previousTitles
        )
    });

  return `${response.output_text.trim()}\n`;
}

async function generateImage(
  strategy: VisualStrategy
): Promise<Buffer | null> {
  const response =
    await client.images.generate({
      model: "gpt-image-1",
      prompt: `
Create one photorealistic image.

Composition:
${strategy.composition}

Subject:
${strategy.subject}

Requirements:
- golf equipment must be physically accurate
- shafts must be straight
- no hook shaped clubs
- no distorted grips
- no duplicated equipment
- no repeated compositions
- no text
- no watermarks
      `.trim(),
      size: "1024x1024",
      quality: "high"
    });

  const base64 =
    response.data?.[0]
      ?.b64_json;

  if (!base64) {
    return null;
  }

  return Buffer.from(
    base64,
    "base64"
  );
}

async function processPack(
  packFile: string
): Promise<void> {
  const pack =
    await readJson<PackJson>(
      packFile
    );

  const packFolder =
    path.dirname(
      packFile
    );

  const previousTitles: string[] =
    [];

  const previousCompositions:
    string[] = [];

  for (const page of pack.pages) {
    const pagePath =
      path.join(
        packFolder,
        page.file
      );

    const imageName =
      path.parse(
        page.file
      ).name.replace(
        /^\d+-/,
        ""
      ) + ".png";

    const imagePath =
      path.join(
        packFolder,
        "assets",
        imageName
      );

    await fs.mkdir(
      path.dirname(
        pagePath
      ),
      { recursive: true }
    );

    await fs.mkdir(
      path.dirname(
        imagePath
      ),
      { recursive: true }
    );

    const strategy: VisualStrategy = {
      composition:
        chooseComposition(
          previousCompositions
        ),
      subject:
        classifySubject(
          pack,
          page
        )
    };

    if (
      OVERWRITE ||
      !await exists(
        pagePath
      )
    ) {
      const markdown =
        await generateMarkdown(
          pack,
          page,
          previousTitles
        );

      await fs.writeFile(
        pagePath,
        `![${page.title}](../assets/${imageName})

${markdown}`,
        "utf8"
      );

      console.log(
        `Wrote page: ${page.file}`
      );
    }

    if (
      OVERWRITE ||
      !await exists(
        imagePath
      )
    ) {
      const image =
        await generateImage(
          strategy
        );

      if (image) {
        await fs.writeFile(
          imagePath,
          image
        );

        console.log(
          `Wrote image: ${imageName}`
        );
      }
    }

    previousTitles.push(
      page.title
    );

    previousCompositions.push(
      strategy.composition
    );
  }
}

async function main(): Promise<void> {
  const packFiles =
    await findPackFiles(
      ROOT
    );

  const filtered =
    TARGET_PACK
      ? packFiles.filter(
          x =>
            x.includes(
              TARGET_PACK
            )
        )
      : packFiles;

  console.log(
    `Found ${filtered.length} selected pack(s).`
  );

  for (const pack of filtered) {
    console.log(
      `Processing ${pack}`
    );

    await processPack(
      pack
    );
  }

  console.log(
    "Done."
  );
}

main().catch(error => {
  console.error(
    error
  );

  process.exit(1);
});