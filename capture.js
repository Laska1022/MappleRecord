"use strict";

// Chrome serializes this function into the active tab's isolated world.
function captureForm(portalValues, captureId, locateRef) {
  const root = document.querySelector("#webForm") || document.querySelector("main, [role=main]") || document.body;
  // A closed disclosure renders only its first direct summary.
  const closedDetailsBody = "details:not([open]) > :not(summary:first-of-type)";
  const ignore = [
    "nav", "footer", "[role=navigation]", "[role=search]", "[role=alert]", "[hidden]", "[inert]",
    '[aria-hidden="true"]', ".wb-inv", ".sr-only", ".visually-hidden",
    ".modal", ".modal-dialog", ".help-block", "#validationErrors", "script", "style", "template", closedDetailsBody
  ].join(",");
  const control = 'input, select, textarea, [contenteditable=""], [contenteditable="true" i], [contenteditable="plaintext-only" i], [role=combobox]';
  const skipTypes = new Set(["hidden", "password", "file", "submit", "reset", "button", "image", "search"]);
  const summary = ".form-control-static, .question-answer, .question-value, .answer, output, .form-control:not(input):not(select):not(textarea)";
  const normalize = value => (value || "").replace(/\s+/g, " ").trim();

  function visible(node) {
    if (node.closest(ignore)) return false;
    const style = getComputedStyle(node);
    if (style.visibility !== "visible") return false;
    if (style.display !== "contents") return node.getClientRects().length > 0;
    // A contents wrapper has no box. Its children and direct text can still render.
    return [...node.childNodes].some(child => {
      if (child.nodeType === Node.ELEMENT_NODE) return visible(child);
      if (child.nodeType !== Node.TEXT_NODE) return false;
      const range = document.createRange();
      range.selectNodeContents(child);
      return range.getClientRects().length > 0;
    });
  }

  function readable(node, { allowRootControl = false, includeControlValues = false, skipNestedSummaries = false } = {}) {
    const tokens = [];
    const pieces = [];
    function flushText() {
      const text = normalize(tokens.join(""));
      if (text) pieces.push(text);
      tokens.length = 0;
    }
    function visit(part) {
      if (part.nodeType === Node.TEXT_NODE) {
        tokens.push(part.textContent);
      } else if (part.nodeType === Node.ELEMENT_NODE) {
        if (skipNestedSummaries && part !== node && part.matches(summary)) return;
        const rootControl = allowRootControl && part === node;
        if (part.matches(control) && !rootControl) {
          if (includeControlValues && safeControl(part)) {
            const value = answer(part);
            if (value) {
              flushText();
              pieces.push(value);
            }
          }
          return;
        }
        if (part.matches(ignore) || (!rootControl && part.matches("button,[role=button]"))) return;
        if (part !== node && !visible(part)) return;
        // Preserve rendered line boundaries without splitting adjacent inline text.
        const block = /^(block|flow-root|list-item|flex|grid|table(?:-.+)?)$/.test(getComputedStyle(part).display);
        if (block || part.tagName === "BR") tokens.push(" ");
        if (part.matches("details:not([open])")) {
          const summary = part.querySelector(":scope > summary");
          if (summary) visit(summary);
        } else {
          for (const child of part.childNodes) visit(child);
        }
        if (block) tokens.push(" ");
      }
    }
    if (node && !node.closest(closedDetailsBody)) visit(node);
    flushText();
    return pieces.join(" ");
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

  function summaryLabel(node) {
    return label(node) || portalLabel(node) || readable(node.previousElementSibling);
  }

  function groupLabel(node) {
    return readable(node.closest("fieldset")?.querySelector(":scope > legend")) || portalLabel(node, false);
  }

  function controlLabel(node) {
    return label(node) || portalLabel(node) || groupLabel(node) ||
      normalize(node.placeholder || node.name || node.id) || "Unlabelled field";
  }

  function safeControl(node) {
    const buttonCombobox = node.matches('button[role="combobox"],input[type="button"][role="combobox"]');
    return (!skipTypes.has(node.type) || buttonCombobox) && !credential(node) && visible(node);
  }

  function hasVisibleControl(node) {
    return node && [...node.querySelectorAll(control)].some(safeControl);
  }

  function hasVisibleDescendant(node, selector) {
    return [...node.querySelectorAll(selector)].some(visible);
  }

  function answer(node) {
    if (node.matches('[role="combobox"]') && !node.matches("input,select")) {
      const input = [...node.querySelectorAll("input,select")].find(safeControl);
      if (input) return answer(input);
      const selected = [...node.querySelectorAll('[aria-selected="true"]')].find(visible);
      return normalize(node.getAttribute("aria-valuetext")) || readable(selected) || readable(node, { allowRootControl: true });
    }
    if (node.tagName === "SELECT") {
      const choices = [];
      for (const option of node.selectedOptions) {
        const label = normalize(option.label);
        if (!label || option.value === "") continue;
        // Some portal forms use -1 for their prompt, others for an actual answer.
        const prompt = /^[\s–—.-]*(?:(?:please )?(?:select|choose)(?: one| an option)?|(?:veuillez )?(?:sélectionner|sélectionnez|choisir|choisissez)(?: une option)?)[\s…–—.-]*$/i;
        if (option.value === "-1" && prompt.test(label)) continue;
        choices.push(label);
      }
      return choices.join(", ");
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
    const text = readable(cell, { includeControlValues: true });
    if (text) return text;
    // Older e-APR grids keep the lookup identifier inside an otherwise empty visible cell.
    const coded = [...cell.querySelectorAll("input[data-lovid]")].find(input => !input.closest(closedDetailsBody));
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

  const sourceRefs = [];
  let highlightTarget;
  // Recompute the question with the capture rules: a live DOM node can be repurposed.
  function sameQuestion(ref, item, element) {
    return ref && ref.url === location.href && ref.title === title && ref.section === section &&
      ref.kind === item.kind && ref.label === item.label && ref.fieldName === element.getAttribute("name");
  }

  function add(item, element, radioGroup) {
    if (!item) return;
    if (locateRef) {
      for (const candidate of radioGroup || [element]) {
        const ref = globalThis.mapleRecordSources?.get(candidate);
        if (ref?.id === locateRef && sameQuestion(ref, item, candidate)) highlightTarget = candidate;
      }
      return;
    }
    if (captureId) {
      // This map lives in Chrome's isolated world and releases detached elements.
      const sources = globalThis.mapleRecordSources ??= new WeakMap();
      let ref = sources.get(element);
      if (!sameQuestion(ref, item, element)) {
        ref = { id: captureId + ":" + items.length, url: location.href, title, label: item.label,
          section, kind: item.kind, fieldName: element.getAttribute("name") };
        sources.set(element, ref);
      }
      sourceRefs.push(ref.id);
    }
    items.push({ section, ...item });
  }

  function addSummary(node, name, keepEmpty) {
    const nested = [...node.querySelectorAll(summary)].filter(visible);
    // A wrapper containing only individually named answers delegates to them.
    // When the wrapper contributes answer text, capture the whole value once.
    const hasOuterText = nested.length > 0 && Boolean(readable(node, { skipNestedSummaries: true }));
    if (nested.length && !hasOuterText && nested.every(summaryLabel)) return;
    const field = name || (hasOuterText ? "Unlabelled field" : "");
    const value = readable(node);
    if (field && (value || keepEmpty)) {
      add({ kind: "field", label: field, value }, node);
      nested.forEach(child => handled.add(child));
    }
  }

  const radios = [...root.querySelectorAll('input[type=radio]')].filter(safeControl);
  for (const node of root.querySelectorAll(selector)) {
    if (handled.has(node) || !visible(node) || node.parentElement?.closest("table")) continue;
    if (node.matches("h1,h2,h3,h4")) {
      section = readable(node);
      if (section === title) section = "";
    } else if (node.matches("table")) {
      add(readTable(node), node);
    } else if (node.matches(control)) {
      if (!safeControl(node) || node.parentElement?.closest(control)) continue;
      if (node.type === "radio") {
        const siblings = node.name ? radios.filter(other => other.form === node.form && other.name === node.name) : [node];
        siblings.forEach(other => handled.add(other));
        const selected = siblings.find(other => other.checked);
        add({ kind: "field", label: groupLabel(node) || node.name || controlLabel(node),
          value: selected ? label(selected) || selected.value : "" }, selected || node, siblings);
      } else {
        const field = controlLabel(node);
        const group = node.type === "checkbox" ? groupLabel(node) : "";
        add({ kind: "field", label: group && group !== field ? group + " · " + field : field, value: answer(node) }, node);
      }
    } else if (node.tagName === "DT") {
      const values = [];
      let firstAnswer;
      let sibling = node.nextElementSibling;
      while (sibling?.tagName === "DD") {
        if (visible(sibling) && !hasVisibleControl(sibling)) {
          firstAnswer ??= sibling;
          values.push(readable(sibling));
          handled.add(sibling);
          sibling.querySelectorAll(summary).forEach(child => handled.add(child));
        }
        sibling = sibling.nextElementSibling;
      }
      if (values.length) add({ kind: "field", label: readable(node), value: values.join("\n") }, firstAnswer);
    } else if (node.matches(".question-label")) {
      const sibling = node.nextElementSibling;
      const group = node.closest(".eapp-question-and-answer, .form-group");
      const structured = "table,dl,button,label,.eapp-question-and-answer,.question-label,.question-description,.help-block";
      if (!hasVisibleControl(group) && sibling && visible(sibling) && !hasVisibleControl(sibling) &&
          !sibling.matches([control, summary, structured].join(",")) && !hasVisibleDescendant(sibling, structured)) {
        addSummary(sibling, readable(node), false);
      }
    } else if (!hasVisibleControl(node)) {
      addSummary(node, summaryLabel(node), true);
    }
    if (highlightTarget) break;
  }
  if (locateRef) {
    if (!highlightTarget) return false;
    const range = document.createRange();
    range.selectNodeContents(highlightTarget);
    const rect = highlightTarget.getBoundingClientRect();
    const bounds = rect.width ? rect : range.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return false;
    const target = highlightTarget.getClientRects().length ? highlightTarget : highlightTarget.parentElement;
    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.animate([{ outline: "4px solid #c86518", outlineOffset: "3px" },
      { outline: "4px solid #c86518", outlineOffset: "3px", offset: 0.85 },
      { outline: "4px solid transparent", outlineOffset: "3px" }], 3500);
    return true;
  }
  const warnings = [];
  const frames = [...root.querySelectorAll("iframe,frame")].filter(visible).length;
  if (frames) warnings.push(frames + " embedded frame" + (frames === 1 ? " was" : "s were") + " not captured. If a form is inside a frame, open it in its own tab and capture it there.");
  const collapsed = new Set([...root.querySelectorAll("details:not([open])")].filter(visible));
  for (const trigger of root.querySelectorAll('[aria-expanded="false"][aria-controls]')) {
    if (!visible(trigger)) continue;
    for (const id of trigger.getAttribute("aria-controls").split(/\s+/)) {
      const panel = document.getElementById(id);
      if (panel && panel.querySelector(control + "," + summary + ",dt,table")) collapsed.add(panel);
    }
  }
  if (collapsed.size) warnings.push(collapsed.size + " collapsed section" + (collapsed.size === 1 ? " may contain" : "s may contain") + " more answers. Expand the sections you need, then capture this page again.");
  if (!items.length) return { error: "No form data found. Open an application form or review page and expand the sections you need." + (warnings.length ? " " + warnings.join(" ") : "") };
  return { title, source: location.hostname, sourcePath: location.pathname, items, warnings, ...(captureId ? { sourceRefs } : {}) };
}
