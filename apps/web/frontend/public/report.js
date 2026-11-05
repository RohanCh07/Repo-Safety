"use strict";
// Everything from the report is inserted with textContent, never as HTML:
// scanned repos are hostile and could put markup in file names or snippets.
const root = document.getElementById("root");
const id = location.pathname.split("/").pop();

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

const TITLES = { dangerous: "Dangerous", suspicious: "Suspicious", safe: "No known traps found" };

function render(scan) {
  root.replaceChildren();
  if (scan.status === "queued" || scan.status === "running") {
    root.append(el("p", {}, el("span", { class: "spinner" }), `Scanning ${scan.target}… this usually takes a few seconds.`));
    return false;
  }
  if (scan.status === "failed") {
    root.append(el("div", { class: "verdict dangerous" }, el("h1", {}, "Scan failed"), el("p", {}, scan.error || "Unknown error.")));
    return true;
  }
  const r = scan.report;
  root.append(
    el("div", { class: `verdict ${r.verdict}` },
      el("h1", {}, `${TITLES[r.verdict]} · ${r.score}/100`),
      el("p", {}, r.summary),
      el("p", { class: "loc" }, r.target)),
  );

  const url = location.href;
  const share = el("input", { type: "text", readonly: "", value: url, "aria-label": "Shareable link" });
  const copy = el("button", { type: "button" }, "Copy link");
  copy.addEventListener("click", async () => { await navigator.clipboard.writeText(url).catch(() => share.select()); copy.textContent = "Copied"; });
  root.append(el("div", { class: "share" }, share, copy));

  if (r.findings.length) root.append(el("h2", {}, `What we found (${r.findings.length})`));
  for (const f of r.findings) {
    root.append(
      el("div", { class: `finding ${f.severity}` },
        el("h3", {}, el("span", { class: "tag" }, f.severity), f.title),
        f.file ? el("div", { class: "loc" }, f.line ? `${f.file}:${f.line}` : f.file) : null,
        f.snippet ? el("pre", {}, f.snippet) : null,
        el("p", {}, f.explanation),
        f.recommendation ? el("p", { class: "todo" }, el("strong", {}, "What to do: "), f.recommendation) : null),
    );
  }
  const s = r.stats;
  root.append(el("p", { class: "fine" }, `Checked ${s.filesRead} of ${s.filesSeen} files in ${s.durationMs} ms. ${r.disclaimer}`));
  return true;
}

async function poll(delay = 800) {
  try {
    const res = await fetch(`/api/scans/${encodeURIComponent(id)}`);
    const body = await res.json();
    if (!res.ok) {
      root.replaceChildren(el("div", { class: "verdict dangerous" }, el("h1", {}, "Report not found"), el("p", {}, body.error || "")));
      return;
    }
    if (!render(body)) setTimeout(() => poll(Math.min(delay * 1.5, 4000)), delay);
  } catch {
    setTimeout(() => poll(Math.min(delay * 2, 8000)), delay);
  }
}
poll();
