"""Turn IMDb's public data files into the small JSON files the website reads.

Usage:
    python build/build_data.py            # download IMDb files if missing, then build
    python build/build_data.py --fresh    # always re-download the latest IMDb files

Output (in site/data/):
    shows.json          every searchable TV show (one compact row per show)
    episodes/NNN.json   episodes, split into 1,000 files by the last 3 digits of the show's ID
    meta.json           IMDb data date and build time

IMDb data: https://datasets.imdbws.com/ (personal, non-commercial use)
"""

import argparse
import email.utils
import gzip
import json
import shutil
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOWNLOADS = ROOT / "build" / "downloads"
OUTPUT = ROOT / "site" / "data"
BASE_URL = "https://datasets.imdbws.com/"
FILES = ["title.basics.tsv.gz", "title.episode.tsv.gz", "title.ratings.tsv.gz"]
SHARDS = 1000

# Title types we keep from title.basics
SERIES, MINISERIES, EPISODE = 1, 2, 3
TYPES = {"tvSeries": SERIES, "tvMiniSeries": MINISERIES, "tvEpisode": EPISODE}


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- download

def download(name, fresh):
    """Download one IMDb file (unless already present). Returns its Last-Modified date."""
    path = DOWNLOADS / name
    stamp = DOWNLOADS / (name + ".lastmod")
    if path.exists() and stamp.exists() and not fresh:
        log(f"Using existing {name}")
        return stamp.read_text().strip()

    log(f"Downloading {name} ...")
    tmp = path.with_suffix(".part")
    with urllib.request.urlopen(BASE_URL + name) as resp, open(tmp, "wb") as out:
        total = int(resp.headers.get("Content-Length") or 0)
        last_modified = resp.headers.get("Last-Modified", "")
        done, next_report = 0, 0
        while chunk := resp.read(1 << 20):
            out.write(chunk)
            done += len(chunk)
            if total and done >= next_report:
                print(f"    {done / 1e6:6.0f} / {total / 1e6:.0f} MB", flush=True)
                next_report += total // 5
    tmp.replace(path)
    stamp.write_text(last_modified)
    return last_modified


def read_tsv(name):
    """Yield the rows of a gzipped IMDb TSV file as lists of strings (header skipped)."""
    with gzip.open(DOWNLOADS / name, "rt", encoding="utf-8") as f:
        next(f)
        for line in f:
            yield line.rstrip("\n").split("\t")


def num(value, kind=int):
    """IMDb uses \\N for missing values."""
    return None if value == "\\N" else kind(value)


def tid(tconst):
    """'tt0903747' -> 903747 (IDs are stored as numbers to keep the files small)."""
    return int(tconst[2:])


# ---------------------------------------------------------------- load into SQLite

def load(db):
    db.executescript("""
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = FILE;
        CREATE TABLE basics  (id INTEGER PRIMARY KEY, type INTEGER, title TEXT,
                              start INTEGER, end INTEGER, runtime INTEGER);
        CREATE TABLE episode (id INTEGER PRIMARY KEY, parent INTEGER, season INTEGER, ep INTEGER);
        CREATE TABLE ratings (id INTEGER PRIMARY KEY, rating REAL, votes INTEGER);
    """)

    def insert(sql, rows, label):
        batch, count = [], 0
        for row in rows:
            batch.append(row)
            if len(batch) == 100_000:
                db.executemany(sql, batch)
                count += len(batch)
                batch.clear()
        db.executemany(sql, batch)
        count += len(batch)
        log(f"  {label}: {count:,} rows")

    log("Loading title.basics (TV series, mini-series, and episodes only) ...")
    insert("INSERT INTO basics VALUES (?,?,?,?,?,?)",
           ((tid(r[0]), TYPES[r[1]], r[2], num(r[5]), num(r[6]), num(r[7]))
            for r in read_tsv("title.basics.tsv.gz") if r[1] in TYPES),
           "titles")

    log("Loading title.episode ...")
    insert("INSERT INTO episode VALUES (?,?,?,?)",
           ((tid(r[0]), tid(r[1]), num(r[2]), num(r[3]))
            for r in read_tsv("title.episode.tsv.gz")),
           "episodes")

    log("Loading title.ratings ...")
    insert("INSERT INTO ratings VALUES (?,?,?)",
           ((tid(r[0]), float(r[1]), int(r[2])) for r in read_tsv("title.ratings.tsv.gz")),
           "ratings")

    log("Indexing ...")
    db.execute("CREATE INDEX episode_parent ON episode(parent)")
    db.commit()


# ---------------------------------------------------------------- write JSON

def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def build(db, out):
    # A show is searchable if it is a TV series/mini-series with at least one rated episode
    # (otherwise its grid would be entirely gray).
    log("Selecting shows ...")
    db.executescript("""
        CREATE TEMP TABLE shows AS
        SELECT b.id, b.title, b.start, b.end, b.type,
               r.rating, r.votes,
               COUNT(*) AS episodes,
               COUNT(er.id) AS rated
        FROM basics b
        JOIN episode e        ON e.parent = b.id
        LEFT JOIN ratings r   ON r.id = b.id
        LEFT JOIN ratings er  ON er.id = e.id
        WHERE b.type IN (1, 2)
        GROUP BY b.id
        HAVING rated > 0;
    """)

    # shows.json: [id, title, startYear, endYear, votes, rating, isMiniSeries, episodeCount]
    # (episodeCount is IMDb's total, including unrated episodes not written to the episode files)
    # sorted by votes (most popular first) so the browser's ranking ties are already in order.
    shows = [
        [id_, title, start, end, votes or 0, rating, 1 if type_ == MINISERIES else 0, episodes]
        for id_, title, start, end, type_, rating, votes, episodes in db.execute(
            "SELECT id, title, start, end, type, rating, votes, episodes FROM shows "
            "ORDER BY votes DESC NULLS LAST, title")
    ]
    write_json(out / "shows.json", shows)
    log(f"  shows.json: {len(shows):,} shows")

    # episodes/NNN.json: { "<showId>": [[season, episode, id, title, year, runtime, rating, votes], ...] }
    # Episodes are listed in airing order; ones missing a season/episode number come last.
    # Unrated episodes are kept only in seasons that have at least one rated episode. This drops
    # the thousands of never-rated episodes of daily soaps and news shows (most of the raw data)
    # while keeping gray "unrated" cells in normal shows.
    log("Writing episode files ...")
    (out / "episodes").mkdir()
    db.executescript("""
        CREATE TEMP TABLE rated_seasons AS
        SELECT DISTINCT e.parent, e.season
        FROM episode e
        JOIN shows s   ON s.id = e.parent
        JOIN ratings r ON r.id = e.id
        WHERE e.season IS NOT NULL;
        CREATE INDEX temp.rated_seasons_key ON rated_seasons(parent, season);
    """)
    rows = db.execute("""
        SELECT e.parent % 1000 AS shard, e.parent, e.season, e.ep, e.id,
               eb.title, eb.start, eb.runtime, er.rating, er.votes
        FROM episode e
        JOIN shows s         ON s.id = e.parent
        LEFT JOIN basics eb  ON eb.id = e.id
        LEFT JOIN ratings er ON er.id = e.id
        WHERE er.id IS NOT NULL
           OR EXISTS (SELECT 1 FROM rated_seasons rs
                      WHERE rs.parent = e.parent AND rs.season = e.season)
        ORDER BY shard, e.parent,
                 e.season IS NULL, e.season, e.ep IS NULL, e.ep, eb.start, e.id
    """)
    current, data, total = None, {}, 0
    for shard, parent, season, ep, id_, title, year, runtime, rating, votes in rows:
        if shard != current:
            if current is not None:
                write_json(out / "episodes" / f"{current:03d}.json", data)
            current, data = shard, {}
        data.setdefault(str(parent), []).append(
            [season, ep, id_, title, year, runtime, rating, votes])
        total += 1
    if current is not None:
        write_json(out / "episodes" / f"{current:03d}.json", data)
    log(f"  {total:,} episodes")


# ---------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--fresh", action="store_true", help="re-download the IMDb files")
    args = parser.parse_args()

    started = time.time()
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    dates = [download(name, args.fresh) for name in FILES]

    # The data date is the oldest Last-Modified among the three files.
    parsed = [email.utils.parsedate_to_datetime(d) for d in dates if d]
    data_date = min(parsed).date().isoformat() if parsed else None

    work_db = DOWNLOADS / "work.sqlite"
    work_db.unlink(missing_ok=True)
    db = sqlite3.connect(work_db)
    try:
        load(db)
        # Build into a temporary folder, then swap it in, so a failed build never
        # leaves the site with half-written data.
        tmp_out = OUTPUT.with_name("data.tmp")
        shutil.rmtree(tmp_out, ignore_errors=True)
        tmp_out.mkdir(parents=True)
        build(db, tmp_out)
        write_json(tmp_out / "meta.json", {
            "imdbDataDate": data_date,
            "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        })
    finally:
        db.close()
        work_db.unlink(missing_ok=True)

    shutil.rmtree(OUTPUT, ignore_errors=True)
    tmp_out.replace(OUTPUT)

    size = sum(p.stat().st_size for p in OUTPUT.rglob("*") if p.is_file())
    log(f"Done in {(time.time() - started) / 60:.1f} min. IMDb data date: {data_date}. "
        f"Output: {size / 1e6:.1f} MB in {OUTPUT}")


if __name__ == "__main__":
    sys.exit(main())
