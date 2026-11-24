"use strict";

const previewStatus = document.querySelector("#preview-status");
const printButton = document.querySelector("#save-pdf");
const paperSelect = document.querySelector("#paper");
const refreshButton = document.querySelector("#refresh-preview");
let previewer;
let rendering = false;
let renderedRecord = "";
let recordId;

function renderChecklist(record) {
  const list = document.querySelector("#checklist-items");
  list.replaceChildren();
  const groups = new Map();
  for (const page of record.pages) {
    const key = formIdentity(page);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(page);
  }
  function link(page, text) {
    const anchor = el("a", "", text);
    anchor.href = recordUrl("review.html", recordId, page.id);
    return anchor;
  }
  for (const versions of groups.values()) {
    const included = versions.filter(pageIncluded);
    const ordered = versionsFor(record, versions[0]);
    const name = page => page.title + (versions.length > 1 ? " · Version " + (ordered.indexOf(page) + 1) : "");
    if (included.length > 1) {
      const row = el("li", "", countText(included.length, "version") + " included for " + versions[0].title + ". ");
      included.forEach((page, index) => {
        if (index) row.append(", ");
        row.append(link(page, "Version " + (ordered.indexOf(page) + 1)));
      });
      list.append(row);
    }
    for (const page of versions) {
      const excluded = page.enabled === false ? page.items.length : page.excluded.length;
      const notes = [...(page.warnings || [])];
      if (excluded) notes.push(countText(excluded, "field") + " excluded.");
      if (notes.length) {
        const row = el("li");
        row.append(link(page, name(page)), " — " + notes.join(" "));
        list.append(row);
      }
    }
  }
  document.querySelector("#checklist-summary").textContent = list.childElementCount
    ? "Review these captures or save with the current selections."
    : "All fields are included. No capture warnings or repeated versions.";
  document.querySelector("#export-checklist").hidden = !record.pages.length;
}

function makeDocument(record) {
  const documentNode = el("div", "pdf-document");
  const time = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  record.pages.filter(pageIncluded).forEach((page, pageIndex) => {
    const capture = el("article", "pdf-capture");
    const header = el("header", "pdf-header");
    if (pageIndex === 0) header.append(el("h1", "", record.title));
    header.append(el("h2", "", (pageIndex + 1) + ". " + page.title), el("p", "pdf-meta", page.source + " · Captured " + time.format(new Date(page.capturedAt))));
    capture.append(header);
    const notes = captureNotes(page);
    if (notes) capture.append(notes);
    const sections = sectionsFor(page).filter(section => section.indices.some(index => itemIncluded(page, index)));
    sections.forEach((section, sectionIndex) => {
      const group = el("section");
      group.append(el("h3", "", (pageIndex + 1) + "." + (sectionIndex + 1) + " " + (section.name || "General information")));
      section.indices.filter(index => itemIncluded(page, index)).forEach(index => {
        const item = page.items[index];
        const field = el("div", "pdf-field");
        field.append(el("p", "pdf-label", item.label));
        field.append(item.kind === "table" ? tableView(item, page.layouts?.[index] || "auto") : el("p", "pdf-value", item.value || "Not answered"));
        group.append(field);
      });
      capture.append(group);
    });
    documentNode.append(capture);
  });
  return documentNode;
}

function invalidatePreview() {
  printButton.disabled = true;
  document.querySelector("#export-checklist").hidden = true;
  document.body.classList.remove("preview-ready");
  if (!rendering) previewStatus.textContent = "Your record changed. Refresh the preview before saving.";
}

async function buildPreview() {
  if (rendering) return;
  rendering = true;
  printButton.disabled = paperSelect.disabled = refreshButton.disabled = true;
  document.body.classList.remove("preview-ready");
  document.querySelector("#preview-error").hidden = true;
  previewStatus.textContent = "Preparing pages…";
  try {
    const record = await readRecord(recordId);
    renderChecklist(record);
    paperSelect.value = settingsFor(record).paper;
    document.title = record.title;
    const signature = JSON.stringify(record);
    if (previewer) {
      previewer.polisher.destroy();
      previewer.chunker.destroy();
    }
    const container = document.querySelector("#print-document");
    container.replaceChildren();
    if (!record.pages.some(pageIncluded)) {
      previewStatus.textContent = "No fields selected. Return to review and include a capture or section.";
      renderedRecord = signature;
      return;
    }
    previewer = new PagedModule.Previewer();
    const content = document.createDocumentFragment();
    content.append(makeDocument(record));
    const flow = await previewer.preview(content, [chrome.runtime.getURL("print-document.css"), chrome.runtime.getURL("print-" + paperSelect.value + ".css")], container);
    renderedRecord = signature;
    if (JSON.stringify(await readRecord(recordId)) !== signature) {
      previewStatus.textContent = "Your record changed while preparing pages. Refresh the preview.";
      return;
    }
    previewStatus.textContent = countText(flow.total, "page") + " · " + (paperSelect.value === "a4" ? "A4" : "Letter") + " · Included answers only";
    document.body.classList.add("preview-ready");
    printButton.disabled = false;
  } catch (error) {
    const feedback = document.querySelector("#preview-error");
    feedback.textContent = "Could not prepare the preview. " + error.message;
    feedback.hidden = false;
    previewStatus.textContent = "Preview unavailable. Try refreshing.";
  } finally {
    rendering = false;
    paperSelect.disabled = refreshButton.disabled = false;
  }
}

paperSelect.addEventListener("change", async () => {
  invalidatePreview();
  try { await changeRecord({ type: "paper", paper: paperSelect.value, recordId }); await buildPreview(); }
  catch (error) { document.querySelector("#preview-error").textContent = error.message; document.querySelector("#preview-error").hidden = false; }
});
refreshButton.addEventListener("click", buildPreview);
printButton.addEventListener("click", () => { if (!printButton.disabled) window.print(); });
chrome.storage.onChanged.addListener((changes, area) => {
  const change = changes[recordKey(recordId)];
  if (area === "session" && change && JSON.stringify(change.newValue || emptyRecord()) !== renderedRecord) invalidatePreview();
});
async function initializePreview() {
  recordId = initialRecordId(await readCatalog());
  history.replaceState(null, "", recordUrl("preview.html", recordId));
  document.querySelector(".back-link").href = recordUrl("review.html", recordId);
  await buildPreview();
}
initializePreview().catch(error => { previewStatus.textContent = error.message; });
