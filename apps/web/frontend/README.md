# Web frontend

Plain HTML, CSS and JavaScript pages served by `@repo-safety/web-server`: the paste-a-link / upload page (`index.html`) and the shareable report page (`report.html`, served at `/r/<id>`). No build step.

Report data is always inserted with `textContent`, never as HTML, because scanned repos are hostile.
