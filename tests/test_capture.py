"""Browser regressions for captureForm. Run: python tests/test_capture.py"""
import json
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_helpers import launch_chromium

BASE = Path(__file__).resolve().parents[1]

class CaptureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = launch_chromium(cls.playwright)
        cls.page = cls.browser.new_page()
        cls.page.route('http://127.0.0.1:8765/**', lambda route: route.fulfill(content_type='text/html', body='<title>Fixture</title>'))
        cls.page.goto('http://127.0.0.1:8765/form')
        cls.source = (BASE / 'capture.js').read_text()
        cls.values = json.loads((BASE / 'portal-values.json').read_text())

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def capture(self, html):
        self.page.set_content('<main><h1>Test form</h1>' + html + '</main>')
        self.page.add_script_tag(content=self.source)
        return self.page.evaluate('(values) => captureForm(values)', self.values)

    def field(self, html, label):
        result = self.capture(html)
        fields = {item['label']: item['value'] for item in result.get('items', []) if item['kind'] == 'field'}
        self.assertIn(label, fields, result)
        return fields[label]

    def test_text_and_multiline_textarea(self):
        self.assertEqual(self.field('<label>Name<input value="Alice"></label>', 'Name'), 'Alice')
        self.assertEqual(self.field('<label>Notes<textarea>Line 1\nLine 2</textarea></label>', 'Notes'), 'Line 1\nLine 2')

    def test_select_uses_label(self):
        self.assertEqual(self.field('<label>Country<select><option value="CA" selected>Canada</option></select></label>', 'Country'), 'Canada')

    def test_select_preserves_real_negative_one_choices(self):
        html = """<label>Balance<select multiple>
            <option value="" selected>Choose a balance</option>
            <option value="-1" selected label="Negative one">Internal name</option>
            <option value="0" selected>Zero</option></select></label>"""
        self.assertEqual(self.field(html, 'Balance'), 'Negative one, Zero')
        self.assertEqual(self.field('<label>Balance<select><option value="-1">-1</option></select></label>', 'Balance'), '-1')

    def test_select_negative_one_prompt_stays_unanswered(self):
        self.assertEqual(self.field('<label>City<select><option value="-1">-- Please select --</option></select></label>', 'City'), '')

    def test_radio_uses_selected_label(self):
        self.assertEqual(self.field('<fieldset><legend>Married?</legend><label><input type="radio" name="m" value="Y">Yes</label><label><input type="radio" name="m" value="N" checked>No</label></fieldset>', 'Married?'), 'No')

    def test_checkboxes_include_question_and_state(self):
        self.assertEqual(self.field('<fieldset><legend>Languages</legend><label><input type="checkbox" checked>English</label></fieldset>', 'Languages · English'), 'Checked')

    def test_sensitive_hidden_fields_skipped(self):
        result = self.capture('<input type="hidden" value="SECRET"><input type="file"><label>Name<input value="Alice"></label><div hidden><input aria-label="Hidden" value="SECRET"></div><input autocomplete="cc-number" value="SECRET">')
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['value'], 'Alice')

    def test_visible_password_refuses_capture(self):
        self.assertIn('Finish signing in', self.capture('<input type="password" value="SECRET">')['error'])

    def test_definition_list(self):
        self.assertEqual(self.field('<dl><dt>Country</dt><dd>Canada</dd></dl>', 'Country'), 'Canada')

    def test_portal_lookup_in_table(self):
        result = self.capture('<table><tr><th>City</th></tr><tr><td><input type="hidden" data-lovid="8536"></td></tr></table>')
        self.assertEqual(result['items'][0]['rows'][1][0]['text'], 'Acme')

    def test_explicit_contenteditable(self):
        self.assertEqual(self.field('<div aria-label="Notes" contenteditable="true">Some notes</div>', 'Notes'), 'Some notes')

    def test_visible_combobox_input(self):
        self.assertEqual(self.field('<div role="combobox" aria-label="Country"><input value="Canada"></div>', 'Country'), 'Canada')

    def test_hidden_input_does_not_suppress_visible_summary(self):
        self.assertEqual(self.field('<div class="form-group"><label>City</label><div class="form-control-static">Toronto<input type="hidden" name="cityId" value="123"></div></div>', 'City'), 'Toronto')

    def test_hidden_nested_summary_preserves_visible_answer(self):
        for html in [
            '<div class="answer" aria-label="City">Toronto<span class="answer" hidden>Hidden city</span></div>',
            '<div class="question-label">City</div><div>Toronto<span style="display:none"><output>Hidden city</output></span></div>',
        ]:
            with self.subTest(html=html):
                self.assertEqual(self.capture(html).get('items'), [
                    {'section': '', 'kind': 'field', 'label': 'City', 'value': 'Toronto'}
                ])

    def test_visible_nested_summary_is_captured_once_after_hidden_summary(self):
        html = """<div class="answer" aria-label="Address">
            <span class="answer" hidden>Hidden city</span>
            <output aria-label="City">Toronto</output></div>"""
        self.assertEqual(self.capture(html)['items'], [
            {'section': '', 'kind': 'field', 'label': 'City', 'value': 'Toronto'}
        ])

    def test_hidden_input_does_not_suppress_definition(self):
        self.assertEqual(self.field('<dl><dt>Country</dt><dd>Canada<input type="hidden" name="countryId" value="CA"></dd></dl>', 'Country'), 'Canada')

    def test_hidden_input_does_not_suppress_question_answer(self):
        self.assertEqual(self.field('<div class="eapp-question-and-answer"><div class="question-label">Country</div><div>Canada</div><input type="hidden" name="countryId" value="CA"></div>', 'Country'), 'Canada')

    def test_combobox_uses_visible_value_when_backing_input_hidden(self):
        self.assertEqual(self.field('<div role="combobox" aria-label="Country" aria-valuetext="Canada"><span>Canada</span><input type="hidden" value="CA"></div>', 'Country'), 'Canada')

    def test_block_boundaries_preserved(self):
        actual = self.field('<div class="form-group"><label>Address</label><div class="form-control-static"><div>123 Main Street</div><div>Toronto</div><div>Ontario</div></div></div>', 'Address')
        self.assertEqual(' '.join(actual.split()), '123 Main Street Toronto Ontario')

    def test_nested_table_controls_captured_once(self):
        result = self.capture('<table><tr><th>Country</th></tr><tr><td><div role="combobox" aria-label="Country"><input value="Canada"></div></td></tr></table>')
        self.assertEqual(result['items'][0]['rows'][1][0]['text'], 'Canada')

    def test_empty_contenteditable_attribute_supported(self):
        self.assertEqual(self.field('<div aria-label="Notes" contenteditable>Some notes</div>', 'Notes'), 'Some notes')

    def test_plaintext_contenteditable_attribute_supported(self):
        self.assertEqual(self.field('<div aria-label="Notes" contenteditable="plaintext-only">Some notes</div>', 'Notes'), 'Some notes')

    def test_contenteditable_values_are_case_insensitive(self):
        self.assertEqual(self.field('<div aria-label="Notes" contenteditable="TRUE">Some notes</div>', 'Notes'), 'Some notes')

    def test_nested_editable_content_captured_once(self):
        result = self.capture('<div aria-label="Notes" contenteditable><span contenteditable="true">Some notes</span></div>')
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['value'], 'Some notes')

    def test_noneditable_content_is_not_an_input(self):
        result = self.capture('<div aria-label="Notes" contenteditable="false">Not an input</div><label>Name<input value="Alice"></label>')
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['label'], 'Name')

    def test_inline_text_is_not_split(self):
        self.assertEqual(self.field('<dl><dt>Name</dt><dd>Mc<span>Donald</span></dd></dl>', 'Name'), 'McDonald')

    def test_display_contents_keeps_rendered_text_and_inline_boundaries(self):
        html = """<div class="answer" style="display:contents" aria-label="Address">12 Street
            <span style="display:contents">Tor<span>onto</span><span hidden>Hidden city</span></span></div>
            <div style="display:none"><div class="answer" style="display:contents" aria-label="Private">Hidden</div></div>"""
        self.assertEqual(self.capture(html).get('items'), [
            {'section': '', 'kind': 'field', 'label': 'Address', 'value': '12 Street Toronto'}
        ])

    def test_css_block_boundaries_and_breaks_preserved(self):
        self.assertEqual(self.field('<dl><dt>Address</dt><dd>Street<span style="display:block">City</span>Province<br>Canada</dd></dl>', 'Address'), 'Street City Province Canada')

    def test_question_answer_with_hidden_input_in_answer(self):
        self.assertEqual(self.field('<div class="eapp-question-and-answer"><div class="question-label">Country</div><div>Canada<input type="hidden" value="SECRET"></div></div>', 'Country'), 'Canada')

    def test_hidden_textarea_and_sensitive_input_do_not_leak(self):
        self.assertEqual(self.field('<div class="form-group"><label>City</label><div class="form-control-static">Toronto<textarea hidden>SECRET</textarea><input autocomplete="cc-number" value="SECRET"></div></div>', 'City'), 'Toronto')

    def test_visible_control_in_summary_is_not_duplicated(self):
        result = self.capture('<div class="form-group"><label for="city">City</label><div class="form-control-static"><input id="city" value="Toronto"></div></div>')
        self.assertEqual(len(result['items']), 1)
        self.assertEqual(result['items'][0]['value'], 'Toronto')

    def test_combobox_falls_back_to_visible_text_safely(self):
        html = '<div role="combobox" aria-label="Country"><input type="hidden" value="SECRET"><input type="password" hidden value="SECRET"><span hidden aria-selected="true">SECRET</span><span>Canada</span><button>Open</button></div>'
        self.assertEqual(self.field(html, 'Country'), 'Canada')

    def test_combobox_uses_visible_input_after_hidden_input(self):
        self.assertEqual(self.field('<div role="combobox" aria-label="Country"><input type="hidden" value="CA"><input value="Canada"></div>', 'Country'), 'Canada')

    def test_combobox_uses_visible_selected_option(self):
        self.assertEqual(self.field('<div role="combobox" aria-label="Country"><input hidden value="CA"><span aria-selected="true">Canada</span><span>Other option</span></div>', 'Country'), 'Canada')

    def test_equal_independent_table_controls_are_not_deduplicated(self):
        result = self.capture('<table><tr><th>Countries</th></tr><tr><td><input value="Canada"><input value="Canada"></td></tr></table>')
        self.assertEqual(result['items'][0]['rows'][1][0]['text'], 'Canada Canada')

    def test_editable_table_cell_captured(self):
        result = self.capture('<table><tr><th>Notes</th></tr><tr><td contenteditable>Some notes</td></tr></table>')
        self.assertEqual(result['items'][0]['rows'][1][0]['text'], 'Some notes')

    def test_table_cell_interleaves_labels_with_control_answers(self):
        html = """<table><tr><td>From <input value="Toronto"> to
            <span role="combobox"><input value="Ottawa"></span><input type="hidden" value="Hidden">
            via <select><option value="-1" selected>Route A</option></select>
            <label><input type="checkbox" checked> Confirmed</label></td></tr></table>"""
        self.assertEqual(self.capture(html)['items'][0]['rows'][0][0]['text'],
                         'From Toronto to Ottawa via Route A Checked Confirmed')

    def test_visible_frames_report_incomplete_capture(self):
        result = self.capture('<label>Name<input value="Alice"></label><iframe title="Embedded form" srcdoc="<input value=Bob>"></iframe><iframe hidden></iframe>')
        self.assertEqual(len(result['items']), 1)
        self.assertIn('1 embedded frame was not captured', result['warnings'][0])

    def test_collapsed_details_report_expand_instruction(self):
        result = self.capture('<label>Name<input value="Alice"></label><details><summary>History</summary><label>City<input value="Toronto"></label></details>')
        self.assertEqual([item['value'] for item in result['items']], ['Alice'])
        self.assertIn('collapsed section', ' '.join(result['warnings']))
        self.assertIn('Expand', ' '.join(result['warnings']))

    def test_details_only_expose_the_first_summary_until_opened(self):
        html = """<details><summary><input aria-label="Summary" value="Current"></summary>
            <summary><input aria-label="Second summary" value="Second"></summary>
            <details open><summary>History</summary><input aria-label="City" value="Toronto"></details>
            </details>"""
        closed = self.capture(html)
        self.assertEqual([item['value'] for item in closed['items']], ['Current'])
        self.page.locator('details').first.evaluate('(details) => details.open = true')
        opened = self.page.evaluate('(values) => captureForm(values)', self.values)
        self.assertEqual([item['value'] for item in opened['items']], ['Current', 'Second', 'Toronto'])

    def test_closed_details_in_table_omit_direct_text_and_lookup_codes(self):
        html = """<table><tr><td><details><summary>History</summary>Old address</details></td>
            <td><details><summary></summary><input type="hidden" data-lovid="8536"></details></td></tr></table>"""
        result = self.capture(html)
        self.assertEqual([cell['text'] for cell in result['items'][0]['rows'][0]], ['History', ''])

    def test_collapsed_aria_form_panel_reports_warning(self):
        result = self.capture('<label>Name<input value="Alice"></label><button aria-expanded="false" aria-controls="history">History</button><div id="history" hidden><input value="Toronto"></div>')
        self.assertEqual(len(result['warnings']), 1)
        self.assertIn('collapsed section', result['warnings'][0])

    def test_empty_frame_page_returns_actionable_error(self):
        result = self.capture('<iframe title="Embedded form"></iframe>')
        self.assertIn('open it in its own tab', result['error'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
