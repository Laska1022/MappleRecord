# Maple Record

Maple Record captures Canadian immigration form answers into a searchable, printable PDF. It works locally in a Chromium browser and requires no account or build step.

## Install

Open the extensions page in Chrome (`chrome://extensions`) or Edge (`edge://extensions`). Turn on **Developer mode**, choose **Load unpacked**, and select the **MapleRecord** folder containing `manifest.json`. Pin Maple Record to the browser toolbar for easier access.

## Save a record

1. Sign in to the immigration portal and open a form or review page. Expand the sections you want to save.
2. Open Maple Record from the toolbar. Check the current tab shown and choose **Capture this page**. Repeat for each form page.
3. Choose **Review**. Check the answers, untick fields to exclude, move or remove pages, and optionally rename the record. Capturing an edited page adds a new snapshot, so you can remove an earlier version.
4. Choose **Save as PDF**. In the browser print dialog, select **Save as PDF** as the destination and save the file. If the browser adds a URL or date in the margins, turn off its headers and footers.

Captures stay in extension session storage and clear when the browser restarts or the extension reloads. Save the PDF before ending the session. **Clear record** discards the current collection.

The extension reads the visible top-level page, including labelled inputs, selected options, definition lists, portal answer summaries and tables. For forms inside a separate frame, open the form itself in a tab if the portal allows it. Passwords, file contents and hidden form fields are skipped. Visible legacy portal table cells can use the bundled lookup data from the original app to display their coded answers.
