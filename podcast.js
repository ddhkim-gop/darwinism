import { renderNav } from "./components/nav.js";
import { PODCAST_EPISODES } from "./podcasts.js?v=202609021357";

const audio = new Audio();
let playingId = null;   // "<year>-<index>" of the row currently loaded

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
        audio.play().catch(() => { /* file missing or blocked — leave paused */ });
    }
    syncButtons();
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

    el.innerHTML = years.map(y => yearHtml(y, PODCAST_EPISODES[y] || [])).join("");

    el.addEventListener("click", e => {
        const btn = e.target.closest(".pod-play");
        if (btn && !btn.disabled) toggle(btn);
    });

    ["play", "pause", "ended"].forEach(ev => audio.addEventListener(ev, syncButtons));
    syncButtons();
}

renderNav();
render();
