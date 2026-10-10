# IMDb Episode Ratings Grid — Plan

A website where you type the name of a TV show, pick it from an autocomplete list, and see every
episode's IMDb rating in a color-coded grid. Built for a family hackathon; hosted free on GitHub Pages.

- **GitHub account:** `kroskopf-ccc`
- **Planned URL:** `https://kroskopf-ccc.github.io/imdb-ratings/`

---

## 1. Features (first version)

### 1.1 Search box with autocomplete
- Suggestions appear after typing 2+ characters, up to 10 at a time.
- Matching ignores capitalization and accents, and matches the start of any word
  ("office" finds "The Office").
- Ranking: exact title match first, then titles that start with the text, then everything else.
  Ties are broken by popularity (IMDb vote count).
- Each suggestion shows the years, e.g. **The Office (2005–2013)** vs **The Office (2001–2003)**.
- Mouse, arrow keys, and Enter all work.
- **Invalid entries are impossible:** the app acts only on a show chosen from the list and tracks
  that show's IMDb ID, never the raw typed text. Typing something that isn't in the list and
  pressing Enter shows "Please choose a show from the list."
- Only shows that have at least one episode in IMDb's data are searchable, so every valid pick
  produces a grid.

### 1.2 Episode grid
- **Seasons are rows** (Season 1 at top), **episodes are columns** (E1, E2, …).
- Each cell shows the episode's rating with one decimal place (e.g. `8.7`).
- **Color:** smooth scale from red (0.0) → yellow (5.0) → green (10.0).
  Implementation note: this is simply hue = rating × 12 (0° red, 60° yellow, 120° green).
  Text in each cell switches between dark and light for readability.
- **Hover** a cell: a details card with everything we have for that episode (see 1.2.1).
  **Click** a cell: opens that episode's IMDb page in a new tab.
- Header above the grid: show name, years, and overall series rating.
- Edge cases:
  - Unrated episodes (unaired or too few votes) → gray cell with "—".
  - Seasons of different lengths → blank space after the last episode in shorter seasons.
  - Very long seasons (daily shows, soaps) → the grid scrolls sideways; season labels stay pinned
    on the left.
  - Episodes IMDb hasn't given a season/episode number → listed in a small table below the grid.

#### 1.2.1 Hover details card
| Item | Source | Example |
|---|---|---|
| Season & episode | IMDb files | S5E14 |
| Episode title | IMDb files | Ozymandias |
| Rating & votes | IMDb files | 10.0 (245,312 votes) |
| Air **year** | IMDb files | 2013 |
| Runtime | IMDb files (often missing) | 47 min |
| Rank within show | Calculated | #1 of 62 |
| Past / next averages | Calculated | Past 10: 9.4 · Next 10: 9.6 (useful while tuning the shark settings) |
| Shark explanation | Calculated | only on the 🦈 episode |
| Full air date | TVmaze (see 2.1) | September 15, 2013 |
| Short plot summary | TVmaze | one or two sentences |

If TVmaze doesn't have the show or episode, the card shows the year and leaves out the summary.

### 1.3 Top 5 and Bottom 5 (shows with 30+ episodes)
- Shown below the grid: the five highest-rated and five lowest-rated episodes.
- Each entry shows season/episode (e.g. S3E12), title, and rating in a colored badge;
  clicking goes to IMDb.
- Only rated episodes count. Ties are broken by vote count (more votes ranks higher).

### 1.4 "Jumped the Shark" detector (shows with 30+ episodes) 🦈
Three adjustable settings (defaults shown): **past episodes = 10**, **future episodes = 10**,
**rating drop = 1.0**.

- Put all rated, numbered episodes in airing order (season, then episode number).
- For each episode, compare:
  - **Past average:** the *past episodes* count of episodes *before* it (default 10).
  - **Next average:** this episode *and* the ones after it, *future episodes* in total (default 10).
- If the past average is higher than the next average by at least the *rating drop* (default 1.0),
  the episode is a "jump the shark" candidate. Only episodes with enough episodes on each side
  can qualify.
- Several neighboring episodes will usually qualify at once, so the app marks just **one**:
  the candidate with the **biggest drop**.
- That cell gets a 🦈 icon. Hovering explains it, e.g.
  "Jumped the shark! Previous 10 averaged 8.4 → next 10 averaged 7.1."
- A banner below the grid announces it ("This show jumped the shark at S4E7: *Title*"),
  or says "No shark jumping detected — consistently good (or consistently bad)!"
- Fun test case: *Happy Days*, the show the phrase comes from (the shark jump is S5E3,
  "Hollywood: Part 3"). We'll see whether the math agrees with history.

> The "30+ episodes" rule counts rated, numbered episodes, since those are the ones the
> math can use.

#### 1.4.1 Changing the shark settings — no rebuilding needed
Two ways, both available:

1. **Settings panel on the page (for experimenting).** A small "🦈 Shark settings" panel with the
   three numbers. Change a value and the grid, banner, and hover cards update **instantly** for
   the current show. Your changes are remembered in your browser; a "Reset to defaults" button
   goes back to the file values.
2. **Settings file (the official defaults for everyone).** `site/config.json`:
   ```json
   {
     "shark": { "pastEpisodes": 10, "futureEpisodes": 10, "minDrop": 1.0 },
     "minEpisodesForStats": 30,
     "showSharkSettingsPanel": true
   }
   ```
   You can edit it right on the GitHub website (pencil icon → change number → "Commit").
   The site republishes itself within a few minutes. No code changes.

`minEpisodesForStats` (the "30+" rule) is included too, in case you want to tweak it.
When development is done, set `showSharkSettingsPanel` to `false` to hide the panel from family.

### 1.5 Footer: data date and refresh
- At the bottom of the page in small, light-gray text:
  "IMDb data from October 9, 2026 · Refresh data"
  (the date IMDb published the files, recorded by the build script).
- **Refresh data** link: opens the GitHub page for the update job, where you click
  **"Run workflow."** Only you (signed in to GitHub as `kroskopf-ccc`) can start it.
  That's deliberate: a button that could start the job directly would need a secret GitHub
  password-like token inside the web page, where anyone could copy it.
- **"Update in progress" popup:** the page checks GitHub's public status for the update job
  (no sign-in needed to *read* it). While a refresh is running, a popup says
  "IMDb data update in progress — started 3 minutes ago. The current data still works."
  When it finishes, the popup changes to "New data is ready — reload the page."
- The popup appears for anyone visiting during a refresh, including the automatic weekly one.
  It can be closed, and the site keeps working with the previous data the whole time.
- A refresh takes an estimated 5–10 minutes.

---

## 2. How it works

### 2.1 Data source
IMDb's free daily data files (https://datasets.imdbws.com/, personal non-commercial use):

| File | Used for |
|---|---|
| `title.basics.tsv.gz` | Show names, type, years; episode titles |
| `title.episode.tsv.gz` | Which episodes belong to which show; season & episode numbers |
| `title.ratings.tsv.gz` | Rating and vote count for each show and episode |

No API key is needed. (IMDb's official API is a paid business product; OMDb's free tier is too
limited for live autocomplete.)

**What IMDb's files don't have:** exact air dates (only the year), plot summaries, and images.
**TVmaze** (free, no key, no sign-up) fills the first two gaps for the hover card. When you pick a
show, the browser asks TVmaze for that show's episode list using the IMDb ID, and fills in
**full air dates** and **short summaries**. Matching is done by season and episode number. If
TVmaze doesn't know the show, or numbering differs, the card simply falls back to the year.
The grid appears immediately from IMDb data; TVmaze details fill in a moment later.

### 2.2 Static site — no server, no database
A **build script** (Python) downloads the three files and turns them into small, ready-to-use
data files. The website is plain HTML/CSS/JavaScript that reads those files directly.

- `data/shows.json` — every searchable show: ID, title, years, vote count, overall rating.
  Roughly 1–2 MB compressed; loaded once, so autocomplete runs instantly in the browser.
- `data/episodes/NNN.json` — episode data split into ~1,000 files by the last three digits of the
  show's IMDb ID. Choosing a show downloads only one small file.
- `data/meta.json` — the IMDb data date and when the build ran (shown in the footer).
- Estimated total: 30–60 MB (most of IMDb's data is movies and other things we discard).

`config.json` (shark settings) is separate from the data, so editing it doesn't require
re-downloading IMDb's files.

The Top 5 / Bottom 5 and shark calculations run in the browser, so they can be tweaked without
rebuilding the data.

### 2.3 Hosting & weekly refresh
- **GitHub Pages** hosts the site for free. (A free account requires the repository to be public;
  the code is public, and the data is generated during publishing rather than stored in the repo.)
- A **GitHub Action** runs every week: downloads fresh IMDb files, runs the build script,
  and republishes the site. It can also be started by hand anytime (the footer's "Refresh data"
  link goes straight there).
- Editing `config.json` or the site's code also republishes automatically. The previously
  built data is reused (kept in GitHub's cache) unless it's missing, so these updates are quick.

### 2.4 Files in the project
```
IMDB Ratings/
├── PLAN.md                       this document
├── README.md                     how to run, build, and publish
├── build/
│   └── build_data.py             IMDb files → data/ folder
├── site/
│   ├── index.html                the page
│   ├── styles.css                layout & colors
│   ├── config.json               shark settings & other tweakable values
│   └── app.js                    search, grid, hover card, top/bottom 5, shark detector,
│                                 settings panel, footer & refresh status
└── .github/workflows/
    └── publish.yml               weekly rebuild + publish to GitHub Pages
```

---

## 3. Build steps (in order)

| Step | What | How we'll know it works |
|---|---|---|
| 0 | **Setup:** check Python and Git are installed on this PC; create the `imdb-ratings` repository on GitHub. (You'll do any GitHub sign-in steps yourself.) | `python --version` and `git --version` work; empty repo exists |
| 1 | **Build script:** download IMDb files, produce `shows.json` + episode files | Spot-check known shows (Breaking Bad, The Office, Happy Days); check total size |
| 2 | **Search box** with autocomplete and invalid-entry blocking | Typing "breaking" suggests Breaking Bad first; junk text is rejected |
| 3 | **Episode grid** with colors, hover card, click-through, edge cases | Breaking Bad shows 5 rows; S5E14 "Ozymandias" is deep green; hover shows its details |
| 4 | **Top 5 / Bottom 5**, **shark detector**, **settings panel** + `config.json` | Check results by hand on one show; try Happy Days; changing a setting updates the grid instantly |
| 5 | **Publish:** GitHub Pages + weekly Action | Site loads at the public URL on a phone and a laptop |
| 6 | **Footer:** data date, Refresh link, "update in progress" popup | Start a refresh; popup appears, then "new data is ready" |
| 7 | **TVmaze** air dates and summaries in the hover card | Hover card shows full air date and summary; a show TVmaze lacks still works |
| 8 | **Polish & README** | Your son tries to break it 🙂 |

Each step ends with something you can see and try in the browser before moving on.

---

## 4. Nice-to-haves (later, if wanted)
- **Shareable links:** the URL updates to include the show (e.g. `…/#tt0903747`) so you can text
  a grid to family.
- **"Stretch colors" toggle:** most ratings fall between 6.5 and 9.0, so a fixed 0–10 scale
  looks mostly yellow-green; this option spreads the colors across one show's own range.
- Rolling-average line chart under the grid (visualizes the shark jump).
- Dark mode; phone-friendly layout tweaks.
- Search by original (non-English) titles too.
- Optional free login gate (Cloudflare Access) if you'd rather not leave it fully public.

---

## 5. Notes
- IMDb's data license is for personal, non-commercial use — fine for a family project, but best
  to share the link within the family rather than publicly.
- IMDb's files don't include posters or images, so the first version is text and colors only.

---

## 6. Open decisions
- [x] **TVmaze add-on** for full air dates and plot summaries in the hover card — **yes**.
- [x] **Directors & writers** in the hover card — **no** (not worth the extra download and data size).
- [ ] More ideas still coming.
