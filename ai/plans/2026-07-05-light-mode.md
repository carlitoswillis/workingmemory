# Light mode (user-selectable theme) — plan, 2026-07-05

Backlog item: "Light and Dark mode options (aesthetics)". Dark Nocturne stays the
default and the identity; this adds a **"Nocturne Day"** light theme the user can
switch to, persisted per device. No schema change, no new deps, works identically
in local / demo / hosted modes.

## Why it's cheap
All component color already flows through the 12 CSS custom properties in
`app/globals.css` (`--bg-0` … `--done`) — the tailwind classes are
`bg-[var(--surface)]`-style throughout. A light theme is therefore: a second
token block + a toggle + tokenizing ~10 hardcoded stragglers.

## 1. Tokenize the stragglers
Add a few tokens to `:root` and swap the literals for them:

| New token | Dark value (today's literal) | Used at |
|---|---|---|
| `--scrim` | `rgba(0,0,0,.55)` (`bg-black/55`) | CardPanel:206, SnapshotCardPanel:36, ArchiveView:60 overlays |
| `--scrim-deep` | `rgba(8,10,18,.6)` / `.5` | QuickCapture:60,88 |
| `--wash` | `rgba(20,26,46,.35)` | column surfaces: Board:681,716, NoteColumn:47, TimeMachineBar:92 |
| `--now-wash` / `--now-line` | `rgba(28,26,40,.5)` / `rgba(227,168,102,.18)` | `.col-now` (globals.css:45-46) |
| `--now-tick` | `rgba(227,168,102,.22)` | scrubber tick (globals.css:260) |
| `--past-wash` / `--past-line` | `rgba(110,139,196,.08)` / `.4` | TimeMachineBar:91 time-travel state |

(Naming TBD in build; keep the wash/line pattern.)

## 2. Light token block
`html[data-theme="light"] { … ; color-scheme: light; }` overriding all tokens.
Direction: **warm paper daylight** — same semantic mapping (amber = now, faded
blue = past, green = done), matte, no glow, AA contrast for text tokens.
Draft (to be tuned by eye):

```css
--bg-0: #ece8dd;   --bg-1: #f6f3ea;
--surface: #fbf9f2; --surface-2: #f0ecdf;
--veil: #d5cfbe;    --veil-soft: #e3ddcd;
--text-hi: #2b2a35; --text-mid: #5b5a6c; --text-lo: #8a8899;
--now: #b0742a;     --past: #4d6ba8;     --done: #35836a;
```

Check `.memory-mode` (saturate/brightness filter) in light — may need a
per-theme variant (e.g. slight sepia instead of darken). Body gradient already
uses `--bg-1/--bg-0`, so it inherits.

## 3. Toggle + persistence
- Device preference, not account data: `localStorage["wm-theme"]` = `"dark" |
  "light"`; absent = dark (default). No server/schema involvement.
- **No-flash boot**: tiny inline `<script>` in `app/layout.tsx` `<head>` reads
  localStorage and sets `document.documentElement.dataset.theme` before first
  paint. Add `suppressHydrationWarning` on `<html>`.
- `components/ThemeToggle.tsx` (client): low-key ☾/☀ button, sets the attribute
  + localStorage. Place in the board header (near 🗄) and the landing page
  header, and on /login + /signup.
- v1 skips a "system" option (three-way toggle is easy to add later via
  `matchMedia("(prefers-color-scheme)")` if wanted).

## 4. Verify
tsc, 5 suites, prod build (First Load JS should hold ~118kB — the inline script
is bytes). Then owner eyeballs BOTH themes across: board, card panel, time
machine (scrub + snapshot panel), archive view, quick-capture, note markdown,
landing page, login/signup, demo banner. Contrast-check text tokens on their
surfaces (AA).

## Open questions (owner)
1. Palette direction ok? (warm paper vs. neutral cool gray)
2. Default stays dark for everyone, incl. the landing page?
3. Toggle placement taste — header icon button ok?
