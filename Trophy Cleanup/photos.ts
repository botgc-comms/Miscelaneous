import OpenAI, { toFile } from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const INPUT_DIR = process.argv[2] ?? "./trophies";
const OUTPUT_DIR = process.argv[3] ?? "./photos";
const REFERENCES_DIR = process.argv[4] ?? "./references";

const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
const IMAGE_SIZE = process.env.OPENAI_IMAGE_SIZE ?? "1024x1536";

const INCLUDE_PRIZE_PROBABILITY = 0.5;
const USE_TABLE_CLOTH_PROBABILITY = 0.65;
const USE_LOGO_ON_CLOTH_PROBABILITY = 0.5;
const INCLUDE_BACKGROUND_PEOPLE_PROBABILITY = 0.45;
const INCLUDE_ACCESSORY_PROBABILITY = 0.45;

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

type SceneType = "indoor" | "outdoor";

type Scene = {
  name: string;
  type: SceneType;
  prompt: string;
};

type ReferenceSet = {
  course: string[];
  clubhouse: string[];
  logo: string[];
};

type TablePresentation = {
  prompt: string;
  useLogoReference: boolean;
};

const SCENES: Scene[] = [
  {
    name: "clubhouse-window",
    type: "indoor",
    prompt: "inside a real golf clubhouse beside a large window overlooking the course, with natural daylight, warm wooden furniture, and a relaxed club atmosphere",
  },
  {
    name: "clubhouse-evening",
    type: "indoor",
    prompt: "inside a traditional golf clubhouse in warm evening light, with wooden tables, framed golf photographs, soft background blur, and a natural presentation setting",
  },
  {
    name: "course-prize-table",
    type: "outdoor",
    prompt: "on an outdoor prize table beside the golf course, with fairway, trees, sky and natural competition-day atmosphere in the background",
  },
  {
    name: "clubhouse-patio",
    type: "outdoor",
    prompt: "on a presentation table near the clubhouse patio, with the golf course visible behind, natural daylight, and a believable golf club presentation setting",
  },
  {
    name: "trophy-cabinet-area",
    type: "indoor",
    prompt: "inside a clubhouse trophy area, with other trophies softly blurred in the background, polished wood, and natural ambient light",
  },
  {
    name: "green-and-clubhouse",
    type: "outdoor",
    prompt: "on a smart prize table overlooking a green and clubhouse, with soft daylight, trees, fairway and a natural presentation scene",
  },
];

const CLOTH_COLOURS = [
  "navy",
  "dark green",
  "burgundy",
  "cream",
  "white",
  "black",
  "deep charcoal",
];

const LOGO_STYLES = [
  "full-colour embroidered crest",
  "metallic gold thread outline version of the crest",
  "metallic silver thread outline version of the crest",
  "subtle single-colour stitched outline version of the crest",
];

const WOOD_TABLE_OPTIONS = [
  "on a polished wooden presentation table with no table cloth",
  "on a dark polished clubhouse table with no table cloth",
  "on a light oak presentation table with no table cloth",
  "on a natural wooden table with no table cloth",
];

const PRIZE_OPTIONS = [
  "one clearly recognisable unopened box of 12 Titleist Pro V1 golf balls placed naturally beside the trophy",
  "one clearly recognisable unopened box of 12 Titleist Pro V1x golf balls placed naturally beside the trophy",
  "one clearly recognisable unopened sleeve of 3 Titleist Pro V1 golf balls placed naturally beside the trophy",
  "one clearly recognisable unopened sleeve of 3 Titleist Pro V1x golf balls placed naturally beside the trophy",
  "one clearly recognisable unopened box of 12 TaylorMade TP5 pix golf balls placed naturally beside the trophy",
  "one clearly recognisable unopened sleeve of 3 TaylorMade TP5 pix golf balls placed naturally beside the trophy",
  "one clearly recognisable unopened box of 12 TaylorMade Tour Response Stripe golf balls placed naturally beside the trophy",
  "one clearly recognisable unopened sleeve of 3 TaylorMade Tour Response Stripe golf balls placed naturally beside the trophy",
  "one clearly recognisable unopened box of 12 Srixon Z-Star golf balls placed naturally beside the trophy",
  "one clearly recognisable unopened sleeve of 3 Srixon Z-Star golf balls placed naturally beside the trophy",
  "one clearly recognisable unopened box of 12 Callaway Chrome Tour golf balls placed naturally beside the trophy",
  "one clearly recognisable unopened sleeve of 3 Callaway Chrome Tour golf balls placed naturally beside the trophy",
];

const ACCESSORY_OPTIONS = [
  "a smart unbranded golf bag standing naturally in the background, softly out of focus",
  "a pair of golf shoes and a folded towel in the far background, softly blurred",
  "a small stack of scorecards on a nearby table, softly out of focus",
  "a framed honours board in the background, softly blurred with no readable text",
  "a distant trolley near the clubhouse patio, softly out of focus",
  "a few other trophies in the background, softly blurred, not competing with the main trophy",
];

const BACKGROUND_PEOPLE_OPTIONS = [
  "two golfers chatting naturally in the distant background, softly blurred and not looking at the camera",
  "a small group of golfers in smart golf clothing in the far background, softly out of focus",
  "one golfer walking in the distance outside, softly blurred",
  "two junior golfers in the distant background, softly blurred and incidental to the scene",
  "club members seated in the clubhouse background, softly blurred and not prominent",
];

async function ensureDirectory(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listImageFiles(dir: string): Promise<string[]> {
  if (!(await exists(dir))) {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter((filePath) => ALLOWED_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

async function loadReferences(): Promise<ReferenceSet> {
  return {
    course: await listImageFiles(path.join(REFERENCES_DIR, "course")),
    clubhouse: await listImageFiles(path.join(REFERENCES_DIR, "clubhouse")),
    logo: await listImageFiles(path.join(REFERENCES_DIR, "logo")),
  };
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function pickOptional<T>(items: T[]): T | null {
  return items.length === 0 ? null : pick(items);
}

function probability(value: number): boolean {
  return Math.random() < value;
}

function buildPrizeInstruction(): string {
  if (!probability(INCLUDE_PRIZE_PROBABILITY)) {
    return "Do not include any supplementary prize items, golf ball boxes, golf ball sleeves, loose golf balls, prize envelopes, prize vouchers, or prize accessories. Show only the trophy as the hero subject.";
  }

  return `Add ${pick(PRIZE_OPTIONS)}. The prize item must be either one unopened box of 12 golf balls or one unopened sleeve of 3 golf balls. Do not show loose individual golf balls.`;
}

function buildAccessoryInstruction(): string {
  if (!probability(INCLUDE_ACCESSORY_PROBABILITY)) {
    return "Do not add extra accessories such as golf bags, shoes, towels, scorecards, trolleys, or additional trophies.";
  }

  return `Include ${pick(ACCESSORY_OPTIONS)}. This should be secondary background detail only and must not distract from the main trophy.`;
}

function buildBackgroundPeopleInstruction(scene: Scene): string {
  if (!probability(INCLUDE_BACKGROUND_PEOPLE_PROBABILITY)) {
    return "Do not include people in the scene.";
  }

  return `${pick(BACKGROUND_PEOPLE_OPTIONS)} People must remain background detail only, softly blurred, natural, and never reflected clearly in the trophy.`;
}

function buildTablePresentation(hasLogoReferences: boolean): TablePresentation {
  if (!probability(USE_TABLE_CLOTH_PROBABILITY)) {
    return {
      prompt: `${pick(WOOD_TABLE_OPTIONS)}. Do not use a table cloth. Do not show an embroidered club logo.`,
      useLogoReference: false,
    };
  }

  const clothColour = pick(CLOTH_COLOURS);
  const shouldUseLogo = hasLogoReferences && probability(USE_LOGO_ON_CLOTH_PROBABILITY);

  if (!shouldUseLogo) {
    return {
      prompt: `on a ${clothColour} presentation table cloth with no club logo, no crest, no badge, and no embroidery`,
      useLogoReference: false,
    };
  }

  const logoStyle = pick(LOGO_STYLES);

  return {
    prompt: `on a ${clothColour} presentation table cloth with the supplied club logo reference attempted as a ${logoStyle} on the front edge of the cloth only`,
    useLogoReference: true,
  };
}

function outputPathFor(inputFile: string): string {
  const baseName = path.basename(inputFile, path.extname(inputFile));
  return path.join(OUTPUT_DIR, `${baseName}.png`);
}

async function prepareImageForUpload(inputFile: string): Promise<Buffer> {
  return await sharp(inputFile)
    .rotate()
    .resize({
      width: 1536,
      height: 1536,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
}

async function toUpload(filePath: string): Promise<File> {
  const buffer = await prepareImageForUpload(filePath);
  const fileName = `${path.basename(filePath, path.extname(filePath))}.png`;

  return await toFile(buffer, fileName, { type: "image/png" });
}

function buildPrompt(
  scene: Scene,
  tablePresentation: TablePresentation,
  prizeInstruction: string,
  accessoryInstruction: string,
  backgroundPeopleInstruction: string,
  hasCourseReference: boolean,
  hasClubhouseReference: boolean,
  hasLogoReference: boolean,
): string {
  return [
    "Edit the supplied trophy photograph into one natural, realistic, premium golf club trophy presentation photograph.",
    "The supplied trophy is the main subject and the source of truth.",
    "Keep the trophy itself exactly as supplied.",
    "Do not add, remove, rewrite, invent, correct, translate, enhance, or alter any text, engraving, plaque, crest, badge, logo, name, date, label, marking, shape, handle, stem, bowl, plinth, base, decoration, or structural feature on the trophy.",
    "Do not write Burton-on-Trent Golf Club, Burton on Trent Golf Club, BOTGC, a club name, competition name, winner name, date, crest, badge, or any other wording on the trophy unless it is already clearly present in the original trophy photograph.",
    "If any text or engraving on the trophy is unclear in the original photograph, keep it unclear, blank, or visually indistinct. Do not guess.",
    "Only clean the trophy photographically: polish it, sharpen it, improve lighting, reduce blur, and integrate it naturally into the scene without changing the trophy design.",
    "The trophy must be fully visible with comfortable space around the top, sides, and base.",
    "Do not crop, cut off, obscure, stretch, bend, reshape, simplify, or redesign the trophy.",
    `Place the trophy ${scene.prompt}, ${tablePresentation.prompt}.`,
    prizeInstruction,
    accessoryInstruction,
    backgroundPeopleInstruction,
    "If a golf ball box or sleeve is included, it should look like a real premium golf product with accurate readable branding where requested.",
    hasLogoReference
      ? "Use the supplied club logo reference only for the table cloth embroidery. Do not place the club logo on the trophy, golf balls, golf ball packaging, wall, window, shirt, golf bag, background, or any other surface."
      : "Do not show a club logo on the table cloth, golf bag, wall, shirt, trophy, golf ball packaging, or background.",
    "The scene should feel relaxed and believable, as though photographed naturally at a golf club presentation.",
    "Use natural light, realistic shadows, shallow depth of field, believable reflections, and a photographic lens perspective.",
    "Do not make the image look like CGI, a render, a cartoon, a painting, a vector illustration, a stock advert, or an artificial mock-up.",
    "Reflections in the trophy may show the room, windows, table, lights, golf course, sky, trees, clubhouse, table cloth, and nearby prizes.",
    "Reflections in the trophy must never show a photographer, camera, phone, tripod, hands, studio crew, or person taking a photograph.",
    hasCourseReference ? "Use the supplied course reference image as visual guidance for the outdoor course background, but keep the final scene natural and newly composed." : "",
    hasClubhouseReference ? "Use the supplied clubhouse reference image as visual guidance for the clubhouse atmosphere, but keep the final scene natural and newly composed." : "",
  ].filter(Boolean).join(" ");
}

async function generateScene(inputFile: string, references: ReferenceSet, scene: Scene): Promise<void> {
  const outputFile = outputPathFor(inputFile);

  if (await exists(outputFile)) {
    console.log(`Skipping existing file: ${outputFile}`);
    return;
  }

  const tablePresentation = buildTablePresentation(references.logo.length > 0);

  const courseReference = scene.type === "outdoor" ? pickOptional(references.course) : null;
  const clubhouseReference = scene.type === "indoor" ? pickOptional(references.clubhouse) : null;
  const logoReference = tablePresentation.useLogoReference ? pickOptional(references.logo) : null;

  const uploads: File[] = [await toUpload(inputFile)];

  if (courseReference) {
    uploads.push(await toUpload(courseReference));
  }

  if (clubhouseReference) {
    uploads.push(await toUpload(clubhouseReference));
  }

  if (logoReference) {
    uploads.push(await toUpload(logoReference));
  }

  const prizeInstruction = buildPrizeInstruction();
  const accessoryInstruction = buildAccessoryInstruction();
  const backgroundPeopleInstruction = buildBackgroundPeopleInstruction(scene);

  const prompt = buildPrompt(
    scene,
    tablePresentation,
    prizeInstruction,
    accessoryInstruction,
    backgroundPeopleInstruction,
    Boolean(courseReference),
    Boolean(clubhouseReference),
    Boolean(logoReference),
  );

  const result = await client.images.edit({
    model: MODEL,
    image: uploads.length === 1 ? uploads[0] : uploads,
    prompt,
    quality: "high",
    size: IMAGE_SIZE,
  });

  const image = result.data?.[0];

  if (!image?.b64_json) {
    throw new Error(`No image data returned for ${inputFile}`);
  }

  await fs.writeFile(outputFile, Buffer.from(image.b64_json, "base64"));

  console.log(`Saved: ${outputFile}`);
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  await ensureDirectory(OUTPUT_DIR);

  const inputFiles = await listImageFiles(INPUT_DIR);

  if (inputFiles.length === 0) {
    throw new Error(`No supported trophy images found in ${INPUT_DIR}`);
  }

  const references = await loadReferences();

  for (let i = 0; i < inputFiles.length; i += 1) {
    const inputFile = inputFiles[i];
    const scene = SCENES[i % SCENES.length];

    console.log(`Processing trophy: ${inputFile}`);
    await generateScene(inputFile, references, scene);
  }

  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});