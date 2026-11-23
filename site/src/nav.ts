// Shared by every page: the phone menu, the header's ground, and the links that exist only once they are set.
import "./style.css";
import "./sections.css";

// The token's contract address on Robinhood Chain: 0x and 40 hex digits, or nothing until the token exists. This line
// is the one place it is set. The build reads it from here (vite.config.ts) and writes it into every page; while it
// is empty the pages say what they said before the token.
const CA = "";

const LINKS: Record<string, string> = {
  repo: "https://github.com/ignotio/ignot",
  x: "https://x.com/ignotexam",
  token: CA && `https://robinhoodchain.blockscout.com/token/${CA}`, // the chain's official explorer
}; // a link is shown once it exists

const header = document.querySelector<HTMLElement>(".nav")!;
const menu = header.querySelector<HTMLButtonElement>(".menu")!;
const set = (open: boolean) => {
  header.classList.toggle("open", open);
  menu.setAttribute("aria-expanded", String(open));
};
menu.addEventListener("click", () => set(!header.classList.contains("open")));
header.querySelector("nav")!.addEventListener("click", () => set(false));
addEventListener("keydown", (e) => e.key === "Escape" && set(false));

// At the very top of the first screen the header is part of the sky; as soon as the page moves it is black glass.
const hero = document.querySelector(".hero");
if (hero) {
  const top = hero.appendChild(Object.assign(document.createElement("i"), { className: "top-mark" }));
  new IntersectionObserver(([entry]) => header.classList.toggle("solid", !entry!.isIntersecting)).observe(top);
} else header.classList.add("solid");

for (const a of document.querySelectorAll<HTMLAnchorElement>("[data-link]")) {
  const href = LINKS[a.dataset.link!];
  if (href) a.href = href;
  else a.remove();
}

// Wherever the address is named it can be copied, and the line beside the button says so, quietly.
for (const ca of document.querySelectorAll(".ca")) {
  const said = ca.querySelector("[aria-live]")!;
  let quiet: number | undefined;
  ca.querySelector("button")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(CA);
      said.textContent = "Copied";
    } catch {
      said.textContent = "Select the address to copy it";
    }
    clearTimeout(quiet);
    quiet = window.setTimeout(() => (said.textContent = ""), 2400);
  });
}
