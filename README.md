# Maple Record

Maple Record captures Canadian immigration form answers into a searchable, printable PDF. It works locally in a Chromium browser and requires no account or build step.

## Install

Download and extract this repository, or clone it. Open the extensions page in Chrome (`chrome://extensions`) or Edge (`edge://extensions`). Turn on **Developer mode**, choose **Load unpacked**, and select the repository folder containing `manifest.json`. Pin Maple Record to the browser toolbar for easier access. After updating an installed copy, use its **Reload** button on the extensions page; save your current PDF first because reloading clears session captures.

## Save a record

1. Sign in to the immigration portal and open a form or review page. Expand the sections you want to save.
2. Open Maple Record from the toolbar. Check the current tab shown and choose **Capture this page**. Repeat for each form page.
3. Choose **Review**. Check the answers, untick fields to exclude, move or remove pages, and optionally rename the record. Capturing an edited page adds a new snapshot, so you can remove an earlier version.
4. Choose **Save as PDF**. In the browser print dialog, select **Save as PDF** as the destination and save the file. If the browser adds a URL or date in the margins, turn off its headers and footers.

Captures stay in extension session storage and clear when the browser restarts or the extension reloads. Save the PDF before ending the session. **Clear record** discards the current collection.

The extension reads the visible top-level page, including labelled inputs, selected options, definition lists, portal answer summaries and tables. For forms inside a separate frame, open the form itself in a tab if the portal allows it. Passwords, file contents and hidden form fields are skipped. Visible legacy portal table cells can use the bundled lookup data from the original app to display their coded answers.

## Development checks

No build step or runtime packages are required. Tests use Node.js 18 or newer, Python 3.10 or newer, Playwright, Chromium, and Poppler's `pdftotext` command for verifying PDF contents.

From the repository root:

```sh
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m playwright install --with-deps chromium
# Install Poppler using your OS package manager (Debian/Ubuntu: poppler-utils).
python tests/test_capture.py
node --test tests/test_background.cjs
python tests/test_review_workflow.py
```

The browser tests use `CHROMIUM_EXECUTABLE` if set, an installed `chromium` if available, or Playwright's bundled Chromium. On Windows, activate the virtual environment with `.venv\Scripts\activate` instead.

Capture tests run against synthetic forms in Chromium. Background tests mock Chrome APIs; the review smoke test runs the real capture, background, and review code with mocked storage/messaging and checks an actual generated PDF. These checks do not validate native extension permissions or signed-in portal compatibility. Test data is synthetic and no portal credentials are needed.

## Changes in 1.0.1

- Preserve visible summary answers when hidden controls are present.
- Read custom dropdown selections when their backing input is hidden.
- Keep separators between block-level answer text without splitting inline words.
- Capture nested controls in table cells once.
- Support empty, plaintext-only, and case-insensitive `contenteditable` attributes.
