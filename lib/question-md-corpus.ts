/**
 * Optional on-bridge corpus loader.
 *
 * Keep this thin: onesong-ask-bridge does NOT vendor question-md-corpus.
 * Drop markdown under corpus/ (see corpus/README.md) if Live Ask should
 * resolve full paragraphs + neighbors. Without those files, expansion
 * still runs against File Search retrieved text and sets limitedContext
 * when that is not enough.
 */
import fs from "node:fs";
import path from "node:path";
import type { CorpusDoc } from "./citation-passage-context";

const SKIP_NAMES = new Set([
  "readme.md",
  ".gitkeep",
  ".ds_store",
]);

export function corpusRoot(cwd = process.cwd()): string {
  return path.join(cwd, "corpus");
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/);
    if (!kv) continue;
    meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { meta, body: raw.slice(m[0].length) };
}

function walkMd(dir: string, files: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(".") || name.startsWith("_")) continue;
    const full = path.join(dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkMd(full, files);
      continue;
    }
    if (!name.toLowerCase().endsWith(".md")) continue;
    if (SKIP_NAMES.has(name.toLowerCase())) continue;
    files.push(full);
  }
}

export function loadCorpus(root = corpusRoot()): CorpusDoc[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  walkMd(root, files);
  const docs: CorpusDoc[] = [];
  for (const full of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(root, full).split(path.sep).join("/");
    const { meta } = parseFrontmatter(raw);
    const teacherFromPath = rel.includes("/") ? rel.split("/")[0] : undefined;
    const titleFromName = path.basename(full, path.extname(full)).replace(/[_-]+/g, " ");
    docs.push({
      path: rel,
      teacher: meta.teacher || teacherFromPath,
      title: meta.title || titleFromName,
      text: raw,
    });
  }
  return docs;
}

let cached: CorpusDoc[] | undefined;

export function getCorpus(): CorpusDoc[] {
  if (!cached) cached = loadCorpus();
  return cached;
}

/** Test helper — do not use in production handlers. */
export function resetCorpusCache(): void {
  cached = undefined;
}
