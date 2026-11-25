"use strict";
importScripts("shared.js", "capture.js");

let queue = Promise.resolve();
let portalValues;

async function capture(tabId, recordId) {
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
      args: [portalValues, crypto.randomUUID()]
    });
  } catch {
    throw new Error("Open the portal form, then click the extension icon and try again.");
  }
  if (!frame?.result) throw new Error("The page could not be read. Open the form and try again.");
  if (frame.result.error) throw new Error(frame.result.error);
  const record = await readRecord(recordId);
  const snapshot = frame.result;
  const duplicate = record.pages.find(page =>
    page.documentId === frame.documentId && formIdentity(page) === formIdentity(snapshot) &&
    JSON.stringify(page.items) === JSON.stringify(snapshot.items) &&
    JSON.stringify(page.warnings || []) === JSON.stringify(snapshot.warnings || [])
  );
  if (duplicate) {
    if (JSON.stringify(duplicate.sourceRefs) !== JSON.stringify(snapshot.sourceRefs)) {
      Object.assign(duplicate, { sourceRefs: snapshot.sourceRefs, tabId });
      await chrome.storage.session.set({ [recordKey(recordId)]: record });
    }
    return { duplicate: true, count: record.pages.length, pageId: duplicate.id, title: duplicate.title, fields: duplicate.items.length, warnings: snapshot.warnings || [] };
  }
  const page = {
    ...snapshot, id: crypto.randomUUID(), documentId: frame.documentId, tabId,
    capturedAt: new Date().toISOString(), excluded: []
  };
  record.pages.push(page);
  await chrome.storage.session.set({ [recordKey(recordId)]: record });
  return { count: record.pages.length, pageId: page.id, title: page.title, fields: page.items.length, warnings: page.warnings || [] };
}

async function update(message) {
  const catalog = await readCatalog();
  if (message.type === "createRecord") {
    const title = message.title.trim().slice(0, 160);
    if (!title) throw new Error("Enter a name for the record.");
    const id = crypto.randomUUID();
    catalog.entries.push({ id, title });
    catalog.activeId = id;
    await chrome.storage.session.set({ [CATALOG_KEY]: catalog, [recordKey(id)]: emptyRecord(title) });
    return { recordId: id };
  }
  const id = message.recordId ?? DEFAULT_RECORD_ID;
  const entry = catalog.entries.find(entry => entry.id === id);
  if (!entry) throw new Error("This record is no longer available.");
  const key = recordKey(id);
  if (message.type === "selectRecord") {
    catalog.activeId = id;
    await chrome.storage.session.set({ [CATALOG_KEY]: catalog });
    return { recordId: id };
  }
  if (message.type === "capture") return capture(message.tabId, id);
  if (message.type === "clear") {
    if (id === DEFAULT_RECORD_ID && entry.title === DEFAULT_TITLE) await chrome.storage.session.remove(key);
    else await chrome.storage.session.set({ [key]: emptyRecord(entry.title) });
    return;
  }
  let record = await readRecord(id);
  if (message.type === "restore") {
    const restored = validateDraft(message.draft);
    if (record.pages.length) {
      // Check inside the writer queue and bind confirmation to the state being replaced.
      const bytes = new TextEncoder().encode(JSON.stringify(record));
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const state = new Uint8Array(digest).join(".");
      if (message.confirmedState !== state) return { confirmation: { state, count: record.pages.length } };
    }
    record = restored;
  }
  if (message.type === "rename" || message.type === "restore") {
    if (message.type === "rename") record.title = message.title.trim().slice(0, 160) || DEFAULT_TITLE;
    entry.title = record.title;
    await chrome.storage.session.set({ [key]: record, [CATALOG_KEY]: catalog });
    return;
  }
  if (message.type === "paper") {
    if (!["letter", "a4"].includes(message.paper)) throw new Error("Choose Letter or A4 paper.");
    record.settings = { ...settingsFor(record), paper: message.paper };
  } else {
    const index = record.pages.findIndex(page => page.id === message.pageId);
    if (index < 0) throw new Error("This page has already been removed.");
    const page = record.pages[index];
    switch (message.type) {
      case "showSource": {
        const ref = page.sourceRefs?.[message.item];
        try {
          if (!ref || !page.documentId || !Number.isInteger(page.tabId)) throw new Error();
          const [frame] = await chrome.scripting.executeScript({
            target: { tabId: page.tabId, documentIds: [page.documentId] }, func: highlightSource, args: [ref]
          });
          if (frame?.result !== true) throw new Error();
          const tab = await chrome.tabs.update(page.tabId, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
          return;
        } catch {
          throw new Error("The original field is unavailable. Open the form and capture it again.");
        }
      }
      case "enable":
        page.enabled = Boolean(message.enabled);
        break;
      case "useVersion":
        record.pages.forEach(other => {
          if (formIdentity(other) === formIdentity(page)) other.enabled = other.id === page.id;
        });
        break;
      case "includeMany": {
        if (!Array.isArray(message.items) || message.items.some(item => !Number.isInteger(item) || !page.items[item])) throw new Error("This section could not be found.");
        const excluded = new Set(page.excluded);
        message.items.forEach(item => message.included ? excluded.delete(item) : excluded.add(item));
        page.excluded = [...excluded];
        break;
      }
      case "layout":
        if (!Number.isInteger(message.item) || page.items[message.item]?.kind !== "table" || !TABLE_LAYOUTS.includes(message.layout)) throw new Error("Choose a valid table layout.");
        page.layouts = { ...page.layouts, [message.item]: message.layout };
        break;
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
  await chrome.storage.session.set({ [key]: record });
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
