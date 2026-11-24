"use strict";

// Both entry points choose the destination before the user captures or edits.
function setupRecordPicker(catalog, recordId) {
  const picker = document.querySelector("#record-picker");
  const select = picker.querySelector("select");
  const form = picker.querySelector("form");
  const name = form.elements.recordName;
  function render(list) {
    select.replaceChildren(...list.entries.map(entry => new Option(entry.title, entry.id)));
    select.value = recordId;
  }
  async function switchRecord(message) {
    document.body.inert = true;
    try {
      const result = await changeRecord(message);
      const url = new URL(location.href);
      url.searchParams.set("record", result.recordId);
      url.hash = "";
      location.replace(url.href);
    } catch (error) {
      select.value = recordId;
      document.body.inert = false;
      const feedback = document.querySelector("#feedback");
      feedback.textContent = error.message;
      feedback.classList.add("error");
    }
  }
  render(catalog);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes[CATALOG_KEY]?.newValue) render(changes[CATALOG_KEY].newValue);
  });
  select.addEventListener("change", () => switchRecord({ type: "selectRecord", recordId: select.value }));
  picker.querySelector(".new-record").addEventListener("click", () => {
    form.hidden = false;
    name.focus();
  });
  form.querySelector('[type="button"]').addEventListener("click", () => {
    form.reset();
    form.hidden = true;
    picker.querySelector(".new-record").focus();
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    switchRecord({ type: "createRecord", title: name.value });
  });
}
