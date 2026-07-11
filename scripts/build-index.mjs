#!/usr/bin/env node
/**
 * Auto-discover course content and emit course/index.json.
 *
 * Expected layout:
 *   course/term-<N>/week-<NN>/  containing one or more *.md docs and one audio file.
 *
 * The generated index is what the PWA reads at runtime (GitHub Pages is static and
 * cannot list directories), so this must run before deploy. The GitHub Actions
 * workflow runs it automatically; a copy is also committed so the site works when
 * opened without a build step.
 */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COURSE_DIR = path.join(ROOT, "course");
const OUTPUT = path.join(COURSE_DIR, "index.json");

const AUDIO_EXTS = new Set([".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".flac"]);

/** Natural-ish numeric sort so week-2 sorts before week-10. */
const byNumber = (a, b) => a.number - b.number;

function parseNumber(name, prefix) {
  const m = name.match(new RegExp(`^${prefix}-(\\d+)$`, "i"));
  return m ? parseInt(m[1], 10) : null;
}

/** Pull a human title from the first markdown heading, else fall back. */
async function titleFromMarkdown(file, fallback) {
  try {
    const text = await readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
      if (m) return m[1].trim();
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

async function listDirs(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

async function build() {
  if (!existsSync(COURSE_DIR)) {
    throw new Error(`No course/ directory found at ${COURSE_DIR}`);
  }

  const terms = [];

  for (const termName of await listDirs(COURSE_DIR)) {
    const termNumber = parseNumber(termName, "term");
    if (termNumber === null) continue;
    const termPath = path.join(COURSE_DIR, termName);

    const weeks = [];
    for (const weekName of await listDirs(termPath)) {
      const weekNumber = parseNumber(weekName, "week");
      if (weekNumber === null) continue;
      const weekPath = path.join(termPath, weekName);

      const files = await listFiles(weekPath);
      // Order docs so a "primary" doc (notes/index/readme/lecture) leads; the rest
      // follow alphabetically. The first doc supplies the week's title.
      const PRIORITY = ["index", "readme", "notes", "lecture", "overview"];
      const rank = (f) => {
        const base = f.toLowerCase().replace(/\.md$/, "");
        const i = PRIORITY.indexOf(base);
        return i === -1 ? PRIORITY.length : i;
      };
      const docs = files
        .filter((f) => f.toLowerCase().endsWith(".md"))
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }));
      const audioFiles = files
        .filter((f) => AUDIO_EXTS.has(path.extname(f).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (docs.length === 0 && audioFiles.length === 0) continue;

      const rel = `course/${termName}/${weekName}`;
      const primaryDoc = docs[0] ? path.join(weekPath, docs[0]) : null;
      const title = primaryDoc
        ? await titleFromMarkdown(primaryDoc, `Week ${weekNumber}`)
        : `Week ${weekNumber}`;

      weeks.push({
        id: `${termName}/${weekName}`,
        term: termNumber,
        number: weekNumber,
        slug: weekName,
        title,
        path: rel,
        docs,
        audio: audioFiles[0] || null,
      });
    }

    if (weeks.length === 0) continue;
    weeks.sort(byNumber);
    terms.push({
      id: termName,
      number: termNumber,
      title: `Term ${termNumber}`,
      slug: termName,
      weeks,
    });
  }

  terms.sort(byNumber);

  // Optional course-level metadata from course/course.json (title, description).
  let meta = { title: "History Course", description: "" };
  const metaPath = path.join(COURSE_DIR, "course.json");
  if (existsSync(metaPath)) {
    try {
      meta = { ...meta, ...JSON.parse(await readFile(metaPath, "utf8")) };
    } catch (e) {
      console.warn(`Could not parse course/course.json: ${e.message}`);
    }
  }

  const index = {
    title: meta.title,
    description: meta.description,
    generatedAt: new Date().toISOString(),
    terms,
  };

  await writeFile(OUTPUT, JSON.stringify(index, null, 2) + "\n", "utf8");

  const weekCount = terms.reduce((n, t) => n + t.weeks.length, 0);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT)}: ${terms.length} term(s), ${weekCount} week(s).`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
