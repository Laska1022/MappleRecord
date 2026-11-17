"use strict";

// Chrome serializes this function into the active tab's isolated world.
function captureForm(portalValues) {
  const root = document.querySelector("#webForm") || document.querySelector("main, [role=main]") || document.body;
  const ignore = [
    "nav", "footer", "[role=navigation]", "[role=search]", "[role=alert]", "[hidden]", "[inert]",
    '[aria-hidden="true"]', ".wb-inv", ".sr-only", ".visually-hidden",
    ".modal", ".modal-dialog", ".help-block", "#validationErrors", "script", "style", "template"
  ].join(",");
  const control = 'input, select, textarea, [contenteditable=""], [contenteditable="true" i], [contenteditable="plaintext-only" i], [role=combobox]';
  const skipTypes = new Set(["hidden", "password", "file", "submit", "reset", "button", "image", "search"]);
  const summary = ".form-control-static, .question-answer, .question-value, .answer, output, .form-control:not(input):not(select):not(textarea)";
  const normalize = value => (value || "").replace(/\s+/g, " ").trim();

  function visible(node) {
    return !node.closest(ignore) && node.getClientRects().length > 0 &&
      getComputedStyle(node).visibility === "visible";
  }

  function readable(node, allowRootControl = false) {
    const tokens = [];
    function visit(part) {
      if (part.nodeType === Node.TEXT_NODE) {
        tokens.push(part.textContent);
      } else if (part.nodeType === Node.ELEMENT_NODE) {
        if (part.matches(ignore + ",button,[role=button]") ||
            (part.matches(control) && !(allowRootControl && part === node))) return;
        if (part !== node && !visible(part)) return;
        // Preserve rendered line boundaries without splitting adjacent inline text.
        const block = /^(block|flow-root|list-item|flex|grid|table(?:-.+)?)$/.test(getComputedStyle(part).display);
        if (block || part.tagName === "BR") tokens.push(" ");
        for (const child of part.childNodes) visit(child);
        if (block) tokens.push(" ");
      }
    }
    if (node) visit(node);
    return normalize(tokens.join(""));
  }

  function credential(node) {
    return /(?:^|\s)(?:username|current-password|new-password|one-time-code|cc-\S+)(?:\s|$)/i.test(node.autocomplete || "") ||
      [node.id, node.name].some(name => /(?:^|[_-])(?:otp|password|passcode)(?:$|[_-])/i.test(name || "")) ||
      ["password", "file"].includes(node.type);
  }

  if (!/^https?:$/.test(location.protocol)) return { error: "Open a portal form in a web tab to capture it." };
  if ([...document.querySelectorAll('input[type=password], input[autocomplete~="one-time-code"]')].some(visible)) {
    return { error: "Finish signing in, then open the application form you want to capture." };
  }

  function labelledBy(node) {
    return (node.getAttribute("aria-labelledby") || "").split(/\s+/)
      .map(id => readable(document.getElementById(id))).filter(Boolean).join(" ");
  }

  function label(node) {
    return labelledBy(node) || normalize(node.getAttribute("aria-label")) ||
      [...(node.labels || [])].map(node => readable(node)).filter(Boolean).join(" ");
  }

  function portalLabel(node, allowOptionLabel = true) {
    const group = node.closest(".eapp-question-and-answer, .form-group, [role=group], [role=radiogroup]");
    return group && (labelledBy(group) || normalize(group.getAttribute("aria-label")) ||
      readable(group.querySelector(".question-label")) || readable(group.querySelector(".question-description")) ||
      (allowOptionLabel && readable(group.querySelector("label"))));
  }

  function groupLabel(node) {
    return readable(node.closest("fieldset")?.querySelector(":scope > legend")) || portalLabel(node, false);
  }

  function controlLabel(node) {
    return label(node) || portalLabel(node) || groupLabel(node) ||
      normalize(node.placeholder || node.name || node.id) || "Unlabelled field";
  }

  function safeControl(node) {
    return !skipTypes.has(node.type) && !credential(node) && visible(node);
  }

  function hasVisibleControl(node) {
    return node && [...node.querySelectorAll(control)].some(safeControl);
  }

  function answer(node) {
    if (node.matches('[role="combobox"]') && !node.matches("input,select")) {
      const input = [...node.querySelectorAll("input,select")].find(safeControl);
      if (input) return answer(input);
      const selected = [...node.querySelectorAll('[aria-selected="true"]')].find(visible);
      return normalize(node.getAttribute("aria-valuetext")) || readable(selected) || readable(node, true);
    }
    if (node.tagName === "SELECT") {
      return [...node.selectedOptions].filter(option => option.value !== "" && option.value !== "-1")
        .map(option => normalize(option.text)).join(", ");
    }
    if (node.type === "checkbox" || node.type === "radio") return node.checked ? "Checked" : "Unchecked";
    const code = node.getAttribute("data-lovid");
    const value = (node.value ?? node.innerText ?? "").trim();
    if (code && code !== "-1" && (!value || value === code || /^\d+$/.test(value))) {
      return Object.hasOwn(portalValues, code) ? portalValues[code] : code;
    }
    return code === "-1" && value === "-1" ? "" : value;
  }

  function cellText(cell) {
    if (cell.matches(control) && safeControl(cell)) return answer(cell);
    const controls = [...cell.querySelectorAll(control)]
      .filter(node => safeControl(node) && !node.parentElement?.closest(control));
    const pieces = [readable(cell), ...controls.map(answer)].filter(Boolean);
    if (pieces.length) return pieces.join(" ");
    // Older e-APR grids keep the lookup identifier inside an otherwise empty visible cell.
    const coded = cell.querySelector("input[data-lovid]");
    const code = coded?.dataset.lovid;
    return code && code !== "-1" && !credential(coded) ? (Object.hasOwn(portalValues, code) ? portalValues[code] : code) : "";
  }

  function readTable(table) {
    const rows = [...table.rows].filter(visible).map(row => [...row.cells].filter(visible).map(cell => ({
      text: cellText(cell), header: cell.tagName === "TH", colSpan: cell.colSpan, rowSpan: cell.rowSpan
    }))).filter(cells => cells.length);
    if (!rows.some(row => row.some(cell => !cell.header && cell.text))) return;
    return {
      kind: "table", label: readable(table.caption) || labelledBy(table) ||
        normalize(table.getAttribute("aria-label")) || portalLabel(table) || "Table", rows
    };
  }

  const selector = ["h1,h2,h3,h4", control, "table", "dt", summary, ".question-label"].join(",");
  const items = [];
  const handled = new Set();
  let section = "";
  const heading = [...root.querySelectorAll("h1")].find(visible);
  const title = readable(heading) || normalize(document.title) || "Portal form";

  function add(item) {
    if (item) items.push({ section, ...item });
  }

  const radios = [...root.querySelectorAll('input[type=radio]')].filter(safeControl);
  for (const node of root.querySelectorAll(selector)) {
    if (handled.has(node) || !visible(node) || node.parentElement?.closest("table")) continue;
    if (node.matches("h1,h2,h3,h4")) {
      section = readable(node);
      if (section === title) section = "";
    } else if (node.matches("table")) {
      add(readTable(node));
    } else if (node.matches(control)) {
      if (!safeControl(node) || node.parentElement?.closest(control)) continue;
      if (node.type === "radio") {
        const siblings = node.name ? radios.filter(other => other.form === node.form && other.name === node.name) : [node];
        siblings.forEach(other => handled.add(other));
        const selected = siblings.find(other => other.checked);
        add({ kind: "field", label: groupLabel(node) || node.name || controlLabel(node),
          value: selected ? label(selected) || selected.value : "" });
      } else {
        const field = controlLabel(node);
        const group = node.type === "checkbox" ? groupLabel(node) : "";
        add({ kind: "field", label: group && group !== field ? group + " · " + field : field, value: answer(node) });
      }
    } else if (node.tagName === "DT") {
      const values = [];
      let sibling = node.nextElementSibling;
      while (sibling?.tagName === "DD") {
        if (visible(sibling) && !hasVisibleControl(sibling)) {
          values.push(readable(sibling));
          handled.add(sibling);
          sibling.querySelectorAll(summary).forEach(child => handled.add(child));
        }
        sibling = sibling.nextElementSibling;
      }
      if (values.length) add({ kind: "field", label: readable(node), value: values.join("\n") });
    } else if (node.matches(".question-label")) {
      const sibling = node.nextElementSibling;
      const group = node.closest(".eapp-question-and-answer, .form-group");
      const structured = [summary, "table,dl,button,label,.eapp-question-and-answer,.question-label,.question-description,.help-block"].join(",");
      if (!hasVisibleControl(group) && sibling && visible(sibling) && !hasVisibleControl(sibling) &&
          !sibling.matches(control + "," + structured) && !sibling.querySelector(structured)) {
        const value = readable(sibling);
        if (value) add({ kind: "field", label: readable(node), value });
      }
    } else if (!hasVisibleControl(node) && !node.querySelector(summary)) {
      const name = label(node) || portalLabel(node) || readable(node.previousElementSibling);
      if (name) add({ kind: "field", label: name, value: readable(node) });
    }
  }
  if (!items.length) return { error: "No form data found. Open an application form or review page and expand the sections you need." };
  return { title, source: location.hostname, items };
}
