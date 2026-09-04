import { api } from "./dataService.js?v=202609032137";
import { renderNav } from "./components/nav.js";

renderNav();

let allData = {};
let allSeasons = [];
let allMatchups = {};    // year → matchup data
let allTransactions = []; // flat list

function ordinal(n) {
    const s = ["th","st","nd","rd"];
    const v = n % 100;
    return n + (s[(v-20)%10] || s[v] || s[0]);
}

const CARD_W = 200;
const CARD_H = 64;
const ROW_H = 100;
const ROUND_W = 260;
const PAD_TOP = 54;
const PAD_LEFT = 20;
const FONT = "font-size:12px;font-family:-apple-system,sans-serif;";

function buildBracketSVG(matches, playoffWeek1 = 15) {
    if (!matches || !matches.length) return "";

    const byRound = {};
    matches.forEach(m => {
        if (!byRound[m.round]) byRound[m.round] = [];
        byRound[m.round].push(m);
    });

    const rounds = Object.keys(byRound).sort((a,b) => Number(a)-Number(b)).map(Number);
    const maxMatchesR1 = byRound[rounds[0]].length;

    const totalH = PAD_TOP + maxMatchesR1 * ROW_H + 20;
    const totalW = PAD_LEFT + rounds.length * ROUND_W + 20;

    const SVG_CARD    = "#252830";
    const SVG_STROKE  = "#3d4350";
    const SVG_CHAMP   = "#2c2102";
    const SVG_CGOLD   = "#b45309";
    const SVG_TEXT1   = "#f0f1f3";
    const SVG_TEXT2   = "#9aa3b0";
    const SVG_LINE    = "#3d4350";
    const SVG_DIVIDER = "#2d3139";

    let svg = `<svg width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" style="overflow:visible;max-width:100%;background:transparent;">`;

    const cardPositions = {};

    rounds.forEach((round, ri) => {
        const ms = byRound[round];
        const x = PAD_LEFT + ri * ROUND_W;
        const slotsPerCard = maxMatchesR1 / ms.length;
        const weekNum = playoffWeek1 + round - 1;
        const isLast = ri === rounds.length - 1;
        const roundLabel = isLast ? "Finals" : `Round ${ri + 1}`;

        svg += `<text x="${x + CARD_W/2}" y="18" text-anchor="middle"
            style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;fill:${SVG_TEXT2};font-family:-apple-system,sans-serif;">
            ${roundLabel}
        </text>`;
        svg += `<text x="${x + CARD_W/2}" y="34" text-anchor="middle"
            style="font-size:10px;fill:${SVG_TEXT2};opacity:0.65;font-family:-apple-system,sans-serif;">
            (Week ${weekNum})
        </text>`;

        ms.forEach((m, mi) => {
            const slotTop = PAD_TOP + mi * slotsPerCard * ROW_H;
            const slotBot = slotTop + slotsPerCard * ROW_H;
            const cy = (slotTop + slotBot) / 2;
            const cardY = cy - CARD_H / 2;

            if (!cardPositions[round]) cardPositions[round] = {};
            cardPositions[round][mi] = { x, y: cardY, cy };

            const t1won = m.winner === m.team1;
            const t2won = m.winner === m.team2;
            const isChamp = m.place === 1;

            svg += `<rect x="${x}" y="${cardY}" width="${CARD_W}" height="${CARD_H}"
                rx="8" fill="${isChamp ? SVG_CHAMP : SVG_CARD}"
                stroke="${isChamp ? SVG_CGOLD : SVG_STROKE}" stroke-width="${isChamp ? 1.5 : 0.8}"/>`;

            svg += `<line x1="${x+1}" y1="${cardY+CARD_H/2}" x2="${x+CARD_W-1}" y2="${cardY+CARD_H/2}"
                stroke="${SVG_DIVIDER}" stroke-width="0.5"/>`;

            const t1c = t1won ? SVG_TEXT1 : SVG_TEXT2;
            const t1w = t1won ? '700' : '400';
            const t1s = !t1won && m.winner ? 'text-decoration:line-through;' : '';
            svg += `<text x="${x+10}" y="${cardY+17}" dominant-baseline="central"
                style="${FONT}font-weight:${t1w};fill:${t1c};${t1s}">${m.team1 || ''}</text>`;
            if (m.team1_pts != null) {
                svg += `<text x="${x+CARD_W-8}" y="${cardY+17}" text-anchor="end" dominant-baseline="central"
                    style="${FONT}font-weight:${t1w};fill:${t1c};">${m.team1_pts.toFixed(1)}</text>`;
            }

            const t2c = t2won ? SVG_TEXT1 : SVG_TEXT2;
            const t2w = t2won ? '700' : '400';
            const t2s = !t2won && m.winner ? 'text-decoration:line-through;' : '';
            svg += `<text x="${x+10}" y="${cardY+CARD_H-13}" dominant-baseline="central"
                style="${FONT}font-weight:${t2w};fill:${t2c};${t2s}">${m.team2 || ''}</text>`;
            if (m.team2_pts != null) {
                svg += `<text x="${x+CARD_W-8}" y="${cardY+CARD_H-13}" text-anchor="end" dominant-baseline="central"
                    style="${FONT}font-weight:${t2w};fill:${t2c};">${m.team2_pts.toFixed(1)}</text>`;
            }

            if (m.place) {
                // Winner badge
                const bc = m.place === 1 ? '#f59e0b' : m.place === 3 ? '#cd7f32' : '#3d4350';
                svg += `<rect x="${x+CARD_W-34}" y="${cardY-9}" width="32" height="16" rx="8" fill="${bc}"/>`;
                svg += `<text x="${x+CARD_W-18}" y="${cardY-1}" text-anchor="middle" dominant-baseline="central"
                    style="font-size:10px;font-weight:700;fill:#fff;font-family:-apple-system,sans-serif;">${ordinal(m.place)}</text>`;
                // Championship loser gets silver (2nd place)
                if (m.place === 1 && m.loser) {
                    const loserY = m.winner === m.team1 ? cardY + CARD_H - 7 : cardY - 9;
                    svg += `<rect x="${x+CARD_W-34}" y="${loserY}" width="32" height="16" rx="8" fill="#94a3b8"/>`;
                    svg += `<text x="${x+CARD_W-18}" y="${loserY+8}" text-anchor="middle" dominant-baseline="central"
                        style="font-size:10px;font-weight:700;fill:#fff;font-family:-apple-system,sans-serif;">2nd</text>`;
                }
            }
        });
    });

    // Straight connector lines: horizontal from card right edge, vertical to align, horizontal to next card
    rounds.forEach((round, ri) => {
        if (ri === 0) return;
        const prevRound = rounds[ri - 1];
        const curMatches = byRound[round];

        curMatches.forEach((cm, cmi) => {
            const cur = cardPositions[round]?.[cmi];
            if (!cur) return;

            const prev1 = cardPositions[prevRound]?.[cmi * 2];
            const prev2 = cardPositions[prevRound]?.[cmi * 2 + 1];

            const midX = cur.x - (ROUND_W - CARD_W) / 2;

            if (prev1) {
                // Horizontal from prev card to midX
                svg += `<line x1="${prev1.x + CARD_W}" y1="${prev1.cy}" x2="${midX}" y2="${prev1.cy}"
                    stroke="${SVG_LINE}" stroke-width="1"/>`;
            }
            if (prev2) {
                svg += `<line x1="${prev2.x + CARD_W}" y1="${prev2.cy}" x2="${midX}" y2="${prev2.cy}"
                    stroke="${SVG_LINE}" stroke-width="1"/>`;
            }
            if (prev1 && prev2) {
                // Vertical connecting the two horizontal lines
                svg += `<line x1="${midX}" y1="${prev1.cy}" x2="${midX}" y2="${prev2.cy}"
                    stroke="${SVG_LINE}" stroke-width="1"/>`;
                // Horizontal from midpoint to next card
                const midY = (prev1.cy + prev2.cy) / 2;
                svg += `<line x1="${midX}" y1="${midY}" x2="${cur.x}" y2="${midY}"
                    stroke="${SVG_LINE}" stroke-width="1"/>`;
            } else if (prev1) {
                svg += `<line x1="${midX}" y1="${prev1.cy}" x2="${cur.x}" y2="${cur.cy}"
                    stroke="${SVG_LINE}" stroke-width="1"/>`;
            }
        });
    });

    svg += `</svg>`;
    return svg;
}

function buildChampPath(winners) {
    const champMatch = winners.find(m => m.place === 1);
    if (!champMatch) return winners.filter(m => !m.place || m.place === 1);

    const champRound = champMatch.round;
    const r3Teams = new Set([champMatch.team1, champMatch.team2]);

    const r2Matches = winners.filter(m =>
        m.round === champRound - 1 && r3Teams.has(m.winner)
    );
    const r2Teams = new Set(r2Matches.flatMap(m => [m.team1, m.team2]));

    const r1Matches = winners.filter(m =>
        m.round === champRound - 2 && r2Teams.has(m.winner)
    );

    // If 2-round bracket (no R1), just return R2 + champ
    return [...(r1Matches.length ? r1Matches : r2Matches), ...(r1Matches.length ? r2Matches : []), champMatch];
}

function renderPlacementCard(m) {
    const placeLabel = m.place ? `${ordinal(m.place)} Place` : "Consolation";
    const t1w = m.winner === m.team1;
    const t2w = m.winner === m.team2;
    const t1style = t1w ? "color:#f0f1f3;font-weight:700;" : (m.winner ? "color:#5a6070;text-decoration:line-through;" : "color:#c9cdd4;");
    const t2style = t2w ? "color:#f0f1f3;font-weight:700;" : (m.winner ? "color:#5a6070;text-decoration:line-through;" : "color:#c9cdd4;");
    return `
        <div style="background:#252830;border:0.8px solid #3d4350;border-radius:8px;padding:10px 14px;min-width:175px;flex:1;max-width:250px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;margin-bottom:8px;">${placeLabel}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;${t1style}">
                <span>${m.team1 || "TBD"}</span>
                ${m.team1_pts != null ? `<span style="flex-shrink:0;margin-left:8px;">${m.team1_pts.toFixed(1)}</span>` : ""}
            </div>
            <div style="height:0.5px;background:#2d3139;margin:6px 0;"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;${t2style}">
                <span>${m.team2 || "TBD"}</span>
                ${m.team2_pts != null ? `<span style="flex-shrink:0;margin-left:8px;">${m.team2_pts.toFixed(1)}</span>` : ""}
            </div>
        </div>`;
}

function buildPlacementBracketHtml(winners, champPath) {
    const champPathSet = new Set(champPath.map(m => `${m.round}-${m.team1}-${m.team2}`));
    const maxRound = Math.max(...winners.map(m => m.round));
    const r2All = winners.filter(m => m.round === maxRound - 1);
    const champR2 = r2All.filter(m => champPathSet.has(`${m.round}-${m.team1}-${m.team2}`));
    const consolR2 = r2All.filter(m => !champPathSet.has(`${m.round}-${m.team1}-${m.team2}`));

    const place3 = winners.find(m => m.place === 3);
    const place5 = winners.find(m => m.place === 5);
    const place7 = winners.find(m => m.place === 7);

    if (!place3 && !place5 && !place7) return "";

    const thirdHtml = champR2.length && place3
        ? `<div><div style="margin-bottom:6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;">3rd Place</div><div class="bracket-wrap">${buildBracketSVG([...champR2, place3])}</div></div>`
        : place3 ? renderPlacementCard(place3) : "";

    const fifthHtml = consolR2.length && place5
        ? `<div><div style="margin-bottom:6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;">5th Place</div><div class="bracket-wrap">${buildBracketSVG([...consolR2, place5])}</div></div>`
        : place5 ? renderPlacementCard(place5) : "";

    const seventhHtml = place7
        ? `<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">${renderPlacementCard(place7)}</div>`
        : "";

    return `
        <div class="sh-section-title" style="margin-top:20px;">Placement Games</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">
            ${thirdHtml}
            ${fifthHtml}
        </div>
        ${seventhHtml}
    `;
}

function buildConsolBracketHtml(losers) {
    if (!losers.length) return "";
    const maxRound = Math.max(...losers.map(m => m.round));
    const r1 = losers.filter(m => m.round < maxRound);
    const place9 = losers.find(m => m.place === 9);
    const place11 = losers.find(m => m.place === 11);

    if (!r1.length && !place9 && !place11) return "";

    const parts = [];

    if (r1.length && place9) {
        parts.push(`
            <div style="margin-bottom:6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#5a6070;">9th Place</div>
            <div class="bracket-wrap">${buildBracketSVG([...r1, place9])}</div>
        `);
    } else if (place9) {
        parts.push(renderPlacementCard(place9));
    }

    if (place11) {
        parts.push(`<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">${renderPlacementCard(place11)}</div>`);
    }

    return `
        <div class="sh-section-title" style="margin-top:20px;">Consolation</div>
        ${parts.join("")}
    `;
}

function renderDraftOrder(year) {
    const nextYear = String(Number(year) + 1);
    const draftData = allData[`_draft_${nextYear}`];
    if (!draftData || !draftData.length) return "";

    // Round 1 picks sorted by pick_no = draft order
    const round1 = draftData.filter(p => p.round === 1).sort((a, b) => (a.pick_no || 0) - (b.pick_no || 0));
    if (!round1.length) return "";

    const rows = round1.map((p, i) => {
        const original = p.original_owner || "—";
        const pickedBy = p.picked_by || p.original_owner || "—";
        const traded = p.original_owner && p.picked_by && p.original_owner !== p.picked_by;
        return `
        <tr style="border-bottom:1px solid #2d3139;">
            <td style="padding:6px 8px;text-align:center;color:#5a6070;font-size:11px;font-weight:700;">${i + 1}</td>
            <td style="padding:6px 8px;text-align:left;font-weight:600;color:#f0f1f3;font-size:12px;">${original}</td>
            <td style="padding:6px 8px;text-align:right;font-size:11px;${traded ? 'color:#a78bfa;font-weight:600;' : 'color:#5a6070;'}">${traded ? pickedBy : '—'}</td>
        </tr>`;
    }).join("");

    return `
        <div class="card" style="padding:14px;background:#1e2027;border-color:#2d3139;margin-top:20px;">
            <div class="sh-section-title">${nextYear} Draft Order</div>
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead><tr style="background:#252830;">
                    <th style="padding:6px 8px;text-align:center;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;border-bottom:1px solid #2d3139;width:36px;">#</th>
                    <th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;border-bottom:1px solid #2d3139;">Manager</th>
                    <th style="padding:6px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#5a6070;border-bottom:1px solid #2d3139;">Picked By</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// ── Team recap ────────────────────────────────────────────────────────────────

function generateTeamRecap(teamName, year, s) {
    const standings = s.standings || [];
    const champ     = s.champion;
    const matchups  = allMatchups[year] || {};
    const yearTrades = allTransactions.filter(tx => tx.type === "trade" && tx.season === year);
    const yearMoves  = allTransactions.filter(tx =>
        (tx.type === "waiver" || tx.type === "free_agent") &&
        tx.season === year && tx.status === "complete" &&
        (tx.teams || []).includes(teamName)
    );

    const row = standings.find(t => t.name === teamName);
    if (!row) return `<p style="color:#5a6070;">No data for ${teamName} in ${year}.</p>`;

    const seed = standings.findIndex(t => t.name === teamName) + 1;
    const isChamp = champ === teamName;

    // Collect weekly results (regular season only)
    const weekResults = [];
    for (const [wk, ms] of Object.entries(matchups)) {
        const w = parseInt(wk);
        if (w > 14) continue;
        for (const m of ms) {
            const mine = (m.teams || []).find(t => t.owner === teamName);
            const opp  = (m.teams || []).find(t => t.owner !== teamName);
            if (!mine || !opp) continue;
            weekResults.push({ week: w, pts: mine.points, oppPts: opp.points, opp: opp.owner, won: mine.points > opp.points });
        }
    }
    weekResults.sort((a,b) => a.week - b.week);

    // Streaks
    function longestStreak(arr, won) {
        let best = 0, cur = 0, bestEnd = -1;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i].won === won) { cur++; if (cur > best) { best = cur; bestEnd = i; } }
            else cur = 0;
        }
        return { len: best, endIdx: bestEnd };
    }
    const winStreak  = longestStreak(weekResults, true);
    const loseStreak = longestStreak(weekResults, false);

    // Scoring extremes
    const sorted      = [...weekResults].sort((a,b) => b.pts - a.pts);
    const bestWk      = sorted[0];
    const worstWk     = sorted[sorted.length - 1];
    const biggestWin  = [...weekResults].filter(r => r.won).sort((a,b) => (b.pts-b.oppPts)-(a.pts-a.oppPts))[0];
    const closestWin  = [...weekResults].filter(r => r.won).sort((a,b) => (a.pts-a.oppPts)-(b.pts-b.oppPts))[0];
    const worstLoss   = [...weekResults].filter(r => !r.won).sort((a,b) => (b.oppPts-b.pts)-(a.oppPts-a.pts))[0];
    const heartbreaks = weekResults.filter(r => !r.won && r.oppPts - r.pts < 10).sort((a,b) => (a.oppPts-a.pts)-(b.oppPts-b.pts));

    // Phase records
    const early = weekResults.filter(r => r.week <= 5);
    const mid   = weekResults.filter(r => r.week >= 6 && r.week <= 9);
    const late  = weekResults.filter(r => r.week >= 10);
    const phaseRec = arr => `${arr.filter(r=>r.won).length}-${arr.filter(r=>!r.won).length}`;
    const phaseWins = arr => arr.filter(r=>r.won).length;

    // League scoring context
    const allPF = standings.map(t => t.pf);
    const pfRank = [...allPF].sort((a,b) => b-a).indexOf(row.pf) + 1;
    const allPA  = standings.map(t => t.pa);
    const paRank = [...allPA].sort((a,b) => a-b).indexOf(row.pa) + 1;

    // Trades involving this team
    const myTrades   = yearTrades.filter(tx => (tx.teams || []).includes(teamName));
    const inSeason   = myTrades.filter(tx => tx.week >= 1).sort((a,b) => a.week - b.week);
    const preSeason  = myTrades.filter(tx => tx.week === 0);

    // Helper: record after a given week
    const recordAfter = wk => {
        const after = weekResults.filter(r => r.week > wk);
        return after.length ? `${after.filter(r=>r.won).length}-${after.filter(r=>!r.won).length} after` : null;
    };

    const sections = [];

    // ── Season Overview ──────────────────────────────────────────────────────
    let regText = "";
    if (isChamp) regText += `${teamName} were the ${year} champions. `;
    const recDesc = row.wins >= 10 ? "dominant" : row.wins >= 8 ? "strong" : row.wins >= 6 ? "competitive" : row.wins >= 4 ? "disappointing" : "rough";
    regText += `They finished ${row.wins}-${row.losses} as the ${ordinal(seed)} seed`;

    if (pfRank === 1) {
        regText += `, leading the league in scoring with ${row.pf.toFixed(0)} pts. `;
    } else if (pfRank <= 3) {
        regText += `, ranking ${ordinal(pfRank)} in scoring (${row.pf.toFixed(0)} pts). `;
    } else if (pfRank >= standings.length - 1) {
        regText += `, but scoring just ${row.pf.toFixed(0)} pts — near the bottom of the league. `;
    } else {
        regText += `. `;
    }

    if (early.length && mid.length && late.length) {
        const phases = [
            {name:"early (Wks 1–5)", w:phaseWins(early), rec:phaseRec(early)},
            {name:"mid-season (Wks 6–9)", w:phaseWins(mid), rec:phaseRec(mid)},
            {name:"late (Wks 10–14)", w:phaseWins(late), rec:phaseRec(late)}
        ];
        const best  = phases.reduce((a,b) => b.w > a.w ? b : a);
        const worst = phases.reduce((a,b) => b.w < a.w ? b : a);
        if (best.name !== worst.name) {
            regText += `Their strongest stretch was ${best.name} (${best.rec}), while they hit a wall in the ${worst.name} (${worst.rec}). `;
        }
    }
    if (winStreak.len >= 3) {
        regText += `A ${winStreak.len}-game winning streak was their peak momentum. `;
    }
    if (loseStreak.len >= 3) {
        regText += `A ${loseStreak.len}-game losing skid hurt them at a critical stretch. `;
    }

    sections.push({ title: "Season Overview", text: regText });

    // ── Roster Moves ──────────────────────────────────────────────────────────
    let movesText = "";

    // Pre-season trades
    if (preSeason.length > 0) {
        movesText += `${teamName} reshaped their roster before the season even started. `;
        for (const tx of preSeason.slice(0, 3)) {
            const other = tx.teams.find(t => t !== teamName) || "?";
            const got  = (tx.assets_received[teamName] || []).filter(a => a.position !== "PICK").map(a => `<strong>${a.name}</strong>`);
            const gave = (tx.assets_received[other] || []).filter(a => a.position !== "PICK").map(a => `<strong>${a.name}</strong>`);
            if (got.length && gave.length) movesText += `They sent ${gave.join(", ")} to ${other} and got back ${got.join(", ")}. `;
            else if (got.length) movesText += `They picked up ${got.join(", ")} from ${other} before the year began. `;
        }
    }

    // In-season trades — show impact by tracking record after each deal
    if (inSeason.length > 0) {
        const tradeImpact = inSeason.slice(0, 5).map(tx => {
            const other      = tx.teams.find(t => t !== teamName) || "?";
            const got        = (tx.assets_received[teamName] || []).filter(a => a.position !== "PICK").map(a => `<strong>${a.name}</strong>`);
            const gave       = (tx.assets_received[other]    || []).filter(a => a.position !== "PICK").map(a => `<strong>${a.name}</strong>`);
            const gotPicks   = (tx.assets_received[teamName] || []).filter(a => a.position === "PICK").map(a => `<em>${a.name}</em>`);
            const gavePicks  = (tx.assets_received[other]    || []).filter(a => a.position === "PICK").map(a => `<em>${a.name}</em>`);
            const allGot     = [...got, ...gotPicks];
            const allGave    = [...gave, ...gavePicks];
            const postRecord = recordAfter(tx.week);
            return { week: tx.week, other, got: allGot, gave: allGave, postRecord };
        });

        if (!preSeason.length) {
            movesText += `${teamName} made ${myTrades.length === 1 ? "one trade" : `${myTrades.length} trades`} during the season. `;
        }

        for (const ti of tradeImpact) {
            if (!ti.got.length && !ti.gave.length) continue;
            if (ti.got.length && ti.gave.length) {
                movesText += `In Week ${ti.week} they sent ${ti.gave.join(", ")} to ${ti.other} for ${ti.got.join(", ")}`;
            } else if (ti.got.length) {
                movesText += `Week ${ti.week}: received ${ti.got.join(", ")} from ${ti.other}`;
            } else {
                movesText += `Week ${ti.week}: sent ${ti.gave.join(", ")} to ${ti.other}`;
            }
            if (ti.postRecord && parseInt(year) <= 2025) {
                movesText += ` — they went ${ti.postRecord} that deal`;
            }
            movesText += `. `;
        }
        if (myTrades.length > 5) {
            movesText += `Overall one of the most active rosters in the league with ${myTrades.length} trades. `;
        }
    } else if (preSeason.length === 0) {
        movesText += `${teamName} made no trades this season, riding their original roster through the entire year. `;
    }

    // Key waiver/FA pickups — exclude players who were subsequently dropped by this team same season
    const droppedNames = new Set(
        allTransactions
            .filter(tx => tx.season === year && (tx.teams || []).includes(teamName) && tx.status === "complete")
            .flatMap(tx => (tx.dropped || []).map(p => p.name))
    );
    const pickups = yearMoves
        .filter(tx => (tx.added || []).length > 0)
        .map(tx => ({ ...tx, added: (tx.added || []).filter(p => !droppedNames.has(p.name)) }))
        .filter(tx => tx.added.length > 0)
        .sort((a,b) => a.week - b.week);
    if (pickups.length > 0) {
        // Show up to 3 most notable pickups (prefer non-K/DEF, prefer earlier weeks)
        const notable = pickups
            .filter(tx => (tx.added || []).some(p => p.position !== "K" && p.position !== "DEF"))
            .slice(0, 3);
        if (notable.length > 0) {
            movesText += `On the waiver wire, `;
            const pickupLines = notable.map(tx => {
                const added   = (tx.added || []).filter(p => p.position !== "K" && p.position !== "DEF").map(p => `<strong>${p.name}</strong> (${p.position})`);
                const dropped = (tx.dropped || []).filter(p => p.position !== "K" && p.position !== "DEF").map(p => `<strong>${p.name}</strong>`);
                let line = `Week ${tx.week}: added ${added.join(", ")}`;
                if (dropped.length) line += ` off ${dropped.join(", ")}`;
                return line;
            });
            movesText += pickupLines.join("; ") + `. `;
            if (pickups.length > 3) {
                movesText += `They made ${pickups.length} total waiver/FA moves on the season. `;
            }
        }
    } else if (myTrades.length === 0) {
        movesText += `They also stayed off the waiver wire entirely — a pure set-it-and-forget-it approach. `;
    }

    sections.push({ title: "Roster Moves", text: movesText });

    // ── Key Moments ────────────────────────────────────────────────────────
    let perfText = "";
    if (bestWk) {
        if (bestWk.won) {
            perfText += `Best week: Week ${bestWk.week} — ${bestWk.pts.toFixed(1)} pts, a win over ${bestWk.opp}. `;
        } else {
            perfText += `In their best scoring week (Week ${bestWk.week}, ${bestWk.pts.toFixed(1)} pts), they still lost — ${bestWk.opp} put up ${bestWk.oppPts.toFixed(1)}. `;
        }
    }
    if (worstWk && worstWk.week !== bestWk?.week) {
        if (!worstWk.won) {
            perfText += `Worst showing: Week ${worstWk.week} — just ${worstWk.pts.toFixed(1)} pts in a loss to ${worstWk.opp}. `;
        } else {
            perfText += `Even their low-water mark (Week ${worstWk.week}, ${worstWk.pts.toFixed(1)} pts) still produced a win against ${worstWk.opp}. `;
        }
    }
    if (biggestWin) {
        perfText += `Biggest blowout: Week ${biggestWin.week}, a ${(biggestWin.pts - biggestWin.oppPts).toFixed(1)}-pt demolition of ${biggestWin.opp}. `;
    }
    if (heartbreaks.length > 0) {
        const hb = heartbreaks[0];
        perfText += `Toughest gut-punch: Week ${hb.week}, lost to ${hb.opp} by just ${(hb.oppPts - hb.pts).toFixed(1)} pts. `;
    } else if (worstLoss) {
        perfText += `Worst defeat: Week ${worstLoss.week}, blown out by ${worstLoss.opp} by ${(worstLoss.oppPts - worstLoss.pts).toFixed(1)} pts. `;
    }
    if (closestWin) {
        perfText += `Closest win: Week ${closestWin.week}, edged ${closestWin.opp} by ${(closestWin.pts - closestWin.oppPts).toFixed(1)} pts. `;
    }

    if (perfText) sections.push({ title: "Key Moments", text: perfText });

    return sections.map(sec => `
        <div style="margin-bottom:16px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;margin-bottom:6px;">${sec.title}</div>
            <p style="font-size:13px;line-height:1.75;color:#c9cdd4;margin:0;">${sec.text}</p>
        </div>`).join("");
}

// ── Season recap (structured paragraphs) ─────────────────────────────────────

function generateSeasonRecap(year, s) {
    const standings = s.standings || [];
    const winners   = s.winners_bracket || [];
    const champ     = s.champion;
    if (!champ || !standings.length) return "";

    const matchups      = allMatchups[year] || {};
    const yearTxs       = allTransactions.filter(tx => tx.type === "trade" && tx.season === year);
    const inSeasonTrades = yearTxs.filter(tx => tx.week >= 1).sort((a,b) => a.week - b.week);
    const preSeasonTrades = yearTxs.filter(tx => tx.week === 0);

    const seed1     = standings[0];
    const champIdx  = standings.findIndex(t => t.name === champ);
    const champSeed = champIdx + 1;
    const champRow  = standings[champIdx] || {};
    const mostPF    = standings.reduce((a, b) => b.pf > a.pf ? b : a, standings[0]);
    const leastPF   = standings.reduce((a, b) => b.pf < a.pf ? b : a, standings[0]);
    const mostPA    = standings.reduce((a, b) => b.pa > a.pa ? b : a, standings[0]);
    const leastPA   = standings.reduce((a, b) => b.pa < a.pa ? b : a, standings[0]);
    const champMatch = winners.find(m => m.place === 1);
    const second    = champMatch?.loser;

    // Collect all regular-season games for league-wide stats
    const allGames = [];
    for (const [wk, ms] of Object.entries(matchups)) {
        const w = parseInt(wk);
        if (w > 14) continue;
        for (const m of ms) {
            const [t1, t2] = m.teams || [];
            if (!t1 || !t2) continue;
            const winner = t1.points > t2.points ? t1 : t2;
            const loser  = t1.points > t2.points ? t2 : t1;
            allGames.push({ week: w, winner, loser, margin: winner.points - loser.points });
        }
    }
    const closestGame  = [...allGames].sort((a,b) => a.margin - b.margin)[0];
    const biggestBlowout = [...allGames].sort((a,b) => b.margin - a.margin)[0];
    const highestScoring = [...allGames].sort((a,b) => b.winner.points - a.winner.points)[0];

    // Per-team record tracking for narrative context
    const teamRecords = {};
    for (const t of standings) teamRecords[t.name] = { wins: 0, losses: 0 };
    for (const g of allGames) {
        if (teamRecords[g.winner.owner]) teamRecords[g.winner.owner].wins++;
        if (teamRecords[g.loser.owner])  teamRecords[g.loser.owner].losses++;
    }

    const sections = [];

    // ── Regular Season ──────────────────────────────────────────────────────
    let regText = "";

    if (seed1.name === champ) {
        regText += `<strong>${champ}</strong> were the story of the ${year} season — they set the pace in the regular season at ${seed1.wins}-${seed1.losses} and never let anyone forget who the best team was. `;
    } else {
        regText += `<strong>${seed1.name}</strong> had the best record in ${year} at ${seed1.wins}-${seed1.losses} and looked like the team to beat all year. <strong>${champ}</strong> came in as the ${ordinal(champSeed)} seed but proved that regular season records only tell part of the story. `;
    }

    // Scoring leaders
    if (mostPF.name === champ) {
        regText += `${champ} were also the most productive offense in the league, putting up ${mostPF.pf.toFixed(0)} points — more than anyone else. `;
    } else if (mostPF.name === seed1.name) {
        regText += `${seed1.name} backed up their record with the league's best offense — ${mostPF.pf.toFixed(0)} points scored, pulling away from the field. `;
    } else {
        regText += `<strong>${mostPF.name}</strong> was the highest-scoring team in the league at ${mostPF.pf.toFixed(0)} points, even if their record didn't always reflect it. `;
    }

    // Defensive/luck narrative
    if (leastPA.name !== mostPF.name) {
        regText += `<strong>${leastPA.name}</strong> had the good fortune of facing the weakest opponents week to week, allowing just ${leastPA.pa.toFixed(0)} points all season. `;
    }
    if (mostPA.name !== leastPF.name) {
        regText += `On the other end, <strong>${mostPA.name}</strong> couldn't catch a break — they gave up ${mostPA.pa.toFixed(0)} points, the most in the league. `;
    }

    // Bottom of standings
    const lastPlace = standings[standings.length - 1];
    if (lastPlace && lastPlace.name !== champ && lastPlace.wins <= 4) {
        regText += `<strong>${lastPlace.name}</strong> had a season to forget, finishing last at ${lastPlace.wins}-${lastPlace.losses}. `;
    }

    sections.push({ title: "Regular Season", text: regText });

    // ── Memorable Moments ───────────────────────────────────────────────────
    if (allGames.length > 0) {
        let momText = "";

        if (closestGame) {
            momText += `The closest game of the entire season came in Week ${closestGame.week}: <strong>${closestGame.winner.owner}</strong> survived a scare against <strong>${closestGame.loser.owner}</strong>, winning by just ${closestGame.margin.toFixed(2)} points (${closestGame.winner.points.toFixed(2)}–${closestGame.loser.points.toFixed(2)}). `;
        }
        if (biggestBlowout && biggestBlowout !== closestGame) {
            momText += `The most lopsided result of the year was Week ${biggestBlowout.week}, where <strong>${biggestBlowout.winner.owner}</strong> demolished <strong>${biggestBlowout.loser.owner}</strong> by ${biggestBlowout.margin.toFixed(2)} points. `;
        }
        if (highestScoring && highestScoring.winner.points > 180) {
            momText += `The single highest score of the season came from <strong>${highestScoring.winner.owner}</strong> in Week ${highestScoring.week} — ${highestScoring.winner.points.toFixed(2)} points, an eye-opening performance that put the rest of the league on notice. `;
        }

        // Find any team that went on a significant streak
        const streaks = {};
        for (const t of standings) {
            let cur = 0, best = 0;
            const games = allGames.filter(g => g.winner.owner === t.name || g.loser.owner === t.name)
                .sort((a,b) => a.week - b.week);
            for (const g of games) {
                if (g.winner.owner === t.name) { cur++; best = Math.max(best, cur); } else cur = 0;
            }
            if (best >= 5) streaks[t.name] = best;
        }
        for (const [team, len] of Object.entries(streaks)) {
            momText += `<strong>${team}</strong> put together a ${len}-game winning streak at one point — one of the most dominant runs of the ${year} season. `;
        }

        if (momText) sections.push({ title: "Memorable Moments", text: momText });
    }

    // ── Transactions ────────────────────────────────────────────────────────
    const allTrades = [...preSeasonTrades, ...inSeasonTrades];
    if (allTrades.length > 0) {
        let txText = "";

        // Champion's key moves
        const champTrades = inSeasonTrades.filter(tx => tx.teams.includes(champ));
        if (champTrades.length > 0) {
            const ct = champTrades[0];
            const gets = (ct.assets_received[champ] || []).filter(x => x.position !== "PICK").map(x => `<strong>${x.name}</strong>`);
            const from = ct.teams.find(t => t !== champ);
            if (gets.length) {
                txText += `<strong>${champ}</strong> made a move that defined their season: in Week ${ct.week} they acquired ${gets.slice(0,3).join(", ")} from ${from}${gets.length > 3 ? " along with other pieces" : ""}. `;
            }
        }

        // Biggest blockbuster overall
        const biggest = [...inSeasonTrades].sort((a,b) => {
            const pa = Object.values(a.assets_received).flat().filter(x => x.position !== "PICK").length;
            const pb = Object.values(b.assets_received).flat().filter(x => x.position !== "PICK").length;
            return pb - pa;
        })[0];
        if (biggest && !biggest.teams.includes(champ)) {
            const [bA, bB] = biggest.teams;
            const getA = (biggest.assets_received[bA] || []).filter(x => x.position !== "PICK").map(x => `<strong>${x.name}</strong>`);
            const getB = (biggest.assets_received[bB] || []).filter(x => x.position !== "PICK").map(x => `<strong>${x.name}</strong>`);
            if (getA.length + getB.length >= 3) {
                txText += `The biggest deal of the year came in Week ${biggest.week}: <strong>${bA}</strong> and <strong>${bB}</strong> swapped ${getB.slice(0,3).join(", ")} for ${getA.slice(0,3).join(", ")}${getA.length > 3 ? " and more" : ""}. `;
            }
        }

        // Pre-season activity
        if (preSeasonTrades.length > 0) {
            const activePre = new Set(preSeasonTrades.flatMap(t => t.teams));
            txText += `Even before the season kicked off, ${preSeasonTrades.length} pre-season trade${preSeasonTrades.length > 1 ? "s" : ""} involving ${[...activePre].join(", ")} signaled an active year ahead. `;
        }

        // Trade volume summary
        const activeTraders = new Set(inSeasonTrades.flatMap(tx => tx.teams));
        const tradeCounts = {};
        for (const tx of inSeasonTrades) for (const t of tx.teams) tradeCounts[t] = (tradeCounts[t] || 0) + 1;
        const mostActive = Object.entries(tradeCounts).sort((a,b) => b[1]-a[1])[0];
        if (mostActive && mostActive[1] >= 3) {
            txText += `<strong>${mostActive[0]}</strong> was the most trade-active team all season with ${mostActive[1]} deals. `;
        }
        txText += `All told, ${inSeasonTrades.length} in-season trade${inSeasonTrades.length !== 1 ? "s" : ""} involving ${activeTraders.size} teams reshaped the landscape throughout ${year}.`;

        sections.push({ title: "Transactions", text: txText });
    }

    // ── Playoffs ─────────────────────────────────────────────────────────────
    if (winners.length > 0) {
        const place3Match  = winners.find(m => m.place === 3);
        const place5Match  = winners.find(m => m.place === 5);
        const place7Match  = winners.find(m => m.place === 7);
        const third   = place3Match?.winner || null;
        const fifth   = place5Match?.winner || null;
        const seventh = place7Match?.winner || null;
        const champMatchLocal = winners.find(m => m.place === 1);
        const secondLocal = champMatchLocal?.loser || null;
        const champSeedLocal = standings.findIndex(t => t.name === champ) + 1;

        let playText = "";

        if (champMatchLocal) {
            const margin = champMatchLocal.team1_pts != null && champMatchLocal.team2_pts != null
                ? Math.abs(champMatchLocal.team1_pts - champMatchLocal.team2_pts).toFixed(1) : null;
            playText += `<strong>${champ}</strong> claimed the championship`;
            if (secondLocal) playText += `, defeating <strong>${secondLocal}</strong>`;
            if (margin) playText += ` by ${margin} points`;
            playText += `. `;
            if (champSeedLocal > 3) {
                playText += `Coming in as the ${ordinal(champSeedLocal)} seed, it was a run that nobody saw coming. `;
            } else if (standings[0]?.name !== champ) {
                playText += `They backed up their seeding with a decisive postseason run. `;
            }
        }

        if (secondLocal) {
            const secondSeed = standings.findIndex(t => t.name === secondLocal) + 1;
            if (secondSeed === 1) {
                playText += `<strong>${secondLocal}</strong> had the best record all year but came up short when it mattered most. `;
            } else {
                playText += `<strong>${secondLocal}</strong> made it to the finals as the ${ordinal(secondSeed)} seed before falling short. `;
            }
        }

        if (third) {
            const margin3 = place3Match?.team1_pts != null && place3Match?.team2_pts != null
                ? Math.abs(place3Match.team1_pts - place3Match.team2_pts).toFixed(1) : null;
            playText += `<strong>${third}</strong> took 3rd place${margin3 ? ` by ${margin3} points` : ""}. `;
        }
        if (fifth) playText += `<strong>${fifth}</strong> finished 5th. `;
        if (seventh) playText += `<strong>${seventh}</strong> finished 7th. `;

        const nonPlayoff = standings.filter(t => !new Set([...winners.flatMap(m => [m.team1, m.team2])]).has(t.name));
        const bestMissed = [...nonPlayoff].sort((a,b) => b.pf - a.pf)[0];
        if (bestMissed && standings[7] && bestMissed.pf > standings[7].pf) {
            playText += `Outside the bracket, <strong>${bestMissed.name}</strong> scored more than the 8th seed on pure points — a reminder that schedule luck shapes who gets in. `;
        }

        if (playText) sections.push({ title: "Playoffs", text: playText });
    }

    return sections.map(sec => `
        <div style="margin-bottom:16px;">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#5a6070;margin-bottom:6px;">${sec.title}</div>
            <p style="font-size:13px;line-height:1.75;color:#c9cdd4;margin:0;">${sec.text}</p>
        </div>`).join("");
}

// ── 2026 season preview ──────────────────────────────────────────────────────
// The season hasn't been played, so there is nothing to recap. Project it
// instead: build each team's best lineup from Sleeper's season projections, then
// run the real schedule 10,000 times to get records, seeds and title odds.

const PREVIEW_YEAR   = "2026";
const REG_SEASON_END = 14;      // playoffs start week 15
const PLAYOFF_TEAMS  = 6;
const WEEKLY_SD      = 24;      // typical week-to-week spread of a fantasy lineup
const NFL_WEEKS      = 17;
const SIMS           = 10000;

let previewData = null;   // {teams, schedule} once loaded

const PV_SLOTS = [["QB",1],["RB",2],["WR",3],["TE",1],["K",1],["DEF",1]];
const PV_FLEX  = ["RB","WR","TE"];

function pvBasePos(p) { return (p || "").split("/")[0].toUpperCase(); }

function pvBestLineup(players) {
    const by = {};
    players.forEach(x => { const p = pvBasePos(x.position); (by[p] = by[p] || []).push(x); });
    Object.values(by).forEach(a => a.sort((x, y) => (y.proj || 0) - (x.proj || 0)));
    const used = new Set();
    let total = 0;
    const slots = [];
    PV_SLOTS.forEach(([pos, n]) => {
        (by[pos] || []).slice(0, n).forEach(x => { total += x.proj || 0; used.add(x); slots.push(x); });
    });
    const flex = PV_FLEX.flatMap(pos => by[pos] || []).filter(x => !used.has(x))
                        .sort((a, b) => (b.proj || 0) - (a.proj || 0))[0];
    if (flex) { total += flex.proj || 0; used.add(flex); slots.push(flex); }
    const bench = players.filter(x => !used.has(x)).sort((a, b) => (b.proj || 0) - (a.proj || 0));
    return { total, slots, bench };
}

// Box-Muller, so a simulated week is a draw around the team's projected mean.
function pvNormal() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

async function loadPreview() {
    if (previewData) return previewData;
    const [values, rosters, matchups] = await Promise.all([
        api.getPlayerValues(PREVIEW_YEAR).catch(() => ({})),
        api.getRosters(PREVIEW_YEAR).catch(() => []),
        api.getMatchups(PREVIEW_YEAR).catch(() => ({})),
    ]);
    if (!rosters.length || !Object.keys(values).length) return null;

    const teams = {};
    rosters.forEach(r => {
        const players = (r.players || []).map(p => ({
            name: p.name, position: p.position, nfl: p.team,
            proj: (values[p.player_id] || {}).proj || 0,
        }));
        const lineup = pvBestLineup(players);
        const group = {};
        players.forEach(x => {
            const pos = pvBasePos(x.position);
            group[pos] = (group[pos] || 0) + (x.proj || 0);
        });
        const ranked = lineup.slots.slice().sort((a, b) => b.proj - a.proj);
        teams[r.owner] = {
            owner: r.owner,
            season: lineup.total,
            perWeek: lineup.total / NFL_WEEKS,
            starters: ranked,
            weakest: ranked.filter(x => !["K","DEF"].includes(pvBasePos(x.position))).slice(-1)[0] || null,
            bench: lineup.bench,
            depth: lineup.bench.slice(0, 4).reduce((s, x) => s + x.proj, 0),
            group,
        };
    });

    // Real schedule, weeks 1-14, as owner-name pairs.
    const schedule = [];
    for (let wk = 1; wk <= REG_SEASON_END; wk++) {
        const games = (matchups[wk] || matchups[String(wk)] || [])
            .filter(m => (m.teams || []).length === 2)
            .map(m => [m.teams[0].owner, m.teams[1].owner]);
        if (games.length) schedule.push(games);
    }
    previewData = { teams, schedule };
    return previewData;
}

function simulateSeason(teams, schedule) {
    const names = Object.keys(teams);
    const agg = {};
    names.forEach(n => { agg[n] = { wins: 0, pf: 0, playoffs: 0, bye: 0, finals: 0, titles: 0, seedSum: 0 }; });

    const weekly = {};   // reused per sim
    for (let s = 0; s < SIMS; s++) {
        const w = {}, pf = {};
        names.forEach(n => { w[n] = 0; pf[n] = 0; });
        schedule.forEach(week => {
            week.forEach(([a, b]) => {
                if (!teams[a] || !teams[b]) return;
                const sa = teams[a].perWeek + pvNormal() * WEEKLY_SD;
                const sb = teams[b].perWeek + pvNormal() * WEEKLY_SD;
                pf[a] += sa; pf[b] += sb;
                if (sa >= sb) w[a]++; else w[b]++;
            });
        });
        const seeded = names.slice().sort((x, y) => (w[y] - w[x]) || (pf[y] - pf[x]));
        seeded.forEach((n, i) => {
            agg[n].wins += w[n]; agg[n].pf += pf[n]; agg[n].seedSum += i + 1;
            if (i < PLAYOFF_TEAMS) agg[n].playoffs++;
            if (i < 2) agg[n].bye++;
        });
        // Bracket: 3v6 and 4v5, winners meet the byes, then the final.
        const game = (a, b) => (teams[a].perWeek + pvNormal() * WEEKLY_SD >=
                                teams[b].perWeek + pvNormal() * WEEKLY_SD) ? a : b;
        const [s1, s2, s3, s4, s5, s6] = seeded;
        const semiA = game(s1, game(s4, s5));
        const semiB = game(s2, game(s3, s6));
        agg[semiA].finals++; agg[semiB].finals++;
        agg[game(semiA, semiB)].titles++;
    }
    return names.map(n => ({
        owner: n,
        proj: teams[n].season,
        perWeek: teams[n].perWeek,
        wins: agg[n].wins / SIMS,
        pf: agg[n].pf / SIMS,
        seed: agg[n].seedSum / SIMS,
        playoffPct: agg[n].playoffs / SIMS,
        byePct: agg[n].bye / SIMS,
        finalsPct: agg[n].finals / SIMS,
        titlePct: agg[n].titles / SIMS,
        starters: teams[n].starters,
        weakest: teams[n].weakest,
        depth: teams[n].depth,
        group: teams[n].group,
    })).sort((a, b) => b.titlePct - a.titlePct || b.wins - a.wins);
}

function pvPredictionText(rows) {
    const pct  = v => `${(v*100).toFixed(0)}%`;
    const name = x => x ? `<strong>${x.name}</strong>` : "";
    const byWins  = rows.slice().sort((a, b) => b.wins - a.wins);
    const byPts   = rows.slice().sort((a, b) => b.proj - a.proj);
    const best = (pos) => rows.slice().sort((a, b) => (b.group[pos]||0) - (a.group[pos]||0))[0];
    const topAt = (r, pos) => r.starters.find(x => pvBasePos(x.position) === pos);

    const fav = rows[0], second = rows[1], third = rows[2];
    const last = byWins[byWins.length - 1];
    const gap  = Math.round(byPts[0].proj - byPts[byPts.length - 1].proj);
    const bubble  = rows.filter(r => r.playoffPct > 0.35 && r.playoffPct < 0.65);
    const deepest = rows.slice().sort((a, b) => b.depth - a.depth)[0];
    const thinnest = rows.slice().sort((a, b) => a.depth - b.depth)[0];
    // Strong roster, soft odds: the projection likes them more than the bracket does.
    const unlucky = rows.slice().sort((a, b) =>
        (byPts.indexOf(a) - rows.indexOf(a)) - (byPts.indexOf(b) - rows.indexOf(b)))[0];
    const rbRoom = best("RB"), wrRoom = best("WR"), qbTeam = best("QB"), teTeam = best("TE");
    const favStud = fav.starters[0];

    return `
    <h3 class="pv-h">The favourite, barely</h3>
    <p>${fav.owner} comes out of the draft with the most complete roster in the league —
    ${fav.proj.toFixed(0)} projected points of starting lineup, ${fav.perWeek.toFixed(1)} a week, and a
    ${fav.wins.toFixed(1)}-win pace that leads every other team. ${name(favStud)} headlines it at
    ${Math.round(favStud.proj)} projected points${fav.starters[1] ? `, with ${name(fav.starters[1])} behind him` : ""}.
    That resume is worth <strong>${pct(fav.titlePct)}</strong> to win the thing and ${pct(fav.finalsPct)} to reach
    the final — the best number on the board, and still a long way from a coronation. In a twelve-team league,
    random chance alone hands you 8%. ${fav.owner} has bought about ${(fav.titlePct/(1/12)).toFixed(1)}× that.
    Nobody should be printing banners.</p>

    <h3 class="pv-h">Who's actually chasing</h3>
    <p>${second.owner} (${pct(second.titlePct)}) and ${third.owner} (${pct(third.titlePct)}) are close enough that
    a single injury reorders the top of the league.
    ${second.weakest ? `${second.owner}'s soft spot is ${name(second.weakest)} at ${Math.round(second.weakest.proj)} projected points —
    the weakest link in an otherwise strong starting eleven.` : ""}
    The real story is how little separates anyone: <strong>${gap} points</strong> divide the best and worst
    projected lineups across an entire season, under ${(gap/NFL_WEEKS).toFixed(1)} a week. A fantasy lineup
    routinely swings twenty-plus points in either direction on any given Sunday, which means the projected
    ordering is a whisper, not a shout. ${bubble.length} teams sit between 35% and 65% to make the playoffs.</p>

    <h3 class="pv-h">Positional battlegrounds</h3>
    <p>${rbRoom.owner} owns the deepest backfield at ${Math.round(rbRoom.group.RB || 0)} projected points of running
    back${topAt(rbRoom,"RB") ? `, fronted by ${name(topAt(rbRoom,"RB"))}` : ""} — in a league that starts two plus a
    flex, that is the position most likely to decide a title.
    ${wrRoom.owner} counters with the best receiving corps at ${Math.round(wrRoom.group.WR || 0)} points${topAt(wrRoom,"WR") ? ` behind ${name(topAt(wrRoom,"WR"))}` : ""}.
    ${qbTeam.owner} has the quarterback edge${topAt(qbTeam,"QB") ? ` in ${name(topAt(qbTeam,"QB"))} (${Math.round(topAt(qbTeam,"QB").proj)})` : ""},
    though single-QB scoring caps how much that is worth.
    ${teTeam.owner} took the tight end premium seriously${topAt(teTeam,"TE") ? ` with ${name(topAt(teTeam,"TE"))}` : ""},
    which in a one-TE league is a weekly edge over half the field rather than a luxury.</p>

    <h3 class="pv-h">Depth is the tiebreaker</h3>
    <p>Everyone's starters look fine in August. The separation arrives in weeks 5 through 12, when byes stack and
    the injury report gets long. ${deepest.owner} is best equipped for it — ${Math.round(deepest.depth)} projected
    points sitting on the bench in their top four reserves. ${thinnest.owner} is the opposite case at
    ${Math.round(thinnest.depth)}, a starting lineup with very little behind it; one hamstring turns a playoff team
    into a seller.</p>

    <h3 class="pv-h">Two calls worth making</h3>
    ${(() => {
        const ptsRank = byPts.indexOf(unlucky) + 1;
        const oddsRank = byWins.indexOf(unlucky) + 1;
        // Only worth calling out when the schedule genuinely buries a good roster.
        return oddsRank - ptsRank >= 2
            ? `<p><strong>${unlucky.owner} is better than their seed.</strong> ${ordinal(ptsRank)} in raw
               projected points but only ${ordinal(oddsRank)} in expected wins at ${pct(unlucky.playoffPct)}
               to make the playoffs — that gap is the schedule, not the roster. Buy low if anyone in this league
               reads the standings instead of the point totals.</p>`
            : `<p><strong>Nobody is being robbed by the schedule.</strong> Every team's expected wins line up with
               their projected points within a spot or two, so there is no hidden contender to buy low on. The
               ordering you see is the ordering the rosters earned — which also means it moves the moment somebody
               wins a waiver claim.</p>`;
    })()}
    <p><strong>${last.owner} is not done.</strong> Last in projected wins at ${last.wins.toFixed(1)}, and still
    ${pct(last.playoffPct)} to make the playoffs. That is the point of a league bunched this tightly: the bottom
    of the board sits roughly a coin flip away from the sixth seed.</p>

    <p class="pv-caveat">Projections, not prophecy. These are preseason numbers, they assume every manager starts
    their optimal lineup every week and never touches the waiver wire, and they know nothing about holdouts,
    training-camp hype or the running back who breaks out in week 3. Half of what decides this season hasn't
    happened yet.</p>`;
}
function renderPreview(rows) {
    const pct = v => `${(v*100).toFixed(0)}%`;
    const heat = v => v >= 0.66 ? "#3ecf8e" : v >= 0.33 ? "#f6ad55" : "#5a6070";

    const table = `
        <div class="card" style="padding:14px;background:#1e2027;border-color:#2d3139;">
            <div class="sh-section-title">Projected Standings</div>
            <table class="sh-table" style="width:100%;">
                <thead><tr>
                    <th style="width:18px;text-align:left;">#</th>
                    <th style="text-align:left;">Team</th>
                    <th>Rec</th><th>PF</th><th>Playoff</th><th>Title</th>
                </tr></thead>
                <tbody>
                    ${rows.slice().sort((a,b) => b.wins - a.wins || b.pf - a.pf).map((r, i) => `
                        <tr class="${i === 0 ? "champ-row" : i < PLAYOFF_TEAMS ? "playoff-row" : ""}">
                            <td class="rank">${i+1}</td>
                            <td style="text-align:left;font-weight:600;">
                                <a href="team.html?team=${encodeURIComponent(r.owner)}" style="color:inherit;text-decoration:none;">${r.owner}</a>
                            </td>
                            <td>${r.wins.toFixed(1)}-${(REG_SEASON_END - r.wins).toFixed(1)}</td>
                            <td>${Math.round(r.pf)}</td>
                            <td style="color:${heat(r.playoffPct)};font-weight:600;">${pct(r.playoffPct)}</td>
                            <td style="color:${heat(r.titlePct)};font-weight:600;">${pct(r.titlePct)}</td>
                        </tr>`).join("")}
                </tbody>
            </table>
        </div>`;

    const favourite = rows[0];
    const predCard = `
        <div class="card" style="padding:16px 20px;background:#1e2027;border-color:#2d3139;">
            <div class="sh-section-title">Prediction</div>
            <div style="font-size:13px;color:#c9cdd4;line-height:1.7;">${pvPredictionText(rows)}</div>
        </div>`;

    return `
        <div class="sh-year" data-year="${PREVIEW_YEAR}">
            <div class="sh-year-header">
                <div class="sh-year-title">${PREVIEW_YEAR}</div>
                <div class="sh-place-badge" style="background:linear-gradient(135deg,#0f2027,#16323b);border:1px solid #38b2ac;color:#5eead4;">Season Preview</div>
                <div class="sh-champion">🔮 ${favourite.owner} — ${(favourite.titlePct*100).toFixed(0)}% title odds</div>
            </div>
            <div class="sh-grid sh-grid-preview">
                <div>${table}</div>
                ${predCard}
            </div>
        </div>`;
}

async function previewHtml() {
    const data = await loadPreview();
    if (!data || !data.schedule.length) return "";
    return renderPreview(simulateSeason(data.teams, data.schedule));
}

function renderSeason(year) {
    const s = allData[year];
    if (!s) return "";
    const standings = s.standings || [];
    const winners = s.winners_bracket || [];
    const losers = s.losers_bracket || [];
    const champ = s.champion;

    const playoffTeams = new Set();
    winners.forEach(m => { playoffTeams.add(m.team1); playoffTeams.add(m.team2); });

    // Determine 2nd and 3rd place from bracket
    const champMatch  = winners.find(m => m.place === 1);
    const secondPlace = champMatch?.loser  || null;
    const thirdMatch  = winners.find(m => m.place === 3);
    const thirdPlace  = thirdMatch?.winner || null;

    function rowClass(name) {
        if (name === champ)        return "champ-row";
        if (name === secondPlace)  return "silver-row";
        if (name === thirdPlace)   return "bronze-row";
        if (playoffTeams.has(name)) return "playoff-row";
        return "";
    }
    function rowTrophy(name) {
        if (name === champ)       return " 🏆";
        if (name === secondPlace) return " 🥈";
        if (name === thirdPlace)  return " 🥉";
        return "";
    }

    const standingsHtml = `
        <div class="card" style="padding:14px;background:#1e2027;border-color:#2d3139;">
            <div class="sh-section-title">Regular Season</div>
            <table class="sh-table" style="width:100%;">
                <thead><tr>
                    <th style="width:20px;text-align:left;">#</th>
                    <th style="text-align:left;">Team</th>
                    <th>W</th><th>L</th><th>PF</th><th>PA</th>
                </tr></thead>
                <tbody>
                    ${standings.map((t, i) => `
                        <tr class="${rowClass(t.name)}">
                            <td class="rank">${i+1}</td>
                            <td style="text-align:left;font-weight:600;">${t.name}${rowTrophy(t.name)}</td>
                            <td>${t.wins}</td><td>${t.losses}</td>
                            <td>${Math.round(t.pf)}</td><td>${Math.round(t.pa)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;

    const champPath = buildChampPath(winners);
    const placementHtml = winners.length ? buildPlacementBracketHtml(winners, champPath) : "";
    const consolHtml    = losers.length  ? buildConsolBracketHtml(losers) : "";

    const bracketHtml = `
        <div class="card" style="padding:14px;background:#1e2027;border-color:#2d3139;margin-top:20px;">
            <div class="sh-section-title">Playoff Bracket</div>
            <div class="bracket-wrap">${buildBracketSVG(champPath)}</div>
            ${placementHtml}
            ${consolHtml}
        </div>
    `;

    const champBadge = [
        champ       ? `<div class="sh-champion">🏆 ${champ}</div>` : "",
        secondPlace ? `<div class="sh-place-badge sh-silver">🥈 ${secondPlace}</div>` : "",
        thirdPlace  ? `<div class="sh-place-badge sh-bronze">🥉 ${thirdPlace}</div>` : "",
    ].filter(Boolean).join("");
    const draftOrderHtml = renderDraftOrder(year);
    const teamList = standings.map(t => t.name);

    // Pre-generate all summary content (season + each team)
    const seasonHtml = generateSeasonRecap(year, s);
    window._shRecaps = window._shRecaps || {};
    window._shRecaps[`${year}__season`] = seasonHtml;
    teamList.forEach(name => {
        window._shRecaps[`${year}__${name}`] = generateTeamRecap(name, year, s);
    });

    const recapCard = seasonHtml ? `
        <div class="card" style="padding:16px 20px;background:#1e2027;border-color:#2d3139;display:flex;flex-direction:column;box-sizing:border-box;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;flex-shrink:0;">
                <div class="sh-section-title" style="margin:0;">Summary</div>
                <select style="font-size:12px;padding:4px 8px;" onchange="(function(sel){
                    var year='${year}', val=sel.value;
                    var key=year+'__'+val;
                    var el=document.getElementById('sh-recap-${year}');
                    if(el && window._shRecaps && window._shRecaps[key]) el.innerHTML=window._shRecaps[key];
                })(this)">
                    <option value="season">Season Summary</option>
                    ${teamList.map(t => `<option value="${t}">${t}</option>`).join("")}
                </select>
            </div>
            <div id="sh-recap-${year}" style="flex:1;overflow-y:auto;">${seasonHtml}</div>
        </div>` : "";

    return `
        <div class="sh-year" data-year="${year}">
            <div class="sh-year-header">
                <div class="sh-year-title">${year}</div>
                ${champBadge}
            </div>
            <div class="sh-grid">
                <div>
                    ${standingsHtml}
                    ${draftOrderHtml}
                </div>
                ${recapCard}
            </div>
            ${bracketHtml}
        </div>
    `;
}

let previewCache = null;

async function render(filterYear) {
    const board = document.getElementById("sh-board");
    const years = filterYear === "all" ? allSeasons : [filterYear];
    const wantPreview = filterYear === "all" || filterYear === PREVIEW_YEAR;
    if (wantPreview && previewCache === null) previewCache = await previewHtml();
    const preview = wantPreview ? (previewCache || "") : "";
    board.innerHTML = preview + years.filter(y => y !== PREVIEW_YEAR).map(renderSeason).join("");
}

async function init() {
    await new Promise(r =>
        document.readyState === "loading"
            ? document.addEventListener("DOMContentLoaded", r)
            : r()
    );

    const container = document.getElementById("history-container");

    [allData, allTransactions] = await Promise.all([
        api.getSeasonHistory(),
        api.getTransactions(),
    ]);
    allSeasons = Object.keys(allData).filter(y => allData[y].champion).sort().reverse();

    // Load next-year draft data + matchups for each completed season
    await Promise.all(allSeasons.flatMap(year => {
        const nextYear = String(Number(year) + 1);
        return [
            api.getDraft(nextYear).then(picks => {
                if (picks && picks.length) allData[`_draft_${nextYear}`] = picks;
            }).catch(() => {}),
            api.getMatchups(year).then(mu => {
                if (mu) allMatchups[year] = mu;
            }).catch(() => {}),
        ];
    }));

    container.innerHTML = `
    <style>
        #history-container { max-width: 1100px; }
        .sh-year { margin-bottom: 52px; }
        .sh-year-header {
            display:flex; align-items:center; gap:16px;
            margin-bottom:20px; padding-bottom:14px;
            border-bottom:2px solid #2d3139;
            flex-wrap:wrap; row-gap:8px;
        }
        .sh-year-title { font-size:24px; font-weight:800; color:#f0f1f3; }
        .sh-champion {
            background:linear-gradient(135deg,#292202,#3b2f02);
            border:1px solid #b45309; border-radius:999px;
            padding:4px 14px; font-size:13px; font-weight:700; color:#fbbf24;
        }
        .sh-place-badge { border-radius:999px; padding:4px 14px; font-size:13px; font-weight:700; }
        .sh-silver { background:linear-gradient(135deg,#141a2e,#1c2640); border:1px solid #64748b; color:#c8d6e5; }
        .sh-bronze { background:linear-gradient(135deg,#1c1608,#231d0b); border:1px solid #7c5f2a; color:#cd9b5a; }
        .sh-grid { display:grid; grid-template-columns:280px 1fr; gap:20px; align-items:stretch; min-width:0; }
        /* The preview table carries four numeric columns instead of two, so it
           needs a wider left rail than a finished season's standings. */
        .sh-grid-preview { grid-template-columns:400px 1fr; }
        .pv-h { font-size:12px; text-transform:uppercase; letter-spacing:0.06em; color:#5eead4;
                font-weight:700; margin:20px 0 8px; }
        .pv-h:first-child { margin-top:0; }
        .pv-caveat { color:#8b9099; font-style:italic; font-size:12px; border-top:1px solid #2d3139;
                     padding-top:12px; margin-top:20px; }
        .sh-grid-preview .sh-table td, .sh-grid-preview .sh-table th { padding:6px 4px; }
        .sh-grid > * { min-width:0; }
        .sh-section-title {
            font-size:10px; text-transform:uppercase; letter-spacing:0.07em;
            color:#5a6070; font-weight:700; margin-bottom:10px;
        }
        .sh-table { width:100%; border-collapse:collapse; font-size:12px; }
        .sh-table th {
            text-align:center; font-size:10px; text-transform:uppercase;
            letter-spacing:0.05em; color:#5a6070; padding:6px 6px;
            border-bottom:1px solid #2d3139; font-weight:600; white-space:nowrap;
            background:#252830;
        }
        .sh-table td {
            padding:6px 6px; text-align:center;
            border-bottom:1px solid #2d3139; color:#c9cdd4; white-space:nowrap;
        }
        .rank { color:#5a6070; font-size:11px; }
        .sh-table tr:hover td { background:#252830; }
        .playoff-row td { background:#1c1704 !important; }
        .champ-row td { background:#2c2102 !important; font-weight:700; color:#fbbf24 !important; }
        .silver-row td { background:#1a1f2e !important; font-weight:700; color:#c8d6e5 !important; }
        .bronze-row td { background:#1e1a10 !important; font-weight:700; color:#cd9b5a !important; }
        .bracket-wrap { overflow-x:auto; padding-bottom:8px; -webkit-overflow-scrolling:touch; }
        @media (max-width:800px) { .sh-grid, .sh-grid-preview { grid-template-columns:1fr; } }
    </style>

    <div class="filter-bar" style="margin-bottom:24px;">
        <select id="sh-select">
            <option value="all">All Years</option>
            <option value="${PREVIEW_YEAR}">${PREVIEW_YEAR} (preview)</option>
            ${allSeasons.map(y => `<option value="${y}">${y}</option>`).join("")}
        </select>
    </div>

    <div id="sh-board"></div>
    `;

    document.getElementById("sh-select").addEventListener("change", e => render(e.target.value));
    render("all");
}

init();