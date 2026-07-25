/* ============================================================
   Dunkwise — SPA over the historical NBA dataset (1947–2026)
   Async data access; official-CDN logos/headshots with fallbacks.
   ============================================================ */
(function () {
  const V = "49";
  // Injury report is hidden site-wide until we have reliable, injury-specific data for
  // every player (the live feed is offseason transaction noise). Flip to true to restore.
  const SHOW_INJURIES = false;
  // Betting / slate section hidden for now (legal/age-gating review pending). Flip to true to restore;
  // the nav links live in index.html (search "data-route=\"betting\"").
  const SHOW_BETTING = false;
  const SHOW_2K = false;   // 2K data is incomplete/stale (no clean 2K23/24/26 source) — hidden until it can be kept current
  const app = document.getElementById("app");
  const tt = document.getElementById("tt");
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- data store ---------- */
  const cache = {};
  const j = (url) => (cache[url] || (cache[url] = fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })));
  // Live files (injuries/odds/scores/standings/news) are refreshed on a schedule by the
  // GitHub Action, so they bypass the versioned cache with a rolling 5-minute buster —
  // clients pick up new data without an app redeploy. Historical files stay ?v-cached.
  const LIVE = Math.floor(Date.now() / 300000);
  const jl = (path) => j(`${path}?t=${LIVE}`);
  const getMeta = () => j(`data/meta.json?v=${V}`);
  const getSearch = () => j(`data/search.json?v=${V}`);
  const getSeason = (y) => (+y === (META && META.current) ? jl(`data/season/${y}.json`) : j(`data/season/${y}.json?v=${V}`));
  const getPlayer = (id) => j(`data/player/${id}.json?v=${V}`);
  const getTeam = (ab) => j(`data/team/${ab}.json?v=${V}`);
  const getAlltime = () => j(`data/alltime.json?v=${V}`);
  const getAwards = () => j(`data/awards.json?v=${V}`);
  const getDraft = (y) => j(`data/draft/${y}.json?v=${V}`);
  const getNews = () => jl(`data/news.json`);
  const getSalaries = () => j(`data/salaries.json?v=${V}`);
  const getCPI = () => j(`data/cpi.json?v=${V}`);
  const getGamesIdx = (s) => (+s === (META && META.current) ? jl(`data/games/${s}.json`) : j(`data/games/${s}.json?v=${V}`));
  let _thisday = null;
  const getThisday = () => _thisday ? Promise.resolve(_thisday) : j(`data/thisday.json?v=${V}`).then((d) => (_thisday = d)).catch(() => (_thisday = {}));
  const getGame = (id) => j(`data/game/${id}.json?v=${V}`);
  const getPGames = (pid) => j(`data/pgames/${pid}.json?v=${V}`);
  const getTwoK = () => j(`data/twok.json?v=${V}`);
  const getTwoKHist = () => j(`data/twok_history.json?v=${V}`).catch(() => null);
  let _dpCache = null;
  const getDraftPicks = () => _dpCache ? Promise.resolve(_dpCache) : j(`data/draft_picks.json?v=${V}`).then((d) => (_dpCache = d)).catch(() => (_dpCache = {}));
  const getInjuries = () => jl(`data/injuries.json`);
  const getStatus = () => jl(`data/status.json`);
  const getOdds = () => jl(`data/odds.json`);
  let _ptCache = null;
  const getPlayersTable = () => _ptCache ? Promise.resolve(_ptCache) : j(`data/players_table.json?v=${V}`).then((d) => (_ptCache = d));
  let _ttCache = null;
  const getTeamsTable = () => _ttCache ? Promise.resolve(_ttCache) : j(`data/teams_table.json?v=${V}`).then((d) => (_ttCache = d));
  let _fmap = null;   // historical franchise abbr → modern abbr (e.g. SEA → OKC), for URL redirects
  const getFranchiseMap = () => _fmap ? Promise.resolve(_fmap) : j(`data/franchise_map.json?v=${V}`).then((d) => (_fmap = d)).catch(() => (_fmap = {}));
  // every abbr a modern franchise has used across its lineage (modern + predecessors), from an
  // already-loaded franchise map. Salary attribution is era-accurate (a 2005 Seattle salary is
  // filed under SEA), so franchise-level payroll must sum across all of these — else a relocated
  // team's earlier years orphan under the old abbr and vanish from the modern team page.
  const franchAbbrsFrom = (fmap, ab) => { const s = new Set([ab]); for (const e in fmap) if (fmap[e] === ab) s.add(e); return s; };
  const franchiseAbbrs = async (ab) => franchAbbrsFrom(await getFranchiseMap(), ab);
  const mergePayroll = (sal, abbrs) => { const m = {}; if (sal) abbrs.forEach((a) => (sal.teamPayroll[a] || []).forEach(([s, v]) => { m[s] = (m[s] || 0) + v; })); return m; };
  const _psCache = {};
  const getPlayersSeason = (yr) => _psCache[yr] ? Promise.resolve(_psCache[yr]) : j(`data/players_season/${yr}.json?v=${V}`).then((d) => (_psCache[yr] = d));

  let META, SEARCH, SMAP = {};

  /* ---------- format ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const one = (v) => (v == null ? "—" : (+v).toFixed(1));
  const pct = (v) => (v == null ? "—" : "." + String(Math.round(v * 1000)).padStart(3, "0").replace(/^0+(?=\d)/, "") ).replace(/^\.$/, "—");
  const pctf = (v) => (v == null ? "—" : "." + Math.round(v * 1000));
  const winpct = (w, l) => (w + l === 0 ? "—" : "." + String(Math.round((w / (w + l)) * 1000)).padStart(3, "0"));
  const seasonLabel = (y) => `${y - 1}-${String(y).slice(2)}`;
  const intOr = (v) => (v == null ? "—" : v);
  const intc = (v) => (v == null ? "—" : (+v).toLocaleString("en-US"));
  const ws48 = (v) => (v == null ? "—" : (+v).toFixed(3).replace(/^0(?=\.)/, ""));
  const signed = (v, nd = 1) => (v == null ? "—" : (v >= 0 ? "+" : "") + (+v).toFixed(nd));
  const money = (v) => (v == null ? "—" : v >= 1e6 ? "$" + (v / 1e6).toFixed(1) + "M" : "$" + Math.round(v / 1e3) + "K");
  const moneyFull = (v) => (v == null ? "—" : "$" + (+v).toLocaleString("en-US"));
  // restate a nominal salary from a given season in base-year dollars
  let CPI = null;   // {cpi:{year:idx}, base:year} — loaded lazily
  const inflate = (amt, season) => {
    if (!CPI || amt == null) return amt;
    const c = CPI.cpi[season];
    return c ? amt * CPI.cpi[CPI.base] / c : amt;
  };
  const initials = (nm) => nm.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  function timeAgo(iso) {
    if (!iso) return "";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  }
  function relTime(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 0 || s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 7200) return "an hour ago";
    if (s < 86400) return Math.round(s / 3600) + " hours ago";
    if (s < 172800) return "yesterday";
    return Math.round(s / 86400) + " days ago";
  }
  async function showDataRefreshed() {
    try {
      const st = await getStatus();
      const el = document.getElementById("dataRefreshed"), txt = document.getElementById("dataRefreshedText");
      if (!st || !st.refreshed || !el || !txt) return;
      txt.textContent = "Live data refreshed " + relTime(st.refreshed);
      el.hidden = false;
    } catch (e) {}
  }
  const NEWS_DOMAIN = { "ESPN": "espn.com", "CBS Sports": "cbssports.com", "Yahoo Sports": "sports.yahoo.com",
    "Bleacher Report": "bleacherreport.com", "r/nba": "reddit.com", "Sporting News": "sportingnews.com", "The Athletic": "nytimes.com" };
  const pubLogo = (source) => { const d = NEWS_DOMAIN[source]; return d
    ? `<img class="pub-logo" src="https://www.google.com/s2/favicons?domain=${d}&sz=64" alt="" loading="lazy" onerror="this.style.display='none'">` : ""; };
  const playerTags = (players) => (players && players.length)
    ? `<span class="ptags">${players.map((p) => `<a class="ptag" href="#/player/${p[0]}">${headshot(p[0], p[1], "", "xs")}${esc(p[1])}</a>`).join("")}</span>` : "";
  // Backup cover when a headline has no publisher image: the tagged players' cutouts on a
  // brand-tinted court gradient (up to 3, overlapped and bottom-aligned like a matchup graphic),
  // falling back to the source's favicon watermark when no player headshot resolves. `kind` is
  // the container class — "ncard-img" for the grid, "art-img" for the article hero.
  function newsCover(it, kind) {
    const faces = (it.players || []).map((p) => nbaOf(p[0])).filter(Boolean).slice(0, 3);
    const inner = faces.length
      ? faces.map((n) => `<img class="nc-face" src="${META.headshotBase}${n}.png" alt="" loading="lazy" onerror="this.remove()">`).join("")
      : `<span class="nc-mark">${pubLogo(it.source)}</span>`;
    return `<span class="${kind} gen g${faces.length}"><span class="nc-court"></span>${inner}</span>`;
  }
  // compact list (home rail) — links in-site to the article reader
  function newsList(items, n) {
    return items.slice(0, n).map((it, i) => `<a class="news-item" href="#/article/${i}">
      <span class="news-src">${pubLogo(it.source)}<span class="txt">${esc(it.source)}</span></span><span class="news-title">${esc(it.title)}</span>
      <span class="news-time">${timeAgo(it.ts)}</span></a>`).join("");
  }
  // rich card (news page grid)
  function newsCard(it, i) {
    return `<article class="ncard">
      <a class="ncard-main" href="#/article/${i}">
        ${it.img ? `<span class="ncard-img" style="background-image:url('${esc(it.img)}')"></span>` : newsCover(it, "ncard-img")}
        <span class="ncard-body">
          <span class="ncard-src">${pubLogo(it.source)}<span>${esc(it.source)}</span><span class="dot">·</span>${timeAgo(it.ts)}</span>
          <span class="ncard-title">${esc(it.title)}</span>
          ${it.summary ? `<span class="ncard-sum">${esc(it.summary)}</span>` : ""}
        </span>
      </a>
      ${playerTags(it.players)}
    </article>`;
  }
  async function renderArticle(idx) {
    let news; try { news = await getNews(); } catch { news = null; }
    const items = (news && news.items) || [], it = items[+idx];
    if (!it) return notFound("article");
    const rel = items.filter((x, i) => i !== +idx && x.players && it.players && x.players.some((p) => it.players.some((q) => q[0] === p[0]))).slice(0, 4);
    app.innerHTML = `<div class="wrap page article">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/news">News</a><span class="sep">/</span><span>${esc(it.source)}</span></div>
      <div class="art-head">
        <div class="art-src">${pubLogo(it.source)}<span>${esc(it.source)}</span>${it.ts ? `<span class="dot">·</span><span>${timeAgo(it.ts)} ago</span>` : ""}</div>
        <h1>${esc(it.title)}</h1>
        ${playerTags(it.players)}
      </div>
      ${it.img ? `<div class="art-img"><img src="${esc(it.img)}" alt="" loading="lazy" onerror="this.parentNode.style.display='none'"></div>` : newsCover(it, "art-img")}
      ${it.summary ? `<p class="art-sum">${esc(it.summary)}</p>` : ""}
      <a class="btn art-read" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">Read the full story at ${esc(it.source)} →</a>
      <p class="news-foot art-attr">Dunkwise aggregates NBA headlines. Summary and image are provided by the publisher's feed for syndication; full articles, photos and rights remain with <b>${esc(it.source)}</b> — the link above opens the original.</p>
      ${rel.length ? `<div class="section-title" style="margin-top:26px"><h2>Related</h2></div>
        <div class="ncard-grid">${rel.map((r) => newsCard(r, items.indexOf(r))).join("")}</div>` : ""}
    </div>`;
  }
  // News tied to a player (uses the pre-tagged players[] on each headline).
  async function playerNews(pid) {
    let news; try { news = await getNews(); } catch { return ""; }
    const items = (news && news.items) || [];
    const rel = items.map((it, i) => [it, i]).filter(([it]) => (it.players || []).some((p) => p[0] === pid));
    if (!rel.length) return "";
    return `<div class="section-title" style="margin-top:26px"><div><h2>In the news</h2></div><a class="link" href="#/news">All NBA news →</a></div>
      <div class="ncard-grid">${rel.slice(0, 4).map(([it, i]) => newsCard(it, i)).join("")}</div>`;
  }
  // News tied to a team — matched on the distinctive nickname / full name in the headline.
  async function teamNews(ab) {
    let news; try { news = await getNews(); } catch { return ""; }
    const items = (news && news.items) || [], m = tMeta(ab);
    if (!m) return "";
    const needles = [m.name, m.full].filter(Boolean).map((s) => s.toLowerCase());
    const rel = items.map((it, i) => [it, i]).filter(([it]) => { const t = ((it.title || "") + " " + (it.summary || "")).toLowerCase(); return needles.some((n) => t.includes(n)); });
    if (!rel.length) return "";
    return `<div class="section-title" style="margin-top:26px"><div><h2>${esc(m.name)} news</h2></div><a class="link" href="#/news">All NBA news →</a></div>
      <div class="ncard-grid">${rel.slice(0, 4).map(([it, i]) => newsCard(it, i)).join("")}</div>`;
  }
  function textOn(hex) {
    const h = (hex || "#888").replace("#", ""); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#1A1915" : "#ffffff";
  }
  const ord = (i) => i + (["th", "st", "nd", "rd"][(i % 100 >> 3 ^ 1) && i % 10 < 4 ? i % 10 : 0]);

  /* ---------- team helpers ---------- */
  const tMeta = (ab) => (META.teams[ab] || null);
  const tName = (ab) => (META.names[ab] || ab);
  const tColor = (ab) => (tMeta(ab) ? tMeta(ab).color : "#6C7683");
  const tConf = (ab) => (tMeta(ab) ? tMeta(ab).conf : null);
  const isRealTeam = (ab) => ab && !/^\d?TM$|^TOT$/.test(ab) && !!META.names[ab];
  const nbaOf = (id) => (SMAP[id] ? SMAP[id][6] : null);

  // Avatars show a team-colour monogram by default and only reveal the CDN image once it
  // actually loads — so there's no empty-circle flash while loading, and a blocked/broken
  // CDN degrades to the monogram instead of a blank.
  window.__imgok = function (img) { img.classList.add("ldd"); };
  window.__imgfail = function (img) { img.remove(); };

  // Former identities that share a still-active franchise's modern abbr, so teamLogo's
  // current-franchise short-circuit would otherwise paint them with today's mark. The
  // Bobcats ran under CHA (2004–14) just like the current Hornets; BBR serves the period
  // logo season-stamped. Keyed `${eraAbbr}|${eraName}` → explicit logo URL.
  const ERA_LOGO = {
    "CHA|Charlotte Bobcats": "https://cdn.ssref.net/req/1/tlogo/bbr/CHA-2014.png",
  };
  function teamLogo(ab, size = "md", season, override) {
    const m = tMeta(ab), color = tColor(ab), mono = `<span class="ava-mono" style="background:${color};color:${textOn(color)}">${esc(ab)}</span>`;
    // current franchises use their live logo; defunct/former franchises (NOH, SEA, …)
    // use their period logo from basketball-reference, season-specific when we know it.
    // An explicit override wins over both (former identities that reuse a live abbr).
    let url = override || (m && m.logo) || (META.histLogos && META.histLogos[ab]) || null;
    if (url && season && !override && !(m && m.logo)) url = url.replace(/-\d+\.png$/, `-${season}.png`);
    if (url) return `<span class="ava logo ${size}"><img src="${url}" alt="" loading="lazy" onload="__imgok(this)" onerror="__imgfail(this)"><span class="ava-mono" style="background:${color};color:${textOn(color)}">${esc(ab)}</span></span>`;
    return `<span class="ava logo ${size}">${mono}</span>`;
  }
  function headshot(id, name, team, size = "md") {
    const nba = nbaOf(id), color = tColor(team), init = initials(name);
    const mono = `<span class="ava-mono" style="background:${color};color:${textOn(color)}">${esc(init)}</span>`;
    if (nba) return `<span class="ava shot ${size}"><img src="${META.headshotBase}${nba}.png" alt="" loading="lazy" onload="__imgok(this)" onerror="__imgfail(this)"><span class="ava-mono" style="background:${color};color:${textOn(color)}">${esc(init)}</span></span>`;
    return `<span class="ava shot ${size}">${mono}</span>`;
  }
  function teamTag(ab, withLogo = false) {
    if (!ab) return "";
    if (!isRealTeam(ab)) return `<span class="tm-tag muted">${esc(ab)}</span>`;
    const dot = withLogo ? teamLogo(ab, "xs") : `<span class="b" style="background:${tColor(ab)}"></span>`;
    return `<a href="#/team/${ab}" class="tm-tag">${dot}${esc(ab)}</a>`;
  }
  const pLink = (id, name) => `<a href="#/player/${id}">${esc(name)}</a>`;

  /* ---------- tooltip ---------- */
  const COARSE = !!(window.matchMedia && (matchMedia("(pointer:coarse)").matches || matchMedia("(hover:none)").matches));
  let ttTimer;
  function forceHideTT() { clearTimeout(ttTimer); tt.classList.remove("on"); }
  function showTT(html, x, y) {
    tt.innerHTML = html; tt.classList.add("on");
    const w = tt.offsetWidth, h = tt.offsetHeight; let nx, ny;
    if (COARSE) {
      // touch: center over the tap point, clamp inside the viewport, auto-dismiss
      nx = Math.min(Math.max(8, x - w / 2), innerWidth - w - 8);
      ny = y - h - 14; if (ny < 8) ny = y + 20;
      clearTimeout(ttTimer); ttTimer = setTimeout(forceHideTT, 2600);
    } else {
      nx = x + 16; ny = y - h - 10;
      if (nx + w > innerWidth - 8) nx = x - w - 16; if (ny < 8) ny = y + 18;
    }
    // clamp both axes so a fixed tooltip can never push the page wider than the viewport
    tt.style.left = Math.min(Math.max(8, nx), innerWidth - w - 8) + "px"; tt.style.top = ny + "px";
  }
  // On touch, pointerleave fires the instant a finger lifts and would flash the tip
  // away — so ignore hover-hide on coarse pointers and rely on the auto-dismiss timer
  // plus a capture-phase tap-away (which runs before a trigger re-shows its own tip).
  const hideTT = () => { if (!COARSE) tt.classList.remove("on"); };
  if (COARSE) document.addEventListener("pointerdown", forceHideTT, true);

  /* ---------- per-route SEO (title, description, canonical, Open Graph, JSON-LD) ---------- */
  const SITE = "Dunkwise";
  function metaTag(sel, attr, key, val) {
    let el = document.head.querySelector(sel);
    if (!el) { el = document.createElement("meta"); el.setAttribute(attr, key); document.head.appendChild(el); }
    el.setAttribute("content", val);
  }
  function setSEO(title, desc, jsonld) {
    const full = title ? `${title} — ${SITE}` : `${SITE} — NBA Stats & History`;
    document.title = full;
    if (desc) {
      metaTag('meta[name="description"]', "name", "description", desc);
      metaTag('meta[property="og:description"]', "property", "og:description", desc);
      metaTag('meta[name="twitter:description"]', "name", "twitter:description", desc);
    }
    metaTag('meta[property="og:title"]', "property", "og:title", full);
    metaTag('meta[name="twitter:title"]', "name", "twitter:title", full);
    metaTag('meta[property="og:type"]', "property", "og:type", "website");
    // canonical — for indexable entities (player/team/game) point at the crawlable
    // prerendered .html page so ranking signals consolidate there; else the SPA URL.
    const dir = location.pathname.replace(/[^/]*$/, ""), abs = (p) => location.origin + dir + p;
    let canHref = location.href, m; const h = location.hash;
    if ((m = h.match(/^#\/player\/([^/?]+)/))) canHref = abs("players/" + m[1] + ".html");
    else if ((m = h.match(/^#\/team\/([^/?]+)/))) canHref = abs("teams/" + m[1] + ".html");
    else if ((m = h.match(/^#\/game\/([^/?]+)/))) canHref = abs("game/" + m[1] + ".html");
    let can = document.head.querySelector('link[rel="canonical"]');
    if (!can) { can = document.createElement("link"); can.rel = "canonical"; document.head.appendChild(can); }
    can.href = canHref;
    metaTag('meta[property="og:url"]', "property", "og:url", canHref);
    // structured data
    let ld = document.getElementById("ld-route");
    if (jsonld) {
      if (!ld) { ld = document.createElement("script"); ld.type = "application/ld+json"; ld.id = "ld-route"; document.head.appendChild(ld); }
      ld.textContent = JSON.stringify(jsonld);
    } else if (ld) { ld.remove(); }
  }

  /* ---------- leaders ---------- */
  const LEAD_CATS = [
    ["pts", "Points", "PPG", one], ["trb", "Rebounds", "RPG", one], ["ast", "Assists", "APG", one],
    ["stl", "Steals", "SPG", one], ["blk", "Blocks", "BPG", one], ["per", "PER", "PER", one],
    ["ts_percent", "True shooting", "TS%", pctf], ["fg_percent", "Field goal", "FG%", pctf],
    ["x3p_percent", "3-point", "3P%", pctf], ["ft_percent", "Free throw", "FT%", pctf],
  ];
  const CATMAP = Object.fromEntries(LEAD_CATS.map((c) => [c[0], c]));
  function leaderList(S, cat, n = 10) {
    const rows = (S.leaders[cat] || []).slice(0, n), fmt = CATMAP[cat][3];
    if (!rows.length) return `<p class="muted" style="font-size:13px;padding:8px 0">Not tracked this season.</p>`;
    const max = Math.max(...rows.map((r) => r[3]));
    return `<ul class="rank rank-bar">${rows.map((r, i) => `<li class="${i === 0 ? "top" : ""}" style="--b:${(r[3] / max).toFixed(3)}">
      <span class="rk">${i + 1}</span>
      <span class="who">${headshot(r[0], r[1], r[2], "xs")}<a class="nm" href="#/player/${r[0]}">${esc(r[1])}</a> ${teamTag(r[2])}</span>
      <span class="val">${fmt(r[3])}</span></li>`).join("")}</ul>`;
  }
  function leaderCard(S, cat) {
    return `<div class="card pad"><div class="card-h"><h3>${CATMAP[cat][1]}</h3><span class="hint">${CATMAP[cat][2]}</span></div>${leaderList(S, cat)}</div>`;
  }

  /* ---------- player card ---------- */
  function playerCardDoc(p) {
    const t = p.cur.team;
    return `<a href="#/player/${p.id}" class="pcard">
      <span class="accentbar" style="background:${tColor(t)}"></span>
      ${headshot(p.id, p.name, t, "lg")}
      <div class="pc-body">
        <div class="pos">${esc(p.cur.pos || p.bio.pos || "")} · ${esc(t)}</div>
        <div class="nm">${esc(p.name)}</div>
        <div class="line">
          <div class="s"><div class="v">${one(p.cur.pts)}</div><div class="k">PPG</div></div>
          <div class="s"><div class="v">${one(p.cur.trb)}</div><div class="k">RPG</div></div>
          <div class="s"><div class="v">${one(p.cur.ast)}</div><div class="k">APG</div></div>
        </div>
      </div></a>`;
  }
  async function playerCards(ids) {
    const docs = await Promise.all(ids.map((id) => getPlayer(id).catch(() => null)));
    return docs.filter(Boolean).map(playerCardDoc).join("");
  }

  /* ---------- standings helpers ---------- */
  function splitConf(rows) {
    const e = [], w = [], u = [];
    rows.forEach((t) => { const c = tConf(t.abbr); if (c === "East") e.push(t); else if (c === "West") w.push(t); else u.push(t); });
    return e.length && w.length ? { East: e, West: w } : { League: rows };
  }
  function miniStanding(rows) {
    return `<table><tbody>${rows.slice(0, 8).map((t, i) => `<tr onclick="location.hash='#/team/${t.abbr}'" style="cursor:pointer">
      <td class="seed">${i + 1}</td>
      <td class="tm">${teamLogo(t.abbr, "xs")}<span class="tnm">${esc(tName(t.abbr))}</span>${i < 6 ? '<span class="clinch">✓</span>' : (i < 8 ? '<span class="clinch play">play-in</span>' : "")}</td>
      <td class="rec">${t.w}–${t.l}</td><td class="pct">${winpct(t.w, t.l)}</td></tr>`).join("")}</tbody></table>`;
  }

  /* ---------- team efficiency scatter ---------- */
  function drawScatter(mountId, rows) {
    const pts = rows.filter((r) => r.o != null && r.d != null);
    if (!pts.length) { $("#" + mountId).innerHTML = ""; return; }
    const W = 900, H = 470, m = { t: 26, r: 26, b: 48, l: 54 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const oq = pts.map((p) => p.o), dq = pts.map((p) => p.d);
    const pad = 1.5, xmin = Math.min(...oq) - pad, xmax = Math.max(...oq) + pad, ymin = Math.min(...dq) - pad, ymax = Math.max(...dq) + pad;
    const sx = (v) => m.l + (v - xmin) / (xmax - xmin) * iw, sy = (v) => m.t + (v - ymin) / (ymax - ymin) * ih;
    const lgO = oq.reduce((a, b) => a + b, 0) / oq.length, lgD = dq.reduce((a, b) => a + b, 0) / dq.length;
    const wq = pts.map((p) => p.w), wmax = Math.max(...wq), wmin = Math.min(...wq);
    let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Team offensive vs defensive rating">`;
    const step = (xmax - xmin > 12) ? 4 : 2;
    for (let v = Math.ceil(xmin / step) * step; v < xmax; v += step) { const x = sx(v); g += `<line class="grid" x1="${x}" y1="${m.t}" x2="${x}" y2="${m.t + ih}"/><text x="${x}" y="${H - 18}" text-anchor="middle">${v}</text>`; }
    for (let v = Math.ceil(ymin / step) * step; v < ymax; v += step) { const y = sy(v); g += `<line class="grid" x1="${m.l}" y1="${y}" x2="${m.l + iw}" y2="${y}"/><text x="${m.l - 10}" y="${y + 4}" text-anchor="end">${v}</text>`; }
    g += `<line class="axis" x1="${sx(lgO)}" y1="${m.t}" x2="${sx(lgO)}" y2="${m.t + ih}" stroke-dasharray="3 4"/><line class="axis" x1="${m.l}" y1="${sy(lgD)}" x2="${m.l + iw}" y2="${sy(lgD)}" stroke-dasharray="3 4"/>`;
    g += `<text class="qlabel" x="${m.l + iw - 4}" y="${m.t + 13}" text-anchor="end">Two-way elite ↗</text>`;
    g += `<text x="${m.l + iw / 2}" y="${H - 3}" text-anchor="middle" fill="var(--ink-2)" style="font-size:11px">Offensive rating — points scored / 100 poss. →</text>`;
    g += `<text transform="translate(15 ${m.t + ih / 2}) rotate(-90)" text-anchor="middle" fill="var(--ink-2)" style="font-size:11px">← better defense · Defensive rating</text>`;
    pts.forEach((t) => {
      const x = sx(t.o), y = sy(t.d), r = 7 + (wmax === wmin ? 4 : (t.w - wmin) / (wmax - wmin) * 9);
      const elite = t.o > lgO && t.d < lgD, label = t.w >= (wmin + (wmax - wmin) * 0.62);
      g += `<g class="sdot" data-ab="${t.abbr}" data-o="${t.o}" data-d="${t.d}" data-w="${t.w}" data-l="${t.l}">
        <circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="${tColor(t.abbr)}" fill-opacity="${elite ? 0.92 : 0.5}" stroke="var(--panel)" stroke-width="1.5"/>
        ${label ? `<text x="${x}" y="${(y - r - 5).toFixed(1)}" text-anchor="middle">${esc(t.abbr)}</text>` : ""}</g>`;
    });
    g += `</svg>`;
    $("#" + mountId).innerHTML = g;
    $$("#" + mountId + " .sdot").forEach((d) => {
      const show = (e) => showTT(`<div class="h">${esc(tName(d.dataset.ab))}</div>
        <div class="r"><span>Offense</span><span>${(+d.dataset.o).toFixed(1)}</span></div>
        <div class="r"><span>Defense</span><span>${(+d.dataset.d).toFixed(1)}</span></div>
        <div class="r"><span>Net · Record</span><span>${(d.dataset.o - d.dataset.d >= 0 ? "+" : "") + (d.dataset.o - d.dataset.d).toFixed(1)} · ${d.dataset.w}-${d.dataset.l}</span></div>`, e.clientX, e.clientY);
      d.addEventListener("pointerdown", show);   // touch tap / mouse press
      d.addEventListener("pointermove", show);   // mouse hover / touch drag
      d.addEventListener("pointerleave", hideTT);
      d.addEventListener("pointercancel", hideTT);
      d.addEventListener("click", () => (location.hash = "#/team/" + d.dataset.ab));
    });
  }

  /* ================= HOME ================= */
  async function renderHome() {
    const cur = META.current;
    const [S, news, gidx] = await Promise.all([getSeason(cur), getNews().catch(() => null), getGamesIdx(cur).catch(() => null)]);
    const st = S.standings, top = st[0], L = S.leaders;
    const featIds = (L.pts || []).slice(0, 6).map((r) => r[0]);
    const recent = gidx && gidx.games ? gidx.games.slice(-5).reverse() : [];
    // Offseason (no games for >10 days): surface evergreen postseason content up top so the
    // home page never feels stale between June and October.
    const offseason = recent.length ? (Date.now() - new Date(recent[0].date + "T12:00:00Z").getTime()) / 86400000 > 10 : false;
    app.innerHTML = `
    <section class="hero2 reveal">
      <div class="wrap">
        <div class="hero-copy">
          <span class="eyebrow">The modern NBA reference</span>
          <h1>Every player and team in <em>NBA history</em>.</h1>
          <p class="hero-sub">Stats, contracts, standings and box scores, from ${META.seasons[META.seasons.length - 1]} to now.</p>
        </div>
        <div class="mast-search hero-search">
          <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input id="mastSearch" type="text" placeholder="Search any player or team…" aria-label="Search" autocomplete="off" spellcheck="false" />
          <div class="results" id="mastResults"></div>
        </div>
        <div class="quick-chips">
          <a href="#/leaders/all"><b>All-time leaders</b></a>
          <a href="#/compare">Compare players</a>
          <a href="#/awards">Awards</a>
          <a href="#/salaries">Salaries</a>
          <a href="#/draft">Draft</a>
          <a href="#/standings">Standings</a>
        </div>
      </div>
    </section>

    <div class="wrap">
      ${recent.length ? `<section class="reveal home-scores">
        <div class="section-title small"><h2>${offseason ? "Final games" : "Recent scores"}</h2><a class="link" href="#/games">All scores →</a></div>
        <div class="mfeed home-mfeed">${recent.map(matchRow).join("")}</div>
      </section>` : ""}

      <div class="trend-strip reveal">
        <div class="section-title small"><h2>Trending · ${seasonLabel(cur)} scoring leaders</h2><a class="link" href="#/leaders">Leaders →</a></div>
        <div class="pcards" id="featured"></div>
      </div>

      <div class="home-grid2">
        <div class="card big pad reveal" id="newsCard">
          <div class="card-h"><h3>Around the league</h3><a class="hint" href="#/news" style="color:var(--ink-3)">More news →</a></div>
          ${news && news.items && news.items.length ? `<div class="newsfeed">${newsList(news.items, 9)}</div>
            <div class="news-foot">Headlines from ESPN, CBS, Yahoo &amp; Sporting News · updated ${timeAgo(news.fetched)} ago</div>` :
            `<p class="muted" style="font-size:14px">News feed unavailable right now.</p>`}
        </div>
        <div class="stack">
          <div class="card big pad reveal" id="standHome"></div>
          <div class="card big pad reveal" id="leadersHome"></div>
        </div>
      </div>

      <div class="reveal" style="margin-top:22px">
        <div class="card big pad">
          <div class="card-h"><h3>All-time scoring leaders</h3><a class="hint" href="#/leaders/all" style="color:var(--ink-3)">All-time →</a></div>
          <ol class="rank rank-2col">${(await getAlltime()).career.pts.slice(0, 8).map((r, i) => `<li class="${i === 0 ? "top" : ""}">
            <span class="rk">${i + 1}</span><span class="who">${headshot(r[0], r[1], r[2], "xs")}<a class="nm" href="#/player/${r[0]}">${esc(r[1])}</a>
            <span class="yr-span">${String(r[4]).slice(2)}–${String(r[5]).slice(2)}</span></span><span class="val">${intc(r[3])}</span></li>`).join("")}</ol>
          <div class="news-foot">Career points · all-time</div>
        </div>
      </div>

      <div class="reveal" id="thisDayHome" style="margin-top:22px"></div>

    </div>`;

    getThisday().then((td) => {
      const el = $("#thisDayHome"); if (!el || !td) return;
      const now = new Date(), md = String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
      const entry = td[md]; if (!entry || !entry.games || !entry.games.length) return;
      const gm = (g) => { const done = g.hs != null && g.as != null, hw = done && g.hs > g.as;
        return `<a class="td-game" href="#/game/${g.id}">
          <span class="td-date">${fmtDate(g.date, true)}</span>
          <span class="td-match"><span class="td-team">${teamLogo(g.a, "xs")}${g.a}</span><span class="td-sc${done && !hw ? " w" : ""}">${g.as != null ? g.as : ""}</span>
            <span class="td-at">@</span><span class="td-sc${hw ? " w" : ""}">${g.hs != null ? g.hs : ""}</span><span class="td-team">${teamLogo(g.h, "xs")}${g.h}</span></span>
          ${g.label ? `<span class="td-lbl">${esc(g.label)}</span>` : ""}</a>`; };
      el.innerHTML = `<div class="card big pad">
        <div class="card-h"><h3>${entry.exact ? "On this day in NBA history" : "Around this time of year"}</h3><a class="hint" href="#/seasons" style="color:var(--ink-3)">Seasons →</a></div>
        <div class="td-list">${entry.games.map(gm).join("")}</div></div>`;
    });

    $("#leadersHome").innerHTML = `<div class="card-h"><h3>${seasonLabel(cur)} leaders</h3>
      <div class="tabs" role="tablist" data-leadtabs>${["pts", "trb", "ast", "per"].map((k, i) => `<button role="tab" data-k="${k}" aria-selected="${i === 0}">${CATMAP[k][1]}</button>`).join("")}</div></div>
      <div data-leadbody>${leaderList(S, "pts", 6)}</div>`;
    wireLeadTabs($("#leadersHome"), S, 6);

    const conf = splitConf(st), keys = Object.keys(conf);
    $("#standHome").innerHTML = `<div class="card-h"><h3>Standings</h3>
      ${keys.length > 1 ? `<div class="tabs" data-conf>${keys.map((k, i) => `<button data-k="${k}" aria-selected="${i === 0}">${k}</button>`).join("")}</div>` : ""}</div>
      <div class="mini-stand" id="miniStand">${miniStanding(conf[keys[0]])}</div>
      <div style="margin-top:14px"><a class="link" href="#/standings">Full standings →</a></div>`;
    if (keys.length > 1) $$("#standHome [data-conf] button").forEach((b) => b.addEventListener("click", () => {
      $$("#standHome [data-conf] button").forEach((x) => x.setAttribute("aria-selected", "false"));
      b.setAttribute("aria-selected", "true"); $("#miniStand").innerHTML = miniStanding(conf[b.dataset.k]);
    }));

    $("#featured").innerHTML = await playerCards(featIds);
    wireSearch($("#mastSearch"), $("#mastResults"));
  }
  const leagueTile = (k, big, lab) => `<div class="c"><div class="lk">${k}</div><div class="big">${big}</div><div class="lab">${lab}</div></div>`;
  const leagueStatTile = (rows, k, unit) => {
    if (!rows || !rows.length) return leagueTile(k, "—", "");
    const r = rows[0];
    return `<div class="c"><div class="lk">${k}</div><div class="big">${one(r[3])}</div><div class="lab">${headshot(r[0], r[1], r[2], "xs")} ${pLink(r[0], r[1])}</div></div>`;
  };
  function wireLeadTabs(scope, S, n = 10) {
    const tabs = $("[data-leadtabs]", scope), body = $("[data-leadbody]", scope);
    $$("button", tabs).forEach((b) => b.addEventListener("click", () => {
      $$("button", tabs).forEach((x) => x.setAttribute("aria-selected", "false"));
      b.setAttribute("aria-selected", "true"); body.innerHTML = leaderList(S, b.dataset.k, n);
    }));
  }

  /* ================= NEWS ================= */
  /* ================= BETTING / SLATE ================= */
  async function renderBetting() {
    let gidx; try { gidx = await getGamesIdx(META.current); } catch { return notFound("games"); }
    const S = await getSeason(META.current).catch(() => null);
    const injD = SHOW_INJURIES ? await getInjuries().catch(() => null) : null;
    const oddsD = await getOdds().catch(() => null);
    const byTeam = (injD && injD.byTeam) || {}, byPlayer = (injD && injD.byPlayer) || {};
    const oddsBy = (oddsD && oddsD.byGame) || {}, oddsBook = (oddsD && oddsD.book) || "";
    const ml = (v) => (v == null ? "—" : v > 0 ? "+" + v : "" + v);
    const oddsLive = oddsBook && oddsBook !== "sample";   // never show placeholder lines as if real
    const oddsLine = (g) => { const o = oddsBy[`${g.a}@${g.h}`]; if (!o || !oddsLive) return "";
      return `<div class="bh-odds">${o.spread != null ? `<span class="oc">${g.h} <b>${o.spread > 0 ? "+" + o.spread : o.spread}</b></span>` : ""}${o.total != null ? `<span class="oc">O/U <b>${o.total}</b></span>` : ""}${o.mlA != null ? `<span class="oc">${g.a} ML <b>${ml(o.mlA)}</b> · ${g.h} <b>${ml(o.mlH)}</b></span>` : ""}<span class="obk">${esc(oddsBook)}</span></div>`; };
    const rec = {}; ((S && S.standings) || []).forEach((r) => (rec[r.abbr] = r));
    const lastNm = (n) => (n || "").split(" ").slice(-1)[0];
    const injLine = (ab) => { const list = byTeam[ab] || []; if (!list.length) return ""; const out = list.filter((x) => x.status === "Out"), dtd = list.length - out.length;
      return `<span class="bh-inj"><b>${ab}</b>${out.length ? ` <span class="inj-out">OUT ${esc(out.slice(0, 3).map((x) => lastNm(x.name)).join(", "))}${out.length > 3 ? " +" + (out.length - 3) : ""}</span>` : ""}${dtd ? ` <span class="inj-dtd">${dtd} day-to-day</span>` : ""}</span>`; };
    const games = gidx.games.filter((g) => g.hs != null && g.as != null);
    const byDate = {}; games.forEach((g) => (byDate[g.date] = byDate[g.date] || []).push(g));
    const slateDate = Object.keys(byDate).sort().pop();
    // "Today's slate" only makes sense during the season. If the newest game is well in the
    // past (offseason / between seasons), don't present a months-old game as today's.
    const daysStale = slateDate ? Math.floor((Date.now() - new Date(slateDate + "T12:00:00Z").getTime()) / 86400000) : Infinity;
    const offseason = daysStale > 10;
    const slate = offseason ? [] : (byDate[slateDate] || []);
    const trend = (ab) => {
      const gs = games.filter((g) => g.h === ab || g.a === ab).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
      if (!gs.length) return null;
      let w = 0, pf = 0, pa = 0, tot = 0, marg = 0;
      const form = gs.map((g) => { const home = g.h === ab, us = home ? g.hs : g.as, them = home ? g.as : g.hs; if (us > them) w++; pf += us; pa += them; tot += us + them; marg += us - them; return us > them; });
      const n = gs.length; return { n, w, l: n - w, pf: pf / n, pa: pa / n, tot: tot / n, marg: marg / n, form };
    };
    const teamRow = (ab) => { const t = trend(ab), r = rec[ab] || {};
      const form = t ? t.form.slice(0, 5).map((wn) => `<span class="bf ${wn ? "w" : "l"}">${wn ? "W" : "L"}</span>`).join("") : "";
      return `<div class="bh-team"><a class="bh-id" href="#/team/${ab}">${teamLogo(ab, "sm")}<span class="ab">${ab}</span></a>
        <span class="bh-rec">${r.w != null ? r.w + "–" + r.l : "—"}</span><span class="bh-form">${form}</span>
        <span class="bh-stat">${t ? one(t.pf) : "—"}<small>PF/g</small></span><span class="bh-stat">${t ? one(t.pa) : "—"}<small>PA/g</small></span></div>`;
    };
    const gameCard = (g) => { const ta = trend(g.a), th = trend(g.h);
      const projTotal = ta && th ? Math.round((ta.tot + th.tot) / 2) : null;
      const edge = ta && th ? (ta.marg > th.marg ? g.a : g.h) : null;
      return `<div class="card pad bhcard"><div class="bh-head"><span class="bh-match"><a href="#/team/${g.a}">${g.a}</a> <span class="at">@</span> <a href="#/team/${g.h}">${g.h}</a></span><a class="link" href="#/game/${g.id}">Box score →</a></div>
        ${teamRow(g.a)}${teamRow(g.h)}
        ${oddsLine(g)}
        ${(byTeam[g.a] || byTeam[g.h]) ? `<div class="bh-injs">${injLine(g.a)}${injLine(g.h)}</div>` : ""}
        <div class="bh-trend">${projTotal ? `<span class="bh-chip">Combined total <b>~${projTotal}</b></span>` : ""}${edge ? `<span class="bh-chip">Recent edge <b>${edge}</b></span>` : ""}${ta && th ? `<span class="bh-chip">Form <b>${g.a} ${ta.w}-${ta.l}</b> · <b>${g.h} ${th.w}-${th.l}</b></span>` : ""}</div></div>`;
    };
    const props = ((S && S.leaders && S.leaders.pts) || []).slice(0, 6);
    setSEO("Today's Slate — Matchups & Trends", "NBA matchup trends, recent form and player prop context for today's slate.");
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>Betting</span></div>
      <div class="section-title"><div><span class="eyebrow">${offseason ? "Offseason · " + seasonLabel(META.current) + " season complete" : "Matchups & trends · " + (slateDate ? fmtDate(slateDate, true) : "latest")}</span><h2>${offseason ? "Matchups & trends" : "Today's slate"}</h2></div></div>
      <div class="rg-note">Trends are informational only and not betting advice. 21+. Gambling problem? Call <b>1-800-GAMBLER</b>.</div>
      <div class="ad-inline"><span class="lbl">Sponsored</span><div class="slot">Sportsbook placement · 728×90</div></div>
      <div class="bhgrid">${slate.length ? slate.map(gameCard).join("") : `<p class="muted">${offseason ? `The ${seasonLabel(META.current)} season is complete — no games on the slate. Season leaders and trends are below.` : "No games on the current slate — the season is between dates."}</p>`}</div>
      ${props.length ? `<div class="section-title small" style="margin-top:26px"><div><h2>Player props to watch</h2></div><span class="hint">season leaders · tap for trends</span></div>
        <div class="ptiles">${props.map((r) => { const ij = byPlayer[r[0]]; return `<a class="ptile" href="#/player/${r[0]}"><span class="ptile-mark">${esc(initials(r[1]))}</span><span class="ptile-body"><span class="ptile-tag">${esc(r[2])} · ${one(r[3])} PPG${ij ? ` <span class="inj-tag ${ij.status === "Out" ? "out" : "dtd"}">${ij.status === "Out" ? "OUT" : "GTD"}</span>` : ""}</span><b>${esc(r[1])}</b><span class="ptile-d">Points, rebounds & assists trends</span></span><span class="ptile-go">→</span></a>`; }).join("")}</div>` : ""}
    </div>`;
  }

  /* ================= SETTINGS ================= */
  /* ---------- Settings (modal overlay, not a page) ---------- */
  let _setModal = null;
  const _setSeg = (name, cur, opts) => `<div class="seg-toggle set-seg" data-set="${name}">${opts.map((o) => `<button data-v="${o[0]}" aria-pressed="${o[0] === cur}">${o[1]}</button>`).join("")}</div>`;
  function _setEsc(e) { if (e.key === "Escape") closeSettings(); }
  function openSettings() {
    if (!_setModal) {
      _setModal = document.createElement("div");
      _setModal.className = "smodal"; _setModal.hidden = true;
      document.body.appendChild(_setModal);
      _setModal.addEventListener("click", (e) => {
        if (e.target.closest(".smodal-backdrop") || e.target.closest(".smodal-x")) { closeSettings(); return; }
        if (e.target.closest("a")) { closeSettings(); return; }          // let legal links navigate
        const b = e.target.closest(".set-seg button"); if (!b) return;
        const set = b.closest(".set-seg").dataset.set;
        if (set === "theme") applyTheme(b.dataset.v, true); else if (set === "density") applyDensity(b.dataset.v, true);
        b.closest(".set-seg").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      });
    }
    _setModal.innerHTML = `<div class="smodal-backdrop"></div>
      <div class="smodal-panel" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="smodal-head"><h2>Settings</h2><button class="smodal-x" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
        <div class="set-card">
          <div class="set-row"><div class="set-l"><b>Appearance</b><span>Light, dark, or match your device.</span></div>${_setSeg("theme", themeMode(), [["system", "System"], ["light", "Light"], ["dark", "Dark"]])}</div>
          <div class="set-row"><div class="set-l"><b>Table density</b><span>Comfortable, or compact for more per screen.</span></div>${_setSeg("density", curDensity(), [["comfortable", "Comfortable"], ["compact", "Compact"]])}</div>
        </div>
        <p class="smodal-note">Stored on this device only. <a class="link" href="#/terms">Terms</a> · <a class="link" href="#/privacy">Privacy</a></p>
      </div>`;
    _setModal.hidden = false; document.body.classList.add("cmdk-open");
    document.addEventListener("keydown", _setEsc);
  }
  function closeSettings() { if (_setModal) _setModal.hidden = true; document.body.classList.remove("cmdk-open"); document.removeEventListener("keydown", _setEsc); }

  /* ================= LEGAL ================= */
  function legalPage(title, sub, sections) {
    setSEO(title, sub);
    app.innerHTML = `<div class="wrap page" style="max-width:760px">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>${esc(title)}</span></div>
      <div class="section-title"><div><span class="eyebrow">${esc(sub)}</span><h2>${esc(title)}</h2></div></div>
      <div class="legal">${sections.map((s) => `<h3>${esc(s[0])}</h3><p>${s[1]}</p>`).join("")}
        <p class="legal-foot">Last updated ${seasonLabel(META.current).slice(0, 4)}. Questions about this policy can be sent through the contact options in the app.</p></div>
    </div>`;
  }
  function renderTerms() {
    legalPage("Terms of Service", "The rules for using this site", [
      ["Acceptance of terms", "By accessing or using this website you agree to these Terms of Service. If you do not agree, please do not use the site."],
      ["Use of the site", "This site is provided for personal, non-commercial reference and entertainment. You may browse, search, and share links to pages. You agree not to scrape, resell, or redistribute the data in bulk, disrupt the service, or attempt to gain unauthorized access to any part of it."],
      ["Content and accuracy", "Statistics, ratings, and other information are compiled from public datasets and provided on an “as is” basis for informational purposes. We make no warranty that the content is complete, accurate, or current, and it should not be relied upon for wagering, financial, or other consequential decisions."],
      ["Intellectual property", "Team names, logos, player likenesses, and league marks are the property of their respective owners and are used here for identification and reference only. This site is an independent project and is not affiliated with, endorsed by, or sponsored by any professional league or team."],
      ["Games and puzzles", "Interactive games are provided for entertainment only. There is no entry fee, prize, or wager of any kind."],
      ["Limitation of liability", "To the fullest extent permitted by law, the site and its operators are not liable for any indirect, incidental, or consequential damages arising from your use of the site."],
      ["Changes", "We may update these terms from time to time. Continued use of the site after changes take effect constitutes acceptance of the revised terms."],
    ]);
  }
  function renderPrivacy() {
    legalPage("Privacy Policy", "How we handle your information", [
      ["Overview", "We aim to collect as little personal information as possible. This site is a reference and entertainment tool and does not require you to create an account."],
      ["Information we store", "Your display preferences — such as theme, table density, recent searches, and game progress — are stored locally in your browser using local storage. This information stays on your device and is not transmitted to us."],
      ["Analytics", "We may collect aggregate, non-identifying usage statistics (such as which pages are viewed) to understand how the site is used and to improve it. This data is not used to identify individual visitors."],
      ["Advertising", "Pages may display advertising. Where third-party ad services are used, they may set their own cookies subject to their own policies; we do not share personal information with them."],
      ["Cookies and local storage", "We use local storage for your preferences and, where applicable, cookies for basic functionality and measurement. You can clear this data at any time through your browser settings."],
      ["Children", "The site is intended for a general audience and is not directed at children under 13, and we do not knowingly collect personal information from them."],
      ["Your choices", "You can clear stored preferences by clearing your browser data. You can also use your browser or device privacy controls to limit tracking."],
      ["Changes", "We may update this policy periodically. Material changes will be reflected by updating the date on this page."],
    ]);
  }

  /* ================= PLAYOFF BRACKET ================= */
  // Reconstructs a season's postseason from the game index: playoff games carry a label like
  // "East First Round · Game 3" / "NBA Finals · Game 5", so we group them into series, tally
  // each series result, and lay the rounds out as a bracket that converges on the Finals.
  const BR_ROUND = (lab) => /first round/i.test(lab) ? 1 : /semifinal/i.test(lab) ? 2 : /conf.*final|conference final/i.test(lab) ? 3 : /nba finals|^finals/i.test(lab) ? 4 : 0;
  const BR_CONF = (lab) => /^east/i.test(lab) ? "E" : /^west/i.test(lab) ? "W" : "F";
  async function renderBracket(y) {
    const yr = +y;
    let idx, S;
    try { idx = await getGamesIdx(yr); } catch { return notFound("season"); }
    S = await getSeason(yr).catch(() => null);
    const pf = (idx.games || []).filter((g) => g.type === "Playoffs" && g.label);
    setSEO(`${seasonLabel(yr)} Playoff Bracket`, `The complete ${seasonLabel(yr)} NBA postseason — every series result from the first round to the Finals.`);
    const crumb = `<div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/season/${yr}">${seasonLabel(yr)}</a><span class="sep">/</span><span>Bracket</span></div>`;
    if (!pf.length) {
      app.innerHTML = `<div class="wrap page">${crumb}
        <div class="section-title"><div><span class="eyebrow">Postseason</span><h2>${seasonLabel(yr)} playoff bracket</h2></div>${seasonSelect(yr, "bracket")}</div>
        <p class="muted" style="margin-top:8px">A game-by-game playoff bracket isn't available for this season yet.</p></div>`;
      wireSeasonSelect(); return;
    }
    // group into series keyed by round + conference + the two teams
    const series = {};
    for (const g of pf) {
      const rnd = BR_ROUND(g.label), conf = BR_CONF(g.label);
      if (!rnd) continue;
      const pair = [g.a, g.h].sort();
      const key = rnd + conf + pair.join("");
      (series[key] = series[key] || { rnd, conf, teams: pair, w: {}, n: 0, last: g }).n++;
      const s = series[key];
      const wn = g.hs > g.as ? g.h : g.a;
      s.w[wn] = (s.w[wn] || 0) + 1;
      if (g.date > s.last.date) s.last = g;
    }
    const list = Object.values(series);
    // seed order from regular-season record (higher record listed first); play-in seeds may
    // differ so we don't stamp a seed number — just order the matchup by record.
    const rec = {}; ((S && S.standings) || []).forEach((r) => (rec[r.abbr] = r.w != null ? r.w : 0));
    const seriesCard = (s) => {
      const [wins, losses] = [Math.max(...Object.values(s.w)), Math.min(...(Object.keys(s.w).length > 1 ? Object.values(s.w) : [0]))];
      const winner = Object.keys(s.w).reduce((a, b) => (s.w[a] >= s.w[b] ? a : b));
      const other = s.teams.find((t) => t !== winner);
      const rows = [winner, other].filter(Boolean).sort((a, b) => (rec[b] || 0) - (rec[a] || 0));
      const row = (ab) => `<a class="br-tm${ab === winner ? " win" : ""}" href="#/team/${ab}"><span class="br-tl">${teamLogo(ab, "xs")}<span class="ab">${ab}</span></span><span class="br-w">${s.w[ab] || 0}</span></a>`;
      return `<a class="br-series" href="#/game/${s.last.id}" title="${esc(s.last.label.replace(/\s*·.*$/, ""))} — ${winner} in ${s.n}">${rows.map(row).join("")}</a>`;
    };
    const col = (rnd, conf, label) => {
      const cards = list.filter((s) => s.rnd === rnd && s.conf === conf).map((s) => [rec[s.teams.find((t) => t === Object.keys(s.w).reduce((a, b) => (s.w[a] >= s.w[b] ? a : b)))] || 0, s]).sort((a, b) => b[0] - a[0]).map((x) => seriesCard(x[1]));
      return `<div class="br-col"><div class="br-col-h">${label}</div><div class="br-col-body">${cards.join("")}</div></div>`;
    };
    const champ = (S && S.champion && S.champion.team) || (list.find((s) => s.conf === "F") ? (() => { const f = list.find((s) => s.conf === "F"); return Object.keys(f.w).reduce((a, b) => (f.w[a] >= f.w[b] ? a : b)); })() : null);
    const finalsCol = `<div class="br-finals">
      <div class="br-col-h">Finals</div>
      ${list.filter((s) => s.conf === "F").map(seriesCard).join("")}
      ${champ ? `<div class="br-champ" style="--tc:${tColor(champ)}">${teamLogo(champ, "lg")}<div><span class="eyebrow">Champion</span><b><a href="#/team/${champ}">${esc(tName(champ))}</a></b>${S && S.champion && S.champion.fmvp ? `<span class="fmvp">Finals MVP · <a href="#/player/${S.champion.fmvp_id}">${esc(S.champion.fmvp)}</a></span>` : ""}</div></div>` : ""}
    </div>`;
    app.innerHTML = `<div class="wrap page">${crumb}
      <div class="section-title"><div><span class="eyebrow">Postseason · ${pf.length} games</span><h2>${seasonLabel(yr)} playoff bracket</h2></div>${seasonSelect(yr, "bracket")}</div>
      <div class="bracket-scroll"><div class="bracket">
        <div class="br-conf"><div class="br-side-h">East</div><div class="br-rounds">${col(1, "E", "First Round")}${col(2, "E", "Conf. Semis")}${col(3, "E", "Conf. Finals")}</div></div>
        ${finalsCol}
        <div class="br-conf rtl"><div class="br-side-h">West</div><div class="br-rounds">${col(3, "W", "Conf. Finals")}${col(2, "W", "Conf. Semis")}${col(1, "W", "First Round")}</div></div>
      </div></div>
      <p class="muted" style="font-size:13px;margin-top:14px">Series ordered by regular-season record. Tap a matchup for its box scores.</p>
    </div>`;
    wireSeasonSelect();
  }

  /* ================= PLAY / PUZZLES ================= */
  const GRID_POOL = ["LAL", "BOS", "GSW", "CHI", "MIA", "NYK", "PHI", "DAL", "DEN", "MIL", "PHX", "SAS", "HOU", "CLE", "TOR", "ATL", "MEM", "OKC", "MIN", "SAC", "IND", "POR", "WAS", "DET", "ORL", "NOP", "CHA", "UTA", "BKN", "LAC"];
  const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  function daySeed(dateStr) { const d = dateStr || new Date().toISOString().slice(0, 10); let h = 2166136261; for (const c of d) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  // Every date the Daily NBA Grid has a board for: from launch (Jul 4 2026) through today, newest first.
  const GRID_START = "2026-07-04";
  function gridDates() {
    const today = new Date().toISOString().slice(0, 10);
    const cur = today >= GRID_START ? today : GRID_START;
    const start = new Date(GRID_START + "T00:00:00Z");
    const out = []; let d = new Date(cur + "T00:00:00Z");
    while (d >= start && out.length < 400) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
    return out;
  }
  const gridDone = () => { try { return JSON.parse(localStorage.getItem("hw-grid-done") || "[]"); } catch (e) { return []; } };
  const markGridDone = (date) => { try { const s = new Set(gridDone()); s.add(date); localStorage.setItem("hw-grid-done", JSON.stringify([...s])); } catch (e) {} };
  // franchise-relocation aliases so career-team checks count e.g. Sonics as OKC
  const FRANCHISE = { OKC: ["OKC", "SEA"], WAS: ["WAS", "WSB"], UTA: ["UTA", "NOJ"], SAC: ["SAC", "KCK"], BKN: ["BKN", "NJN"], NOP: ["NOP", "NOH", "NOK"], MEM: ["MEM", "VAN"], LAC: ["LAC", "SDC", "BUF"], CHA: ["CHA", "CHH"], HOU: ["HOU", "SDR"], GSW: ["GSW", "SFW", "PHW"], DET: ["DET", "FTW"], ATL: ["ATL", "STL", "MLH"], PHI: ["PHI", "SYR"], LAL: ["LAL", "MNL"] };
  const teamAliases = (ab) => new Set(FRANCHISE[ab] || [ab]);

  // Launcher hub — restrained, editorial: monogram marks, one accent, no clutter.
  async function renderPlay() {
    setSEO("Arcade — NBA Games & Puzzles", "NBA games and puzzles: the Daily NBA Grid, Stat Duel, Buzzer Beater and Six Spins.");
    // Line-icon marks give each game its own identity (was a generic monogram avatar).
    const ICON = {
      grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17"/></svg>`,
      duel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 20V6m0 0L4 9.5M7.5 6 11 9.5M16.5 4v14m0 0L13 14.5M16.5 18 20 14.5"/></svg>`,
      buzzer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5v17M6 6c3.2 2.8 3.2 9.2 0 12M18 6c-3.2 2.8-3.2 9.2 0 12" stroke-width="1.5"/></svg>`,
      spin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12a8.5 8.5 0 1 1-2.4-5.9"/><path d="M20.5 4.5v4h-4"/></svg>`,
    };
    const games = [
      { t: "Six Spins", d: "A continuous build — keep spinning to draft attributes toward a 99-overall player.", tag: "Continuous", href: "#/play/sixspins", ic: ICON.spin, live: true },
      { t: "Daily NBA Grid", d: "Fill every square with a player who suited up for both teams. New board every day.", tag: "New board daily", href: "#/play/grid", ic: ICON.grid, live: true },
      { t: "Stat Duel", d: "Higher or lower — pick the player with the bigger career number. Build a streak.", tag: "Endless", href: "#/play/duel", ic: ICON.duel, live: true },
      { t: "Buzzer Beater", d: "Time your release in the sweet spot and sink as many as you can before the miss meter fills.", tag: "Arcade", href: "#/play/buzzer", ic: ICON.buzzer },
    ];
    const tile = (g) => `<a class="ptile${g.live ? " live" : ""}" href="${g.href}" ${g.ext ? 'target="_blank" rel="noopener noreferrer"' : ""}>
      <span class="ptile-mark">${g.ic}</span>
      <span class="ptile-body"><b>${esc(g.t)}</b><span class="ptile-d">${esc(g.d)}</span></span>
      <span class="ptile-go">${g.ext ? "↗" : "→"}</span></a>`;
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>Arcade</span></div>
      <div class="section-title"><div><span class="eyebrow">NBA games &amp; puzzles</span><h2>Arcade</h2></div></div>
      <a class="ss-hero" href="#/play/sixspins">
        <div class="ss-hero-l"><span class="eyebrow">Featured · Six Spins</span>
          <h3>Spin your way to a 99 overall.</h3>
          <p>A continuous build — keep spinning to draft attributes and shape a 99-overall player, one wheel at a time. Plays right here on Dunkwise.</p>
          <span class="ss-hero-cta">Play Six Spins <span>→</span></span></div>
        <div class="ss-hero-mark"><span>SIX</span><span>SPINS</span></div>
      </a>
      <div class="section-title small" style="margin-top:26px"><div><h2>All games</h2></div></div>
      <div class="ptiles">${games.map(tile).join("")}</div>
    </div>`;
  }

  // ============================ Six Spins (native) ============================
  // Ported from the Six Spins app to run inline in the Dunkwise SPA — no iframe. Each
  // spin lands on a random all-time team-year roster; steal one ability rating from a
  // player, fill all six abilities across six spins, and the picks roll up into a 2K-
  // style OVR. Data + player/team images are the deployed /sixspins/ static assets.
  const SS = {
    ABIL: [
      { k: "shooting",   label: "Shooting",   short: "SHOOT" },
      { k: "scoring",    label: "Scoring",    short: "SCORE" },
      { k: "playmaking", label: "Playmaking", short: "PASS" },
      { k: "defense",    label: "Defense",    short: "DEF" },
      { k: "rebounding", label: "Rebounding", short: "REB" },
      { k: "clutch",     label: "Clutch",     short: "CLUTCH" },
    ],
    STATS: [["ppg", "PPG"], ["rpg", "RPG"], ["apg", "APG"], ["spg", "SPG"], ["bpg", "BPG"]],
    ERAS: [{ id: "all", label: "Classic", seasons: null }, { id: "modern", label: "Modern", seasons: ["2000s", "2010s", "2020s"] }],
    ICON: {
      reroll: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12a8.5 8.5 0 1 1-2.4-5.9"/><path d="M20.5 4.5v4h-4"/></svg>`,
      shooting: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>`,
      scoring: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c1.2 3 4 4.2 4 8a4 4 0 0 1-8 0c0-1.8.9-3 1.4-3.6.4 1.6 2 2.1 2 2.1.6-1.2-.6-4 .6-6.5z"/></svg>`,
      playmaking: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h13l-3.5-3.5M21 15H8l3.5 3.5"/></svg>`,
      defense: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4-3 7.2-7 8.4C8 18.2 5 15 5 11V6z"/></svg>`,
      rebounding: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M8.5 7v3M15.5 7v3"/><circle cx="12" cy="15" r="4"/></svg>`,
      clutch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V9.5M9.5 3h5M18.5 6l1.5-1.5"/></svg>`,
    },
    // historical franchise identities (decade grain) — display only; game keys off the canonical id
    ERAMAP: {
      OKC: [{ until: 2008, id: "SEA", name: "SuperSonics", color: "#00653A" }],
      BRK: [{ until: 1977, id: "NYN", name: "Nets", color: "#C8102E" }, { until: 2012, id: "NJN", name: "Nets", color: "#002A60" }],
      LAL: [{ until: 1960, id: "MNL", name: "Lakers", color: "#0C2C56" }],
      GSW: [{ until: 1962, id: "PHW", name: "Warriors", color: "#1D428A" }, { until: 1971, id: "SFW", name: "Warriors", color: "#FFC72C" }],
      PHI: [{ until: 1963, id: "SYR", name: "Nationals", color: "#D50032" }],
      DET: [{ until: 1957, id: "FTW", name: "Pistons", color: "#C8102E" }],
      ATL: [{ until: 1951, id: "TRI", name: "Blackhawks", color: "#00653A" }, { until: 1955, id: "MLH", name: "Hawks", color: "#E03A3E" }, { until: 1968, id: "STL", name: "Hawks", color: "#E03A3E" }],
      HOU: [{ until: 1971, id: "SDR", name: "Rockets", color: "#00653A" }],
      UTA: [{ until: 1979, id: "NOJ", name: "Jazz", color: "#5A2D81" }],
      MEM: [{ until: 2001, id: "VAN", name: "Grizzlies", color: "#00B2A9" }],
      WAS: [{ until: 1973, id: "BAL", name: "Bullets", color: "#F58426" }, { until: 1997, id: "WSB", name: "Bullets", color: "#002B5C" }],
      SAC: [{ until: 1957, id: "ROC", name: "Royals", color: "#1D428A" }, { until: 1972, id: "CIN", name: "Royals", color: "#1D428A" }, { until: 1985, id: "KCK", name: "Kings", color: "#1D428A" }],
      LAC: [{ until: 1978, id: "BUF", name: "Braves", color: "#F58426" }, { until: 1984, id: "SDC", name: "Clippers", color: "#C8102E" }],
      CHO: [{ until: 2002, id: "CHH", name: "Hornets", color: "#008CA8" }, { until: 2014, id: "CHA", name: "Bobcats", color: "#2A5DA8" }],
      NOP: [{ until: 2013, id: "NOH", name: "Hornets", color: "#00285E" }],
    },
    data: null, view: null, era: "all", state: null, sort: "ppg", cardOpen: false, timers: [],
  };

  function ssClearTimers() { SS.timers.forEach(clearTimeout); SS.timers = []; }
  function ssCloseSheets() { document.querySelectorAll(".sheet-backdrop").forEach((el) => el.remove()); }
  function ssT(fn, ms) { const id = setTimeout(fn, ms); SS.timers.push(id); return id; }
  const ssSeasonLabel = (s) => (typeof s === "string" && /^\d{4}s$/.test(s) ? s.slice(2) : s);
  const ssInitials = (n) => { const p = (n || "?").trim().split(/\s+/); return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase(); };
  function ssReadable(hex) { const h = (hex || "#333").replace("#", ""); const v = h.length === 3 ? h.split("").map(c => c + c).join("") : h; const r = parseInt(v.slice(0, 2), 16) || 0, g = parseInt(v.slice(2, 4), 16) || 0, b = parseInt(v.slice(4, 6), 16) || 0; return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#0a0a0f" : "#ffffff"; }

  function ssFranchiseEra(fr, season) {
    const eras = SS.ERAMAP[fr]; if (!eras || season == null) return null;
    const y = /^\d{4}s$/.test(String(season)) ? Number(String(season).slice(0, 4)) + 5 : Number(season);
    if (Number.isNaN(y)) return null;
    return eras.find((e) => y <= e.until) || null;
  }
  function ssTeamDisplay(fr, season) {
    const f = SS.data.franchisesById.get(fr), era = ssFranchiseEra(fr, season);
    const name = (era && era.name) || (f && f.name) || fr || "—";
    return { id: fr, logoId: (era && era.id) || fr, name, color: (era && era.color) || (f && f.color) || "#2a2a36", label: season != null ? ssSeasonLabel(season) + " " + name : name };
  }

  // player headshot (.avatar) + team logo (.ssg-mark) from the deployed /sixspins/ image set;
  // initials / abbreviation badge show through on a 404 (the headshot fades in over them).
  function ssAvatar(p, color, size, rounded) {
    const tx = ssReadable(color), slug = p && p.player_id, ok = slug && /^[a-z.'-]{3,}\d{2}$/.test(slug);
    const img = ok ? `<img class="avatar__img" src="/sixspins/img/players/${slug}.webp" alt="" loading="lazy" decoding="async" onload="this.classList.add('is-loaded')" onerror="this.remove()">` : "";
    return `<div class="avatar" style="width:${size}px;height:${size}px;border-radius:${rounded == null ? 9 : rounded}px;background:${color};color:${tx};font-size:${Math.round(size * 0.36)}px"><span class="avatar__initials">${esc(ssInitials(p && p.name))}</span>${img}</div>`;
  }
  function ssMark(td, size, round) {
    const tx = ssReadable(td.color), r = round == null ? 6 : round;
    return `<span class="ssg-mark" style="width:${size}px;height:${size}px;border-radius:${r}px"><span class="tlogo-badge" style="background:${td.color};color:${tx};border-radius:${r}px;font-size:${Math.round(size * 0.34)}px">${esc(td.id)}</span><img src="/sixspins/img/teams/${td.logoId}.webp" alt="" loading="lazy" decoding="async" onerror="this.remove()"></span>`;
  }

  async function ssLoad() {
    if (SS.data) return SS.data;
    const [data, pct] = await Promise.all([
      fetch("/sixspins/data/goat-data.json").then((r) => r.json()),
      fetch("/sixspins/data/percentile-table.json").then((r) => r.json()),
    ]);
    const cells = new Map();
    for (const [key, roster] of Object.entries(data.pool.rosters)) cells.set(key, roster);
    SS.data = {
      players: data.players,
      playersById: new Map(data.players.map((p) => [p.id, p])),
      franchises: data.pool.franchises,
      franchisesById: new Map(data.pool.franchises.map((f) => [f.id, f])),
      seasons: data.pool.seasons,
      cells,
      ceiling: data.ceiling,
      anchorAll: (pct && pct.ovr_anchor) || 588,
      anchors: Object.fromEntries(Object.entries((pct && pct.eras) || {}).map(([k, v]) => [k, v.ovr_anchor])),
    };
    return SS.data;
  }

  // build the era-filtered pool view (cell list + the two reroll axes)
  function ssSetView() {
    const era = SS.ERAS.find((e) => e.id === SS.era) || SS.ERAS[0];
    const keep = era.seasons ? new Set(era.seasons) : null;
    const cellList = [], bySeason = new Map(), byFranchise = new Map();
    for (const key of SS.data.cells.keys()) {
      const i = key.indexOf("_"), season = key.slice(0, i), fr = key.slice(i + 1);
      if (keep && !keep.has(season)) continue;
      cellList.push(key);
      if (!bySeason.has(season)) bySeason.set(season, []);
      bySeason.get(season).push(fr);
      if (!byFranchise.has(fr)) byFranchise.set(fr, []);
      byFranchise.get(fr).push(season);
    }
    SS.view = { cellList, bySeason, byFranchise, anchor: (SS.era !== "all" && SS.data.anchors[SS.era]) || SS.data.anchorAll };
  }

  // 2K-style OVR: a curved map of the six-rating total, era-fair anchor -> 99 (see helpers.js)
  function ssOvr(total) { const LO_T = 470, LO = 78, a = SS.view.anchor > LO_T ? SS.view.anchor : 588; return Math.max(40, Math.min(99, Math.round(99 - (a - total) * ((99 - LO) / (a - LO_T))))); }
  const ssTier = (v) => (v >= 99 ? "goat" : v >= 90 ? "elite" : v >= 82 ? "great" : v >= 74 ? "good" : v >= 65 ? "mid" : "low");
  const SS_TIERS = [{ min: 99, label: "GOAT" }, { min: 90, label: "Superstar" }, { min: 82, label: "All-Star" }, { min: 74, label: "Starter" }, { min: 65, label: "Rotation" }, { min: 0, label: "Bench" }];
  const ssOvrTier = (o) => SS_TIERS.find((t) => o >= t.min) || SS_TIERS[SS_TIERS.length - 1];

  const ssParts = (key) => { const i = key.indexOf("_"); return { season: key.slice(0, i), franchise: key.slice(i + 1) }; };
  const ssDeal = () => ssParts(SS.view.cellList[Math.floor(Math.random() * SS.view.cellList.length)]);
  const ssRoster = (season, fr) => (SS.data.cells.get(season + "_" + fr) || []).map((id) => SS.data.playersById.get(id)).filter(Boolean);

  // find the real player-season that plays most like the built card (profile-shape match)
  function ssComp(slots) {
    const players = SS.data.players, keys = SS.ABIL.map((a) => a.k), n = keys.length;
    if (!players.length) return null;
    const mean = new Array(n).fill(0);
    for (const p of players) for (let i = 0; i < n; i++) mean[i] += p.ratings[keys[i]] || 0;
    for (let i = 0; i < n; i++) mean[i] /= players.length;
    const std = new Array(n).fill(0);
    for (const p of players) for (let i = 0; i < n; i++) { const x = (p.ratings[keys[i]] || 0) - mean[i]; std[i] += x * x; }
    for (let i = 0; i < n; i++) std[i] = Math.sqrt(std[i] / players.length) || 1;
    const target = keys.map((_, i) => slots[i] ? slots[i].rating || 0 : 0);
    const tz = target.map((v, i) => (v - mean[i]) / std[i]);
    const w = tz.map((z) => 0.25 + Math.max(0, z));
    let best = null, bestD = Infinity;
    for (const p of players) { let d = 0; for (let i = 0; i < n; i++) { const pz = ((p.ratings[keys[i]] || 0) - mean[i]) / std[i], diff = tz[i] - pz; d += w[i] * diff * diff; } if (d < bestD) { bestD = d; best = p; } }
    if (!best) return null;
    let mad = 0; for (let i = 0; i < n; i++) mad += Math.abs((best.ratings[keys[i]] || 0) - target[i]); mad /= n;
    return { player: best, match: Math.max(0, Math.min(100, Math.round(100 - mad))) };
  }

  // ---- game actions ----
  function ssNewGame() {
    ssClearTimers();
    const c = ssDeal();
    SS.sort = "ppg";
    SS.state = {
      phase: "spinning", spinNumber: 1, spinAxis: "both",
      slots: SS.ABIL.map((a) => ({ ability: a.k, status: "open", playerId: null, rating: null, franchise: null, season: null })),
      currentFranchise: c.franchise, currentSeason: c.season,
      rerollTeamUsed: false, rerollYearUsed: false, runningTotal: 0, lastAbility: null, result: null,
    };
    ssPaint();
  }
  function ssSetEra(id) { if (id === SS.era) return; SS.era = id; ssSetView(); ssNewGame(); }
  const ssCanReroll = (axis) => {
    const s = SS.state; if (!s || s.phase !== "roster") return false;
    if (axis === "team") return !s.rerollTeamUsed && (SS.view.bySeason.get(s.currentSeason) || []).some((f) => f !== s.currentFranchise);
    return !s.rerollYearUsed && (SS.view.byFranchise.get(s.currentFranchise) || []).some((y) => y !== s.currentSeason);
  };
  function ssRerollTeam() {
    const s = SS.state; if (!ssCanReroll("team")) return;
    const alts = (SS.view.bySeason.get(s.currentSeason) || []).filter((f) => f !== s.currentFranchise);
    s.rerollTeamUsed = true; s.currentFranchise = alts[Math.floor(Math.random() * alts.length)];
    s.phase = "spinning"; s.spinAxis = "team"; ssPaint();
  }
  function ssRerollYear() {
    const s = SS.state; if (!ssCanReroll("year")) return;
    const alts = (SS.view.byFranchise.get(s.currentFranchise) || []).filter((y) => y !== s.currentSeason);
    s.rerollYearUsed = true; s.currentSeason = alts[Math.floor(Math.random() * alts.length)];
    s.phase = "spinning"; s.spinAxis = "year"; ssPaint();
  }
  function ssAssign(pid, ability) {
    const s = SS.state; if (!s || s.phase !== "roster") return;
    const idx = s.slots.findIndex((x) => x.ability === ability && x.status === "open");
    const player = SS.data.playersById.get(pid);
    if (idx < 0 || !player) return;
    const rating = player.ratings[ability];
    s.slots[idx] = { ...s.slots[idx], status: "filled", playerId: pid, rating, franchise: s.currentFranchise, season: s.currentSeason };
    s.runningTotal += rating; s.lastAbility = ability;
    if (s.slots.filter((x) => x.status === "filled").length >= 6) { s.phase = "reveal"; s.result = { total: s.runningTotal }; ssPaint(); return; }
    const c = ssDeal(); s.currentFranchise = c.franchise; s.currentSeason = c.season;
    s.spinNumber++; s.spinAxis = "both"; s.phase = "spinning"; ssPaint();
  }

  // ---- spin: two independent reels (team + decade) — the original slot-machine roll ----
  const SS_ITEM = 92; // px, matches .tyreel__item height
  function ssTeamItem(f) {
    return `<div class="tyreel__item team" style="--team:${f.color};color:${ssReadable(f.color)}"><span class="tyreel__logo-chip">${ssMark({ id: f.id, logoId: f.id, color: f.color }, 44, 50)}</span><span class="tyreel__name">${esc(f.name || f.id)}</span></div>`;
  }
  const ssYearItem = (id) => `<div class="tyreel__item year">${esc(ssSeasonLabel(id))}</div>`;
  function ssTeamStrip(target) {
    const frs = SS.data.franchises; if (frs.length <= 1) return [target];
    const pick = (prev) => { let p = frs[Math.floor(Math.random() * frs.length)]; while (p === prev) p = frs[Math.floor(Math.random() * frs.length)]; return p; };
    const out = []; let prev = null;
    for (let i = 0; i < 26; i++) { prev = pick(prev); out.push(prev); }
    if (out[out.length - 1].id === target.id) out[out.length - 1] = pick(target);
    out.push(target); return out;
  }
  function ssYearStrip(target) {
    const seasons = SS.data.seasons, span = seasons.length, ti = Math.max(seasons.indexOf(target), 0), count = Math.max(28, span), out = [];
    for (let i = 0; i < count; i++) out.push(seasons[(((ti - (count - 1) + i) % span) + span) % span]);
    return out;
  }
  function ssRunSpin() {
    const stage = document.getElementById("ssgReel"); const s = SS.state;
    if (!stage) { s.phase = "roster"; ssPaint(); return; }
    const animTeam = s.spinAxis === "both" || s.spinAxis === "team";
    const animYear = s.spinAxis === "both" || s.spinAxis === "year";
    const target = SS.data.franchisesById.get(s.currentFranchise) || { id: s.currentFranchise, name: s.currentFranchise, color: "#2a2a36" };
    const teamStrip = animTeam ? ssTeamStrip(target) : [target];
    const yearStrip = animYear ? ssYearStrip(s.currentSeason) : [s.currentSeason];
    stage.innerHTML = `<div class="tyreel">
      <div class="tyreel-col team" style="height:${SS_ITEM}px"><div class="tyreel-strip team${animTeam ? "" : " static"}" id="ssgTeamStrip">${teamStrip.map(ssTeamItem).join("")}</div></div>
      <div class="tyreel-col year" style="height:${SS_ITEM}px"><div class="tyreel-strip year${animYear ? "" : " static"}" id="ssgYearStrip">${yearStrip.map(ssYearItem).join("")}</div></div>
    </div>`;
    let settled = false;
    const finish = () => { if (settled) return; settled = true; s.phase = "roster"; ssPaint(); };
    if (!animTeam && !animYear) { ssT(finish, 60); return; }
    const teamEl = document.getElementById("ssgTeamStrip"), yearEl = document.getElementById("ssgYearStrip");
    const primary = animTeam ? teamEl : yearEl;
    primary.addEventListener("transitionend", finish, { once: true });
    ssT(finish, 4200); // fallback if transitionend is missed
    // pin at 0, force a layout, then roll to the landed row — reliably triggers the 3.4s transition
    if (animTeam) teamEl.style.transform = "translateY(0)";
    if (animYear) yearEl.style.transform = "translateY(0)";
    void stage.offsetHeight;
    if (animTeam) teamEl.style.transform = `translateY(${-(teamStrip.length - 1) * SS_ITEM}px)`;
    if (animYear) yearEl.style.transform = `translateY(${-(yearStrip.length - 1) * SS_ITEM}px)`;
  }

  // ---- the GOAT card (six slots) — shared by the in-game progress + the reveal ----
  function ssGoatCard(reveal) {
    const s = SS.state;
    const rows = s.slots.map((slot, i) => {
      const a = SS.ABIL[i], filled = slot.status === "filled";
      const p = filled ? SS.data.playersById.get(slot.playerId) : null;
      const td = filled ? ssTeamDisplay(slot.franchise, slot.season) : null;
      const color = td ? td.color : "#c9ccd2";
      const just = !reveal && s.lastAbility === slot.ability;
      const rating = reveal && filled ? `<span class="slot__rating tier-${ssTier(slot.rating)}">${slot.rating}</span>` : "";
      const fill = filled
        ? `<div class="slot__fill">${ssAvatar(p, color, 30, 6)}<span class="slot__who"><span class="slot__name">${esc(p ? p.name : "-")}</span><span class="slot__team">${esc(td ? td.label : "")}</span></span>${ssMark(td, 20, 4)}${rating}</div>`
        : `<span class="slot__await">open</span>`;
      return `<div class="slot ${filled ? "filled" : "open"}${just ? " just-locked" : ""}" style="${filled ? "--team:" + color : ""}"><span class="slot__leadicon">${SS.ICON[slot.ability]}</span><span class="slot__label">${a.label}</span>${fill}</div>`;
    }).join("");
    let total = "";
    if (reveal) {
      const ovr = ssOvr(reveal.total);
      total = `<div class="goat-card__total"><span class="goat-card__total-label">Overall</span><span class="goat-card__total-value tier-${ssTier(ovr)}">${ovr}<span class="goat-card__total-ceil"> OVR</span></span></div>`;
    }
    return `<div class="goat-card compact"><div class="goat-card__slots">${rows}</div>${total}</div>`;
  }

  // ---- reveal: count-up the six ratings, collapse the card, slam the OVR ----
  const SS_BEAT = 430, SS_PAUSE = 400;
  const ssMatchColor = (m) => (m >= 90 ? "var(--good)" : m >= 80 ? "var(--slate)" : m >= 70 ? "var(--gold)" : "var(--crit)");
  function ssRunReveal() {
    const host = document.getElementById("ssgReveal"); if (!host) return;
    const s = SS.state;
    host.innerHTML = `<div class="screen reveal-screen">
      <div class="reveal-team" id="ssgRevealTeam">
        <button class="reveal-team__toggle" id="ssgTeamToggle" hidden><span>View your player</span><span class="reveal-team__chev">▼</span></button>
        <div class="reveal-team__body"><div>${ssGoatCard({ total: 0 })}</div></div>
      </div>
      <div class="pct-slam" id="ssgSlam" hidden></div></div>`;
    const slotEls = host.querySelectorAll(".slot"), totEl = host.querySelector(".goat-card__total-value");
    let shown = 0;
    for (let i = 0; i < 6; i++) {
      ssT(() => {
        shown += s.slots[i].rating;
        if (slotEls[i]) slotEls[i].classList.add("shown");
        if (totEl) { const o = ssOvr(shown); totEl.className = "goat-card__total-value tier-" + ssTier(o); totEl.innerHTML = o + `<span class="goat-card__total-ceil"> OVR</span>`; }
      }, (i + 1) * SS_BEAT);
    }
    ssT(() => ssRevealSlam(host), 6 * SS_BEAT + SS_PAUSE);
  }
  function ssRevealSlam(host) {
    const s = SS.state, total = s.result.total, ovr = ssOvr(total), tc = ssTier(ovr), tier = ssOvrTier(ovr);
    const perfect = s.slots.every((x) => x.rating === 99), comp = ssComp(s.slots);
    const rt = document.getElementById("ssgRevealTeam"); rt.classList.add("collapsed");
    const tog = document.getElementById("ssgTeamToggle"); tog.hidden = false;
    tog.addEventListener("click", () => { rt.classList.toggle("collapsed"); const c = rt.classList.contains("collapsed"); tog.children[0].textContent = c ? "View your player" : "Hide your player"; tog.children[1].textContent = c ? "▼" : "▲"; });
    // tier ladder (worst -> best), lit through the current tier; each step colored by its own tier
    const steps = SS_TIERS.slice().reverse();
    const curIdx = steps.findIndex((t) => t.label === tier.label);
    const meter = steps.map((t, i) => `<div class="tiermeter__step tc-${ssTier(t.min === 0 ? 60 : t.min)}${i <= curIdx ? " on" : ""}${i === curIdx ? " cur" : ""}" style="--c:var(--tier-color);height:${10 + i * 4}px"></div>`).join("");
    const away = ovr >= 99 ? "no ceiling left to break 🐐" : (99 - ovr) + " pts away from GOAT";
    const compHtml = comp ? `<div class="comp"><div class="comp__kicker">Your player plays like</div><div class="comp__row">${ssAvatar(comp.player, "#c9ccd2", 46, 10)}<div class="comp__who"><span class="comp__name">${esc(comp.player.name)}</span><span class="comp__team">${esc(comp.player.team_label || "")}</span></div><div class="comp__match" style="--match:${ssMatchColor(comp.match)}"><span class="comp__pct">${comp.match}%</span><span class="comp__pct-label">skill match</span></div></div></div>` : "";
    const slam = document.getElementById("ssgSlam");
    slam.className = "pct-slam grade-slam tc-" + tc + (perfect ? " perfect" : "");
    slam.hidden = false;
    slam.innerHTML = `${ovr >= 99 ? `<div class="pct-slam__emblem">THE GOAT 🐐</div>` : ""}
      <div class="pct-slam__ovr"><span class="pct-slam__num">${ovr}</span><span class="pct-slam__ovrlabel">OVR</span></div>
      <div class="pct-slam__actions"><button class="btn-primary" id="ssgAgain">Play again <kbd class="kbd">R</kbd></button><button class="btn-secondary" id="ssgShare">Share result</button></div>
      <div class="tiermeter"><div class="tiermeter__bars">${meter}</div><div class="tiermeter__caption"><span class="tiermeter__cur tc-${tc}">${tier.label}</span><span class="tiermeter__next">${away}</span></div></div>
      ${compHtml}`;
    slam.querySelector("#ssgAgain").addEventListener("click", ssNewGame);
    slam.querySelector("#ssgShare").addEventListener("click", (e) => ssShare(e.currentTarget, ovr, total));
    if (ovr >= 92) ssConfetti(ovr >= 99);
  }
  function ssShare(btn, ovr, total) {
    const s = SS.state, tier = ssOvrTier(ovr);
    const lines = s.slots.map((x) => { const a = SS.ABIL.find((y) => y.k === x.ability); return a.short + " " + x.rating; }).join(" · ");
    const txt = `Six Spins — ${ovr} OVR (${tier.label})\n${lines}\nBuild yours: dunkwise.com/#/play/sixspins`;
    const done = () => { const o = btn.textContent; btn.textContent = "Copied ✓"; ssT(() => { btn.textContent = o; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done).catch(done); else done();
  }
  // lightweight confetti (no dependency): a burst of falling colored bits over the reveal
  function ssConfetti(gold) {
    const host = document.querySelector(".ssg"); if (!host) return;
    const wrap = document.createElement("div"); wrap.className = "ssg-confetti";
    const cols = gold ? ["#ffd700", "#f6c945", "#e3b341", "#c89200", "#fff3bf"] : ["#D97757", "#0d9488", "#7c3aed", "#e3b341", "#4db8ff"];
    for (let i = 0; i < (gold ? 90 : 60); i++) {
      const b = document.createElement("i");
      b.style.cssText = `left:${Math.random() * 100}%;background:${cols[i % cols.length]};animation-delay:${Math.random() * 0.5}s;animation-duration:${1.6 + Math.random() * 1.4}s;transform:rotate(${Math.random() * 360}deg)`;
      wrap.appendChild(b);
    }
    host.appendChild(wrap); ssT(() => wrap.remove(), 3400);
  }

  // ---- render: the "Your Player" progress toggle + card (original layout) ----
  function ssProgress() {
    const s = SS.state, filled = s.slots.filter((x) => x.status === "filled").length, open = SS.cardOpen;
    const faces = s.slots.map((slot) => {
      if (slot.status === "filled") { const p = SS.data.playersById.get(slot.playerId), td = ssTeamDisplay(slot.franchise, slot.season); return ssAvatar(p, td.color, 26, 13); }
      return `<span class="goat-toggle__ph">${SS.ICON[slot.ability]}</span>`;
    }).join("");
    return `<button class="goat-toggle${open ? " open" : ""}" id="ssgGoatToggle"><span class="goat-toggle__label">Your Player</span><span class="goat-toggle__count">${filled}<span class="goat-toggle__count-of">/6</span></span><span class="goat-toggle__faces">${faces}</span><svg class="goat-toggle__chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>
      <div class="goat-card-wrap${open ? " open" : ""}" id="ssgCardWrap">${ssGoatCard(null)}</div>`;
  }
  function ssRosterHtml() {
    const s = SS.state, td = ssTeamDisplay(s.currentFranchise, s.currentSeason), tx = ssReadable(td.color);
    const players = ssRoster(s.currentSeason, s.currentFranchise), sort = SS.sort;
    const lastName = (n) => ((n || "").trim().split(/\s+/).pop() || "");
    const ordered = players.slice().sort((a, b) => sort === "az" ? lastName(a.name).localeCompare(lastName(b.name)) : (b.stats && b.stats[sort] || 0) - (a.stats && a.stats[sort] || 0));
    const sorts = [...SS.STATS, ["az", "A–Z"]];
    const sortBtns = sorts.map(([k, l]) => `<button class="sort-btn${sort === k ? " active" : ""}" data-sort="${k}">${l}</button>`).join("");
    const fmt = (v) => (v == null ? "-" : Number(v).toFixed(1));
    const rows = ordered.map((p) => `<button class="pcard" data-pid="${esc(p.id)}">${ssAvatar(p, td.color, 44)}<div class="pcard__id"><div class="pcard__name">${esc(p.name)}</div><div class="pcard__meta">${esc(p.team_label || td.label)}</div></div><div class="pcard__stats">${SS.STATS.map(([k, l]) => `<div class="stat${k === sort ? " active" : ""}"><span class="stat__v">${fmt(p.stats && p.stats[k])}</span><span class="stat__k">${l}</span></div>`).join("")}</div></button>`).join("");
    return `<div class="roster">
      <div class="roster__banner" style="--team:${td.color};color:${tx}"><div class="roster__crest">${ssMark(td, 40, 10)}</div><div class="roster__title"><div class="roster__team">${esc(td.label)}</div><div class="roster__hint">Tap to draft</div></div></div>
      <div class="roster__sort"><span class="roster__sort-label">Sort</span><div class="roster__sort-opts">${sortBtns}</div></div>
      <div class="roster__list">${rows}</div></div>`;
  }
  function ssPaint() {
    const root = document.getElementById("ssgRoot"); const s = SS.state; if (!root || !s) return;
    ssCloseSheets(); // never leave a draft sheet stranded across a phase change
    if (s.phase === "reveal") { root.innerHTML = `<div id="ssgReveal"></div>`; ssRunReveal(); return; }
    const eras = SS.ERAS.map((e) => `<button class="ss-era${SS.era === e.id ? " active" : ""}" data-era="${e.id}">${e.label}</button>`).join("");
    const body = s.phase === "spinning"
      ? `<div class="spin-stage"><div class="spin-stage__title">${s.spinAxis === "team" ? "Rerolling team…" : s.spinAxis === "year" ? "Rerolling decade…" : "Spinning…"}</div><div id="ssgReel"></div></div>`
      : ssRosterHtml();
    root.innerHTML = `<div class="ss-bar"><div class="ss-eras">${eras}</div><button class="ss-new">New game</button></div>
      <div class="screen game-screen">
        <div class="game-top">
          <div class="game-header">
            <div class="spin-counter"><span class="spin-counter__now">Spin ${s.spinNumber}</span><span class="spin-counter__of">of 6</span></div>
            <div class="reroll-group">
              <span class="reroll-mini-wrap"><button class="reroll-mini" data-rr="team"${ssCanReroll("team") ? "" : " disabled"}>${SS.ICON.reroll}<span class="reroll-mini__label">Team</span><span class="reroll-mini__n">${s.rerollTeamUsed ? 0 : 1}</span></button></span>
              <span class="reroll-mini-wrap"><button class="reroll-mini" data-rr="year"${ssCanReroll("year") ? "" : " disabled"}>${SS.ICON.reroll}<span class="reroll-mini__label">Decade</span><span class="reroll-mini__n">${s.rerollYearUsed ? 0 : 1}</span></button></span>
            </div>
          </div>
          ${ssProgress()}
        </div>
        <div class="game-bottom">${body}</div>
      </div>`;
    root.querySelectorAll("[data-era]").forEach((b) => b.addEventListener("click", () => ssSetEra(b.dataset.era)));
    root.querySelector(".ss-new").addEventListener("click", ssNewGame);
    const tog = root.querySelector("#ssgGoatToggle");
    if (tog) tog.addEventListener("click", () => { SS.cardOpen = !SS.cardOpen; tog.classList.toggle("open", SS.cardOpen); const w = root.querySelector("#ssgCardWrap"); if (w) w.classList.toggle("open", SS.cardOpen); });
    root.querySelectorAll("[data-rr]").forEach((b) => b.addEventListener("click", () => (b.dataset.rr === "team" ? ssRerollTeam() : ssRerollYear())));
    if (s.phase === "spinning") ssRunSpin();
    if (s.phase === "roster") {
      root.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => { SS.sort = b.dataset.sort; ssPaint(); }));
      root.querySelectorAll("[data-pid]").forEach((b) => b.addEventListener("click", () => ssOpenSheet(b.dataset.pid)));
    }
  }
  // assign sheet: pick which open attribute to steal from the tapped player (original .sheet markup)
  function ssOpenSheet(pid) {
    const s = SS.state, p = SS.data.playersById.get(pid); if (!p) return;
    ssCloseSheets(); // only one sheet at a time
    const td = ssTeamDisplay(s.currentFranchise, s.currentSeason);
    const open = s.slots.filter((x) => x.status === "open").map((x) => x.ability);
    const fmt = (v) => (v == null ? "-" : Number(v).toFixed(1));
    const back = document.createElement("div"); back.className = "sheet-backdrop";
    back.innerHTML = `<div class="sheet" role="dialog" aria-label="Draft ${esc(p.name)}">
      <div class="sheet__head">${ssAvatar(p, td.color, 46)}<div class="sheet__head-id"><div class="sheet__name">${esc(p.name)}</div><div class="sheet__sub">${esc(p.team_label || td.label)}</div></div></div>
      <div class="sheet__statline">${SS.STATS.map(([k, l]) => `<div class="stat"><span class="stat__v">${fmt(p.stats && p.stats[k])}</span><span class="stat__k">${l}</span></div>`).join("")}</div>
      <div class="sheet__prompt">Draft into which attribute?</div>
      <div class="sheet__options">${open.map((ab) => { const a = SS.ABIL.find((x) => x.k === ab); return `<button class="opt" data-ab="${ab}"><span class="opt__icon">${SS.ICON[ab]}</span><span class="opt__label">${a.label}</span></button>`; }).join("")}</div>
      <button class="sheet__cancel">Select a different player</button></div>`;
    const close = () => back.remove();
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    back.querySelector(".sheet__cancel").addEventListener("click", close);
    back.querySelectorAll("[data-ab]").forEach((b) => b.addEventListener("click", () => { close(); ssAssign(pid, b.dataset.ab); }));
    (document.querySelector(".ssg") || document.body).appendChild(back);
  }

  async function renderSixSpins() {
    setSEO("Six Spins — Play", "Play Six Spins on Dunkwise — spin all-time NBA rosters, steal one attribute each spin, and build a 99 OVR player.");
    ssClearTimers(); ssCloseSheets();
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/play">Arcade</a><span class="sep">/</span><span>Six Spins</span></div>
      <div class="section-title"><div><span class="eyebrow">Continuous build</span><h2>Six Spins</h2></div><a class="link" href="https://sixspins.com" target="_blank" rel="noopener noreferrer">Play at sixspins.com ↗</a></div>
      <div class="ssg" id="ssgRoot"><div class="ssg-loading"><span class="spinner"></span></div></div>
    </div>`;
    try {
      await ssLoad();
      if (!document.getElementById("ssgRoot")) return; // navigated away while loading
      ssSetView(); ssNewGame();
    } catch (e) {
      const r = document.getElementById("ssgRoot");
      if (r) r.innerHTML = `<div class="ssg-loading">Couldn’t load the game. <a class="link" href="/sixspins/">Open it full-screen ↗</a></div>`;
    }
  }

  // Daily NBA Grid — a new board every day, with an archive back to launch.
  async function renderPlayGrid(dateStr) {
    const dates = gridDates();
    const date = (dateStr && dates.includes(dateStr)) ? dateStr : dates[0];
    const isToday = date === dates[0];
    const done = new Set(gridDone());
    const [r0, r1, r2, c0, c1, c2] = (() => { const rnd = mulberry(daySeed(date)), a = GRID_POOL.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, 6); })();
    const rows = [r0, r1, r2], cols = [c0, c1, c2];
    const head = (ab) => `<div class="gg-head">${teamLogo(ab, "sm")}<span>${ab}</span></div>`;
    const dayLabel = (d) => (d === dates[0] ? "Today" : fmtDate(d, true));
    setSEO("Daily NBA Grid — Play", "Name a player who played for both teams in each square. A new NBA grid every day, with a full archive.");
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/play">Arcade</a><span class="sep">/</span><span>Daily NBA Grid</span></div>
      <div class="section-title"><div><span class="eyebrow">${isToday ? "Today's board" : "Archive · " + fmtDate(date, true)}</span><h2>Daily NBA Grid</h2></div>
        <label class="season-select"><span>Board</span><select id="gridSel">${dates.map((d) => `<option value="${d}" ${d === date ? "selected" : ""}>${dayLabel(d)}${done.has(d) ? " ✓" : ""}</option>`).join("")}</select></label></div>
      <span class="hint gg-scoreline" id="ggScore">0 / 9 filled</span>
      <div class="grid-game" id="ggBoard">
        <div class="gg-corner"><span class="gg-corner-mark">NBA</span></div>
        ${cols.map(head).join("")}
        ${rows.map((rab) => `${head(rab)}${cols.map((cab) => `<button class="gg-cell" data-r="${rab}" data-c="${cab}" aria-label="${rab} and ${cab}"><span class="gg-plus">+</span></button>`).join("")}`).join("")}
      </div>
      <p class="news-foot" style="margin-top:14px">Tap a square and name a player who suited up for <b>both</b> that row's and column's team (all-time). A new grid unlocks every day — past boards stay in the archive. <a class="link" href="#/play">← Arcade</a></p>
    </div>`;
    const sel = $("#gridSel");
    if (sel) sel.addEventListener("change", (e) => { const v = e.target.value; location.hash = v === dates[0] ? "#/play/grid" : "#/play/grid/" + v; });
    wireGrid(rows, cols, date);
  }

  function wireGrid(rows, cols, date) {
    let filled = 0;
    const modal = document.createElement("div");
    modal.className = "gg-modal"; modal.hidden = true;
    modal.innerHTML = `<div class="gg-backdrop"></div><div class="gg-panel"><div class="gg-prompt" id="ggPrompt"></div>
      <input id="ggInput" type="text" placeholder="Name a player…" autocomplete="off" spellcheck="false"><div class="gg-msg" id="ggMsg"></div><div class="gg-results" id="ggResults"></div></div>`;
    document.body.appendChild(modal);
    const input = modal.querySelector("#ggInput"), results = modal.querySelector("#ggResults"), msg = modal.querySelector("#ggMsg"), prompt = modal.querySelector("#ggPrompt");
    let active = null;
    const close = () => { modal.hidden = true; document.body.classList.remove("cmdk-open"); active = null; };
    modal.querySelector(".gg-backdrop").addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) close(); });
    const render = (q) => {
      const query = q.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (!query) { results.innerHTML = ""; return; }
      const nrm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const hits = SEARCH.filter((e) => nrm(e[1]).includes(query) || (e[7] && nrm(e[7]).includes(query))).slice(0, 6);
      results.innerHTML = hits.map((e) => `<button class="gg-opt" data-pid="${e[0]}" data-nm="${esc(e[1])}">${headshot(e[0], e[1], e[5], "xs")}<span class="nm">${esc(e[1])}</span><span class="sub">${esc(e[4].split("-")[0])} · ${seasonLabel(e[2])}–${String(e[3]).slice(2)}</span></button>`).join("");
    };
    input.addEventListener("input", () => render(input.value));
    results.addEventListener("click", async (e) => {
      const opt = e.target.closest(".gg-opt"); if (!opt || !active) return;
      const pid = opt.dataset.pid, nm = opt.dataset.nm;
      msg.textContent = "Checking…"; msg.className = "gg-msg";
      let ok = false;
      try { const p = await getPlayer(pid); const teams = new Set(p.log.map((r) => r[2])); const rA = teamAliases(active.r), cA = teamAliases(active.c); ok = [...rA].some((t) => teams.has(t)) && [...cA].some((t) => teams.has(t)); } catch (er) {}
      if (ok) {
        active.cell.classList.add("done"); active.cell.innerHTML = `${headshot(pid, nm, "", "sm")}<span class="gg-nm">${esc(nm)}</span>`;
        active.cell.onclick = null; filled++; $("#ggScore").textContent = `${filled} / 9 filled`;
        close();
        if (filled === 9) { markGridDone(date); setTimeout(() => showGridWin(date), 260); }
      } else { msg.textContent = `${nm} didn't play for both — try again.`; msg.className = "gg-msg bad"; }
    });
    $$("#ggBoard .gg-cell").forEach((cell) => cell.addEventListener("click", () => {
      if (cell.classList.contains("done")) return;
      active = { r: cell.dataset.r, c: cell.dataset.c, cell };
      prompt.innerHTML = `Played for <b>${tName(active.r)}</b> <span class="gg-x">×</span> <b>${tName(active.c)}</b>`;
      msg.textContent = ""; input.value = ""; results.innerHTML = "";
      modal.hidden = false; document.body.classList.add("cmdk-open");
      requestAnimationFrame(() => input.focus());
    }));
  }

  // Achievement screen shown when a grid is completed 9/9.
  function showGridWin(date) {
    const ds = gridDates(), today = ds[0];
    const el = document.createElement("div");
    el.className = "gg-win";
    el.innerHTML = `<div class="gg-win-backdrop"></div>
      <div class="gg-win-card" role="dialog" aria-modal="true" aria-label="Grid complete">
        <div class="gg-win-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></div>
        <span class="eyebrow">Grid complete</span>
        <h2>Nine for nine.</h2>
        <p>You filled every square on the ${date === today ? "today's" : fmtDate(date, true)} board. A fresh grid unlocks each day — the archive keeps the rest.</p>
        <div class="gg-win-cta">
          <button class="btn primary" id="ggWinAnother">Play another board</button>
          <a class="btn" href="#/play">Arcade</a>
        </div>
      </div>`;
    document.body.appendChild(el);
    document.body.classList.add("cmdk-open");
    const close = () => { el.remove(); document.body.classList.remove("cmdk-open"); };
    el.querySelector(".gg-win-backdrop").addEventListener("click", close);
    el.querySelector("#ggWinAnother").addEventListener("click", () => {
      close(); const i = ds.indexOf(date), next = ds[i + 1] || ds[Math.max(0, i - 1)] || ds[0];
      location.hash = next === ds[0] ? "#/play/grid" : "#/play/grid/" + next;
    });
    requestAnimationFrame(() => el.classList.add("show"));
  }

  // ---- Stat Duel — higher-or-lower on all-time career totals ----
  async function renderStatDuel() {
    let A; try { A = await getAlltime(); } catch { return notFound("game"); }
    const CATS = { pts: "points", trb: "rebounds", ast: "assists", stl: "steals", blk: "blocks", x3p: "three-pointers made", g: "games played" };
    const keys = Object.keys(CATS).filter((k) => (A.career[k] || []).length >= 8);
    let streak = 0, best = +(localStorage.getItem("hw-duel-best") || 0), locked = false, cur = null;
    setSEO("Stat Duel — Play", "Higher or lower — pick the NBA player with the bigger career number, and build a streak.");
    const pickPair = () => {
      const cat = keys[Math.floor(Math.random() * keys.length)], pool = A.career[cat];
      let i = Math.floor(Math.random() * pool.length), j;
      do { j = Math.floor(Math.random() * pool.length); } while (j === i || pool[j][3] === pool[i][3]);
      return { cat, a: pool[i], b: pool[j] };
    };
    const card = (p, side) => `<button class="duel-card" data-side="${side}">
      ${headshot(p[0], p[1], p[2], "hero")}<span class="duel-nm">${esc(p[1])}</span>
      <span class="duel-tm">${esc(p[2])} · ${p[4] - 1}–${p[5]}</span>
      <span class="duel-val" aria-hidden="true">?</span></button>`;
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/play">Arcade</a><span class="sep">/</span><span>Stat Duel</span></div>
      <div class="section-title"><div><span class="eyebrow">Higher or lower · career totals</span><h2>Stat Duel</h2></div>
        <span class="hint"><span id="duelStreak">0</span> streak · best <span id="duelBest">${best}</span></span></div>
      <div class="duel" id="duelArena"></div>
      <p class="news-foot" style="margin-top:14px">Tap the player with the bigger career total. One wrong pick ends the run. <a class="link" href="#/play">← Arcade</a></p>
    </div>`;
    const arena = $("#duelArena");
    function draw() {
      cur = pickPair();
      arena.innerHTML = `<div class="duel-q">Who logged more career <b>${CATS[cur.cat]}</b>?</div>
        <div class="duel-row">${card(cur.a, "a")}<span class="duel-vs">VS</span>${card(cur.b, "b")}</div>`;
      locked = false;
      $$(".duel-card", arena).forEach((c) => c.addEventListener("click", () => choose(c.dataset.side)));
    }
    function choose(side) {
      if (locked) return; locked = true;
      const win = cur.a[3] >= cur.b[3] ? "a" : "b";
      $$(".duel-card", arena).forEach((c) => {
        const p = c.dataset.side === "a" ? cur.a : cur.b;
        c.querySelector(".duel-val").textContent = p[3].toLocaleString();
        c.classList.add(c.dataset.side === win ? "win" : "lose");
      });
      if (side === win) {
        streak++; $("#duelStreak").textContent = streak;
        if (streak > best) { best = streak; localStorage.setItem("hw-duel-best", best); $("#duelBest").textContent = best; }
        setTimeout(draw, 1150);
      } else {
        setTimeout(() => duelOver(), 1200);
      }
    }
    function duelOver() {
      arena.innerHTML = `<div class="duel-over">
        <span class="eyebrow">Run over</span><div class="duel-over-score">${streak}</div>
        <p>${streak === best && streak > 0 ? "A new best streak!" : "Best streak: " + best}</p>
        <button class="btn primary" id="duelAgain">Play again</button></div>`;
      streak = 0; $("#duelStreak").textContent = 0;
      $("#duelAgain").addEventListener("click", draw);
    }
    draw();
  }

  // ---- Buzzer Beater — timing-bar arcade shooting ----
  async function renderBuzzer() {
    setSEO("Buzzer Beater — Play", "Time your release in the sweet spot and sink as many NBA buckets as you can.");
    const best = +(localStorage.getItem("hw-buzzer-best") || 0);
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/play">Arcade</a><span class="sep">/</span><span>Buzzer Beater</span></div>
      <div class="section-title"><div><span class="eyebrow">Arcade · timing</span><h2>Buzzer Beater</h2></div>
        <span class="hint"><span id="bzScore">0</span> made · best <span id="bzBest">${best}</span></span></div>
      <div class="buzzer" id="bzArena">
        <div class="bz-scene" id="bzScene">
          <svg class="bz-hoop" viewBox="0 0 200 150" aria-hidden="true">
            <rect x="62" y="12" width="76" height="54" rx="7" fill="var(--panel)" stroke="var(--line-strong)" stroke-width="2.5"/>
            <rect x="86" y="30" width="28" height="20" rx="3" fill="none" stroke="var(--line)" stroke-width="2"/>
            <path d="M100 66v10" stroke="var(--line-strong)" stroke-width="3"/>
            <g stroke="var(--line-strong)" stroke-width="1.3" fill="none" opacity=".75"><path d="M72 80 96 112M128 80 104 112M86 80 98 113M114 80 102 113M100 80V113"/><path d="M80 92H120M84 102H116"/></g>
            <ellipse cx="100" cy="80" rx="30" ry="7.5" fill="none" stroke="var(--accent-deep)" stroke-width="4"/>
            <path d="M70 80a30 7.5 0 0 1 60 0" fill="none" stroke="var(--accent)" stroke-width="4.5"/>
          </svg>
          <div class="bz-ball" id="bzBall"></div>
          <div class="bz-pop" id="bzPop"></div>
        </div>
        <div class="bz-meter" id="bzTrack"><div class="bz-zone" id="bzZone"></div><span class="bz-mid"></span><div class="bz-marker" id="bzMarker"></div></div>
        <div class="bz-hud"><span class="bz-hint">Release in the green</span><div class="bz-lives" id="bzLives"></div></div>
        <button class="btn primary bz-shoot" id="bzShoot">Shoot</button>
      </div>
      <p class="news-foot" style="margin-top:14px">Tap <b>Shoot</b> (or press Space) when the marker is inside the green zone. It gets faster and tighter as you go — three misses and it's over. <a class="link" href="#/play">← Arcade</a></p>
    </div>`;
    const marker = $("#bzMarker"), zoneEl = $("#bzZone"), ball = $("#bzBall"), livesEl = $("#bzLives");
    let pos = 0, dir = 1, spd = 0.85, zone = 0.26, score = 0, misses = 0, over = false, raf = 0, last = performance.now();
    const setLives = () => { livesEl.innerHTML = [0, 1, 2].map((i) => `<span class="bz-life${i < 3 - misses ? " on" : ""}"></span>`).join(""); };
    const setZone = () => { const c = 0.5; zoneEl.style.left = ((c - zone / 2) * 100) + "%"; zoneEl.style.width = (zone * 100) + "%"; };
    setLives(); setZone();
    function loop(t) {
      if (over || !document.body.contains(marker)) return;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      pos += dir * spd * dt; if (pos > 1) { pos = 1; dir = -1; } else if (pos < 0) { pos = 0; dir = 1; }
      marker.style.left = (pos * 100) + "%";
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    const scene = $("#bzScene"), pop = $("#bzPop");
    function shoot() {
      if (over) return;
      const made = Math.abs(pos - 0.5) <= zone / 2;
      ball.classList.remove("make", "miss"); scene.classList.remove("make", "miss"); void ball.offsetWidth;
      if (made) {
        score++; $("#bzScore").textContent = score; ball.classList.add("make"); scene.classList.add("make");
        const perfect = Math.abs(pos - 0.5) <= zone * 0.2;
        pop.textContent = perfect ? "SWISH!" : "+1"; pop.className = "bz-pop" + (perfect ? " swish" : ""); void pop.offsetWidth; pop.classList.add("show");
        spd = Math.min(2.4, spd + 0.09); zone = Math.max(0.09, zone - 0.012); setZone();
        if (score > best) { localStorage.setItem("hw-buzzer-best", score); $("#bzBest").textContent = score; }
      } else {
        misses++; ball.classList.add("miss"); scene.classList.add("miss"); setLives();
        pop.textContent = "MISS"; pop.className = "bz-pop miss"; void pop.offsetWidth; pop.classList.add("show");
        if (misses >= 3) return bzOver();
      }
      setTimeout(() => { ball.classList.remove("make", "miss"); scene.classList.remove("make", "miss"); }, 560);   // ball returns to the ready spot between shots
    }
    function bzOver() {
      over = true; cancelAnimationFrame(raf);
      $("#bzArena").innerHTML = `<div class="duel-over"><span class="eyebrow">Final buzzer</span>
        <div class="duel-over-score">${score}</div><p>buckets made${score >= best && score > 0 ? " · new best!" : " · best " + best}</p>
        <button class="btn primary" id="bzAgain">Shoot again</button></div>`;
      $("#bzAgain").addEventListener("click", renderBuzzer);
    }
    $("#bzShoot").addEventListener("click", shoot);
    const keyh = (e) => { if (e.key === " " || e.code === "Space") { e.preventDefault(); shoot(); } };
    document.addEventListener("keydown", keyh);
    // stop listening once the arena is gone
    const obs = setInterval(() => { if (!document.body.contains(marker)) { document.removeEventListener("keydown", keyh); cancelAnimationFrame(raf); clearInterval(obs); } }, 1000);
  }

  async function renderNews() {
    let news; try { news = await getNews(); } catch { news = null; }
    const items = (news && news.items) || [];
    const bySource = {};
    items.forEach((it) => { (bySource[it.source] = bySource[it.source] || []).push(it); });
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>News</span></div>
      <div class="section-title"><div><span class="eyebrow">${items.length} headlines · updated ${news ? timeAgo(news.fetched) + " ago" : "—"}</span><h2>Around the league</h2></div></div>
      ${items.length ? `<div class="ncard-grid">${items.map((it, i) => newsCard(it, i)).join("")}</div>
        <p class="news-foot" style="margin-top:16px">Aggregated NBA headlines from ESPN, CBS Sports, Yahoo and Sporting News, with player tags detected automatically. Each item opens an in-site summary that links to the full story at its source.</p>` :
        `<p class="muted">No news available right now — check back soon.</p>`}
    </div>`;
  }

  /* ================= GAMES ================= */
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(d, withYear) {   // "2026-06-13" -> "Sat, Jun 13"
    const [y, m, day] = d.split("-").map(Number);
    const wd = WD[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
    return `${wd}, ${MO[m - 1]} ${day}${withYear ? ", " + y : ""}`;
  }
  // NBA season a calendar date belongs to: Oct–Jun of season Y spans (Y-1)→Y, so
  // any date from Aug onward counts toward next year's season (offseason is Jul–Sep).
  const seasonOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 8 ? y + 1 : y; };
  const gameTypeBadge = (t, label) => label ? `<span class="gbadge po">${esc(label)}</span>` : (t && t !== "Regular Season" ? `<span class="gbadge">${esc(t)}</span>` : "");

  // OP.GG-style match row: dense, winner-emphasised, score-share bar + a
  // competitiveness tag (Clutch/Close/Blowout) colour-coded on the left rail.
  function matchRow(g) {
    const hw = (g.hs || 0) > (g.as || 0), aw = !hw && g.hs != null;
    const margin = Math.abs((g.hs || 0) - (g.as || 0));
    const played = g.hs != null && g.as != null;
    const comp = !played ? "tbd" : margin <= 3 ? "clutch" : margin <= 8 ? "close" : margin >= 20 ? "blowout" : "normal";
    const total = (g.hs || 0) + (g.as || 0) || 1, aPct = Math.round((g.as || 0) / total * 100);
    const tag = comp === "clutch" ? "Clutch" : comp === "close" ? "Close" : played ? "+" + margin : "";
    return `<a class="mrow c-${comp}" href="#/game/${g.id}">
      <span class="mr-team a ${aw ? "win" : ""}">${teamLogo(g.a, "sm")}<span class="ab">${g.a}</span></span>
      <span class="mr-mid">
        <span class="mr-sc ${aw ? "win" : ""}">${g.as ?? "—"}</span>
        <span class="mr-bar"><i class="${aw ? "win" : ""}" style="width:${aPct}%"></i><i class="${hw ? "win" : ""}" style="width:${100 - aPct}%"></i></span>
        <span class="mr-sc ${hw ? "win" : ""}">${g.hs ?? "—"}</span>
      </span>
      <span class="mr-team h ${hw ? "win" : ""}"><span class="ab">${g.h}</span>${teamLogo(g.h, "sm")}</span>
      <span class="mr-tag t-${comp}">${tag}</span>
      <span class="mr-badge">${gameTypeBadge(g.type, g.label)}</span></a>`;
  }

  async function renderGames(season) {
    const cur = META.current, s = +season || cur;
    let idx; try { idx = await getGamesIdx(s); } catch { return notFound("games"); }
    const sel = `<select class="mini-select" id="gmSeasonSel">${META.seasons.map((y) => `<option value="${y}" ${y === s ? "selected" : ""}>${seasonLabel(y)}</option>`).join("")}</select>`;
    setSEO(`${seasonLabel(s)} Scores & Results`, `Every ${seasonLabel(s)} NBA game — filter and sort by team, round, margin, total and more.`);
    app.innerHTML = `<div class="wrap page pt-page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>Scores</span></div>
      <div class="section-title"><div><span class="eyebrow">${idx.games.length} games · ${seasonLabel(s)}</span><h2>Scores</h2></div>${sel}</div>
      <div id="ptHost"></div></div>`;
    ptMount($("#ptHost"), GAMES_CFG, idx.games);
    const gs = $("#gmSeasonSel"); if (gs) gs.addEventListener("change", () => (location.hash = `#/games/${gs.value}`));
  }

  // Scores feed filtered to a single player: their stored game rows (most recent ~100),
  // resolved against the season index so every row matches the main Scores styling.
  async function renderPlayerGames(pid) {
    let p; try { p = await getPlayer(pid); } catch { return notFound("player"); }
    let pg; try { pg = await getPGames(pid); } catch { pg = null; }
    pg = (pg || []).slice();
    const seasons = [...new Set(pg.map((r) => seasonOf(r.date)))];
    const idxs = await Promise.all(seasons.map((s) => getGamesIdx(s).catch(() => null)));
    const byId = {};
    idxs.forEach((idx) => { if (idx && idx.games) idx.games.forEach((g) => { byId[String(g.id)] = g; }); });
    const games = pg.map((r) => byId[String(r.id)]).filter(Boolean)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const span = games.length ? (() => { const a = seasonOf(games[games.length - 1].date), b = seasonOf(games[0].date); return a === b ? seasonLabel(a) : `${seasonLabel(a)} – ${seasonLabel(b)}`; })() : "";
    setSEO(`${p.name} — Game Log & Scores`, `Every recent game ${p.name} appeared in: final scores, competitiveness and box-score links.`);
    // Same filter/sort/column table as #/games, just seeded with this player's games
    // instead of one season's. Kept multi-season because that's the coverage the
    // player feed always had — #/games itself is scoped to a single season.
    app.innerHTML = `<div class="wrap page pt-page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/games">Scores</a><span class="sep">/</span><span>${esc(p.name)}</span></div>
      <div class="section-title"><div><span class="eyebrow">${games.length} game${games.length === 1 ? "" : "s"}${span ? " · " + span : ""}</span><h2>${esc(p.name)} · Games</h2></div>
        <a class="link" href="#/player/${pid}">Player page →</a></div>
      <div class="pg-filter">${headshot(p.id, p.name, p.cur.team, "xs")}<span>Filtered to games <b>${esc(p.name)}</b> appeared in</span><a class="link" href="#/games">All league games ✕</a></div>
      ${games.length ? `<div id="ptHost"></div>`
        : `<p class="muted" style="margin-top:20px">No game-level data on record for ${esc(p.name)}.</p>`}
    </div>`;
    if (games.length) ptMount($("#ptHost"), GAMES_CFG, games);
  }

  async function renderGame(id) {
    let g; try { g = await getGame(id); } catch { return notFound("game"); }
    const hw = (g.home.score || 0) > (g.away.score || 0);
    const nOT = Math.max((g.home.q || []).length, (g.away.q || []).length) - 4;
    const cols = ["1", "2", "3", "4", ...Array.from({ length: Math.max(0, nOT) }, (_, i) => "OT" + (nOT > 1 ? i + 1 : ""))];
    const nz = (v) => (v == null ? "—" : v);
    const frac = (m, a) => (m == null && a == null ? "—" : `${nz(m)}-${nz(a)}`);
    const margin = Math.abs((g.home.score || 0) - (g.away.score || 0));
    // game leaders across both benches — the "who won it" glance box
    const roster = [...g.box.away.map((p) => ({ ...p, ab: g.away.abbr })), ...g.box.home.map((p) => ({ ...p, ab: g.home.abbr }))].filter((p) => p.min != null && p.pid);
    const leaderOf = (key) => roster.filter((p) => p[key] != null).sort((a, b) => b[key] - a[key])[0];
    const teamTop = (side) => g.box[side].filter((p) => p.pts != null && p.pid).sort((a, b) => b.pts - a.pts)[0];
    // a side's player box is "populated" only if someone logged minutes or scored — guards stub/missing box data
    const boxHas = (side) => (g.box[side] || []).some((p) => (p.min || 0) > 0 || (p.pts || 0) > 0);
    const glCard = (cat, key, unit) => { const L = leaderOf(key); if (!L || !L[key]) return ""; return `<div class="gl" onclick="location.hash='#/player/${L.pid}'">${headshot(L.pid, L.name, L.ab, "sm")}<div class="who2"><div class="cat">${cat}</div><div class="nm">${esc(L.name)} · ${L.ab}</div></div><div class="val">${L[key]}<small>${unit}</small></div></div>`; };
    const glCards = [glCard("Points", "pts", "pts"), glCard("Rebounds", "reb", "reb"), glCard("Assists", "ast", "ast")].filter(Boolean);
    const leadersStrip = glCards.length ? `<div class="gleaders">${glCards.join("")}</div>` : "";
    const topLine = (side) => { if (!boxHas(side)) return ""; const t = teamTop(side); return t && t.pts != null ? `<div class="gh-lead"><span><b>${esc(t.name)}</b> ${t.pts} PTS</span></div>` : ""; };

    const lineRow = (side) => `<tr class="${(side === "home" ? hw : !hw) ? "win" : ""}"><td class="l grow">${teamLogo(g[side].abbr, "xs")} <a href="#/team/${g[side].abbr}">${esc(tName(g[side].abbr))}</a></td>
      ${cols.map((_, i) => `<td>${g[side].q && g[side].q[i] != null ? g[side].q[i] : "—"}</td>`).join("")}<td class="hi">${g[side].score ?? "—"}</td></tr>`;
    const boxTable = (side) => {
      const win = (side === "home" ? hw : !hw);
      if (!boxHas(side)) return `<div class="card pad" style="min-width:0"><div class="card-h"><h3>${teamLogo(g[side].abbr, "sm")} ${esc(tName(g[side].abbr))}</h3><span class="hint">${win ? "Win" : "Loss"} · ${g[side].score ?? "—"} pts</span></div><p class="muted" style="padding:14px 2px 6px">Player box score isn't available for this game yet.</p></div>`;
      const players = g.box[side].filter((p) => p.min != null);
      const maxPts = Math.max(1, ...players.map((p) => p.pts || 0));
      const topPts = Math.max(-1, ...players.map((p) => (p.pts == null ? -1 : p.pts)));
      const hasStarters = players.some((p) => p.start);
      const ordered = hasStarters ? [...players.filter((p) => p.start), ...players.filter((p) => !p.start)] : players;
      const firstBench = hasStarters ? players.filter((p) => p.start).length : -1;
      const prow = (p, i) => `<tr class="${p.pid ? "clickable" : ""}${p.start ? " starter" : ""}${i === firstBench ? " benchsep" : ""}" ${p.pid ? `onclick="location.hash='#/player/${p.pid}'"` : ""}>
        <td class="l grow"><span class="who">${p.pid ? headshot(p.pid, p.name, g[side].abbr, "xs") : ""}${p.pid ? `<a href="#/player/${p.pid}">${esc(p.name)}</a>` : `<span class="nm">${esc(p.name)}</span>`}</span></td>
        <td>${nz(p.min)}</td><td class="hi bar${p.pts != null && p.pts === topPts && topPts > 0 ? " peak" : ""}" style="--b:${((p.pts || 0) / maxPts).toFixed(3)}">${nz(p.pts)}</td><td>${nz(p.reb)}</td><td>${nz(p.ast)}</td><td>${nz(p.stl)}</td><td>${nz(p.blk)}</td><td>${nz(p.tov)}</td>
        <td>${frac(p.fgm, p.fga)}</td><td>${frac(p.tpm, p.tpa)}</td><td>${frac(p.ftm, p.fta)}</td><td class="${p.pm > 0 ? "pos" : p.pm < 0 ? "neg" : ""}">${p.pm == null ? "—" : p.pm > 0 ? "+" + p.pm : p.pm}</td></tr>`;
      return `<div class="card pad" style="min-width:0"><div class="card-h"><h3>${teamLogo(g[side].abbr, "sm")} ${esc(tName(g[side].abbr))}</h3><span class="hint">${win ? "Win" : "Loss"} · ${g[side].score ?? "—"} pts${g[side].fg != null ? " · " + pctf(g[side].fg) + " FG" : ""}</span></div>
        <div class="tbl-wrap"><table class="ref" style="min-width:640px"><thead><tr><th class="l grow">Player</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TOV</th><th>FG</th><th>3P</th><th>FT</th><th>+/−</th></tr></thead>
        <tbody>${ordered.map(prow).join("")}</tbody></table></div></div>`;
    };
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/games">Games</a><span class="sep">/</span><span>${g.away.abbr} @ ${g.home.abbr}</span></div>
      <div class="game-head">
        <div class="gh-team ${hw ? "" : "win"}">${teamLogo(g.away.abbr, "hero")}<div><div class="gh-ab"><a href="#/team/${g.away.abbr}">${esc(tName(g.away.abbr))}</a></div><div class="gh-score">${g.away.score ?? "—"}</div>${topLine("away")}</div></div>
        <div class="gh-mid"><div class="gh-final">FINAL${nOT > 0 ? "/OT" + (nOT > 1 ? nOT : "") : ""}</div><div class="gh-meta">${fmtDate(g.date, true)}</div>${gameTypeBadge(g.type, g.label)}${margin ? `<div class="gh-rec">Won by ${margin}</div>` : ""}</div>
        <div class="gh-team ${hw ? "win" : ""}"><div class="r"><div class="gh-ab"><a href="#/team/${g.home.abbr}">${esc(tName(g.home.abbr))}</a></div><div class="gh-score">${g.home.score ?? "—"}</div>${topLine("home")}</div>${teamLogo(g.home.abbr, "hero")}</div>
      </div>
      ${leadersStrip}
      <div class="card pad" style="margin-bottom:20px"><div class="tbl-wrap"><table class="ref" style="min-width:0"><thead><tr><th class="l grow">Team</th>${cols.map((c) => `<th>${c}</th>`).join("")}<th>T</th></tr></thead><tbody>${lineRow("away")}${lineRow("home")}</tbody></table></div>
        ${g.arena ? `<p class="news-foot" style="margin-top:12px;border:0;padding:0">${esc(g.arena)}${g.arenaCity ? " · " + esc(g.arenaCity) : ""}${g.attendance ? " · " + g.attendance.toLocaleString() + " att." : ""}${g.officials ? " · Officials: " + esc(g.officials) : ""}</p>` : ""}</div>
      <div class="ad-inline"><span class="lbl">Advertisement</span><div class="slot">Ad · 728×90</div></div>
      <div class="col2grid">${boxTable("away")}${boxTable("home")}</div>
      <div id="relGames"></div>
    </div>`;
    setSEO(`${tName(g.away.abbr)} vs ${tName(g.home.abbr)} — ${fmtDate(g.date, true)}`,
      `${tName(g.away.abbr)} ${g.away.score ?? ""}, ${tName(g.home.abbr)} ${g.home.score ?? ""} — box score, quarter scores and player stats from ${fmtDate(g.date, true)}${g.type && g.type !== "Regular Season" ? " (" + g.type + ")" : ""}.`);
    relatedGames(g).then((html) => { const el = $("#relGames"); if (el && html) el.innerHTML = html; });
  }

  // Related internal links for a game — season series + same-day slate.
  async function relatedGames(g) {
    let idx; try { idx = await getGamesIdx(g.season); } catch (e) { return ""; }
    const A = g.away.abbr, H = g.home.abbr, cards = [];
    const grow = (x) => `<a href="#/game/${x.id}"><span class="nm">${x.a} @ ${x.h}</span><span class="meta"><b>${x.as ?? "—"}–${x.hs ?? "—"}</b> · ${fmtDate(x.date)}</span></a>`;
    const series = idx.games.filter((x) => x.id !== g.id && ((x.a === A && x.h === H) || (x.a === H && x.h === A)));
    if (series.length) cards.push(`<div class="rel-card"><div class="rh"><b>Season series</b><span class="hint">${A} vs ${H}</span></div>
      <div class="rel-list">${series.slice(0, 6).map(grow).join("")}</div></div>`);
    const sameDay = idx.games.filter((x) => x.id !== g.id && x.date === g.date);
    if (sameDay.length) cards.push(`<div class="rel-card"><div class="rh"><b>Same day</b><span class="hint">${fmtDate(g.date)}</span></div>
      <div class="rel-list">${sameDay.slice(0, 6).map(grow).join("")}</div></div>`);
    if (!cards.length) return "";
    return `<div class="section-title" style="margin-top:26px"><div><h2>Related games</h2></div><a class="link" href="#/games/${g.season}">All ${seasonLabel(g.season)} games →</a></div><div class="rel-grid">${cards.join("")}</div>`;
  }

  // recent-games feed for a player profile (returns the card only, "" if none).
  // Two views toggle in the header, mirroring the career-stats tabs: a raw Box score
  // and an Advanced view (per-36 rates + PRA) — the only advanced cuts the per-game data supports.
  async function recentGamesCard(pid) {
    let rows; try { rows = await getPGames(pid); } catch { return ""; }
    if (!rows || !rows.length) return "";
    const N = 12, extra = rows.length > N;
    const pm = (v) => (v == null ? "—" : v > 0 ? "+" + v : v);
    const pmCls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
    const per36 = (v, m) => (m && v != null ? Math.round((v / m) * 36) : "—");
    const lead = (r) => `<td class="l grow season">${fmtDate(r.date, true)}</td>
      <td class="l"><span class="ha">${r.home ? "" : "@"}</span>${teamTag(r.opp)}</td>
      <td class="l"><span class="pill ${r.w ? "w" : "l"}">${r.w ? "W" : "L"}</span> <span class="muted">${r.us}–${r.them}</span></td>`;
    const boxRow = (r, i) => `<tr class="clickable${i >= N ? " gl-extra" : ""}" onclick="location.hash='#/game/${r.id}'">${lead(r)}
      <td>${r.min ?? "—"}</td><td class="hi">${r.pts ?? "—"}</td><td>${r.reb ?? "—"}</td><td>${r.ast ?? "—"}</td>
      <td class="${pmCls(r.pm)}">${pm(r.pm)}</td></tr>`;
    const advRow = (r, i) => { const pra = r.min == null ? null : (r.pts || 0) + (r.reb || 0) + (r.ast || 0);
      return `<tr class="clickable${i >= N ? " gl-extra" : ""}" onclick="location.hash='#/game/${r.id}'">${lead(r)}
      <td>${per36(r.pts, r.min)}</td><td>${per36(r.reb, r.min)}</td><td>${per36(r.ast, r.min)}</td><td class="hi">${pra == null ? "—" : pra}</td>
      <td class="${pmCls(r.pm)}">${pm(r.pm)}</td></tr>`; };
    const viewAll = `<a class="btn gl-toggle" style="margin-top:12px;width:100%;justify-content:center" href="#/games/player/${pid}">View all games <span aria-hidden="true">→</span></a>`;
    const view = (v, head, rowFn, foot) => `<div class="gl-view" data-view="${v}"${v === "adv" ? " hidden" : ""}>
      <div class="tbl-wrap"><table class="ref gl-table${extra ? " gl-collapsed" : ""}" style="min-width:520px">
        <thead><tr>${head}</tr></thead><tbody>${rows.map(rowFn).join("")}</tbody></table></div>${viewAll}${foot || ""}</div>`;
    const boxHead = `<th class="l grow">Date</th><th class="l">Opp</th><th class="l">Result</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>+/−</th>`;
    const advHead = `<th class="l grow">Date</th><th class="l">Opp</th><th class="l">Result</th><th title="Points per 36 minutes">PTS/36</th><th title="Rebounds per 36 minutes">REB/36</th><th title="Assists per 36 minutes">AST/36</th><th title="Points + rebounds + assists">PRA</th><th>+/−</th>`;
    const advFoot = `<p class="news-foot" style="margin:10px 0 0">Per-36 rates scale each game's line to a 36-minute pace. PRA = points + rebounds + assists.</p>`;
    return `<div class="card pad gl-card" style="min-width:0"><div class="card-h"><h3>Game log</h3>
        <div class="tabs gl-tabs"><button data-v="box" aria-selected="true">Box score</button><button data-v="adv" aria-selected="false">Advanced</button></div></div>
      ${view("box", boxHead, boxRow)}
      ${view("adv", advHead, advRow, advFoot)}</div>`;
  }

  // Toggle the Game log card between its Box score / Advanced views.
  function wireGameLog(scope) {
    (scope || document).querySelectorAll(".gl-card").forEach((card) => {
      const tabs = card.querySelector(".gl-tabs"); if (!tabs) return;
      $$("button", tabs).forEach((b) => b.addEventListener("click", () => {
        $$("button", tabs).forEach((x) => x.setAttribute("aria-selected", "false"));
        b.setAttribute("aria-selected", "true");
        card.querySelectorAll(".gl-view").forEach((v) => { v.hidden = v.dataset.view !== b.dataset.v; });
      }));
    });
  }

  // Related internal links for a player — teammates + verified draft class.
  // More on-page links → more pages/session and denser internal linking for SEO.
  async function relatedPlayers(p) {
    const c = p.cur, id = p.id, cards = [];
    if (isRealTeam(c.team)) {
      try {
        const t = await getTeam(c.team);
        const mates = (t.roster || []).filter((r) => r[0] && r[0] !== id).slice(0, 7);
        if (mates.length) cards.push(`<div class="rel-card"><div class="rh"><b>Teammates</b><a href="#/team/${c.team}">${esc(tName(c.team))} →</a></div>
          <div class="rel-list">${mates.map((r) => `<a href="#/player/${r[0]}">${headshot(r[0], r[1], c.team, "xs")}<span class="nm">${esc(r[1])}</span><span class="meta"><b>${one(r[4])}</b> ppg</span></a>`).join("")}</div></div>`);
      } catch (e) {}
    }
    // draft class: verify membership across the plausible debut-lag years, so the link is never wrong
    const from = (p.bio && p.bio.from) || (p.log[0] && p.log[0][0]);
    if (from) {
      let cls = null, dyear = null;
      for (const y of [from - 1, from - 2, from]) {
        try { const d = await getDraft(y); if ((d.picks || []).some((pk) => pk[3] === id)) { cls = d; dyear = y; break; } } catch (e) {}
      }
      if (cls) {
        const mates = cls.picks.filter((pk) => pk[3] && pk[3] !== id).slice(0, 7);
        if (mates.length) cards.push(`<div class="rel-card"><div class="rh"><b>Draft class of ${dyear}</b><a href="#/draft/${dyear}">Full draft →</a></div>
          <div class="rel-list">${mates.map((pk) => `<a href="#/player/${pk[3]}"><span class="nm">${esc(pk[4])}</span><span class="meta">#${pk[0]}${isRealTeam(pk[2]) ? " · " + pk[2] : ""}</span></a>`).join("")}</div></div>`);
      }
    }
    if (!cards.length) return "";
    return `<div class="section-title" style="margin-top:26px"><div><h2>Related players</h2></div></div><div class="rel-grid">${cards.join("")}</div>`;
  }

  // Resolve a player's own draft slot (year / round / overall / team), verified by
  // membership across the plausible debut-lag years. Returns {undrafted:true} if none.
  async function draftInfo(p) {
    const from = (p.bio && p.bio.from) || (p.log[0] && p.log[0][0]);
    if (!from) return null;
    const yrs = [from - 1, from - 2, from];
    const files = await Promise.all(yrs.map((y) => getDraft(y).catch(() => null)));
    for (let i = 0; i < files.length; i++) {
      const d = files[i]; if (!d) continue;
      const pk = (d.picks || []).find((x) => x[3] === p.id);
      if (pk) return { year: yrs[i], overall: pk[0], round: pk[1], team: pk[2] };
    }
    return { undrafted: true };
  }

  // Light up a rank pip on a stat tile when the player is top-10 in the league for
  // that stat in their current/last season (season leaders are top-10 lists).
  async function fillRanks(p) {
    let S; try { S = await getSeason(p.cur.season); } catch (e) { return; }
    const L = S.leaders || {};
    $$("#app .tile[data-stat]").forEach((t) => {
      const key = t.dataset.stat; if (!key || !L[key]) return;
      const idx = L[key].findIndex((x) => x[0] === p.id);
      if (idx >= 0) { const v = t.querySelector(".v"); if (v) v.insertAdjacentHTML("afterend", `<span class="trank" title="${ord(idx + 1)} in the NBA · ${seasonLabel(p.cur.season)}">${ord(idx + 1)}</span>`); }
    });
  }

  // Recent-form splits (last 10 / home / away / in wins / in losses) from the game log.
  async function splitsCard(pid) {
    let rows; try { rows = await getPGames(pid); } catch (e) { return ""; }
    if (!rows || rows.length < 4) return "";
    const agg = (rs) => { if (!rs.length) return null; const n = rs.length, s = (k) => rs.reduce((a, r) => a + (r[k] || 0), 0); return { g: n, mpg: s("min") / n, ppg: s("pts") / n, rpg: s("reb") / n, apg: s("ast") / n }; };
    // rest splits — gap to the previous (older) game; ≤1 day = back-to-back/short rest
    const dd = (a, b) => { const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number); return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000); };
    const rested = [], shortR = [];
    for (let i = 0; i < rows.length; i++) { const nx = rows[i + 1]; if (!nx) { rested.push(rows[i]); continue; } (dd(rows[i].date, nx.date) <= 1 ? shortR : rested).push(rows[i]); }
    const defs = [["Last 10", rows.slice(0, 10)], ["Home", rows.filter((r) => r.home)], ["Away", rows.filter((r) => !r.home)], ["On rest (2+ d)", rested], ["Short rest (≤1 d)", shortR], ["In wins", rows.filter((r) => r.w)], ["In losses", rows.filter((r) => !r.w)]];
    // tiny "form" glyph: scoring shape over the last 10 games, oldest → newest, most recent bar emphasised
    const l10 = rows.slice(0, 10).filter((r) => r.pts != null);
    const spark = l10.length >= 3 ? (() => { const v = l10.map((r) => r.pts).reverse(), mx = Math.max(...v, 1);
      return `<span class="spk" title="Points, last ${v.length} games (old → new)" aria-hidden="true">${v.map((x, i) => `<i class="${i === v.length - 1 ? "now" : ""}" style="height:${Math.max(16, Math.round(x / mx * 100))}%"></i>`).join("")}</span>`; })() : "";
    const line = (lab, a, extra) => a ? `<tr><td class="l">${lab}${extra || ""}</td><td>${a.g}</td><td>${a.mpg.toFixed(1)}</td><td class="hi">${a.ppg.toFixed(1)}</td><td>${a.rpg.toFixed(1)}</td><td>${a.apg.toFixed(1)}</td></tr>` : "";
    return `<div class="card pad" style="min-width:0"><div class="card-h"><h3>Recent splits</h3><span class="hint">last ${rows.length} games</span></div>
      <div class="tbl-wrap"><table class="ref" style="min-width:0;width:100%"><thead><tr><th class="l">Split</th><th>G</th><th>MPG</th><th>PPG</th><th>RPG</th><th>APG</th></tr></thead>
      <tbody>${defs.map(([lab, rs]) => line(lab, agg(rs), lab === "Last 10" ? spark : "")).join("")}</tbody></table></div></div>`;
  }

  // NBA 2K rating card — OVR badge + six attribute-category bars (dense by design).
  async function twoKCard(pid) {
    if (!SHOW_2K) return "";
    let d; try { d = await getTwoK(); } catch (e) { return ""; }
    const r = d && d.ratings && d.ratings[pid];
    const hist = await getTwoKHist();
    const hrec = hist && hist.players && hist.players[pid];
    if (!r && !hrec) return "";
    // OVR across every 2K edition the player appeared in — an inline SVG sparkline
    // (no chart lib), points labelled at the ends and at the peak so the arc reads
    // without a hover. Editions come pre-ordered from the harvest.
    let histHtml = "";
    if (hrec) {
      const pts = hist.editions.filter((e) => hrec[e] != null).map((e) => ({ e, v: hrec[e] }));
      if (pts.length >= 2) {
        const vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs);
        const W = 300, H = 64, pad = 8, span = Math.max(1, hi - lo);
        // Space points by their actual edition number, not evenly by index, so a
        // missing edition (e.g. the 2K23–24 gap between the archived charts and the
        // current-edition merge) reads as a real gap instead of a silent step.
        const en = (e) => parseInt(String(e).replace(/\D/g, ""), 10) || 0;
        const e0 = en(pts[0].e), eSpan = Math.max(1, en(pts[pts.length - 1].e) - e0);
        const x = (i) => pad + (en(pts[i].e) - e0) * (W - 2 * pad) / eSpan;
        const y = (v) => H - pad - (v - lo) * (H - 2 * pad) / span;
        const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
        const peak = pts.reduce((a, b) => (b.v > a.v ? b : a));
        const dot = (p, i, cls) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.6" class="${cls}"/>`;
        const lab = (p, i) => `<text x="${x(i).toFixed(1)}" y="${(y(p.v) - 7).toFixed(1)}" class="tkh-lab">${p.v}</text>`;
        const ends = [0, pts.length - 1, pts.indexOf(peak)].filter((v, i, a) => a.indexOf(v) === i);
        histHtml = `<div class="tkh">
          <div class="tkh-h"><span class="tkh-t">2K rating by edition</span><span class="tkh-r">${pts[0].e.replace("2K", "2K")} – ${pts[pts.length - 1].e}</span></div>
          <svg viewBox="0 0 ${W} ${H}" class="tkh-svg" preserveAspectRatio="none" role="img" aria-label="2K overall rating over time">
            <path d="${line}" fill="none" class="tkh-line"/>
            ${pts.map((p, i) => ends.includes(i) ? dot(p, i, i === pts.indexOf(peak) ? "tkh-dot peak" : "tkh-dot") : "").join("")}
            ${ends.map((i) => lab(pts[i], i)).join("")}
          </svg>
          <div class="tkh-x"><span>${pts[0].e}</span><span>${pts[pts.length - 1].e}</span></div>
        </div>`;
      }
    }
    // history exists but no current-edition attributes: still show the arc on its own
    if (!r) return `<div class="card pad" id="twokInner" style="margin-top:26px">
        <div class="card-h"><h3>NBA 2K rating</h3><span class="hint">career editions</span></div>
        ${histHtml}
      </div>`;
    const avg = (keys) => { const vs = keys.map((k) => r[k]).filter((v) => v != null); return vs.length ? Math.round(vs.reduce((a, b) => a + b, 0) / vs.length) : null; };
    const cats = [
      ["Outside", avg(["closeShot", "midRangeShot", "threePointShot", "freeThrow"])],
      ["Inside", avg(["layup", "drivingDunk", "standingDunk", "postControl"])],
      ["Playmaking", avg(["passAccuracy", "ballHandle", "speedWithBall", "passVision"])],
      ["Defense", avg(["interiorDefense", "perimeterDefense", "steal", "block", "helpDefenseIQ"])],
      ["Athleticism", avg(["speed", "agility", "strength", "vertical", "stamina"])],
      ["Rebounding", avg(["offensiveRebound", "defensiveRebound"])],
    ].filter((c) => c[1] != null);
    const ovr = r.ovr || 0;
    const tier = ovr >= 95 ? "Legend" : ovr >= 90 ? "Superstar" : ovr >= 85 ? "All-Star" : ovr >= 80 ? "Starter" : ovr >= 75 ? "Rotation" : "Reserve";
    const bar = (lab, v) => `<div class="tk-attr"><div class="tk-lab">${lab}</div><div class="tk-meter"><i style="width:${v}%"></i></div><div class="tk-val">${v}</div></div>`;
    return `<div class="card pad" style="margin-top:26px">
        <div class="card-h"><h3>NBA 2K rating</h3><span class="hint">${esc(d.edition)}</span></div>
        <div class="twok">
          <div class="tk-badge"><div class="tk-ovr">${ovr}</div><div class="tk-ovr-l">Overall</div><div class="tk-tier">${tier}</div></div>
          <div class="tk-attrs">${cats.map(([l, v]) => bar(l, v)).join("")}</div>
        </div>
        ${histHtml}
      </div>`;
  }

  // Sticky in-page section nav (tabbed style, but everything stays on one
  // crawlable page). Smooth-scrolls to sections, highlights the active one, and
  // prunes links whose async section never filled.
  function wireJumpNav() {
    const nav = $("#jumpNav"); if (!nav) return;
    const links = $$("a", nav);
    links.forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); const el = document.getElementById(a.dataset.tgt); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.dataset.tgt === en.target.id)); }), { rootMargin: "-118px 0px -72% 0px", threshold: 0 });
      links.forEach((a) => { const el = document.getElementById(a.dataset.tgt); if (el) io.observe(el); });
    }
    const prune = () => {
      links.forEach((a) => { const el = document.getElementById(a.dataset.tgt); if (el && !el.textContent.trim() && !el.querySelector("svg,img,canvas,table")) a.remove(); });
      if ($$("a", nav).length <= 1) nav.style.display = "none";
    };
    setTimeout(prune, 500); setTimeout(prune, 1400);
  }

  /* ================= PLAYER ================= */
  async function renderPlayer(id) {
    let p; try { p = await getPlayer(id); } catch { return notFound("player"); }
    const sal = await getSalaries().catch(() => null);
    if (sal) CPI = CPI || await getCPI().catch(() => null);
    const salRows = (sal && sal.byPlayer[id]) || null;
    // season -> team from the player's own game log (fills teams the salary source lacks)
    const salTeam = {}, logTeams = {};
    p.log.forEach((r) => { if (r[16] !== 2 && isRealTeam(r[2])) { salTeam[r[0]] = r[2]; (logTeams[r[0]] = logTeams[r[0]] || new Set()).add(r[2]); } });
    const teamForSeason = (yr) => {
      const row = ((sal && sal.bySeason[yr] || []).find((x) => x[0] === id) || [])[2];
      // dead-money re-attribution: when the salary is filed under a team the player never suited
      // up for that season (a bought-out vet's guaranteed money on the team that waived him),
      // show that paying team; otherwise use the game-log team he actually played for.
      if (row && logTeams[yr] && !logTeams[yr].has(row)) return row;
      return salTeam[yr] || row || "";
    };
    const b = p.bio, c = p.cur, col = tColor(c.team), curSeasonNo = c.season;
    const age = b.born ? curSeasonNo - (+b.born.slice(0, 4)) : null;
    const spanTeams = [...new Set(p.log.map((r) => r[2]))].filter(isRealTeam);
    // teams strip for the masthead: current team first (marked), rest after, collapse journeymen
    // Career team timeline: consecutive-season stints in chronological order, with the
    // year range on each pill and arrows to the current/most-recent team (highlighted).
    const _stints = [];
    p.log.filter((r) => isRealTeam(r[2])).forEach((r) => { const last = _stints[_stints.length - 1]; if (last && last.ab === r[2]) last.to = r[0]; else _stints.push({ ab: r[2], from: r[0], to: r[0] }); });
    _stints.forEach((s, i) => { s.cur = i === _stints.length - 1 && c.season === META.current; });
    const _yr = (s) => `${s.from - 1}–${s.to === META.current ? "now" : String(s.to).slice(2)}`;
    const stintPill = (s) => `<a href="#/team/${s.ab}" class="tm-mini${s.cur ? " cur" : ""}" title="${esc(tName(s.ab))} · ${seasonLabel(s.from)} to ${seasonLabel(s.to)}">${teamLogo(s.ab, "xs")}<span class="tm-ab">${esc(s.ab)}</span><span class="tm-yrs">${_yr(s)}</span></a>`;
    const teamsStrip = _stints.length ? `<div class="tm-timeline">${_stints.map(stintPill).join('<span class="tm-arrow" aria-hidden="true">›</span>')}</div>` : "";
    const draft = await draftInfo(p).catch(() => null);
    const nSeasons = new Set(p.log.filter((r) => r[16] !== 2).map((r) => r[0])).size;
    // Active players show the current season (with league-rank pips); retired players
    // show CAREER averages — so a retired player's headline isn't just their final season.
    const active = c.season === META.current;
    const cAvg = p.career || c, cTot = p.ctot || {};
    const careerTS = cTot.pts && ((cTot.fga || 0) + (cTot.fta || 0)) ? cTot.pts / (2 * ((cTot.fga || 0) + 0.44 * (cTot.fta || 0))) : null;
    let _mp = 0, _perW = 0; (p.adv || []).filter((r) => r[15] !== 2).forEach((r) => { const m = r[3] || 0; _mp += m; _perW += (r[4] || 0) * m; });
    const careerPER = _mp ? _perW / _mp : null;
    const tiles = active
      ? [["PPG", one(c.pts), "pts", 1], ["RPG", one(c.trb), "trb"], ["APG", one(c.ast), "ast"], ["FG%", pctf(c.fg), "fg_percent"], ["3P%", pctf(c.tp), "x3p_percent"], ["TS%", pctf(c.ts), "ts_percent"], ["PER", one(c.per), "per"]]
      : [["PPG", one(cAvg.pts), "pts", 1], ["RPG", one(cAvg.trb), "trb"], ["APG", one(cAvg.ast), "ast"], ["FG%", pctf(cAvg.fg), "fg_percent"], ["3P%", pctf(cAvg.tp), "x3p_percent"], ["TS%", pctf(careerTS), "ts_percent"], ["PER", one(careerPER), "per"]];

    // per-column context: scale the PTS bar to the player's own career-high season,
    // and pip the single best scoring season (turns the table into a scannable arc).
    const logRows = p.log.filter((r) => r[16] !== 2);
    const maxPts = Math.max(1, ...logRows.map((r) => r[13] || 0));
    const peakYr = (logRows.slice().sort((a, b) => (b[13] || 0) - (a[13] || 0))[0] || [])[0];
    const row = (r) => { const st = r[16] === 2; return `<tr class="${st ? "stint" : "clickable"}" ${st ? "" : `onclick="location.hash='#/pseason/${p.id}/${r[0]}'"`}>
      <td class="l season">${st ? "" : seasonLabel(r[0])}</td><td class="l">${teamTag(r[2])}</td>
      <td>${r[3] ?? "—"}</td><td>${r[4]}</td><td>${one(r[5])}</td>
      <td>${pctf(r[6])}</td><td>${pctf(r[7])}</td><td>${pctf(r[8])}</td>
      <td>${one(r[9])}</td><td>${one(r[10])}</td><td>${one(r[11])}</td><td>${one(r[12])}</td>
      <td class="hi bar${!st && r[0] === peakYr ? " peak" : ""}" style="--b:${((r[13] || 0) / maxPts).toFixed(3)}">${one(r[13])}</td><td>${one(r[14])}</td><td>${pctf(r[15])}</td></tr>`; };
    const cr = p.career || {}, ct = p.ctot || {};
    const careerRow = `<tr class="total">
      <td class="l">Career</td><td class="l muted">${p.log.length} yr</td><td>—</td><td>${cr.g ?? "—"}</td><td>—</td>
      <td>${pctf(cr.fg)}</td><td>${pctf(cr.tp)}</td><td>${pctf(cr.ft)}</td>
      <td>${one(cr.trb)}</td><td>${one(cr.ast)}</td><td>${one(cr.stl)}</td><td>${one(cr.blk)}</td>
      <td class="hi">${one(cr.pts)}</td><td>—</td><td>—</td></tr>`;
    const totRow = (r) => { const st = r[19] === 2; return `<tr class="${st ? "stint" : ""}">
      <td class="l season">${st ? "" : seasonLabel(r[0])}</td><td class="l">${teamTag(r[1])}</td>
      <td>${intOr(r[2])}</td><td>${intOr(r[3])}</td><td>${intc(r[4])}</td><td>${intc(r[5])}</td><td>${intc(r[6])}</td><td>${pctf(r[7])}</td>
      <td>${intOr(r[8])}</td><td>${intOr(r[9])}</td><td>${intOr(r[10])}</td><td>${intOr(r[11])}</td>
      <td>${intOr(r[12])}</td><td>${intOr(r[13])}</td><td>${intOr(r[14])}</td><td>${intOr(r[15])}</td><td>${intOr(r[16])}</td><td class="hi">${intc(r[17])}</td></tr>`; };
    const totCareer = `<tr class="total"><td class="l">Career</td><td class="l muted">${p.log.length} yr</td>
      <td>${intOr(ct.g)}</td><td>—</td><td>—</td><td>${intc(ct.fg)}</td><td>${intc(ct.fga)}</td><td>${pctf(ct.fg && ct.fga ? ct.fg / ct.fga : null)}</td>
      <td>${intOr(ct.x3p)}</td><td>${intOr(ct.x3pa)}</td><td>${intOr(ct.ft)}</td><td>${intOr(ct.fta)}</td>
      <td>${intOr(ct.trb)}</td><td>${intOr(ct.ast)}</td><td>${intOr(ct.stl)}</td><td>${intOr(ct.blk)}</td><td>${intOr(ct.tov)}</td><td class="hi">${intc(ct.pts)}</td></tr>`;
    // Per-36-minutes view (bbref parity): counting stats normalised to 36 min from the totals.
    const p36 = (v, mp) => (mp && v != null ? one(v / mp * 36) : "—");
    const per36Row = (r) => { const st = r[19] === 2, mp = r[4]; return `<tr class="${st ? "stint" : ""}">
      <td class="l season">${st ? "" : seasonLabel(r[0])}</td><td class="l">${teamTag(r[1])}</td>
      <td>${intOr(r[2])}</td><td>${mp && r[2] ? one(mp / r[2]) : "—"}</td>
      <td>${p36(r[5], mp)}</td><td>${p36(r[6], mp)}</td><td>${pctf(r[7])}</td>
      <td>${p36(r[8], mp)}</td><td>${p36(r[9], mp)}</td><td>${p36(r[10], mp)}</td><td>${p36(r[11], mp)}</td>
      <td>${p36(r[12], mp)}</td><td>${p36(r[13], mp)}</td><td>${p36(r[14], mp)}</td><td>${p36(r[15], mp)}</td><td>${p36(r[16], mp)}</td><td class="hi">${p36(r[17], mp)}</td></tr>`; };
    const p36Career = (() => {
      const rs = p.tot.filter((r) => r[19] !== 2), sc = (i) => rs.reduce((a, r) => a + (r[i] || 0), 0), mp = sc(4), g = sc(2);
      const c = (i) => (mp ? one(sc(i) / mp * 36) : "—");
      return `<tr class="total"><td class="l">Career</td><td class="l muted">${p.log.length} yr</td>
        <td>${intOr(g)}</td><td>${mp && g ? one(mp / g) : "—"}</td>
        <td>${c(5)}</td><td>${c(6)}</td><td>${pctf(sc(6) ? sc(5) / sc(6) : null)}</td>
        <td>${c(8)}</td><td>${c(9)}</td><td>${c(10)}</td><td>${c(11)}</td>
        <td>${c(12)}</td><td>${c(13)}</td><td>${c(14)}</td><td>${c(15)}</td><td>${c(16)}</td><td class="hi">${c(17)}</td></tr>`;
    })();
    const advRow = (r) => { const st = r[15] === 2; return `<tr class="${st ? "stint" : ""}">
      <td class="l season">${st ? "" : seasonLabel(r[0])}</td><td class="l">${teamTag(r[1])}</td>
      <td>${intOr(r[2])}</td><td>${intc(r[3])}</td><td>${one(r[4])}</td><td>${pctf(r[5])}</td><td>${one(r[6])}</td>
      <td>${one(r[7])}</td><td>${one(r[8])}</td><td class="hi">${one(r[9])}</td><td>${ws48(r[10])}</td>
      <td>${signed(r[11])}</td><td>${signed(r[12])}</td><td>${signed(r[13])}</td><td>${signed(r[14])}</td></tr>`; };
    const advCareer = `<tr class="total"><td class="l">Career</td><td class="l muted">${p.log.length} yr</td>
      <td>${intOr(ct.g)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td class="hi">${one(ct.ws)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${one(ct.vorp)}</td></tr>`;
    const poRow = (r) => `<tr><td class="l season">${seasonLabel(r[0])}</td><td>${r[1]}</td><td class="hi">${one(r[2])}</td><td>${pctf(r[3])}</td></tr>`;
    const H = (arr) => `<thead><tr>${arr.map((h, i) => `<th class="${i < 2 ? "l" : ""}">${h}</th>`).join("")}</tr></thead>`;
    function statTable(view) {
      if (view === "tot") return `<div class="tbl-wrap"><table class="ref" style="min-width:840px">${H(["Season", "Tm", "G", "GS", "MP", "FG", "FGA", "FG%", "3P", "3PA", "FT", "FTA", "REB", "AST", "STL", "BLK", "TOV", "PTS"])}<tbody>${p.tot.map(totRow).join("")}${totCareer}</tbody></table></div>`;
      if (view === "p36") return `<div class="tbl-wrap"><table class="ref" style="min-width:820px">${H(["Season", "Tm", "G", "MPG", "FG", "FGA", "FG%", "3P", "3PA", "FT", "FTA", "REB", "AST", "STL", "BLK", "TOV", "PTS"])}<tbody>${p.tot.map(per36Row).join("")}${p36Career}</tbody></table><p class="news-foot" style="border:0;padding:8px 2px 0;margin:0">Per-36-minute rates — counting stats scaled to a per-36 pace.</p></div>`;
      if (view === "adv") return `<div class="tbl-wrap"><table class="ref" style="min-width:720px">${H(["Season", "Tm", "G", "MP", "PER", "TS%", "USG%", "OWS", "DWS", "WS", "WS/48", "OBPM", "DBPM", "BPM", "VORP"])}<tbody>${p.adv.map(advRow).join("")}${advCareer}</tbody></table></div>`;
      if (view === "po" && p.po) return `<div class="tbl-wrap"><table class="ref" style="min-width:0">${H(["Season", "G", "PPG", "TS%"])}<tbody>${p.po.log.map(poRow).join("")}<tr class="total"><td class="l">Career</td><td>${p.po.g}</td><td class="hi">${one(p.po.ppg)}</td><td>${pctf(p.po.ts)}</td></tr></tbody></table></div>`;
      return `<div class="tbl-wrap"><table class="ref" style="min-width:760px">${H(["Season", "Tm", "Age", "GP", "MPG", "FG%", "3P%", "FT%", "REB", "AST", "STL", "BLK", "PTS", "PER", "TS%"])}<tbody>${p.log.map(row).join("")}${careerRow}</tbody></table></div>`;
    }

    // Jersey numbers with the seasons and team behind each — bio.numbers alone could
    // only manage "#23 +1" in a tooltip, which says nothing about when and is invisible
    // on touch. Spans come pre-collapsed from build/apply_jersey_history.py.
    const numHist = (b.numHist || []).filter((h) => h.n);
    const yrRange = (lo, hi) => lo === hi ? `<span class=nb>${seasonLabel(lo)}</span>` : `<span class=nb>${seasonLabel(lo)}</span> – <span class=nb>${seasonLabel(hi)}</span>`;
    const numHistHtml = numHist.length ? numHist.map((h) => `<span class="jsy">
        <span class="jsy-n">${esc(h.n)}</span>
        <span class="jsy-sp">${h.sp.map(([tm, lo, hi]) => `<span class="jsy-s">${teamLogo(tm, "xs", hi)}<span class="jsy-y">${yrRange(lo, hi)}</span></span>`).join("")}</span>
      </span>`).join("") : "";

    app.innerHTML = `
    <div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/players">Players</a><span class="sep">/</span><span>${esc(p.name)}</span></div>
      <div class="phead">
        <div class="band" style="background:${col}"></div>
        <div class="inner">
          ${headshot(p.id, p.name, c.team, "hero")}
          <div class="ph-main">
            <div class="pos">${esc(c.pos || b.pos || "")}${active && isRealTeam(c.team) ? `${(c.pos || b.pos) ? " · " : ""}<a href="#/team/${c.team}">${esc(tName(c.team))}</a>` : ""}</div>
            <h1>${esc(p.name)}</h1>
            ${b.nickname ? `<div class="ph-nick">“${esc(b.nickname)}”</div>` : ""}
            <div class="bio">
              ${b.num ? bioItem("Number", `<span>#${esc(b.num)}</span>`) : ""}
              ${bioItem("Seasons", `${seasonLabel(b.from || p.log[0][0])} – ${seasonLabel(b.to || curSeasonNo)}`)}
              ${bioItem("Experience", nSeasons <= 1 ? "Rookie" : nSeasons + " seasons")}
              ${b.ht ? bioItem("Ht / Wt", `${b.ht}${b.wt ? " · " + b.wt + " lb" : ""}`) : ""}
              ${age ? bioItem("Age", `${age}${b.born ? " · b. " + b.born.slice(0, 4) : ""}`) : ""}
              ${draft ? (draft.undrafted ? bioItem("Draft", "Undrafted") : bioItem("Draft", `${draft.year} · Rd ${draft.round}, Pk ${draft.overall}${isRealTeam(draft.team) ? " · " + draft.team : ""}`)) : ""}
              ${b.college ? bioItem("College", esc(b.college)) : (b.highSchool ? bioItem("High School", esc(b.highSchool)) : "")}
            </div>
            <div id="playerInjury"></div>
          </div>
        </div>
      </div>

      <div class="tilerow">${tiles.map(([k, v, sk, a]) => `<div class="tile ${a ? "accent" : ""}" data-stat="${sk || ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}
        <div class="tile"><div class="k">${active ? "Season" : "Career G"}</div><div class="v" style="font-size:22px">${active ? seasonLabel(curSeasonNo) : (cAvg.g || cTot.g || 0).toLocaleString()}</div></div></div>

      ${(p.acc.length || teamsStrip) ? `<div class="co">
        ${p.acc.length ? `<div class="co-row"><span class="co-lab">Honors</span><div class="chip-row">${p.acc.map((a) => { const d = accDetail(a.t, p.accy) || accDesc(a.t); return `<span class="chip ${a.g ? "gold" : ""} has-detail" data-acc="${esc(a.t)}" data-years="${esc(d)}">${a.g ? "★ " : ""}${esc(a.t)}</span>`; }).join("")}</div></div>` : ""}
        ${teamsStrip ? `<div class="co-row"><span class="co-lab">Career path</span>${teamsStrip}</div>` : ""}
        ${numHistHtml ? `<div class="co-row"><span class="co-lab">Numbers</span><div class="jsy-row">${numHistHtml}</div></div>` : ""}
      </div>` : ""}

      <nav class="jumpnav" id="jumpNav">${[["Stats", "sec-stats"], ["Recent", "recentForm"], ["Shooting", "sec-shooting"], (salRows && salRows.length ? ["Salary", "sec-salary"] : null), (SHOW_2K ? ["2K", "sec-2k"] : null), ["News", "playerNews"], ["Related", "relPlayers"]].filter(Boolean).map(([lab, t]) => `<a href="#" data-tgt="${t}">${lab}</a>`).join("")}</nav>

      <div class="card pad" id="sec-stats" style="min-width:0;margin-bottom:22px">
        <div class="card-h"><div style="display:flex;align-items:baseline;gap:14px;min-width:0"><h3>Career stats</h3></div>
          <div class="tabs" id="statTabs">
            <button data-v="perg" aria-selected="true">Per Game</button>
            <button data-v="tot" aria-selected="false">Totals</button>
            <button data-v="p36" aria-selected="false">Per 36</button>
            <button data-v="adv" aria-selected="false">Advanced</button>
            ${p.po ? `<button data-v="po" aria-selected="false">Playoffs</button>` : ""}
          </div></div>
        <div id="statBody">${statTable("perg")}</div>
      </div>

      <div id="recentForm"></div>
      <div class="col2grid" id="sec-shooting">
        <div class="card pad">
          <div class="card-h"><h3>Career shooting</h3><span class="hint">splits</span></div>
          <div class="splits">${[["Field goal", cr.fg], ["Three-point", cr.tp], ["Free throw", cr.ft]].map(([lab, v]) =>
            `<div class="sr"><div class="lab">${lab}</div><div class="meter"><i style="width:${v ? Math.min(100, v * 100) : 0}%"></i></div><div class="pct">${pctf(v)}</div></div>`).join("")}</div>
        </div>
        <div class="card pad">
          <div class="card-h"><h3>Scoring trend</h3><span class="hint">PPG · hover for detail</span></div>
          <div class="trend" id="trend"></div>
        </div>
      </div>
      <div id="shotProfile"></div>
      <div class="ad-inline"><span class="lbl">Advertisement</span><div class="slot">Ad · 728×90</div></div>
      ${salRows && salRows.length ? `<div class="section-title" id="sec-salary" style="margin-top:26px"><h2>Contracts &amp; salary</h2><a class="link" href="#/salaries">Salary hub →</a></div>
        <div class="col2grid">
          <div class="card pad" style="min-width:0">
            <div class="card-h"><h3>Salary by season</h3>${CPI ? `<div class="tabs" id="pSalToggle"><button data-adj="0" aria-selected="true">Nominal</button><button data-adj="1" aria-selected="false">${seasonLabel(CPI.base)} $</button></div>` : `<span class="hint">tap a row → salaries</span>`}</div>
            <div class="tbl-wrap"><table class="ref" style="min-width:0">
              <thead><tr><th class="l grow">Season</th><th class="l">Team</th><th>Salary</th></tr></thead>
              <tbody>${salRows.map((r) => {
                const fut = r[0] > META.current;
                // a season split across teams (a traded / bought-out player) shows one row per
                // team — each the exact figure that team paid — matching the team-payroll pages.
                const parts = ((sal && sal.bySeason[r[0]]) || []).filter((x) => x[0] === id);
                const sub = parts.length > 1 ? parts.slice().sort((a, b) => b[3] - a[3]).map((p) => [p[2], p[3]]) : [[teamForSeason(r[0]), r[1]]];
                return sub.map(([tm, amt], i) => `<tr class="clickable${fut ? " fut-row" : ""}${i > 0 ? " sal-sub" : ""}" onclick="location.hash='#/salaries/${r[0]}'"><td class="l season grow">${i === 0 ? seasonLabel(r[0]) + (fut ? ` <span class="fut-tag">Future</span>` : "") + (sub.length > 1 ? ` <span class="muted" style="font-weight:400">· ${sub.length} teams</span>` : "") : ""}</td><td class="l muted">${tm ? teamTag(tm) : "—"}</td><td class="hi pSal" data-sal="${amt}" data-season="${r[0]}">${moneyFull(amt)}</td></tr>`).join("");
              }).join("")}
                <tr class="total"><td class="l grow">Tracked to date</td><td class="l">—</td><td class="hi pSalTotal" data-sal="${sal.careerEarn[id]}">${moneyFull(sal.careerEarn[id])}</td></tr></tbody></table></div>
            ${(() => { const fut = salRows.filter((r) => r[0] > META.current); return fut.length ? `<p class="news-foot" style="border:0;margin:10px 0 0;padding:0"><span class="fut-tag">Future</span> ${fut.length} season${fut.length > 1 ? "s" : ""} still under contract — ${money(fut.reduce((a, r) => a + r[1], 0))} committed, not yet earned.</p>` : ""; })()}
          </div>
          <div class="card pad">
            <div class="card-h"><h3>Earnings</h3><span class="hint">${sal.range ? seasonLabel(sal.range[0]).slice(0, 4) + "–" + String(sal.range[1]).slice(2) : ""}</span></div>
            <div class="tilerow" style="margin-bottom:14px">
              <div class="tile accent"><div class="k">Tracked earnings</div><div class="v">${money(sal.careerEarn[id])}</div></div>
              <div class="tile"><div class="k">Peak season</div><div class="v">${money(Math.max.apply(null, salRows.map((r) => r[1])))}</div></div>
            </div>
            <p class="news-foot" style="border:0;margin:0;padding:0">Nominal salaries (not inflation-adjusted), merged from public open datasets. Coverage is ${sal.range ? seasonLabel(sal.range[0]) + " through " + seasonLabel(sal.range[1]) : "historical"}; the current season reflects players under contract at last update.</p>
          </div>
        </div>` : ""}
      <div id="sec-2k"></div>
      <div id="playerNews"></div>
      <div id="relPlayers"></div>
    </div>`;
    // ---- SEO: title + description targeting "[player] stats / contract / salary" ----
    (function () {
      const posName = c.pos || b.pos || "", teamName = isRealTeam(c.team) ? tName(c.team) : c.team;
      const yrs = `${seasonLabel(b.from || p.log[0][0])}–${seasonLabel(b.to || curSeasonNo)}`;
      const careerLine = `${one(cr.pts)} PPG, ${one(cr.trb)} RPG, ${one(cr.ast)} APG`;
      const topAcc = (p.acc || []).filter((a) => a.g).slice(0, 2).map((a) => a.t).join(", ");
      let salLine = "";
      if (salRows && salRows.length) {
        const latest = salRows[salRows.length - 1];
        salLine = ` Latest tracked salary ${moneyFull(latest[1])} (${seasonLabel(latest[0])}); career earnings ${money(sal.careerEarn[id])}.`;
      }
      const desc = `${p.name} career stats, contract & salary — ${posName ? posName + " " : ""}${isRealTeam(c.team) ? "for the " + teamName + ". " : ""}${careerLine} across ${p.log.length} season${p.log.length > 1 ? "s" : ""} (${yrs}).${topAcc ? " " + topAcc + "." : ""}${salLine}`;
      const ld = { "@context": "https://schema.org", "@type": "Person", name: p.name, jobTitle: "Basketball player", url: location.href };
      if (b.ht) ld.height = b.ht;
      if (b.born) ld.birthDate = b.born;
      if (b.college) ld.alumniOf = b.college;
      if (isRealTeam(c.team)) ld.affiliation = { "@type": "SportsTeam", name: teamName, sport: "Basketball" };
      setSEO(`${p.name} Stats, Contract & Career`, desc, ld);
    })();
    drawTrend(p);
    const tabs = $("#statTabs"), body = $("#statBody");
    $$("button", tabs).forEach((b) => b.addEventListener("click", () => {
      $$("button", tabs).forEach((x) => x.setAttribute("aria-selected", "false"));
      b.setAttribute("aria-selected", "true"); body.innerHTML = statTable(b.dataset.v);
    }));
    const pTg = $("#pSalToggle");
    if (pTg) $$("button", pTg).forEach((btn) => btn.addEventListener("click", () => {
      const adj = btn.dataset.adj === "1";
      $$("button", pTg).forEach((x) => x.setAttribute("aria-selected", "false")); btn.setAttribute("aria-selected", "true");
      $$(".pSal").forEach((td) => { td.textContent = moneyFull(Math.round(adj ? inflate(+td.dataset.sal, +td.dataset.season) : +td.dataset.sal)); });
      const tt = $(".pSalTotal");
      if (tt) tt.textContent = moneyFull(Math.round(salRows.filter((r) => r[0] <= META.current).reduce((s, r) => s + (adj ? inflate(r[1], r[0]) : r[1]), 0)));
    }));
    Promise.all([recentGamesCard(id), splitsCard(id)]).then(([games, splits]) => {
      const el = $("#recentForm"); if (!el || (!games && !splits)) return;
      el.innerHTML = `<div class="section-title" style="margin-top:26px"><div><h2>Recent form</h2></div><a class="link" href="#/games/player/${id}">All games →</a></div>
        <div class="two-col">${games || ""}${splits ? `<div class="stack">${splits}</div>` : ""}</div>`;
      wireGameLog(el);
    });
    if (active) fillRanks(p);   // rank pips are current-season only
    twoKCard(id).then((html) => { const el = $("#sec-2k"); if (el && html) el.innerHTML = html; });
    wireJumpNav();
    const INJ_ICON = `<svg class="inj-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M12 8v8M8 12h8"/></svg>`;
    if (SHOW_INJURIES) getInjuries().then((inj) => { const r = inj && inj.byPlayer && inj.byPlayer[id]; const el = $("#playerInjury"); if (el && r) el.innerHTML = `<div class="inj-badge ${r.status === "Out" ? "out" : "dtd"}">${INJ_ICON}<span class="inj-status">${esc(r.status)}${r.injury ? ` · ${esc(r.injury)}` : ""}</span>${r.note ? `<span class="inj-note">${esc(r.note)}</span>` : ""}</div>`; }).catch(() => {});
    playerNews(id).then((html) => { const el = $("#playerNews"); if (el && html) el.innerHTML = html; });
    relatedPlayers(p).then((html) => { const el = $("#relPlayers"); if (el && html) el.innerHTML = html; });
    drawShotProfile(p);
    wireAccHover(app);
  }

  function seasonAccolades(accy, yr) {
    if (!accy) return [];
    const out = [];
    if ((accy.allstar || []).includes(yr)) out.push({ t: "All-Star", g: true });
    const nba = (accy.allnba || []).find((x) => x[0] === yr); if (nba) out.push({ t: `All-NBA${nba[1] ? " (" + nba[1] + ")" : ""}`, g: true });
    const def = (accy.alldef || []).find((x) => x[0] === yr); if (def) out.push({ t: `All-Defense${def[1] ? " (" + def[1] + ")" : ""}`, g: false });
    if ((accy.mvp || []).includes(yr)) out.push({ t: "MVP", g: true });
    if ((accy.dpoy || []).includes(yr)) out.push({ t: "Defensive Player of the Year", g: true });
    if ((accy.roy || []).includes(yr)) out.push({ t: "Rookie of the Year", g: true });
    if ((accy.smoy || []).includes(yr)) out.push({ t: "Sixth Man of the Year", g: true });
    if ((accy.mip || []).includes(yr)) out.push({ t: "Most Improved Player", g: true });
    const rook = (accy.allrookie || []).find((x) => x[0] === yr); if (rook) out.push({ t: `All-Rookie${rook[1] ? " (" + rook[1] + ")" : ""}`, g: false });
    return out;
  }

  async function renderPlayerSeason(pid, y) {
    let p; try { p = await getPlayer(pid); } catch { return notFound("player"); }
    const yr = +y;
    const lr = (p.log || []).find((r) => r[0] === yr && r[16] !== 2);
    if (!lr) return notFound("season");
    const ar = (p.adv || []).find((r) => r[0] === yr && r[15] !== 2);
    const team = lr[2], col = tColor(team), age = lr[3];
    const acc = seasonAccolades(p.accy, yr);
    const tile = (k, v, a) => `<div class="tile ${a ? "accent" : ""}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const tiles = [["PPG", one(lr[13]), 1], ["RPG", one(lr[9])], ["APG", one(lr[10])], ["SPG", one(lr[11])], ["BPG", one(lr[12])],
      ["FG%", pctf(lr[6])], ["3P%", pctf(lr[7])], ["FT%", pctf(lr[8])], ["MPG", one(lr[5])], ["PER", one(lr[14])], ["TS%", pctf(lr[15])]];
    const advTiles = ar ? [["USG%", pctf(ar[6] / 100)], ["BPM", signed(ar[13])], ["OBPM", signed(ar[11])], ["DBPM", signed(ar[12])], ["Win Shares", one(ar[9])], ["WS/48", ws48(ar[10])], ["VORP", signed(ar[14])], ["Games", ar[2]]] : [];
    setSEO(`${p.name} — ${seasonLabel(yr)} Season`, `${p.name}'s ${seasonLabel(yr)} season stats${isRealTeam(team) ? " with the " + tName(team) : ""}: ${one(lr[13])} PPG, ${one(lr[9])} RPG, ${one(lr[10])} APG.${acc.length ? " " + acc.map((a) => a.t).join(", ") + "." : ""}`);
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/player/${p.id}">${esc(p.name)}</a><span class="sep">/</span><span>${seasonLabel(yr)}</span></div>
      <div class="phead"><div class="band" style="background:${col}"></div>
        <div class="inner">${headshot(p.id, p.name, team, "hero")}
          <div class="ph-main">
            <div class="pos">${seasonLabel(yr)}${isRealTeam(team) ? " · " : ""}${isRealTeam(team) ? `<a href="#/team/${team}/${yr}">${esc(tName(team))}</a>` : esc(team)}</div>
            <h1><a href="#/player/${p.id}" style="color:inherit">${esc(p.name)}</a></h1>
            <div class="bio">${bioItem("Games", lr[4])}${age ? bioItem("Age", age) : ""}${bioItem("Minutes", one(lr[5]) + " /g")}</div>
            ${acc.length ? `<div class="chip-row">${acc.map((a) => `<span class="chip ${a.g ? "gold" : ""}">${a.g ? "★ " : ""}${esc(a.t)}</span>`).join("")}</div>` : ""}
          </div></div></div>
      <div class="tilerow">${tiles.map(([k, v, a]) => tile(k, v, a)).join("")}</div>
      ${advTiles.length ? `<div class="section-title" style="margin-top:26px"><h2>Advanced</h2></div>
        <div class="tilerow">${advTiles.map(([k, v]) => tile(k, v)).join("")}</div>` : ""}
      <div id="psGames"></div>
      <div class="actionbar" style="margin-top:22px"><a class="btn" href="#/player/${p.id}"><span class="ic-swap">←</span> Full career</a></div>
    </div>`;
    // Per-season game log, drawn from the player's stored game rows (their most recent
    // ~100 games). Shows for any season those rows cover — not just the current one.
    getPGames(pid).then((all) => {
      if (!all || !all.length) return;
      const rows = all.filter((r) => seasonOf(r.date) === yr);
      if (!rows.length) return;
      const el = $("#psGames");
      el.innerHTML = `<div class="section-title" style="margin-top:26px"><div><h2>${seasonLabel(yr)} game log</h2><span class="hint">${rows.length} game${rows.length === 1 ? "" : "s"}</span></div><a class="link" href="#/games/player/${pid}">All games →</a></div>
          <div class="card"><div class="tbl-wrap"><table class="ref" style="min-width:560px">
            <thead><tr><th class="l grow">Date</th><th class="l">Opp</th><th class="l">Result</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>+/−</th></tr></thead>
            <tbody>${rows.map((r) => `<tr class="clickable" onclick="location.hash='#/game/${r.id}'">
              <td class="l grow season">${fmtDate(r.date, true)}</td><td class="l"><span class="ha">${r.home ? "" : "@"}</span>${teamTag(r.opp)}</td>
              <td class="l"><span class="pill ${r.w ? "w" : "l"}">${r.w ? "W" : "L"}</span> <span class="muted">${r.us}–${r.them}</span></td>
              <td>${r.min ?? "—"}</td><td class="hi">${r.pts ?? "—"}</td><td>${r.reb ?? "—"}</td><td>${r.ast ?? "—"}</td>
              <td class="${r.pm > 0 ? "pos" : r.pm < 0 ? "neg" : ""}">${r.pm == null ? "—" : r.pm > 0 ? "+" + r.pm : r.pm}</td></tr>`).join("")}</tbody></table></div></div>`;
    });
  }
  const bioItem = (k, v) => `<div class="b"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  // accolade -> the specific seasons it was earned (for hover detail on chips)
  function accDetail(title, accy) {
    if (!accy) return "";
    const t = title.toLowerCase();
    const yrs = (arr) => (arr || []).map((y) => seasonLabel(y)).join(" · ");
    const tl = (arr) => (arr || []).map(([y, tm]) => `${seasonLabel(y)}${tm ? " (" + tm + ")" : ""}`).join(" · ");
    if (t.includes("all-star")) return yrs(accy.allstar);
    if (t.includes("all-nba")) return tl(accy.allnba);
    if (t.includes("all-defense")) return tl(accy.alldef);
    if (t.includes("all-rookie")) return tl(accy.allrookie);
    if (t.includes("finals mvp")) return "";           // not in this dataset
    if (t.includes("mvp")) return yrs(accy.mvp);
    if (t.includes("rookie of the year")) return yrs(accy.roy);
    if (t.includes("defensive player")) return yrs(accy.dpoy);
    if (t.includes("sixth man")) return yrs(accy.smoy);
    if (t.includes("most improved")) return yrs(accy.mip);
    return "";
  }
  // Fallback tooltip text so EVERY accolade chip has a tooltip, even without year data.
  function accDesc(title) {
    const t = title.toLowerCase();
    if (t.includes("finals mvp")) return "Most Valuable Player of the NBA Finals.";
    if (t.includes("mvp")) return "Regular-season Most Valuable Player.";
    if (t.includes("all-star")) return "Selected to the NBA All-Star Game.";
    if (t.includes("all-nba")) return "All-NBA Team — the league's best players by position.";
    if (t.includes("all-defensive") || t.includes("all-defense")) return "All-Defensive Team selection.";
    if (t.includes("all-rookie")) return "All-Rookie Team selection.";
    if (t.includes("rookie of the year")) return "Best first-year player.";
    if (t.includes("defensive player")) return "Defensive Player of the Year.";
    if (t.includes("sixth man")) return "Best player primarily off the bench.";
    if (t.includes("most improved")) return "Most Improved Player of the year.";
    if (t.includes("scoring")) return "Led the NBA in points per game.";
    if (t.includes("champion")) return "NBA champion.";
    if (t.includes("hall of fame") || t.includes("hof")) return "Naismith Memorial Basketball Hall of Fame.";
    return "Career honor.";
  }
  function wireAccHover(scope) {
    $$(".chip.has-detail", scope).forEach((c) => {
      const show = (e) => showTT(`<div class="h">${esc(c.dataset.acc)}</div><div class="acc-years">${esc(c.dataset.years)}</div>`, e.clientX, e.clientY);
      c.addEventListener("pointerenter", show);
      c.addEventListener("pointermove", show);
      c.addEventListener("pointerleave", hideTT);
      c.addEventListener("pointercancel", hideTT);
    });
  }

  /* ---------- shot tendencies (distance-zone half-court, sequential by frequency) ---------- */
  const SHOT_ZONES = [   // data label -> court band radius (px, 10px/ft) + short name; ordered rim->out
    { z: "0-3 ft", ri: 0, ro: 34, name: "At the rim", sub: "0–3 ft", lr: 20 },
    { z: "3-10 ft", ri: 34, ro: 100, name: "In the paint", sub: "3–10 ft", lr: 67 },
    { z: "10-16 ft", ri: 100, ro: 160, name: "Mid-range", sub: "10–16 ft", lr: 130 },
    { z: "16 ft-3P", ri: 160, ro: 236, name: "Long two", sub: "16 ft–3P", lr: 198 },
    { z: "3-pointers", ri: 236, ro: 480, name: "Three-pointers", sub: "beyond arc", lr: 300 },
  ];
  // sequential single-hue ramp keyed to a zone's share of shots (frequency = magnitude)
  const shotFill = (pct, maxPct) => `color-mix(in srgb, var(--accent-deep) ${Math.round(20 + (pct / (maxPct || 1)) * 74)}%, var(--accent-wash))`;
  function drawShotChart(mountId, s) {
    const cx = 250, cy = 452, W = 500, H = 500;   // hoop low + tall viewBox so the rim zone never clips
    const rows = SHOT_ZONES.map((zn) => ({ ...zn, d: (s.ranges || []).find((r) => r.z === zn.z) })).filter((r) => r.d);
    if (!rows.length) { $("#" + mountId).innerHTML = ""; return; }
    const maxPct = Math.max(...rows.map((r) => r.d.pct));
    const band = (ri, ro) => ri <= 0
      ? `M ${cx - ro} ${cy} A ${ro} ${ro} 0 0 1 ${cx + ro} ${cy} Z`
      : `M ${cx - ro} ${cy} A ${ro} ${ro} 0 0 1 ${cx + ro} ${cy} L ${cx + ri} ${cy} A ${ri} ${ri} 0 0 0 ${cx - ri} ${cy} Z`;
    let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Shot frequency and field-goal percentage by distance zone" class="shotsvg">
      <defs><clipPath id="ct-${mountId}"><rect x="0" y="0" width="${W}" height="${cy}"/></clipPath></defs>
      <g clip-path="url(#ct-${mountId})">`;
    rows.slice().reverse().forEach((r) => {           // outer first so inner bands paint on top
      g += `<path class="szone" d="${band(r.ri, r.ro)}" fill="${shotFill(r.d.pct, maxPct)}" stroke="var(--panel)" stroke-width="2.5"
        data-name="${esc(r.name)}" data-sub="${esc(r.sub)}" data-pct="${r.d.pct}" data-fg="${r.d.fg == null ? "" : r.d.fg}"/>`;
    });
    g += `</g>`;
    // one recessive court cue only: the 3-point arc + hoop (no busy paint/FT clutter)
    g += `<path d="M ${cx - 236} ${cy} A 236 236 0 0 1 ${cx + 236} ${cy}" fill="none" stroke="var(--ink-4)" stroke-width="1.5" opacity=".5" stroke-dasharray="2 5"/>
      <circle cx="${cx}" cy="${cy}" r="7" fill="none" stroke="var(--panel)" stroke-width="2"/>`;
    // FG% in a high-contrast chip at each zone's centroid (always legible over any fill)
    rows.forEach((r) => {
      const y = cy - r.lr;
      g += `<g pointer-events="none"><rect class="schip" x="${cx - 27}" y="${y - 13}" width="54" height="25" rx="7"/>
        <text class="schip-t" x="${cx}" y="${y + 5}" text-anchor="middle">${r.d.fg == null ? "—" : pctf(r.d.fg)}</text></g>`;
    });
    g += `</svg>`;
    $("#" + mountId).innerHTML = g;
    $$("#" + mountId + " .szone").forEach((z) => {
      const show = (e) => showTT(`<div class="h">${esc(z.dataset.name)}<span style="opacity:.6"> · ${esc(z.dataset.sub)}</span></div>
        <div class="r"><span>Share of shots</span><span>${Math.round(z.dataset.pct * 100)}%</span></div>
        <div class="r"><span>Field-goal %</span><span>${z.dataset.fg ? pctf(+z.dataset.fg) : "—"}</span></div>`, e.clientX, e.clientY);
      z.addEventListener("pointerdown", show); z.addEventListener("pointermove", show);
      z.addEventListener("pointerleave", hideTT); z.addEventListener("pointercancel", hideTT);
    });
  }
  function drawShotProfile(p) {
    const mount = $("#shotProfile"); if (!mount || !p.shot) return;
    const years = Object.keys(p.shot).map(Number).sort((a, b) => b - a);
    const draw = (yr) => {
      const s = p.shot[yr];
      const rows = SHOT_ZONES.map((zn) => ({ ...zn, d: (s.ranges || []).find((r) => r.z === zn.z) })).filter((r) => r.d);
      const maxPct = Math.max(...rows.map((r) => r.d.pct));
      const top = rows.reduce((a, b) => (b.d.pct > a.d.pct ? b : a), rows[0]);
      const extras = [s.avgDist != null ? ["Avg. shot distance", s.avgDist.toFixed(1) + " ft"] : null,
        s.dunk != null ? ["Dunks", Math.round(s.dunk * 100) + "% of FGA"] : null,
        s.corner3 != null ? ["Corner 3s", Math.round(s.corner3 * 100) + "% of 3PA"] : null].filter(Boolean);
      // shot distribution as one 100% stacked bar (part-to-whole), coloured to match the court zones
      const seg = rows.map((r) => `<span class="seg" style="flex-grow:${Math.max(r.d.pct, 0.004)};background:${shotFill(r.d.pct, maxPct)}"
        data-name="${esc(r.name)}" data-sub="${esc(r.sub)}" data-pct="${r.d.pct}" data-fg="${r.d.fg == null ? "" : r.d.fg}"></span>`).join("");
      const key = rows.map((r) => `<div class="kr">
        <span class="sw" style="background:${shotFill(r.d.pct, maxPct)}"></span>
        <span class="knm">${r.name}</span>
        <span class="kmeta"><b>${Math.round(r.d.pct * 100)}%</b><span class="ks">of shots</span><span class="kdot">·</span>${r.d.fg == null ? "—" : pctf(r.d.fg)}<span class="ks">FG</span></span></div>`).join("");
      mount.innerHTML = `<div class="card pad shot-card" style="margin-top:26px">
          <div class="card-h"><h3>Shot tendencies</h3>
            <label class="season-select"><span>Season</span><select class="mini-select" id="shotSeasonSel">${years.map((y) => `<option value="${y}" ${y === yr ? "selected" : ""}>${seasonLabel(y)}</option>`).join("")}</select></label></div>
          <p class="shot-lead"><b>${esc(top.name)}</b> made up ${Math.round(top.d.pct * 100)}% of their attempts — more than any other range. On the court, darker means more frequent; each label is the field-goal % from that range.</p>
          <div class="shot-grid">
            <div class="shot-court-wrap">
              <div class="shot-court" id="shotCourt"></div>
              <div class="shot-legend"><span>Fewer shots</span><i class="ramp"></i><span>More</span></div>
            </div>
            <div class="shot-side">
              <div class="sd-title">Shot distribution</div>
              <div class="sd-stack" role="img" aria-label="Share of shots by distance zone">${seg}</div>
              <div class="sd-key">${key}</div>
              ${extras.length ? `<div class="shot-extras">${extras.map(([k, v]) => `<div class="se"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>` : ""}
            </div>
          </div></div>`;
      drawShotChart("shotCourt", s);
      $$(".sd-stack .seg", mount).forEach((z) => {
        const show = (e) => showTT(`<div class="h">${esc(z.dataset.name)}<span style="opacity:.6"> · ${esc(z.dataset.sub)}</span></div>
          <div class="r"><span>Share of shots</span><span>${Math.round(z.dataset.pct * 100)}%</span></div>
          <div class="r"><span>Field-goal %</span><span>${z.dataset.fg ? pctf(+z.dataset.fg) : "—"}</span></div>`, e.clientX, e.clientY);
        z.addEventListener("pointerdown", show); z.addEventListener("pointermove", show);
        z.addEventListener("pointerleave", hideTT); z.addEventListener("pointercancel", hideTT);
      });
      const sel = $("#shotSeasonSel"); if (sel) sel.addEventListener("change", () => draw(+sel.value));
    };
    draw(years[0]);
  }

  function drawTrend(p) {
    const rows = p.log.filter((r) => r[13] != null && r[16] !== 2); // exclude traded-stint rows
    const vals = rows.map((r) => r[13]), seas = rows.map((r) => r[0]), yrs = rows.map((r) => String(r[0]).slice(2));
    if (vals.length < 2) { $("#trend").innerHTML = `<p class="muted" style="font-size:13px">One season on record.</p>`; return; }
    const W = 340, H = 138, m = { t: 20, r: 14, b: 24, l: 14 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const peak = Math.max(...vals), mn = Math.min(...vals) - 2, mx = peak + 2;
    const sx = (i) => m.l + (i / (vals.length - 1)) * iw, sy = (v) => m.t + ih - (v - mn) / (mx - mn) * ih;
    const P = vals.map((v, i) => [sx(i), sy(v)]);
    const line = P.map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ");
    const area = `M${P[0][0].toFixed(1)} ${m.t + ih} ` + P.map((q) => "L" + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ") + ` L${P[P.length - 1][0].toFixed(1)} ${m.t + ih} Z`;
    const showEvery = Math.ceil(vals.length / 8);
    let g = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scoring trend, hover for detail">
      <line class="cross" id="tCross" x1="0" y1="${m.t}" x2="0" y2="${m.t + ih}" style="opacity:0"/>
      <path class="area" d="${area}"/><path class="ln" d="${line}"/>`;
    P.forEach((pt, i) => {
      const edge = i === 0 || i === vals.length - 1 || vals[i] === peak;
      g += `<circle class="dot" cx="${pt[0].toFixed(1)}" cy="${pt[1].toFixed(1)}" r="${edge ? 4 : 2.5}"/>`;
      if (edge) g += `<text class="val" x="${pt[0].toFixed(1)}" y="${(pt[1] - 9).toFixed(1)}" text-anchor="middle">${vals[i].toFixed(1)}</text>`;
      if (i % showEvery === 0 || i === vals.length - 1) g += `<text class="lbl" x="${pt[0].toFixed(1)}" y="${H - 8}" text-anchor="middle">’${yrs[i]}</text>`;
    });
    // transparent hover targets
    P.forEach((pt, i) => { g += `<circle class="hit" data-i="${i}" cx="${pt[0].toFixed(1)}" cy="${pt[1].toFixed(1)}" r="12" fill="transparent"/>`; });
    $("#trend").innerHTML = g + "</svg>";
    const cross = $("#tCross");
    $$("#trend .hit").forEach((h) => {
      const i = +h.dataset.i, pt = P[i];
      const show = (e) => {
        cross.setAttribute("x1", pt[0]); cross.setAttribute("x2", pt[0]); cross.style.opacity = 1;
        showTT(`<div class="h">${seasonLabel(seas[i])}</div><div class="r"><span>Points</span><span>${vals[i].toFixed(1)} PPG</span></div>`, e.clientX, e.clientY);
      };
      const hide = () => { cross.style.opacity = 0; hideTT(); };
      h.addEventListener("pointerdown", show);   // touch tap / mouse press
      h.addEventListener("pointermove", show);   // mouse hover / touch drag
      h.addEventListener("pointerleave", hide);
      h.addEventListener("pointercancel", hide);
    });
  }

  /* ================= TEAM ================= */
  // Future draft-pick ledger for a franchise (RealGM data) — what firsts and seconds the club
  // controls through 2033, incoming picks, swap rights and protections. Keyed by modern abbr.
  // `note` blocks are RealGM's own phrasing (abbrs already normalised to the site's convention);
  // a "0" count is a pick owed away, shown muted. Returns "" when no ledger exists for the team.
  function draftPicksCard(ab, dp) {
    const team = dp && dp.teams && dp.teams[ab];
    if (!team || !team.rows || !team.rows.length) return "";
    const yr0 = dp.years[0], yr1 = dp.years[dp.years.length - 1];
    // RealGM's "g + c" count (e.g. "1+2") = guaranteed + conditional picks. Rather than
    // print that arithmetic, we spend it as ordering: the first `g` assets in a cell are
    // owned outright (solid mark), the rest are conditional (hollow mark). "0" = the pick
    // is owed away. This turns the count into the visual, so the list itself reads as one.
    const splitN = (n) => { const p = String(n).split("+").map((x) => parseInt(x, 10) || 0); return { g: p[0] || 0, c: p.slice(1).reduce((a, b) => a + b, 0) }; };
    // One asset → collapse wrapped lines, drop the trailing ";", lift the leading identity
    // (Own / a team abbr) out as an emphasised token, and dim the routing + editor clauses.
    const fmtPick = (t) => {
      let s = esc(t.replace(/\s*\n+\s*/g, " ").trim().replace(/;\s*$/, ""));
      s = s.replace(/^(Own)\b/, '<b class="dp-lead">$1</b>')
           .replace(/^([A-Z]{2,3})\b/, '<span class="dp-tm">$1</span>');
      return s.replace(/\((?:via|by swap)[^)]*\)/gi, '<span class="dp-via">$&</span>')
              .replace(/\[[^\]]*\]/g, '<span class="dp-via">$&</span>');
    };
    // One round's assets as a clean marked list (no table cell) + any asterisked caveats.
    const round = (c) => {
      const blocks = (c.note || "").split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
      const picks = blocks.filter((b) => !b.startsWith("*"));       // the assets
      const notes = blocks.filter((b) => b.startsWith("*"));        // asterisked caveats
      const out = c.n === "0", { g } = splitN(c.n);
      let owned = 0;   // only picks the team keeps consume the guaranteed budget, not ones owed away
      const items = picks.length
        ? picks.map((p) => {
            let type;
            if (out || /^To\b/.test(p)) type = "out";
            else { type = owned < g ? "own" : "cond"; owned++; }
            return `<li class="dp-p ${type}">${fmtPick(p)}</li>`;
          }).join("")
        : `<li class="dp-p empty">—</li>`;
      const fn = notes.length ? `<div class="dp-fn">${notes.map((n) => esc(n.replace(/\s*\n+\s*/g, " ").replace(/^\*\s*/, ""))).join("<br>")}</div>` : "";
      return `<ul class="dp-picks">${items}</ul>${fn}`;
    };
    // Each year is its own airy block: a big year marker, then the two rounds side by side
    // (stacked on mobile) — no rigid table, so long protection clauses have room to breathe.
    const years = team.rows.map((r) => `<div class="dp-year">
        <div class="dp-year-h">${r.y}</div>
        <div class="dp-round"><div class="dp-round-lbl">First round</div>${round(r.r1)}</div>
        <div class="dp-round"><div class="dp-round-lbl">Second round</div>${round(r.r2)}</div></div>`).join("");
    const asOf = (() => { try { const [y, mo, d] = dp.asOf.split("-"); return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+mo - 1]} ${+d}, ${y}`; } catch { return dp.asOf; } })();
    return `<div class="section-title" id="sec-picks" style="margin-top:26px"><div><span class="eyebrow">Owned, incoming, swaps &amp; protections · ${yr0}–${yr1}</span><h2>Future draft picks</h2></div>
        <span class="eyebrow">${team.firsts} first${team.firsts === 1 ? "" : "s"} · ${team.seconds} second${team.seconds === 1 ? "" : "s"}</span></div>
      <div class="card dp-card">
        <div class="dp-legend"><span class="dp-p own">Owned</span><span class="dp-p cond">Conditional</span><span class="dp-p out">Traded away</span></div>
        <div class="dp-years">${years}</div>
        <p class="muted dp-src">Source: <a href="${esc(dp.url)}" target="_blank" rel="noopener">${esc(dp.source)}</a> · as of ${asOf}.</p></div>`;
  }

  // Aggregate franchise hub (#/team/OKC, no season) — all-time totals + a clickable table of
  // every season across the franchise's whole lineage, grouped by era name.
  async function renderTeamHub(ab, t) {
    const m = tMeta(ab), color = tColor(ab), conf = m ? m.conf : null;
    const seasons = t.seasons || [];
    const ttRow = await getTeamsTable().then((d) => d.rows.find((r) => r.i === ab)).catch(() => null);
    const dp = await getDraftPicks().catch(() => null);
    const sal = await getSalaries().catch(() => null);
    const pay = mergePayroll(sal, await franchiseAbbrs(ab));   // sum across the whole lineage
    const hasPay = Object.keys(pay).length > 0;
    // all-time aggregates (prefer the franchise table row; fall back to summing seasons)
    const W = ttRow ? ttRow.w : seasons.reduce((a, s) => a + s.w, 0);
    const L = ttRow ? ttRow.l : seasons.reduce((a, s) => a + s.l, 0);
    const titles = ttRow ? ttRow.titles : seasons.filter((s) => s.champ).length;
    const poTrips = ttRow ? ttRow.po : seasons.filter((s) => s.po).length;
    const lastTitle = ttRow ? ttRow.lastTitle : (seasons.filter((s) => s.champ)[0] || {}).season;
    const bestW = ttRow ? ttRow.bestW : Math.max(...seasons.map((s) => s.w));
    const latestSeason = seasons[0] ? seasons[0].season : META.current;
    // distinct eras (oldest→newest) for the "franchise names" line
    const nameSpan = {};
    seasons.forEach((s) => {
      const nm = s.nm || t.name;
      (nameSpan[nm] = nameSpan[nm] || { ys: [], ab: s.ab || ab }).ys.push(s.season);
    });
    const eras = Object.entries(nameSpan)
      .map(([nm, v]) => ({ nm, ab: v.ab, lo: Math.min(...v.ys), hi: Math.max(...v.ys) }))
      .sort((a, b) => a.lo - b.lo);
    // One row per name. Season labels are themselves hyphenated ("1967-68"), so a
    // bare "1967-68–1972-73" reads as one long number — space the range, keep each
    // end unbreakable, and collapse a single-season era to just that season.
    const eraSpan = (e) => e.hi >= META.current ? `${seasonLabel(e.lo)} – present`
      : e.lo === e.hi ? seasonLabel(e.lo)
      : `${seasonLabel(e.lo)} – ${seasonLabel(e.hi)}`;
    // Each era gets the logo the club actually wore then — BBR keeps season-stamped
    // marks for defunct names (PHW-1962, SFW-1971), so pass the era's final season.
    const eraLine = eras.map((e, i) => `<li class="fh-era${i === eras.length - 1 ? " now" : ""}">
        <span class="fh-mark">${teamLogo(e.ab, "md", e.hi, ERA_LOGO[`${e.ab}|${e.nm}`])}</span>
        <span class="fh-txt"><span class="fh-nm">${esc(e.nm)}</span><span class="fh-yr">${eraSpan(e).replace(/(\d{4}-\d{2}|present)/g, "<span class=nb>$1</span>")}</span>
          <span class="fh-len">${e.hi - e.lo + 1} season${e.hi - e.lo ? "s" : ""}</span></span>
      </li>`).join("");
    const tiles = [
      ["Seasons", seasons.length],
      ["NBA titles", titles],
      ["Playoff trips", poTrips],
      ["All-time win %", winpct(W, L)],
      lastTitle ? ["Last title", seasonLabel(lastTitle)] : null,
    ].filter(Boolean);

    setSEO(`${t.name} — Franchise History, All-Time Record & Seasons`,
      `${t.name} all-time: ${W}–${L} over ${seasons.length} seasons, ${titles} NBA title${titles === 1 ? "" : "s"}. Every season from ${seasonLabel(seasons[seasons.length - 1].season)} to today${eras.length > 1 ? ", including " + eras.slice(0, -1).map((e) => e.nm).join(" and ") : ""}.`,
      { "@context": "https://schema.org", "@type": "SportsTeam", name: t.name, sport: "Basketball", url: location.href });

    // franchise history table, grouped by era with clickable season rows
    const NCOL = hasPay ? 8 : 7;
    let body = "";
    let curNm = null;
    seasons.forEach((s) => {
      const nm = s.nm || t.name;
      if (nm !== curNm) {
        curNm = nm;
        const yrs = nameSpan[nm].ys;
        body += `<tr class="fh-era"><td colspan="${NCOL}"><span class="fh-era-nm">${esc(nm)}</span><span class="fh-era-yr">${seasonLabel(Math.min(...yrs))} – ${Math.max(...yrs) >= META.current ? "present" : seasonLabel(Math.max(...yrs))}</span></td></tr>`;
      }
      const result = s.champ ? `<span class="champ-badge" title="NBA champion">Champion</span>` : (s.po ? `<span class="pill w">Playoffs</span>` : `<span class="muted">—</span>`);
      body += `<tr class="clickable" onclick="location.hash='#/team/${ab}/${s.season}'" title="${esc(nm)} ${seasonLabel(s.season)} — full season">
        <td class="l season">${seasonLabel(s.season)}</td><td>${s.w}</td><td>${s.l}</td><td>${winpct(s.w, s.l)}</td>
        <td>${s.o != null ? s.o.toFixed(1) : "—"}</td><td>${s.d != null ? s.d.toFixed(1) : "—"}</td>
        ${hasPay ? `<td>${pay[s.season] ? money(pay[s.season]) : "—"}</td>` : ""}
        <td class="l">${result}</td></tr>`;
    });

    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/teams">Teams</a><span class="sep">/</span><span>${esc(t.name)}</span></div>
      <div class="thead"><div class="band" style="background:${color}"></div>
        <div class="inner">
          <div class="th-id">${teamLogo(ab, "hero")}
            <div><div class="pos">${conf ? conf + "ern Conference" : ""} · NBA franchise</div>
              <h1>${esc(t.name)}</h1>
              <div class="meta">${bioItem("Franchise span", `${seasonLabel(seasons[seasons.length - 1].season)} – ${seasonLabel(latestSeason)}`)}
                ${bioItem("Seasons", seasons.length)}${titles ? bioItem("NBA titles", titles) : ""}${conf ? bioItem("Conference", conf) : ""}</div></div></div>
          <div class="recordbig"><div class="r">${W}–${L}</div><div class="s">all-time · ${winpct(W, L)}</div>
            <a class="btn-mini" href="#/team/${ab}/${latestSeason}">${seasonLabel(latestSeason)} season →</a></div>
        </div>
      </div>
      <nav class="jumpnav" id="jumpNav">${[["History", "sec-history"], (dp && dp.teams && dp.teams[ab] && dp.teams[ab].rows && dp.teams[ab].rows.length ? ["Draft picks", "sec-picks"] : null), ["News", "teamNews"]].filter(Boolean).map(([lab, t]) => `<a href="#" data-tgt="${t}">${lab}</a>`).join("")}</nav>
      ${eras.length > 1 ? `<div class="card pad fh-names"><div class="card-h"><h3>Franchise names</h3><span class="hint">${eras.length} eras</span></div><ul>${eraLine}</ul></div>` : ""}
      <div class="tilerow">${tiles.map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>
      <div class="section-title" id="sec-history" style="margin-top:24px"><div><span class="eyebrow">Every season · click a row to open it</span><h2>Franchise history</h2></div>${bestW >= 0 ? `<span class="eyebrow">Best: ${bestW} wins</span>` : ""}</div>
      <div class="card"><div class="tbl-wrap"><table class="ref" style="min-width:560px">
        <thead><tr><th class="l">Season</th><th>W</th><th>L</th><th>PCT</th><th>ORtg</th><th>DRtg</th>${hasPay ? "<th>Payroll</th>" : ""}<th class="l">Result</th></tr></thead>
        <tbody>${body}</tbody></table></div></div>
      ${draftPicksCard(ab, dp)}
      <div id="teamNews" style="margin-top:24px"></div>
    </div>`;
    wireJumpNav();
    teamNews(ab).then((html) => { const el = $("#teamNews"); if (el && html) el.innerHTML = html; });
  }

  async function renderTeam(ab, y) {
    const fmap = await getFranchiseMap();
    if (fmap[ab]) { location.replace(`#/team/${fmap[ab]}${y ? "/" + y : ""}`); return; }   // e.g. #/team/SEA → #/team/OKC
    let t; try { t = await getTeam(ab); } catch { return notFound("team"); }
    if (!y) return renderTeamHub(ab, t);   // no season → aggregate franchise hub
    const sal = await getSalaries().catch(() => null);
    const abbrs = franchAbbrsFrom(fmap, ab);   // this franchise's era abbrs (SEA + OKC …)
    const pay = mergePayroll(sal, abbrs);
    const hasPay = Object.keys(pay).length > 0;
    const m = tMeta(ab), color = tColor(ab);
    const latest = (y && t.seasons.find((s) => s.season === +y)) || t.seasons[0];   // selected season drives header/contracts
    const seasonAb = (latest && latest.ab) || ab;   // abbr the franchise used that season (SEA for OKC's Seattle years)
    const rosterSeason = t.lastSeason || (t.seasons[0] && t.seasons[0].season);      // the season t.roster (live) reflects
    // Season-accurate roster: the latest season uses the live `roster`; past seasons use the
    // reconstructed per-season roster (rostersBySeason). Fall back to the live roster (clearly
    // labelled "latest on record") only if a season has no reconstructed entry.
    const FH_SHOWN = 12;   // franchise-history rows shown before the "show all" toggle
    const rbsAll = t.rostersBySeason || {};
    const selSeason = latest ? latest.season : rosterSeason;
    const seasonRoster = rbsAll[selSeason];
    const displayRoster = seasonRoster || t.roster || [];
    const rosterExact = !!seasonRoster || selSeason === rosterSeason;
    // `t.roster` is refreshed from the live feed, which switches to the UPCOMING roster as
    // soon as the offseason starts — so it is not "this season's roster" year-round.
    // Keep it, but only ever show it under its own heading (see the next-season card).
    const liveRoster = t.roster || [];
    const seasonIds = new Set(displayRoster.map((r) => r[0]));
    const liveNewcomers = liveRoster.filter((r) => r[0] && !seasonIds.has(r[0]));
    const conf = m ? m.conf : null;
    const teamSel = `<label class="season-select"><span>Season</span><select class="mini-select" id="tmSeasonSel">${t.seasons.map((s) => `<option value="${s.season}" ${s.season === latest.season ? "selected" : ""}>${seasonLabel(s.season)}</option>`).join("")}</select></label>`;
    // The payroll section always reflects the season the page is showing — never a different
    // year. (Previously the offseason view jumped forward to next season's cap when it had more
    // signed deals, which surfaced e.g. a 2026-27 payroll on the 2025-26 team page.)
    const teamAt = (s) => (sal ? (sal.bySeason[s] || []) : []).filter((r) => abbrs.has(r[2]));
    const contractSeason = latest.season;
    const contracts = teamAt(contractSeason);
    const payroll = contracts.reduce((a, r) => a + r[3], 0);
    let seed = null;
    if (latest) { try { const S = await getSeason(latest.season); const cs = splitConf(S.standings); const grp = m && cs[m.conf] ? cs[m.conf] : (cs.League || []); const idx = grp.findIndex((x) => x.abbr === seasonAb); if (idx > -1) seed = idx + 1; } catch {} }
    const net = latest && latest.o != null ? latest.o - latest.d : null;
    // this team's full schedule + results for the selected season (games exist 1947–present)
    let seasonGames = [];
    // standings key off the era abbr (season files), games may use either the era or the modern abbr
    const isUs = (x) => x === seasonAb || x === ab;
    if (latest) { try { const gidx = await getGamesIdx(latest.season); seasonGames = (gidx.games || []).filter((g) => isUs(g.a) || isUs(g.h)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)); } catch {} }
    // Season finished and we're past it — so the live roster is next season's.
    const lastGameDate = seasonGames.length ? seasonGames[seasonGames.length - 1].date : null;
    const seasonOver = lastGameDate ? (Date.now() - new Date(lastGameDate + "T12:00:00Z").getTime()) / 86400000 > 10 : false;
    const showNextRoster = seasonOver && selSeason === rosterSeason && liveNewcomers.length > 0;
    const teamGameRow = (g) => {
      const home = isUs(g.h), opp = home ? g.a : g.h, us = home ? g.hs : g.as, them = home ? g.as : g.hs;
      const played = us != null && them != null, w = played && us > them;
      return `<tr class="clickable" onclick="location.hash='#/game/${g.id}'">
        <td class="l grow season">${fmtDate(g.date)}</td>
        <td class="l"><span class="ha">${home ? "" : "@"}</span>${teamTag(opp)}</td>
        <td class="l">${played ? `<span class="pill ${w ? "w" : "l"}">${w ? "W" : "L"}</span> <span class="muted">${us}–${them}</span>` : `<span class="muted">TBD</span>`}</td>
        <td class="l">${gameTypeBadge(g.type, g.label) || (g.type && g.type !== "Regular Season" ? `<span class="gbadge">${esc(g.type)}</span>` : "")}</td></tr>`;
    };
    const gamesCard = seasonGames.length ? `<div class="section-title" id="sec-games" style="margin-top:26px"><div><span class="eyebrow">${seasonGames.length} games · ${seasonLabel(latest.season)}</span><h2>Season schedule &amp; results</h2></div><a class="link" href="#/games/${latest.season}">League scores →</a></div>
      <div class="card" style="margin-bottom:24px"><div class="tbl-wrap"><table class="ref" style="min-width:520px">
        <thead><tr><th class="l grow">Date</th><th class="l">Opponent</th><th class="l">Result</th><th class="l">Type</th></tr></thead>
        <tbody>${seasonGames.map(teamGameRow).join("")}</tbody></table></div></div>` : "";
    const tiles = latest ? [
      latest.o != null ? ["Offense", latest.o.toFixed(1)] : null,
      latest.d != null ? ["Defense", latest.d.toFixed(1)] : null,
      net != null ? ["Net rating", (net >= 0 ? "+" : "") + net.toFixed(1)] : null,
      latest.srs != null ? ["SRS", (latest.srs >= 0 ? "+" : "") + latest.srs.toFixed(1)] : null,
      ["Win %", winpct(latest.w, latest.l)],
    ].filter(Boolean) : [];

    (function () {
      const rec = latest ? `${seasonLabel(latest.season)} record ${latest.w}–${latest.l} (${winpct(latest.w, latest.l)})${net != null ? ", " + (net >= 0 ? "+" : "") + net.toFixed(1) + " net rating" : ""}.` : "";
      const desc = `${t.name} roster, record, standings and stats. ${rec} ${conf ? conf + "ern Conference. " : ""}Franchise since ${seasonLabel(t.seasons[t.seasons.length - 1].season)} — ${t.seasons.length} seasons on record.`;
      const ld = { "@context": "https://schema.org", "@type": "SportsTeam", name: t.name, sport: "Basketball", url: location.href };
      if (conf) ld.memberOf = { "@type": "SportsOrganization", name: conf + "ern Conference" };
      setSEO(`${t.name} — Roster, Record & Stats`, desc, ld);
    })();
    app.innerHTML = `
    <div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/teams">Teams</a><span class="sep">/</span><a href="#/team/${ab}">${esc(t.name)}</a><span class="sep">/</span><span>${seasonLabel(latest.season)}</span></div>
      <div class="thead"><div class="band" style="background:${color}"></div>
        <div class="inner">
          <div class="th-id">${teamLogo(ab, "hero", latest && latest.season)}
            <div><div class="pos">${(latest && latest.nm && latest.nm !== t.name) ? esc(latest.nm) + " · " : ""}${conf ? conf + "ern Conference" : (latest ? latest.season >= 1971 ? "" : "" : "")}${seed ? " · " + ord(seed) + " seed" : ""}</div>
              <h1>${esc(t.name)}</h1>
              <div class="meta">${bioItem("Franchise span", `${seasonLabel(t.seasons[t.seasons.length - 1].season)} – ${seasonLabel(latest.season)}`)}
                ${bioItem("Seasons", t.seasons.length)}${conf ? bioItem("Conference", conf) : ""}</div></div></div>
          ${latest ? `<div class="recordbig"><div class="r">${latest.w}–${latest.l}</div><div class="s">${seasonLabel(latest.season)} · ${winpct(latest.w, latest.l)}${net != null ? " · " + (net >= 0 ? "+" : "") + net.toFixed(1) + " net" : ""}</div>${teamSel}</div>` : ""}
        </div>
      </div>
      ${tiles.length ? `<div class="tilerow">${tiles.map(([k, v]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>` : ""}
      <nav class="jumpnav" id="jumpNav">${[["Roster", "sec-tables"], (seasonGames.length ? ["Schedule", "sec-games"] : null), (contracts.length ? ["Payroll", "sec-contracts"] : null), ["News", "teamNews"]].filter(Boolean).map(([lab, t]) => `<a href="#" data-tgt="${t}">${lab}</a>`).join("")}</nav>
      <div class="two-col" id="sec-tables">
        <div class="card pad" style="min-width:0">
          <div class="card-h"><h3>${seasonLabel(rosterExact ? selSeason : rosterSeason)} roster${rosterExact && selSeason === rosterSeason ? " leaders" : ""}</h3><span class="hint">${rosterExact ? "per game" : "latest on record · per game"}</span></div>
          ${displayRoster.length ? `<div class="tbl-wrap"><table class="ref">
            <thead><tr><th class="num">#</th><th class="l">Player</th><th>PTS</th><th>REB</th><th>AST</th><th>GP</th><th class="l">Pos</th></tr></thead>
            <tbody>${displayRoster.map((r) => `<tr><td class="num muted">${r[7] != null && r[7] !== "" ? esc(r[7]) : ""}</td><td class="l"><span class="who">${headshot(r[0], r[1], ab, "xs")}<a href="#/player/${r[0]}">${esc(r[1])}</a></span></td>
              <td class="hi">${one(r[4])}</td><td>${one(r[5])}</td><td>${one(r[6])}</td><td>${r[3]}</td><td class="l muted">${esc((r[2] || "").split("-")[0])}</td></tr>`).join("")}</tbody>
          </table></div>` : `<p class="muted" style="font-size:14px">No roster on record.</p>`}
          ${showNextRoster ? `<div class="next-roster">
            <div class="nr-h"><span class="eyebrow">${seasonLabel(selSeason + 1)} roster · as signed</span><span class="hint">${liveNewcomers.length} new</span></div>
            <p class="muted nr-note">Offseason moves for next season. Per-game numbers below are each player's ${seasonLabel(selSeason)} production, with their previous team.</p>
            <ul class="nr-list">${liveNewcomers.map((r) => `<li><span class="who">${headshot(r[0], r[1], ab, "xs")}<a href="#/player/${r[0]}">${esc(r[1])}</a></span><span class="nr-s">${one(r[4])} pts</span></li>`).join("")}</ul>
          </div>` : ""}
        </div>
        <div class="card pad fh-collapsed" id="fhCard" style="min-width:0">
          <div class="card-h"><h3>Franchise history</h3><span class="hint">by season${hasPay ? " · payroll" : ""}</span></div>
          <div class="tbl-wrap"><table class="ref" style="min-width:0">
            <thead><tr><th class="l">Season</th><th>W</th><th>L</th><th>PCT</th><th>ORtg</th><th>DRtg</th>${hasPay ? "<th>Payroll</th>" : ""}<th></th></tr></thead>
            <tbody>${t.seasons.map((s, i) => `<tr class="fh-row${i >= FH_SHOWN ? " fh-x" : ""}" onclick="location.hash='#/team/${ab}/${s.season}'" style="cursor:pointer" title="${esc(tName(ab))} ${seasonLabel(s.season)} — schedule & results">
              <td class="l season">${seasonLabel(s.season)}</td><td>${s.w}</td><td>${s.l}</td><td>${winpct(s.w, s.l)}</td>
              <td>${s.o != null ? s.o.toFixed(1) : "—"}</td><td>${s.d != null ? s.d.toFixed(1) : "—"}</td>
              ${hasPay ? `<td>${pay[s.season] ? money(pay[s.season]) : "—"}</td>` : ""}
              <td class="l">${s.po ? '<span class="pill w">Playoffs</span>' : ""}</td></tr>`).join("")}</tbody></table></div>
          ${t.seasons.length > FH_SHOWN ? `<button type="button" class="fh-toggle" id="fhToggle">Show all ${t.seasons.length} seasons</button>` : ""}
        </div>
      </div>
      ${gamesCard}
      ${contracts.length ? `<div class="section-title" id="sec-contracts" style="margin-top:26px"><div><span class="eyebrow">Nominal · ${contracts.length} on the books · ${money(payroll)} total</span><h2>${seasonLabel(contractSeason)} payroll</h2></div><a class="link" href="#/salaries/${contractSeason}">Salary hub →</a></div>
        <div class="card" style="margin-bottom:24px"><div class="tbl-wrap"><table class="ref" style="min-width:420px">
          <thead><tr><th class="num">#</th><th class="l grow">Player</th><th>Salary</th><th>% of payroll</th></tr></thead>
          <tbody>${contracts.map((r, i) => `<tr class="${r[0] ? "clickable" : ""}" ${r[0] ? `onclick="location.hash='#/player/${r[0]}'"` : ""}>
            <td class="num">${i + 1}</td>
            <td class="l grow"><span class="who">${headshot(r[0], r[1], ab, "xs")}${r[0] ? `<a href="#/player/${r[0]}">${esc(r[1])}</a>` : `<span class="nm">${esc(r[1])}</span>`}</span></td>
            <td class="hi">${moneyFull(r[3])}</td><td><span class="barpct"><i style="width:${(r[3] / (contracts[0][3] || 1)) * 100}%"></i></span>${(r[3] / payroll * 100).toFixed(1)}%</td></tr>`).join("")}
            <tr class="total"><td></td><td class="l grow">Total payroll</td><td class="hi">${moneyFull(payroll)}</td><td>100%</td></tr></tbody></table></div></div>` : ""}
      <div id="teamNews"></div>
    </div>`;
    const ts = $("#tmSeasonSel"); if (ts) ts.addEventListener("change", () => (location.hash = `#/team/${ab}/${ts.value}`));
    const fhToggle = $("#fhToggle"); if (fhToggle) fhToggle.addEventListener("click", () => {
      const collapsed = $("#fhCard").classList.toggle("fh-collapsed");
      fhToggle.textContent = collapsed ? `Show all ${t.seasons.length} seasons` : "Show fewer";
    });
    wireJumpNav();
    teamNews(ab).then((html) => { const el = $("#teamNews"); if (el && html) el.innerHTML = html; });
  }

  /* ================= SALARIES / CONTRACTS ================= */
  async function renderSalaries(y) {
    let sal; try { sal = await getSalaries(); } catch { return notFound("salary data"); }
    CPI = CPI || await getCPI().catch(() => null);
    // default to the most recent season with a full league book: the upcoming season
    // once the current one is over (offseason), otherwise the current season — never the
    // sparse far-future years that only exist because a few stars are signed that long.
    const [lo, hi] = sal.range;
    const _def = ((sal.bySeason[META.current + 1] || []).length > (sal.bySeason[META.current] || []).length) ? META.current + 1 : META.current;
    const yr = Math.min(hi, Math.max(lo, +y || _def));
    const sel = `<label class="season-select"><span>Season</span><select id="salSel">${Array.from({ length: hi - lo + 1 }, (_, i) => hi - i).map((v) => `<option value="${v}" ${v === yr ? "selected" : ""}>${seasonLabel(v)}</option>`).join("")}</select></label>`;
    const paid = sal.bySeason[yr] || [];               // [pid, name, abbr, salary]
    const payr = sal.payrollRank[yr] || [];            // [abbr, total]
    const pmax = paid.length ? paid[0][3] : 1, tmax = payr.length ? payr[0][1] : 1;
    const nameCell = (pid, nm, ab) => `${headshot(pid, nm, ab, "xs")}${pid ? `<a class="nm" href="#/player/${pid}">${esc(nm)}</a>` : `<span class="nm">${esc(nm)}</span>`} ${ab ? teamTag(ab) : ""}`;
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>Salaries</span></div>
      <div class="section-title"><div><span class="eyebrow">Nominal salaries · ${seasonLabel(lo)} to ${seasonLabel(hi)}</span><h2>Contracts &amp; salaries</h2></div>${sel}</div>
      <div class="col2grid">
        <div class="card pad"><div class="card-h"><h3>Highest-paid · ${seasonLabel(yr)}</h3><span class="hint">cap hit</span></div>
          <ol class="rank">${paid.slice(0, 12).map((r, i) => `<li class="${i === 0 ? "top" : ""}"><span class="rk">${i + 1}</span>
            <span class="who">${nameCell(r[0], r[1], r[2])}</span>
            <span class="val"><span class="mini"><i style="width:${(r[3] / pmax) * 100}%"></i></span>${money(r[3])}</span></li>`).join("")}</ol></div>
        <div class="card pad"><div class="card-h"><h3>Team payroll · ${seasonLabel(yr)}</h3><span class="hint">total</span></div>
          <ol class="rank">${payr.map((r, i) => `<li class="${i === 0 ? "top" : ""}"><span class="rk">${i + 1}</span>
            <span class="who">${teamLogo(r[0], "xs")}<a class="nm" href="#/team/${r[0]}">${esc(tName(r[0]))}</a></span>
            <span class="val"><span class="mini"><i style="width:${(r[1] / tmax) * 100}%"></i></span>${money(r[1])}</span></li>`).join("")}</ol></div>
      </div>
      <div class="section-title" style="margin-top:26px"><div><span class="eyebrow">${paid.length} player${paid.length === 1 ? "" : "s"} under contract · ${seasonLabel(yr)}</span><h2>All salaries · ${seasonLabel(yr)}</h2></div></div>
      <div class="pt-page" id="allSalHost"></div>
      <div class="section-title" style="margin-top:26px"><div><span class="eyebrow" id="allTimeEyebrow"></span><h2>Highest single-season salaries, all-time</h2></div>
        ${CPI ? `<div class="tabs" id="inflToggle"><button data-adj="0" aria-selected="true">Nominal</button><button data-adj="1" aria-selected="false">${seasonLabel(CPI.base)} dollars</button></div>` : ""}</div>
      <div class="card" id="allTimeCard"></div>
      <p class="news-foot" style="margin-top:14px" id="allTimeFoot"></p>
    </div>`;
    const s = $("#salSel"); if (s) s.addEventListener("change", () => (location.hash = `#/salaries/${s.value}`));
    // full, filterable salary book for the season
    ptMount($("#allSalHost"), SALARIES_CFG, paid.map((r) => ({ pid: r[0], name: r[1], t: r[2], sal: r[3] })));
    const drawAllTime = (adj) => {
      const list = adj ? sal.topAllTimeReal : sal.topAllTime;
      $("#allTimeEyebrow").textContent = adj ? `Restated in ${CPI.base}-season dollars` : "Nominal · not inflation-adjusted";
      $("#allTimeCard").innerHTML = `<div class="tbl-wrap"><table class="ref" style="min-width:520px">
        <thead><tr><th class="num">#</th><th class="l grow">Player</th><th class="l">Season</th><th class="l">Team</th><th>${adj ? "Adj. salary" : "Salary"}</th></tr></thead>
        <tbody>${list.slice(0, 30).map((r, i) => `<tr class="${r[0] ? "clickable" : ""}" ${r[0] ? `onclick="location.hash='#/player/${r[0]}'"` : ""}>
          <td class="num">${i + 1}</td>
          <td class="l grow"><span class="who">${headshot(r[0], r[1], r[2], "xs")}${r[0] ? `<a href="#/player/${r[0]}">${esc(r[1])}</a>` : `<span class="nm">${esc(r[1])}</span>`}</span></td>
          <td class="l season">${seasonLabel(r[3])}</td><td class="l">${r[2] ? teamTag(r[2], true) : "—"}</td>
          <td class="hi">${moneyFull(r[4])}</td></tr>`).join("")}</tbody></table></div>`;
      $("#allTimeFoot").innerHTML = adj
        ? `Restated in ${seasonLabel(CPI.base)} dollars via US CPI-U (recent-season CPI estimated). This surfaces past megadeals — e.g. the 2020-21 supermaxes — that nominal figures bury.`
        : `Salary data covers ${seasonLabel(lo)}–${hi} in nominal dollars. Because figures aren't inflation-adjusted, recent seasons dominate — toggle <b>${CPI ? CPI.base + " dollars" : "adjusted"}</b> to compare fairly across eras.`;
    };
    drawAllTime(0);
    const tg = $("#inflToggle");
    if (tg) $$("button", tg).forEach((btn) => btn.addEventListener("click", () => {
      $$("button", tg).forEach((x) => x.setAttribute("aria-selected", "false")); btn.setAttribute("aria-selected", "true");
      drawAllTime(btn.dataset.adj === "1");
    }));
  }

  /* ================= LEADERS ================= */
  const leadModeTabs = (mode, yr) => `<div class="tabs seg-lg" id="leadMode">
    <button ${mode === "season" ? 'aria-selected="true"' : ""} onclick="location.hash='#/leaders/${yr || META.current}'">Single season</button>
    <button ${mode === "all" ? 'aria-selected="true"' : ""} onclick="location.hash='#/leaders/all'">All-time</button></div>`;

  async function renderLeaders(y) {
    if (y === "all") return renderAlltime();
    const yr = +y || META.current, S = await getSeason(yr);
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>League leaders</span></div>
      <div class="section-title"><div><span class="eyebrow">Per game · qualified players</span><h2>${seasonLabel(yr)} league leaders</h2></div>
        <div class="lead-controls">${leadModeTabs("season", yr)}${seasonSelect(yr, "leaders")}</div></div>
      <div class="cardgrid">${LEAD_CATS.map((c) => leaderCard(S, c[0])).join("")}</div>
    </div>`;
    wireSeasonSelect();
  }

  async function renderAlltime() {
    const A = await getAlltime();
    const CAREER = [["pts", "Points", intc], ["trb", "Rebounds", intc], ["ast", "Assists", intc], ["stl", "Steals", intc], ["blk", "Blocks", intc], ["x3p", "Three-pointers", intc], ["g", "Games played", intc], ["tov", "Turnovers", intc]];
    const SEASONREC = [["pts", "Points per game", one], ["trb", "Rebounds per game", one], ["ast", "Assists per game", one], ["stl", "Steals per game", one], ["blk", "Blocks per game", one]];
    const careerCard = ([k, label, fmt]) => `<div class="card pad"><div class="card-h"><h3>${label}</h3><span class="hint">career</span></div>
      <ol class="rank">${A.career[k].slice(0, 12).map((r, i) => `<li class="${i === 0 ? "top" : ""}">
        <span class="rk">${i + 1}</span><span class="who">${headshot(r[0], r[1], r[2], "xs")}<a class="nm" href="#/player/${r[0]}">${esc(r[1])}</a>
        <span class="yr-span">${String(r[4]).slice(2)}–${String(r[5]).slice(2)}</span></span><span class="val">${fmt(r[3])}</span></li>`).join("")}</ol></div>`;
    const seasonCard = ([k, label, fmt]) => `<div class="card pad"><div class="card-h"><h3>${label}</h3><span class="hint">single season</span></div>
      <ol class="rank">${A.season[k].slice(0, 12).map((r, i) => `<li class="${i === 0 ? "top" : ""}">
        <span class="rk">${i + 1}</span><span class="who">${headshot(r[0], r[1], r[2], "xs")}<a class="nm" href="#/player/${r[0]}">${esc(r[1])}</a>
        <span class="yr-span">${seasonLabel(r[3])}</span></span><span class="val">${fmt(r[4])}</span></li>`).join("")}</ol></div>`;
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>All-time leaders</span></div>
      <div class="section-title"><div><span class="eyebrow">Every player, 1947–${seasonLabel(META.current).slice(0, 4) * 1 + 1}</span><h2>All-time leaders</h2></div>
        <div class="lead-controls">${leadModeTabs("all")}</div></div>
      <h3 class="conf-h">Career totals</h3>
      <div class="cardgrid">${CAREER.map(careerCard).join("")}</div>
      <h3 class="conf-h" style="margin-top:30px">Single-season records</h3>
      <div class="cardgrid">${SEASONREC.map(seasonCard).join("")}</div>
    </div>`;
  }

  /* ================= STANDINGS ================= */
  async function renderStandings(y) {
    const yr = +y || META.current, S = await getSeason(yr);
    const conf = splitConf(S.standings), keys = Object.keys(conf);
    const block = (title, rows) => {
      const lead = rows[0];
      return `<div class="card pad" style="min-width:0"><div class="card-h"><h3>${title}</h3><span class="hint">${seasonLabel(yr)}</span></div>
        <div class="tbl-wrap"><table class="ref" style="min-width:560px">
          <thead><tr><th></th><th class="l">Team</th><th>W</th><th>L</th><th>PCT</th><th>GB</th><th>ORtg</th><th>DRtg</th><th>NET</th></tr></thead>
          <tbody>${rows.map((t, i) => {
            const gb = ((lead.w - t.w) + (t.l - lead.l)) / 2, net = t.o != null ? t.o - t.d : null;
            return `<tr onclick="location.hash='#/team/${t.abbr}'" style="cursor:pointer">
              <td class="muted">${i + 1}${i === 5 && keys.length > 1 ? '<span style="color:var(--line-strong)"> ┈</span>' : ""}</td>
              <td class="l"><span class="tm-tag">${teamLogo(t.abbr, "xs")}${esc(tName(t.abbr))}</span>${t.po ? "" : ""}</td>
              <td>${t.w}</td><td>${t.l}</td><td>${winpct(t.w, t.l)}</td><td>${gb === 0 ? "—" : gb.toFixed(1)}</td>
              <td>${t.o != null ? t.o.toFixed(1) : "—"}</td><td>${t.d != null ? t.d.toFixed(1) : "—"}</td>
              <td class="${net != null && net >= 0 ? "hi" : ""}">${net != null ? (net >= 0 ? "+" : "") + net.toFixed(1) : "—"}</td></tr>`;
          }).join("")}</tbody></table></div>
        ${keys.length > 1 ? `<p class="muted mono" style="font-size:11.5px;margin:12px 2px 0">Top 6 clinch a playoff berth · seeds 7–10 enter the play-in.</p>` : ""}</div>`;
    };
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>Standings</span></div>
      <div class="section-title"><div><span class="eyebrow">${S.lg} · final</span><h2>${seasonLabel(yr)} standings</h2></div>${seasonSelect(yr, "standings")}</div>
      <div class="col2grid">${keys.map((k) => block(k === "League" ? "League" : k + "ern Conference", conf[k])).join("")}</div>
    </div>`;
    wireSeasonSelect();
  }

  /* ================= SEASON OVERVIEW ================= */
  async function renderSeason(y) {
    const yr = +y; let S; try { S = await getSeason(yr); } catch { return notFound("season"); }
    const hist = (META.history || []).find((h) => h.season === yr) || {};
    const champAb = (S.champion && S.champion.team) || hist.champ, st = S.standings, top = st[0];
    const champNm = (S.champion && S.champion.team) ? tName(S.champion.team) : (hist.champ_name || (hist.champ && tName(hist.champ)) || "");
    const champFmvp = (S.champion && S.champion.fmvp) || hist.fmvp, champFmvpId = (S.champion && S.champion.fmvp_id) || hist.fmvp_id;
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><a href="#/seasons">Seasons</a><span class="sep">/</span><span>${seasonLabel(yr)}</span></div>
      <div class="section-title"><div><span class="eyebrow">${S.lg} Season</span><h2>${seasonLabel(yr)} season</h2></div>${seasonSelect(yr, "season")}</div>
      <div class="season-top">
        ${(champAb || champNm) ? `<div class="card big season-champ" style="--tc:${champAb ? tColor(champAb) : "var(--accent)"}">
          <span class="eyebrow">Champions</span>
          <div class="sc-team">${champAb ? teamLogo(champAb, "hero") : ""}<div><h3>${champAb ? `<a href="#/team/${champAb}">${esc(champNm)}</a>` : esc(champNm)}</h3>
            ${champFmvp ? `<div class="sub">Finals MVP · <a href="#/player/${champFmvpId}">${esc(champFmvp)}</a></div>` : ""}</div></div></div>` : ""}
        ${S.mvp ? `<div class="card big pad season-mvp"><span class="eyebrow">Most Valuable Player</span>
          <a class="sm-link" href="#/player/${S.mvp.id}">${headshot(S.mvp.id, S.mvp.name, champAb || (top && top.abbr), "lg")}<div><div class="n">${esc(S.mvp.name)}</div></div></a></div>` : ""}
        ${top ? `<div class="card big pad season-best"><span class="eyebrow">Best record</span>
          <div class="sb"><div class="rr">${top.w}–${top.l}</div><div>${teamTag(top.abbr, true)}<div class="muted" style="font-size:12px;margin-top:2px">${winpct(top.w, top.l)}</div></div></div></div>` : ""}
      </div>
      <div class="section-title" style="margin-top:26px"><h2>Postseason</h2><a class="link" href="#/bracket/${yr}">Playoff bracket →</a></div>
      <div class="section-title" style="margin-top:26px"><h2>Leaders</h2><a class="link" href="#/leaders/${yr}">All categories →</a></div>
      <div class="cardgrid">${["pts", "trb", "ast", "per"].map((c) => leaderCard(S, c)).join("")}</div>
      ${honorsBlock(S.honors)}
      <div class="section-title" style="margin-top:26px"><h2>Standings</h2><a class="link" href="#/standings/${yr}">Full table →</a></div>
      <div class="card big pad scatter-card"><div class="chart-hint"><span class="dotpulse"></span>Hover a team · click to open</div><figure id="scatterSeason" style="margin:0"></figure></div>
      ${META.draftYears.includes(yr - 1) ? `<div class="section-title" style="margin-top:26px"><h2>Draft class</h2><a class="link" href="#/draft/${yr - 1}">${yr - 1} draft →</a></div>
        <p class="muted" style="font-size:14px">See who entered the league in the <a href="#/draft/${yr - 1}" style="color:var(--accent-deep)">${yr - 1} NBA Draft</a>.</p>` : ""}
    </div>`;
    drawScatter("scatterSeason", st);
    wireSeasonSelect();
  }

  function playerChip(id, name, team) {
    return `<a href="#/player/${id}" class="p-chip">${headshot(id, name, team, "xs")}${esc(name)}</a>`;
  }
  function honorsBlock(h) {
    if (!h) return "";
    const nba = h.allNBA || {}, hasTeams = nba["1st"];
    const teamRow = (label, ids) => ids ? `<div class="honor-row"><span class="honor-lbl">${label}</span><div class="chip-row">${ids.map((x) => playerChip(x[0], x[1], (SMAP[x[0]] || [])[5])).join("")}</div></div>` : "";
    const votingHtml = (h.mvpVote && h.mvpVote.length) ? `<div class="card pad"><div class="card-h"><h3>MVP voting</h3><span class="hint">top ${h.mvpVote.length}</span></div>
      <ol class="rank">${h.mvpVote.map((v, i) => `<li class="${i === 0 ? "top" : ""}"><span class="rk">${i + 1}</span>
        <span class="who">${headshot(v[0], v[1], (SMAP[v[0]] || [])[5], "xs")}<a class="nm" href="#/player/${v[0]}">${esc(v[1])}</a></span>
        <span class="val">${v[2] != null ? (v[2] * 100).toFixed(0) + "%" : ""}</span></li>`).join("")}</ol></div>` : "";
    const teamsHtml = hasTeams ? `<div class="card pad"><div class="card-h"><h3>All-NBA teams</h3></div>
      ${["1st", "2nd", "3rd"].map((t) => teamRow(t + " Team", nba[t])).join("")}
      ${h.allDef && h.allDef["1st"] ? `<div class="card-h" style="margin:16px 0 4px"><h3 style="font-size:15px">All-Defense</h3></div>${["1st", "2nd"].map((t) => teamRow(t, h.allDef[t])).join("")}` : ""}</div>` : "";
    const starHtml = (h.allStar && h.allStar.length) ? `<div class="card pad" style="grid-column:1/-1"><div class="card-h"><h3>All-Stars</h3><span class="hint">${h.allStar.length} selected</span></div>
      <div class="chip-row">${h.allStar.map((x) => playerChip(x[0], x[1], (SMAP[x[0]] || [])[5])).join("")}</div></div>` : "";
    if (!teamsHtml && !votingHtml && !starHtml) return "";
    return `<div class="section-title" style="margin-top:26px"><h2>Honors</h2></div>
      <div class="honors-grid">${teamsHtml}${votingHtml}${starHtml}</div>`;
  }

  /* ================= SEASONS INDEX ================= */
  function renderSeasons() {
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>Seasons</span></div>
      <div class="section-title"><div><span class="eyebrow">${META.history.length} seasons · 1947–${META.current}</span><h2>Every NBA season</h2></div></div>
      <div class="card"><div class="tbl-wrap"><table class="ref" style="min-width:920px">
        <thead><tr><th class="l">Season</th><th class="l">Champion</th><th class="l">Finals MVP</th><th class="l">MVP</th><th class="l">Rookie of Year</th><th class="l">Defensive POY</th><th class="l">Scoring</th></tr></thead>
        <tbody>${META.history.map((h) => { const pl = (id, nm) => (nm ? `<a href="#/player/${id}">${esc(nm)}</a>` : "—"); return `<tr onclick="location.hash='#/season/${h.season}'" style="cursor:pointer">
          <td class="l season">${seasonLabel(h.season)}</td>
          <td class="l">${(h.champ || h.champ_name) ? `<span class="tm-tag">${h.champ ? teamLogo(h.champ, "xs") : ""}${esc(h.champ_name || tName(h.champ))}</span>` : "—"}</td>
          <td class="l">${pl(h.fmvp_id, h.fmvp)}</td>
          <td class="l">${pl(h.mvp_id, h.mvp)}</td>
          <td class="l">${pl(h.roy_id, h.roy)}</td>
          <td class="l">${pl(h.dpoy_id, h.dpoy)}</td>
          <td class="l muted">${h.pts_leader ? esc(h.pts_leader) : "—"}</td></tr>`; }).join("")}</tbody>
      </table></div></div>
    </div>`;
  }

  /* ================= TEAMS INDEX ================= */
  /* ================= PLAYERS INDEX ================= */
  /* ---- Generic Linear-style filterable data table (used by Players, Scores, …) ----
     A page calls ptMount(host, cfg, rows). cfg.cols is the schema (type ∈
     text|enum|bool|num|pct|money|date); each column may supply cell(r), getv(r),
     opts(), match(r,filter) and fmtVal(v). Columns with col:true render; every column
     with filt!==false is offered in the filter menu. */
  let PT = { cfg: null, data: [], q: "", filters: [], sort: null, shown: 80, io: null, basePath: "", visCols: [] };
  let PT_URLSTATE = null;   // pending {q,f,s,c} parsed from a shared ?v= URL, applied on next ptMount
  function ptSyncUrl() {
    const s = PT.sort, d = PT.cfg.defaultSort, def = ptDefaultCols(PT.cfg);
    const colsCustom = PT.visCols.length !== def.length || PT.visCols.some((k, i) => k !== def[i]);
    // a view is "shareable" when the query/filters/sort differ from default. Column choice is a
    // persistent personal preference (localStorage), so it shouldn't make every page look active —
    // but if the view IS shareable, carry the columns along too.
    const active = PT.q || PT.filters.length || (s && (s.k !== d.k || s.dir !== d.dir));
    const base = "#/" + PT.basePath;
    if (!active) { if (location.hash !== base) history.replaceState(null, "", base); return; }
    const payload = { q: PT.q || undefined, f: PT.filters.length ? PT.filters : undefined, j: PT.join === "or" ? "or" : undefined, s: PT.sort, c: colsCustom ? PT.visCols : undefined };
    history.replaceState(null, "", base + "?v=" + encodeURIComponent(JSON.stringify(payload)));
  }
  const ptCol = (k) => PT.cfg.cols.find((c) => c.k === k);
  const ptGet = (c, r) => (c.getv ? c.getv(r) : r[c.k]);
  // every school a player attended, earliest first (single-school players have no .cols)
  const ptColleges = (r) => r.cols || (r.col ? [r.col] : []);

  function ptCell(c, r) {
    if (c.cell) return c.cell(r);
    const v = ptGet(c, r);
    if (c.type === "pct") return pctf(v);
    if (c.type === "money") return v ? "$" + (v / 1e6).toFixed(1) + "M" : "—";
    if (c.type === "date") return v ? fmtDate(v) : "—";
    if (c.type === "num") return v != null ? (Number.isInteger(v) ? v : one(v)) : "—";
    if (c.type === "bool") return c.boolLabels ? esc(v ? c.boolLabels[0] : c.boolLabels[1]) : (v ? "Yes" : "No");
    return v == null || v === "" ? "—" : esc("" + v);
  }
  function ptOptions(c) {
    if (c.opts) return c.opts();
    const set = new Set();
    for (const r of PT.data) { const v = ptGet(c, r); if (v != null && v !== "") set.add(v); }
    return [...set].sort((a, b) => ("" + a).localeCompare("" + b, undefined, { numeric: true }));
  }
  const OPLABEL = { gte: "≥", lte: "≤", eq: "=", between: "between" };
  function ptFmtVal(c, v) {
    if (c.fmtVal) return c.fmtVal(v);
    if (c.type === "pct") return Math.round(v * 100) + "%";
    if (c.type === "money") return "$" + (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + "M";
    return v;
  }
  function ptPillText(f) {
    const c = ptCol(f.k);
    if (c.type === "enum") { const shown = f.vals.slice(0, 2).map((v) => ptFmtVal(c, v)).join(", "); return `${c.label} is ${shown}${f.vals.length > 2 ? " +" + (f.vals.length - 2) : ""}`; }
    if (c.type === "bool") return `${c.label}: ${c.boolLabels[f.vals[0] ? 0 : 1]}`;
    if (c.type === "date") return `${c.label} ${f.vals[0] === "0000-01-01" ? "any" : fmtDate(f.vals[0])} – ${f.vals[1] === "9999-12-31" ? "any" : fmtDate(f.vals[1])}`;
    if (f.op === "between") return `${c.label} ${ptFmtVal(c, f.vals[0])}–${ptFmtVal(c, f.vals[1])}`;
    return `${c.label} ${OPLABEL[f.op]} ${ptFmtVal(c, f.vals[0])}`;
  }
  // does a single filter match a row? (the per-condition test, combinator-agnostic)
  function ptFilterMatch(r, f) {
    const c = ptCol(f.k);
    if (!c) return true;                       // unknown key (e.g. stale shared URL) — ignore
    if (c.match) return c.match(r, f);
    const v = ptGet(c, r);
    if (c.type === "enum") return f.vals.includes(v);
    if (c.type === "bool") return (v ? 1 : 0) === f.vals[0];
    if (c.type === "date") return !!v && v >= f.vals[0] && v <= f.vals[1];
    if (v == null) return false;
    if (f.op === "gte") return v >= f.vals[0];
    if (f.op === "lte") return v <= f.vals[0];
    if (f.op === "eq") return v === f.vals[0];
    if (f.op === "between") return v >= f.vals[0] && v <= f.vals[1];
    return true;
  }
  function ptMatch(r) {
    // text search is always a separate AND gate (Linear keeps search out of the filter group)
    if (PT.q && !PT.cfg.search(r, PT.q.toLowerCase())) return false;
    if (!PT.filters.length) return true;
    // the group's combinator: "or" → any condition matches, else "and" → every one must
    return PT.join === "or" ? PT.filters.some((f) => ptFilterMatch(r, f)) : PT.filters.every((f) => ptFilterMatch(r, f));
  }
  function ptResults() {
    const rows = PT.data.filter(ptMatch);
    const c = ptCol(PT.sort.k), dir = PT.sort.dir, tb = PT.cfg.tiebreak;
    rows.sort((a, b) => {
      let x = ptGet(c, a), y = ptGet(c, b);
      if (c.type === "text" || c.type === "date") return dir * ("" + (x == null ? "" : x)).localeCompare("" + (y == null ? "" : y), undefined, { numeric: true });
      x = x == null ? -Infinity : x; y = y == null ? -Infinity : y;
      return x < y ? -dir : x > y ? dir : ("" + (a[tb] == null ? "" : a[tb])).localeCompare("" + (b[tb] == null ? "" : b[tb]));
    });
    return rows;
  }
  // which columns can be shown/hidden (everything that renders a value — i.e. not purely
  // decorative). visible set defaults to cfg `col:true`, overridable per-table + per-URL.
  const ptDefaultCols = (cfg) => cfg.cols.filter((c) => c.col).map((c) => c.k);
  const ptColStoreKey = (cfg) => `hw-ptcols-${cfg.key || cfg.noun}`;
  function ptLoadCols(cfg) {
    try { const s = JSON.parse(localStorage.getItem(ptColStoreKey(cfg))); if (Array.isArray(s) && s.length) return s; } catch (e) {}
    return null;
  }
  const ptSaveCols = (cfg, keys) => { try { const def = ptDefaultCols(cfg); if (keys.length === def.length && keys.every((k, i) => k === def[i])) localStorage.removeItem(ptColStoreKey(cfg)); else localStorage.setItem(ptColStoreKey(cfg), JSON.stringify(keys)); } catch (e) {} };
  // shown columns in cfg order, filtered to the current visible set
  const ptShownCols = () => PT.cfg.cols.filter((c) => PT.visCols.includes(c.k));
  function ptHeadHtml() {
    return ptShownCols().map((c) => `<th class="${c.cls || ""}${c.hi ? " hi" : ""}" data-k="${c.k}" role="button" tabindex="0" title="Sort by ${esc(c.label)}">${esc(c.th || c.label)}<span class="pt-arrow"></span></th>`).join("");
  }
  // (re)build the header row and wire sort handlers — called on mount and whenever columns change
  function ptRenderHead() {
    const tr = $("#ptHead tr"); if (!tr) return;
    tr.innerHTML = ptHeadHtml();
    const sortBy = (k) => { PT.sort = { k, dir: PT.sort.k === k ? -PT.sort.dir : (ptCol(k).type === "text" ? 1 : -1) }; PT.shown = 80; ptRerender(); };
    $$("#ptHead th[data-k]").forEach((th) => { th.addEventListener("click", () => sortBy(th.dataset.k)); th.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sortBy(th.dataset.k); } }); });
    ptStickyRefresh();
  }
  // --- sticky header: overflow-x:auto blocks CSS position:sticky, so mirror the header in a
  //     fixed bar that appears when the real one scrolls under the top nav — aligned to the
  //     table and synced to its horizontal scroll. Desktop only (mobile leans on h-scroll). ---
  let PT_STICK = null;
  function ptStickyTeardown() {
    if (!PT_STICK) return;
    removeEventListener("scroll", PT_STICK.onScroll); removeEventListener("resize", PT_STICK.onResize);
    PT_STICK.wrap.removeEventListener("scroll", PT_STICK.onHScroll); PT_STICK.clone.remove(); PT_STICK = null;
  }
  function ptStickyRefresh() {
    if (!PT_STICK) return; const src = $("#ptHead");
    if (src) { PT_STICK.clone.querySelector("thead").innerHTML = src.innerHTML; PT_STICK.measured = false; }
  }
  function ptStickySetup() {
    ptStickyTeardown();
    if (matchMedia("(max-width:700px)").matches) return;
    const wrap = $("#ptHost .tbl-wrap"), table = $("#ptHost table.pt-table"), realHead = $("#ptHead");
    if (!wrap || !table || !realHead) return;
    const clone = document.createElement("div");
    clone.className = "pt-stick"; clone.hidden = true; clone.setAttribute("aria-hidden", "true");
    clone.innerHTML = `<div class="pt-stick-scroll"><table class="ref pt-table"><thead>${realHead.innerHTML}</thead></table></div>`;
    document.body.appendChild(clone);
    const inner = clone.firstElementChild, cloneTable = clone.querySelector("table");
    const TOP = 60, st = { clone, wrap, measured: false };
    const measure = () => {
      cloneTable.style.width = table.offsetWidth + "px";
      const real = realHead.querySelectorAll("th"), cl = cloneTable.querySelectorAll("th");
      real.forEach((th, i) => { if (cl[i]) cl[i].style.width = th.getBoundingClientRect().width + "px"; });
      st.measured = true;
    };
    const position = () => {
      const tr = table.getBoundingClientRect();
      if (!(tr.top < TOP && tr.bottom > TOP + 44)) { if (!clone.hidden) clone.hidden = true; return; }
      if (clone.hidden || !st.measured) { clone.hidden = false; measure(); }
      const wr = wrap.getBoundingClientRect();
      clone.style.left = wr.left + "px"; clone.style.width = wr.width + "px"; inner.scrollLeft = wrap.scrollLeft;
    };
    st.onScroll = () => requestAnimationFrame(position);
    st.onResize = () => { st.measured = false; position(); };
    st.onHScroll = () => { inner.scrollLeft = wrap.scrollLeft; };
    addEventListener("scroll", st.onScroll, { passive: true });
    addEventListener("resize", st.onResize);
    wrap.addEventListener("scroll", st.onHScroll, { passive: true });
    PT_STICK = st; position();
  }
  // --- generic sticky headers for non-filter tables (standings, box scores): same fixed-clone
  //     technique as the filter table, but there can be several per page (East/West, away/home),
  //     so each table gets its own bar. Only tall tables (≥10 rows) qualify — short ones don't
  //     scroll their header out of view. Scoped by route (STICKY_SEGS) to steer clear of views
  //     whose tables re-render in place (e.g. the player career stat-view toggle). ---
  let STICKIES = [];
  const STICKY_SEGS = new Set(["standings", "game"]);
  function stickyTablesTeardown() {
    STICKIES.forEach((s) => {
      removeEventListener("scroll", s.onScroll); removeEventListener("resize", s.onResize);
      s.wrap.removeEventListener("scroll", s.onHScroll); s.clone.remove();
    });
    STICKIES = [];
  }
  function makeSticky(table, wrap) {
    const thead = table.querySelector("thead"); if (!thead) return null;
    const clone = document.createElement("div");
    clone.className = "pt-stick"; clone.hidden = true; clone.setAttribute("aria-hidden", "true");
    clone.innerHTML = `<div class="pt-stick-scroll"><table class="ref"><thead>${thead.innerHTML}</thead></table></div>`;
    document.body.appendChild(clone);
    const inner = clone.firstElementChild, cloneTable = clone.querySelector("table");
    const TOP = 60, st = { clone, wrap, measured: false };
    const measure = () => {
      cloneTable.style.width = table.offsetWidth + "px";
      const real = thead.querySelectorAll("th"), cl = cloneTable.querySelectorAll("th");
      real.forEach((th, i) => { if (cl[i]) cl[i].style.width = th.getBoundingClientRect().width + "px"; });
      st.measured = true;
    };
    const position = () => {
      const tr = table.getBoundingClientRect();
      if (!(tr.top < TOP && tr.bottom > TOP + 44)) { if (!clone.hidden) clone.hidden = true; return; }
      if (clone.hidden || !st.measured) { clone.hidden = false; measure(); }
      const wr = wrap.getBoundingClientRect();
      clone.style.left = wr.left + "px"; clone.style.width = wr.width + "px"; inner.scrollLeft = wrap.scrollLeft;
    };
    st.onScroll = () => requestAnimationFrame(position);
    st.onResize = () => { st.measured = false; position(); };
    st.onHScroll = () => { inner.scrollLeft = wrap.scrollLeft; };
    addEventListener("scroll", st.onScroll, { passive: true });
    addEventListener("resize", st.onResize);
    wrap.addEventListener("scroll", st.onHScroll, { passive: true });
    position();
    return st;
  }
  function stickyTablesSetup(seg) {
    stickyTablesTeardown();
    if (!STICKY_SEGS.has(seg) || matchMedia("(max-width:700px)").matches) return;
    $$("#app .tbl-wrap > table.ref:not(.pt-table)").forEach((table) => {
      if (table.querySelectorAll("tbody tr").length < 10) return;   // only tables tall enough to scroll their header away
      const wrap = table.closest(".tbl-wrap"); if (!wrap) return;
      const st = makeSticky(table, wrap); if (st) STICKIES.push(st);
    });
  }
  // Long reference tables (franchise history, salaries, leaders, draft, all-time …) collapse to
  // a preview with a Show-more toggle so a 60-row table doesn't dominate the page. Generic over
  // any .tbl-wrap > table.ref; skips the player filter table (its own load-more) and .no-collapse.
  // No teardown needed — route() rebuilds #app each nav, so the button + listener are disposable.
  const COLLAPSE_LIMIT = 14;
  function collapseLongTables() {
    const chev = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    $$("#app .tbl-wrap > table.ref:not(.pt-table)").forEach((table) => {
      if (table.closest(".no-collapse")) return;
      const body = table.tBodies[0]; if (!body) return;
      const rows = [...body.rows];
      if (rows.length <= COLLAPSE_LIMIT + 5) return;   // leave a barely-over table whole
      const wrap = table.closest(".tbl-wrap"); if (!wrap) return;
      const bar = document.createElement("div");
      bar.className = "show-more";
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "btn show-more-btn";   // reuse the shared .btn component
      bar.appendChild(btn);
      wrap.insertAdjacentElement("afterend", bar);
      const set = (collapsed) => {
        rows.forEach((r, i) => r.classList.toggle("tr-collapsed", collapsed && i >= COLLAPSE_LIMIT));
        btn.setAttribute("aria-expanded", String(!collapsed));
        btn.innerHTML = (collapsed ? `Show ${rows.length - COLLAPSE_LIMIT} more` : "Show less") + chev;
      };
      btn.addEventListener("click", () => {
        const collapsing = btn.getAttribute("aria-expanded") === "true";
        set(collapsing);
        if (collapsing) wrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      set(true);
    });
  }
  function ptRenderBody(rows) {
    const cols = ptShownCols();
    const tb = $("#ptBody");
    tb.innerHTML = rows.slice(0, PT.shown).map((r) => { const href = PT.cfg.link(r); return `<tr class="${href ? "clickable" : ""}"${href ? ` onclick="location.hash='${href}'"` : ""}>${cols.map((c) => `<td class="${c.cls || ""}${c.hi ? " hi" : ""}">${ptCell(c, r)}</td>`).join("")}</tr>`; }).join("")
      || `<tr class="pt-empty-row"><td colspan="${cols.length}"><div class="pt-empty"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><b>No ${esc(PT.cfg.nounPl)} match</b><span>Try loosening a filter or clearing your search.</span><button class="pt-empty-clear" id="ptClear2">Clear all filters</button></div></td></tr>`;
    // result count: "X of Y" once anything is narrowing the set, else plain total
    const total = PT.data.length, n = rows.length, active = PT.q || PT.filters.length;
    $("#ptCount").innerHTML = active && n !== total
      ? `<b>${n.toLocaleString()}</b> of ${total.toLocaleString()} ${esc(PT.cfg.nounPl)}`
      : `${n.toLocaleString()} ${esc(n === 1 ? PT.cfg.noun : PT.cfg.nounPl)}`;
    const more = $("#ptMore"); if (more) more.hidden = rows.length <= PT.shown;
    const c2 = $("#ptClear2"); if (c2) c2.addEventListener("click", (e) => { e.preventDefault(); PT.q = ""; PT.filters = []; PT.join = "and"; const qi = $("#ptQ"); if (qi) qi.value = ""; ptRerender(); });
  }
  function ptRerender() {
    // pills — clicking the body edits, clicking the ✕ removes
    // Between pills sits the group combinator: the first gap is a clickable and/or toggle,
    // the rest mirror it as static text (Linear-style — one combinator governs the whole group).
    const joinWord = PT.join === "or" ? "or" : "and";
    $("#ptPills").innerHTML = PT.filters.map((f, i) => {
      const conn = i === 0 ? "" : i === 1
        ? `<button class="pt-join" data-join type="button" title="Match all filters (and) or any (or)" aria-label="Switch between matching all or any filters">${joinWord}</button>`
        : `<span class="pt-join pt-join-static" aria-hidden="true">${joinWord}</span>`;
      return `${conn}<button class="pt-pill" data-i="${i}" title="Edit filter">${esc(ptPillText(f))}<span class="x" data-rm="${i}" role="button" aria-label="Remove filter"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></span></button>`;
    }).join("");
    $("#ptReset").hidden = !(PT.filters.length || PT.q);
    const badge = $("#ptAddBadge"); if (badge) { badge.textContent = PT.filters.length || ""; badge.hidden = !PT.filters.length; }
    const add = $("#ptAdd"); if (add) add.classList.toggle("on", !!PT.filters.length);
    // header sort arrows
    $$("#ptHead th[data-k]").forEach((th) => { const on = th.dataset.k === PT.sort.k; th.classList.toggle("sorted", on); th.setAttribute("aria-sort", on ? (PT.sort.dir < 0 ? "descending" : "ascending") : "none"); });
    const rows = ptResults();
    ptRenderBody(rows);
    const jt = $("#ptPills .pt-join[data-join]");
    if (jt) jt.addEventListener("click", () => { PT.join = PT.join === "or" ? "and" : "or"; ptRerender(); });
    $$("#ptPills .pt-pill").forEach((p) => p.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-rm]");
      if (rm) { PT.filters.splice(+rm.dataset.rm, 1); ptRerender(); return; }
      ptOpenEditor(ptCol(PT.filters[+p.dataset.i].k), +p.dataset.i, p);
    }));
    ptSyncUrl();
    const sh = $("#ptShare"); if (sh) sh.hidden = location.hash.indexOf("?v=") < 0;   // shareable only when the view is customized
  }

  // ---- filter menu / editors (a single floating panel) ----
  // Below this width the anchored popover is the wrong shape — it ends up ~220px
  // wide against a 375px screen with a cramped, hard-to-hit option list. Render a
  // bottom sheet instead: full width, thumb-reachable, with a pinned Apply bar.
  const ptIsSheet = () => window.matchMedia("(max-width:640px)").matches;
  function ptClosePanel() {
    const p = $("#ptPanel"); if (p) p.remove();
    const b = $("#ptPanelBd"); if (b) b.remove();
    document.body.classList.remove("pt-sheet-open");
    document.removeEventListener("click", ptOutside, true); document.removeEventListener("keydown", ptPanelKey, true);
  }
  function ptOutside(e) { const p = $("#ptPanel"); if (p && !p.contains(e.target) && !e.target.closest("#ptAdd,#ptCols,.pt-pill")) ptClosePanel(); }
  function ptPanelKey(e) { if (e.key === "Escape") { e.stopPropagation(); ptClosePanel(); } }
  function ptPanel(anchor, html) {
    ptClosePanel();
    const p = document.createElement("div"); p.id = "ptPanel"; p.className = "pt-panel"; p.innerHTML = html;
    if (ptIsSheet()) {
      p.classList.add("pt-sheet");
      p.insertAdjacentHTML("afterbegin", '<div class="pt-grab" aria-hidden="true"></div>');
      const bd = document.createElement("div"); bd.id = "ptPanelBd"; bd.className = "pt-bd";
      bd.addEventListener("click", ptClosePanel);
      document.body.appendChild(bd);
      document.body.classList.add("pt-sheet-open");   // lock the page behind the sheet
      document.body.appendChild(p);
      setTimeout(() => { document.addEventListener("keydown", ptPanelKey, true); }, 0);
      return p;
    }
    document.body.appendChild(p);
    const rc = anchor.getBoundingClientRect();
    // clamp within the viewport on both axes (mobile: keep the panel on-screen and scrollable)
    const gap = 6, maxW = Math.min(320, window.innerWidth - 20);
    p.style.maxWidth = maxW + "px";
    const left = Math.max(10, Math.min(rc.left + window.scrollX, window.innerWidth - p.offsetWidth - 10));
    let top = rc.bottom + window.scrollY + gap;
    // if it would overflow below the fold, and there's more room above, flip upward
    if (rc.bottom + p.offsetHeight + gap > window.innerHeight && rc.top > window.innerHeight - rc.bottom)
      top = rc.top + window.scrollY - p.offsetHeight - gap;
    p.style.top = top + "px"; p.style.left = left + "px";
    setTimeout(() => { document.addEventListener("click", ptOutside, true); document.addEventListener("keydown", ptPanelKey, true); }, 0);
    return p;
  }
  const PT_TYPEHINT = { enum: "list", bool: "yes / no", num: "number", pct: "percent", money: "salary", date: "date", text: "text" };
  function ptOpenMenu(anchor) {
    const cols = PT.cfg.cols.filter((c) => c.type !== "text" && c.filt !== false);
    const active = new Set(PT.filters.map((f) => f.k));
    const item = (c) => `<button class="pt-mi" data-k="${c.k}"><span class="pt-mi-l">${esc(c.label)}${active.has(c.k) ? '<span class="pt-mi-on" title="Currently filtered"></span>' : ""}</span><span class="pt-mi-t">${PT_TYPEHINT[c.type] || ""}</span></button>`;
    const list = (f) => { const m = cols.filter((c) => !f || c.label.toLowerCase().includes(f)); return m.length ? m.map(item).join("") : `<div class="pt-mi-empty">No matching field</div>`; };
    const p = ptPanel(anchor, `<div class="pt-panel-h">Add filter</div>${cols.length > 8 ? `<input class="pt-search" id="ptMenuSearch" placeholder="Find a field…" autocomplete="off" spellcheck="false">` : ""}<div class="pt-menu" id="ptMenuList">${list("")}</div>`);
    const wire = () => $$(".pt-mi", p).forEach((b) => b.addEventListener("click", () => ptOpenEditor(ptCol(b.dataset.k), -1, anchor)));
    wire();
    const s = $("#ptMenuSearch", p);
    if (s) { s.addEventListener("input", () => { $("#ptMenuList", p).innerHTML = list(s.value.toLowerCase().trim()); wire(); }); if (!ptIsSheet()) s.focus(); }
    ptMenuKeys(p, s);   // arrow-key navigation + enter
  }
  // keyboard nav for a menu of .pt-mi buttons; `input` (optional) is the search field
  function ptMenuKeys(p, input) {
    const move = (dir) => {
      const items = $$(".pt-mi", p); if (!items.length) return;
      let i = items.findIndex((b) => b === document.activeElement);
      i = i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
      items[i].focus();
    };
    (input || p).addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    });
    if (input) return;
    p.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); } });
  }
  function ptOpenEditor(c, editIdx, anchor) {
    const existing = editIdx >= 0 ? PT.filters[editIdx] : null;
    let body;
    if (c.type === "enum") {
      const opts = ptOptions(c), sel = new Set(existing ? existing.vals.map(String) : []);
      const olabel = (o) => (c.fmtVal ? c.fmtVal(o) : "" + o);
      const optHtml = (filter) => opts.filter((o) => !filter || ("" + olabel(o)).toLowerCase().includes(filter)).map((o) =>
        `<label class="pt-opt"><input type="checkbox" value="${esc("" + o)}" ${sel.has("" + o) ? "checked" : ""}><span class="pt-opt-l">${c.enumIcon === "team" ? teamLogo(o, "xs") + " " + esc(olabel(o)) : esc("" + olabel(o))}</span><svg class="pt-opt-ck" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg></label>`).join("");
      body = `<div class="pt-panel-h pt-h-row"><span>${esc(c.label)}</span><span class="pt-sel-count" id="ptSelN"></span></div>
        ${opts.length > 8 ? `<input class="pt-search" id="ptOptSearch" placeholder="Search ${opts.length} options…" autocomplete="off" spellcheck="false">` : ""}
        <div class="pt-quick"><button class="pt-mini-link" id="ptOptAll" type="button">Select all</button><button class="pt-mini-link" id="ptOptNone" type="button">Clear</button></div>
        <div class="pt-opts" id="ptOpts">${optHtml("")}</div><div class="pt-actions"><button class="pt-apply" id="ptApply">Apply</button></div>`;
      const p = ptPanel(anchor, body);
      const upd = () => { const n = $$("#ptOpts input:checked", p).length; const el = $("#ptSelN", p); el.textContent = n ? `${n} selected` : ""; };
      const os = $("#ptOptSearch", p); if (os) os.addEventListener("input", () => { $("#ptOpts", p).innerHTML = optHtml(os.value.toLowerCase().trim()); upd(); });
      p.addEventListener("change", upd); upd();
      $("#ptOptAll", p).addEventListener("click", () => { $$("#ptOpts input", p).forEach((i) => (i.checked = true)); upd(); });
      $("#ptOptNone", p).addEventListener("click", () => { $$("#ptOpts input", p).forEach((i) => (i.checked = false)); upd(); });
      $("#ptApply", p).addEventListener("click", () => {
        const vals = $$("#ptOpts input:checked", p).map((i) => i.value);
        ptCommit(editIdx, vals.length ? { k: c.k, op: "in", vals } : null); });
      if (os && !ptIsSheet()) os.focus();   // autofocus would raise the keyboard over the sheet
    } else if (c.type === "bool") {
      const cur = existing ? existing.vals[0] : 1;
      body = `<div class="pt-panel-h">${esc(c.label)}</div><div class="pt-menu">
        <button class="pt-mi" data-v="1">${esc(c.boolLabels[0])}</button><button class="pt-mi" data-v="0">${esc(c.boolLabels[1])}</button></div>`;
      const p = ptPanel(anchor, body);
      $$(".pt-mi", p).forEach((b) => b.addEventListener("click", () => ptCommit(editIdx, { k: c.k, op: "is", vals: [+b.dataset.v] })));
    } else if (c.type === "date") {
      const v0 = existing ? existing.vals[0] : "", v1 = existing ? existing.vals[1] : "";
      body = `<div class="pt-panel-h">${esc(c.label)}</div><div class="pt-num">
        <div class="pt-num-in"><span class="pt-and">from</span><input id="ptD0" type="date" value="${v0 && v0 !== "0000-01-01" ? v0 : ""}"></div>
        <div class="pt-num-in"><span class="pt-and">to</span><input id="ptD1" type="date" value="${v1 && v1 !== "9999-12-31" ? v1 : ""}"></div></div>
        <div class="pt-actions"><button class="pt-apply" id="ptApply">Apply</button></div>`;
      const p = ptPanel(anchor, body);
      $("#ptApply", p).addEventListener("click", () => {
        const d0 = $("#ptD0", p).value, d1 = $("#ptD1", p).value;
        ptCommit(editIdx, (d0 || d1) ? { k: c.k, op: "daterange", vals: [d0 || "0000-01-01", d1 || "9999-12-31"] } : null);
      });
    } else { // numeric
      const op = existing ? existing.op : "gte", v0 = existing ? existing.vals[0] : "", v1 = existing && existing.vals[1] != null ? existing.vals[1] : "";
      const disp = (x) => x === "" ? "" : (c.inMul ? +(x / c.inMul).toFixed(2) : x);
      // show the actual data range so the user knows the bounds they can filter within
      const dv = PT.data.map((r) => ptGet(c, r)).filter((v) => v != null && !isNaN(v));
      const fh = (v) => (c.type === "pct" || c.type === "money") ? ptFmtVal(c, v) : (Number.isInteger(v) ? v : (+v).toFixed(1));
      const rangeHint = dv.length ? `data ranges ${fh(Math.min(...dv))}–${fh(Math.max(...dv))}` : "";
      const hint = [c.hint, rangeHint].filter(Boolean).join(" · ");
      body = `<div class="pt-panel-h">${esc(c.label)}</div>
        <div class="pt-num"><select id="ptOp">${["gte", "lte", "eq", "between"].map((o) => `<option value="${o}" ${o === op ? "selected" : ""}>${o === "gte" ? "at least (≥)" : o === "lte" ? "at most (≤)" : o === "eq" ? "equals (=)" : "between"}</option>`).join("")}</select>
          <div class="pt-num-in"><input id="ptV0" type="number" step="any" value="${disp(v0)}" placeholder="0" inputmode="decimal"><span class="pt-u">${c.unit || ""}</span></div>
          <div class="pt-num-in" id="ptV1wrap" ${op === "between" ? "" : "hidden"}><span class="pt-and">and</span><input id="ptV1" type="number" step="any" value="${disp(v1)}" inputmode="decimal"><span class="pt-u">${c.unit || ""}</span></div>
          ${hint ? `<span class="pt-hint">${esc(hint)}</span>` : ""}</div>
        <div class="pt-actions"><button class="pt-apply" id="ptApply">Apply</button></div>`;
      const p = ptPanel(anchor, body);
      const opSel = $("#ptOp", p); opSel.addEventListener("change", () => { $("#ptV1wrap", p).hidden = opSel.value !== "between"; });
      const commit = () => {
        const raw0 = parseFloat($("#ptV0", p).value); if (isNaN(raw0)) return;
        const mul = c.inMul || 1, o = opSel.value, vals = [raw0 * mul];
        if (o === "between") { const raw1 = parseFloat($("#ptV1", p).value); if (isNaN(raw1)) return; vals.push(raw1 * mul); }
        ptCommit(editIdx, { k: c.k, op: o, vals }); };
      $("#ptApply", p).addEventListener("click", commit);
      p.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
      $("#ptV0", p).focus();
    }
  }
  function ptCommit(editIdx, filter) {
    if (filter) { if (editIdx >= 0) PT.filters[editIdx] = filter; else PT.filters.push(filter); }
    else if (editIdx >= 0) PT.filters.splice(editIdx, 1);
    PT.shown = 80; ptClosePanel(); ptRerender();
  }

  // Build the toolbar + table into `host` for the given config + rows, and wire all interaction.
  function ptMount(host, cfg, data) {
    PT = { cfg, data, q: "", filters: [], join: "and", sort: { ...cfg.defaultSort }, shown: 80, io: null, basePath: location.hash.replace(/^#\/?/, "").split("?")[0] };
    // restore a shared/bookmarked filter state (keys that don't exist in this table are dropped)
    let urlCols = null;
    if (PT_URLSTATE) {
      if (PT_URLSTATE.q) PT.q = PT_URLSTATE.q;
      if (Array.isArray(PT_URLSTATE.f)) PT.filters = PT_URLSTATE.f.filter((f) => f && ptCol(f.k));
      if (PT_URLSTATE.j === "or") PT.join = "or";
      if (PT_URLSTATE.s && ptCol(PT_URLSTATE.s.k)) PT.sort = PT_URLSTATE.s;
      if (Array.isArray(PT_URLSTATE.c)) urlCols = PT_URLSTATE.c;
      PT_URLSTATE = null;
    }
    // visible columns: default → per-table saved preference → shared-URL override (all validated)
    PT.visCols = ptDefaultCols(cfg);
    const saved = ptLoadCols(cfg); if (saved) { const v = saved.filter((k) => ptCol(k)); if (v.length) PT.visCols = v; }
    if (urlCols) { const v = urlCols.filter((k) => ptCol(k)); if (v.length) PT.visCols = v; }
    host.innerHTML = `<div class="pt-bar">
        <div class="pt-search-wrap"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input id="ptQ" type="text" placeholder="${esc(cfg.searchPlaceholder || "Search…")}" autocomplete="off" spellcheck="false"></div>
        <button class="pt-add" id="ptAdd"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filter<span class="pt-add-badge" id="ptAddBadge" hidden></span></button>
        <button class="pt-add pt-cols" id="ptCols" title="Show or hide columns"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M9.5 4v16M15 4v16"/></svg><span class="pt-btn-t">Columns</span></button>
        <div class="pt-pills" id="ptPills"></div>
        <button class="pt-share" id="ptShare" hidden title="Copy a link to this exact view"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg><span class="pt-share-t">Copy link</span></button>
        <button class="pt-reset" id="ptReset" hidden>Reset</button>
        <span class="pt-count" id="ptCount"></span>
      </div>
      <div class="card pt-card"><div class="tbl-wrap"><table class="ref pt-table" style="min-width:${cfg.minWidth || 920}px">
        <thead id="ptHead"><tr></tr></thead><tbody id="ptBody"></tbody></table></div></div>
      <div class="pt-morewrap"><button class="pt-more" id="ptMore" hidden>Show more</button></div>`;
    ptRenderHead();
    const q = $("#ptQ"); if (PT.q) q.value = PT.q;
    let qt; q.addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(() => { PT.q = q.value.trim(); PT.shown = 80; ptRerender(); }, 140); });
    $("#ptAdd").addEventListener("click", (e) => { e.stopPropagation(); ptOpenMenu($("#ptAdd")); });
    $("#ptCols").addEventListener("click", (e) => { e.stopPropagation(); ptOpenCols($("#ptCols")); });
    $("#ptReset").addEventListener("click", () => { PT.q = ""; PT.filters = []; PT.join = "and"; q.value = ""; ptRerender(); });
    $("#ptShare").addEventListener("click", (e) => {
      const btn = e.currentTarget, label = $(".pt-share-t", btn);
      const done = () => { btn.classList.add("ok"); label.textContent = "Copied!"; setTimeout(() => { btn.classList.remove("ok"); label.textContent = "Copy link"; }, 1600); };
      const url = location.origin + location.pathname + location.search + location.hash;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
      else { const t = document.createElement("textarea"); t.value = url; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e) {} t.remove(); done(); }
    });
    $("#ptMore").addEventListener("click", () => { PT.shown += 120; ptRenderBody(ptResults()); });
    PT.io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { const rows = ptResults(); if (rows.length > PT.shown) { PT.shown += 120; ptRenderBody(rows); } } }, { rootMargin: "600px 0px" });
    PT.io.observe($("#ptMore"));
    ptRerender();
    ptStickySetup();
  }

  // Column show/hide panel — toggles which fields appear, persists per table, reflects in the URL.
  function ptOpenCols(anchor) {
    const cfg = PT.cfg;
    const row = (c) => `<label class="pt-opt"><input type="checkbox" value="${c.k}" ${PT.visCols.includes(c.k) ? "checked" : ""}><span class="pt-opt-l">${esc(c.label)}</span><svg class="pt-opt-ck" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 6"/></svg></label>`;
    const body = `<div class="pt-panel-h">Show columns</div><div class="pt-opts" id="ptColOpts">${cfg.cols.map(row).join("")}</div>
      <div class="pt-actions pt-actions-row"><button class="pt-mini-link" id="ptColReset" type="button">Reset to default</button><button class="pt-apply pt-apply-sm" id="ptColApply">Done</button></div>`;
    const p = ptPanel(anchor, body);
    const apply = () => {
      const picked = $$("#ptColOpts input:checked", p).map((i) => i.value);
      PT.visCols = picked.length ? cfg.cols.filter((c) => picked.includes(c.k)).map((c) => c.k) : ptDefaultCols(cfg);
      ptSaveCols(cfg, PT.visCols); ptClosePanel(); ptRenderHead(); ptRerender();
    };
    $("#ptColApply", p).addEventListener("click", apply);
    $("#ptColReset", p).addEventListener("click", () => { PT.visCols = ptDefaultCols(cfg); ptSaveCols(cfg, PT.visCols); ptClosePanel(); ptRenderHead(); ptRerender(); });
  }

  const PLAYERS_CFG = {
    key: "players", noun: "player", nounPl: "players", tiebreak: "n", minWidth: 920, defaultSort: { k: "pts", dir: -1 },
    searchPlaceholder: "Search name or team…",
    search: (r, q) => (r.n || "").toLowerCase().includes(q) || (r.t || "").toLowerCase().includes(q) || ptColleges(r).some((c) => c.toLowerCase().includes(q)),
    link: (r) => `#/player/${r.i}`,
    cols: [
      { k: "n", label: "Player", type: "text", col: true, cls: "l grow", cell: (r) => `<span class="who">${headshot(r.i, r.n, r.t, "xs")}<a href="#/player/${r.i}">${esc(r.n)}</a></span>` },
      { k: "pg", label: "Position", type: "enum", col: true, th: "Pos", cls: "l", opts: () => ["Guard", "Forward", "Center"], cell: (r) => r.p ? esc(r.p) : "—" },
      { k: "yr", label: "Seasons", type: "num", col: true, th: "Yrs", cell: (r) => r.yr != null ? `<span title="${r.f}–${r.e}">${r.yr}</span>` : "—" },
      { k: "f", label: "Debut year", type: "num" },
      { k: "e", label: "Final year", type: "num" },
      { k: "act", label: "Status", type: "bool", boolLabels: ["Active", "Retired"] },
      { k: "hof", label: "Hall of Fame", type: "bool", boolLabels: ["Yes", "No"] },
      // r.col is the school they left for the NBA; transfers also carry r.cols with
      // every school attended. Filter matches ANY of them, so picking "Kentucky"
      // finds players who passed through Kentucky, not just those drafted from it.
      { k: "col", label: "College", type: "enum",
        opts: () => { const s = new Set(); for (const r of PT.data) for (const c of ptColleges(r)) s.add(c); return [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); },
        match: (r, f) => ptColleges(r).some((c) => f.vals.includes(c)),
        cell: (r) => r.col ? (r.cols ? `<span title="${esc(r.cols.join(" → "))}">${esc(r.col)}<span class="col-more"> +${r.cols.length - 1}</span></span>` : esc(r.col)) : "—" },
      { k: "ht", label: "Height", type: "num", unit: '"', hint: "inches" },
      { k: "g", label: "Games", type: "num", col: true, th: "G" },
      { k: "pts", label: "Points / g", type: "num", col: true, th: "PPG", hi: true },
      { k: "trb", label: "Rebounds / g", type: "num", col: true, th: "RPG" },
      { k: "ast", label: "Assists / g", type: "num", col: true, th: "APG" },
      { k: "stl", label: "Steals / g", type: "num", col: true, th: "SPG" },
      { k: "blk", label: "Blocks / g", type: "num", col: true, th: "BPG" },
      { k: "fg", label: "FG%", type: "pct", col: true, th: "FG%", inMul: 0.01, unit: "%" },
      { k: "tp", label: "3P%", type: "pct", col: true, th: "3P%", inMul: 0.01, unit: "%" },
      { k: "ft", label: "FT%", type: "pct", col: true, th: "FT%", inMul: 0.01, unit: "%" },
    ],
  };

  const GAMES_CFG = {
    key: "games", noun: "game", nounPl: "games", tiebreak: "id", minWidth: 720, defaultSort: { k: "date", dir: -1 },
    searchPlaceholder: "Search team…",
    search: (g, q) => (g.a + " " + g.h).toLowerCase().includes(q) || (g.label || "").toLowerCase().includes(q),
    link: (g) => `#/game/${g.id}`,
    cols: [
      { k: "date", label: "Date", type: "date", col: true, th: "Date", cls: "l", cell: (g) => fmtDate(g.date) },
      { k: "matchup", label: "Matchup", type: "text", col: true, th: "Matchup", cls: "l grow", filt: false, cell: (g) => `<span class="gmatch">${teamLogo(g.a, "xs")}<b>${g.a}</b><span class="at">@</span>${teamLogo(g.h, "xs")}<b>${g.h}</b></span>` },
      { k: "score", label: "Score", type: "text", col: true, th: "Score", cls: "l", filt: false, cell: (g) => { const aw = (g.as || 0) > (g.hs || 0); return `<span class="gsc"><span class="${aw ? "gw" : ""}">${g.as ?? "—"}</span><span class="gsc-d">–</span><span class="${!aw ? "gw" : ""}">${g.hs ?? "—"}</span></span>`; } },
      { k: "margin", label: "Margin", type: "num", col: true, th: "Margin", getv: (g) => Math.abs((g.hs || 0) - (g.as || 0)) },
      { k: "type", label: "Round / type", type: "enum", col: true, th: "Type", cls: "l", getv: (g) => g.type, cell: (g) => gameTypeBadge(g.type, g.label) },
      { k: "total", label: "Total points", type: "num", getv: (g) => (g.hs || 0) + (g.as || 0) },
      { k: "team", label: "Team (either)", type: "enum", enumIcon: "team", fmtVal: (v) => tName(v) || v, opts: () => { const s = new Set(); PT.data.forEach((g) => { s.add(g.a); s.add(g.h); }); return [...s].sort((a, b) => (tName(a) || a).localeCompare(tName(b) || b)); }, match: (g, f) => f.vals.includes(g.h) || f.vals.includes(g.a) },
      { k: "h", label: "Home team", type: "enum", enumIcon: "team", fmtVal: (v) => tName(v) || v, getv: (g) => g.h },
      { k: "a", label: "Away team", type: "enum", enumIcon: "team", fmtVal: (v) => tName(v) || v, getv: (g) => g.a },
    ],
  };

  // One row per current franchise; each aggregates its full lineage (relocations, renames,
  // and absorbed ABA teams). Titles are NBA championships only.
  const TEAMS_CFG = {
    key: "teams", noun: "franchise", nounPl: "franchises", tiebreak: "i", minWidth: 1000, defaultSort: { k: "pct", dir: -1 },
    searchPlaceholder: "Search franchise…",
    search: (r, q) => (r.n || "").toLowerCase().includes(q) || (r.i || "").toLowerCase().includes(q),
    link: (r) => `#/team/${r.i}`,
    cols: [
      { k: "team", label: "Franchise", type: "text", col: true, cls: "l grow", filt: false, cell: (r) => `<span class="who">${teamLogo(r.i, "xs")}<a href="#/team/${r.i}">${esc(r.n || r.i)}</a></span>` },
      { k: "conf", label: "Conference", type: "enum", col: true, th: "Conf", cls: "l", opts: () => ["East", "West"], cell: (r) => r.conf ? esc(r.conf) : "—" },
      { k: "found", label: "Founded", type: "num", col: true, th: "Since", cls: "l", cell: (r) => `<span class="season">${seasonLabel(r.found)}</span>` },
      { k: "seasons", label: "Seasons played", type: "num", col: true, th: "Seasons" },
      { k: "titles", label: "NBA titles", type: "num", col: true, th: "Titles", hi: true, cell: (r) => r.titles ? `<span class="titles-cell">${r.titles}</span>` : `<span class="muted">0</span>` },
      { k: "lastTitle", label: "Last title", type: "num", th: "Last title", cls: "l", cell: (r) => r.lastTitle ? seasonLabel(r.lastTitle) : "—" },
      { k: "w", label: "All-time wins", type: "num", col: true, th: "W" },
      { k: "l", label: "All-time losses", type: "num", col: true, th: "L" },
      { k: "pct", label: "All-time win %", type: "pct", col: true, th: "Win%", inMul: 0.01, unit: "%", cell: (r) => winpct(r.w, r.l) },
      { k: "po", label: "Playoff trips", type: "num", col: true, th: "Playoffs", hint: "seasons reaching the postseason" },
      { k: "bestW", label: "Best season wins", type: "num", col: true, th: "Best", cell: (r) => r.bestW < 0 ? "—" : `<span title="${seasonLabel(r.bestY)} · best regular season">${r.bestW}–${r.bestL}</span>` },
    ],
  };

  // Salary book for one season (rows are objects mapped from the compact [pid,name,abbr,sal] tuples).
  const SALARIES_CFG = {
    key: "salaries", noun: "player", nounPl: "players", tiebreak: "name", minWidth: 480, defaultSort: { k: "sal", dir: -1 },
    searchPlaceholder: "Search player or team…",
    search: (r, q) => (r.name || "").toLowerCase().includes(q) || (tName(r.t) || r.t || "").toLowerCase().includes(q),
    link: (r) => r.pid ? `#/player/${r.pid}` : "",
    cols: [
      { k: "name", label: "Player", type: "text", col: true, cls: "l grow", cell: (r) => `<span class="who">${headshot(r.pid, r.name, r.t, "xs")}${r.pid ? `<a href="#/player/${r.pid}">${esc(r.name)}</a>` : `<span class="nm">${esc(r.name)}</span>`}</span>` },
      { k: "t", label: "Team", type: "enum", col: true, th: "Team", cls: "l", enumIcon: "team", fmtVal: (v) => tName(v) || v, cell: (r) => r.t ? teamTag(r.t, true) : "—" },
      { k: "sal", label: "Salary", type: "money", col: true, th: "Salary", hi: true, inMul: 1e6, unit: "$M", cell: (r) => moneyFull(r.sal) },
    ],
  };

  async function renderTeamsIndex() {
    let data; try { data = await getTeamsTable(); } catch { return notFound("teams"); }
    setSEO("Teams — NBA Franchises, All-Time", "Sort and filter all 30 NBA franchises by all-time win %, championships, playoff trips and more — every relocation and ABA team absorbed into the modern club.");
    app.innerHTML = `<div class="wrap page pt-page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>Teams</span></div>
      <div class="section-title"><div><span class="eyebrow">${data.count} franchises · all-time, full lineage</span><h2>Teams</h2></div><a class="link" href="#/standings">Current standings →</a></div>
      <div id="ptHost"></div></div>`;
    ptMount($("#ptHost"), TEAMS_CFG, data.rows);
  }

  // Per-season variant of the Players table (one row per player for the chosen season).
  const PLAYERS_SEASON_CFG = {
    key: "players-season", noun: "player", nounPl: "players", tiebreak: "n", minWidth: 980, defaultSort: { k: "pts", dir: -1 },
    searchPlaceholder: "Search name or team…",
    search: (r, q) => (r.n || "").toLowerCase().includes(q) || (r.t || "").toLowerCase().includes(q),
    link: (r) => `#/player/${r.i}`,
    cols: [
      { k: "n", label: "Player", type: "text", col: true, cls: "l grow", cell: (r) => `<span class="who">${headshot(r.i, r.n, r.t, "xs")}<a href="#/player/${r.i}">${esc(r.n)}</a></span>` },
      { k: "pg", label: "Position", type: "enum", col: true, th: "Pos", cls: "l", opts: () => ["Guard", "Forward", "Center"], cell: (r) => r.p ? esc(r.p) : "—" },
      { k: "t", label: "Team", type: "enum", col: true, th: "Team", cls: "l", enumIcon: "team", fmtVal: (v) => tName(v) || v, cell: (r) => r.t ? teamTag(r.t, true) : "—" },
      { k: "age", label: "Age", type: "num", col: true, th: "Age" },
      { k: "g", label: "Games", type: "num", col: true, th: "G" },
      { k: "mpg", label: "Minutes / g", type: "num", col: true, th: "MPG" },
      { k: "pts", label: "Points / g", type: "num", col: true, th: "PPG", hi: true },
      { k: "trb", label: "Rebounds / g", type: "num", col: true, th: "RPG" },
      { k: "ast", label: "Assists / g", type: "num", col: true, th: "APG" },
      { k: "stl", label: "Steals / g", type: "num", th: "SPG" },
      { k: "blk", label: "Blocks / g", type: "num", th: "BPG" },
      { k: "fg", label: "FG%", type: "pct", col: true, th: "FG%", inMul: 0.01, unit: "%" },
      { k: "tp", label: "3P%", type: "pct", col: true, th: "3P%", inMul: 0.01, unit: "%" },
      { k: "ft", label: "FT%", type: "pct", th: "FT%", inMul: 0.01, unit: "%" },
      { k: "per", label: "PER", type: "num", col: true, th: "PER", hint: "player efficiency rating" },
      { k: "ts", label: "TS%", type: "pct", th: "TS%", inMul: 0.01, unit: "%" },
      { k: "sal", label: "Salary", type: "money", col: true, th: "Salary", inMul: 1e6, unit: "$M" },
    ],
  };

  async function renderPlayersIndex(basis) {
    const yr = /^\d{4}$/.test(basis || "") ? +basis : null;   // #/players/2016 → that season; else career
    let data;
    try { data = yr ? await getPlayersSeason(yr) : await getPlayersTable(); }
    catch { return yr ? renderPlayersIndex() : notFound("players"); }
    const label = yr ? `${seasonLabel(yr)} season · per-game` : `1947–${META.current} · career per-game`;
    setSEO(yr ? `${seasonLabel(yr)} NBA Players — Filterable Stats` : "Players — Filterable NBA Database",
      yr ? `Filter and sort every NBA player from the ${seasonLabel(yr)} season by team, position, per-game stats and salary.`
        : "Filter and sort every NBA player, 1947 to today, by team, position, era, career stats, salary and more.");
    const years = [];
    for (let y = META.current; y >= 1950; y--) years.push(y);
    app.innerHTML = `<div class="wrap page pt-page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>Players</span></div>
      <div class="section-title"><div><span class="eyebrow">${data.count.toLocaleString()} players · ${label}</span><h2>Players</h2></div>
        <label class="season-select"><span>Stats</span><select id="plBasis">
          <option value="career" ${!yr ? "selected" : ""}>Career averages</option>
          ${years.map((y) => `<option value="${y}" ${y === yr ? "selected" : ""}>${seasonLabel(y)} season</option>`).join("")}
        </select></label></div>
      <div id="ptHost"></div></div>`;
    ptMount($("#ptHost"), yr ? PLAYERS_SEASON_CFG : PLAYERS_CFG, data.rows);
    $("#plBasis").addEventListener("change", (e) => { location.hash = e.target.value === "career" ? "#/players" : `#/players/${e.target.value}`; });
  }

  /* ================= AWARDS ================= */
  async function renderAwards(key) {
    const AW = await getAwards();
    const TABS = [["mvp", "MVP"], ["fmvp", "Finals MVP"], ["dpoy", "Defensive POY"], ["roy", "Rookie of the Year"], ["smoy", "Sixth Man"], ["mip", "Most Improved"], ["clutch", "Clutch POY"]];
    const k = AW[key] ? key : "mvp";
    const table = (rows) => `<thead><tr><th class="l">Season</th><th class="l">Player</th><th class="l">Team</th></tr></thead>
      <tbody>${rows.map((r) => `<tr onclick="location.hash='#/player/${r[1]}'" style="cursor:pointer">
        <td class="l season">${seasonLabel(r[0])}</td>
        <td class="l"><span class="who">${headshot(r[1], r[2], r[3], "xs")}<a href="#/player/${r[1]}">${esc(r[2])}</a></span></td>
        <td class="l">${r[3] ? teamTag(r[3], true) : "—"}</td></tr>`).join("")}</tbody>`;
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>Awards</span></div>
      <div class="section-title"><div><span class="eyebrow">Every winner · 1947–${META.current}</span><h2>Awards &amp; honors</h2></div></div>
      <div class="tabs seg-lg awtabs" id="awTabs">${TABS.map(([t, l]) => `<button data-k="${t}" aria-selected="${t === k}">${l}</button>`).join("")}</div>
      <div class="card" style="margin-top:18px"><div class="tbl-wrap"><table class="ref" style="min-width:0" id="awTable">${table(AW[k])}</table></div></div>
    </div>`;
    $$("#awTabs button").forEach((b) => b.addEventListener("click", () => {
      $$("#awTabs button").forEach((x) => x.setAttribute("aria-selected", "false"));
      b.setAttribute("aria-selected", "true"); $("#awTable").innerHTML = table(AW[b.dataset.k]);
    }));
  }

  /* ================= DRAFT ================= */
  async function renderDraft(y) {
    const yr = +y || META.draftYears[0];
    let D; try { D = await getDraft(yr); } catch { return notFound("draft"); }
    const hasCollege = D.picks.some((p) => p[5]);   // future/projected drafts have no college yet — hide the empty column
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>Draft</span></div>
      <div class="section-title"><div><span class="eyebrow">Every pick on record</span><h2>${yr} NBA Draft</h2></div>
        <label class="season-select"><span>Draft</span><select id="draftSel">${META.draftYears.map((v) => `<option value="${v}" ${v === yr ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
      <div class="card"><div class="tbl-wrap"><table class="ref" style="min-width:${hasCollege ? 560 : 0}px">
        <thead><tr><th class="num">Pick</th><th class="num">Rd</th><th class="l">Team</th><th class="l${hasCollege ? "" : " grow"}">Player</th>${hasCollege ? `<th class="l grow">College / From</th>` : ""}</tr></thead>
        <tbody>${D.picks.map((p) => `<tr class="${p[3] ? "clickable" : ""}" ${p[3] ? `onclick="location.hash='#/player/${p[3]}'"` : ""}>
          <td class="num">${p[0] ?? "—"}</td><td class="num">${p[1] ?? "—"}</td>
          <td class="l">${p[2] ? teamTag(p[2], true) : "—"}</td>
          <td class="l${hasCollege ? "" : " grow"}">${p[3] ? `<span class="who">${headshot(p[3], p[4], p[2], "xs")}<a href="#/player/${p[3]}">${esc(p[4])}</a></span>` : `<span class="muted">${esc(p[4])}</span>`}</td>
          ${hasCollege ? `<td class="l muted grow">${p[5] ? esc(p[5]) : "—"}</td>` : ""}</tr>`).join("")}</tbody>
      </table></div></div></div>`;
    $("#draftSel").addEventListener("change", (e) => (location.hash = `#/draft/${e.target.value}`));
  }

  /* ================= COMPARE ================= */
  // stats for a player on a given basis: "career" or a season year (as string/number)
  function statsFor(p, basis) {
    if (basis === "career" || basis == null) {
      const cr = p.career || {}, ct = p.ctot || {};
      const ts = ct.pts && (ct.fga || ct.fta) ? ct.pts / (2 * ((ct.fga || 0) + 0.44 * (ct.fta || 0))) : null;
      const advR = (p.adv || []).filter((r) => r[15] !== 2);   // exclude traded-stint dup rows
      let mp = 0, perW = 0, bpmW = 0;
      advR.forEach((r) => { const m = r[3] || 0; mp += m; perW += (r[4] || 0) * m; bpmW += (r[13] || 0) * m; });
      return { basis: "career", label: "Career",
        ppg: cr.pts, rpg: cr.trb, apg: cr.ast, spg: cr.stl, bpg: cr.blk, fg: cr.fg, tp: cr.tp, ft: cr.ft,
        per: mp ? perW / mp : null, ts, bpm: mp ? bpmW / mp : null, ws: ct.ws, vorp: ct.vorp, g: ct.g };
    }
    const y = +basis;
    const lr = (p.log || []).find((r) => r[0] === y && r[16] !== 2);
    const ar = (p.adv || []).find((r) => r[0] === y && r[15] !== 2);
    return { basis: y, label: seasonLabel(y),
      ppg: lr && lr[13], rpg: lr && lr[9], apg: lr && lr[10], spg: lr && lr[11], bpg: lr && lr[12],
      fg: lr && lr[6], tp: lr && lr[7], ft: lr && lr[8], per: lr && lr[14], ts: lr && lr[15],
      bpm: ar && ar[13], ws: ar && ar[9], vorp: ar && ar[14], g: lr && lr[4] };
  }
  const CMP_ROWS = [
    ["PPG", "ppg", one], ["RPG", "rpg", one], ["APG", "apg", one], ["SPG", "spg", one], ["BPG", "bpg", one],
    ["FG%", "fg", pctf], ["3P%", "tp", pctf], ["FT%", "ft", pctf],
    ["PER", "per", one], ["TS%", "ts", pctf], ["BPM · box +/−", "bpm", signed], ["Win shares", "ws", one], ["VORP", "vorp", signed], ["Games", "g", intc],
  ];
  const cmpBasis = { A: "career", B: "career" };   // per-slot basis state
  function basisSelect(p, which) {
    const yrs = [...new Set(p.log.map((r) => r[0]))].sort((x, y) => y - x);
    return `<select class="cmp-basis mini-select" data-slot="${which}">
      <option value="career" ${cmpBasis[which] === "career" ? "selected" : ""}>Career averages</option>
      ${yrs.map((y) => `<option value="${y}" ${String(cmpBasis[which]) === String(y) ? "selected" : ""}>${seasonLabel(y)} season</option>`).join("")}</select>`;
  }
  async function renderCompare(a, b) {
    const load = (id) => (id ? getPlayer(id).catch(() => null) : Promise.resolve(null));
    const [pa, pb] = await Promise.all([load(a), load(b)]);
    if (!pa) cmpBasis.A = "career"; if (!pb) cmpBasis.B = "career";
    const slot = (p, which) => {
      const other = which === "A" ? (b || "") : (a || "");
      if (p) return `<div class="cmp-head" style="--tc:${tColor(p.cur.team)}">
        ${headshot(p.id, p.name, p.cur.team, "hero")}
        <div class="cmp-id"><a class="nm" href="#/player/${p.id}">${esc(p.name)}</a>
          <div class="sub">${esc(p.cur.pos || "")} · ${p.log.length} season${p.log.length > 1 ? "s" : ""}</div>
          ${basisSelect(p, which)}</div>
        <div class="cmp-search"><input class="cmpSearch" data-slot="${which}" data-other="${other}" placeholder="Change…" autocomplete="off" spellcheck="false"><div class="results"></div></div></div>`;
      return `<div class="cmp-head empty">
        <div class="cmp-search big"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input class="cmpSearch" data-slot="${which}" data-other="${other}" placeholder="Search player ${which}…" autocomplete="off" spellcheck="false"><div class="results"></div></div></div>`;
    };
    app.innerHTML = `<div class="wrap page">
      <div class="crumb"><a href="#/">Home</a><span class="sep">/</span><span>Compare</span></div>
      <div class="section-title"><div><span class="eyebrow">Head to head</span><h2>Compare players</h2></div></div>
      <div class="compare-grid">${slot(pa, "A")}${slot(pb, "B")}</div>
      <div id="cmpBody">${pa && pb ? compareTable(pa, pb) : `<p class="muted" style="margin-top:22px;font-size:15px">Pick two players, then set each to career averages or any single season.</p>`}</div>
    </div>`;
    wireCompareSearch();
    $$(".cmp-basis").forEach((sel) => sel.addEventListener("change", () => {
      cmpBasis[sel.dataset.slot] = sel.value;
      if (pa && pb) $("#cmpBody").innerHTML = compareTable(pa, pb);
    }));
  }
  function compareTable(pa, pb) {
    const sa = statsFor(pa, cmpBasis.A), sb = statsFor(pb, cmpBasis.B);
    const rowH = ([label, key, fmt]) => {
      const av = sa[key], bv = sb[key], a = av == null ? null : +av, b = bv == null ? null : +bv;
      const aw = a != null && b != null && a > b, bw = a != null && b != null && b > a;
      return `<tr><td class="cmp-v ${aw ? "win" : ""}">${av == null ? "—" : fmt(av)}</td><td class="cmp-m">${label}</td><td class="cmp-v ${bw ? "win" : ""}">${bv == null ? "—" : fmt(bv)}</td></tr>`;
    };
    return `<div class="card" style="margin-top:20px">
      <div class="cmp-basis-row"><span>${esc(sa.label)}</span><span class="mid">basis</span><span>${esc(sb.label)}</span></div>
      <table class="cmp-table">${CMP_ROWS.map(rowH).join("")}
        <tr><td class="cmp-v ${pa.acc.filter((x) => x.g).length > pb.acc.filter((x) => x.g).length ? "win" : ""}">${pa.acc.filter((x) => x.g).length}</td><td class="cmp-m">Major awards <span class="tiny">(career)</span></td><td class="cmp-v ${pb.acc.filter((x) => x.g).length > pa.acc.filter((x) => x.g).length ? "win" : ""}">${pb.acc.filter((x) => x.g).length}</td></tr>
      </table></div>`;
  }
  function wireCompareSearch() {
    $$(".cmpSearch").forEach((input) => {
      const box = input.parentElement.querySelector(".results");
      const go = (id) => {
        const slot = input.dataset.slot, other = input.dataset.other;
        const A = slot === "A" ? id : other, B = slot === "B" ? id : other;
        location.hash = `#/compare/${A || "_"}/${B || "_"}`.replace(/\/_$/, "");
      };
      input.addEventListener("input", () => {
        const q = input.value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        if (!q) { box.classList.remove("on"); return; }
        const nrm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const hits = SEARCH.filter((e) => nrm(e[1]).includes(q) || (e[7] && nrm(e[7]).includes(q))).sort((x, y) => y[3] - x[3]).slice(0, 6);
        box.innerHTML = hits.map((e) => `<a data-id="${e[0]}">${headshot(e[0], e[1], e[5], "xs")}<span class="nm">${esc(e[1])}</span><span class="sub">${seasonLabel(e[2])}–${String(e[3]).slice(2)}</span></a>`).join("") || `<div class="empty">No match.</div>`;
        box.classList.add("on");
        $$("a", box).forEach((a) => a.addEventListener("click", () => go(a.dataset.id)));
      });
      input.addEventListener("focus", () => { if (input.value) input.dispatchEvent(new Event("input")); });
      document.addEventListener("click", (e) => { if (!input.parentElement.contains(e.target)) box.classList.remove("on"); });
    });
  }

  /* ---------- season selector ---------- */
  function seasonSelect(cur, base) {
    return `<label class="season-select"><span>Season</span><select data-season-base="${base}">
      ${META.seasons.map((y) => `<option value="${y}" ${y === +cur ? "selected" : ""}>${seasonLabel(y)}</option>`).join("")}</select></label>`;
  }
  function wireSeasonSelect() {
    const s = $("[data-season-base]"); if (!s) return;
    s.addEventListener("change", () => { location.hash = `#/${s.dataset.seasonBase}/${s.value}`; });
  }

  /* ================= SEARCH ================= */
  function wireSearch(input, box) {
    if (!input) return;
    let active = -1;
    box.setAttribute("role", "listbox");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    if (box.id) input.setAttribute("aria-controls", box.id);
    const setActive = (i, links) => {
      active = i;
      links.forEach((l, k) => l.setAttribute("aria-selected", k === i ? "true" : "false"));
      links.forEach((l, k) => l.classList.toggle("active", k === i));
      if (i >= 0 && links[i]) { input.setAttribute("aria-activedescendant", links[i].id); links[i].scrollIntoView({ block: "nearest" }); }
      else input.removeAttribute("aria-activedescendant");
    };
    const RK = "hw-recent";
    const getRec = () => { try { return JSON.parse(localStorage.getItem(RK) || "[]"); } catch (e) { return []; } };
    const saveRec = (a) => { if (!a || !a.dataset || !a.dataset.id) return; const it = { t: a.dataset.t, id: a.dataset.id, nm: a.dataset.nm, tm: a.dataset.tm, sub: a.dataset.sub }; try { let arr = getRec().filter((x) => !(x.t === it.t && x.id === it.id)); arr.unshift(it); localStorage.setItem(RK, JSON.stringify(arr.slice(0, 6))); } catch (e) {} };
    const recRow = (it, i, u) => it.t === "t"
      ? `<a href="#/team/${it.id}" data-nav role="option" id="${u}${i}" aria-selected="false" data-t="t" data-id="${it.id}" data-nm="${esc(it.nm)}" data-sub="${esc(it.sub || "")}">${teamLogo(it.id, "xs")}<span class="nm">${esc(it.nm)}</span><span class="sub">${esc(it.sub || "")}</span></a>`
      : `<a href="#/player/${it.id}" data-nav role="option" id="${u}${i}" aria-selected="false" data-t="p" data-id="${it.id}" data-nm="${esc(it.nm)}" data-tm="${esc(it.tm || "")}" data-sub="${esc(it.sub || "")}">${headshot(it.id, it.nm, it.tm, "xs")}<span class="nm">${esc(it.nm)}</span><span class="sub">${esc(it.sub || "")}</span></a>`;
    const showRecents = () => {
      const r = getRec(); if (!r.length) { box.classList.remove("on"); input.setAttribute("aria-expanded", "false"); return; }
      const u = (box.id || "sr") + "-o";
      box.innerHTML = `<div class="grp grp-recent" role="presentation"><span>Recent</span><button type="button" class="sr-clear">Clear</button></div>` + r.map((it, i) => recRow(it, i, u)).join("");
      box.classList.add("on"); input.setAttribute("aria-expanded", "true"); active = -1;
    };
    const render = (q) => {
      const query = q.trim().toLowerCase(); if (!query) { showRecents(); return; }
      const qn = query.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const isNum = /^#?\d{1,2}$/.test(query), numq = query.replace(/^#/, "");
      const scored = [];
      for (const e of SEARCH) {
        const nm = e[1].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const idx = nm.indexOf(qn);
        let rank, via = "";
        if (idx === 0) rank = 0;                                            // name starts with
        else if (idx > 0) rank = 1;                                         // name contains
        else if (e[7] && e[7].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(qn)) { rank = 2; via = "“" + e[7] + "”"; }  // nickname
        else if (isNum && e[8] && (" " + e[8] + " ").includes(" " + numq + " ")) { rank = 3; via = "#" + numq; }  // jersey number
        else continue;
        scored.push([rank, rank === 3 ? -(e[3] - e[2]) : -(e[3]), e, via]);  // numbers: longest career first
      }
      scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const players = scored.slice(0, 7);
      const teamHits = Object.keys(META.teams).filter((ab) => META.teams[ab].full.toLowerCase().includes(query)).slice(0, 4);
      active = -1; input.removeAttribute("aria-activedescendant");
      const uid = (box.id || "sr") + "-o";
      if (!players.length && !teamHits.length) { box.innerHTML = `<div class="empty">No players or teams match “${esc(q)}”.</div>`; box.classList.add("on"); input.setAttribute("aria-expanded", "true"); return; }
      let html = "", oi = 0;
      if (players.length) html += `<div class="grp" role="presentation">Players</div>` + players.map(([, , e, via]) => `<a href="#/player/${e[0]}" data-nav role="option" id="${uid}${oi++}" aria-selected="false" data-t="p" data-id="${e[0]}" data-nm="${esc(e[1])}" data-tm="${esc(e[5] || "")}" data-sub="${esc(e[4].split("-")[0])}${e[5] ? " · " + esc(e[5]) : ""}">
        ${headshot(e[0], e[1], e[5], "xs")}<span class="nm">${esc(e[1])}</span><span class="sub">${via ? `<span class="sr-via">${esc(via)}</span> ` : ""}${esc(e[4].split("-")[0])} · ${seasonLabel(e[2])}–${String(e[3]).slice(2)}</span></a>`).join("");
      if (teamHits.length) html += `<div class="grp" role="presentation">Teams</div>` + teamHits.map((ab) => `<a href="#/team/${ab}" data-nav role="option" id="${uid}${oi++}" aria-selected="false" data-t="t" data-id="${ab}" data-nm="${esc(META.teams[ab].full)}" data-sub="${esc(META.teams[ab].conf)}">
        ${teamLogo(ab, "xs")}<span class="nm">${esc(META.teams[ab].full)}</span><span class="sub">${META.teams[ab].conf}</span></a>`).join("");
      box.innerHTML = html; box.classList.add("on"); input.setAttribute("aria-expanded", "true");
    };
    const close = () => { box.classList.remove("on"); input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); };
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("focus", () => render(input.value));
    input.addEventListener("keydown", (e) => {
      const links = $$("a", box);
      if (e.key === "ArrowDown") { e.preventDefault(); if (!links.length) return; setActive(Math.min(active + 1, links.length - 1), links); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (!links.length) return; setActive(Math.max(active - 1, 0), links); }
      else if (e.key === "Enter" && links[active]) { saveRec(links[active]); location.hash = links[active].getAttribute("href").slice(1); input.blur(); close(); return; }
      else if (e.key === "Escape") { input.blur(); close(); return; }
    });
    document.addEventListener("click", (e) => { if (!box.contains(e.target) && e.target !== input) close(); });
    box.addEventListener("click", (e) => {
      if (e.target.closest(".sr-clear")) { e.preventDefault(); try { localStorage.removeItem(RK); } catch (er) {} close(); input.focus(); return; }
      const a = e.target.closest("a[data-id]"); if (a) saveRec(a);
      setTimeout(close, 0);
    });
  }

  /* ---------- not found ---------- */
  // one line-icon voice for full-page states (restrained, monogram-mark ethos — no emoji)
  const IC_SEARCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;
  const IC_ALERT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2l9.3 16.1H2.7L12 3.2z"/><path d="M12 10v4.2M12 17.4v.1"/></svg>`;
  function stateView({ icon, title, desc, actions }) {
    return `<div class="wrap page"><div class="state">
      <div class="state-ic" aria-hidden="true">${icon}</div>
      <h2 class="state-t">${title}</h2>
      ${desc ? `<p class="state-d">${esc(desc)}</p>` : ""}
      ${actions ? `<div class="state-act">${actions}</div>` : ""}
    </div></div>`;
  }
  function notFound(kind) {
    app.innerHTML = stateView({
      icon: IC_SEARCH,
      title: `We couldn't find that ${esc(kind)}.`,
      desc: "It may be misspelled, or not in the reference yet.",
      actions: `<a class="state-btn" href="#/players">Players</a><a class="state-btn" href="#/teams">Teams</a><a class="state-btn" href="#/seasons">Seasons</a>`,
    });
  }

  /* ---------- reveal ---------- */
  function revealInit() {
    const els = $$(".reveal"); if (!("IntersectionObserver" in window)) { els.forEach((el) => el.classList.add("in")); return; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.06, rootMargin: "0px 0px -4% 0px" });
    requestAnimationFrame(() => els.forEach((el) => { if (el.getBoundingClientRect().top < innerHeight * 0.96) el.classList.add("in"); else io.observe(el); }));
    setTimeout(() => els.forEach((el) => el.classList.add("in")), 1200);
  }

  /* ---------- skeleton loaders (replace the boot spinner: structure-matching
     shimmer → less layout shift, faster perceived load, healthier CLS) ---------- */
  const DETAIL_SEGS = new Set(["player", "pseason", "team", "game", "season"]);
  const FILTER_TABLE_SEGS = new Set(["players", "teams", "games", "salaries"]);   // have a search + filter toolbar
  const GRID_SEGS = new Set(["leaders", "seasons", "awards"]);                    // card / leaderboard grids
  // structure-matching shimmer placeholders per page shape, so the loading state doesn't
  // jump when the real content lands (lower CLS + a calmer perceived load).
  function skeleton(seg) {
    const crumb = `<div class="sk sk-crumb"></div>`;
    const rows = (n) => Array.from({ length: n }, () => `<div class="sk sk-row"></div>`).join("");
    const tableCard = `<div class="sk-card"><div class="sk-tbl"><div class="sk sk-row" style="width:34%;height:16px;margin-bottom:4px"></div>${rows(9)}</div></div>`;
    const cards = (n, cls) => `<div class="sk-cards">${Array.from({ length: n }, () => `<div class="sk sk-cardbox${cls ? " " + cls : ""}"></div>`).join("")}</div>`;

    if (DETAIL_SEGS.has(seg)) {
      return `<div class="wrap page skel" aria-busy="true" aria-label="Loading…">${crumb}
        <div class="sk-hero"><div class="sk sk-ava"></div><div class="sk-lines">
          <div class="sk sk-row" style="width:52%;height:26px"></div>
          <div class="sk sk-row" style="width:36%"></div>
          <div class="sk sk-row" style="width:62%;height:12px"></div></div></div>
        <div class="sk-tiles">${Array.from({ length: 5 }, () => `<div class="sk"></div>`).join("")}</div>
        ${tableCard}</div>`;
    }
    if (seg === "") {   // home — editorial hero + explore cards
      return `<div class="wrap page skel" aria-busy="true" aria-label="Loading…">
        <div class="sk sk-row" style="width:130px;height:12px;margin-bottom:18px"></div>
        <div class="sk sk-row" style="width:84%;height:40px"></div>
        <div class="sk sk-row" style="width:60%;height:40px;margin-top:10px"></div>
        <div class="sk sk-row" style="width:72%;height:15px;margin:20px 0 22px"></div>
        <div class="sk sk-search" style="max-width:520px"></div>
        <div style="height:20px"></div>${cards(6)}</div>`;
    }
    if (GRID_SEGS.has(seg)) {
      return `<div class="wrap page skel" aria-busy="true" aria-label="Loading…">${crumb}
        <div class="sk-titlebar"><div class="sk sk-row" style="width:180px;height:26px"></div></div>
        ${cards(6, "tall")}</div>`;
    }
    const toolbar = FILTER_TABLE_SEGS.has(seg) ? `<div class="sk-bar">
      <div class="sk sk-search" style="flex:1 1 240px"></div>
      <div class="sk sk-btn"></div><div class="sk sk-btn sm"></div>
      <div class="sk sk-row" style="width:90px;height:13px;margin-left:auto"></div></div>` : "";
    return `<div class="wrap page skel" aria-busy="true" aria-label="Loading…">${crumb}
      <div class="sk-titlebar"><div class="sk sk-row" style="width:190px;height:26px"></div><div class="sk sk-row" style="width:130px;height:34px"></div></div>
      ${toolbar}${tableCard}</div>`;
  }

  /* ================= ROUTER ================= */
  const NAV = { "": "home", players: "players", player: "players", pseason: "players", teams: "teams", team: "teams", leaders: "leaders", standings: "standings", seasons: "seasons", season: "seasons", bracket: "seasons", awards: "awards", draft: "draft", compare: "players", news: "news", article: "news", salaries: "salaries", games: "games", game: "games", play: "play", betting: "betting", settings: "settings", sources: "", terms: "", privacy: "" };
  const SECTION_SEO = {
    "": [null, "Look up any player or team in NBA history — stats, contracts, standings, leaders and awards from 1947 to today."],
    players: ["All Players", "Browse every player in NBA history — career stats, contracts and accolades for 5,000+ players."],
    teams: ["All Teams", "Every NBA franchise — rosters, records, standings and history."],
    leaders: ["NBA Leaders", "Season and all-time leaders in points, rebounds, assists, PER, true shooting and more."],
    standings: ["NBA Standings", "Conference standings by season, from 1947 to today."],
    seasons: ["NBA Seasons", "Every NBA season — champions, standings, leaders and awards."],
    awards: ["NBA Awards", "MVP, Defensive Player, Rookie of the Year, Finals MVP and All-NBA voting through history."],
    draft: ["NBA Draft", "Every NBA Draft class — picks, teams and career outcomes."],
    salaries: ["NBA Salaries", "Player contracts and salaries by season, plus career earnings."],
    compare: ["Compare Players", "Compare any two NBA players head-to-head across career stats."],
    news: ["NBA News", "Latest NBA headlines."],
  };
  // thin top progress bar shown while a route's data loads (perceived speed)
  const navProg = (() => {
    const el = document.getElementById("navprog"); let t;
    return {
      start() { if (!el) return; clearTimeout(t); el.classList.add("on"); el.style.width = "8%"; requestAnimationFrame(() => (el.style.width = "72%")); },
      done() { if (!el) return; el.style.width = "100%"; t = setTimeout(() => { el.classList.remove("on"); el.style.width = "0%"; }, 240); },
    };
  })();
  // floating back-to-top button, revealed once the page is scrolled a screenful down
  (() => {
    const btn = document.getElementById("toTop"); if (!btn) return;
    btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    let ticking = false;
    addEventListener("scroll", () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => { const show = window.scrollY > 720; if (show) btn.hidden = false; btn.classList.toggle("show", show); ticking = false; });
    }, { passive: true });
  })();

  async function route() {
    navProg.start();
    ptClosePanel();   // a filter sheet left open would survive the route change and cover the new view
    const raw = location.hash.replace(/^#\/?/, ""), qi = raw.indexOf("?");
    const h = qi < 0 ? raw : raw.slice(0, qi), parts = h.split("/"), seg = parts[0], arg = parts[1];
    // filter-table state travels in a ?v= query param so filtered views are shareable/bookmarkable
    PT_URLSTATE = null;
    if (qi >= 0) { const m = /(?:^|&)v=([^&]+)/.exec(raw.slice(qi + 1)); if (m) { try { PT_URLSTATE = JSON.parse(decodeURIComponent(m[1])); } catch (e) {} } }
    if (seg === "betting" && !SHOW_BETTING) { location.replace("#/"); return; }
    hideTT(); closeMenu(); closeMore(); ptStickyTeardown(); stickyTablesTeardown();
    app.innerHTML = skeleton(seg);
    setSEO(SECTION_SEO[seg] ? SECTION_SEO[seg][0] : null, SECTION_SEO[seg] ? SECTION_SEO[seg][1] : "A modern NBA reference — every player and team, all-time leaders, standings, awards, salaries and history from 1947 to today.");
    try {
      if (seg === "" ) await renderHome();
      else if (seg === "player") await renderPlayer(arg);
      else if (seg === "pseason") await renderPlayerSeason(arg, parts[2]);
      else if (seg === "players") await renderPlayersIndex(arg);
      else if (seg === "team") await renderTeam(arg, parts[2]);
      else if (seg === "teams") await renderTeamsIndex();
      else if (seg === "leaders") await renderLeaders(arg);
      else if (seg === "standings") await renderStandings(arg);
      else if (seg === "season") await renderSeason(arg);
      else if (seg === "bracket") await renderBracket(arg);
      else if (seg === "seasons") renderSeasons();
      else if (seg === "awards") await renderAwards(arg);
      else if (seg === "draft") await renderDraft(arg);
      else if (seg === "compare") await renderCompare(arg === "_" ? null : arg, parts[2] === "_" ? null : parts[2]);
      else if (seg === "news") await renderNews();
      else if (seg === "play") await (arg === "grid" ? renderPlayGrid(parts[2]) : arg === "sixspins" ? renderSixSpins() : arg === "duel" ? renderStatDuel() : arg === "buzzer" ? renderBuzzer() : renderPlay());
      else if (seg === "betting") await renderBetting();
      else if (seg === "settings") { await renderHome(); openSettings(); }
      else if (seg === "terms") renderTerms();
      else if (seg === "privacy") renderPrivacy();
      else if (seg === "article") await renderArticle(arg);
      else if (seg === "games") await (arg === "player" ? renderPlayerGames(parts[2]) : renderGames(arg));
      else if (seg === "game") await renderGame(arg);
      else if (seg === "salaries") await renderSalaries(arg);
      else await renderHome();
    } catch (err) {
      console.error(err);
      app.innerHTML = stateView({ icon: IC_ALERT, title: "Something went wrong loading this view.", desc: err.message || String(err), actions: `<a class="state-btn" href="#/">← Home</a>` });
    }
    // a11y: every view needs exactly one <h1>. Home and the player/team heroes already have
    // one; for the rest, add a visually-hidden h1 from the page title so the document outline
    // is well-formed for screen readers. (The prerendered SEO pages carry a visible h1.)
    if (!app.querySelector("h1")) {
      const t = (document.title || "Dunkwise").replace(/\s*[—-]\s*Dunkwise.*$/, "").trim() || "Dunkwise";
      app.insertAdjacentHTML("afterbegin", `<h1 class="vh">${esc(t)}</h1>`);
    }
    // safety net for the mono-fallback: reveal images already loaded from cache (whose onload
    // may have fired before the handler attached) and drop any that already failed.
    app.querySelectorAll(".ava img").forEach((im) => { if (im.complete) { if (im.naturalWidth) im.classList.add("ldd"); else im.remove(); } });
    $$(".mainnav a, .mobile-menu a").forEach((a) => a.classList.toggle("on", a.dataset.route === (NAV[seg] || "home")));
    const mb = $("#moreBtn"); if (mb) mb.classList.toggle("on", !!$(".navmore-menu a.on"));
    window.scrollTo(0, 0);
    const tt = $("#toTop"); if (tt) { tt.classList.remove("show"); }   // reset back-to-top on navigation
    // quiet content entrance on every route — but leave the home page's bespoke .reveal choreography alone
    const pageEl = app.querySelector(".page"); if (pageEl && !pageEl.querySelector(".reveal")) pageEl.classList.add("pg-enter");
    revealInit();
    stickyTablesSetup(seg);
    collapseLongTables();
    navProg.done();
  }

  /* ---------- mobile menu ---------- */
  const menu = $("#mobileMenu"), menuBtn = $("#menuBtn");
  function closeMenu() { menu.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); }
  menuBtn.addEventListener("click", () => { const open = menu.hidden; menu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); });
  // Settings opens as a modal from anywhere (top bar, menu, footer) without navigating away.
  document.addEventListener("click", (e) => { const s = e.target.closest("[data-settings]"); if (s) { e.preventDefault(); closeMenu(); openSettings(); } });
  // Collapsible groups in the mobile menu (nested nav).
  $$("#mobileMenu .mm-group").forEach((btn) => btn.addEventListener("click", () => {
    const sub = btn.nextElementSibling, open = sub.hidden;
    btn.setAttribute("aria-expanded", String(open)); sub.hidden = !open;
  }));

  /* ---------- "More" nav dropdown ---------- */
  const moreBtn = $("#moreBtn"), moreMenu = $("#moreMenu");
  function closeMore() { if (moreMenu) { moreMenu.hidden = true; moreBtn.setAttribute("aria-expanded", "false"); } }
  if (moreBtn) {
    moreBtn.addEventListener("click", (e) => { e.stopPropagation(); const open = moreMenu.hidden; moreMenu.hidden = !open; moreBtn.setAttribute("aria-expanded", String(open)); });
    document.addEventListener("click", (e) => { if (!moreMenu.hidden && !e.target.closest(".navmore")) closeMore(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMore(); });
    moreMenu.addEventListener("click", () => closeMore());
  }

  /* ---------- theme + density (persisted; managed on the Settings page) ---------- */
  const curTheme = () => document.documentElement.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light");
  const themeMode = () => { try { return localStorage.getItem("hw-theme") || "system"; } catch (e) { return "system"; } };
  function applyTheme(mode, persist) {
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
    if (persist) { try { localStorage.setItem("hw-theme", mode); } catch (e) {} }
  }
  function toggleTheme() { applyTheme(curTheme() === "dark" ? "light" : "dark", true); }   // used by ⌘K
  const curDensity = () => document.documentElement.getAttribute("data-density") || "comfortable";
  function applyDensity(d, persist) {
    if (d === "compact") document.documentElement.setAttribute("data-density", "compact");
    else document.documentElement.removeAttribute("data-density");
    if (persist) { try { localStorage.setItem("hw-density", d); } catch (e) {} }
  }
  applyTheme(themeMode(), false);
  applyDensity((() => { try { return localStorage.getItem("hw-density") || "comfortable"; } catch (e) { return "comfortable"; } })(), false);

  /* ================= BOOT ================= */
  // ---- click-to-sort for every reference table (delegated, so dynamic tables work too) ----
  function sortTableByHeader(th) {
    const table = th.closest("table"), tbody = table && table.tBodies[0];
    if (!tbody) return;
    const idx = th.cellIndex, heads = [...th.parentElement.cells];
    const cellVal = (r) => {
      const c = r.cells[idx]; if (!c) return { t: "", n: null };
      const pick = c.querySelector("a,.nm,.season") || c;
      const t = pick.textContent.trim(), clean = t.replace(/[,$%\s]/g, "");
      const isNum = clean !== "" && /^[-+]?[0-9]*\.?[0-9]+$/.test(clean);
      return { t, n: isNum ? parseFloat(clean) : null };
    };
    const rows = [...tbody.rows], totals = rows.filter((r) => r.classList.contains("total"));
    const body = rows.filter((r) => !r.classList.contains("total"));
    // Multi-team seasons render as a primary season row followed by indented ".stint"
    // sub-rows (blank season cell). Group each stint under its parent so sorting keeps
    // them together and sorts by the parent's (combined-season) value.
    const groups = [];
    body.forEach((r) => {
      if (r.classList.contains("stint") && groups.length) groups[groups.length - 1].kids.push(r);
      else groups.push({ head: r, kids: [] });
    });
    const numeric = groups.some((g) => cellVal(g.head).n !== null);
    const dir = th.classList.contains("sorted") ? (th.classList.contains("asc") ? "desc" : "asc") : (numeric ? "desc" : "asc");
    heads.forEach((h) => h.classList.remove("sorted", "asc", "desc"));
    th.classList.add("sorted", dir);
    groups.sort((a, b) => {
      const va = cellVal(a.head), vb = cellVal(b.head);
      if (va.n === null && vb.n === null) { const c = va.t.localeCompare(vb.t, undefined, { numeric: true }); return dir === "asc" ? c : -c; }
      if (va.n === null) return 1;      // blanks always sink to the bottom
      if (vb.n === null) return -1;
      return dir === "asc" ? va.n - vb.n : vb.n - va.n;
    });
    groups.forEach((g) => { tbody.appendChild(g.head); g.kids.forEach((k) => tbody.appendChild(k)); });
    totals.forEach((r) => tbody.appendChild(r));
  }
  document.addEventListener("click", (e) => {
    // .pt-table (the Players filter grid) manages its own full-dataset sort — the generic
    // DOM-row sorter would only reorder the visible page and fight it, so skip it there.
    const th = e.target.closest("table.ref:not(.pt-table) thead th");
    if (th && th.closest("table").tBodies[0] && th.closest("table").tBodies[0].rows.length > 2) sortTableByHeader(th);
  });

  /* ================= ⌘K COMMAND PALETTE ================= */
  let cmdkOpen = () => {};
  function initCmdK() {
    const RK = "hw-recent";
    const getRec = () => { try { return JSON.parse(localStorage.getItem(RK) || "[]"); } catch (e) { return []; } };
    const pushRec = (it) => { try { const rec = { t: it.k === "team" ? "t" : "p", id: it.id, nm: it.label, tm: it.tm || "", sub: it.sub || "" }; let a = getRec().filter((x) => !(x.t === rec.t && x.id === rec.id)); a.unshift(rec); localStorage.setItem(RK, JSON.stringify(a.slice(0, 6))); } catch (e) {} };
    const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const ACTIONS = [
      { k: "nav", label: "Players", sub: "Browse all players", hash: "#/players" },
      { k: "nav", label: "Teams", sub: "All franchises", hash: "#/teams" },
      { k: "nav", label: "Scores", sub: "Recent games & box scores", hash: "#/games" },
      { k: "nav", label: "Standings", sub: "Conference standings", hash: "#/standings" },
      { k: "nav", label: "Leaders", sub: "Season stat leaders", hash: "#/leaders" },
      { k: "nav", label: "All-time leaders", sub: "Career records", hash: "#/leaders/all" },
      { k: "nav", label: "News", sub: "Around the league", hash: "#/news" },
      { k: "nav", label: "Seasons", sub: "Every season", hash: "#/seasons" },
      { k: "nav", label: "Awards", sub: "MVP, DPOY, ROY & more", hash: "#/awards" },
      { k: "nav", label: "Salaries", sub: "Contracts & earnings", hash: "#/salaries" },
      { k: "nav", label: "Draft", sub: "Draft classes", hash: "#/draft" },
      { k: "nav", label: "Compare players", sub: "Head to head", hash: "#/compare" },
      { k: "nav", label: "Arcade", sub: "NBA games & puzzles", hash: "#/play" },
      { k: "act", label: "Toggle theme", sub: "Light / dark", act: "theme" },
      { k: "act", label: "Toggle table density", sub: "Comfortable / compact", act: "density" },
    ];
    const el = document.createElement("div");
    el.className = "cmdk"; el.hidden = true;
    el.innerHTML = `<div class="cmdk-backdrop"></div>
      <div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Command menu">
        <div class="cmdk-top"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input id="cmdkInput" type="text" placeholder="Search players, teams, or jump to…" autocomplete="off" spellcheck="false" aria-label="Command menu" aria-controls="cmdkList" role="combobox" aria-expanded="true">
          <span class="cmdk-esc">esc</span></div>
        <div class="cmdk-list" id="cmdkList" role="listbox"></div></div>`;
    document.body.appendChild(el);
    const input = el.querySelector("#cmdkInput"), list = el.querySelector("#cmdkList");
    let items = [], sel = 0;
    const recItem = (r) => r.t === "t" ? { k: "team", id: r.id, label: r.nm, sub: r.sub || "Team", hash: "#/team/" + r.id } : { k: "player", id: r.id, label: r.nm, sub: r.sub || "Player", tm: r.tm, hash: "#/player/" + r.id };
    const ico = (it) => it.k === "player" ? headshot(it.id, it.label, it.tm, "xs") : it.k === "team" ? teamLogo(it.id, "xs") : `<span class="cmdk-ic">${it.k === "act" ? "⌘" : "→"}</span>`;
    function build(q) {
      const query = norm(q.trim()); items = [];
      if (!query) {
        getRec().slice(0, 4).forEach((r) => items.push(recItem(r)));
        ACTIONS.forEach((a) => items.push(a));
      } else {
        const scored = [];
        const isNum = /^#?\d{1,2}$/.test(query), numq = query.replace(/^#/, "");
        for (const e of SEARCH) {
          const nm = norm(e[1]); const i = nm.indexOf(query);
          let rank, via = "";
          if (i === 0) rank = 0; else if (i > 0) rank = 1;
          else if (e[7] && norm(e[7]).includes(query)) { rank = 2; via = "“" + e[7] + "”"; }
          else if (isNum && e[8] && (" " + e[8] + " ").includes(" " + numq + " ")) { rank = 3; via = "#" + numq; }
          else continue;
          scored.push([rank, rank === 3 ? -(e[3] - e[2]) : -(e[3]), e, via]);
        }
        scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        scored.slice(0, 6).forEach(([, , e, via]) => { items.push({ k: "player", id: e[0], label: e[1], sub: (via ? via + " · " : "") + (e[4].split("-")[0]) + (e[5] ? " · " + e[5] : ""), tm: e[5], hash: "#/player/" + e[0] }); });
        Object.keys(META.teams).filter((ab) => norm(META.teams[ab].full).includes(query)).slice(0, 3).forEach((ab) => items.push({ k: "team", id: ab, label: META.teams[ab].full, sub: META.teams[ab].conf + "ern Conference", hash: "#/team/" + ab }));
        ACTIONS.filter((a) => norm(a.label).includes(query) || norm(a.sub).includes(query)).forEach((a) => items.push(a));
      }
      sel = 0; renderList();
    }
    function renderList() {
      if (!items.length) { list.innerHTML = `<div class="cmdk-empty">No matches — try a player or team name.</div>`; return; }
      let last = "";
      list.innerHTML = items.map((it, i) => {
        const grp = it.k === "player" ? "Players" : it.k === "team" ? "Teams" : it.k === "act" ? "Actions" : "Jump to";
        const hdr = grp !== last ? `<div class="cmdk-grp">${grp}</div>` : ""; last = grp;
        return `${hdr}<div class="cmdk-item ${i === sel ? "on" : ""}" data-i="${i}" role="option" aria-selected="${i === sel}">${ico(it)}<span class="cmdk-lbl">${esc(it.label)}</span><span class="cmdk-sub">${esc(it.sub || "")}</span><span class="cmdk-go">↵</span></div>`;
      }).join("");
      const on = list.querySelector(".cmdk-item.on"); if (on) on.scrollIntoView({ block: "nearest" });
    }
    function activate(it) {
      if (!it) return;
      close();
      if (it.act === "theme") return toggleTheme();
      if (it.act === "density") return applyDensity(curDensity() === "compact" ? "comfortable" : "compact", true);
      if (it.k === "player" || it.k === "team") pushRec(it);
      if (it.hash) location.hash = it.hash;
    }
    function open() { if (!el.hidden) return; el.hidden = false; document.body.classList.add("cmdk-open"); input.value = ""; build(""); requestAnimationFrame(() => input.focus()); }
    function close() { el.hidden = true; document.body.classList.remove("cmdk-open"); }
    cmdkOpen = open;
    input.addEventListener("input", () => build(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); renderList(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); renderList(); }
      else if (e.key === "Enter") { e.preventDefault(); activate(items[sel]); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    list.addEventListener("mousemove", (e) => { const d = e.target.closest(".cmdk-item"); if (d && +d.dataset.i !== sel) { sel = +d.dataset.i; renderList(); } });
    list.addEventListener("click", (e) => { const d = e.target.closest(".cmdk-item"); if (d) activate(items[+d.dataset.i]); });
    el.querySelector(".cmdk-backdrop").addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); el.hidden ? open() : close(); }
      else if (e.key === "/" && el.hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || "")) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); open(); }
    });
    const openBtn = $("#cmdkBtn");
    if (openBtn) { if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) openBtn.textContent = "Ctrl K"; openBtn.addEventListener("click", open); }
  }

  (async function boot() {
    try {
      [META, SEARCH] = await Promise.all([getMeta(), getSearch()]);
      SMAP = {}; SEARCH.forEach((e) => (SMAP[e[0]] = e));
      initCmdK();
      // The top-bar search is a trigger for the ⌘K palette, not an inline text box.
      const ts = $("#topSearch");
      if (ts) {
        ts.readOnly = true; ts.setAttribute("role", "button"); ts.setAttribute("aria-label", "Search (opens command menu)");
        ts.addEventListener("pointerdown", (e) => { e.preventDefault(); cmdkOpen(); });
        ts.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " " || e.key === "/") { e.preventDefault(); cmdkOpen(); } });
        ts.addEventListener("focus", () => cmdkOpen());
      }
      const sb = $("#searchBtn"); if (sb) sb.addEventListener("click", () => cmdkOpen());
      addEventListener("hashchange", route);
      await route();
      showDataRefreshed();
    } catch (err) {
      app.innerHTML = stateView({ icon: IC_ALERT, title: "Couldn't load the dataset.", desc: err.message || String(err), actions: `<button class="state-btn" onclick="location.reload()">Reload</button>` });
    }
  })();
})();
