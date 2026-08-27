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

/* -------------------------------------------------------------------- main */
(async () => {
  const grid = await fetchGrid();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const theme of ["dark", "light"]) {
    const file = path.join(OUT_DIR, `arcade-${theme}.svg`);
    fs.writeFileSync(file, render(grid, theme), "utf8");
    console.log(`wrote ${file}  (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
  }
})();
