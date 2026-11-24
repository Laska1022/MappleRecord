"use strict";

const captureButton = document.querySelector("#capture");
const feedback = document.querySelector("#feedback");
let formTab;
let recordId;
let capturedPage;

function showCount(count) {
  document.querySelector("#count").textContent = countText(count, "captured page");
}

function notice(text, error = false) {
  feedback.textContent = text;
  feedback.classList.toggle("error", error);
}

async function initialize() {
  const [tabs, catalog] = await Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), readCatalog()]);
  recordId = initialRecordId(catalog);
  setupRecordPicker(catalog, recordId);
  const record = await readRecord(recordId);
  const tab = tabs[0];
  showCount(record.pages.length);
  document.querySelector("#review").disabled = false;
  if (tab?.url && /^https?:\/\//i.test(tab.url)) {
    formTab = tab.id;
    document.querySelector("#tab-title").textContent = tab.title || "Portal page";
    document.querySelector("#site").textContent = new URL(tab.url).hostname;
    captureButton.disabled = false;
  } else {
    document.querySelector("#tab-title").textContent = "No web form selected";
    notice("Switch to the portal tab, then open Maple Record.");
  }
}

captureButton.addEventListener("click", async () => {
  captureButton.disabled = true;
  document.querySelector("#capture-result").hidden = true;
  notice("Reading the visible form…");
  try {
    const result = await changeRecord({ type: "capture", tabId: formTab, recordId });
    showCount(result.count);
    capturedPage = result.pageId;
    document.querySelector("#captured-title").textContent = result.title;
    document.querySelector("#captured-count").textContent = countText(result.fields, "field") + " captured";
    const notes = document.querySelector("#capture-notes");
    notes.replaceChildren();
    (result.warnings || []).forEach(text => {
      const li = document.createElement("li");
      li.textContent = text;
      notes.append(li);
    });
    document.querySelector("#capture-result").hidden = false;
    notice(result.duplicate ? "This version is already in your record." : "Page added. Review it or continue to the next form.");
  } catch (error) {
    notice(error.message, true);
  } finally {
    captureButton.disabled = false;
  }
});

document.querySelector("#review-capture").addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: recordUrl("review.html", recordId, capturedPage) });
    window.close();
  } catch (error) {
    notice(error.message, true);
  }
});

document.querySelector("#review").addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: recordUrl("review.html", recordId) });
    window.close();
  } catch (error) {
    notice(error.message, true);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[recordKey(recordId)]) showCount(changes[recordKey(recordId)].newValue?.pages.length || 0);
});
initialize().catch(error => notice(error.message, true));
