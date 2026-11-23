// The sections under the first screen. Each one shows a real thing from the exam folders or does a real thing here.
import { board } from "./board";
import { $, DOT, count, countdown, esc, exams, icon, latestResults, local, modelName, now, roundAt, roundAtOrAfter, roundTime, sheet as marked, short, upcoming, usd, utc, WEEK, type ExamEntry } from "./data";
import { engine, fetchBeacon } from "./engine";
import type { Exam } from "./types";
import { verifyHere } from "./verify";

const next = upcoming();
const done = latestResults();
const round = count.format(next.manifest.openRound);
const stamp = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
const examLink = (id: string) => `/exam.html?id=${encodeURIComponent(id)}`;

const NEXT: Record<string, string> = { title: next.manifest.title, questions: String(next.manifest.questionCount), round };
for (const el of document.querySelectorAll<HTMLElement>("[data-next]")) el.textContent = NEXT[el.dataset.next!]!;

// ---- the paper on the desk: the sealed file itself, and a real attempt to open it
const sheet = $(".sheet");
const turn = $<HTMLButtonElement>("#turn");
const turnSay = $("#turn-result");
let cipher: Promise<string> | undefined;
const sealedText = () => (cipher ??= fetch(next.sealedUrl).then((r) => r.text()));
// the back of the paper is the file as it is; fetched once the page has settled, not while the reader scrolls
(window.requestIdleCallback ?? setTimeout)(async () => {
  const text = await sealedText();
  $(".sheet-cipher").textContent = text.slice(0, 1500);
  $("#envelope-size").textContent = `${count.format(text.length)} bytes`;
  $("#stump-cipher").textContent = text.split("\n").slice(0, 9).join("\n");
});

// ---- what the envelope says about itself: the manifest's own numbers, which anyone can check against the file
const sealedNow = next.opens > now();
$("#envelope").innerHTML = [
  ["Inside", `${next.manifest.questionCount} questions and their keys`],
  [sealedNow ? "Opens" : "Opened", `${utc(next.opens)}${DOT}round ${round}`],
  ["Sealed file", `sha256 ${short(next.manifest.ciphertextSha256)}`],
  ["Paper inside", `sha256 ${short(next.manifest.plaintextSha256)}`],
  ["Size", `<span id="envelope-size">fetching</span>`],
]
  .map(([name, value]) => `<dt>${name}</dt><dd>${value}</dd>`)
  .join("");

function showFront(exam: Exam) {
  $(".sheet-questions").innerHTML = exam.questions
    .slice(0, 3)
    .map((q) => `<li>${esc(q.prompt.slice(0, 150))}${q.prompt.length > 150 ? "..." : ""}</li>`)
    .join("");
}

turn.addEventListener("click", async () => {
  turn.disabled = true;
  turnSay.className = "say";
  turnSay.textContent = "Asking drand for the key...";
  try {
    // drand is asked whatever the clock of this device says. Before the round the key does not exist yet,
    // anywhere, and the relays say so; the clock only words the refusal below.
    const [{ openExam }, beacon, manifest] = await Promise.all([engine(), fetchBeacon(next.manifest.openRound), fetch(next.manifestUrl).then((r) => r.text())]);
    showFront(JSON.parse(openExam(new TextEncoder().encode(await sealedText()), beacon, manifest)) as Exam);
    sheet.classList.add("turned");
    turnSay.className = "say ok";
    turnSay.innerHTML = `${icon(true)}Open. Round ${round} has signed, and the paper matches the hash recorded when it was sealed. <a href="${examLink(next.manifest.id)}">Read the whole exam</a>`;
  } catch {
    const early = Date.now() < next.opens;
    if (early) {
      sheet.classList.remove("refused");
      void sheet.offsetWidth; // start the lift again on every try
      sheet.classList.add("refused");
    }
    turnSay.className = "say no";
    turnSay.innerHTML = early
      ? `${icon(false)}Not yet. The key to this paper is the signature of drand round ${round}, and that round does not exist until ${utc(next.opens)}.`
      : `${icon(false)}drand did not answer. Check your connection and try again.`;
  }
  turn.disabled = false;
});

// ---- the tape along the top of the paper: what the clock and the folders say right now
const best = done?.results!.tracks.find((t) => t.track === "same-budget")?.models.reduce((a, b) => (b.correct > a.correct ? b : a));
const cheap = done?.results!.tracks.flatMap((t) => t.models).reduce((a, b) => ((b.costPerCorrectNanoUsd ?? Infinity) < (a.costPerCorrectNanoUsd ?? Infinity) ? b : a));
const facts = [
  `drand round <b data-round></b>`,
  next.opens > now() ? `${esc(next.manifest.title)} opens in <b data-until="${next.opens}"></b>` : `${esc(next.manifest.title)} is open`,
  `sealed file sha256 <b>${short(next.manifest.ciphertextSha256)}</b>`,
  ...(done && best && cheap
    ? [
        `${esc(done.manifest.title)}: <b>${count.format(done.results!.leafCount)}</b> answers graded`,
        `most right on the same budget: <b>${best.correct}/${best.total}</b> ${modelName(best.model)}`,
        `cheapest right answer: <b>${usd(cheap.costPerCorrectNanoUsd ?? 0)}</b> ${modelName(cheap.model)}`,
        `results root <b>${short(done.results!.resultsRoot)}</b>`,
      ]
    : []),
]
  .map((fact) => `<span>${fact}</span>`)
  .join("");
$("#tape").innerHTML = facts + facts; // twice, so the run can loop without a seam
// it only runs while some of it is really on screen (touching the edge of the screen does not count)
new IntersectionObserver(([entry]) => $("#tape").classList.toggle("on", entry!.intersectionRatio > 0), { threshold: 0.05 }).observe($(".tape"));

// ---- what was on the last opened paper: ten kinds of question, one of each to read
const KINDS: Record<string, string> = {
  trace: "Trace a program",
  table: "Filter a table",
  graph: "Find the shortest path",
  strings: "Transform a string",
  queue: "Run a teller queue",
  bases: "Add in mixed bases",
  stack: "Run a stack machine",
  robot: "Walk a robot on a grid",
  counting: "Count the digits",
  chain: "Solve a two-part chain",
};
const last = marked; // the latest exam that has been opened and run
if (last) {
  const kinds = [...new Set(last.questions.map((q) => q.kind))];
  const rightAt = (i: number) => last.runs.filter((run) => run.marks[i] === "r").length;
  $("#kinds").hidden = false;
  $("#kinds-from").textContent = last.title;
  $("#kind-list").innerHTML = kinds
    .map((kind) => {
      const at = last.questions.flatMap((q, i) => (q.kind === kind ? [i] : []));
      const right = at.reduce((sum, i) => sum + rightAt(i), 0);
      return `<button type="button" data-kind="${kind}" aria-pressed="false"><b>${KINDS[kind] ?? kind}</b><span>${right} of ${at.length * last.runs.length} right</span><i style="--s:${(right / (at.length * last.runs.length)).toFixed(3)}"></i></button>`;
    })
    .join("");
  const slip = $("#slip");
  const show = (kind: string) => {
    const i = last.questions.findIndex((q) => q.kind === kind && q.prompt !== undefined);
    const q = last.questions[i]!;
    for (const b of document.querySelectorAll<HTMLElement>("#kind-list button")) b.setAttribute("aria-pressed", String(b.dataset.kind === kind));
    slip.innerHTML =
      `<p class="slip-head"><span>${esc(last.title)}${DOT}${esc(q.id)}</span><span>${kind}, level ${q.level}</span></p>` +
      `<pre${q.cut ? ' class="cut"' : ""}>${esc(q.prompt!)}</pre>` +
      `<p class="slip-key">Answer key: ${esc(q.answer!)}</p>` +
      `<p class="slip-foot"><span>${rightAt(i)} of ${last.runs.length} runs got it right</span><a href="${examLink(last.id)}#${q.id}">Read every reply</a></p>`;
    slip.classList.remove("turn");
    void slip.offsetWidth; // the new slip comes up again
    slip.classList.add("turn");
  };
  $("#kind-list").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("button");
    if (b) show(b.dataset.kind!);
  });
  show(kinds[0]!);

  // ---- every answer on one sheet: a square for each, grouped by kind, easier to harder
  const runs = [...last.runs].sort((a, b) => (a.track === b.track ? [...b.marks].filter((m) => m === "r").length - [...a.marks].filter((m) => m === "r").length : a.track === "same-budget" ? -1 : 1));
  const WORD: Record<string, string> = { r: "right", w: "wrong", n: "no answer" };
  const track = (t: string) => (t === "unlimited" ? "no limit" : "same budget");
  $("#answers").hidden = false;
  $("#answers-sub").textContent = `${last.title}: ${last.questions.length} questions, ${runs.length} runs, ${count.format(last.questions.length * runs.length)} answers. Pick a square to read what the model wrote.`;
  const grid = $("#ans-grid");
  grid.setAttribute("aria-label", runs.map((run) => `${modelName(run.model)}, ${track(run.track)}: ${[...run.marks].filter((m) => m === "r").length} of ${run.marks.length} right`).join(". "));
  grid.innerHTML =
    `<div class="ans-row ans-head"><span></span><div class="ans-cells">${kinds.map((kind) => `<span>${kind}</span>`).join("")}</div><span></span></div>` +
    runs
      .map((run, row) => {
        const cells = kinds
          .map(
            (kind) =>
              `<span class="ans-group">${last.questions
                .map((q, i) =>
                  q.kind === kind
                    ? `<a class="${run.marks[i]}" tabindex="-1" href="${examLink(last.id)}#${q.id}" data-say="${q.id}${DOT}${kind}, level ${q.level}${DOT}${modelName(run.model)}, ${track(run.track)}${DOT}${WORD[run.marks[i]!]}${DOT}${usd(run.costs[i]!)}"></a>`
                    : "",
                )
                .join("")}</span>`,
          )
          .join("");
        const split = row > 0 && runs[row - 1]!.track !== run.track ? " split" : "";
        return `<div class="ans-row${split}" style="--i:${row}"><p><b>${modelName(run.model)}</b><span>${track(run.track)}</span></p><div class="ans-cells">${cells}</div><p class="ans-sum">${[...run.marks].filter((m) => m === "r").length}<span>/${run.marks.length}</span></p></div>`;
      })
      .join("");
  const read = $("#ans-read");
  const resting = read.textContent;
  grid.addEventListener("pointerover", (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>("a");
    read.textContent = cell ? cell.dataset.say! : resting;
  });
  grid.addEventListener("pointerleave", () => (read.textContent = resting));
}

// ---- the public clock itself: drand's newest round, fetched while this panel is on screen and checked here against
// drand's public key by the same engine that opens the exams
const pulse = { round: $("#pulse-round"), run: $("#pulse-run"), next: $("#pulse-next"), hex: $("#pulse-hex"), check: $("#pulse-check") };
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
let pulsing = 0;
async function pulseOnce() {
  if (document.hidden) return;
  const at = roundAt(now());
  const gap = next.manifest.openRound - at;
  try {
    const answer = JSON.parse(await fetchBeacon(at)) as { signature?: unknown };
    pulse.round.textContent = count.format(at);
    pulse.hex.textContent = typeof answer.signature === "string" ? answer.signature : "";
    pulse.check.innerHTML = `${icon(true)}Round ${count.format(at)} checks out: its signature verifies against drand's public key, here, in your browser.`;
  } catch {
    pulse.round.textContent = count.format(at);
    pulse.check.innerHTML = `${icon(false)}No relay has given round ${count.format(at)} yet, so the number above is counted from this device's clock.`;
  }
  pulse.next.textContent =
    gap > 0 ? `${next.manifest.title} opens at round ${round}, ${count.format(gap)} rounds from now.` : `${next.manifest.title} opened at round ${round}, ${count.format(-gap)} rounds ago.`;
  // a line that fills in the three seconds until the next round
  if (!calm) pulse.run.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 3000, delay: -(now() - roundTime(at)), easing: "linear", fill: "forwards" });
}
const pulseLater = () => {
  // a little after the next round is out, so the relays have its signature
  pulsing = window.setTimeout(() => {
    void pulseOnce();
    pulseLater();
  }, roundTime(roundAt(now()) + 1) - now() + 1200);
};
new IntersectionObserver(([entry]) => {
  if (entry!.isIntersecting && !pulsing) {
    void pulseOnce();
    pulseLater();
  } else if (!entry!.isIntersecting && pulsing) {
    clearTimeout(pulsing);
    pulsing = 0;
  }
}).observe($("#pulse"));
pulse.round.textContent = count.format(roundAt(now()));

// ---- how it stays sealed: three facts from the folders
const opened = exams.filter((e) => e.opens <= now()).pop();
$("#fact-sealed").innerHTML = `sha256 ${short(next.manifest.ciphertextSha256)}<br>drand round ${round}`;
$("#fact-opened").innerHTML = opened
  ? `${esc(opened.manifest.title)} opened at round ${count.format(opened.manifest.openRound)}<br>${stamp(opened.opens)}`
  : `${esc(next.manifest.title)} opens at round ${round}<br>${stamp(next.opens)}`;
$("#fact-graded").innerHTML = done
  ? `results root ${short(done.results!.resultsRoot)}<br>${count.format(done.results!.leafCount)} answers`
  : "the first answers are being graded";

// ---- the price of intelligence
if (done) {
  const results = done.results!;
  $("#board-sub").textContent = `What one right answer cost each model in ${done.manifest.title}.`;
  board(done, $("#leaderboard"));
  $("#board-foot").innerHTML =
    `<span class="legend">cheapest right answer</span>` +
    `<span>${count.format(results.leafCount)} answers${DOT}results root ${short(results.resultsRoot)}${DOT}<a href="${examLink(done.manifest.id)}">Read every answer</a></span>`;
} else {
  $("#board-sub").textContent = "What one right answer costs each model.";
  $("#board").innerHTML = `<p class="empty">The first exam has been sealed. Its results land here when it opens.</p>`;
}

// ---- every exam: a sealed one counts down along its week, an open one shows what it gave
const along = (e: ExamEntry) => Math.min(1, Math.max(0, 1 - (e.opens - now()) / WEEK)).toFixed(4);
const best3 = (e: ExamEntry) =>
  [...(e.results?.tracks.find((t) => t.track === "same-budget")?.models ?? [])]
    .sort((a, b) => b.correct - a.correct || (a.costPerCorrectNanoUsd ?? Infinity) - (b.costPerCorrectNanoUsd ?? Infinity))
    .slice(0, 3);
$("#exam-list").innerHTML = [...exams]
  .reverse()
  .map((e) => {
    const sealed = e.opens > now();
    const state = sealed ? "sealed" : e.results ? "open, graded" : "open";
    const middle = sealed
      ? `<p class="exam-big" data-until="${e.opens}"></p><p class="exam-sub">opens ${utc(e.opens)}${DOT}${local(e.opens)} your time</p>`
      : `<p class="exam-big">${e.results ? `${count.format(e.results.leafCount)} answers` : "open"}</p><p class="exam-sub">opened ${utc(e.opens)}</p>` +
        (e.results
          ? `<ol class="exam-top">${best3(e)
              .map((m) => `<li><b>${modelName(m.model)}</b><span>${m.correct}/${m.total}</span><span>${m.costPerCorrectNanoUsd === null ? "none right" : usd(m.costPerCorrectNanoUsd)}</span></li>`)
              .join("")}</ol>`
          : "");
    return (
      `<a class="exam-card${sealed ? " sealed" : ""}" href="${examLink(e.manifest.id)}" style="--p:${along(e)}">` +
      `<div class="exam-head"><h3>${esc(e.manifest.title)}</h3><span class="exam-state${sealed ? " sealed" : ""}">${state}</span></div>` +
      `<div class="exam-mid">${middle}</div>` +
      `<div class="exam-side"><span class="exam-week" aria-hidden="true"><i></i></span>` +
      `<p class="exam-facts">drand round ${count.format(e.manifest.openRound)}<br>sealed file ${short(e.manifest.ciphertextSha256)}<br>${e.manifest.questionCount} questions</p>` +
      `<span class="go">${sealed ? "See the seal" : e.results ? "See the answers" : "Read the exam"}</span></div></a>`
    );
  })
  .join("");
const sealedCards = [...document.querySelectorAll<HTMLElement>(".exam-card.sealed")];

// ---- seal something of your own, here
const say = $("#seal-result");
const sealForm = $<HTMLFormElement>("#seal-form");
const receipt = { title: $("#receipt-title"), round: $("#receipt-round"), when: $("#receipt-when"), within: $("#receipt-in"), file: $("#receipt-file") };
let made: number | undefined; // the round of the seal made in this page, once there is one
const showReceipt = () => {
  const at = made ?? roundAtOrAfter(now() + Number(new FormData(sealForm).get("when")));
  receipt.round.textContent = count.format(at);
  receipt.when.textContent = `${utc(roundTime(at))}${DOT}${local(roundTime(at))} your time`;
  receipt.within.textContent = countdown(roundTime(at) - now());
};
// changing what is sealed, or when, makes a new seal: the receipt goes back to showing the one about to be made
sealForm.addEventListener("input", () => {
  if (made === undefined) return showReceipt();
  made = undefined;
  receipt.title.textContent = "your seal, before it is made";
  receipt.file.hidden = true;
  showReceipt();
});
const fail = (words: string) => {
  say.className = "say no";
  say.innerHTML = icon(false) + words;
};
let sealings = 0;
$<HTMLFormElement>("#seal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const attempt = ++sealings;
  const form = e.currentTarget as HTMLFormElement;
  const file = $<HTMLInputElement>("#seal-file").files?.[0];
  const text = $<HTMLTextAreaElement>("#seal-text").value;
  const delay = Number(new FormData(form).get("when"));
  if (!(delay > 0 && Number.isFinite(delay))) return fail("Choose when it opens.");
  if (!file && !text.trim()) return fail("Write something or choose a file first.");
  const data = file ? new Uint8Array(await file.arrayBuffer()) : new TextEncoder().encode(text);
  if (data.byteLength > 2_000_000) return fail("That is over 2 MB. The command line seals big files.");
  say.className = "say";
  say.textContent = "Sealing...";
  try {
    // Sealing needs nobody: the round's public key is known in advance, and nothing leaves this page.
    const { seal, roundAtOrAfter } = await engine();
    const round = roundAtOrAfter(Date.now() + delay);
    const opens = roundTime(round);
    // The clock of this device may be behind, and a seal to a round drand has published already would open at
    // once for anyone. The relays are asked for that round, all at once; no answer within a few seconds counts
    // as no, and an answer that comes later still takes the file back.
    const behind = `drand has published round ${count.format(round)} already, so the clock of this device is behind. Set it and try again.`;
    const published = fetchBeacon(round).then(
      () => true,
      () => false,
    );
    if (await Promise.race([published, new Promise<boolean>((done) => setTimeout(() => done(false), 4000))])) return fail(behind);
    const armored = seal(data, round);
    const href = URL.createObjectURL(new Blob([armored], { type: "text/plain" }));
    made = round;
    receipt.title.textContent = "your seal";
    receipt.file.textContent = armored.split("\n").slice(0, 7).join("\n");
    receipt.file.hidden = false;
    showReceipt();
    say.className = "say ok";
    say.innerHTML =
      `${icon(true)}Sealed to drand round ${count.format(round)}. It opens ${utc(opens)} (${local(opens)} your time). ` +
      `<a download="${esc((file?.name ?? "sealed") + ".age")}" href="${href}">Download the sealed file</a>`;
    void published.then((late) => {
      if (!late) return;
      URL.revokeObjectURL(href);
      if (attempt === sealings) fail(behind);
    });
  } catch {
    fail("That could not be sealed here. Reload the page and try again.");
  }
});
$<HTMLInputElement>("#open-file").addEventListener("change", async (e) => {
  sealings++; // what this tool says is newer than any seal still waiting on a relay
  const input = e.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  input.value = "";
  say.className = "say";
  say.textContent = "Asking drand for the key...";
  try {
    const sealed = new Uint8Array(await file.arrayBuffer());
    const { open, sealedRound } = await engine();
    let round: number;
    try {
      round = sealedRound(sealed);
    } catch {
      return fail("That is not a sealed file.");
    }
    // drand is asked whatever the clock of this device says; that clock only words the refusal.
    const beacon = await fetchBeacon(round).catch(() => undefined);
    if (!beacon)
      return fail(
        Date.now() < roundTime(round)
          ? `Not before round ${count.format(round)}, which is ${utc(roundTime(round))}.`
          : "drand did not answer. Check your connection and try again.",
      );
    const bytes = open(sealed, beacon);
    const href = URL.createObjectURL(new Blob([bytes.slice()]));
    say.className = "say ok";
    say.innerHTML = `${icon(true)}Open: ${count.format(bytes.byteLength)} bytes. <a download="${esc(file.name.replace(/\.age$/, ""))}" href="${href}">Download what was inside</a>`;
  } catch {
    fail("That did not open. The file may be damaged, or drand did not answer.");
  }
});

// ---- exam night, and the links that depend on what exists
$("#night-next").innerHTML =
  next.opens > now()
    ? `Next: ${esc(next.manifest.title)}, ${utc(next.opens)} (${local(next.opens)} your time), in <span data-until="${next.opens}"></span>`
    : `${esc(next.manifest.title)} opened ${utc(next.opens)}.`;
const proven = done ?? next;
const prove = $<HTMLButtonElement>("#proof-run");
prove.textContent = `Check ${proven.manifest.title} here`;
$<HTMLAnchorElement>("#proof-exam").href = examLink(proven.manifest.id);
prove.addEventListener("click", async () => {
  prove.disabled = true;
  await verifyHere(proven, $("#proof-checks"));
  prove.textContent = `Check ${proven.manifest.title} again`;
  prove.disabled = false;
});
// the check runs by itself the first time it comes into view: the proof is the section, not a promise of one
new IntersectionObserver(([entry], watch) => {
  if (!entry!.isIntersecting) return;
  watch.disconnect();
  if (!prove.disabled) prove.click();
}, { threshold: 0.4 }).observe($("#proof-checks"));

const until = [...document.querySelectorAll<HTMLElement>("[data-until]")];
const rounds = [...document.querySelectorAll<HTMLElement>("[data-round]")];
const beat = () => {
  for (const el of until) el.textContent = countdown(Number(el.dataset.until) - now());
  for (const el of rounds) el.textContent = count.format(roundAt(now())); // drand's newest round, counted from the clock
  for (const card of sealedCards) card.style.setProperty("--p", along(exams.find((e) => card.getAttribute("href") === examLink(e.manifest.id))!));
  showReceipt();
};
beat();
setInterval(beat, 1000);
