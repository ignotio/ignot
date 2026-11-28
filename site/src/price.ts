// The price page: what one right answer cost each model in every exam that has opened, on either track. Every number
// is a results file's own (data.ts), drawn as the boards draw it; an exam joins once its results are published.
import "./nav";
import "./price.css";
import { TRACK_NOTES } from "./board";
import { $, esc, exams, modelMaker, modelName, now, usd, type ExamEntry } from "./data";
import type { ModelScore, Results, Track } from "./types";

const REHEARSAL = "pilot-00"; // the first exam was a rehearsal
const opened = exams.filter((e): e is ExamEntry & { results: Results } => !!e.results && e.opens <= now());
const examLink = (id: string) => `/exam.html?id=${encodeURIComponent(id)}`;
const title = (e: ExamEntry) => esc(e.manifest.title).replaceAll(" ", "&nbsp;"); // "Pilot 00" never breaks in two
const slug = (model: string) => model.replace(/[^a-z0-9]/gi, "-");
/** A change of price: what the later exam's right answer cost more (+) or less (-) than the earlier one's. */
const signed = (nano: number) => (nano === 0 ? usd(0) : `${nano < 0 ? "-" : "+"}${usd(Math.abs(nano))}`);
/** A price as usd() prints it, back in billionths: a change is worked out from the two prices beside it, so it adds up. */
const shown = (nano: number) => Math.round(Number(usd(nano).slice(1)) * 1e9);
type Cells = (ModelScore | undefined)[]; // one for each opened exam: undefined where the model did not sit it

// One scale for every exam and both tracks, from $0, in steps of 1, 2 or 5 in some power of ten, four steps at most.
const top = Math.max(1, ...opened.flatMap((e) => e.results.tracks.flatMap((t) => t.models.map((m) => m.costPerCorrectNanoUsd ?? 0))));
const step = [1, 2, 5].flatMap((k) => [1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11].map((p) => k * p)).sort((a, b) => a - b).find((s) => top <= 4 * s) ?? 1e12;
const steps = Math.ceil(top / step);
const decimals = Math.max(0, -Math.floor(Math.log10(step / 1e9) + 1e-9));
const scale = `<div class="prow pscale"><span></span><p class="pticks">${Array.from({ length: steps + 1 }, (_, i) => `<span style="--x:${(i / steps).toFixed(5)}">${i ? `$${((i * step) / 1e9).toFixed(decimals)}` : "$0"}</span>`).join("")}</p></div>`;

/** Each model on a track, cheapest right answer in the latest exam first, then most right; one that missed it last. */
function models(track: Track) {
  const sat = opened.map((e) => e.results.tracks.find((t) => t.track === track)?.models ?? []);
  const cheapest = sat.map((ms) => Math.min(...ms.map((m) => m.costPerCorrectNanoUsd ?? Infinity))); // as the boards: ties share the sphere
  const price = (m?: ModelScore) => m?.costPerCorrectNanoUsd ?? Infinity;
  const rows = [...new Set(sat.flat().map((m) => m.model))]
    .map((model) => ({ model, cells: sat.map((ms) => ms.find((m) => m.model === model)) }))
    .sort((a, b) => price(a.cells.at(-1)) - price(b.cells.at(-1)) || (b.cells.at(-1)?.correct ?? -1) - (a.cells.at(-1)?.correct ?? -1) || (a.model < b.model ? -1 : 1));
  return { rows, cheapest };
}

function table(track: Track) {
  const { rows, cheapest } = models(track);
  if (!rows.length) return `<p class="empty">No model has sat this track yet.</p>`;
  const before = opened.length > 1 ? opened.at(-2)! : undefined; // the change is shown between the last two exams
  const cell = (m: ModelScore | undefined, i: number) =>
    !m
      ? `<td class="num gone">did not sit</td>`
      : m.costPerCorrectNanoUsd === cheapest[i]
        ? `<td class="num per best">${usd(m.costPerCorrectNanoUsd)}<span class="vh"> (cheapest)</span><small>${m.correct}/${m.total} right</small></td>`
        : `<td class="num per">${m.costPerCorrectNanoUsd === null ? "none right" : usd(m.costPerCorrectNanoUsd)}<small>${m.correct}/${m.total} right</small></td>`;
  const change = (cells: Cells) => {
    const [a, b] = cells.slice(-2).map((m) => m?.costPerCorrectNanoUsd);
    return a == null || b == null ? `<td class="num gone">-</td>` : `<td class="num">${signed(shown(b) - shown(a))}</td>`; // "-": no price to compare
  };
  return (
    `<table aria-label="What one right answer cost each model, ${track === "unlimited" ? "no limit" : "same budget"}"><thead><tr><th scope="col">Model</th>` +
    opened.map((e) => `<th scope="col" class="num">${title(e)}${e.manifest.id === REHEARSAL ? "<span>rehearsal</span>" : ""}</th>`).join("") +
    (before ? `<th scope="col" class="num">Change<span>since ${title(before)}</span></th>` : "") +
    `</tr></thead><tbody>` +
    rows
      .map(
        (r) =>
          `<tr style="--vt:pt-${slug(r.model)}"><th scope="row"><b>${modelName(r.model)}</b> <span>${modelMaker(r.model)}</span></th>` +
          r.cells.map(cell).join("") +
          (before ? change(r.cells) : "") +
          `</tr>`,
      )
      .join("") +
    `</tbody></table>`
  );
}

/** The same numbers drawn: a copper line from $0 to each exam's price, the sphere where the cheapest one ends. */
function chart(track: Track) {
  const { rows, cheapest } = models(track);
  if (!rows.length) return "";
  const bar = (m: ModelScore | undefined, i: number) => {
    const quiet = i < opened.length - 1 ? " was" : ""; // an earlier exam
    const name = `<span>${title(opened[i]!)}</span>`;
    if (!m || m.costPerCorrectNanoUsd === null) return `<p class="pbar none${quiet}">${name}<em>${m ? "none right" : "did not sit"}</em></p>`;
    const best = m.costPerCorrectNanoUsd === cheapest[i] ? " best" : "";
    return `<p class="pbar${quiet}${best}" style="--x:${(m.costPerCorrectNanoUsd / (steps * step)).toFixed(5)}">${name}<i></i><em>${usd(m.costPerCorrectNanoUsd)}</em></p>`;
  };
  return (
    `<p class="pkey">length: what one right answer cost<span>sphere: cheapest in that exam</span><span>one scale for every exam and both tracks</span></p>` +
    scale +
    rows.map((r) => `<div class="prow" style="--vt:pc-${slug(r.model)}"><p class="pname">${modelName(r.model)}</p><div class="pbars">${r.cells.map(bar).join("")}</div></div>`).join("")
  );
}

if (opened.length) {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".tracks button")];
  const newest = () => ($("#table").scrollLeft = $("#table").scrollWidth); // too many exams for the screen: the newest stay beside the names
  const show = (track: Track) => {
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.track === track));
    // one note while every exam has had the same budget; where they differ, each exam's own
    const notes = opened.map((e) => TRACK_NOTES[track](e.results.budgetNanoUsd));
    $("#track-note").textContent = new Set(notes).size === 1 ? notes[0]! : opened.map((e, i) => `${e.manifest.title}: ${notes[i]}`).join(" ");
    $("#chart").innerHTML = chart(track);
    $("#table").innerHTML = table(track);
    newest();
  };
  // as on the boards: where the browser can, the rows slide to their new places and the pressed track slides across
  const swap = (track: Track) => {
    if (!document.startViewTransition) return show(track);
    document.documentElement.classList.add("swap");
    document.startViewTransition(() => show(track)).finished.finally(() => document.documentElement.classList.remove("swap"));
  };
  for (const b of buttons) b.addEventListener("click", () => swap(b.dataset.track as Track));
  $("#chart").style.setProperty("--n", String(steps));
  $("#foot").innerHTML =
    `<span class="legend">cheapest right answer in that exam</span>` +
    `<span>To check a number, open its exam: ${opened.map((e) => `<a href="${examLink(e.manifest.id)}">${title(e)}</a>`).join(", ")}. ` +
    `The exam's page grades every reply again, and its results.json under /exams/ holds each price as costPerCorrectNanoUsd, in billionths of a dollar. ` +
    `A change is the later price minus the earlier one, as shown.</span>`;
  show("same-budget");
  document.fonts.ready.then(newest); // the table can widen once its fonts arrive
} else {
  for (const el of document.querySelectorAll(".tracks, #track-note, #chart, #foot")) el.remove();
  $("#table").innerHTML = `<p class="empty">The first exam has been sealed. Its prices land here when it opens.</p>`;
}
