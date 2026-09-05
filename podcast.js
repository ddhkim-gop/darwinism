import { renderNav } from "./components/nav.js";
import { trackEvent, fetchCount } from "./components/analytics.js";
import { PODCAST_EPISODES } from "./podcasts.js?v=202609050124";

const audio = new Audio();
let playingId = null;   // "<year>-<index>" of the row currently loaded
const titles = {};      // row id -> episode title, for analytics
const slugs  = {};      // row id -> stable episode slug, for event paths
const fired = {};       // "<id>:<milestone>" -> true, so each fires once per page load

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => (
        { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
}

function metaLine(ep) {
    const bits = [];
    if (ep.date) {
        const d = new Date(ep.date + "T00:00:00");
        if (!isNaN(d)) bits.push(d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));
    }
    if (ep.duration) bits.push(ep.duration);
    return bits.join(" · ");
}

/* Analytics paths must stay stable across edits, so prefer an explicit slug and
 * fall back to the audio filename rather than the row index — reordering the
 * manifest would otherwise silently reassign every episode's counts. */
function episodeSlug(ep, id) {
    if (ep.slug) return ep.slug;
    const file = (ep.audio || "").split("/").pop() || "";
    return file.replace(/\.[^.]+$/, "") || id;
}

function rowHtml(ep, id) {
    const playable = Boolean(ep.audio);
    const meta = metaLine(ep);
    return `
        <tr data-id="${id}">
            <td class="pod-play-cell">
                <button class="pod-play" data-id="${id}" data-src="${esc(ep.audio || "")}"
                        ${playable ? "" : "disabled"}
                        aria-label="${playable ? "Play" : "Audio not available"}: ${esc(ep.title)}">
                    <span class="pod-icon" aria-hidden="true"></span>
                </button>
            </td>
            <td class="pod-title-cell">
                <div class="pod-title">${esc(ep.title)}</div>
                ${meta ? `<div class="pod-meta">${esc(meta)}</div>` : ""}
                <div class="pod-plays" data-plays="${id}" hidden></div>
            </td>
            <td class="pod-desc">${esc(ep.description || "")}</td>
        </tr>`;
}

function yearHtml(year, episodes) {
    if (!episodes.length) {
        return `
            <section class="card pod-year">
                <h2 class="pod-year-head">${esc(year)}</h2>
                <p class="text-muted text-small pod-empty">No episodes published yet for ${esc(year)}.</p>
            </section>`;
    }
    return `
        <section class="card pod-year">
            <h2 class="pod-year-head">${esc(year)} <span class="pod-count">${episodes.length} episode${episodes.length === 1 ? "" : "s"}</span></h2>
            <div class="s-table-wrap">
                <table class="s-table pod-table">
                    <thead>
                        <tr>
                            <th class="pod-play-cell"><span class="sr-only">Play</span></th>
                            <th>Episode</th>
                            <th>Description</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${episodes.map((ep, i) => rowHtml(ep, `${year}-${i}`)).join("")}
                    </tbody>
                </table>
            </div>
        </section>`;
}

function syncButtons() {
    document.querySelectorAll(".pod-play").forEach(btn => {
        const isCurrent = btn.dataset.id === playingId;
        const isPlaying = isCurrent && !audio.paused;
        btn.classList.toggle("playing", isPlaying);
        btn.closest("tr")?.classList.toggle("pod-active", isCurrent);
        if (!btn.disabled) {
            const title = btn.getAttribute("aria-label").replace(/^(Play|Pause):\s*/, "");
            btn.setAttribute("aria-label", `${isPlaying ? "Pause" : "Play"}: ${title}`);
        }
    });
}

function toggle(btn) {
    const id = btn.dataset.id;
    const src = btn.dataset.src;
    if (!src) return;

    if (playingId === id) {
        audio.paused ? audio.play() : audio.pause();
    } else {
        playingId = id;
        audio.src = src;
        audio.play().then(() => once(id, "play")).catch(() => { /* file missing or blocked — leave paused */ });
    }
    syncButtons();
}

/* Fire an event at most once per episode per page load. Without this, scrubbing
 * back over a milestone or pausing and resuming would inflate the counts. */
function once(id, milestone) {
    const key = `${id}:${milestone}`;
    if (fired[key]) return;
    fired[key] = true;
    trackEvent(`podcast/${milestone}/${slugs[id] || id}`, titles[id] || id);
}

/* Progress milestones say whether a 14-minute episode actually gets finished. */
function onProgress() {
    if (!playingId || !audio.duration || !isFinite(audio.duration)) return;
    const pct = audio.currentTime / audio.duration;
    if (pct >= 0.25) once(playingId, "25pct");
    if (pct >= 0.50) once(playingId, "50pct");
    if (pct >= 0.90) once(playingId, "complete");
}

/* Fill in the play-count badges. Counts are public and cached by GoatCounter,
 * so a badge can lag a play by a minute; a null result (counts disabled, or the
 * request blocked) leaves the badge hidden rather than showing a false zero. */
async function loadPlayCounts() {
    const els = [...document.querySelectorAll("[data-plays]")];
    await Promise.all(els.map(async el => {
        const id = el.dataset.plays;
        const res = await fetchCount(`podcast/play/${slugs[id] || id}`);
        if (!res || !res.count) return;
        const n = res.count;
        el.textContent = `${n.toLocaleString()} play${n === 1 ? "" : "s"}`;
        el.hidden = false;
    }));
}

function render() {
    const el = document.getElementById("podcast-container");
    const years = Object.keys(PODCAST_EPISODES)
        .map(Number)
        .filter(y => !isNaN(y))
        .sort((a, b) => b - a);

    if (!years.length) {
        el.innerHTML = `<div class="card"><p class="text-muted">No episodes yet.</p></div>`;
        return;
    }

    years.forEach(y => (PODCAST_EPISODES[y] || []).forEach((ep, i) => {
        const id = `${y}-${i}`;
        titles[id] = ep.title;
        slugs[id]  = episodeSlug(ep, id);
    }));

    el.innerHTML = years.map(y => yearHtml(y, PODCAST_EPISODES[y] || [])).join("");

    el.addEventListener("click", e => {
        const btn = e.target.closest(".pod-play");
        if (btn && !btn.disabled) toggle(btn);
    });

    loadPlayCounts();

    ["play", "pause", "ended"].forEach(ev => audio.addEventListener(ev, syncButtons));
    audio.addEventListener("timeupdate", onProgress);
    audio.addEventListener("ended", () => playingId && once(playingId, "complete"));
    syncButtons();
}

renderNav();
render();
