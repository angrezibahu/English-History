# A History of England — offline course PWA

A static, installable Progressive Web App for an audio-led history course.
No backend, no accounts, no build framework — just HTML, CSS, and a little
vanilla JavaScript, hosted on GitHub Pages.

- **Syllabus homepage** listing every term and week.
- **Week pages** that render the week's Markdown notes and play its lecture audio.
- **Offline listening** — a service worker caches pages and audio; seeking works
  offline via HTTP range support.
- **Progress ticks** — "listened" state is stored in `localStorage`, per device.
- **Installable** — a web app manifest with maskable icons.
- **Mobile-first** and light/dark aware.

## Adding course content

Content is auto-discovered from the folder structure. Drop files into:

```
course/
  term-<N>/
    week-<NN>/
      notes.md          # one or more Markdown docs
      glossary.md
      lecture.mp3       # exactly one audio file (mp3/m4a/ogg/wav/…)
```

- Terms are folders named `term-1`, `term-2`, … and weeks are `week-01`, `week-02`, ….
- The week's **title** comes from the first heading of its primary doc
  (`notes.md`/`index.md`/`readme.md` lead; otherwise the first `.md` alphabetically).
- Course title and description live in `course/course.json`.

Then regenerate the index:

```sh
npm run build:index      # writes course/index.json
```

The GitHub Actions workflow runs `npm run build` on every push to `main`, so the
deployed site always matches the committed content. `course/index.json` is also
committed so the site works even without running the build.

## Local development

```sh
npm run serve            # http://localhost:8080  (static server with range support)
```

Because it registers a service worker, use a real server (the command above) or
GitHub Pages — opening `index.html` from `file://` will not work.

## Deployment

1. Push to the default branch (`main`).
2. In the repo, **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The `Deploy PWA to GitHub Pages` workflow builds icons + the course index and
   publishes the site.

## Build scripts (all dependency-free, Node ≥ 18)

| Command | What it does |
| --- | --- |
| `npm run build` | Generate icons, then the course index. |
| `npm run build:index` | Scan `course/` and write `course/index.json`. |
| `npm run build:icons` | Generate the PWA PNG icons. |
| `npm run build:sample-audio` | Regenerate the placeholder lecture audio. |
| `npm run serve` | Serve the site locally. |

## Project layout

```
index.html                 App shell
manifest.webmanifest       PWA manifest
sw.js                       Service worker (offline caching + audio ranges)
assets/css/app.css          Styles (mobile-first, light/dark)
assets/js/app.js            Router, views, player, progress
assets/js/markdown.js       Tiny Markdown renderer
assets/icons/               Generated PNG icons
course/                     Course content + generated index.json
scripts/                    Build + dev tooling
.github/workflows/          Pages deploy
```

The sample lectures are short generated tones — replace them with the real
recordings (any browser-playable audio format).
