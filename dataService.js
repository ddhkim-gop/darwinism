const D = window.__STATIC_DATA__;
const CURRENT_YEAR = "2026";   // live roster lives in data.js (refresh-updated); past years use snapshots
const _cache = {};
async function fetchJSON(url) {
    if (_cache[url]) return _cache[url];
    const r = await fetch(url);
    const j = await r.json();
    _cache[url] = j;
    return j;
}
export const api = {
    async getDraft(year)       { return D.draft[year] || []; },
    // Historical years read their end-of-season roster snapshot (data/{year}/rosters.json);
    // the current year uses the live roster from data.js so the 30-min refresh stays fresh.
    async getRosters(year)     {
        if (year && String(year) !== CURRENT_YEAR) {
            try { return await fetchJSON(`data/${year}/rosters.json`); } catch (e) {}
        }
        return D.rosters || [];
    },
    async getUsers(year)       { return D.users || []; },
    async getLeagueUsers()     { return D.league_users || []; },
    async getTransactions()    { return D.transactions || []; },
    async getStandings()       { return D.standings || []; },
    async getHeadToHead()      { return D.head_to_head || []; },
    async getPlayerStats(year) { return fetchJSON(`data/${year}/player_season_stats.json`); },
    async getMatchups(year)    { return fetchJSON(`data/${year}/matchups.json`); },
    async getSeasonHistory()   { return D.season_history || {}; },
    async getTradedPicks()     { return D.traded_picks || []; },
    async getDivisions()       { return D.divisions || {}; },
    async getPlayerNameMap()   { return D.player_name_map || {}; },
    async getPlayerValues()    { return D.player_values || {}; },
};
