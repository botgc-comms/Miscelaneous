import OpenAI, { toFile } from "openai";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const OUTPUT_DIR = process.argv[2] ?? "./cabinet-backgrounds";

const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";

const CABINET_WIDTH = 1024;
const TOP_SECTION_HEIGHT = 384;
const TROPHY_ROW_HEIGHT = 384;
const BOTTOM_SECTION_HEIGHT = 384;

const MINIMUM_ROWS = 2;
const MAXIMUM_ROWS = 6;

const TROPHIES_PER_ROW = 2;
const LIGHTS_PER_ROW = 2;

type CabinetDefinition = {
  rows: number;
  capacity: number;
  width: number;
  height: number;
  fileName: string;
};

type CabinetManifestEntry = {
  rows: number;
  capacity: number;
  width: number;
  height: number;
  fileName: string;
  sourceFiles: string[];
};

const CABINET_DESIGN_CONTRACT = [
  "Create a high-detail empty wooden trophy cabinet background for a mobile application.",
  "This asset is the rear layer of a composited digital trophy cabinet.",
  "It must contain only elements that sit behind separately composited trophy illustrations.",
  "The cabinet is viewed perfectly straight-on from the front.",
  "Use a centred front elevation with no three-quarter view.",
  "Do not tilt, rotate or skew the cabinet.",
  "Use minimal natural perspective so that shelf coordinates remain predictable.",
  "The cabinet must have the same apparent width at the top and bottom.",
  "Use rich dark polished walnut with realistic natural vertical wood grain.",
  "Use a warm traditional British golf clubhouse aesthetic.",
  "Use detailed cabinet-making with substantial crown moulding, routed timber edges, carved side columns and a matching lower plinth.",
  "Use warm aged brass for restrained decorative fittings and shelf supports.",
  "Include one blank brass title plaque in the fixed top section.",
  "Include one blank brass motto plaque in the fixed lower plinth.",
  "Both plaques must be completely blank.",
  "Do not generate text, letters, logos, symbols, names, dates or engraving.",
  "Use a warm walnut back panel inside the cabinet.",
  "Use realistic depth, recesses, joinery, shadows and warm internal lighting.",
  "Use a premium highly detailed digital illustration style.",
  "The image must look dimensional, polished and luxurious.",
  "Do not make the cabinet look flat, basic, diagrammatic, cartoon-like or like simple CSS gradients.",
  "The complete crown, side columns and lower plinth must remain visible.",
  "Use a plain near-black area outside the cabinet.",
].join(" ");

const BACKGROUND_LAYER_CONTRACT = [
  "Do not include any trophies.",
  "Do not include medals, plates, awards, ornaments, books or decorative objects.",
  "Do not include people.",
  "Do not include glass doors.",
  "Do not include wooden door frames.",
  "Do not include centre door mullions.",
  "Do not include hinges.",
  "Do not include handles.",
  "Do not include locks.",
  "Do not include foreground glass.",
  "Do not include glass-door reflections.",
  "Do not include window reflections.",
  "Do not include diagonal foreground glare.",
  "Do not include reflected people, cameras, phones, rooms or scenery.",
  "Do not include haze or foreground glass tint.",
  "The front of the cabinet must be completely open.",
  "The image must be suitable for placing transparent trophy PNG images over it.",
  "All lighting, shelves, timber and rear shadows must appear behind those future trophy images.",
].join(" ");

const TROPHY_ROW_CONTRACT = [
  "Each trophy row must accommodate exactly two trophies side by side.",
  "Each row must have one left trophy bay and one right trophy bay.",
  "The two trophy bays must have identical dimensions.",
  "The centre of the left trophy bay must be at 27 percent of the internal cabinet width.",
  "The centre of the right trophy bay must be at 73 percent of the internal cabinet width.",
  "Leave generous clear space around both trophy positions.",
  "Each bay must accommodate a tall traditional handled trophy cup.",
  "Do not place any permanent divider between the two trophy bays.",
  "Place exactly two recessed warm-white spotlights above every trophy row.",
  "Centre one spotlight over the left trophy bay.",
  "Centre one spotlight over the right trophy bay.",
  "The two spotlights must be identical and symmetrical.",
  "Each spotlight must cast a soft warm pool of light down the rear wooden panel.",
  "Do not use a central spotlight.",
  "Do not use one spotlight per row.",
  "Do not use three or more spotlights per row.",
  "Place one transparent glass shelf beneath each trophy row.",
  "Every shelf must span exactly the same internal width.",
  "Every shelf must have the same thickness.",
  "Every shelf must have the same subtle green-tinted polished front edge.",
  "Every shelf must use the same small aged-brass supports.",
  "Every trophy row must have exactly the same clear internal height.",
  "Every glass shelf must be separated by exactly the same vertical distance.",
  "Do not compress, stretch or redistribute rows in taller cabinets.",
  "The shelf spacing must remain visually identical in every cabinet version.",
].join(" ");

async function ensureDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getCabinetHeight(rows: number): number {
  return TOP_SECTION_HEIGHT + rows * TROPHY_ROW_HEIGHT + BOTTOM_SECTION_HEIGHT;
}

function validateRequestedSize(
  width: number,
  height: number,
): void {
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new Error(
      `Invalid image size ${width}x${height}: width and height must both be divisible by 16.`,
    );
  }

  const aspectRatio = width / height;

  if (aspectRatio < 1 / 3 || aspectRatio > 3) {
    throw new Error(
      `Invalid image size ${width}x${height}: aspect ratio must be between 1:3 and 3:1.`,
    );
  }
}

function getDefinition(rows: number): CabinetDefinition {
  if (rows < MINIMUM_ROWS || rows > MAXIMUM_ROWS) {
    throw new Error(
      `Cabinet rows must be between ${MINIMUM_ROWS} and ${MAXIMUM_ROWS}.`,
    );
  }

  const width = CABINET_WIDTH;
  const height = getCabinetHeight(rows);

  validateRequestedSize(width, height);

  return {
    rows,
    capacity: rows * TROPHIES_PER_ROW,
    width,
    height,
    fileName: `cabinet-${rows}-rows.png`,
  };
}

function getOutputPath(definition: CabinetDefinition): string {
  return path.join(OUTPUT_DIR, definition.fileName);
}

function getApprovalPath(): string {
  return path.join(OUTPUT_DIR, "cabinet-2-rows.approved");
}

function buildMasterPrompt(definition: CabinetDefinition): string {
  return [
    CABINET_DESIGN_CONTRACT,
    BACKGROUND_LAYER_CONTRACT,
    TROPHY_ROW_CONTRACT,
    `Create the canonical master cabinet containing exactly ${definition.rows} trophy rows.`,
    `The cabinet must hold exactly ${definition.capacity} trophies in total.`,
    `There must be exactly ${TROPHIES_PER_ROW} trophy positions in each row.`,
    `There must be exactly ${LIGHTS_PER_ROW} spotlights above each row.`,
    `There must be exactly ${definition.rows} glass shelves.`,
    `There must be exactly ${definition.rows * LIGHTS_PER_ROW} spotlights in total.`,
    "Every trophy row must have identical height and shelf spacing.",
    "The fixed top section contains the crown, blank title plaque and upper moulding.",
    "The fixed bottom section contains the lower plinth and blank motto plaque.",
    "The cabinet should occupy most of the image width.",
    "Keep a narrow consistent near-black margin around the complete cabinet.",
    "Return one cabinet only.",
    "Do not return a comparison image, contact sheet, diagram or multiple designs.",
  ].join(" ");
}

function buildExtensionPrompt(
  previous: CabinetDefinition,
  next: CabinetDefinition,
  hasPreviousReference: boolean,
): string {
  return [
    CABINET_DESIGN_CONTRACT,
    BACKGROUND_LAYER_CONTRACT,
    TROPHY_ROW_CONTRACT,
    "The first supplied image is the approved canonical two-row cabinet design.",
    hasPreviousReference
      ? `The second supplied image is the approved ${previous.rows}-row version of the same cabinet.`
      : "",
    `Create the ${next.rows}-row version of exactly the same physical cabinet.`,
    "Treat every supplied image as an authoritative visual reference.",
    "Preserve the cabinet design, width, apparent scale, camera position and rendering style.",
    "Preserve the crown, title plaque, side columns, moulding profiles, wood species, wood colour, wood grain character, shelf style, shelf supports, spotlights, brass finish and lower plinth.",
    "Do not redesign, reinterpret, modernise, simplify or embellish the cabinet.",
    "Do not alter the width or proportions of any existing component.",
    `The final cabinet must contain exactly ${next.rows} trophy rows.`,
    `The final cabinet must contain exactly ${next.rows} glass shelves.`,
    `The final cabinet must contain exactly ${next.rows * LIGHTS_PER_ROW} spotlights.`,
    `The final cabinet must hold exactly ${next.capacity} trophies, with two trophies per row.`,
    "Every row must be an exact visual repetition of the established row module.",
    "Every row must have the same height.",
    "Every shelf must have the same vertical spacing.",
    "Every row must contain exactly two identical trophy bays.",
    "Every row must contain exactly two symmetrical recessed spotlights.",
    "Do not compress the rows.",
    "Do not shrink the cabinet.",
    "Do not scale down the cabinet details.",
    "Do not redistribute the shelves to fill the image.",
    "Extend the walnut rear panel and both side columns naturally through the additional height.",
    "Keep the fixed top section unchanged.",
    "Keep the fixed lower plinth unchanged apart from its vertical position.",
    "Return one complete cabinet only.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function saveImage(
  base64Data: string,
  outputFile: string,
): Promise<void> {
  await fs.writeFile(outputFile, Buffer.from(base64Data, "base64"));
}

async function validateGeneratedImage(
  imagePath: string,
  definition: CabinetDefinition,
): Promise<void> {
  const metadata = await sharp(imagePath).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Unable to read generated dimensions for ${imagePath}.`);
  }

  if (
    metadata.width !== definition.width ||
    metadata.height !== definition.height
  ) {
    throw new Error(
      [
        `Unexpected image dimensions for ${imagePath}.`,
        `Expected ${definition.width}x${definition.height}.`,
        `Received ${metadata.width}x${metadata.height}.`,
      ].join(" "),
    );
  }
}

async function prepareReference(imagePath: string): Promise<File> {
  const metadata = await sharp(imagePath).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(
      `Unable to read reference image dimensions for ${imagePath}.`,
    );
  }

  const bytes = await sharp(imagePath).rotate().png().toBuffer();

  return await toFile(bytes, path.basename(imagePath), {
    type: "image/png",
  });
}

async function generateMasterCabinet(
  definition: CabinetDefinition,
): Promise<void> {
  const outputFile = getOutputPath(definition);
  const imageSize = `${definition.width}x${definition.height}`;

  console.log(
    `Generating ${definition.rows}-row master cabinet at ${imageSize}`,
  );

  const result = await client.images.generate({
    model: MODEL,
    prompt: buildMasterPrompt(definition),
    quality: "high",
    size: imageSize,
    output_format: "png",
    background: "opaque",
    n: 1,
  });

  const generatedImage = result.data?.[0];

  if (!generatedImage?.b64_json) {
    throw new Error(`No image data returned for ${definition.fileName}.`);
  }

  await saveImage(generatedImage.b64_json, outputFile);
  await validateGeneratedImage(outputFile, definition);

  console.log(`Saved: ${outputFile}`);
}

async function generateExtendedCabinet(
  masterDefinition: CabinetDefinition,
  previousDefinition: CabinetDefinition,
  nextDefinition: CabinetDefinition,
): Promise<void> {
  const masterPath = getOutputPath(masterDefinition);
  const previousPath = getOutputPath(previousDefinition);
  const outputFile = getOutputPath(nextDefinition);

  const references: File[] = [await prepareReference(masterPath)];

  const hasPreviousReference =
    previousDefinition.rows !== masterDefinition.rows;

  if (hasPreviousReference) {
    references.push(await prepareReference(previousPath));
  }

  const imageSize = `${nextDefinition.width}x${nextDefinition.height}`;

  console.log(
    hasPreviousReference
      ? `Generating ${nextDefinition.rows}-row cabinet from ${masterDefinition.rows}-row master and ${previousDefinition.rows}-row reference at ${imageSize}`
      : `Generating ${nextDefinition.rows}-row cabinet from ${masterDefinition.rows}-row master at ${imageSize}`,
  );

  const result = await client.images.edit({
    model: MODEL,
    image: references.length === 1 ? references[0] : references,
    prompt: buildExtensionPrompt(
      previousDefinition,
      nextDefinition,
      hasPreviousReference,
    ),
    quality: "high",
    size: imageSize,
    output_format: "png",
    background: "opaque",
    n: 1,
  });

  const generatedImage = result.data?.[0];

  if (!generatedImage?.b64_json) {
    throw new Error(`No image data returned for ${nextDefinition.fileName}.`);
  }

  await saveImage(generatedImage.b64_json, outputFile);
  await validateGeneratedImage(outputFile, nextDefinition);

  console.log(`Saved: ${outputFile}`);
}

async function writeManifest(
  definitions: CabinetDefinition[],
): Promise<void> {
  const entries: CabinetManifestEntry[] = definitions.map(
    (definition, index) => {
      const sourceFiles =
        index === 0
          ? []
          : index === 1
            ? [definitions[0].fileName]
            : [definitions[0].fileName, definitions[index - 1].fileName];

      return {
        rows: definition.rows,
        capacity: definition.capacity,
        width: definition.width,
        height: definition.height,
        fileName: definition.fileName,
        sourceFiles,
      };
    },
  );

  const manifest = {
    model: MODEL,
    cabinetWidth: CABINET_WIDTH,
    topSectionHeight: TOP_SECTION_HEIGHT,
    trophyRowHeight: TROPHY_ROW_HEIGHT,
    bottomSectionHeight: BOTTOM_SECTION_HEIGHT,
    trophiesPerRow: TROPHIES_PER_ROW,
    lightsPerRow: LIGHTS_PER_ROW,
    generatedAtUtc: new Date().toISOString(),
    cabinets: entries,
  };

  const manifestPath = path.join(OUTPUT_DIR, "cabinet-manifest.json");

  await fs.writeFile(
    manifestPath,
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  console.log(`Saved: ${manifestPath}`);
}

async function generateMasterOnly(): Promise<boolean> {
  const master = getDefinition(MINIMUM_ROWS);
  const outputFile = getOutputPath(master);

  if (!(await exists(outputFile))) {
    await generateMasterCabinet(master);
  } else {
    console.log(`Using existing master cabinet: ${outputFile}`);
    await validateGeneratedImage(outputFile, master);
  }

  const approvalFile = getApprovalPath();

  if (!(await exists(approvalFile))) {
    console.log("");
    console.log(`Inspect ${outputFile} before generating taller cabinets.`);
    console.log(`When approved, create this empty file: ${approvalFile}`);
    console.log(
      "Run the script again to generate the 3 to 6-row cabinets.",
    );

    return false;
  }

  console.log(`Master cabinet approved by ${approvalFile}`);

  return true;
}

async function generateCabinetFamily(): Promise<void> {
  const definitions = Array.from(
    {
      length: MAXIMUM_ROWS - MINIMUM_ROWS + 1,
    },
    (_, index) => getDefinition(MINIMUM_ROWS + index),
  );

  const master = definitions[0];

  for (let index = 1; index < definitions.length; index += 1) {
    const previous = definitions[index - 1];
    const next = definitions[index];
    const outputFile = getOutputPath(next);

    if (await exists(outputFile)) {
      console.log(`Skipping existing file: ${outputFile}`);
      await validateGeneratedImage(outputFile, next);
      continue;
    }

    await generateExtendedCabinet(master, previous, next);
  }

  await writeManifest(definitions);
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  await ensureDirectory(OUTPUT_DIR);

  console.log(`Using model: ${MODEL}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);

  const approved = await generateMasterOnly();

  if (!approved) {
    return;
  }

  await generateCabinetFamily();

  console.log("");
  console.log("All approved cabinet backgrounds have been generated.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
