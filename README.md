# Kosh — make your salary last till payday

A payday-to-payday money planner for salaried professionals. It answers one question:
**how much can I safely spend per day until my next salary, without touching my savings?**

Built with plain HTML, CSS and JavaScript (ES modules) — no framework, no build step.

## Features
- **Safe-to-spend per day** — salary minus your savings share, minus what you've spent, spread over the days left in the pay cycle.
- **Payday-based cycles** — cycles run from payday to payday (handles a payday on the 31st in shorter months).
- **Transactions** — add, search, filter, delete with undo, export to CSV.
- **Budgets** — per-category limits with amber (80%) and red (over) states.
- **Savings goals** — tells you the monthly amount needed to hit each deadline.
- **EMI calculator** — standard reducing-balance formula with principal/interest split.
- **Currency converter** — live rates from a public REST API, with timeout, 12-hour cache and offline fallback.
- Light/dark theme, responsive (bottom nav on mobile), keyboard and screen-reader friendly.

## Project structure
```
index.html          App shell and views
css/styles.css      Design tokens (light/dark), layout, components
js/core.js          Pure business logic — no DOM, fully unit-tested
js/store.js         localStorage persistence + demo data
js/api.js           Exchange-rate API client (timeout, cache, fallback)
js/app.js           UI: hash routing, rendering, events
tests/core.test.js  22 unit tests (Node's built-in test runner)
```

## Run locally
ES modules need a local server (opening the file directly won't work):
```bash
python -m http.server 8000      # then open http://localhost:8000
# or
npm start
```

## Run tests
```bash
npm test        # Node 20+, no dependencies to install
```
Tests also run automatically on every push via GitHub Actions (`.github/workflows/test.yml`).

## Deploy (free)
**GitHub Pages:** push this folder to a repo → Settings → Pages → Source: *Deploy from a branch* → `main` / root → Save.
Your site appears at `https://<username>.github.io/<repo>/`.

**Vercel / Netlify:** import the repo, framework preset *Other*, no build command, output directory `.`.

## Engineering decisions
- **Logic separated from UI.** `core.js` takes plain data and returns plain data, so every calculation is testable without a browser.
- **Security.** All user text is escaped before rendering (stored-XSS protection). CSV export neutralises cells starting with `= + - @` to prevent spreadsheet formula injection.
- **Resilient API calls.** `AbortController` timeout, response validation, cached and offline fallbacks; the UI tells the user which one it is showing.
- **Dates in local time.** ISO strings are parsed manually so a date never shifts by a day due to UTC conversion.
- **Accessibility.** Semantic landmarks, labelled inputs, field-level error messages linked with `aria-describedby`, focus moved to the page title on navigation, reduced-motion support.
