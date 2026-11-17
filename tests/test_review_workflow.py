"""Exercise capture, record edits, and PDF contents with mocked Chrome APIs."""
import json
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright

from browser_helpers import launch_chromium

BASE = Path(__file__).resolve().parents[1]
ORIGIN = "http://127.0.0.1:8766"
CSP = json.loads((BASE / "manifest.json").read_text())["content_security_policy"]["extension_pages"]
FIXTURE = """
<main><h1>First form</h1>
  <label>Excluded field<input value="EXCLUDED_SENTINEL"></label>
  <div class="form-group"><label>City</label><div class="form-control-static">Toronto<input type="hidden" value="SECRET_SENTINEL"></div></div>
  <div role="combobox" aria-label="Country" aria-valuetext="Canada"><span>Canada</span><input type="hidden" value="CA"></div>
  <div class="form-group"><label>Address</label><div class="form-control-static"><div>123 Main Street</div><div>Toronto</div><div>Ontario</div></div></div>
  <table><tr><th>Country</th></tr><tr><td><div role="combobox"><input value="Canada"></div></td></tr></table>
  <div aria-label="Notes" contenteditable>Some notes</div>
</main>
"""

# Only browser APIs are mocked. The real background.js handles every edit.
CHROME_MOCK = """
seed => {
  let stored = {applicationRecord: seed};
  const listeners = [];
  let onMessage;
  const notify = (key, oldValue) => {
    const changes = {[key]: {oldValue, newValue: structuredClone(stored[key])}};
    listeners.forEach(listener => listener(changes, 'session'));
  };
  window.chrome = {
    runtime: {
      id: 'test-extension',
      getURL: path => new URL(path, location.origin).href,
      onMessage: {addListener: listener => {onMessage = listener;}},
      sendMessage: message => new Promise((resolve, reject) => {
        try { onMessage(structuredClone(message), {id: 'test-extension'}, resolve); }
        catch (error) { reject(error); }
      })
    },
    storage: {
      session: {
        get: async key => ({[key]: structuredClone(stored[key])}),
        set: async values => {
          for (const [key, value] of Object.entries(values)) {
            const oldValue = structuredClone(stored[key]);
            stored[key] = structuredClone(value);
            notify(key, oldValue);
          }
        },
        remove: async key => {
          const oldValue = structuredClone(stored[key]);
          delete stored[key];
          notify(key, oldValue);
        }
      },
      onChanged: {addListener: listener => listeners.push(listener)}
    }
  };
  // The harness loads these dependencies before background.js as ordinary scripts.
  window.importScripts = () => {};
}
"""


def serve(route):
    file = BASE / urlsplit(route.request.url).path.lstrip("/")
    if not file.is_file():
        return route.fulfill(status=404, body="Not found")
    mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json"}[file.suffix]
    body = file.read_bytes()
    if file.name == "review.html":
        body = body.replace(
            b'<script defer src="review.js"></script>',
            b'<script defer src="capture.js"></script><script defer src="background.js"></script><script defer src="review.js"></script>',
        )
    route.fulfill(body=body, content_type=mime, headers={"Content-Security-Policy": CSP})


def main():
    with sync_playwright() as playwright:
        browser = launch_chromium(playwright)
        try:
            fixture_page = browser.new_page()
            fixture_page.route(ORIGIN + "/fixture", lambda route: route.fulfill(content_type="text/html", body=FIXTURE))
            fixture_page.goto(ORIGIN + "/fixture")
            fixture_page.add_script_tag(content=(BASE / "capture.js").read_text())
            captured = fixture_page.evaluate("values => captureForm(values)", json.loads((BASE / "portal-values.json").read_text()))
            assert len(captured["items"]) == 6, captured
            fixture_page.close()
            first = {**captured, "id": "page-a", "documentId": "doc-a", "capturedAt": "2026-11-17T00:00:00.000Z", "excluded": []}
            second = {
                "id": "page-b", "documentId": "doc-b", "title": "Second form", "source": "example.test",
                "capturedAt": "2026-11-17T00:00:00.000Z", "excluded": [],
                "items": [{"section": "", "kind": "field", "label": "Last name", "value": "Smith"}],
            }
            seed = {"title": "Application record", "pages": [first, second]}
            context = browser.new_context()
            context.add_init_script("(" + CHROME_MOCK + ")(" + json.dumps(seed) + ");")
            context.route(ORIGIN + "/**", serve)
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(ORIGIN + "/review.html")
            expect(page.locator("#summary")).to_have_text("2 captured pages · 7 fields included")

            page.locator("#rename").click()
            page.locator("#title-input").fill("Renamed record")
            page.locator("#confirm").click()
            expect(page.locator("#record-title")).to_have_text("Renamed record")
            expect(page.locator("#edit-dialog")).not_to_be_visible()

            page.locator('[data-focus="page-a-0"]').uncheck()
            expect(page.locator("#summary")).to_have_text("2 captured pages · 6 fields included")
            expect(page.locator("#print")).to_be_enabled()
            page.emulate_media(media="print")
            expect(page.locator(".answer:visible")).to_have_text(["Toronto", "Canada", "123 Main Street Toronto Ontario", "Some notes", "Smith"])
            expect(page.locator(".table-field td")).to_have_text("Canada")
            pdf = page.pdf(format="A4")
            result = subprocess.run(["pdftotext", "-", "-"], input=pdf, capture_output=True, check=True)
            text = " ".join(result.stdout.decode().split())
            for value in ["Renamed record", "Toronto", "Canada", "123 Main Street Toronto Ontario", "Some notes", "Smith"]:
                assert value in text, (value, text)
            assert "EXCLUDED_SENTINEL" not in text and "SECRET_SENTINEL" not in text
            page.emulate_media(media="screen")

            page.locator('[data-focus="page-b-up"]').click()
            expect(page.locator(".page-header h2")).to_have_text(["Second form", "First form"])
            page.locator('[data-focus="page-a-remove"]').click()
            page.locator("#confirm").click()
            expect(page.locator(".page-header h2")).to_have_text(["Second form"])
            page.locator("#clear").click()
            page.locator("#confirm").click()
            expect(page.locator("#summary")).to_have_text("0 captured pages · 0 fields included")
            expect(page.locator("#print")).to_be_disabled()
            expect(page.locator("#empty")).to_be_visible()
            assert not errors, errors
            print("PASS: corrected captures, rename, exclusion, PDF contents, reorder, remove, clear (mocked Chrome APIs).")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
