# Maple Record

Maple Record captures Canadian immigration form answers into a searchable, printable PDF. It works locally in a Chromium browser and requires no account or build step.

## Install

Download and extract this repository, or clone it. Open the extensions page in Chrome (`chrome://extensions`) or Edge (`edge://extensions`). Turn on **Developer mode**, choose **Load unpacked**, and select the repository folder containing `manifest.json`. Pin Maple Record to the browser toolbar for easier access. After updating an installed copy, use its **Reload** button on the extensions page; save a PDF or download a draft first because reloading clears session captures.

## Capture, review, and export

1. Sign in to the portal, open a form or review page, and expand the sections you want to save.
2. Open Maple Record. Check the tab title and website, then choose **Capture this page**. The summary shows the captured form title, field count, and any detected capture limitations. **Review this capture** opens that snapshot directly.
3. In review, search questions and answers or filter by included, excluded, and unanswered fields. Use field or section checkboxes to choose PDF contents. Search filters and collapsed cards do not exclude answers from export.
4. Repeated captures of the same form are grouped in the sidebar. **Compare previous** highlights added/changed answers and lists removed answers. **Use only this version** excludes the other versions from the PDF without deleting them or their field selections. You can re-enable them later. Forms are grouped by website, page path (without query parameters), and title; check that grouped snapshots refer to the same form/application.
5. For tables, choose **Automatic**, **Table**, or **Entry cards**. Automatic uses cards for simple tables with more than five columns. Tables with merged cells or complex headers retain their table structure.
6. Choose **Preview PDF**, select **Letter** or **A4**, and check the numbered pages. Choose **Save as PDF** to open the browser print dialog. Select the same paper size, choose Save as PDF as the destination, and turn off browser headers and footers. If the record changes in another tab, refresh the preview before saving.

Captures stay in extension session storage and clear when the browser restarts or the extension reloads. **Clear record** discards the current collection after confirmation.

## Continue later with a draft

**Download draft** saves the current record to a local `.maplerecord.json` file, including all snapshots, included/excluded selections, table layouts, capture notes, and paper size. It contains your captured answers in readable form; store it somewhere private. No draft or form data is uploaded to a server.

Use **Restore draft** to continue later. Restoring replaces the current record after confirmation when captures already exist. Invalid files leave the existing record untouched. Draft files are limited to 8 MB, and browser session-storage limits still apply.

## Capture limits

The extension reads the visible top-level page, including labelled inputs, selected options, editable fields, definition lists, portal answer summaries, and tables. It reports visible embedded frames and detectable collapsed sections so you can open or expand them and recapture. These notes are hints, not a guarantee that all form content was captured; always check the answers before exporting.

For a form inside a separate frame, open the form itself in a tab if the portal allows it. Passwords, file contents, and hidden form fields are skipped. Visible legacy portal table cells can use the bundled lookup data to display coded answers.

## Development checks

No build step or dependency installation is required to load the extension. Paged.js 0.4.3 is bundled locally in `vendor/pagedjs/` for PDF pagination, with its MIT license. The preview uses generated styles; scripts remain restricted to packaged files by the extension Content Security Policy. Tests use Node.js 18 or newer, Python 3.10 or newer, Playwright, Chromium, and Poppler's `pdftotext` and `pdfinfo` commands for verifying PDF contents.

From the repository root:

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m playwright install --with-deps chromium
# Install Poppler using your OS package manager (Debian/Ubuntu: poppler-utils).
python tests/test_capture.py
node --test tests/test_background.cjs tests/test_shared.cjs
python tests/test_review_workflow.py
python tests/test_pdf_pagination.py
```

The browser tests use `CHROMIUM_EXECUTABLE` if set, an installed `chromium` if available, or Playwright's bundled Chromium. On Windows, activate the virtual environment with `.venv\Scripts\activate` instead.

Capture tests run against synthetic forms in Chromium. Background tests mock Chrome APIs; the review smoke test runs the real capture, background, and review code with mocked storage/messaging and checks generated Letter/A4 PDFs, page numbers, drafts, versions, filters, and mobile layout. Pagination tests exercise long answers, history tables, and a table row spanning multiple pages. Browser test screenshots are written to the ignored `test-results/` directory. These checks do not validate native extension permissions or signed-in portal compatibility. Test data is synthetic and no portal credentials are needed.

## Changes in 1.1.0

- Capture summaries, direct review links, tab titles, and actionable capture notes.
- A smaller review header, collapsible captures, search, and answer filters.
- Section selection with included counts and independent capture inclusion.
- Grouped versions, answer comparisons, and version selection without deleting snapshots.
- Local draft download and validated restoration.
- Table/card layout choices and paginated Letter/A4 previews with section and page numbers.

## Changes in 1.0.1

- Preserve visible summary answers when hidden controls are present.
- Read custom dropdown selections when their backing input is hidden.
- Keep separators between block-level answer text without splitting inline words.
- Capture nested controls in table cells once.
- Support empty, plaintext-only, and case-insensitive `contenteditable` attributes.
