"use strict";
importScripts("shared.js", "capture.js");

let queue = Promise.resolve();
let portalValues;

async function capture(tabId) {
  if (!portalValues) {
    const response = await fetch(chrome.runtime.getURL("portal-values.json"));
    if (!response.ok) throw new Error("The portal answer labels could not be loaded.");
    portalValues = await response.json();
  }
  let frame;
  try {
    [frame] = await chrome.scripting.executeScript({
      target: { tabId },
      func: captureForm,
      args: [portalValues]
    });
  } catch {
    throw new Error("Open the portal form, then click the extension icon and try again.");
  }
  if (!frame?.result) throw new Error("The page could not be read. Open the form and try again.");
  if (frame.result.error) throw new Error(frame.result.error);
  const record = await readRecord();
  const snapshot = frame.result;
  const duplicate = record.pages.find(page =>
    page.documentId === frame.documentId && page.title === snapshot.title &&
    JSON.stringify(page.items) === JSON.stringify(snapshot.items)
  );
  if (duplicate) return { duplicate: true, count: record.pages.length };
  record.pages.push({
    ...snapshot, id: crypto.randomUUID(), documentId: frame.documentId,
    capturedAt: new Date().toISOString(), excluded: []
  });
  await chrome.storage.session.set({ [RECORD_KEY]: record });
  return { count: record.pages.length };
}

async function update(message) {
  if (message.type === "capture") return capture(message.tabId);
  if (message.type === "clear") {
    await chrome.storage.session.remove(RECORD_KEY);
    return;
  }
  const record = await readRecord();
  if (message.type === "rename") {
    record.title = message.title.trim().slice(0, 160) || DEFAULT_TITLE;
  } else {
    const index = record.pages.findIndex(page => page.id === message.pageId);
    if (index < 0) throw new Error("This page has already been removed.");
    const page = record.pages[index];
    switch (message.type) {
      case "remove":
        record.pages.splice(index, 1);
        break;
      case "move": {
        const target = index + message.direction;
        if (Math.abs(message.direction) !== 1 || !record.pages[target]) return;
        [record.pages[target], record.pages[index]] = [page, record.pages[target]];
        break;
      }
      case "include": {
        if (!Number.isInteger(message.item) || !page.items[message.item]) throw new Error("This field could not be found.");
        const excluded = new Set(page.excluded);
        if (message.included) excluded.delete(message.item);
        else excluded.add(message.item);
        page.excluded = [...excluded];
        break;
      }
      default:
        throw new Error("Unknown record action.");
    }
  }
  await chrome.storage.session.set({ [RECORD_KEY]: record });
}

// A single writer keeps captures and edits from overwriting each other across tabs.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  const work = queue.then(() => update(message));
  queue = work.catch(() => {});
  work.then(result => reply({ ok: true, ...result }), error => {
    const detail = /quota/i.test(error.message)
      ? "This session is full. Save your current PDF and clear the record before capturing more pages."
      : error.message;
    reply({ ok: false, error: detail });
  });
  return true;
});
