"use strict";

// =====================================================================
// Data
// =====================================================================

// shows.json rows: [id, title, startYear, endYear, votes, rating, isMiniSeries, episodeCount],
// already sorted by votes (most popular first).
let shows = [];

function imdbId(id) {
  return "tt" + String(id).padStart(7, "0");
}

function yearRange(show) {
  if (!show.start) return "";
  if (show.mini || show.end === show.start) return String(show.start);
  return `${show.start}–${show.end ?? ""}`;
}

/** Lowercase, strip accents and punctuation: "Amélie's  Café!" -> "amelie s cafe" */
function normalize(text) {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "the office" -> "office", so "office" ranks "The Office" as a starts-with match. */
function stripArticle(norm) {
  return norm.replace(/^(the|a|an) /, "");
}

// The build time from meta.json, added to data URLs so browsers fetch new files after a refresh
// instead of reusing old copies they saved.
let dataVersion = "";

async function loadMeta() {
  try {
    const resp = await fetch("data/meta.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const meta = await resp.json();
    dataVersion = encodeURIComponent(meta.builtAt || "");
    return meta;
  } catch (err) {
    console.warn("meta.json not loaded:", err);
    return null;
  }
}

async function loadShows() {
  const resp = await fetch(`data/shows.json?v=${dataVersion}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const rows = await resp.json();
  shows = rows.map(([id, title, start, end, votes, rating, mini, episodes]) => {
    const norm = normalize(title);
    return {
      id, title, start, end, votes, rating, mini: !!mini, episodes,
      norm,
      core: stripArticle(norm),   // title without a leading "The/A/An"
      padded: " " + norm,         // for "starts a word" checks
    };
  });
}

// =====================================================================
// Search
// =====================================================================

const MAX_SUGGESTIONS = 10;
const MIN_CHARS = 2;

/**
 * Rank shows against the typed text. Lower tier = better match:
 *   0  exact title          ("the office" or "office" -> The Office)
 *   1  title starts with it ("break" -> Breaking Bad)
 *   2  a word starts with it ("bad" -> Breaking Bad)
 *   3  every typed word starts some word in the title, any order ("office us")
 * Within a tier, shows keep their popularity order.
 */
function search(text) {
  const q = normalize(text);
  if (q.length < MIN_CHARS) return [];
  const qCore = stripArticle(q);
  const words = q.split(" ");

  const tiers = [[], [], [], []];
  for (const show of shows) {
    let tier;
    if (show.norm === q || show.core === qCore) tier = 0;
    else if (show.norm.startsWith(q) || show.core.startsWith(qCore)) tier = 1;
    else if (show.padded.includes(" " + q)) tier = 2;
    else if (words.length > 1 && words.every(w => show.padded.includes(" " + w))) tier = 3;
    else continue;
    tiers[tier].push(show);
  }
  return tiers.flat().slice(0, MAX_SUGGESTIONS);
}

// =====================================================================
// Search box UI
// =====================================================================

const form = document.getElementById("search-form");
const input = document.getElementById("search-input");
const list = document.getElementById("search-list");
const message = document.getElementById("search-message");

let suggestions = [];   // shows currently listed
let active = -1;        // index of the highlighted suggestion, -1 = none
let selected = null;    // the show the user picked (only ever a real show)

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

/** Bold the first part of the title that matches what was typed. */
function highlight(title, typed) {
  const words = normalize(typed).split(" ").filter(Boolean);
  if (!words.length) return escapeHtml(title);
  // Find the match position on a same-length, accent-free lowercase copy of the title.
  const plain = title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (plain.length !== title.length) return escapeHtml(title);
  const re = new RegExp(`(^|[^a-z0-9])(${words[0]})`);
  const m = re.exec(plain);
  if (!m) return escapeHtml(title);
  const start = m.index + m[1].length, end = start + m[2].length;
  return escapeHtml(title.slice(0, start)) + "<mark>" + escapeHtml(title.slice(start, end)) +
         "</mark>" + escapeHtml(title.slice(end));
}

function formatVotes(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "K";
  return String(n);
}

function renderSuggestions() {
  list.innerHTML = "";
  const typed = input.value;
  if (normalize(typed).length < MIN_CHARS) {
    closeList();
    return;
  }
  if (!suggestions.length) {
    list.innerHTML = '<li class="empty">No TV shows match. Try a different spelling.</li>';
  }
  suggestions.forEach((show, i) => {
    const li = document.createElement("li");
    li.id = `suggestion-${i}`;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", i === active ? "true" : "false");
    const meta = show.rating
      ? `★ ${show.rating.toFixed(1)} · ${formatVotes(show.votes)} votes`
      : "not rated";
    li.innerHTML =
      `<span><span class="s-title">${highlight(show.title, typed)}</span>` +
      ` <span class="s-years">(${yearRange(show)})</span>` +
      (show.mini ? '<span class="s-tag">mini-series</span>' : "") + "</span>" +
      `<span class="s-meta">${meta}</span>`;
    // mousedown (not click) so it fires before the input loses focus
    li.addEventListener("mousedown", e => { e.preventDefault(); choose(show); });
    li.addEventListener("mousemove", () => { if (active !== i) setActive(i); });
    list.appendChild(li);
  });
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function setActive(i) {
  active = i;
  [...list.children].forEach((li, j) => li.setAttribute("aria-selected", j === i ? "true" : "false"));
  if (i >= 0) {
    input.setAttribute("aria-activedescendant", `suggestion-${i}`);
    list.children[i].scrollIntoView({ block: "nearest" });
  } else {
    input.removeAttribute("aria-activedescendant");
  }
}

function closeList() {
  list.hidden = true;
  input.setAttribute("aria-expanded", "false");
  input.removeAttribute("aria-activedescendant");
  active = -1;
}

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

function choose(show) {
  selected = show;
  input.value = `${show.title} (${yearRange(show)})`;
  updateClearButton();
  closeList();
  showMessage("");
  showSelected(show);
}

// The "×" button empties the box for the next search. The show on screen stays until a new
// one is chosen.
const clearButton = document.getElementById("search-clear");

function updateClearButton() {
  clearButton.hidden = !input.value;
}

function clearSearch() {
  input.value = "";
  selected = null;
  suggestions = [];
  closeList();
  showMessage("");
  updateClearButton();
  input.focus();
}

// mousedown + preventDefault keeps the focus in the search box
clearButton.addEventListener("mousedown", e => e.preventDefault());
clearButton.addEventListener("click", clearSearch);

input.addEventListener("input", () => {
  selected = null;          // any edit means the box no longer holds a chosen show
  showMessage("");
  updateClearButton();
  suggestions = search(input.value);
  active = -1;
  renderSuggestions();
});

// Clicking into a box that holds a chosen show selects its name, so typing replaces it.
input.addEventListener("click", () => {
  if (selected && input.selectionStart === input.selectionEnd) input.select();
});

input.addEventListener("keydown", e => {
  const open = !list.hidden && suggestions.length > 0;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!open) { suggestions = search(input.value); renderSuggestions(); return; }
    setActive((active + 1) % suggestions.length);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (open) setActive(active <= 0 ? suggestions.length - 1 : active - 1);
  } else if (e.key === "Escape") {
    // First Escape closes the suggestions; the next one clears the box.
    if (!list.hidden) closeList();
    else if (input.value) clearSearch();
  }
});

input.addEventListener("focus", () => {
  if (!selected && input.value) { suggestions = search(input.value); renderSuggestions(); }
});
input.addEventListener("blur", closeList);

// Enter submits the form. Only a real show from the list is ever accepted.
form.addEventListener("submit", e => {
  e.preventDefault();
  if (active >= 0 && suggestions[active]) return choose(suggestions[active]);
  if (selected) return;

  // Typed the full title without picking? Accept it if it exactly matches a show
  // (the most popular one, if several share the name).
  const q = normalize(input.value);
  const exact = q && shows.find(s => s.norm === q);
  if (exact) return choose(exact);

  closeList();   // so the dropdown doesn't cover the message
  showMessage(input.value.trim()
    ? "Please choose a show from the list."
    : "Type the name of a TV show, then choose it from the list.");
});

// =====================================================================
// Episodes
// =====================================================================

// Episode files are shared by ~50 shows each (split by the last 3 digits of the show ID),
// so remember the ones already downloaded.
const episodeFiles = new Map();

async function loadEpisodes(showId) {
  const shard = String(showId % 1000).padStart(3, "0");
  if (!episodeFiles.has(shard)) {
    const promise = fetch(`data/episodes/${shard}.json?v=${dataVersion}`).then(resp => {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    });
    episodeFiles.set(shard, promise);
    promise.catch(() => episodeFiles.delete(shard));   // allow a retry after a failure
  }
  const rows = (await episodeFiles.get(shard))[showId] || [];
  // [season, episode, id, title, year, runtime, rating, votes]
  return rows.map(([season, episode, id, title, year, runtime, rating, votes]) =>
    ({ season, episode, id, title, year, runtime, rating, votes }));
}

/** Sort rated episodes best-first and give each a rank (ties share a rank: 1, 2, 2, 4). */
function rankEpisodes(episodes) {
  const rated = episodes.filter(e => e.rating != null)
    .sort((a, b) => b.rating - a.rating || (b.votes || 0) - (a.votes || 0));
  rated.forEach((e, i) => {
    e.rank = i > 0 && e.rating === rated[i - 1].rating ? rated[i - 1].rank : i + 1;
    e.tied = false;
  });
  rated.forEach((e, i) => {
    if ((rated[i - 1]?.rank === e.rank) || (rated[i + 1]?.rank === e.rank)) e.tied = true;
  });
  return rated;
}

/**
 * Arrange episodes into rows (seasons) and columns (episode numbers).
 * Episodes without a season/episode number, or that collide with another episode's slot,
 * are returned separately as "other".
 */
function layoutGrid(episodes) {
  const seasons = new Map();
  const other = [];
  for (const e of episodes) {
    if (e.season == null || e.episode == null) { other.push(e); continue; }
    if (!seasons.has(e.season)) seasons.set(e.season, new Map());
    const row = seasons.get(e.season);
    if (row.has(e.episode)) other.push(e);
    else row.set(e.episode, e);
  }
  let first = Infinity, last = -Infinity, longest = 0;
  for (const row of seasons.values()) {
    longest = Math.max(longest, row.size);
    for (const n of row.keys()) { first = Math.min(first, n); last = Math.max(last, n); }
  }
  const seasonNumbers = [...seasons.keys()].sort((a, b) => a - b);

  // Some daily shows number episodes with big gaps (e.g. 1, 250, 9000), which would make
  // thousands of mostly empty columns. Then pack each season's episodes in order instead.
  const packed = last - first + 1 > 2 * longest + 10;
  if (packed) {
    for (const [s, row] of seasons) {
      const ordered = [...row.entries()].sort((a, b) => a[0] - b[0]).map(([, e]) => e);
      seasons.set(s, new Map(ordered.map((e, i) => [i + 1, e])));
    }
    first = 1;
    last = longest;
  }
  return { seasons, seasonNumbers, first, last, other, packed };
}

// =====================================================================
// Settings: config.json defaults + this browser's changes
// =====================================================================

const DEFAULT_CONFIG = {
  shark: { pastEpisodes: 10, futureEpisodes: 10, minDrop: 1.0 },
  minEpisodesForStats: 30,
  showSharkSettingsPanel: true,
  githubRepo: "kroskopf-ccc/imdb-ratings",
};
let config = DEFAULT_CONFIG;

async function loadConfig() {
  try {
    const resp = await fetch("config.json", { cache: "no-cache" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const c = await resp.json();
    config = {
      ...DEFAULT_CONFIG, ...c,
      shark: { ...DEFAULT_CONFIG.shark, ...(c.shark || {}) },
    };
  } catch (err) {
    console.warn("config.json not loaded, using built-in defaults:", err);
  }
}

// Browser storage can be unavailable (private windows, blocked cookies); never let that break the page.
function storageGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function storageSet(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

function defaultSettings() {
  return {
    past: config.shark.pastEpisodes,
    future: config.shark.futureEpisodes,
    drop: config.shark.minDrop,
    minEpisodes: config.minEpisodesForStats,
  };
}

/** The settings in effect: config.json, plus this browser's changes if the panel is enabled. */
function currentSettings() {
  const saved = config.showSharkSettingsPanel ? storageGet("sharkSettings") : null;
  return { ...defaultSettings(), ...(saved || {}) };
}

const panelInputs = {
  past: document.getElementById("set-past"),
  future: document.getElementById("set-future"),
  drop: document.getElementById("set-drop"),
  minEpisodes: document.getElementById("set-min"),
};

function fillPanel() {
  const s = currentSettings();
  for (const [key, el] of Object.entries(panelInputs)) {
    el.value = key === "drop" ? s.drop.toFixed(1) : s[key];   // "1.0", not "1"
  }
  const d = defaultSettings();
  document.getElementById("panel-defaults").textContent =
    `Defaults (from config.json): ${d.past} past · ${d.future} future · ${d.drop.toFixed(1)} drop · ${d.minEpisodes} episodes.`;
}

function setupPanel() {
  const settingsArea = document.getElementById("shark-settings");
  settingsArea.hidden = !config.showSharkSettingsPanel;
  if (settingsArea.hidden) return;
  fillPanel();

  for (const el of Object.values(panelInputs)) {
    el.addEventListener("input", () => {
      // Only apply complete, valid values; ignore half-typed ones like "" or "0."
      if (!Object.values(panelInputs).every(i => i.value !== "" && i.checkValidity())) return;
      const s = {
        past: Math.round(Number(panelInputs.past.value)),
        future: Math.round(Number(panelInputs.future.value)),
        drop: Number(panelInputs.drop.value),
        minEpisodes: Math.round(Number(panelInputs.minEpisodes.value)),
      };
      const d = defaultSettings();
      const same = Object.keys(s).every(k => s[k] === d[k]);
      storageSet("sharkSettings", same ? null : s);
      render();
    });
  }
  document.getElementById("set-reset").addEventListener("click", () => {
    storageSet("sharkSettings", null);
    fillPanel();
    render();
  });
}

const stretchToggle = document.getElementById("stretch-colors");
stretchToggle.checked = !!storageGet("stretchColors");
stretchToggle.addEventListener("change", () => {
  storageSet("stretchColors", stretchToggle.checked);
  render();
});

// =====================================================================
// Colors
// =====================================================================

// When "stretch colors" is on, the show's lowest rating maps to red and its highest to green.
let colorRange = null;   // { min, max } or null for the normal 0–10 scale

/** Position on the 0–10 color scale for a rating (after stretching, if on). */
function colorPosition(rating) {
  const pos = colorRange ? (rating - colorRange.min) / (colorRange.max - colorRange.min) * 10 : rating;
  return Math.max(0, Math.min(10, pos));
}

/** Red (0.0) -> yellow (5.0) -> green (10.0): hue goes 0° -> 60° -> 120°. */
function hueColor(pos) {
  return `hsl(${pos * 12} 72% 52%)`;
}

function ratingColor(rating) {
  return hueColor(colorPosition(rating));
}

/** Dark or white text, whichever is easier to read on the given rating's color. */
function ratingTextColor(rating) {
  const [r, g, b] = hslToRgb(colorPosition(rating) * 12, 0.72, 0.52);
  const lum = [r, g, b]
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  const contrastDark = (lum + 0.05) / (0.0137 + 0.05);   // vs. #1d1d1f
  const contrastWhite = 1.05 / (lum + 0.05);
  return contrastDark >= contrastWhite ? "#1d1d1f" : "#ffffff";
}

function hslToRgb(h, s, l) {
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

function ratingBadge(rating) {
  if (rating == null) return '<span class="badge unrated">—</span>';
  return `<span class="badge" style="background:${ratingColor(rating)};color:${ratingTextColor(rating)}">` +
         `${rating.toFixed(1)}</span>`;
}

function renderLegend() {
  const stops = [0, 2.5, 5, 7.5, 10].map(p => `${hueColor(p)} ${p * 10}%`).join(", ");
  const [lo, hi] = colorRange ? [colorRange.min, colorRange.max] : [0, 10];
  return `<span>${lo.toFixed(1)}</span>` +
         `<span class="legend-bar" style="background:linear-gradient(to right, ${stops})"></span>` +
         `<span>${hi.toFixed(1)}</span>` +
         `<span class="legend-unrated">${ratingBadge(null)} not rated</span>`;
}

// =====================================================================
// Jump-the-shark detector
// =====================================================================

/**
 * `sequence` is the show's rated, numbered episodes in airing order. For each episode with
 * enough episodes around it, compare the average of the `past` episodes before it with the
 * average of it and the episodes after it (`future` in total). Stores pastAvg/nextAvg on each
 * episode (for the hover card) and returns the episode with the biggest drop, if that drop is
 * at least `minDrop`.
 */
function findShark(sequence, { past, future, drop: minDrop }) {
  for (const e of sequence) { e.pastAvg = e.nextAvg = null; }
  const sums = [0];
  for (const e of sequence) sums.push(sums[sums.length - 1] + e.rating);

  let biggest = null;   // the largest drop anywhere, even if below minDrop
  for (let i = past; i + future <= sequence.length; i++) {
    const e = sequence[i];
    e.pastAvg = (sums[i] - sums[i - past]) / past;
    e.nextAvg = (sums[i + future] - sums[i]) / future;
    const d = e.pastAvg - e.nextAvg;
    if (!biggest || d > biggest.drop + 1e-9) biggest = { episode: e, drop: d };
  }
  // Compare with a little tolerance so 8.4 - 7.4 counts as a 1.0 drop despite rounding.
  const jumped = biggest && biggest.drop >= minDrop - 1e-9;
  return { shark: jumped ? biggest.episode : null, biggest };
}

// =====================================================================
// Selected show
// =====================================================================

const showSection = document.getElementById("show");
const showStatus = document.getElementById("show-status");
const showContent = document.getElementById("show-content");
let currentShowId = null;   // guards against a slow download for a previously chosen show
let state = null;           // everything about the show on screen (see showSelected)

function setStatus(html, isError) {
  showStatus.innerHTML = html;
  showStatus.className = isError ? "error" : "loading";
  showStatus.hidden = !html;
}

async function showSelected(show) {
  currentShowId = show.id;
  hideCard();
  showSection.hidden = false;
  showContent.hidden = true;
  document.getElementById("show-title").textContent = show.title;
  renderShowInfo(show);
  setStatus("Loading episodes…");

  let episodes;
  try {
    episodes = await loadEpisodes(show.id);
  } catch (err) {
    if (currentShowId === show.id) {
      setStatus(`Sorry, the episodes failed to load (${escapeHtml(err.message)}). ` +
                "Try choosing the show again.", true);
    }
    return;
  }
  if (currentShowId !== show.id) return;   // the user picked a different show meanwhile

  const rated = rankEpisodes(episodes);
  state = {
    show,
    episodes,
    rated,                                          // best first
    byId: new Map(episodes.map(e => [e.id, e])),
    grid: layoutGrid(episodes),
    // rated, numbered episodes in airing order (the episode files are already sorted that way)
    sequence: episodes.filter(e => e.season != null && e.episode != null && e.rating != null),
    justChosen: true,   // the shark box opens or closes to fit the verdict on first render
  };
  renderShowInfo(show, episodes.length, rated.length);
  setStatus("");
  showContent.hidden = false;
  render();
  addTvmazeDetails(show);   // fills in air dates & summaries a moment later
}

/** Draw everything that depends on the settings. Called on load and whenever a setting changes. */
function render() {
  if (!state) return;
  hideCard();
  const settings = currentSettings();

  // Color range for "stretch colors" (needs at least a little spread to be meaningful).
  colorRange = null;
  if (stretchToggle.checked && state.rated.length) {
    const max = state.rated[0].rating, min = state.rated[state.rated.length - 1].rating;
    if (max - min >= 0.1) colorRange = { min, max };
  }

  const enough = state.sequence.length >= settings.minEpisodes;
  const result = enough ? findShark(state.sequence, settings) : { shark: null, biggest: null };
  if (!enough) for (const e of state.sequence) e.pastAvg = e.nextAvg = null;
  state.settings = settings;
  state.shark = result.shark;

  document.getElementById("legend").innerHTML = renderLegend();
  document.getElementById("show-grid").innerHTML = renderGrid(state.grid, state.rated.length, state.shark);
  renderSharkBox(result, settings, enough);
  document.getElementById("show-tops").innerHTML = enough ? renderTops(state.rated) : "";
  document.getElementById("show-other").innerHTML = renderOther(state.grid.other);
}

function renderShowInfo(show, episodeCount, ratedCount) {
  const parts = [yearRange(show)];
  if (show.mini) parts.push("Mini-series");
  if (show.rating) parts.push(`★ ${show.rating.toFixed(1)} (${show.votes.toLocaleString()} votes)`);
  if (episodeCount != null) {
    parts.push(`${episodeCount} episodes` + (ratedCount < episodeCount ? ` (${ratedCount} rated)` : ""));
  }
  document.getElementById("show-info").innerHTML =
    parts.map(escapeHtml).join(" · ") +
    ` · <a href="https://www.imdb.com/title/${imdbId(show.id)}/" target="_blank" rel="noopener">IMDb ↗</a>`;
}

function episodeCode(e) {
  return e.season != null && e.episode != null ? `S${e.season}E${e.episode}` : "Special";
}

function episodeLink(e, content, className) {
  return `<a class="${className}" href="https://www.imdb.com/title/${imdbId(e.id)}/" target="_blank" ` +
         `rel="noopener" data-episode="${e.id}">${content}</a>`;
}

function renderGrid({ seasons, seasonNumbers, first, last, packed }, ratedCount, shark) {
  if (!seasonNumbers.length) {
    return '<p class="note">IMDb has no season/episode numbers for this show, so there is no grid. ' +
           "Its episodes are listed below.</p>";
  }
  const columns = [];
  for (let n = first; n <= last; n++) columns.push(n);

  let html = packed
    ? '<p class="note">IMDb\'s episode numbers for this show have big gaps, so each season\'s ' +
      "episodes are shown in order. Hover a cell for its real episode number.</p>"
    : "";
  html += '<div class="grid-wrap"><table class="grid"><thead><tr><th class="corner"></th>';
  for (const n of columns) html += `<th scope="col">${packed ? "#" : "E"}${n}</th>`;
  html += "</tr></thead><tbody>";
  for (const s of seasonNumbers) {
    const row = seasons.get(s);
    html += `<tr><th scope="row">S${s}</th>`;
    for (const n of columns) {
      const e = row.get(n);
      if (!e) { html += '<td class="empty"></td>'; continue; }
      const classes = [];
      if (e.rating == null) classes.push("unrated");
      if (e === shark) classes.push("shark");
      const style = e.rating != null
        ? ` style="background:${ratingColor(e.rating)};color:${ratingTextColor(e.rating)}"` : "";
      let label = e.rating != null ? e.rating.toFixed(1) : "—";
      if (e === shark) label += '<span class="shark-icon" aria-label="jumped the shark">🦈</span>';
      html += `<td${classes.length ? ` class="${classes.join(" ")}"` : ""}${style}>` +
              episodeLink(e, label, "cell") + "</td>";
    }
    html += "</tr>";
  }
  html += "</tbody></table></div>";
  if (!ratedCount) html += '<p class="note">None of these episodes have IMDb ratings yet.</p>';
  return html;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "the 10 episodes before it" / "it and the 9 after it" — worded to match the settings. */
function windowWords({ past, future }) {
  const before = past === 1 ? "the episode before it" : `the ${past} episodes before it`;
  const after = future === 1 ? "the episode itself" :
                future === 2 ? "it and the episode after it" : `it and the ${future - 1} episodes after it`;
  return { before, after };
}

/**
 * The shark box: its always-visible summary line is the verdict; opening it shows the details
 * and the settings. It opens by itself when a newly chosen show jumped the shark; after that it
 * stays however the user leaves it, even while settings change.
 */
function renderSharkBox(result, settings, enough) {
  const { kind, icon, headline, detail } = sharkVerdict(result, settings, enough);
  const box = document.getElementById("shark-box");
  box.className = `shark-box ${kind}`;
  document.getElementById("shark-summary").innerHTML =
    `<span class="shark-icon-big emoji" aria-hidden="true">${icon}</span>` +
    `<span class="shark-headline">${headline}</span>` +
    `<span class="shark-more">details${config.showSharkSettingsPanel ? " &amp; settings" : ""}</span>`;
  document.getElementById("shark-detail").innerHTML = detail;
  if (state.justChosen) {
    box.open = kind === "jumped";
    state.justChosen = false;
  }
}

function sharkVerdict({ shark, biggest }, settings, enough) {
  if (!enough) {
    return {
      kind: "none", icon: "🦈",
      headline: "Too few episodes to check for a shark jump",
      detail: `Top 5 / Bottom 5 and shark detection need at least ` +
              `${plural(settings.minEpisodes, "rated episode")} with season and episode numbers; ` +
              `this show has ${state.sequence.length}.`,
    };
  }
  if (!biggest) {
    return {
      kind: "none", icon: "🦈",
      headline: "Too few episodes to check for a shark jump",
      detail: `With these settings, an episode needs ${plural(settings.past, "episode")} before it and ` +
              `${settings.future - 1} after it to be checked, and this show is too short for that.`,
    };
  }
  const w = windowWords(settings);
  if (shark) {
    const title = escapeHtml(shark.title || "Untitled");
    return {
      kind: "jumped", icon: "🦈",
      // (No link in the headline: clicking the summary line opens and closes the box.)
      headline: `<strong>Jumped the shark at ${episodeCode(shark)}: “${title}”</strong>` +
                (shark.year ? ` (${shark.year})` : ""),
      detail: `${capitalize(w.before)} averaged <b>${shark.pastAvg.toFixed(2)}</b>; ` +
              `${w.after} averaged <b>${shark.nextAvg.toFixed(2)}</b> — ` +
              `a drop of <b>${(shark.pastAvg - shark.nextAvg).toFixed(2)}</b> points. ` +
              episodeLink(shark, "See the episode on IMDb ↗", "title-link"),
    };
  }
  const b = biggest.episode;
  return {
    kind: "calm", icon: "🏄",
    headline: "<strong>No shark jumping detected</strong>",
    detail: `Never a drop of ${settings.drop.toFixed(1)} or more — consistently good ` +
            `(or consistently bad)! ` +
            (biggest.drop > 0
              ? `The biggest drop was ${biggest.drop.toFixed(2)} points, at ` +
                `${episodeLink(b, `${episodeCode(b)} “${escapeHtml(b.title || "Untitled")}”`, "title-link")}.`
              : "It never got worse."),
  };
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function renderTops(rated) {
  const top = rated.slice(0, 5);
  const bottom = [...rated]
    .sort((a, b) => a.rating - b.rating || (b.votes || 0) - (a.votes || 0))
    .slice(0, 5);
  const list = eps => eps.map(e =>
    `<li>${ratingBadge(e.rating)} <span class="code">${episodeCode(e)}</span> ` +
    `${episodeLink(e, escapeHtml(e.title || "Untitled"), "title-link")}</li>`).join("");
  return `<div class="tops">
    <section><h3><span class="emoji">⭐</span> Top 5 episodes</h3><ol>${list(top)}</ol></section>
    <section><h3><span class="emoji">👎</span> Bottom 5 episodes</h3><ol>${list(bottom)}</ol></section>
  </div>`;
}

function renderOther(other) {
  if (!other.length) return "";
  const rows = other.map(e => {
    const where = e.season != null && e.episode != null ? `S${e.season}E${e.episode}` : "—";
    return `<tr><td>${where}</td><td>${episodeLink(e, escapeHtml(e.title || "Untitled"), "title-link")}</td>` +
           `<td>${e.year ?? ""}</td><td>${ratingBadge(e.rating)}</td></tr>`;
  }).join("");
  return `<h3>Other episodes</h3>
          <p class="note">IMDb doesn't give these a unique season and episode number, so they aren't in the grid.</p>
          <table class="other"><thead><tr><th>#</th><th>Title</th><th>Year</th><th>Rating</th></tr></thead>
          <tbody>${rows}</tbody></table>`;
}

// =====================================================================
// TVmaze: full air dates and short summaries for the hover card
//
// IMDb's files only have the year an episode aired. TVmaze (free, no key) looks the show up by
// its IMDb ID and returns every episode's air date and summary, matched here by season and
// episode number. If TVmaze doesn't know the show, the card just shows the year.
// =====================================================================

const tvmazeShows = new Map();   // show id -> promise of { url, episodes: Map("S-E" -> info) } or null

function loadTvmaze(showId) {
  if (!tvmazeShows.has(showId)) {
    const promise = (async () => {
      const lookup = await fetch(`https://api.tvmaze.com/lookup/shows?imdb=${imdbId(showId)}`);
      if (lookup.status === 404) return null;               // TVmaze doesn't have this show
      if (!lookup.ok) throw new Error(`HTTP ${lookup.status}`);
      const tvShow = await lookup.json();
      const resp = await fetch(`https://api.tvmaze.com/shows/${tvShow.id}/episodes?specials=1`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const episodes = new Map();
      for (const ep of await resp.json()) {
        if (ep.season == null || ep.number == null) continue;   // unnumbered specials
        episodes.set(`${ep.season}-${ep.number}`, {
          airdate: ep.airdate || null,
          summary: htmlToText(ep.summary),
        });
      }
      return { url: tvShow.url, episodes };
    })();
    tvmazeShows.set(showId, promise);
    promise.catch(() => tvmazeShows.delete(showId));   // allow a retry after a failure
  }
  return tvmazeShows.get(showId);
}

/** TVmaze summaries are HTML ("<p>Walt <b>…</b></p>"); keep only the text. */
function htmlToText(html) {
  if (!html) return null;
  // DOMParser builds an inert document: nothing in it runs or loads.
  const text = new DOMParser().parseFromString(html, "text/html").body.textContent;
  return text.replace(/\s+/g, " ").trim() || null;
}

/** Add TVmaze air dates and summaries to the show on screen, when they arrive. */
async function addTvmazeDetails(show) {
  let tv;
  try {
    tv = await loadTvmaze(show.id);
  } catch (err) {
    console.warn("TVmaze details not loaded:", err);
    return;
  }
  if (!tv || state?.show.id !== show.id) return;
  for (const e of state.episodes) {
    const info = e.season != null && e.episode != null && tv.episodes.get(`${e.season}-${e.episode}`);
    if (info) { e.airdate = info.airdate; e.summary = info.summary; }
  }
  if (!card.hidden && cardLink?.isConnected) showCard(cardLink);   // update an open card
}

function formatDate(isoDate) {
  return new Date(isoDate + "T00:00:00Z").toLocaleDateString("en-US",
    { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** Shorten long summaries at a word boundary. */
function truncate(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.\s]+$/, "") + "…";
}

// =====================================================================
// Hover card
// =====================================================================

const card = document.createElement("div");
card.className = "hover-card";
card.setAttribute("role", "tooltip");
card.hidden = true;
document.body.appendChild(card);

function cardHtml(e) {
  const lines = [`<div class="card-code">${episodeCode(e)}</div>`,
                 `<div class="card-title">${escapeHtml(e.title || "Untitled")}</div>`];
  if (e.rating != null) {
    lines.push(`<div class="card-rating">${ratingBadge(e.rating)} ${(e.votes || 0).toLocaleString()} votes</div>`);
    lines.push(`<div>Rank: #${e.rank} of ${state.rated.length}${e.tied ? " (tied)" : ""}</div>`);
  } else {
    lines.push("<div>Not rated yet</div>");
  }
  const facts = [];
  if (e.airdate) facts.push(`Aired ${formatDate(e.airdate)}`);
  else if (e.year) facts.push(`Aired ${e.year}`);
  if (e.runtime) facts.push(`${e.runtime} min`);
  if (facts.length) lines.push(`<div>${facts.join(" · ")}</div>`);
  if (e.summary) lines.push(`<div class="card-summary">${escapeHtml(truncate(e.summary, 240))}</div>`);
  if (e === state.shark) lines.push('<div class="card-shark"><span class="emoji">🦈</span> Jumped the shark here!</div>');
  lines.push('<div class="card-hint">Click to open on IMDb</div>');
  return lines.join("");
}

let cardLink = null;   // the cell or title the card is showing details for

function showCard(link) {
  const e = state?.byId.get(Number(link.dataset.episode));
  if (!e) return;
  cardLink = link;
  card.innerHTML = cardHtml(e);
  card.hidden = false;

  // Place above the cell if there's room, otherwise below; keep it on screen sideways.
  const r = link.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  let top = r.top - c.height - 8;
  if (top < 8) top = r.bottom + 8;
  let left = r.left + r.width / 2 - c.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - c.width - 8));
  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
}

function hideCard() { card.hidden = true; }

showContent.addEventListener("mouseover", ev => {
  const link = ev.target.closest("a[data-episode]");
  if (link) showCard(link);
});
showContent.addEventListener("mouseout", ev => {
  if (ev.target.closest("a[data-episode]") && !ev.relatedTarget?.closest?.("a[data-episode]")) hideCard();
});
showContent.addEventListener("focusin", ev => {
  const link = ev.target.closest("a[data-episode]");
  if (link) showCard(link);
});
showContent.addEventListener("focusout", hideCard);
window.addEventListener("scroll", hideCard, true);

// =====================================================================
// Footer: data date and "Refresh data"
// =====================================================================

function renderFooter(meta) {
  const el = document.getElementById("data-date");
  if (!meta?.imdbDataDate) { el.textContent = "IMDb data date unknown"; return; }
  // "2026-10-10" -> "October 10, 2026" (as a calendar date, not shifted by time zone)
  const date = new Date(meta.imdbDataDate + "T00:00:00Z").toLocaleDateString("en-US",
    { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  el.textContent = `IMDb data from ${date}`;
}

// =====================================================================
// "Update in progress" popup
//
// A refresh is the "Publish site" GitHub Action, started on GitHub by the site owner (or by
// the weekly schedule). Anyone can *read* its status from GitHub's public API without signing
// in, which is what this does. That API allows 60 checks per hour per visitor, so we check on
// page load, when the tab comes back into view, and every 90 seconds only while a refresh runs.
// =====================================================================

const WORKFLOW = "publish.yml";
const RUNNING = ["queued", "in_progress", "waiting", "requested", "pending"];
const POLL_MS = 90_000;

const popup = document.getElementById("refresh-popup");
const popupIcon = document.getElementById("refresh-icon");
const popupText = document.getElementById("refresh-text");

let watchedRun = null;     // the refresh run we've seen in progress
let dismissedRun = null;   // a run whose "in progress" popup the user closed
let lastCheck = 0;
let pollTimer = null;
let tickTimer = null;
let expectRun = 0;         // after clicking "Refresh data": quick re-checks while GitHub starts it

function apiBase() {
  return `https://api.github.com/repos/${config.githubRepo}/actions`;
}

function setupRefresh() {
  const link = document.getElementById("refresh-link");
  link.href = `https://github.com/${config.githubRepo}/actions/workflows/${WORKFLOW}`;
  link.addEventListener("click", () => { expectRun = 4; });

  document.getElementById("refresh-close").addEventListener("click", () => {
    if (watchedRun && popup.dataset.kind === "running") dismissedRun = watchedRun.id;
    hidePopup();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastCheck > 15_000) checkRefresh();
  });
  checkRefresh();
}

function schedule(ms) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    if (document.visibilityState === "visible") checkRefresh();
    // (if hidden, the visibilitychange handler checks when the tab is viewed again)
  }, ms);
}

async function fetchJson(url) {
  // The unique "t" value skips GitHub's up-to-a-minute-old cached answers.
  url += (url.includes("?") ? "&" : "?") + `t=${Date.now()}`;
  const resp = await fetch(url, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function checkRefresh() {
  lastCheck = Date.now();
  let runs;
  try {
    runs = (await fetchJson(`${apiBase()}/workflows/${WORKFLOW}/runs?per_page=5`)).workflow_runs;
  } catch (err) {
    console.warn("Couldn't check refresh status:", err);   // e.g. hourly limit reached; just stop
    return;
  }

  // Only scheduled or hand-started runs download new data; code-change publishes don't.
  const active = runs.find(r => RUNNING.includes(r.status) &&
                                (r.event === "schedule" || r.event === "workflow_dispatch"));
  if (active) {
    watchedRun = active;
    expectRun = 0;
    if (dismissedRun !== active.id) showRunning(active);
    schedule(POLL_MS);
    return;
  }

  if (watchedRun) {
    // The run we were watching is no longer running: did it succeed?
    let done = runs.find(r => r.id === watchedRun.id);
    if (!done) {
      try { done = await fetchJson(`${apiBase()}/runs/${watchedRun.id}`); } catch { done = null; }
    }
    watchedRun = null;
    if (done?.status === "completed") {
      if (done.conclusion === "success") showReady();
      else showFailed(done);
    }
    return;
  }

  // Just clicked "Refresh data" but GitHub hasn't started the run yet: look again shortly.
  if (expectRun > 0) {
    expectRun--;
    schedule(20_000);
  }
}

function minutesAgo(iso) {
  const min = Math.floor((Date.now() - new Date(iso)) / 60_000);
  return min < 1 ? "just now" : min === 1 ? "1 minute ago" : `${min} minutes ago`;
}

function showPopup(kind, icon, html) {
  popup.dataset.kind = kind;
  popupIcon.textContent = icon;
  popupText.innerHTML = html;
  popup.hidden = false;
}

function hidePopup() {
  popup.hidden = true;
  clearInterval(tickTimer);
}

function showRunning(run) {
  const draw = () => showPopup("running", "⏳",
    `<strong>IMDb data update in progress</strong><br>` +
    `Started ${minutesAgo(run.run_started_at || run.created_at)}; it usually takes 2–3 minutes. ` +
    `The current data still works.`);
  draw();
  clearInterval(tickTimer);
  tickTimer = setInterval(draw, 30_000);   // keep "started N minutes ago" current
}

function showReady() {
  clearInterval(tickTimer);
  showPopup("ready", "✅",
    '<strong>New IMDb data is ready.</strong><br>' +
    '<button type="button" class="popup-action" id="refresh-reload">Reload the page</button>');
  document.getElementById("refresh-reload").addEventListener("click", () => location.reload());
}

function showFailed(run) {
  clearInterval(tickTimer);
  showPopup("failed", "⚠️",
    "<strong>The data update didn't finish.</strong><br>The current data still works. " +
    `<a href="${escapeHtml(run.html_url)}" target="_blank" rel="noopener">Details on GitHub</a>`);
}

// =====================================================================
// Start
// =====================================================================

const metaReady = loadMeta();
metaReady.then(renderFooter);
loadConfig().then(() => { setupPanel(); setupRefresh(); });

metaReady.then(loadShows)
  .then(() => {
    input.disabled = false;
    input.placeholder = "Search for a TV show…";
    input.focus();
  })
  .catch(err => {
    input.placeholder = "Couldn't load the show list";
    showMessage(`Sorry, the show list failed to load (${err.message}). Try reloading the page.`);
  });
