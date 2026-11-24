"use strict";

const $ = selector => document.querySelector(selector);
const dialog = $("#edit-dialog");
const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
let record = emptyRecord();
let recordId;
let pending = 0;
let dialogAction;
let initialRender = true;
const collapsedPages = new Set();
const comparingPages = new Set();

function actionButton(text, label, action, key) {
  const button = el("button", "small-button", text);
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.dataset.focus = key;
  button.addEventListener("click", action);
  return button;
}

function showError(message) {
  $("#feedback").textContent = message;
  $("#feedback").classList.add("error");
}

function updateButtons() {
  $("#print").disabled = Boolean(pending) || !record.pages.some(pageIncluded);
  $("#save-draft").disabled = Boolean(pending) || !record.pages.length;
  $("#load-draft").disabled = Boolean(pending);
}

async function change(message) {
  pending++;
  updateButtons();
  $("#feedback").textContent = "";
  $("#feedback").classList.remove("error");
  try {
    await changeRecord({ ...message, recordId });
    render(await readRecord(recordId));
    return true;
  } catch (error) {
    showError(error.message);
    render(record);
    return false;
  } finally {
    pending--;
    updateButtons();
  }
}

function ask(action, page, draft) {
  dialogAction = { type: action, pageId: page?.id, draft };
  const rename = action === "rename";
  $("#dialog-title").textContent = rename ? "Rename record" : action === "clear" ? "Clear this record?" : action === "restore" ? "Replace this record?" : "Remove this capture?";
  $("#dialog-detail").textContent = rename ? "This title will appear on the PDF." : action === "clear"
    ? "All captures in this record will be removed. Download a draft first if you want to keep them."
    : action === "restore" ? "Restore " + countText(draft.record.pages.length, "captured page") + " from this draft? This replaces the current session record."
    : "“" + page.title + "” will be removed. Other versions will stay in your record.";
  $("#title-label").hidden = $("#title-input").hidden = !rename;
  $("#title-input").value = record.title;
  $("#confirm").textContent = rename ? "Save title" : action === "clear" ? "Clear record" : action === "restore" ? "Restore draft" : "Remove capture";
  $("#confirm").classList.toggle("destructive", !rename);
  dialog.returnValue = "";
  dialog.showModal();
  if (rename) $("#title-input").select();
  else $("#cancel").focus();
}

$("#cancel").addEventListener("click", () => dialog.close("cancel"));
dialog.addEventListener("close", () => {
  if (dialog.returnValue === "confirm") change({ ...dialogAction, title: $("#title-input").value });
  dialogAction = undefined;
});
$("#clear").addEventListener("click", () => ask("clear"));
$("#rename").addEventListener("click", () => ask("rename"));
$("#print").addEventListener("click", async () => {
  try { await chrome.tabs.create({ url: recordUrl("preview.html", recordId) }); }
  catch (error) { showError(error.message); }
});

$("#save-draft").addEventListener("click", async () => {
  try {
    const latest = await readRecord(recordId);
    const blob = new Blob([JSON.stringify(draftFor(latest))], { type: "application/json" });
    if (blob.size > MAX_DRAFT_BYTES) throw new Error("This draft exceeds 8 MB. Save a PDF, or reduce the number of captures before downloading a draft.");
    const url = URL.createObjectURL(blob);
    const link = el("a");
    link.href = url;
    link.download = (latest.title.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 80) || "Maple-Record") + ".maplerecord.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("#feedback").classList.remove("error");
    $("#feedback").textContent = "Draft download started. Keep the file somewhere private; it contains your captured answers.";
  } catch (error) { showError(error.message); }
});
$("#load-draft").addEventListener("click", () => $("#draft-file").click());
$("#draft-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > MAX_DRAFT_BYTES) throw new Error("Choose a draft smaller than 8 MB.");
    let draft;
    try { draft = JSON.parse(await file.text()); }
    catch { throw new Error("This file could not be read. Choose a Maple Record JSON draft."); }
    validateDraft(draft);
    if (record.pages.length) ask("restore", null, draft);
    else await change({ type: "restore", draft });
  } catch (error) { showError(error.message); }
});

function matchesFilter(page, item, index) {
  const query = $("#search").value.trim().toLocaleLowerCase();
  const text = [page.title, item.section, item.label, itemText(item)].join(" ").toLocaleLowerCase();
  const filter = $("#filter").value;
  return (!query || text.includes(query)) && (filter === "all" ||
    (filter === "included" && itemIncluded(page, index)) ||
    (filter === "excluded" && !itemIncluded(page, index)) ||
    (filter === "unanswered" && unanswered(item)));
}

function itemView(page, item, index, difference) {
  const included = itemIncluded(page, index);
  const row = el("div", "field" + (included ? "" : " omitted") + (item.kind === "table" ? " table-field" : "") + (difference ? " changed-field" : ""));
  row.hidden = !matchesFilter(page, item, index);
  const input = el("input", "include screen");
  input.type = "checkbox";
  input.checked = included;
  input.disabled = page.enabled === false;
  input.dataset.focus = page.id + "-" + index;
  input.setAttribute("aria-label", "Include " + item.label + " in PDF");
  input.addEventListener("change", () => change({ type: "include", pageId: page.id, item: index, included: input.checked }));
  const label = el("div", "field-label", item.label);
  if (difference) label.append(el("span", "change-badge", difference.type === "added" ? "New answer" : "Changed"));
  if (page.sourceRefs?.[index]) {
    const status = el("span", "source-status");
    status.setAttribute("role", "status");
    const source = actionButton("Show on form", "Show " + item.label + " on the original form", async () => {
      status.textContent = "";
      try {
        await changeRecord({ type: "showSource", recordId, pageId: page.id, item: index });
      } catch (error) {
        status.textContent = error.message;
      }
    }, page.id + "-source-" + index);
    source.className = "text-button source-link screen";
    label.append(source, status);
  }
  row.append(input, label);
  if (item.kind === "table") {
    const tools = el("label", "table-layout screen", "Layout ");
    const select = el("select");
    select.setAttribute("aria-label", "Layout for " + item.label);
    select.dataset.focus = page.id + "-layout-" + index;
    [["auto", "Automatic"], ["table", "Table"], ["cards", "Entry cards"]].forEach(([value, title]) => {
      const option = el("option", "", title);
      option.value = value;
      option.disabled = value === "cards" && !canUseCards(item);
      select.append(option);
    });
    select.value = page.layouts?.[index] || "auto";
    select.addEventListener("change", () => change({ type: "layout", pageId: page.id, item: index, layout: select.value }));
    tools.append(select);
    if (!canUseCards(item)) tools.append(el("span", "layout-hint", "This table keeps its original cell structure."));
    row.append(tools, tableView(item, select.value));
  } else row.append(el("div", "answer" + (item.value ? "" : " blank"), item.value || "Not answered"));
  if (difference?.before) {
    const before = el("details", "previous-answer screen");
    before.append(el("summary", "", "Previous answer"), difference.before.kind === "table" ? tableView(difference.before, "auto") : el("p", "", difference.before.value || "Not answered"));
    row.append(before);
  }
  return row;
}

function pageView(page, index) {
  const versions = versionsFor(record, page);
  const versionIndex = versions.findIndex(version => version.id === page.id);
  const previous = versions[versionIndex - 1];
  const differences = comparePages(page, previous);
  const comparing = comparingPages.has(page.id);
  const filtered = $("#search").value.trim() || $("#filter").value !== "all";
  const card = el("article", "page-card" + (pageIncluded(page) ? "" : " omitted-page"));
  card.id = "page-" + page.id;
  card.hidden = !page.items.some((item, itemIndex) => matchesFilter(page, item, itemIndex));
  const header = el("header", "page-header");
  const heading = el("div", "page-heading");
  heading.append(el("p", "eyebrow", "Capture " + String(index + 1).padStart(2, "0") + (versions.length > 1 ? " · Version " + (versionIndex + 1) + " of " + versions.length : "")), el("h2", "", page.title), el("p", "page-meta", page.source + " · " + timestamp.format(new Date(page.capturedAt))));
  const controls = el("div", "page-controls screen");
  const collapse = actionButton(collapsedPages.has(page.id) && !filtered ? "Expand" : "Collapse", "Expand or collapse " + page.title, () => {
    if (collapsedPages.has(page.id)) collapsedPages.delete(page.id); else collapsedPages.add(page.id);
    render(record);
  }, page.id + "-collapse");
  collapse.disabled = Boolean(filtered);
  collapse.setAttribute("aria-expanded", String(!collapsedPages.has(page.id) || Boolean(filtered)));
  collapse.setAttribute("aria-controls", "content-" + page.id);
  const up = actionButton("↑", "Move " + page.title + " up", () => change({ type: "move", pageId: page.id, direction: -1 }), page.id + "-up");
  const down = actionButton("↓", "Move " + page.title + " down", () => change({ type: "move", pageId: page.id, direction: 1 }), page.id + "-down");
  up.disabled = index === 0;
  down.disabled = index === record.pages.length - 1;
  controls.append(collapse, up, down, actionButton("Remove", "Remove " + page.title, () => ask("remove", page), page.id + "-remove"));
  header.append(heading, controls);
  card.append(header);
  const selection = el("div", "page-selection screen");
  const enabledLabel = el("label", "check-label");
  const enabled = el("input");
  enabled.type = "checkbox";
  enabled.checked = page.enabled !== false;
  enabled.dataset.focus = page.id + "-enable";
  enabled.addEventListener("change", () => change({ type: "enable", pageId: page.id, enabled: enabled.checked }));
  enabledLabel.append(enabled, document.createTextNode("Include this capture"));
  selection.append(enabledLabel, el("span", "selection-count", page.items.filter((_, i) => itemIncluded(page, i)).length + " of " + page.items.length + " fields included"));
  if (versions.length > 1) {
    selection.append(actionButton("Use only this version", "Export only this version of " + page.title, () => change({ type: "useVersion", pageId: page.id }), page.id + "-use-version"));
    const includedVersions = versions.filter(pageIncluded).length;
    if (includedVersions > 1) selection.append(el("span", "version-warning", includedVersions + " versions are included. Choose one to avoid repeated answers."));
  }
  if (previous) {
    const compare = actionButton(comparing ? "Hide comparison" : "Compare previous", "Compare with the previous capture of " + page.title, () => {
      if (comparingPages.has(page.id)) comparingPages.delete(page.id); else comparingPages.add(page.id);
      render(record);
    }, page.id + "-compare");
    compare.setAttribute("aria-pressed", String(comparing));
    selection.append(compare, el("span", "selection-count", countText(differences.changes.size + differences.removed.length, "change") + " since previous"));
  }
  card.append(selection);
  const content = el("div", "page-content");
  content.id = "content-" + page.id;
  content.hidden = collapsedPages.has(page.id) && !filtered;
  const notes = captureNotes(page);
  if (notes) content.append(notes);
  sectionsFor(page).forEach((section, sectionIndex) => {
    const group = el("section", "field-group");
    group.hidden = !section.indices.some(i => matchesFilter(page, page.items[i], i));
    const head = el("div", "section-head");
    const title = section.name || "General information";
    head.append(el("h3", "", (sectionIndex + 1) + ". " + title));
    const label = el("label", "check-label screen");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    const selected = section.indices.filter(i => itemIncluded(page, i)).length;
    checkbox.checked = selected === section.indices.length;
    checkbox.indeterminate = selected > 0 && selected < section.indices.length;
    checkbox.disabled = page.enabled === false;
    checkbox.dataset.focus = page.id + "-section-" + sectionIndex;
    checkbox.setAttribute("aria-label", "Include section " + title);
    checkbox.addEventListener("change", () => change({ type: "includeMany", pageId: page.id, items: section.indices, included: checkbox.checked }));
    label.append(checkbox, document.createTextNode(selected + " of " + section.indices.length + " included"));
    head.append(label);
    group.append(head);
    section.indices.forEach(i => group.append(itemView(page, page.items[i], i, comparing ? differences.changes.get(i) : null)));
    content.append(group);
  });
  if (comparing && differences.removed.length) {
    const removed = el("details", "removed-answers screen");
    removed.append(el("summary", "", countText(differences.removed.length, "answer") + " removed since previous capture"));
    differences.removed.forEach(item => {
      const entry = el("div");
      entry.append(el("strong", "", [item.section, item.label].filter(Boolean).join(" · ")), el("p", "", itemText(item) || "Not answered"));
      removed.append(entry);
    });
    content.append(removed);
  }
  card.append(content);
  return card;
}

function clearFilters() {
  $("#search").value = "";
  $("#filter").value = "all";
}
$("#search").addEventListener("input", () => render(record));
$("#filter").addEventListener("change", () => render(record));
$("#reset-search").addEventListener("click", () => { clearFilters(); render(record); $("#search").focus(); });

function render(next) {
  const focused = document.activeElement?.dataset.focus;
  record = next;
  document.title = record.title;
  $("#record-title").textContent = record.title;
  const total = record.pages.length;
  const includedPages = record.pages.filter(pageIncluded);
  const fields = includedPages.reduce((sum, page) => sum + page.items.length - page.excluded.length, 0);
  $("#summary").textContent = countText(includedPages.length, "captured page") + " · " + countText(fields, "field") + " included";
  $("#page-count").textContent = total;
  $("#tools").hidden = $("#clear").hidden = !total;
  $("#empty").hidden = Boolean(total);
  $("#outline").replaceChildren();
  $("#pages").replaceChildren();
  const groups = new Map();
  record.pages.forEach(page => {
    const key = formIdentity(page);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(page);
  });
  for (const pages of groups.values()) {
    const group = el("div", "outline-group");
    group.append(el("h3", "", pages[0].title), el("p", "outline-source", pages[0].source));
    const sorted = versionsFor(record, pages[0]);
    sorted.forEach((page, index) => {
      const link = el("a", "outline-link" + (pageIncluded(page) ? "" : " excluded-link"));
      link.href = "#page-" + encodeURIComponent(page.id);
      link.append(el("span", "", sorted.length > 1 ? "Version " + (index + 1) + (index === sorted.length - 1 ? " · Latest" : "") : "View capture"), el("span", "outline-status", pageIncluded(page) ? "Included" : "Excluded"));
      link.addEventListener("click", () => { clearFilters(); collapsedPages.delete(page.id); render(record); });
      group.append(link);
    });
    $("#outline").append(group);
  }
  record.pages.forEach((page, index) => $("#pages").append(pageView(page, index)));
  const shown = record.pages.reduce((sum, page) => sum + page.items.filter((item, i) => matchesFilter(page, item, i)).length, 0);
  $("#search-count").textContent = countText(shown, "field") + " shown";
  $("#no-results").hidden = !total || shown > 0;
  $("#reset-search").hidden = !$("#search").value && $("#filter").value === "all";
  if (!total) $("#outline").append(el("p", "nav-empty", "Your forms will appear here."));
  if (focused) document.querySelector('[data-focus="' + CSS.escape(focused) + '"]')?.focus({ preventScroll: true });
  updateButtons();
  if (initialRender) {
    initialRender = false;
    try {
      const target = decodeURIComponent(location.hash.slice(1));
      requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView());
    }
    catch { /* An invalid fragment does not prevent review. */ }
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[recordKey(recordId)]) render(changes[recordKey(recordId)].newValue || emptyRecord());
});
async function initializeReview() {
  const catalog = await readCatalog();
  recordId = initialRecordId(catalog);
  setupRecordPicker(catalog, recordId);
  const url = new URL(location.href);
  url.searchParams.set("record", recordId);
  history.replaceState(null, "", url);
  render(await readRecord(recordId));
}
initializeReview().catch(error => showError(error.message));
