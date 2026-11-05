import { DEFAULT_API } from "./shared.js";

const input = document.getElementById("api") as HTMLInputElement;
const status = document.getElementById("status")!;

chrome.storage.sync.get("api").then(({ api }) => {
  input.value = typeof api === "string" && api ? api : DEFAULT_API;
});

document.getElementById("save")!.addEventListener("click", async () => {
  let url: URL;
  try {
    url = new URL(input.value.trim());
  } catch {
    status.textContent = "That isn't a valid URL.";
    return;
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    status.textContent = "Use https (http is only allowed for localhost).";
    return;
  }
  // Ask for permission to call a custom server; the default localhost one is already allowed.
  const origin = `${url.origin}/*`;
  const granted = url.hostname === "localhost" || (await chrome.permissions.request({ origins: [origin] }));
  if (!granted) {
    status.textContent = "Permission denied, not saved.";
    return;
  }
  await chrome.storage.sync.set({ api: url.origin });
  status.textContent = "Saved.";
});
