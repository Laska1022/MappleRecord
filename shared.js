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

const DRAFT_FORMAT = "MapleRecord";
const MAX_DRAFT_BYTES = 8 * 1024 * 1024;
const TABLE_LAYOUTS = ["auto", "table", "cards"];

function settingsFor(record) {
  return { paper: record.settings?.paper === "a4" ? "a4" : "letter" };
}

function pageIncluded(page) {
  return page.enabled !== false && page.excluded.length < page.items.length;
}

function itemIncluded(page, index) {
  return page.enabled !== false && !page.excluded.includes(index);
}

function formIdentity(page) {
  return JSON.stringify([page.source, page.sourcePath || "", page.title]);
}

function versionsFor(record, page) {
  return record.pages.filter(other => formIdentity(other) === formIdentity(page))
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
}

function sectionsFor(page) {
  const sections = [];
  page.items.forEach((item, index) => {
    if (!sections.length || sections.at(-1).name !== item.section) {
      sections.push({ name: item.section, indices: [] });
    }
    sections.at(-1).indices.push(index);
  });
  return sections;
}

function itemText(item) {
  return item.kind === "table" ? item.rows.map(row => row.map(cell => cell.text).join(" · ")).join("\n") : item.value;
}

function unanswered(item) {
  return item.kind === "field" ? !item.value.trim() :
    !item.rows.some(row => row.some(cell => !cell.header && cell.text.trim()));
}

function comparePages(page, previous) {
  const keyed = items => {
    const counts = new Map();
    return items.map(item => {
      const base = JSON.stringify([item.kind, item.section, item.label]);
      const occurrence = counts.get(base) || 0;
      counts.set(base, occurrence + 1);
      return [base + ":" + occurrence, item];
    });
  };
  if (!previous) return { changes: new Map(), removed: [] };
  const old = new Map(keyed(previous.items));
  const changes = new Map();
  keyed(page.items).forEach(([key, item], index) => {
    const before = old.get(key);
    if (!before) changes.set(index, { type: "added" });
    else if (JSON.stringify(item) !== JSON.stringify(before)) changes.set(index, { type: "changed", before });
    old.delete(key);
  });
  return { changes, removed: [...old.values()] };
}

function draftFor(record) {
  return { format: DRAFT_FORMAT, version: 1, savedAt: new Date().toISOString(), record };
}

// A draft is data, never markup or executable configuration. Construct a fresh
// record so unknown properties and prototype keys cannot enter application state.
function validateDraft(draft) {
  const invalid = () => { throw new Error("This is not a valid Maple Record draft. Choose a draft downloaded from Maple Record."); };
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const string = value => typeof value === "string" ? value : invalid();
  const boolean = value => typeof value === "boolean" ? value : invalid();
  const array = value => Array.isArray(value) ? value : invalid();
  if (!object(draft) || draft.format !== DRAFT_FORMAT || draft.version !== 1 || !object(draft.record)) invalid();
  if (JSON.stringify(draft).length > MAX_DRAFT_BYTES) throw new Error("This draft is too large. Use a draft smaller than 8 MB.");
  const source = draft.record;
  const ids = new Set();
  const pages = array(source.pages).map(page => {
    if (!object(page)) invalid();
    const id = string(page.id);
    if (!id || ids.has(id) || typeof page.capturedAt !== "string" || !Number.isFinite(Date.parse(page.capturedAt))) invalid();
    ids.add(id);
    const items = array(page.items).map(item => {
      if (!object(item)) invalid();
      const base = { section: string(item.section), kind: item.kind, label: string(item.label) };
      if (item.kind === "field") return { ...base, value: string(item.value) };
      if (item.kind !== "table") invalid();
      const rows = array(item.rows).map(row => array(row).map(cell => {
        if (!object(cell) || !Number.isInteger(cell.colSpan) || cell.colSpan < 1 || cell.colSpan > 1000 ||
            !Number.isInteger(cell.rowSpan) || cell.rowSpan < 0 || cell.rowSpan > 65534) invalid();
        return { text: string(cell.text), header: boolean(cell.header), colSpan: cell.colSpan, rowSpan: cell.rowSpan };
      }));
      if (!rows.length || rows.some(row => !row.length)) invalid();
      return { ...base, rows };
    });
    if (!items.length) invalid();
    const excluded = [...new Set(array(page.excluded))];
    if (excluded.some(index => !Number.isInteger(index) || index < 0 || index >= items.length)) invalid();
    const layouts = {};
    if (page.layouts !== undefined) {
      if (!object(page.layouts)) invalid();
      for (const [key, layout] of Object.entries(page.layouts)) {
        const index = Number(key);
        if (!Number.isInteger(index) || String(index) !== key || items[index]?.kind !== "table" || !TABLE_LAYOUTS.includes(layout)) invalid();
        layouts[index] = layout;
      }
    }
    return {
      id, title: string(page.title), source: string(page.source), sourcePath: page.sourcePath === undefined ? "" : string(page.sourcePath),
      capturedAt: new Date(page.capturedAt).toISOString(), items, excluded, layouts,
      enabled: page.enabled === undefined ? true : boolean(page.enabled),
      warnings: page.warnings === undefined ? [] : array(page.warnings).map(string)
    };
  });
  if (source.settings !== undefined && (!object(source.settings) || !["letter", "a4"].includes(source.settings.paper))) invalid();
  return { title: string(source.title).trim().slice(0, 160) || DEFAULT_TITLE, pages, settings: settingsFor(source) };
}
