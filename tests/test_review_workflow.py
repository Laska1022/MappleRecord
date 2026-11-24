"""Exercise review, drafts, versions, and paginated PDF with mocked Chrome APIs."""
import json
import re
import subprocess
from pathlib import Path
from playwright.sync_api import expect, sync_playwright
from browser_helpers import launch_chromium
from browser_harness import BASE, ORIGIN, prepare_context

FIXTURE = """
<main><h1>First form</h1>
  <label>Excluded field<input value="EXCLUDED_SENTINEL"></label>
  <div class="form-group"><label>City</label><div class="form-control-static">Toronto<input type="hidden" value="SECRET_SENTINEL"></div></div>
  <div role="combobox" aria-label="Country" aria-valuetext="Canada"><span>Canada</span><input type="hidden" value="CA"></div>
  <div class="form-group"><label>Address</label><div class="form-control-static"><div>123 Main Street</div><div>Toronto</div><div>Ontario</div></div></div>
  <table><tr><th>Country</th></tr><tr><td><div role="combobox"><input value="Canada"></div></td></tr></table>
  <div aria-label="Notes" contenteditable>Some notes</div>
  <details><summary>Previous address</summary><label>Street<input value="COLLAPSED_SENTINEL"></label></details>
</main>
"""


def main():
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright)
        try:
            fixture = browser.new_page()
            fixture.route(ORIGIN + '/fixture', lambda route: route.fulfill(content_type='text/html', body=FIXTURE))
            fixture.goto(ORIGIN + '/fixture')
            fixture.add_script_tag(content=(BASE / 'capture.js').read_text())
            captured = fixture.evaluate('values => captureForm(values)', json.loads((BASE / 'portal-values.json').read_text()))
            assert len(captured['items']) == 6, captured
            fixture.close()
            first = {**captured, 'id': 'page-a', 'documentId': 'doc-a', 'capturedAt': '2026-11-17T00:00:00.000Z', 'excluded': []}
            second = {'id': 'page-b', 'documentId': 'doc-b', 'title': 'Second form', 'source': 'example.test', 'capturedAt': '2026-11-17T00:00:00.000Z', 'excluded': [], 'items': [{'section': '', 'kind': 'field', 'label': 'Last name', 'value': 'Smith'}]}
            context = prepare_context(browser, {'title': 'Application record', 'pages': [first, second]})
            errors = []
            console_errors = []
            def track(page):
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
            context.on('page', track)
            page = context.new_page()
            page.goto(ORIGIN + '/review.html')
            expect(page.locator('#summary')).to_have_text('2 captured pages · 7 fields included')
            page.locator('#rename').click()
            page.locator('#title-input').fill('Renamed record')
            page.locator('#confirm').click()
            expect(page.locator('#record-title')).to_have_text('Renamed record')
            page.locator('[data-focus="page-a-0"]').uncheck()
            expect(page.locator('#summary')).to_have_text('2 captured pages · 6 fields included')
            section = page.locator('[data-focus="page-a-section-0"]')
            assert section.evaluate('(input) => input.indeterminate')
            section.check()
            expect(page.locator('#summary')).to_have_text('2 captured pages · 7 fields included')
            section.uncheck()
            expect(page.locator('#summary')).to_have_text('1 captured page · 1 field included')
            section.check()
            expect(page.locator('#summary')).to_have_text('2 captured pages · 7 fields included')
            page.locator('[data-focus="page-a-0"]').uncheck()
            page.locator('[data-focus="page-a-layout-4"]').select_option('cards')
            expect(page.locator('.table-record')).to_have_count(1)
            page.locator('[data-focus="page-a-layout-4"]').select_option('table')
            expect(page.locator('.table-record')).to_have_count(0)
            page.locator('#search').fill('Toronto')
            expect(page.locator('.field:visible')).to_have_count(2)
            page.locator('#reset-search').click()
            page.locator('#filter').select_option('excluded')
            expect(page.locator('.field:visible')).to_have_count(1)
            page.locator('#filter').select_option('unanswered')
            expect(page.locator('#no-results')).to_be_visible()
            page.locator('#reset-search').click()
            page.locator('[data-focus="page-a-collapse"]').click()
            expect(page.locator('#content-page-a')).not_to_be_visible()
            page.locator('#search').fill('Toronto')
            expect(page.locator('#content-page-a')).to_be_visible()
            with context.expect_page() as opened:
                page.locator('#print').click()
            preview = opened.value
            preview.wait_for_url(ORIGIN + '/preview.html')
            expect(preview.locator('#save-pdf')).to_be_enabled(timeout=30000)
            expect(preview.locator('.pagedjs_page')).to_have_count(2)
            for paper, dimensions in [('letter', (612, 792)), ('a4', (595.276, 841.89))]:
                if paper == 'a4':
                    preview.locator('#paper').select_option(paper)
                    expect(preview.locator('#preview-status')).to_contain_text('A4', timeout=30000)
                    expect(preview.locator('#save-pdf')).to_be_enabled()
                pdf = preview.pdf(prefer_css_page_size=True, print_background=True)
                text = ' '.join(subprocess.run(['pdftotext', '-', '-'], input=pdf, capture_output=True, check=True).stdout.decode().split())
                for value in ['Renamed record', 'Toronto', 'Canada', '123 Main Street Toronto Ontario', 'Some notes', 'Smith', 'Page 1 of 2', 'Page 2 of 2']:
                    assert value in text, (value, text)
                assert 'EXCLUDED_SENTINEL' not in text and 'SECRET_SENTINEL' not in text
                assert 'COLLAPSED_SENTINEL' not in text
                info = subprocess.run(['pdfinfo', '-'], input=pdf, capture_output=True, check=True).stdout.decode()
                size = re.search(r'Page size:\s+([\d.]+) x ([\d.]+)', info)
                assert size and all(abs(float(actual) - expected) < 1 for actual, expected in zip(size.groups(), dimensions)), info
            page.locator('#reset-search').click()
            page.locator('[data-focus="page-b-up"]').click()
            expect(page.locator('.page-header h2')).to_have_text(['Second form', 'First form'])
            expect(preview.locator('#save-pdf')).to_be_disabled()
            preview.locator('#refresh-preview').click()
            expect(preview.locator('#save-pdf')).to_be_enabled(timeout=30000)
            # Compare a changed snapshot and choose one version without deleting others.
            page.evaluate("async () => { _captureSnapshot.items[1].value = 'Ottawa'; await chrome.runtime.sendMessage({type: 'capture', tabId: 1}); }")
            expect(page.locator('.page-card')).to_have_count(3)
            latest = page.evaluate('async () => (await chrome.storage.session.get("applicationRecord")).applicationRecord.pages.at(-1).id')
            page.locator(f'[data-focus="{latest}-compare"]').click()
            expect(page.locator('.change-badge')).to_have_count(1)
            expect(page.locator('.previous-answer')).to_contain_text('Toronto')
            page.locator(f'[data-focus="{latest}-use-version"]').click()
            expect(page.locator('[data-focus="page-a-enable"]')).not_to_be_checked()
            expect(page.locator('.page-card')).to_have_count(3)
            page.locator(f'[data-focus="{latest}-0"]').uncheck()
            # Invalid drafts preserve the record; downloaded drafts survive clearing.
            page.locator('#draft-file').set_input_files({'name': 'bad.json', 'mimeType': 'application/json', 'buffer': b'{"format":"wrong"}'})
            expect(page.locator('#feedback')).to_contain_text('not a valid Maple Record draft')
            expect(page.locator('.page-card')).to_have_count(3)
            with page.expect_download() as downloaded:
                page.locator('#save-draft').click()
            draft = json.loads(Path(downloaded.value.path()).read_text())
            assert draft['record']['settings']['paper'] == 'a4'
            assert len(draft['record']['pages']) == 3
            page.locator('#draft-file').set_input_files({'name': 'record.json', 'mimeType': 'application/json', 'buffer': json.dumps(draft).encode()})
            expect(page.locator('#dialog-title')).to_have_text('Replace this record?')
            page.locator('#cancel').click()
            expect(page.locator('.page-card')).to_have_count(3)
            page.locator('#clear').click()
            page.locator('#confirm').click()
            expect(page.locator('#empty')).to_be_visible()
            expect(page.locator('#print')).to_be_disabled()
            page.locator('#draft-file').set_input_files({'name': 'record.json', 'mimeType': 'application/json', 'buffer': json.dumps(draft).encode()})
            expect(page.locator('.page-card')).to_have_count(3)
            expect(page.locator('[data-focus="page-a-enable"]')).not_to_be_checked()
            page.locator('[data-focus="page-a-remove"]').click()
            page.locator('#confirm').click()
            expect(page.locator('.page-card')).to_have_count(2)
            # Popup identifies the tab and reports exactly what was captured.
            popup = context.new_page()
            popup.goto(ORIGIN + '/popup.html')
            expect(popup.locator('#tab-title')).to_have_text('Application form – Portal')
            expect(popup.locator('#site')).to_have_text('portal.example.test')
            popup.locator('#capture').click()
            expect(popup.locator('#captured-title')).to_have_text('First form')
            expect(popup.locator('#captured-count')).to_have_text('6 fields captured')
            with context.expect_page() as capture_review:
                popup.locator('#review-capture').click()
            expect(capture_review.value).to_have_url(re.compile(r'/review\.html#page-'))
            output = BASE / 'test-results'
            output.mkdir(exist_ok=True)
            page.set_viewport_size({'width': 1440, 'height': 1100})
            page.screenshot(path=str(output / 'review-desktop.png'), full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(output / 'review-mobile.png'), full_page=True)
            assert not errors, errors
            assert not console_errors, console_errors
            print('PASS: capture summaries, search, filters, section selection, collapse, versions, draft round-trip, table layouts, Letter/A4 pagination, PDF text, page numbers, stale-preview guard, responsive layout.')
        finally:
            browser.close()

if __name__ == '__main__':
    main()
