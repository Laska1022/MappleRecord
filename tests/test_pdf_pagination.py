"""Check long values and history tables survive pagination without missing rows."""
import re
import subprocess
from playwright.sync_api import sync_playwright, expect
from browser_helpers import launch_chromium
from browser_harness import ORIGIN, BASE, prepare_context


def main():
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright)
        try:
            rows = [[{'text': title, 'header': True, 'colSpan': 1, 'rowSpan': 1} for title in ['Period', 'Activity', 'Location']]]
            for index in range(85):
                rows.append([{'text': text, 'header': False, 'colSpan': 1, 'rowSpan': 1} for text in [f'ROW_{index:03d}', 'Full-time employment and professional development.', 'Toronto, Canada']])
            paragraphs = '\n\n'.join(f'PARAGRAPH_{index:03d} ' + 'A detailed answer with ordinary words and a clear ending. ' * 8 for index in range(35))
            page = {'id': 'long', 'title': 'Personal history', 'source': 'example.test', 'capturedAt': '2026-11-17T00:00:00.000Z', 'excluded': [], 'items': [
                {'kind': 'field', 'section': 'Explanation', 'label': 'Additional information', 'value': paragraphs},
                {'kind': 'table', 'section': 'History', 'label': 'Employment history', 'rows': rows}
            ]}
            context = prepare_context(browser, {'title': 'Long record', 'pages': [page]})
            preview = context.new_page()
            preview.goto(ORIGIN + '/preview.html')
            for layout in ['table', 'cards']:
                if layout == 'cards':
                    preview.evaluate("async () => chrome.runtime.sendMessage({type:'layout',pageId:'long',item:1,layout:'cards'})")
                    preview.locator('#refresh-preview').click()
                expect(preview.locator('#save-pdf')).to_be_enabled(timeout=30000)
                total = preview.locator('.pagedjs_page').count()
                assert total > 2, total
                pdf = preview.pdf(prefer_css_page_size=True)
                text = subprocess.run(['pdftotext', '-', '-'], input=pdf, capture_output=True, check=True).stdout.decode()
                info = subprocess.run(['pdfinfo', '-'], input=pdf, capture_output=True, check=True).stdout.decode()
                assert int(re.search(r'Pages:\s+(\d+)', info).group(1)) == total
                for index in range(85):
                    assert text.count(f'ROW_{index:03d}') == 1, (layout, index, text)
                for index in range(35):
                    assert text.count(f'PARAGRAPH_{index:03d}') == 1, (layout, index, text)
                print(f'PASS: {layout} layout, {total} pages, all 85 rows and 35 long paragraphs retained.')
            # Even one row taller than a sheet must not lose its later content.
            oversized = '\n\n'.join(f'CELL_{index:03d} ' + 'Long activity description with details. ' * 15 for index in range(30))
            large_cell = {'text': oversized, 'header': False, 'colSpan': 1, 'rowSpan': 1}
            page['items'] = [{'kind': 'table', 'section': '', 'label': 'Large entry', 'rows': [[{'text': 'History', 'header': True, 'colSpan': 1, 'rowSpan': 1}], [large_cell]]}]
            page['layouts'] = {'0': 'table'}
            draft = {'format': 'MapleRecord', 'version': 1, 'record': {'title': 'Long cell', 'pages': [page]}}
            preview.evaluate("async draft => chrome.runtime.sendMessage({type:'restore',draft})", draft)
            preview.locator('#refresh-preview').click()
            expect(preview.locator('#save-pdf')).to_be_enabled(timeout=30000)
            pdf = preview.pdf(prefer_css_page_size=True)
            text = subprocess.run(['pdftotext', '-', '-'], input=pdf, capture_output=True, check=True).stdout.decode()
            for index in range(30):
                assert text.count(f'CELL_{index:03d}') == 1, index
            print('PASS: a table row spanning multiple pages retains all 30 text segments.')
            (BASE / 'test-results').mkdir(exist_ok=True)
            preview.screenshot(path=str(BASE / 'test-results/preview.png'))
        finally:
            browser.close()

if __name__ == '__main__':
    main()
