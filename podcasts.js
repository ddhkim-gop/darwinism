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
 */
export const PODCAST_EPISODES = {
    2026: [
        // {
        //     title: "Episode 1 — Draft Recap",
        //     date: "2026-09-05",
        //     duration: "48:22",
        //     audio: "assets/podcasts/2026-01-draft-recap.mp3",
        //     description: "Every pick of the 2026 draft, round by round, plus the three reaches nobody is talking about.",
        // },
    ],
};
