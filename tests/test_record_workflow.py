"""Exercise record switching and source highlighting across browser tabs."""
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

from browser_harness import BASE, ORIGIN, prepare_context
from browser_helpers import launch_chromium


def main():
    with sync_playwright() as pw:
        browser = launch_chromium(pw)
        try:
            ctx = prepare_context(browser, {'title': 'First applicant', 'pages': []})
            source = ctx.new_page()
            source.route(ORIGIN + '/form', lambda route: route.fulfill(
                content_type='text/html', body='<main><h1>Application</h1><label>City<input value="Ottawa"></label></main>'))
            source.goto(ORIGIN + '/form')
            source.add_script_tag(content=(BASE / 'capture.js').read_text())
            def open_from_form(path):
                with ctx.expect_page() as opened:
                    source.evaluate('url => { window.open(url); }', ORIGIN + path)
                return opened.value

            # The opener is a real form document. Only Chrome's routing and focus APIs are mocked.
            patch = """() => {
                chrome.scripting.executeScript = async ({target, func, args}) => {
                    if (target.tabId !== 1) throw Error('Unexpected source tab');
                    if (args[2] && target.documentIds?.[0] !== 'form-document')
                        throw Error('Unexpected source document');
                    return [{documentId: 'form-document', result: window.opener[func.name](...args)}];
                };
                chrome.tabs.update = async (id, update) => { window.lastActivated = id; return {windowId: 3}; };
                chrome.windows = {update: async (id, update) => { window.lastFocused = id; }};
            }"""
            popup = open_from_form('/popup.html')
            expect(popup.locator('#capture')).to_be_enabled()
            popup.evaluate(patch)
            popup.locator('#capture').click()
            expect(popup.locator('#captured-count')).to_have_text('1 field captured')
            review = open_from_form('/review.html')
            expect(review.locator('.source-link')).to_be_visible()
            review.evaluate(patch)
            review.get_by_role('button', name='Show City on the original form').click()
            assert source.locator('input').evaluate('node => node.getAnimations().length > 0')
            assert review.evaluate('lastActivated === 1 && lastFocused === 3')
            with ctx.expect_page() as opened:
                review.locator('#print').click()
            preview = opened.value
            expect(preview.locator('#save-pdf')).to_be_enabled()
            expect(preview.locator('#checklist-summary')).to_contain_text('All fields are included')

            popup.get_by_role('button', name='New record').click()
            popup.get_by_label('Record name').fill('Second applicant')
            popup.get_by_role('button', name='Create record').click()
            expect(popup.locator('#count')).to_have_text('0 captured pages')
            source.locator('input').fill('Toronto')
            popup.evaluate(patch)
            popup.locator('#capture').click()
            expect(popup.locator('#count')).to_have_text('1 captured page')
            with ctx.expect_page() as opened:
                popup.evaluate("setTimeout(() => document.querySelector('#review-capture').click(), 0)")
            second = opened.value
            expect(second.locator('#record-title')).to_have_text('Second applicant')
            expect(second.locator('.answer')).to_have_text('Toronto')
            expect(review.locator('.answer')).to_have_text('Ottawa')
            expect(preview.locator('#save-pdf')).to_be_enabled()
            expect(preview.locator('#print-document')).to_contain_text('Ottawa')

            # A new value is still the same question. A reused input with a new label is not.
            source.locator('input').evaluate('node => node.getAnimations().forEach(animation => animation.cancel())')
            review.get_by_role('button', name='Show City on the original form').click()
            assert source.locator('input').evaluate('node => node.getAnimations().length > 0')
            source.locator('input').evaluate('node => node.getAnimations().forEach(animation => animation.cancel())')
            source.locator('label').evaluate("node => node.firstChild.textContent = 'Employer city'")
            review.get_by_role('button', name='Show City on the original form').click()
            expect(review.locator('.source-status')).to_contain_text('original field is unavailable')
            assert source.locator('input').evaluate('node => node.getAnimations().length === 0')

            with second.expect_download() as download:
                second.locator('#save-draft').click()
            draft = Path(download.value.path()).read_text()
            assert 'Toronto' in draft and 'Ottawa' not in draft and 'sourceRefs' not in draft
            second.locator('#clear').click()
            second.locator('#confirm').click()
            expect(second.locator('#empty')).to_be_visible()
            expect(second.locator('#record-title')).to_have_text('Second applicant')
            second.locator('#record-picker select').select_option(label='First applicant')
            expect(second.locator('.answer')).to_have_text('Ottawa')
            source.locator('label').evaluate("node => node.firstChild.textContent = 'City'")
            source.locator('input').evaluate('node => node.replaceWith(node.cloneNode())')
            review.get_by_role('button', name='Show City on the original form').click()
            expect(review.locator('.source-status')).to_contain_text('original field is unavailable')
            building = ctx.new_page()
            building.goto(preview.url)
            expect(building.locator('#save-pdf')).to_be_enabled()
            building.evaluate("""() => {
                const paginate = PagedModule.Previewer.prototype.preview;
                PagedModule.Previewer.prototype.preview = async function (...args) {
                    const flow = await paginate.apply(this, args);
                    await new Promise(resolve => { window.finishLayout = resolve; });
                    return flow;
                };
            }""")
            building.locator('#refresh-preview').click()
            building.wait_for_function("typeof finishLayout === 'function'")
            review.locator('#clear').click()
            review.locator('#confirm').click()
            expect(preview.locator('#save-pdf')).to_be_disabled()
            expect(preview.locator('#print-document')).to_be_empty()
            expect(building.locator('#preview-status')).to_contain_text('record changed')
            expect(building.locator('#print-document')).to_be_empty()
            building.evaluate('() => finishLayout()')
            expect(building.locator('#refresh-preview')).to_be_enabled()
            expect(building.locator('#save-pdf')).to_be_disabled()
            expect(building.locator('.pagedjs_page')).to_have_count(0)
            building.locator('#refresh-preview').click()
            expect(building.locator('#preview-status')).to_contain_text('No fields selected')
            print('PASS: named records, pinned review and PDF, draft isolation, source highlight and replaced-field handling.')
        finally:
            browser.close()


if __name__ == '__main__':
    main()
