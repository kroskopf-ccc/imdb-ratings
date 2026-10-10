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

async function loadShows() {
  const resp = await fetch("data/shows.json");
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
  closeList();
  showMessage("");
  showSelected(show);
}

input.addEventListener("input", () => {
  selected = null;          // any edit means the box no longer holds a chosen show
  showMessage("");
  suggestions = search(input.value);
  active = -1;
  renderSuggestions();
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
    closeList();
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
    const promise = fetch(`data/episodes/${shard}.json`).then(resp => {
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
// Colors
// =====================================================================

/** Red (0.0) -> yellow (5.0) -> green (10.0): hue goes 0° -> 60° -> 120°. */
function ratingColor(rating) {
  const hue = Math.max(0, Math.min(10, rating)) * 12;
  return `hsl(${hue} 72% 52%)`;
}

/** Dark or white text, whichever is easier to read on the given rating's color. */
function ratingTextColor(rating) {
  const [r, g, b] = hslToRgb(Math.max(0, Math.min(10, rating)) * 12, 0.72, 0.52);
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

// =====================================================================
// Selected show: header, grid, other episodes
// =====================================================================

const showSection = document.getElementById("show");
const showBody = document.getElementById("show-body");
let currentShowId = null;      // guards against a slow download for a previously chosen show
let episodesById = new Map();  // episode id -> episode, for the hover card

async function showSelected(show) {
  currentShowId = show.id;
  hideCard();
  showSection.hidden = false;
  document.getElementById("show-title").textContent = show.title;
  renderShowInfo(show);
  showBody.innerHTML = '<p class="loading">Loading episodes…</p>';

  let episodes;
  try {
    episodes = await loadEpisodes(show.id);
  } catch (err) {
    if (currentShowId === show.id) {
      showBody.innerHTML = `<p class="error">Sorry, the episodes failed to load (${escapeHtml(err.message)}). ` +
                           "Try choosing the show again.</p>";
    }
    return;
  }
  if (currentShowId !== show.id) return;   // the user picked a different show meanwhile

  const rated = rankEpisodes(episodes);
  episodesById = new Map(episodes.map(e => [e.id, e]));
  renderShowInfo(show, episodes.length, rated.length);

  const grid = layoutGrid(episodes);
  showBody.innerHTML = renderLegend() + renderGrid(grid, rated.length) + renderOther(grid.other);
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

function renderLegend() {
  const stops = [0, 2.5, 5, 7.5, 10].map(r => `${ratingColor(r)} ${r * 10}%`).join(", ");
  return `<div class="legend" aria-hidden="true">
            <span>0.0</span><span class="legend-bar" style="background:linear-gradient(to right, ${stops})"></span><span>10.0</span>
            <span class="legend-unrated">${ratingBadge(null)} not rated</span>
          </div>`;
}

function episodeLink(e, content, className) {
  return `<a class="${className}" href="https://www.imdb.com/title/${imdbId(e.id)}/" target="_blank" ` +
         `rel="noopener" data-episode="${e.id}">${content}</a>`;
}

function renderGrid({ seasons, seasonNumbers, first, last, packed }, ratedCount) {
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
      const style = e.rating != null
        ? ` style="background:${ratingColor(e.rating)};color:${ratingTextColor(e.rating)}"` : "";
      const label = e.rating != null ? e.rating.toFixed(1) : "—";
      html += `<td${e.rating == null ? ' class="unrated"' : ""}${style}>` +
              episodeLink(e, label, "cell") + "</td>";
    }
    html += "</tr>";
  }
  html += "</tbody></table></div>";
  if (!ratedCount) html += '<p class="note">None of these episodes have IMDb ratings yet.</p>';
  return html;
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
// Hover card
// =====================================================================

const card = document.createElement("div");
card.className = "hover-card";
card.setAttribute("role", "tooltip");
card.hidden = true;
document.body.appendChild(card);

function cardHtml(e, ratedCount) {
  const code = e.season != null && e.episode != null ? `S${e.season}E${e.episode}` : "Episode";
  const lines = [`<div class="card-code">${code}</div>`,
                 `<div class="card-title">${escapeHtml(e.title || "Untitled")}</div>`];
  if (e.rating != null) {
    lines.push(`<div class="card-rating">${ratingBadge(e.rating)} ${(e.votes || 0).toLocaleString()} votes</div>`);
    lines.push(`<div>Rank: #${e.rank} of ${ratedCount}${e.tied ? " (tied)" : ""}</div>`);
  } else {
    lines.push("<div>Not rated yet</div>");
  }
  const facts = [];
  if (e.year) facts.push(`Aired ${e.year}`);
  if (e.runtime) facts.push(`${e.runtime} min`);
  if (facts.length) lines.push(`<div>${facts.join(" · ")}</div>`);
  lines.push('<div class="card-hint">Click to open on IMDb</div>');
  return lines.join("");
}

function showCard(link) {
  const e = episodesById.get(Number(link.dataset.episode));
  if (!e) return;
  const ratedCount = [...episodesById.values()].filter(x => x.rating != null).length;
  card.innerHTML = cardHtml(e, ratedCount);
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

showBody.addEventListener("mouseover", ev => {
  const link = ev.target.closest("a[data-episode]");
  if (link) showCard(link);
});
showBody.addEventListener("mouseout", ev => {
  if (ev.target.closest("a[data-episode]") && !ev.relatedTarget?.closest?.("a[data-episode]")) hideCard();
});
showBody.addEventListener("focusin", ev => {
  const link = ev.target.closest("a[data-episode]");
  if (link) showCard(link);
});
showBody.addEventListener("focusout", hideCard);
window.addEventListener("scroll", hideCard, true);

// =====================================================================
// Start
// =====================================================================

loadShows()
  .then(() => {
    input.disabled = false;
    input.placeholder = "Search for a TV show…";
    input.focus();
  })
  .catch(err => {
    input.placeholder = "Couldn't load the show list";
    showMessage(`Sorry, the show list failed to load (${err.message}). Try reloading the page.`);
  });
