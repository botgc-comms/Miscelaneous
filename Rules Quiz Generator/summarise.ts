import { promises as fs } from "node:fs";
import path from "node:path";

type Metadata = {
  sourceImageName: string;
  ruleNumber: string;
  ruleName: string;
  title: string;
};

const OUTPUT_DIR = process.argv[2] ?? "./Output";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

async function main(): Promise<void> {
  const entries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true });

  const rows: Metadata[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "_source-state") {
      continue;
    }

    const metadataPath = path.join(OUTPUT_DIR, entry.name, "metadata.json");

    if (!await pathExists(metadataPath)) {
      continue;
    }

    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Metadata;

    rows.push({
      sourceImageName: metadata.sourceImageName,
      ruleNumber: metadata.ruleNumber,
      ruleName: metadata.ruleName,
      title: metadata.title,
    });
  }

  rows.sort((a, b) =>
    a.sourceImageName.localeCompare(b.sourceImageName) ||
    a.ruleNumber.localeCompare(b.ruleNumber) ||
    a.title.localeCompare(b.title)
  );

  const grouped = Map.groupBy(rows, (row) => row.sourceImageName);

  const summaryRows = [...grouped.entries()].map(([sourceImageName, items]) => ({
    sourceImageName,
    count: items.length,
    rules: [...new Set(items.map((x) => `${x.ruleNumber} - ${x.ruleName}`))].join(" | "),
    titles: items.map((x) => x.title).join(" | "),
  }));

  const csv = [
    ["Source Image", "Question Count", "Rules", "Titles"].map(csvEscape).join(","),
    ...summaryRows.map((row) => [
      csvEscape(row.sourceImageName),
      String(row.count),
      csvEscape(row.rules),
      csvEscape(row.titles),
    ].join(",")),
  ].join("\n");

  await fs.writeFile(path.join(OUTPUT_DIR, "extraction-summary.csv"), csv, "utf8");
  await fs.writeFile(path.join(OUTPUT_DIR, "extraction-summary.json"), JSON.stringify(summaryRows, null, 2), "utf8");

  console.log(`Wrote ${path.join(OUTPUT_DIR, "extraction-summary.csv")}`);
  console.log(`Wrote ${path.join(OUTPUT_DIR, "extraction-summary.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});