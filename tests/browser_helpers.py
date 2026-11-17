"""Use an installed Chromium, an explicit path, or Playwright's bundled browser."""
import os
import shutil


def launch_chromium(playwright):
    executable = os.environ.get("CHROMIUM_EXECUTABLE") or shutil.which("chromium")
    options = {"headless": True}
    if executable:
        options["executable_path"] = executable
    return playwright.chromium.launch(**options)
