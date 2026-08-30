#!/usr/bin/env node
/**
 * arcade.svg generator
 * ---------------------------------------------------------------
 * Renders ONE animated SVG that plays three games on the GitHub
 * contribution grid, one after another, like a carousel:
 *
 *   slide 1  snake.sh    a snake wanders the grid hunting commits
 *   slide 2  pacman.sh   Pac-Man roams the maze, ghosts in tow
 *   slide 3  tetris.sh   commits rain down in scattered clusters
 *
 * Nothing moves in straight sweeps: the snake and Pac-Man pick their
 * next meal from the handful of nearest commits at random and take an
 * L-shaped route to it, so the path meanders differently every day.
 *
 * Everything is pure CSS keyframes inside the SVG, because GitHub
 * strips <script> and does not run hover/click inside <img>.
 * ---------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");

const USER = process.env.ARCADE_USER || "tahabahar";
const TOKEN = process.env.GITHUB_TOKEN || "";
const OUT_DIR = process.env.ARCADE_OUT || "dist";
const MOCK = process.env.ARCADE_MOCK === "1";

/* ---------------------------------------------------------------- geometry */
const COLS = 53;
const ROWS = 7;
const CELL = 12;
const GAP = 3;
const P = CELL + GAP;

const PAD_L = 56;
const PAD_R = 56;
const PAD_T = 58;
const PAD_B = 48;

const GRID_W = COLS * P - GAP;
const GRID_H = ROWS * P - GAP;
const W = PAD_L + GRID_W + PAD_R;
const H = PAD_T + GRID_H + PAD_B;

const GX = PAD_L;
const GY = PAD_T;

const cx = (c) => GX + c * P + CELL / 2;
const cy = (r) => GY + r * P + CELL / 2;

/* ------------------------------------------------------------------ timing */
const SLIDE = 20;                 // seconds per game
const SLIDES = 3;
const TOTAL = SLIDE * SLIDES;     // 60s loop
const FADE = 0.5;                 // crossfade between slides
const LEAD_IN = 1.0;              // beat before a game starts playing
const LEAD_OUT = 2.2;             // beat to admire the board afterwards
const PLAY = SLIDE - LEAD_IN - LEAD_OUT;

// how many grid cells the player crosses per second - this is the speed dial
const SNAKE_CPS = 11;
const PAC_CPS = 13;

const pct = (t) => +((t / TOTAL) * 100).toFixed(3);
const clampPct = (p) => Math.max(0, Math.min(100, p));

/* ------------------------------------------------------------------ themes */
const THEMES = {
  dark: {
    bg: "#0a0e0a",
    panel: "#0d150f",
    frame: "#1f7a3f",
    empty: "#12261a",
    levels: ["#12261a", "#0e5c31", "#12a04b", "#26d365", "#00ff66"],
    accent: "#00ff66",
    dim: "#1f7a3f",
    text: "#c9f7d0",
    muted: "#5f9c75",
    ghost: ["#ff5f5f", "#ff9ce0"],
    pac: "#ffe14d",
    suit: "#e02b39",
    suitDark: "#8f1420",
    tights: "#2f6bdc",
    tightsDark: "#1b3f88",
    web: "#dff5e6",
    lens: "#f2fff6",
    civDark: "#06170d",
    civLight: "#cdf7dc",
    skyline: "#0f1f16",
  },
  light: {
    bg: "#ffffff",
    panel: "#f6f8fa",
    frame: "#c7d3cb",
    empty: "#ebedf0",
    levels: ["#ebedf0", "#aceebb", "#4ac26b", "#2da44e", "#116329"],
    accent: "#1a7f37",
    dim: "#8bbf9f",
    text: "#1f2328",
    muted: "#6e7781",
    ghost: ["#d1242f", "#bf3989"],
    pac: "#d4a72c",
    suit: "#c9202e",
    suitDark: "#870f1a",
    tights: "#1f4fb5",
    tightsDark: "#153778",
    web: "#48564e",
    lens: "#ffffff",
    civDark: "#123a22",
    civLight: "#ffffff",
    skyline: "#c4cdc6",
  },
};

/* -------------------------------------------------------------------- data */
async function fetchGrid() {
  if (MOCK || !TOKEN) return mockGrid();

  const query = `
    query($login:String!){
      user(login:$login){
        contributionsCollection{
          contributionCalendar{
            weeks{ contributionDays{ contributionCount contributionLevel weekday } }
          }
        }
      }
    }`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "arcade-generator",
    },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });

  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));

  const LEVEL = {
    NONE: 0,
    FIRST_QUARTILE: 1,
    SECOND_QUARTILE: 2,
    THIRD_QUARTILE: 3,
    FOURTH_QUARTILE: 4,
  };

  const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
  const grid = Array.from({ length: COLS }, () => Array(ROWS).fill(0));
  weeks.slice(-COLS).forEach((week, c) => {
    week.contributionDays.forEach((d) => {
      grid[c][d.weekday] = LEVEL[d.contributionLevel] ?? 0;
    });
  });
  return grid;
}

function mockGrid() {
  const rnd = makeRng(1337);
  const grid = Array.from({ length: COLS }, () => Array(ROWS).fill(0));
  for (let c = 0; c < COLS; c++) {
    const busy = 0.35 + 0.5 * Math.abs(Math.sin(c / 6));
    for (let r = 0; r < ROWS; r++) {
      const weekend = r === 0 || r === 6;
      const v = rnd() * (weekend ? 0.55 : 1) * busy;
      grid[c][r] = v > 0.62 ? 4 : v > 0.46 ? 3 : v > 0.3 ? 2 : v > 0.16 ? 1 : 0;
    }
  }
  return grid;
}

/* ------------------------------------------------------------------ random */
// xorshift32 - deterministic, so the same contribution data always renders the
// same route (a rerun on an unchanged day produces an identical file)
function makeRng(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

function seedFrom(grid, salt) {
  let h = 2166136261 ^ salt;
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++) {
      h ^= grid[c][r] + c * 7 + r;
      h = Math.imul(h, 16777619);
    }
  return h >>> 0;
}

/* ------------------------------------------------------------------- route */
const key = (c, r) => c * ROWS + r;

// step cell-by-cell from `from` to `to`, turning once - never a long diagonal
function legTo(from, to, rng) {
  const out = [];
  let [c, r] = from;
  const [tc, tr] = to;
  const goH = () => { while (c !== tc) { c += c < tc ? 1 : -1; out.push([c, r]); } };
  const goV = () => { while (r !== tr) { r += r < tr ? 1 : -1; out.push([c, r]); } };
  if (rng() < 0.5) { goH(); goV(); } else { goV(); goH(); }
  return out;
}

/**
 * Wander from commit to commit. At each step we look at the few closest
 * uneaten commits and pick one at random rather than always the nearest,
 * which is what stops the path from collapsing into a tidy sweep.
 * `maxCells` caps the route so the player moves at a readable speed - a
 * board with more commits than that simply does not get fully cleared.
 */
function wanderRoute(grid, rng, maxCells, choices) {
  const targets = [];
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++) if (grid[c][r]) targets.push([c, r]);
  if (!targets.length) return [[0, 0]];

  let cur = targets[Math.floor(rng() * targets.length)];
  const left = new Map(targets.map((t) => [key(t[0], t[1]), t]));
  left.delete(key(cur[0], cur[1]));

  const route = [cur];
  while (left.size && route.length < maxCells) {
    const near = [...left.values()]
      .map((t) => [t, Math.abs(t[0] - cur[0]) + Math.abs(t[1] - cur[1])])
      .sort((a, b) => a[1] - b[1])
      .slice(0, choices);
    const next = near[Math.floor(rng() * near.length)][0];
    const leg = legTo(cur, next, rng);
    if (route.length + leg.length > maxCells) break;
    route.push(...leg);
    left.delete(key(next[0], next[1]));
    cur = next;
  }
  return route;
}

const toPathD = (route) =>
  route.map(([c, r], i) => `${i ? "L" : "M"}${cx(c)} ${cy(r)}`).join("");

// index in the route at which each cell is first passed over
function firstVisits(route) {
  const m = new Map();
  route.forEach(([c, r], i) => {
    const k = key(c, r);
    if (!m.has(k)) m.set(k, i);
  });
  return m;
}

/* --------------------------------------------------------------- css parts */
function slideVisibilityCSS() {
  let css = "";
  for (let i = 0; i < SLIDES; i++) {
    const s = i * SLIDE;
    const e = s + SLIDE;
    if (i === 0) {
      css +=
        `@keyframes sv0{0%,${pct(e - FADE)}%{opacity:1}` +
        `${pct(e)}%,${pct(TOTAL - FADE)}%{opacity:0}100%{opacity:1}}`;
    } else {
      css +=
        `@keyframes sv${i}{0%,${pct(s - FADE)}%{opacity:0}` +
        `${pct(s)}%,${pct(e - FADE)}%{opacity:1}` +
        `${pct(Math.min(e, TOTAL - 0.01))}%,100%{opacity:0}}`;
    }
  }
  return css;
}

const BUCKETS = 72;
function eatCSS(prefix, slideIdx) {
  const s = slideIdx * SLIDE + LEAD_IN;
  let css = "";
  for (let b = 0; b < BUCKETS; b++) {
    const t = s + (b / BUCKETS) * PLAY;
    css +=
      `@keyframes ${prefix}${b}{0%,${pct(t)}%{opacity:1}` +
      `${pct(t + 0.18)}%,100%{opacity:0}}` +
      `.${prefix}${b}{animation-name:${prefix}${b}}`;
  }
  return css;
}

function travelCSS(name, slideIdx, parts, routeLen) {
  const s = slideIdx * SLIDE + LEAD_IN;
  let css = "";
  for (let k = 0; k < parts; k++) {
    const trail = (k * PLAY) / routeLen;   // each part lags one cell behind
    const a = clampPct(pct(s - trail));
    const b = clampPct(pct(s + PLAY - trail));
    css +=
      `@keyframes ${name}${k}{0%,${a}%{offset-distance:0%}` +
      `${b}%,100%{offset-distance:100%}}`;
  }
  return css;
}

// tetris drops land in scattered clusters instead of marching left to right
const TBUCKETS = 56;
function tetrisCSS(slideIdx) {
  const s = slideIdx * SLIDE + LEAD_IN;
  const span = PLAY * 0.88;
  const fall = 0.75;
  let css = "";
  for (let b = 0; b < TBUCKETS; b++) {
    const t = s + (b / TBUCKETS) * span;
    css +=
      `@keyframes tdr${b}{0%,${pct(t)}%{transform:translateY(-${PAD_T + GRID_H + 24}px);opacity:0}` +
      `${pct(t + 0.05)}%{opacity:1}` +
      `${pct(t + fall)}%,100%{transform:translateY(0);opacity:1}}` +
      `.tdr${b}{animation-name:tdr${b}}`;
  }
  return css;
}

/* --------------------------------------------------------------- rendering */
function render(grid, theme) {
  const t = THEMES[theme];

  const snakeRoute = wanderRoute(grid, makeRng(seedFrom(grid, 11)), Math.round(PLAY * SNAKE_CPS), 4);
  const pacRoute   = wanderRoute(grid, makeRng(seedFrom(grid, 29)), Math.round(PLAY * PAC_CPS), 3);
  const snakeSeen = firstVisits(snakeRoute);
  const pacSeen = firstVisits(pacRoute);

  /* --- static empty grid, shared by all three slides ------------------- */
  let base = "";
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++)
      base += `<rect x="${GX + c * P}" y="${GY + r * P}" width="${CELL}" height="${CELL}" rx="2.5" fill="${t.empty}"/>`;

  /* --- coloured commit cells; only the ones on the route get eaten ----- */
  const eatenCells = (seen, routeLen, prefix) => {
    let out = "";
    for (let c = 0; c < COLS; c++)
      for (let r = 0; r < ROWS; r++) {
        const lvl = grid[c][r];
        if (!lvl) continue;
        const i = seen.get(key(c, r));
        const cls =
          i === undefined
            ? ""                                  // never reached - stays on the board
            : ` cell ${prefix}${Math.min(BUCKETS - 1, Math.floor((i / routeLen) * BUCKETS))}`;
        out += `<rect class="${cls.trim()}" x="${GX + c * P}" y="${GY + r * P}" width="${CELL}" height="${CELL}" rx="2.5" fill="${t.levels[lvl]}"/>`;
      }
    return out;
  };

  /* --- slide 1: snake -------------------------------------------------- */
  let snakeParts = "";
  for (let k = 0; k < 5; k++) {
    const size = CELL + 2 - k * 1.1;
    const fill = k === 0 ? t.accent : t.levels[Math.max(1, 4 - k)];
    snakeParts +=
      `<rect class="mv snk${k}" x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}" rx="${k === 0 ? 3.5 : 2.5}" fill="${fill}" opacity="${1 - k * 0.13}"/>`;
  }

  const slide1 =
    `<g class="slide sv0">` +
    eatenCells(snakeSeen, snakeRoute.length, "se") +
    `<g class="snakepath">${snakeParts}</g>` +
    label(t, "snake.sh", "the snake hunts down commits, one detour at a time") +
    `</g>`;

  /* --- slide 2: pac-man ------------------------------------------------ */
  const jaw = (dir) =>
    `<path class="jaw jaw${dir > 0 ? "u" : "d"}" d="M0 0 L9 ${dir * 5.2} A9 9 0 ${dir > 0 ? "0 0" : "0 1"} 9 ${dir * -0.2} Z" fill="${t.pac}"/>`;

  const ghost = (color, k) =>
    `<g class="mv pcm${k}"><path d="M-6.5 5.5 v-6 a6.5 6.5 0 0 1 13 0 v6 l-2.2 -2 l-2.2 2 l-2.1 -2 l-2.2 2 l-2.2 -2 z" fill="${color}" opacity=".92"/>` +
    `<circle cx="-2.6" cy="-1.2" r="1.9" fill="${t.bg}"/><circle cx="2.6" cy="-1.2" r="1.9" fill="${t.bg}"/></g>`;

  const slide2 =
    `<g class="slide sv1">` +
    eatenCells(pacSeen, pacRoute.length, "pe") +
    `<g class="pacpath">` +
    ghost(t.ghost[1], 2) +
    ghost(t.ghost[0], 1) +
    `<g class="mv pcm0"><circle r="9" fill="${t.pac}"/>${jaw(1)}${jaw(-1)}</g>` +
    `</g>` +
    label(t, "pacman.sh", "Pac-Man roams the maze, ghosts trailing behind") +
    `</g>`;

  /* --- slide 3: tetris -------------------------------------------------- */
  const trng = makeRng(seedFrom(grid, 47));
  const live = new Set();
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++) if (grid[c][r]) live.add(key(c, r));

  // grow tetromino-sized clumps of adjacent commits, then drop the clumps in
  // random order, so the board fills from scattered places at once
  const groups = [];
  while (live.size) {
    const pool = [...live];
    const seed = pool[Math.floor(trng() * pool.length)];
    const g = [seed];
    live.delete(seed);
    const want = 2 + Math.floor(trng() * 3);          // 2-4 cells per piece
    while (g.length < want) {
      const cands = [];
      for (const k of g) {
        const c = Math.floor(k / ROWS), r = k % ROWS;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nc = c + dc, nr = r + dr;
          if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
          if (live.has(key(nc, nr))) cands.push(key(nc, nr));
        }
      }
      if (!cands.length) break;
      const pick = cands[Math.floor(trng() * cands.length)];
      g.push(pick);
      live.delete(pick);
    }
    groups.push(g);
  }
  for (let i = groups.length - 1; i > 0; i--) {
    const j = Math.floor(trng() * (i + 1));
    [groups[i], groups[j]] = [groups[j], groups[i]];
  }

  let tetris = "";
  groups.forEach((g, gi) => {
    const b = Math.min(TBUCKETS - 1, Math.floor((gi / groups.length) * TBUCKETS));
    for (const k of g) {
      const c = Math.floor(k / ROWS), r = k % ROWS;
      tetris += `<rect class="cell tdr${b}" x="${GX + c * P}" y="${GY + r * P}" width="${CELL}" height="${CELL}" rx="2.5" fill="${t.levels[grid[c][r]]}" stroke="${t.bg}" stroke-width=".7"/>`;
    }
  });

  const slide3 =
    `<g class="slide sv2">` +
    `<g clip-path="url(#board)">${tetris}</g>` +
    label(t, "tetris.sh", "commits rain down in clusters until the board is full") +
    `</g>`;

  /* --- carousel chrome -------------------------------------------------- */
  const midY = GY + GRID_H / 2;
  const arrow = (dirX, x) =>
    `<g class="arrow"><circle cx="${x}" cy="${midY}" r="15" fill="${t.panel}" stroke="${t.frame}" stroke-width="1.2"/>` +
    `<path d="M${x + dirX * 4.5} ${midY - 6} L${x - dirX * 3.5} ${midY} L${x + dirX * 4.5} ${midY + 6}" fill="none" stroke="${t.accent}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>`;

  const dotsY = GY + GRID_H + 30;
  let dots = "";
  for (let i = 0; i < SLIDES; i++) {
    const dx = W / 2 + (i - 1) * 18;
    dots += `<circle cx="${dx}" cy="${dotsY}" r="3.2" fill="${t.frame}"/>`;
    dots += `<circle class="slide sv${i}" cx="${dx}" cy="${dotsY}" r="4.6" fill="${t.accent}"/>`;
  }

  const barW = 150;
  const bar =
    `<rect x="${W / 2 - barW / 2}" y="${dotsY + 12}" width="${barW}" height="2.5" rx="1.25" fill="${t.frame}" opacity=".45"/>` +
    `<rect class="prog" x="${W / 2 - barW / 2}" y="${dotsY + 12}" width="${barW}" height="2.5" rx="1.25" fill="${t.accent}"/>`;

  /* --- css -------------------------------------------------------------- */
  const css = `
    .slide,.cell,.mv,.prog{animation-duration:${TOTAL}s;animation-iteration-count:infinite;animation-timing-function:linear}
    .slide{opacity:0}
    .sv0{animation-name:sv0}.sv1{animation-name:sv1}.sv2{animation-name:sv2}
    .mv{offset-rotate:auto;offset-distance:0%}
    .snakepath .mv{offset-path:path("${toPathD(snakeRoute)}");offset-rotate:0deg}
    .pacpath .mv{offset-path:path("${toPathD(pacRoute)}")}
    .snk0{animation-name:snk0}.snk1{animation-name:snk1}.snk2{animation-name:snk2}
    .snk3{animation-name:snk3}.snk4{animation-name:snk4}
    .pcm0{animation-name:pcm0}.pcm1{animation-name:pcm1}.pcm2{animation-name:pcm2}
    .jaw{animation:chomp .42s ease-in-out infinite;transform-origin:0 0}
    .jawu{animation-name:chompU}.jawd{animation-name:chompD}
    @keyframes chompU{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-32deg)}}
    @keyframes chompD{0%,100%{transform:rotate(0deg)}50%{transform:rotate(32deg)}}
    .prog{transform-origin:${W / 2 - barW / 2}px 0;animation-name:prog}
    @keyframes prog{0%{transform:scaleX(0)}33.32%{transform:scaleX(1)}33.34%{transform:scaleX(0)}
      66.65%{transform:scaleX(1)}66.67%{transform:scaleX(0)}100%{transform:scaleX(1)}}
    .arrow{animation:pulse ${SLIDE}s ease-in-out infinite}
    @keyframes pulse{0%,80%{opacity:.55}91%{opacity:1}100%{opacity:.55}}
    .ttl{font:700 17px "Cascadia Code","JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;fill:${t.accent}}
    .sub{font:400 11.5px "Cascadia Code","JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;fill:${t.muted}}
    .hint{font:400 10px "Cascadia Code",ui-monospace,monospace;fill:${t.muted}}
    ${slideVisibilityCSS()}
    ${eatCSS("se", 0)}
    ${eatCSS("pe", 1)}
    ${travelCSS("snk", 0, 5, snakeRoute.length)}
    ${travelCSS("pcm", 1, 3, pacRoute.length)}
    ${tetrisCSS(2)}
    @media (prefers-reduced-motion:reduce){
      .slide,.cell,.mv,.prog,.jaw,.arrow{animation:none}
      .sv0{opacity:1}.cell{opacity:1}
    }
  `.replace(/\s*\n\s*/g, "");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Animated arcade carousel of my GitHub contribution graph: snake, Pac-Man and Tetris">
<style>${css}</style>
<clipPath id="board"><rect x="8" y="${GY - 8}" width="${W - 16}" height="${GRID_H + 16}" rx="7"/></clipPath>
<rect width="${W}" height="${H}" rx="14" fill="${t.bg}"/>
<rect x=".75" y=".75" width="${W - 1.5}" height="${H - 1.5}" rx="13.5" fill="none" stroke="${t.frame}" stroke-width="1.5" opacity=".55"/>
${base}
${slide1}${slide2}${slide3}
${arrow(1, 26)}${arrow(-1, W - 26)}
${dots}${bar}
<text class="hint" x="${W - 20}" y="${H - 14}" text-anchor="end">auto-advancing every ${SLIDE}s</text>
</svg>`;
}

function label(t, title, sub) {
  return (
    `<text class="ttl" x="${GX}" y="${28}">&gt; ./play ${title}</text>` +
    `<text class="sub" x="${GX}" y="${45}">${sub}</text>`
  );
}

/* ================================================================= *
 *  spiderman.sh  -  a standalone panel, not a carousel slide
 * ----------------------------------------------------------------- *
 *  The contribution grid is read as a building facade: every commit
 *  is a lit window with somebody in it. A web-slinger works the
 *  facade in passes until he has pulled every last one out.
 *
 *  Every leg starts at the back apex of a swing and ends at the front
 *  apex of the same swing, which is the whole reason the run does not
 *  stutter: at an apex the angular velocity is zero, so handing over
 *  to the next web there breaks neither position nor velocity. Release
 *  anywhere else and the anchor jumps while he still has speed, which
 *  the eye reads as a teleport.
 *
 *  A leg is (row, ain, aout). The row fixes where the arc bottoms out;
 *  ain is how far behind he grabs; aout how far ahead he lets go. The
 *  web length then follows from having to start exactly where the last
 *  leg ended:
 *
 *      L      = (rowY - releaseY) / (1 - cos(ain))
 *      anchor = (releaseX + L*sin(ain), rowY - L)
 *
 *  so the geometry is solved, never approximated - and he only ever
 *  travels left to right, one web at a time, alternating hands.
 *
 *      <g .wa>   translate(anchor)
 *        <g .wr>   rotate(theta)      - pendulum, integrated not eased
 *          <g .wl>   scale(1, L)      - the web, thwips out of his hand
 *          <g .wh>   translateY(L)
 *            <g .wsp>  rotate(spin)   - the somersault he exits on
 *
 *  Still pure CSS keyframes - GitHub strips <script>.
 * ================================================================= */

/* ---------------------------------------------------------- geometry */
const SP_PAD_T = 112;                // headroom for the web he throws people into
const SP_PAD_B = 60;
const SGY = SP_PAD_T;
const SP_H = SP_PAD_T + GRID_H + SP_PAD_B;
const scy = (r) => SGY + r * P + CELL / 2;

/* ---------------------------------------------------------------- net */
const NET_X = W - 96;
const NET_Y = 58;
const NET_R = 44;

/* ------------------------------------------------------------ timing */
/**
 * Tempo is set per swing, not per loop.
 *
 * SWING_T is the dial: how long an average swing takes. Everything else -
 * including how long the whole panel runs - is derived from it once the route
 * is known, so a sparser contribution year plans fewer legs and simply loops
 * sooner instead of speeding him up. Fixing the loop length and dividing it
 * by the leg count is what makes the tempo drift with the data.
 */
const SWING_T = 0.86;                // seconds for the average swing ITSELF
const E0 = 0.22;                     // energy left at the apex: he never quite stops
const FLY_FRAC = 0.3;                // share of a cycle spent off the web
const W_REF = 10.4;                  // a typical leg weight, so the dial lands where it says
const SP_IN = 0.6;                   // beat before he drops into frame
const SP_GAP = 0.42;                 // he is off the panel between passes
const HOLD_T = 3.6;                  // upside down by the web at the end
const SP_TAIL = 0.8;                 // and a breath on the empty facade

// filled in by legTiming(), which is the only thing that knows the route
let SP_TOTAL = 30;
let SP_PLAY = 26;
const spct = (t) => +((t / SP_TOTAL) * 100).toFixed(3);

/* -------------------------------------------------------------- swing */
const REACH = 19;                    // how close he passes to grab someone
const AIN = [20, 26, 32, 38, 44, 50];        // how far behind he grabs on
const AOUT = [22, 28, 34, 40, 46];           // how far ahead he lets go
const L_MIN = 70;
const L_MAX = 148;
const ANCHOR_MIN_Y = -155;           // webs may leave the frame, but not absurdly
const ARC_STEPS = 34;
const ROT_KF = 8;
const LEG_MAX = 60;
const PASS_MAX = 16;
const SP_BUCKETS = 128;
const HUD_STEPS = 22;

const rad = (d) => (d * Math.PI) / 180;

// Angles here are measured so that positive is AHEAD of the anchor - he grabs
// on at -ain, behind himself, and lets go at +aout, in front. CSS rotate()
// turns the other way (clockwise, screen axes), so every angle is negated on
// the way into a keyframe and nowhere else. Getting this backwards is what
// makes a swing travel the wrong way while the anchors still march forward,
// which reads as him snapping ahead at the end of every leg.
const legPos = (g, th) => [g.ax + g.L * Math.sin(rad(th)), g.ay + g.L * Math.cos(rad(th))];
const cssDeg = (a) => (-a).toFixed(2);

/**
 * theta(t) for one leg, straight off the pendulum.
 *
 * Energy conservation gives omega proportional to sqrt(cos t - cos tmax), so
 * integrating dt = dtheta/omega across the arc and reading it back at equal
 * time steps yields the angles to hang keyframes on. tmax sits just outside
 * the arc so he slows almost to a stop at each apex without stalling - which
 * is exactly the beat between one web and the next.
 */
/**
 * Angular speed on the rope, normalised.
 *
 * Conservation of energy on a pendulum grabbed at -ain: v^2 goes with
 * (E0 + cos t - cos ain). E0 is what he carries into the grab, and it is what
 * stops him hanging motionless at either apex - with E0 = 0 the arc stalls at
 * both ends and the run reads as a series of separate lunges rather than one
 * continuous swing. It also caps how high he can get: he cannot reach an angle
 * where the bracket would go negative, which is why the planner has to check.
 */
const omega = (th, ain) =>
  Math.sqrt(Math.max(4e-3, E0 + Math.cos(rad(th)) - Math.cos(rad(ain))));

const reachable = (ain, aout) => E0 + Math.cos(rad(aout)) - Math.cos(rad(ain)) > 0.02;

/**
 * theta(t) across one swing, plus the constant that turns it into real speed.
 *
 * Integrating dt = dtheta/omega and reading the result back at equal time steps
 * gives the angles to hang keyframes on. tnorm - the integral - is also what
 * converts the shape into physics: with the swing lasting d seconds, the rope's
 * angular speed is omega * tnorm/d, so the launch speed and the gravity implied
 * by the swing both fall out of the same number. The flight that follows is
 * then in the same world as the swing that threw him, instead of being a
 * second animation with its own made-up constants.
 */
function pendulumProfile(ain, aout, n) {
  const STEPS = 180;
  const dth = (ain + aout) / STEPS;
  const ts = [0];
  for (let i = 0; i < STEPS; i++)
    ts.push(ts[i] + dth / omega(-ain + dth * (i + 0.5), ain));
  const T = ts[STEPS];
  const keys = [];
  for (let k = 0; k <= n; k++) {
    const want = (k / n) * T;
    let i = 0;
    while (i < STEPS - 1 && ts[i + 1] < want) i++;
    const f = (want - ts[i]) / (ts[i + 1] - ts[i] || 1);
    keys.push([k / n, -ain + dth * (i + f)]);
  }
  return { keys, tnorm: T };
}

const legWeight = (L, ain, aout) => Math.max(7, Math.sqrt(L) * ((ain + aout) / 76));
// SWING_T times how the arc compares to a typical one, then grossed up for the
// fall that follows - so the dial keeps meaning "how long a swing takes to
// watch" no matter how much of each cycle is spent off the web
const legDur = (l) =>
  ((legWeight(l.L, l.ain, l.aout) / W_REF) * SWING_T) / (1 - FLY_FRAC);

/**
 * What happens after he lets go.
 *
 * He leaves the rope along the tangent, so the launch direction is fixed by the
 * release angle, and the speed and gravity both come from the swing itself. From
 * there it is a plain projectile: he rises, gravity takes it back, and he is
 * already falling when the next web goes out - which is the bit that was missing
 * when the new rope simply appeared at the old one's apex.
 */
function flight(l) {
  const d = legDur(l);
  const ds = d * (1 - FLY_FRAC);
  const df = d * FLY_FRAC;
  const K = ((pendulumProfile(l.ain, l.aout, 1).tnorm / ds) * Math.PI) / 180;
  const v = l.L * omega(l.aout, l.ain) * K;
  const g = (l.L * K * K) / 2;
  const vx = v * Math.cos(rad(l.aout));
  const vy = -v * Math.sin(rad(l.aout));
  const at = (t) => [vx * t, vy * t + 0.5 * g * t * t];
  return { ds, df, g, v, at, end: at(df) };
}

// who this arc passes close enough to grab, and how far through the leg
function sweep(g, left, byTime) {
  const keys = byTime ? pendulumProfile(g.ain, g.aout, ARC_STEPS).keys : null;
  const hit = new Map();
  for (let i = 0; i <= ARC_STEPS; i++) {
    const p = i / ARC_STEPS;
    const th = keys ? keys[i][1] : -g.ain + (g.ain + g.aout) * p;
    const [x, y] = legPos(g, th);
    const c0 = Math.round((x - GX - CELL / 2) / P);
    const r0 = Math.round((y - SGY - CELL / 2) / P);
    for (let dc = -1; dc <= 1; dc++)
      for (let dr = -1; dr <= 1; dr++) {
        const c = c0 + dc;
        const r = r0 + dr;
        if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
        const k = key(c, r);
        if (!left.has(k) || hit.has(k)) continue;
        if (Math.hypot(cx(c) - x, scy(r) - y) <= REACH) hit.set(k, p);
      }
  }
  return hit;
}

/**
 * Plan the run as a series of left-to-right passes.
 *
 * One pass cannot reach every row - a downward arc can only bottom out below
 * where it was grabbed - so he works the facade in sweeps, leaves the frame on
 * the right and comes back in on the left for the next one. Each pass goes
 * where the lit windows still are, and the run only ends when there are none.
 */
function planRoute(grid, rng) {
  const left = new Map();
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++)
      if (grid[c][r]) left.set(key(c, r), { c, r, x: cx(c), y: scy(r) });

  const legs = [];
  const RIGHT = GX + GRID_W + 18;

  for (let pass = 0; pass < PASS_MAX && left.size && legs.length < LEG_MAX; pass++) {
    let prev = null;
    let steps = 0;
    let dry = 0;
    // come back in just ahead of whatever is still lit, so a late pass is not
    // spent swinging across a facade he has already emptied
    const entry = Math.max(GX - 14, Math.min(...[...left.values()].map((c) => c.x)) - 52);

    while (steps++ < 16 && legs.length < LEG_MAX) {
      let best = null;

      for (let row = 0; row < ROWS; row++) {
        const rowY = scy(row);
        for (const ain of AIN) {
          let L;
          let ax;
          if (prev) {
            const [px, py] = legPos(prev, prev.aout);
            const f = flight(prev);
            const rx = px + f.end[0];
            const ry = py + f.end[1];
            const drop = rowY - ry;
            if (drop < 3) continue;                       // an arc cannot climb to its own floor
            L = drop / (1 - Math.cos(rad(ain)));
            ax = rx + L * Math.sin(rad(ain));
          } else {
            L = L_MIN + rng() * (L_MAX - L_MIN);          // entering: pick a length freely
            ax = entry + L * Math.sin(rad(ain));
          }
          if (L < L_MIN || L > L_MAX) continue;
          const ay = rowY - L;
          if (ay < ANCHOR_MIN_Y) continue;

          for (const aout of AOUT) {
            if (!reachable(ain, aout)) continue;      // no energy to get that high
            const g = { ax, ay, L, ain, aout, row };
            const hit = sweep(g, left, false);
            const [rx2, ry2] = legPos(g, aout);
            // people he actually reaches count for everything; a weak pull
            // toward the ones he does not steers the late clean-up passes,
            // and the step penalty buys more, tighter swings per pass
            let pull = 0;
            for (const c2 of left.values())
              if (Math.abs(c2.x - rx2) < 90 && Math.abs(c2.y - ry2) < 60) pull++;
            const score = hit.size * 14 + pull * 0.35 - (rx2 - ax) * 0.045 + rng() * 4;
            if (!best || score > best.score) best = { g, hit, score, rx2 };
          }
        }
      }

      if (!best) break;
      const g = best.g;
      g.hit = sweep(g, left, true);
      g.pass = pass;
      g.hand = legs.length % 2;
      for (const k of g.hit.keys()) left.delete(k);
      // exits get the showy one; the rest take pot luck from the library
      g.air = g.exit ? 3 : Math.floor(rng() * AERIALS.length);
      legs.push(g);
      prev = g;
      if (best.rx2 > RIGHT) break;                        // off the right edge: pass over
      // Two empty swings in a row means this line is spent - break off and come
      // back in somewhere useful rather than ride out an emptied facade. Once
      // it is down to the last stragglers give him more rope, because those
      // take a couple of dry swings to line up and there is nothing else left
      // to do with the time.
      dry = g.hit.size ? 0 : dry + 1;
      if (dry >= (left.size > 15 ? 2 : 4)) break;
      if (![...left.values()].some((c) => c.x > best.rx2 - 30)) break;
    }

    if (!prev) break;                                     // nothing feasible, stop cleanly
    legs[legs.length - 1].exit = true;
  }

  // Curtain call: one more swing, judged on where it PARKS him rather than on
  // who it saves, so he finishes hanging just under the web with everyone he
  // pulled off the facade.
  const last = legs[legs.length - 1];
  last.exit = false;
  let approach = null;
  const lf = flight(last);
  const [lx0, ly0] = legPos(last, last.aout);
  const lx = lx0 + lf.end[0];
  const ly = ly0 + lf.end[1];
  for (let row = 0; row < ROWS; row++) {
    const rowY = scy(row);
    for (const ain of AIN) {
      const drop = rowY - ly;
      if (drop < 3) continue;
      const L = drop / (1 - Math.cos(rad(ain)));
      // this one carries no rescues, so let it be a long lazy traverse if that
      // is what it takes to put him under the web
      if (L < L_MIN || L > 250) continue;
      const ay = rowY - L;
      if (ay < ANCHOR_MIN_Y - 90) continue;
      // The run always ends wherever the last pass dropped him, and every other
      // leg puts its anchor AHEAD - so from the right edge there is no way back
      // and the bow ends up half behind the panel border. The closing swing is
      // the one place he may go the other way: anchor behind him, swinging back
      // toward the middle. Mirroring is free, because a backward swing is just
      // the forward profile with every angle negated.
      for (const back of [false, true]) {
        const ax = lx + (back ? -1 : 1) * L * Math.sin(rad(ain));
        for (const aout of AOUT) {
          if (!reachable(ain, aout)) continue;
          const g = { ax, ay, L, ain, aout, row, back };
          // he settles at the BOTTOM of this arc, not at the apex he stops on,
          // so that is the point to park near the web
          const rest = back ? ax - L * Math.sin(rad(aout)) : ax + L * Math.sin(rad(aout));
          const off = Math.max(0, ax - (W - 66)) + Math.max(0, GX + 34 - ax) +
                      Math.max(0, rest - (W - 30)) + Math.max(0, GX - rest);
          const cost = Math.hypot(ax - (NET_X - 18), ay + L - (NET_Y + 108)) + off * 40;
          if (!approach || cost < approach.cost) approach = { g, cost };
        }
      }
    }
  }
  if (approach) {
    const g = approach.g;
    g.hit = new Map();
    g.pass = last.pass;
    g.hand = legs.length % 2;
    g.air = 0;
    legs.push(g);
  }
  legs[legs.length - 1].bow = true;                       // the hold hangs off this one
  return legs;
}

// a pendulum's period goes with sqrt(L), and a leg is the slice of it the arc
// actually covers - so short whips stay snappy and long sags take their time
function legTiming(legs) {
  // A pendulum's period goes with sqrt(L) and a leg is the slice of it the arc
  // covers, so long sags take their time and short whips stay snappy; the floor
  // keeps a clean-up swing from flicking past unread. This has to be the same
  // formula the planner used, because the planner needed each leg's duration to
  // work out how far the fall after it carries him.
  const dur = legs.map(legDur);
  const swing = legs.map((l, k) => (l.bow ? dur[k] : dur[k] * (1 - FLY_FRAC)));

  const start = [];
  let acc = SP_IN;
  legs.forEach((l, k) => {
    start.push(acc);
    acc += dur[k];
    if (l.exit && k < legs.length - 1) acc += SP_GAP;
  });

  SP_PLAY = acc - SP_IN;
  SP_TOTAL = +(SP_IN + SP_PLAY + HOLD_T + SP_TAIL).toFixed(2);
  return { dur, swing, start };
}

/**
 * What he does with the airborne half of a cycle.
 *
 * `turns` is the only thing a move really chooses. Where it has to FINISH is
 * fixed by continuity: he leaves the old rope leaning aout forward and has to
 * meet the new one leaning ain back, so the tumble has to cover that difference
 * on top of its whole turns. Ending on a tidy 360 instead leaves the body
 * snapping through seventy-odd degrees the instant the next web catches - the
 * position is continuous either way, which is exactly what makes it easy to
 * miss. `turns: 0` is then not "no move" but a plain arch into the next rope.
 */
const AERIALS = [
  { turns: 1, ease: (p) => p, tuck: 0 },                       // front flip
  { turns: 1, ease: (p) => p, tuck: 0.22 },                    // tucked
  { turns: -1, ease: (p) => p, tuck: 0 },                      // back flip
  { turns: 2, ease: (p) => p, tuck: 0.18 },                    // double
  { turns: 1, ease: (p) => p * p * (3 - 2 * p), tuck: 0 },     // lazy layout
  { turns: 0, ease: (p) => p * p * (3 - 2 * p), tuck: 0.1 },   // no flip, just an arch
];
const AIR_STEPS = 5;

/* --------------------------------------------------------------- css */
function rigCSS(legs, timing) {
  const n = legs.length;
  // Half a millisecond. Everything the rig owns changes at a handover, and CSS
  // has to ramp between two keyframes rather than cut, so for the width of this
  // window the composite is briefly nonsense. Keeping it well under a frame is
  // what stops that ever being drawn.
  const EPS = 0.0012;
  const f = (v) => v.toFixed(2);
  const at = (t) => `${spct(t)}%`;
  const bump = (t) => `${(spct(t) + EPS).toFixed(3)}%`;

  let anc = "", rot = "", len = "", hero = "", spin = "", web = "", fig = "", arm = "", fly = "";
  // Whole turns done so far. The body angle is .wr plus .wsp, and at a handover
  // both jump in the same instant - .wr forward by the lean, .wsp back by it -
  // so they cancel. They only cancel at the endpoints though: if .wsp were reset
  // to zero each leg the pair would also have to unwind the whole turns, and for
  // the millisecond the two keyframes blend across, the body would whip through a
  // full revolution. Carrying the turns forward means the only thing that ever
  // has to cancel is the lean, and nothing is left to unwind.
  let base = 0;
  const hnd = ["", ""];

  legs.forEach((g, k) => {
    const s = timing.start[k];
    const d = timing.dur[k];
    const ds = timing.swing[k];
    const rel = s + ds;                           // the moment he lets go
    const e = s + d;
    const head = k === 0 ? `0%,${at(s)}` : bump(s);
    const thwip = s + ds * 0.16;
    const air = g.bow ? null : flight(g);

    // the rope's anchor and length are frozen for the whole cycle - during the
    // fall nothing of the rig is on screen anyway, and .wfly carries him
    anc += `${head}{transform:translate(${f(g.ax)}px,${f(g.ay)}px)}${at(e)}{transform:translate(${f(g.ax)}px,${f(g.ay)}px)}`;
    hero += `${head}{transform:translateY(${f(g.L)}px)}${at(e)}{transform:translateY(${f(g.L)}px)}`;

    const sgn = g.back ? -1 : 1;
    pendulumProfile(g.ain, g.aout, ROT_KF).keys.forEach(([p, a], i) => {
      rot += `${i === 0 ? head : at(s + p * ds)}{transform:rotate(${cssDeg(sgn * a)}deg)}`;
    });
    if (!g.bow) rot += `${at(e)}{transform:rotate(${cssDeg(sgn * g.aout)}deg)}`;

    // the web shoots out of the free hand, and is let go of at the release
    len += `${head}{transform:scale(1,0)}${at(thwip)}{transform:scale(1,${f(g.L)})}${at(e)}{transform:scale(1,${f(g.L)})}`;
    web += `${head}{opacity:0}${at(thwip)}{opacity:1}` +
           (g.bow ? `${at(e)}{opacity:1}`
                  : `${at(rel)}{opacity:1}${at(rel + d * 0.05)}{opacity:0}${at(e)}{opacity:0}`);

    // the fall: a plain projectile, sampled so the CSS follows the parabola
    // rather than cutting the corner across it
    fly += `${head}{transform:none}${at(rel)}{transform:none}`;
    if (air) {
      for (let i = 1; i <= AIR_STEPS; i++) {
        const [dx, dy] = air.at((i / AIR_STEPS) * air.df);
        fly += `${at(rel + (i / AIR_STEPS) * (e - rel))}{transform:translate(${f(dx)}px,${f(dy)}px)}`;
      }
    } else fly += `${at(e)}{transform:none}`;

    // he is on the panel for the whole cycle, and tumbles off it at a pass end
    fig += `${head}{opacity:0}${at(s + ds * 0.1)}{opacity:1}` +
           (g.exit && k < n - 1 ? `${at(e - d * 0.16)}{opacity:1}${at(e)}{opacity:0}` : `${at(e)}{opacity:1}`);

    // and something different in the air each time, landing on the orientation
    // the next rope needs so nothing snaps when it catches
    spin += `${head}{transform:rotate(${f(base)}deg)}${at(rel)}{transform:rotate(${f(base)}deg)}`;
    if (air) {
      const mv = AERIALS[g.air];
      const next = legs[k + 1];
      const lean = g.exit || !next ? 0 : next.ain + g.aout;
      const total = 360 * mv.turns + lean;
      for (let i = 1; i <= AIR_STEPS; i++) {
        const p = i / AIR_STEPS;
        const sc = 1 - mv.tuck * Math.sin(Math.PI * p);
        spin += `${at(rel + p * (e - rel))}{transform:rotate(${f(base + total * mv.ease(p))}deg) scale(${sc.toFixed(3)})}`;
      }
      base += 360 * mv.turns;
    } else spin += `${at(e)}{transform:rotate(${f(base)}deg)}`;

    arm += `${head}{transform:rotate(0deg)}${at(e)}{transform:rotate(0deg)}`;

    // alternating hands: one pose grips and trails, the other has just fired
    for (const v of [0, 1])
      hnd[v] += `${head}{opacity:${g.hand === v ? 1 : 0}}${at(e)}{opacity:${g.hand === v ? 1 : 0}}`;
  });

  /* --- the bow: he turns upside down on the last web and waves ---------- */
  const last0 = legs[n - 1];
  const hs = timing.start[n - 1] + timing.dur[n - 1];
  const flip = hs + 0.95;                                  // done turning over
  const wave0 = flip + 0.55;
  anc += `${at(hs + HOLD_T)}{transform:translate(${f(last0.ax)}px,${f(last0.ay)}px)}`;
  // still on the web at the apex, so he swings back down and rings out under
  // the anchor before settling - a dead stop mid-arc would look pinned
  const bowOut = (last0.back ? -1 : 1) * last0.aout;
  rot += `${at(hs + 0.62)}{transform:rotate(${cssDeg(-bowOut * 0.34)}deg)}` +
         `${at(hs + 1.1)}{transform:rotate(${cssDeg(bowOut * 0.13)}deg)}` +
         `${at(hs + 1.5)}{transform:rotate(0deg)}` +
         `${at(hs + HOLD_T)}{transform:rotate(0deg)}`;
  len += `${at(hs + HOLD_T)}{transform:scale(1,${f(last0.L)})}`;
  hero += `${at(hs + HOLD_T)}{transform:translateY(${f(last0.L)}px)}`;
  web += `${at(hs + HOLD_T)}{opacity:1}`;
  fig += `${at(hs + HOLD_T)}{opacity:1}`;
  fly += `${at(hs + HOLD_T)}{transform:none}`;
  spin += `${at(hs + 0.3)}{transform:rotate(${f(base)}deg)}${at(flip)}{transform:rotate(${f(base + 180)}deg)}` +
          `${at(hs + HOLD_T)}{transform:rotate(${f(base + 180)}deg)}`;
  arm += `${at(wave0)}{transform:rotate(0deg)}`;
  for (let i = 0; i < 4; i++) {
    arm += `${at(wave0 + 0.2 + i * 0.4)}{transform:rotate(-46deg)}` +
           `${at(wave0 + 0.4 + i * 0.4)}{transform:rotate(14deg)}`;
  }
  arm += `${at(hs + HOLD_T)}{transform:rotate(0deg)}`;
  for (const v of [0, 1]) hnd[v] += `${at(hs + HOLD_T)}{opacity:${last0.hand === v ? 1 : 0}}`;

  anc += `100%{transform:translate(${f(last0.ax)}px,${f(last0.ay)}px)}`;
  rot += `100%{transform:rotate(0deg)}`;
  len += `100%{transform:scale(1,${f(last0.L)})}`;
  hero += `100%{transform:translateY(${f(last0.L)}px)}`;
  spin += `100%{transform:rotate(${f(base + 180)}deg)}`;
  web += `100%{opacity:1}`;
  fig += `100%{opacity:1}`;
  arm += `100%{transform:rotate(0deg)}`;
  fly += `100%{transform:none}`;
  for (const v of [0, 1]) hnd[v] += `100%{opacity:${last0.hand === v ? 1 : 0}}`;

  return `@keyframes wanc{${anc}}@keyframes wrot{${rot}}@keyframes wlen{${len}}` +
    `@keyframes whero{${hero}}@keyframes wspin{${spin}}@keyframes wweb{${web}}` +
    `@keyframes wfig{${fig}}@keyframes warm{${arm}}@keyframes wfly{${fly}}` +
    `@keyframes hnd0{${hnd[0]}}@keyframes hnd1{${hnd[1]}}`;
}

/**
 * One throw per commit.
 *
 * He snatches the whole lit window off the facade and lobs it into the web in
 * the corner, where it stays - so the counter is not the only thing telling
 * you how far along he is, the web itself fills up. The mid-flight keyframe
 * sits above the straight line between the two so it reads as a throw rather
 * than a slide. Each commit needs its own delta, so this is one keyframes
 * block per commit; it is the biggest thing in the file and worth it.
 */
function throwCSS(i, t, dx, dy) {
  const r = (v) => Math.round(v);
  const land = `translate(${r(dx)}px,${r(dy)}px) scale(.3)`;
  return (
    `@keyframes f${i}{0%,${spct(t)}%{transform:none;opacity:1}` +
    `${spct(t + 0.11)}%{transform:translateY(-6px) scale(1.32)}` +
    `${spct(t + 0.34)}%{transform:translate(${r(dx * 0.52)}px,${r(dy * 0.52 - 26)}px) scale(.72)}` +
    `${spct(t + 0.62)}%{transform:${land};opacity:1}` +
    `${spct(t + 0.72)}%,100%{transform:${land};opacity:.5}}` +
    `.f${i}{animation-name:f${i}}`
  );
}

// the web in the corner: spokes out from the middle, straight runs between
// them for the spiral, and a few guy lines out to the panel edge
function netSVG(t) {
  const N = 9;
  const pt = (i, k) => {
    const a = ((i % N) / N) * Math.PI * 2 - Math.PI / 2;
    return [NET_X + Math.cos(a) * NET_R * k, NET_Y + Math.sin(a) * NET_R * k];
  };
  let d = "";
  for (let i = 0; i < N; i++) {
    const [x, y] = pt(i, 1);
    d += `M${NET_X.toFixed(1)} ${NET_Y.toFixed(1)}L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  for (let k = 0.3; k < 1.02; k += 0.235)
    for (let i = 0; i <= N; i++) {
      const [x, y] = pt(i, k);
      d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  const guy =
    `M${NET_X} ${NET_Y - NET_R}L${NET_X - 12} 0M${NET_X} ${NET_Y - NET_R}L${NET_X + 30} 0` +
    `M${NET_X + NET_R} ${NET_Y}L${W} ${NET_Y - 18}M${NET_X + NET_R} ${NET_Y}L${W} ${NET_Y + 26}`;
  return (
    `<g opacity=".72"><path d="${guy}" fill="none" stroke="${t.web}" stroke-width=".9" opacity=".45"/>` +
    `<path d="${d}" fill="none" stroke="${t.web}" stroke-width="1.05" stroke-linejoin="round" opacity=".6"/></g>`
  );
}

// relative luminance, so a civilian is dark on a bright window and light on a
// dark one - the level ramp runs opposite ways in the two themes
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/* --------------------------------------------------------- the hero */
// ~24px from grip to boot, local origin at the gripping hand so he leans into
// every swing for free. Two poses: `free` is the arm that is NOT on the web -
// trailing on one leg, still out from firing on the next.
function figure(t, v) {
  const freeArm =
    `<g class="warm">` +
    (v === 0
      ? `<path d="M1.6 9 L-4.6 13.2" stroke="${t.suitDark}" stroke-width="2.3" stroke-linecap="round" fill="none"/>`
      : `<path d="M1.6 9 L8.2 4.6" stroke="${t.suitDark}" stroke-width="2.3" stroke-linecap="round" fill="none"/>`) +
    `</g>`;
  const legs =
    v === 0
      ? `<path d="M2.7 17.2 L-1.4 20.3 L-5.8 22.4" stroke="${t.tightsDark}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
        `<path d="M2.7 17.2 L6.7 19.4 L5.4 24" stroke="${t.tights}" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
      : `<path d="M2.7 17.2 L-2.2 19.2 L-6.4 21.6" stroke="${t.tightsDark}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
        `<path d="M2.7 17.2 L5.2 21.2 L2.6 24.6" stroke="${t.tights}" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  return (
    `<g class="h${v}">` +
    freeArm +
    `<path d="M0 0 L1.6 9" stroke="${t.suit}" stroke-width="2.4" stroke-linecap="round" fill="none"/>` +
    `<g class="kick">${legs}</g>` +
    `<path d="M1.6 9 L2.3 13.6" stroke="${t.suit}" stroke-width="5.2" stroke-linecap="round" fill="none"/>` +
    `<path d="M2.3 13.6 L2.7 17.2" stroke="${t.tights}" stroke-width="4.8" stroke-linecap="round" fill="none"/>` +
    `<circle cx="3.9" cy="7.4" r="2.9" fill="${t.suit}"/>` +
    `<path d="M6.2 5.9 L4.0 6.7 L4.6 8.3 L6.5 7.5 Z" fill="${t.lens}"/>` +
    `<path d="M3.4 6.9 L1.9 7.4 L2.4 8.8 L3.8 8.2 Z" fill="${t.lens}" opacity=".8"/>` +
    `</g>`
  );
}

/* ------------------------------------------------------------- panel */
function renderSwing(grid, theme) {
  const t = THEMES[theme];
  const legs = planRoute(grid, makeRng(seedFrom(grid, 83)));
  const timing = legTiming(legs);

  const seen = new Map();
  legs.forEach((g, k) => {
    for (const [k2, p] of g.hit) seen.set(k2, timing.start[k] + p * timing.swing[k]);
  });

  let total = 0;
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (grid[c][r]) total++;

  let base = "";
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++)
      base += `<rect x="${GX + c * P}" y="${SGY + r * P}" width="${CELL}" height="${CELL}" rx="2.5" fill="${t.empty}"/>`;

  const nrng = makeRng(seedFrom(grid, 131));
  let windows = "";
  let throwCss = "";
  let idx = 0;
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++) {
      const lvl = grid[c][r];
      if (!lvl) continue;
      const x = GX + c * P;
      const y = SGY + r * P;
      const civ = lum(t.levels[lvl]) > 0.42 ? t.civDark : t.civLight;
      const caught = seen.get(key(c, r));
      let cls = "";
      if (caught !== undefined) {
        // scatter the landings over the web so they read as a bundle of people
        // caught in it rather than a single stacked blob
        const a = nrng() * Math.PI * 2;
        const k = Math.sqrt(nrng()) * (NET_R - 8);
        cls = ` class="cell f${idx}"`;
        throwCss += throwCSS(idx, caught, NET_X + Math.cos(a) * k - (x + 6), NET_Y + Math.sin(a) * k - (y + 6));
        idx++;
      }
      windows +=
        `<g${cls} style="transform-origin:${x + 6}px ${y + 6}px">` +
        `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${t.levels[lvl]}"/>` +
        `<circle cx="${x + 6}" cy="${y + 4}" r="1.45" fill="${civ}" opacity=".66"/>` +
        `<path d="M${x + 3.7} ${y + 5.6} L${x + 6} ${y + 7.2} L${x + 8.3} ${y + 5.6} M${x + 6} ${y + 7.2} L${x + 6} ${y + 9.6}" ` +
        `stroke="${civ}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".66"/>` +
        `</g>`;
    }

  const srng = makeRng(seedFrom(grid, 97));
  const groundY = SGY + GRID_H + 30;
  let skyline = "";
  for (let x = 10; x < W - 10; ) {
    const bw = 16 + Math.floor(srng() * 34);
    const bh = 8 + Math.floor(srng() * 20);
    skyline += `<rect x="${x}" y="${groundY - bh}" width="${bw}" height="${bh}" fill="${t.skyline}"/>`;
    for (let wx = x + 4; wx < x + bw - 4; wx += 7)
      for (let wy = groundY - bh + 4; wy < groundY - 4; wy += 7)
        if (srng() > 0.55)
          skyline += `<rect x="${wx}" y="${wy}" width="2.4" height="2.4" fill="${t.accent}" opacity=".5"/>`;
    x += bw + 2 + Math.floor(srng() * 4);
  }
  skyline = `<g opacity=".45">${skyline}<rect x="0" y="${groundY}" width="${W}" height="1.2" fill="${t.frame}" opacity=".6"/></g>`;

  const visits = [...seen.values()].sort((a, b) => a - b);
  let hud = "";
  let hudCSS = "";
  for (let i = 0; i < HUD_STEPS; i++) {
    const p0 = i / HUD_STEPS;
    const p1 = (i + 1) / HUD_STEPS;
    // Read the count mid-window, so the number never runs ahead of the throws
    // you can see. The last one is special: it has to be the true final total,
    // because a mid-window reading there misses whoever is still in the air -
    // and that wrong number is the one left on screen for the whole bow.
    const cut = i === HUD_STEPS - 1 ? SP_IN + SP_PLAY : SP_IN + ((p0 + p1) / 2) * SP_PLAY;
    let n = 0;
    while (n < visits.length && visits[n] <= cut) n++;
    const a = i === 0 ? 0 : spct(SP_IN + p0 * SP_PLAY);
    const b = i === HUD_STEPS - 1 ? 100 : spct(SP_IN + p1 * SP_PLAY);
    hud += `<text class="hud hb${i}" x="${GX}" y="72">rescued ${n}/${total}</text>`;
    hudCSS +=
      `@keyframes hb${i}{` +
      (i === 0 ? `0%,${b}%{opacity:1}` : `0%,${a}%{opacity:0}${(a + 0.004).toFixed(3)}%,${b}%{opacity:1}`) +
      (i === HUD_STEPS - 1 ? `}` : `${(b + 0.004).toFixed(3)}%,100%{opacity:0}}`) +
      `.hb${i}{animation-name:hb${i}}`;
  }

  const rig =
    `<g class="wfly"><g class="wa">` +
    `<g class="wk"><circle cx="0" cy="0" r="2.8" fill="${t.web}" opacity=".5"/>` +
    `<path d="M-4.6 -2 L0 0 M4.6 -2 L0 0 M0 -5 L0 0" stroke="${t.web}" stroke-width="1" stroke-linecap="round" opacity=".35" fill="none"/></g>` +
    `<g class="wr">` +
    `<g class="wl"><rect x="-.65" y="0" width="1.3" height="1" fill="${t.web}" opacity=".72"/></g>` +
    `<g class="wh"><g class="wsp"><g class="wfig">${figure(t, 0)}${figure(t, 1)}</g></g></g>` +
    `</g></g></g>`;

  const barW = 150;
  const barY = SP_H - 26;
  const bar =
    `<rect x="${W / 2 - barW / 2}" y="${barY}" width="${barW}" height="2.5" rx="1.25" fill="${t.frame}" opacity=".45"/>` +
    `<rect class="sprog" x="${W / 2 - barW / 2}" y="${barY}" width="${barW}" height="2.5" rx="1.25" fill="${t.accent}"/>`;

  const css = `
    .cell,.wfly,.wa,.wr,.wl,.wh,.wsp,.wk,.wfig,.warm,.h0,.h1,.hud,.sprog,.lf{animation-duration:${SP_TOTAL}s;animation-iteration-count:infinite;animation-timing-function:linear}
    .wfly,.wa,.wr,.wl,.wh,.wsp,.warm,.sprog,.cell{transform-box:view-box;transform-origin:0 0}
    .wfly{animation-name:wfly}
    .warm{animation-name:warm;transform-origin:1.6px 9px}
    .wa{animation-name:wanc}.wr{animation-name:wrot}
    .wl{animation-name:wlen,wweb}.wk{animation-name:wweb}
    .wh{animation-name:whero}.wfig{animation-name:wfig}
    /* Pivot halfway down the body, on the web's own axis: a 180 turn then
       lands his boots exactly where the web ends and drops his head below it,
       which is the pose. Pivoting on the chest instead leaves the line
       attached to his ribs. It doubles as the centre for the somersaults. */
    .wsp{animation-name:wspin;transform-origin:0px 12px}
    .h0{animation-name:hnd0}.h1{animation-name:hnd1}
    .kick{animation:kick 1.1s ease-in-out infinite;transform-box:view-box;transform-origin:2.7px 17.2px}
    @keyframes kick{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(9deg)}}
    .lf{animation-name:lf}
    @keyframes lf{0%{opacity:0}1.8%,97.5%{opacity:1}100%{opacity:0}}
    .sprog{transform-origin:${W / 2 - barW / 2}px 0;animation-name:sprog}
    @keyframes sprog{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}
    .ttl{font:700 17px "Cascadia Code","JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;fill:${t.accent}}
    .sub{font:400 11.5px "Cascadia Code","JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;fill:${t.muted}}
    .hud{font:700 13px "Cascadia Code","JetBrains Mono",ui-monospace,monospace;fill:${t.suit};opacity:0}
    .hint{font:400 10px "Cascadia Code",ui-monospace,monospace;fill:${t.muted}}
    ${rigCSS(legs, timing)}
    ${throwCss}
    ${hudCSS}
    @media (prefers-reduced-motion:reduce){
      .cell,.wfly,.wa,.wr,.wl,.wh,.wsp,.wk,.wfig,.warm,.h0,.h1,.hud,.sprog,.lf,.kick{animation:none}
      .lf{opacity:1}.cell{opacity:1}.hb0{opacity:1}.h1{opacity:0}
      .sprog{transform:scaleX(0)}
      .wa{transform:translate(${legs[0].ax.toFixed(2)}px,${legs[0].ay.toFixed(2)}px)}
      .wr{transform:rotate(${legs[0].ain.toFixed(2)}deg)}
      .wl{transform:scale(1,${legs[0].L.toFixed(2)})}
      .wh{transform:translateY(${legs[0].L.toFixed(2)}px)}
    }
  `.replace(/\s*\n\s*/g, "");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${SP_H}" viewBox="0 0 ${W} ${SP_H}" role="img" aria-label="A web-slinger swings left to right across my GitHub contribution graph, rescuing every commit like a civilian at a window">
<style>${css}</style>
<rect width="${W}" height="${SP_H}" rx="14" fill="${t.bg}"/>
<rect x=".75" y=".75" width="${W - 1.5}" height="${SP_H - 1.5}" rx="13.5" fill="none" stroke="${t.frame}" stroke-width="1.5" opacity=".55"/>
<g class="lf">
${skyline}
${netSVG(t)}
${base}
${windows}
${rig}
</g>
<text class="ttl" x="${GX}" y="28">&gt; ./play spiderman.sh</text>
<text class="sub" x="${GX}" y="45">hand over hand across the facade - every commit gets caught and thrown into the web</text>
${hud}
${bar}
<text class="hint" x="${W - 20}" y="${SP_H - 12}" text-anchor="end">pure css - no javascript - ${Math.round(SP_TOTAL)}s loop</text>
</svg>`;
}

/* -------------------------------------------------------------------- main */
(async () => {
  const grid = await fetchGrid();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const panels = { arcade: render, spiderman: renderSwing };
  for (const [name, fn] of Object.entries(panels))
    for (const theme of ["dark", "light"]) {
      const file = path.join(OUT_DIR, `${name}-${theme}.svg`);
      fs.writeFileSync(file, fn(grid, theme), "utf8");
      console.log(`wrote ${file}  (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
    }
})();
