/* GoatCounter analytics — cookieless, no consent banner.
 *
 * Set SITE_CODE to "" to disable: with it empty no script loads and
 * no request leaves the visitor's browser.
 *
 * Dashboard: https://ddhk.goatcounter.com  (set at https://www.goatcounter.com)
 * SITE_CODE is the subdomain of that dashboard URL.
 */
const SITE_CODE = "ddhk";

const endpoint = () => `https://${SITE_CODE}.goatcounter.com/count`;

export function initAnalytics() {
    if (!SITE_CODE) return;
    if (document.querySelector("script[data-goatcounter]")) return;
    const s = document.createElement("script");
    s.async = true;
    s.src = "//gc.zgo.at/count.js";
    s.setAttribute("data-goatcounter", endpoint());
    document.head.appendChild(s);
}

/* Record a custom event. `path` is the event name shown in the dashboard;
 * `title` carries the episode so events stay readable when there are many.
 * Silently does nothing while analytics is disabled or the script hasn't loaded. */
export function trackEvent(path, title) {
    if (!SITE_CODE) return;
    const gc = window.goatcounter;
    if (!gc || typeof gc.count !== "function") return;
    gc.count({ path, title: title || path, event: true });
}

/* Read a public play/pageview count back out of GoatCounter.
 *
 * Requires "Allow adding visitor counts to your own website" to be enabled in
 * the GoatCounter site settings; without it the endpoint answers 403 and this
 * resolves null, so callers render no badge rather than a misleading zero.
 * Returns { count, countUnique } or null. */
export async function fetchCount(path) {
    if (!SITE_CODE) return null;
    try {
        const url = `https://${SITE_CODE}.goatcounter.com/counter/${encodeURIComponent(path)}.json`;
        const r = await fetch(url, { mode: "cors" });
        if (!r.ok) return null;
        const j = await r.json();
        const n = parseInt(String(j.count).replace(/[^0-9]/g, ""), 10);
        const u = parseInt(String(j.count_unique).replace(/[^0-9]/g, ""), 10);
        return { count: isNaN(n) ? 0 : n, countUnique: isNaN(u) ? 0 : u };
    } catch {
        return null;                       // offline, blocked, or counts disabled
    }
}
