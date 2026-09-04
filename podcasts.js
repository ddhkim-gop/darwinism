/* Podcast episode manifest.
 *
 * One entry per episode, grouped by season year. Newest year renders first,
 * and within a year episodes render in the order listed here.
 *
 * Fields:
 *   title       required — episode name shown in the table
 *   description required — one or two sentences; kept short for the table cell
 *   audio       path to the audio file (put files in assets/podcasts/).
 *               Omit it and the row renders with the play button disabled.
 *   date        optional ISO date (YYYY-MM-DD) shown under the title
 *   duration    optional human string, e.g. "42:10"
 *   slug        stable id used for analytics event paths and the play-count
 *               badge. Derived from the audio filename when omitted — but set
 *               it explicitly if you ever rename an audio file, or the episode
 *               starts a new count from zero.
 */
export const PODCAST_EPISODES = {
    2026: [
        {
            title: "Episode 1 — The Grades Are In",
            date: "2026-09-03",
            duration: "14:12",
            slug: "2026-01-the-grades-are-in",
            audio: "assets/podcasts/2026-01-the-grades-are-in.mp3",
            description: "Draft recap and season predictions, graded off the site's own draft panel: three tiers, twelve teams, predicted standings and awards.",
        },
    ],
};
