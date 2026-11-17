"use strict";

const RECORD_KEY = "applicationRecord";
const DEFAULT_TITLE = "Application record";

function emptyRecord() {
  return { title: DEFAULT_TITLE, pages: [] };
}

async function readRecord() {
  const stored = await chrome.storage.session.get(RECORD_KEY);
  return stored[RECORD_KEY] || emptyRecord();
}

async function changeRecord(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply?.ok) throw new Error(reply?.error || "The extension could not update your record.");
  return reply;
}

function countText(count, noun) {
  return count + " " + noun + (count === 1 ? "" : "s");
}
