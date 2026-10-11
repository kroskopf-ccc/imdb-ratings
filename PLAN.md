# IMDb Episode Ratings Grid — Plan

A website where you type the name of a TV show, pick it from an autocomplete list, and see every
episode's IMDb rating in a color-coded grid. Built for a family hackathon; hosted free on GitHub Pages.

- **Live site:** https://kroskopf-ccc.github.io/imdb-ratings/
- **Repository:** https://github.com/kroskopf-ccc/imdb-ratings (public)
- **On this PC:** `Documents\Claude\IMDB Ratings`

---

## 0. Status (last updated October 11, 2026)

**Steps 0–7 are done and live.** Step 8 (polish & README) is on hold while more tweaks come in.

| Step | What | Status |
|---|---|---|
| 0 | Setup: Python, Git, GitHub CLI, repository | ✅ Done |
| 1 | Build script: IMDb files → site data | ✅ Done |
| 2 | Search box with autocomplete | ✅ Done |
| 3 | Colored episode grid, hover card, edge cases | ✅ Done |
| 4 | Top 5 / Bottom 5, shark detector, settings, stretch-colors toggle | ✅ Done |
| 5 | Publish to GitHub Pages + weekly refresh | ✅ Done |
| 6 | Footer: data date, Refresh link, "update in progress" popup | ✅ Done |
| 7 | TVmaze air dates and summaries in the hover card | ✅ Done |
| — | Extra: search-box clear button (×), click-to-select, Escape to clear | ✅ Done |
| — | Extra: one combined, collapsible shark box; scores removed from hover cards | ✅ Done |
| — | Extra: phones & tablets: tap opens the card (with × and IMDb link) | ✅ Done |
| 8 | Polish & README | ⏸ Waiting for the next round of tweaks |

### What's left
- [ ] More tweaks (coming in the next few days).
- [x] Phone layout: the "not rated" legend label wrapped awkwardly at phone width (fixed).
- [ ] README.md: how to run locally, rebuild data, publish, and change settings.
- [ ] Final test pass. Your son tries to break it 🙂
- [ ] When tuning is finished: set `showSharkSettingsPanel` to `false` in `site/config.json`
      to hide the settings from family (optional).

---

## 1. Features (as built)

### 1.1 Search box with autocomplete
- Suggestions appear after typing 2+ characters, up to 10 at a time.
- Matching ignores capitalization, accents, and punctuation; it matches the start of any word,
  and words can be in any order ("office us").
- Ranking: exact title first, then titles that start with the text (ignoring a leading
  "The/A/An", so "office" ranks *The Office* as a starts-with match), then word matches.
  Ties are broken by popularity (IMDb vote count).
- Each suggestion shows the years, a "mini-series" tag where it applies, and the show's rating
  and vote count, e.g. **The Office (2005–2013)** vs **The Office (2001–2003)**.
- Mouse, arrow keys, and Enter all work.
- **Invalid entries are impossible:** the app only acts on a show chosen from the list (tracked by
  its IMDb ID). Junk text + Enter shows "Please choose a show from the list." Typing a full
  title exactly and pressing Enter picks the most popular show with that name.
- **Clearing:** a **×** button appears on the right when the box has text. Clicking into a box
  that holds a chosen show selects its name, so typing replaces it. **Escape** closes the
  suggestions first, then clears the box. The current grid stays until a new show is chosen.
- Only shows with at least one rated episode are searchable (about 48,000 shows), so every
  pick produces a useful grid.
- Known quirk: a few ended shows look ongoing ("2012–") because IMDb has no end year for them.

### 1.2 Episode grid
- **Seasons are rows** (S1 at top), **episodes are columns** (E1, E2, …).
- Each cell shows the rating with one decimal place.
- **Color:** smooth scale red (0.0) → yellow (5.0) → green (10.0), i.e. hue = rating × 12.
  Text switches between dark and white, whichever is easier to read.
- **Stretch colors toggle** (top right of the grid): maps the show's lowest rating to red and
  its highest to green, so differences within a show stand out. Remembered in the browser.
  The legend shows the range in use (e.g. 5.2 → 8.7).
- **Mouse:** hover a cell for the details card (1.2.1); click to open the episode on IMDb in a
  new tab. Cells also work with the Tab key.
- **Touch (phones, tablets):** tapping a cell (or a Top/Bottom 5 title) opens the details card
  instead of going to IMDb. The card has a **×** in its upper right corner, and its
  "Click to open on IMDb" line becomes the link. Tapping another cell switches cards; tapping
  anywhere else closes it; the card follows its cell when scrolling. Each tap is checked for
  finger vs. mouse, so touchscreen laptops work both ways.
- On phones, the shark box hides its "details & settings" hint so the verdict has room.
- Header above the grid: show name, years, overall rating, episode count, IMDb link.
- Edge cases:
  - Unrated episodes → gray cell with "—".
  - Seasons of different lengths → blank space after shorter seasons.
  - Long seasons → the grid scrolls sideways; season labels stay pinned on the left.
  - Episodes with no season/episode number (e.g. Top Gear's "Best of" specials) → listed in an
    "Other episodes" table below the grid.
  - Daily shows whose IMDb episode numbers have huge gaps (e.g. 1, 250, 9000) → each season's
    episodes are packed in order, with a note explaining it.

#### 1.2.1 Hover details card
| Item | Source | Example |
|---|---|---|
| Season & episode | IMDb files | S7E22 |
| Episode title | IMDb files | Goodbye, Michael |
| Rating & votes | IMDb files | 9.8 (22,455 votes) |
| Rank within show | Calculated | #1 of 191 (tied) |
| Full air date (or year if TVmaze lacks it) | TVmaze / IMDb | April 28, 2011 |
| Runtime | IMDb files (often missing) | 30 min |
| Short plot summary (shortened to ~240 characters) | TVmaze | one or two sentences |
| "🦈 Jumped the shark here!" | Calculated | only on the shark episode |

The past/next averages were shown on cards at first, then **removed** at your request.

### 1.3 Top 5 and Bottom 5 (shows with 30+ rated episodes)
- Two lists below the shark box, with colored rating badges; hover for the details card,
  click for IMDb.
- Uses all rated episodes. Ties go to the episode with more votes.

### 1.4 "Jumped the Shark" detector (shows with 30+ rated episodes) 🦈
Settings (defaults): **past episodes = 10**, **future episodes = 10**, **rating drop = 0.6**
(changed from 1.0 to 0.6 on October 11, 2026, by editing `config.json` on GitHub).

- All rated, numbered episodes in airing order (season, then episode number).
- For each episode: **past average** = the *past* episodes before it; **next average** = this
  episode and the ones after it, *future* episodes in total.
- An episode qualifies if past − next ≥ *rating drop*, and only if it has enough episodes on
  each side. Of the qualifying episodes, the one with the **biggest drop** is the shark.
- **In the grid:** the shark cell is outlined, with a 🦈 in a white badge on its corner.
- **The shark box** (one collapsible box below the grid):
  - Its header line is the verdict: "🦈 Jumped the shark at S7E27: 'Search Committee, Part 2'
    (2011)", "🏄 No shark jumping detected", or "Too few episodes to check for a shark jump".
  - Inside: the explanation (the two averages and the drop, plus an IMDb link), or for no
    shark, the biggest drop found and where. Then the settings (1.4.1).
  - **Opens automatically** when a newly chosen show jumped the shark; starts **collapsed**
    otherwise. While you change settings it stays however you left it.
- Results with the original 1.0 drop (with 0.6, Happy Days now jumps at S7E24):
  - *The Office (US)*: jumped at S7E27 "Search Committee, Part 2", right after Michael left
    (drop 1.08).
  - *Breaking Bad*: no shark.
  - *Happy Days*: no shark at 1.0; biggest drop 0.66 at S7E24. With 3/3 windows it jumps at
    S7E1 (1.13). The math doesn't agree with the famous S5E3 shark jump.

#### 1.4.1 Changing the shark settings — no rebuilding needed
1. **Settings inside the shark box (for experimenting).** Past episodes, future episodes, rating
   drop, and the minimum episodes for stats (the "30" rule). Changes apply instantly, are
   remembered in your browser, and "Reset to defaults" goes back to the file values.
2. **`site/config.json` (the defaults for everyone):**
   ```json
   {
     "shark": { "pastEpisodes": 10, "futureEpisodes": 10, "minDrop": 0.6 },
     "minEpisodesForStats": 30,
     "showSharkSettingsPanel": true,
     "githubRepo": "kroskopf-ccc/imdb-ratings"
   }
   ```
   Edit it on the GitHub website (pencil icon → change → "Commit changes"). The site
   republishes itself in under a minute. (Edits made on GitHub are pulled into this PC's copy
   before the next local change is pushed.) Setting `showSharkSettingsPanel` to `false` hides the
   settings (the verdict and explanation stay) and makes everyone use the file's values.

### 1.5 Footer: data date and refresh
- Small light-gray text at the bottom: "IMDb data from October 10, 2026 · Refresh data", plus
  credits for IMDb's datasets and TVmaze (CC BY-SA, which requires the credit).
- **Refresh data** opens the update job's page on GitHub, where `kroskopf-ccc` clicks
  **Run workflow**. (A button that started the job directly would need a secret GitHub token
  inside the page, where anyone could copy it.)
- **Popup** at the bottom of the screen for anyone on the site:
  - While a data refresh runs: "⏳ IMDb data update in progress — started N minutes ago…
    The current data still works." Can be closed.
  - When it finishes: "✅ New IMDb data is ready" with a **Reload the page** button.
  - If it fails: "⚠️ The data update didn't finish" with a link to the details.
  - Only data refreshes (weekly or hand-started) trigger it, not code/config publishes.
- The page reads GitHub's public status without signing in. It checks on page load, when the
  tab comes back into view, and every 90 seconds only while a refresh runs. That stays under
  GitHub's limit of 60 checks per hour per visitor.
- A full refresh takes about 2–3 minutes.

---

## 2. How it works

### 2.1 Data sources
**IMDb's free daily data files** (https://datasets.imdbws.com/, personal non-commercial use):

| File | Used for |
|---|---|
| `title.basics.tsv.gz` (~230 MB) | Show names, type, years; episode titles, year, runtime |
| `title.episode.tsv.gz` (~55 MB) | Which episodes belong to which show; season & episode numbers |
| `title.ratings.tsv.gz` (~9 MB) | Rating and vote count for each show and episode |

No API key needed. (IMDb's official API is a paid business product; OMDb's free tier is too
limited for live autocomplete.)

**TVmaze** (free, no key, no sign-up): when a show is picked, the browser looks it up by IMDb ID
and gets every episode's air date and summary, matched by season and episode number. The grid
appears right away; TVmaze details fill in about a second later. If TVmaze doesn't have the show,
cards show the year. Match rate in testing: Breaking Bad 62/62, The Office 191/191.

### 2.2 Static site — no server, no database
`build/build_data.py` (Python, standard library only) downloads the three IMDb files, loads them
into a temporary SQLite database, and writes `site/data/`:

- `shows.json` (2.6 MB, much smaller in transit): one compact row per show
  `[id, title, startYear, endYear, votes, rating, isMiniSeries, episodeCount]`, most popular first.
- `episodes/NNN.json`: 1,000 files, split by the last three digits of the show's IMDb ID
  (median ~87 KB). Each row: `[season, episode, id, title, year, runtime, rating, votes]`.
- `meta.json`: the IMDb data date and the build time.
- **Total ~112 MB**, more than the original 30–60 MB estimate, but well within GitHub Pages' 1 GB
  limit.

Decisions made in the build:
- **Searchable shows:** TV series and mini-series with **at least one rated episode**.
- **Unrated episodes are kept only in seasons that have at least one rated episode.** This cut
  the data from 183 MB to 112 MB by dropping never-rated seasons of daily soaps and news shows,
  while keeping gray "—" cells in normal shows.

The page adds the build time to data file addresses (`?v=…`), so after a refresh, browsers fetch
the new files instead of reusing old saved copies.

Top 5 / Bottom 5, the shark detector, colors, and TVmaze matching all run in the browser.

### 2.3 Hosting & refresh (`.github/workflows/publish.yml`, "Publish site")
- **GitHub Pages** hosts the site (repository must be public on a free account). The data is
  built on GitHub, never committed to the repository (`site/data/` is in `.gitignore`).
- **Every Monday 09:00 UTC** and on **Run workflow**: download fresh IMDb data, build
  (~1.5 minutes), save the data in GitHub's cache, publish.
- **On code or config changes** (pushes to `site/`, `build/`, or the workflow): reuse the most
  recently saved data and publish in under 20 seconds. If no saved data exists, it builds fresh.
- ⚠️ GitHub pauses scheduled jobs after **60 days without repository activity** and sends an
  email. Click "Enable workflow" in the Actions tab (or make any small change) to restart it.

### 2.4 Files in the project
```
IMDB Ratings/
├── PLAN.md                       this document
├── .gitignore                    keeps downloads and generated data out of Git
├── .claude/launch.json           local preview server settings
├── build/
│   ├── build_data.py             IMDb files → site/data/
│   └── downloads/                (not in Git) cached IMDb files
├── site/
│   ├── index.html                the page
│   ├── styles.css                layout & colors
│   ├── app.js                    search, grid, hover card, top/bottom 5, shark detector,
│   │                             settings, TVmaze, footer & refresh popup
│   ├── config.json               shark settings & other tweakable values
│   └── data/                     (not in Git) generated by build_data.py
└── .github/workflows/
    └── publish.yml               weekly rebuild + publish to GitHub Pages
```

### 2.5 Working on it locally
```bash
python build/build_data.py
```
Builds `site/data/` (about 2.5 minutes; IMDb files are reused if already downloaded; add
`--fresh` to re-download).

```bash
python -m http.server 8000 --bind 127.0.0.1 --directory site
```
Serves the site at http://127.0.0.1:8000. Changes go live by committing and pushing to `main`.

### 2.6 Setup on this PC
- Python 3.11.9 (already installed).
- Git 2.55 and GitHub CLI 2.102, installed with `winget` on October 10, 2026. They're at
  `C:\Program Files\Git\cmd\git.exe` and `C:\Program Files\GitHub CLI\gh.exe`. Windows that
  were open before the install may not find them by name until reopened.
- GitHub CLI is signed in as `kroskopf-ccc`.
- This project's commits use GitHub's private no-reply email
  (`340381407+kroskopf-ccc@users.noreply.github.com`), so no personal email appears in the
  public history.

---

## 3. Nice-to-haves (later, if wanted)
- **Shareable links:** the URL includes the show (e.g. `…/#tt0903747`) so you can text a grid
  to family.
- Rolling-average line chart under the grid (visualizes the shark jump).
- Dark mode.
- Search by original (non-English) titles too.
- Optional free login gate (Cloudflare Access) if you'd rather not leave it fully public.

---

## 4. Notes
- IMDb's data license is for personal, non-commercial use: fine for a family project, but share
  the link within the family rather than publicly.
- IMDb's files don't include posters or images, so the site is text and colors only.
- IMDb's data can change from day to day even under the same date (two October 10 builds had
  48,041 and 48,016 shows).

---

## 5. Decisions log
- **Hosting:** static site on GitHub Pages instead of a server (free, fast, no sleeping). Data is
  precomputed by a weekly GitHub Action.
- **Data:** IMDb's free files instead of a paid or limited API.
- **Grid:** seasons as rows.
- **Top/Bottom 5 and shark:** only for shows with 30+ rated, numbered episodes (adjustable).
- **Shark:** "past" = episodes before; "next" = the episode itself plus the ones after; one shark
  per show (the biggest drop).
- **Adjustable settings:** on-page settings for experimenting, plus `config.json` for defaults.
- **Refresh:** the footer link goes to GitHub's Run workflow page instead of an in-page button.
- **TVmaze:** yes, for air dates and summaries. **Directors/writers:** no (too much extra data).
- **Stretch colors toggle:** added in step 4 (was a nice-to-have).
- **Search box:** × button, click-to-select, Escape to clear.
- **Shark display:** verdict and settings combined into one collapsible box, open only when the
  show jumped the shark; past/next scores removed from hover cards.
- **Touch devices:** tap opens the details card (with × and IMDb link) instead of following the
  link; mouse behavior unchanged.
