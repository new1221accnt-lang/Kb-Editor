#!/usr/bin/env python3
"""Generate kb-editor-standalone.html — a single self-contained file (all CSS/JS inlined)
that works offline from file:// and on any static host, with no server or preview token."""
import re, base64, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text()
css = (root / 'css/style.css').read_text()
app = pathlib.Path('/tmp/kb-app-iife.js').read_text()

svg_b64 = base64.b64encode((root / 'favicon.svg').read_bytes()).decode()
html = html.replace('href="favicon.svg"', f'href="data:image/svg+xml;base64,{svg_b64}"')
html = re.sub(r'\s*<link rel="modulepreload"[^>]*>', '', html)

old_css = '<link rel="stylesheet" href="css/style.css">'
assert old_css in html
html = html.replace(old_css, '<style>\n' + css + '\n</style>', 1)

old_js = '<script type="module" src="js/app.js"></script>'
assert old_js in html
html = html.replace(old_js, '<script id="kb-app-bundle">\n' + app + '\n</script>', 1)

out = root / 'kb-editor-standalone.html'
out.write_text(html)
print(f'wrote {out} ({out.stat().st_size} bytes)')
