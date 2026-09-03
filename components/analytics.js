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
