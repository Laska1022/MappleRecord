"""Browser API shim. Production background.js still handles record mutations."""
import json
from pathlib import Path
from urllib.parse import urlsplit

BASE = Path(__file__).resolve().parents[1]
ORIGIN = "http://127.0.0.1:8766"
CSP = json.loads((BASE / "manifest.json").read_text())["content_security_policy"]["extension_pages"]
MOCK = """
seed => {
  try { localStorage.getItem('mockChromeSession'); } catch { return; }
  const key = 'mockChromeSession';
  if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({applicationRecord: seed}));
  const listeners = [];
  let onMessage;
  const read = () => JSON.parse(localStorage.getItem(key));
  const notify = (oldState, newState) => {
    const keys = new Set([...Object.keys(oldState), ...Object.keys(newState)]);
    const changes = {};
    for (const k of keys) if (JSON.stringify(oldState[k]) !== JSON.stringify(newState[k])) changes[k] = {oldValue: oldState[k], newValue: newState[k]};
    if (Object.keys(changes).length) listeners.forEach(listener => listener(changes, 'session'));
  };
  const write = state => {
    const oldState = read();
    localStorage.setItem(key, JSON.stringify(state));
    notify(oldState, state);
  };
  addEventListener('storage', event => { if (event.key === key) notify(JSON.parse(event.oldValue || '{}'), JSON.parse(event.newValue || '{}')); });
  window._captureSnapshot = structuredClone(seed.pages[0]);
  window._activeTab = {id: 1, title: 'Application form – Portal', url: 'https://portal.example.test/application'};
  window._openedUrls = [];
  window.chrome = {
    runtime: {
      id: 'test-extension', getURL: path => new URL(path, location.origin).href,
      onMessage: {addListener: listener => {onMessage = listener;}},
      sendMessage: message => new Promise((resolve, reject) => {
        try { onMessage(structuredClone(message), {id: 'test-extension'}, resolve); }
        catch (error) { reject(error); }
      }),
      openOptionsPage: async () => { window.open(new URL('review.html', location.origin).href); }
    },
    tabs: { query: async () => [window._activeTab], create: async ({url}) => {window._openedUrls.push(url); window.open(url); return {id: 2};} },
    scripting: { executeScript: async () => [{documentId: 'mock-document', result: structuredClone(window._captureSnapshot)}] },
    storage: {
      session: {
        get: async k => ({[k]: structuredClone(read()[k])}),
        set: async values => write({...read(), ...structuredClone(values)}),
        remove: async k => {const state = read(); delete state[k]; write(state);}
      },
      onChanged: {addListener: listener => listeners.push(listener)}
    }
  };
  window.importScripts = () => {};
}
"""


def serve(route):
    file = (BASE / urlsplit(route.request.url).path.lstrip('/')).resolve()
    if not file.is_relative_to(BASE) or not file.is_file():
        return route.fulfill(status=404, body='Not found')
    mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json'}[file.suffix]
    body = file.read_bytes()
    if file.name in ['review.html', 'preview.html', 'popup.html']:
        name = file.stem.encode()
        target = b'<script defer src="' + name + b'.js"></script>'
        body = body.replace(target, b'<script defer src="capture.js"></script><script defer src="background.js"></script>' + target)
    route.fulfill(body=body, content_type=mime, headers={'Content-Security-Policy': CSP})


def prepare_context(browser, seed):
    context = browser.new_context(accept_downloads=True)
    context.add_init_script('(' + MOCK + ')(' + json.dumps(seed) + ');')
    context.route(ORIGIN + '/**', serve)
    return context
