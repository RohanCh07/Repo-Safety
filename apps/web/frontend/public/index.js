"use strict";
const form = document.getElementById("url-form");
const input = document.getElementById("url");
const btn = document.getElementById("url-btn");
const drop = document.getElementById("drop");
const fileInput = document.getElementById("file");
const errorBox = document.getElementById("error");

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
  btn.disabled = false;
}

async function submit(request) {
  errorBox.hidden = true;
  btn.disabled = true;
  try {
    const res = await request();
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return showError(body.error || `Request failed (${res.status}).`);
    location.href = `/r/${body.id}`;
  } catch {
    showError("Couldn't reach the server. Check your connection and try again.");
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  submit(() => fetch("/api/scans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: input.value }) }));
});

function upload(file) {
  if (!file) return;
  if (!/\.zip$/i.test(file.name)) return showError("Please choose a .zip file.");
  if (file.size > 50 * 1024 * 1024) return showError("That file is larger than 50 MB.");
  drop.textContent = `Uploading ${file.name}…`;
  const data = new FormData();
  data.append("file", file);
  submit(() => fetch("/api/scans/upload", { method: "POST", body: data }));
}

fileInput.addEventListener("change", () => upload(fileInput.files[0]));
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); upload(e.dataTransfer.files[0]); });
