"use strict";

const captureButton = document.querySelector("#capture");
const feedback = document.querySelector("#feedback");
let formTab;

function showCount(count) {
  document.querySelector("#count").textContent = countText(count, "captured page");
}

function notice(text, error = false) {
  feedback.textContent = text;
  feedback.classList.toggle("error", error);
}

async function initialize() {
  const [tabs, record] = await Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), readRecord()]);
  const tab = tabs[0];
  showCount(record.pages.length);
  if (tab?.url && /^https?:\/\//i.test(tab.url)) {
    formTab = tab.id;
    document.querySelector("#site").textContent = new URL(tab.url).hostname;
    captureButton.disabled = false;
  } else {
    document.querySelector("#site").textContent = "No web form selected";
    notice("Switch to the portal tab, then open Maple Record.");
  }
}

captureButton.addEventListener("click", async () => {
  captureButton.disabled = true;
  notice("Reading the visible form…");
  try {
    const result = await changeRecord({ type: "capture", tabId: formTab });
    showCount(result.count);
    notice(result.duplicate ? "This version of the page is already in your record." : "Page added. You can continue to the next portal page.");
  } catch (error) {
    notice(error.message, true);
  } finally {
    captureButton.disabled = false;
  }
});

document.querySelector("#review").addEventListener("click", async () => {
  try {
    await chrome.runtime.openOptionsPage();
    window.close();
  } catch (error) {
    notice(error.message, true);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[RECORD_KEY]) showCount(changes[RECORD_KEY].newValue?.pages.length || 0);
});
initialize().catch(error => notice(error.message, true));
