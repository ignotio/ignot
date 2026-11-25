import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

const here = import.meta.dirname;
// The exam folders of this repository, or another set of them for a preview (IGNOT_EXAMS=/some/folder).
const examsDir = resolve(process.env.IGNOT_EXAMS ?? resolve(here, "../exams"));

// The token's address, from the one line that sets it (src/nav.ts), so the pages name it without a script.
function tokenAddress(): string {
  const ca = readFileSync(resolve(here, "src/nav.ts"), "utf8").match(/^const CA = "(0x[0-9a-fA-F]{40}|)";/m)?.[1];
  if (ca === undefined) throw new Error('src/nav.ts must set CA to the token\'s address (0x and 40 hex digits) or to ""');
  return ca;
}

// Every page shares one header and one footer: <!--part:name--> becomes parts/name.html when a page is served or built.
// Then the token: until its address is set, <!--token-->...<!--/token--> is dropped and <!--no-token-->...<!--/no-token-->
// is kept, so the pages say what they said before it; once it is set, the reverse, <!--ca--> becomes the address and
// <!--ca-end--> its last four digits (a phone shows the address cut in the middle: its start, then these).
const parts: Plugin = {
  name: "parts",
  transformIndexHtml: {
    order: "pre",
    handler: (html) => {
      const ca = tokenAddress();
      const page = html
        .replace(/<!--part:([a-z-]+)-->/g, (_, name: string) => readFileSync(resolve(here, "parts", `${name}.html`), "utf8"))
        .replace(/<!--(no-token|token)-->([\s\S]*?)<!--\/\1-->/g, (_, when: string, body: string) => ((when === "token") === (ca !== "") ? body : ""))
        .replaceAll("<!--ca-->", ca)
        .replaceAll("<!--ca-end-->", ca.slice(-4));
      if (/<!--\/?(no-)?token-->/.test(page)) throw new Error("a <!--token--> or <!--no-token--> marker has no end");
      return page;
    },
  },
};

// ---- what an exam's folder may hold
// The pages draw these files into HTML and the site republishes them, so the build reads them as strictly as the
// engine does: every field has the kind and the form it must have, and a file holds nothing else. A folder that
// does not fit stops the build; it is never drawn.
type Shape = (value: unknown) => boolean;
const whole: Shape = (v) => Number.isSafeInteger(v) && (v as number) >= 0;
const text: Shape = (v) => typeof v === "string";
const flag: Shape = (v) => typeof v === "boolean";
const like = (pattern: RegExp): Shape => (v) => typeof v === "string" && pattern.test(v);
const maybe = (shape: Shape): Shape => (v) => v === undefined || shape(v);
const orNull = (shape: Shape): Shape => (v) => v === null || shape(v);
const list = (shape: Shape): Shape => (v) => Array.isArray(v) && v.every(shape);
const object = (fields: Record<string, Shape>): Shape => (v) =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.keys(v).every((key) => Object.hasOwn(fields, key)) &&
  Object.entries(fields).every(([key, shape]) => shape((v as Record<string, unknown>)[key]));

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const hash = like(/^0x[0-9a-f]{64}$/);
const word = like(/^[A-Za-z0-9._-]{1,64}$/);
const line = like(/^[^\u0000-\u001f\u007f]{1,200}$/u);
const model = like(/^[!-~]{1,200}$/);
const track = like(/^(same-budget|unlimited)$/);
const question = like(/^q[0-9]{2,3}$/);
const moment = like(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/);
const generator = object({ name: word, version: word, commit: word });
const tx = like(/^0x[0-9a-fA-F]{64}$/);

const MANIFEST = object({
  format: whole,
  name: word,
  id: like(ID),
  examId: hash,
  title: line,
  openAt: moment,
  openRound: whole,
  drandChain: like(/^[0-9a-f]{64}$/),
  ciphertextSha256: hash,
  plaintextSha256: hash,
  questionCount: whole,
  generator,
  chain: maybe(object({ chainId: whole, contract: like(/^0x[0-9a-fA-F]{40}$/), sealTx: maybe(tx), publishTx: maybe(tx) })),
});
const EXAM = object({
  format: whole,
  id: like(ID),
  title: line,
  createdAt: moment,
  generator,
  seed: text,
  mix: list(object({ kind: word, level: whole, count: whole })),
  questions: list(object({ id: question, kind: word, level: whole, prompt: text, answer: text, grade: word })),
});
const ANSWERS = object({
  format: whole,
  examId: like(ID),
  model,
  records: list(
    object({
      model,
      track,
      questionId: question,
      raw: text,
      extracted: text,
      correct: flag,
      costNanoUsd: whole,
      promptTokens: whole,
      completionTokens: whole,
      maxTokens: whole,
      latencyMs: whole,
      finishReason: orNull(text),
      host: maybe(like(/^[ -~]{1,100}$/)),
      error: maybe(text),
    }),
  ),
});
const RESULTS = object({
  format: whole,
  examId: like(ID),
  budgetNanoUsd: whole,
  tracks: list(object({ track, models: list(object({ model, correct: whole, total: whole, costNanoUsd: whole, costPerCorrectNanoUsd: orNull(whole) })) })),
  leafCount: whole,
  resultsRoot: hash,
});

// A file's content once its shape has been checked: from here on it is used as what the shape says it is.
function read(dir: string, name: string, shape: Shape): any {
  const value: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
  if (!shape(value)) throw new Error(`${join(dir, name)} cannot be published: a field is missing, unknown or of the wrong kind`);
  return value;
}

// drand quicknet: round 1 at this second, one round every 3 seconds.
const roundTime = (round: number) => (1692803367 + (round - 1) * 3) * 1000;

// One exam's folder as the site publishes it: the manifest and the sealed file always; the opened exam, the
// answers and the results only once the round has passed. Nothing else in a folder is read or published, and
// what an exam cannot show yet is not shown, whatever its folder holds.
function folder(id: string) {
  const dir = join(examsDir, id);
  const manifest = read(dir, "manifest.json", MANIFEST);
  if (manifest.id !== id) throw new Error(`${dir} holds the exam ${manifest.id}: a folder is named after its exam`);
  const opened = roundTime(manifest.openRound) <= Date.now();
  const has = (name: string) => opened && existsSync(join(dir, name));
  const answers = has("answers")
    ? readdirSync(join(dir, "answers"))
        .filter((name) => /^[A-Za-z0-9._-]+\.json$/.test(name))
        .sort()
    : [];
  if (has("exam.json")) read(dir, "exam.json", EXAM);
  for (const name of answers) read(join(dir, "answers"), name, ANSWERS);
  const results = has("results.json") ? read(dir, "results.json", RESULTS) : null;
  const files = ["manifest.json", "exam.age", ...(has("exam.json") ? ["exam.json"] : []), ...(results ? ["results.json"] : []), ...answers.map((name) => `answers/${name}`)];
  return { id, dir, manifest, results, files };
}
const folders = () =>
  readdirSync(examsDir)
    .filter((id) => ID.test(id) && existsSync(join(examsDir, id, "manifest.json")))
    .sort()
    .map(folder);

// The folders are published as they are under /exams/, with one index at /api/exams.json, so a script can read
// what the pages read. Nothing here is computed: the index only lists what the folders hold.
function index(): string {
  const exams = folders().map(({ id, manifest, results, files }) => ({ manifest, results, files: files.map((name) => `/exams/${id}/${name}`) }));
  return JSON.stringify({ exams }, null, 2) + "\n";
}
// What the home page draws from the latest exam that has been opened and run: every question's kind and level, a
// sample of the first question of each kind, and every run's answers as one letter a question (r right, w wrong,
// n no answer) with what each cost. Nothing is judged here: the letters repeat what the answer files say.
function sheet(): string {
  const run = folders()
    .filter(({ files }) => files.includes("exam.json") && files.some((name) => name.startsWith("answers/")))
    .sort((a, b) => a.manifest.openRound - b.manifest.openRound)
    .pop();
  if (!run) return "null";
  const exam = read(run.dir, "exam.json", EXAM);
  const order: string[] = exam.questions.map((q: { id: string }) => q.id);
  const seen = new Set<string>();
  const questions = exam.questions.map((q: { id: string; kind: string; level: number; prompt: string; answer: string }) => {
    const first = !seen.has(q.kind) && !!seen.add(q.kind);
    return { id: q.id, kind: q.kind, level: q.level, ...(first ? { prompt: q.prompt.slice(0, 900), cut: q.prompt.length > 900, answer: q.answer } : {}) };
  });
  const runs = new Map<string, { model: string; track: string; marks: string[]; costs: number[] }>();
  for (const name of run.files.filter((name) => name.startsWith("answers/")))
    for (const r of read(run.dir, name, ANSWERS).records) {
      const key = `${r.track} ${r.model}`;
      if (!runs.has(key)) runs.set(key, { model: r.model, track: r.track, marks: [], costs: [] });
      const at = order.indexOf(r.questionId);
      if (at < 0) continue;
      runs.get(key)!.marks[at] = r.correct ? "r" : r.error || !r.extracted.trim() ? "n" : "w";
      runs.get(key)!.costs[at] = r.costNanoUsd;
    }
  // A run that skipped a question would leave a hole in its row; the hole is drawn as "no answer".
  const full = [...runs.values()].map((r) => ({ ...r, marks: order.map((_, i) => r.marks[i] ?? "n").join(""), costs: order.map((_, i) => r.costs[i] ?? 0) }));
  return JSON.stringify({ id: run.id, title: exam.title, questions, runs: full });
}

const published: Plugin = {
  name: "published-exams",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = decodeURIComponent((req.url ?? "").split("?")[0]!);
      if (path === "/api/exams.json") return res.setHeader("content-type", "application/json").end(index());
      // Only a file that the index lists is served: a path is matched against the list, never joined to a folder.
      const hit = path.startsWith("/exams/") ? folders().find(({ id, files }) => files.some((name) => path === `/exams/${id}/${name}`)) : undefined;
      if (!hit) return next();
      const name = path.slice(`/exams/${hit.id}/`.length);
      res.setHeader("content-type", name.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8").end(readFileSync(join(hit.dir, name)));
    });
  },
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "api/exams.json", source: index() });
    for (const { id, dir, files } of folders()) for (const name of files) this.emitFile({ type: "asset", fileName: `exams/${id}/${name}`, source: readFileSync(join(dir, name)) });
  },
};

// The headers the host sends with every file (Cloudflare Pages reads _headers). The page may run only its own
// scripts, the engine's WebAssembly and the inline scripts of the built pages (by their hashes, taken from the built
// files), and may talk only to this site, drand's relays and the record chain's node, both read from the engine's
// source so they cannot drift apart. The exam folders and their index are public data that scripts elsewhere may read.
let out = ""; // where the build writes, --outDir included
const headers: Plugin = {
  name: "headers",
  apply: "build",
  configResolved(config) {
    out = resolve(config.root, config.build.outDir);
  },
  closeBundle() {
    const inline = readdirSync(out)
      .filter((name) => name.endsWith(".html"))
      .flatMap((name) => [...readFileSync(join(out, name), "utf8").matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!))
      .map((code) => `'sha256-${createHash("sha256").update(code).digest("base64")}'`);
    const relays = readFileSync(resolve(here, "../crates/ignot-core/src/drand.rs"), "utf8").match(/RELAYS[^=]*=\s*\[([^\]]*)\]/)?.[1]?.match(/https:\/\/[^"]+/g) ?? [];
    const nodes = readFileSync(resolve(here, "../crates/ignot-core/src/chain.rs"), "utf8").match(/fn public_node[\s\S]*?\n}/)?.[0].match(/https:\/\/[^"]+/g) ?? [];
    if (relays.length < 2 || nodes.length < 1) throw new Error("the relays or the chain node were not found in the engine's source");
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'wasm-unsafe-eval' ${[...new Set(inline)].join(" ")} https://static.cloudflareinsights.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src 'self' ${[...relays, ...nodes].join(" ")} https://cloudflareinsights.com`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    const rules = {
      "/*": [
        `Content-Security-Policy: ${csp}`,
        "X-Content-Type-Options: nosniff",
        "X-Frame-Options: DENY",
        "Referrer-Policy: strict-origin-when-cross-origin",
        "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        "Cross-Origin-Opener-Policy: same-origin",
        "Strict-Transport-Security: max-age=31536000",
      ],
      "/assets/*": ["Cache-Control: public, max-age=31536000, immutable"],
      "/exams/*": ["Access-Control-Allow-Origin: *", "Cache-Control: public, max-age=300"],
      "/api/*": ["Access-Control-Allow-Origin: *", "Cache-Control: public, max-age=60"],
    };
    writeFileSync(join(out, "_headers"), Object.entries(rules).map(([path, lines]) => `${path}\n${lines.map((l) => `  ${l}`).join("\n")}\n`).join(""));
  },
};

export default defineConfig({
  plugins: [parts, published, headers],
  define: { __EXAMS__: index(), __SHEET__: sheet() }, // the same index, for the pages themselves, and the answer sheet
  build: { rollupOptions: { input: ["index.html", "exam.html", "docs.html", "404.html"].map((page) => resolve(here, page)) } },
});
