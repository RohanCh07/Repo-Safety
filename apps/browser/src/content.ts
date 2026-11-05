import { badgeLabel, repoFromPath, type BadgeState, type Message, type RepoPage } from "./shared.js";

const BADGE_ID = "repo-safety-badge";
let currentKey = "";

function render(state: BadgeState) {
  let badge = document.getElementById(BADGE_ID) as HTMLButtonElement | null;
  if (!badge) {
    badge = document.createElement("button");
    badge.id = BADGE_ID;
    badge.className = "repo-safety-badge";
    badge.type = "button";
    // Next to the repo name when GitHub's header is there; otherwise float in the corner.
    const anchor = document.querySelector('#repository-container-header strong[itemprop="name"], [data-testid="repository-name-heading"], main h1');
    if (anchor?.parentElement) anchor.parentElement.append(badge);
    else {
      badge.classList.add("floating");
      document.body.append(badge);
    }
  }
  const { text, title } = badgeLabel(state);
  const dot = document.createElement("span");
  dot.className = "repo-safety-dot";
  badge.replaceChildren(dot, document.createTextNode(text));
  badge.title = title;
  badge.dataset.verdict = state.verdict;
  badge.onclick = state.reportUrl ? () => window.open(state.reportUrl, "_blank", "noopener") : null;
}

function check() {
  const page: RepoPage | undefined = repoFromPath(location.pathname);
  const key = page ? `${page.owner}/${page.repo}@${page.ref ?? ""}` : "";
  if (key === currentKey && document.getElementById(BADGE_ID)) return;
  currentKey = key;
  document.getElementById(BADGE_ID)?.remove();
  if (!page) return;
  render({ verdict: "scanning" });
  const msg: Message = { type: "check", page };
  chrome.runtime.sendMessage(msg).then((state: BadgeState) => {
    if (currentKey === key && state) render(state);
  }).catch(() => render({ verdict: "error" }));
}

// GitHub navigates without full page loads, so re-check when the URL changes.
check();
document.addEventListener("turbo:load", check);
window.addEventListener("popstate", check);
let lastPath = location.pathname;
new MutationObserver(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    check();
  }
}).observe(document.documentElement, { childList: true, subtree: true });
