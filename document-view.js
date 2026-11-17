"use strict";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function canUseCards(item) {
  const headers = item.rows[0];
  return item.rows.length > 1 && headers.length > 0 && headers.every(cell => cell.header) &&
    item.rows.slice(1).every(row => row.length === headers.length && row.every(cell => !cell.header)) &&
    item.rows.every(row => row.every(cell => cell.colSpan === 1 && cell.rowSpan === 1));
}

function tableView(item, layout = "auto") {
  const [headers, ...data] = item.rows;
  if (canUseCards(item) && (layout === "cards" || (layout === "auto" && headers.length > 5))) {
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

function captureNotes(page) {
  if (!page.warnings?.length) return null;
  const box = el("aside", "capture-notes");
  box.append(el("strong", "", "Check this capture"));
  const list = el("ul", "notice-list");
  page.warnings.forEach(text => list.append(el("li", "", text)));
  box.append(list);
  return box;
}
