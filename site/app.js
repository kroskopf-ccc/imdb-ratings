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
// Selected show (the grid comes in step 3)
// =====================================================================

function showSelected(show) {
  document.getElementById("show").hidden = false;
  document.getElementById("show-title").textContent = show.title;
  const parts = [yearRange(show)];
  if (show.mini) parts.push("Mini-series");
  if (show.rating) parts.push(`★ ${show.rating.toFixed(1)} (${show.votes.toLocaleString()} votes)`);
  parts.push(`${show.episodes} episodes`);
  document.getElementById("show-info").innerHTML =
    parts.map(escapeHtml).join(" · ") +
    ` · <a href="https://www.imdb.com/title/${imdbId(show.id)}/" target="_blank" rel="noopener">IMDb ↗</a>`;
  document.getElementById("show-body").textContent = "Episode grid coming in step 3.";
}

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
