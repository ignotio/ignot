// The verifier, run in the reader's browser: the same code the command line runs, on the same files.
import { esc, icon, type ExamEntry } from "./data";
import { verifyExam } from "./engine";
import type { AnswerFile } from "./types";

export const fetchAnswers = (entry: ExamEntry) => Promise.all(entry.answerUrls.map((url) => fetch(url).then((r) => r.json() as Promise<AnswerFile>)));

/** Fetch an exam's files, ask drand, and write every check into `list`. */
export async function verifyHere(entry: ExamEntry, list: HTMLElement) {
  list.innerHTML = `<li class="skip">Fetching the files and asking drand for the round...</li>`;
  try {
    const report = await verifyExam(entry);
    // A check that could not be made is not a check that passed, and the last line says how many there were. Two
    // reasons are known and only a matter of time: the round has not come yet, or no record contract is deployed yet
    // (the engine's wording for that ends in "record contract yet"); those checks are shown as waiting, not missing.
    const waitsFor = (c: { skipped?: boolean; detail?: string }) =>
      !c.skipped ? null : /record contract yet$/.test(c.detail ?? "") ? "the record contract" : /^sealed until /.test(c.detail ?? "") ? "the round" : null;
    const skips = report.checks.filter((c) => c.skipped);
    const waiting = new Map<string, number>();
    for (const c of skips) { const why = waitsFor(c); if (why) waiting.set(why, (waiting.get(why) ?? 0) + 1); }
    const onlyWaiting = skips.length > 0 && skips.every((c) => waitsFor(c));
    const verdict = !report.ok
      ? "A check failed."
      : skips.length === 0
        ? "Every check passes."
        : onlyWaiting
          ? `Every check that can be made passes. Still waiting: ${[...waiting].map(([why, n]) => `${["", "one", "two", "three"][n] ?? n} for ${why}`).join(", ")}.`
          : `No check failed. ${skips.length === 1 ? "One could" : `${skips.length} could`} not be made.`;
    const line = (c: (typeof report.checks)[number]) => {
      const why = waitsFor(c);
      if (why === "the record contract") return `waiting: ${esc(c.name)} (no record contract is deployed yet)`;
      if (why === "the round") return `waiting: ${esc(c.name)} (${esc(c.detail!)})`;
      return `${c.skipped ? "not checked: " : icon(c.ok)}${esc(c.name)}${c.detail ? `: ${esc(c.detail)}` : ""}`;
    };
    list.innerHTML =
      report.checks.map((c, i) => `<li class="${c.skipped ? "skip" : c.ok ? "" : "bad"}" style="--i:${i}">${line(c)}</li>`).join("") +
      `<li class="${report.ok ? "" : "bad"}" style="--i:${report.checks.length}"><b>${verdict}</b></li>`;
  } catch {
    list.innerHTML = `<li class="bad">${icon(false)}The files did not load. Check your connection and try again.</li>`;
  }
}
