"use strict";

const $ = selector => document.querySelector(selector);
const dialog = $("#edit-dialog");
const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
let record = emptyRecord();
let pending = 0;
let dialogAction;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

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

function updatePrintButton() {
  $("#print").disabled = Boolean(pending) || !record.pages.some(page => page.excluded.length < page.items.length);
}

async function change(message) {
  pending++;
  updatePrintButton();
  $("#feedback").textContent = "";
  try {
    await changeRecord(message);
    // Also synchronizes the view if the user immediately opens print preview.
    render(await readRecord());
  } catch (error) {
    showError(error.message);
    render(record);
  } finally {
    pending--;
    updatePrintButton();
  }
}

function ask(action, page) {
  dialogAction = { type: action, pageId: page?.id };
  const rename = action === "rename";
  $("#dialog-title").textContent = rename ? "Rename record" : action === "clear" ? "Clear this record?" : "Remove this page?";
  $("#dialog-detail").textContent = rename ? "This title will appear on the PDF." : action === "clear"
    ? "All captured pages in this session will be removed." : "“" + page.title + "” will be removed from this record.";
  $("#title-label").hidden = $("#title-input").hidden = !rename;
  $("#title-input").value = record.title;
  $("#confirm").textContent = rename ? "Save title" : action === "clear" ? "Clear record" : "Remove page";
  $("#confirm").classList.toggle("destructive", !rename);
  dialog.returnValue = "";
  dialog.showModal();
  if (rename) $("#title-input").select();
  else $("#cancel").focus();
}

$("#cancel").addEventListener("click", () => dialog.close("cancel"));
dialog.addEventListener("close", () => {
  if (dialog.returnValue === "confirm") change({ ...dialogAction, title: $("#title-input").value });
});
$("#clear").addEventListener("click", () => ask("clear"));
$("#rename").addEventListener("click", () => ask("rename"));
$("#print").addEventListener("click", () => window.print());

function tableView(item) {
  const [headers, ...data] = item.rows;
  // Wide history tables read better as labelled records on a portrait sheet.
  if (headers.length > 5 && headers.every(cell => cell.header) &&
      item.rows.every(row => row.length === headers.length && row.every(cell => cell.colSpan === 1 && cell.rowSpan === 1))) {
    const list = el("div", "wide-table");
    data.forEach((row, index) => {
      const group = el("section", "table-record");
      group.append(el("h5", "", "Entry " + (index + 1)));
      const fields = el("dl");
      row.forEach((cell, col) => fields.append(el("dt", "", headers[col].text || "Column " + (col + 1)), el("dd", "", cell.text || "—")));
      group.append(fields);
      list.append(group);
    });
    return list;
  }
  const wrap = el("div", "table-wrap");
  const table = el("table");
  table.setAttribute("aria-label", item.label);
  let inHeader = true;
  const head = el("thead");
  const body = el("tbody");
  item.rows.forEach(row => {
    inHeader = inHeader && row.every(cell => cell.header);
    const tr = el("tr");
    row.forEach(cell => {
      const entry = el(cell.header ? "th" : "td", "", cell.text || "—");
      entry.colSpan = cell.colSpan;
      entry.rowSpan = cell.rowSpan;
      tr.append(entry);
    });
    (inHeader ? head : body).append(tr);
  });
  if (head.children.length) table.append(head);
  table.append(body);
  wrap.append(table);
  return wrap;
}

function itemView(page, item, index) {
  const included = !page.excluded.includes(index);
  const row = el("div", "field" + (included ? "" : " omitted") + (item.kind === "table" ? " table-field" : ""));
  const input = el("input", "include screen");
  input.type = "checkbox";
  input.checked = included;
  input.dataset.focus = page.id + "-" + index;
  input.setAttribute("aria-label", "Include " + item.label + " in PDF");
  input.addEventListener("change", () => change({ type: "include", pageId: page.id, item: index, included: input.checked }));
  row.append(input, el("div", "field-label", item.label));
  row.append(item.kind === "table" ? tableView(item) :
    el("div", "answer" + (item.value ? "" : " blank"), item.value || "Not answered"));
  return row;
}

function pageView(page, index) {
  const allOmitted = page.excluded.length === page.items.length;
  const card = el("article", "page-card" + (allOmitted ? " omitted-page" : ""));
  card.id = "page-" + page.id;
  const header = el("header", "page-header");
  const heading = el("div");
  heading.append(el("p", "eyebrow", "Capture " + String(index + 1).padStart(2, "0")),
    el("h2", "", page.title),
    el("p", "page-meta", page.source + "  ·  " + timestamp.format(new Date(page.capturedAt))));
  const controls = el("div", "page-controls screen");
  const move = direction => change({ type: "move", pageId: page.id, direction });
  const up = actionButton("↑", "Move " + page.title + " up", () => move(-1), page.id + "-up");
  const down = actionButton("↓", "Move " + page.title + " down", () => move(1), page.id + "-down");
  up.disabled = index === 0;
  down.disabled = index === record.pages.length - 1;
  controls.append(up, down, actionButton("Remove", "Remove " + page.title, () => ask("remove", page), page.id + "-remove"));
  header.append(heading, controls);
  card.append(header);
  let previous;
  let group;
  page.items.forEach((item, itemIndex) => {
    if (item.section !== previous) {
      group = el("section", "field-group omitted-group");
      previous = item.section;
      if (item.section) group.append(el("h3", "", item.section));
      card.append(group);
    }
    if (!page.excluded.includes(itemIndex)) group.classList.remove("omitted-group");
    group.append(itemView(page, item, itemIndex));
  });
  return card;
}

function render(next) {
  const focused = document.activeElement?.dataset.focus;
  record = next;
  document.title = record.title;
  $("#record-title").textContent = record.title;
  const total = record.pages.length;
  const includedPages = record.pages.filter(page => page.excluded.length < page.items.length);
  const fields = includedPages.reduce((sum, page) => sum + page.items.length - page.excluded.length, 0);
  $("#summary").textContent = countText(includedPages.length, "captured page") + " · " + countText(fields, "field") + " included";
  $("#page-count").textContent = total;
  $("#tools").hidden = $("#clear").hidden = !total;
  $("#empty").hidden = Boolean(total);
  $("#outline").replaceChildren();
  $("#pages").replaceChildren();
  record.pages.forEach((page, index) => {
    const link = el("a", "outline-link");
    link.href = "#page-" + page.id;
    link.append(el("span", "ordinal", String(index + 1).padStart(2, "0")), el("span", "", page.title));
    $("#outline").append(link);
    $("#pages").append(pageView(page, index));
  });
  if (!total) $("#outline").append(el("p", "nav-empty", "No pages captured yet."));
  if (focused) document.querySelector('[data-focus="' + CSS.escape(focused) + '"]')?.focus({ preventScroll: true });
  updatePrintButton();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[RECORD_KEY]) render(changes[RECORD_KEY].newValue || emptyRecord());
});
readRecord().then(render).catch(error => showError(error.message));
