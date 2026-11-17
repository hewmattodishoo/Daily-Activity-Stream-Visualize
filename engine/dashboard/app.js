/* DAS demo kit · requirement-driven demo on the DY Daily Activity Stream
   Left: DAS columns · Middle: prospect requirements · Right: one widget per requirement (live on DAS-derived data).
   Prospect content comes from prospect.js (window.PROSPECT, window.REQS). Widgets = capabilities, see def(...) below. */
(() => {
const D = window.DAS, DIM = D.dims, CAT = D.catalog, REQS = window.REQS, P = window.PROSPECT;
const REQ = Object.fromEntries(REQS.map(r => [r.id, r]));
const ORDER = REQS.map(r => r.id);
const CUR = P.currency.symbol, DS = P.bigquery.dataset;
const SLOT_PAGE = D.meta.slot_page || {}, CONTROLS = new Set(D.meta.controls || []);
const COUNTRIES = [...new Set(P.sites.map(s => s.country))];
const BUCKET = P.bigquery.export_bucket || `gs://${P.slug}-exports`;
const COUNTRY_SQL = (() => {
  const ss = [...P.sites].sort((a, b) => (b.domain + b.path).length - (a.domain + a.path).length);
  const w = k => ss.map(s => `    WHEN STARTS_WITH(URL_CLEAN, 'https://${s.domain}${s.path}/') THEN '${s[k]}'`).join("\n");
  return `  CASE\n${w("country")}\n  END AS country,\n  CASE\n${w("locale")}\n  END AS locale,`;
})();
const T = {};
for (const k of ["fact", "prod", "seg", "pairs", "site", "cov"]) {
  const { cols, rows } = D[k];
  T[k] = rows.map(r => { const o = {}; for (let i = 0; i < cols.length; i++) o[cols[i]] = r[i]; return o; });
  T[k].cols = new Set(cols);
}
const name = (d, i) => DIM[d][i];
const $ = id => document.getElementById(id);
const PALETTE = ["#1c3d5a", "#f28c28", "#6c2bd9", "#1a9e5c", "#d64545", "#2f86c9", "#b5a300", "#8a5a44", "#e05fa0", "#5f6b7a"];
const colorOf = (() => { const m = {}; let n = 0; return k => m[k] || (m[k] = PALETTE[n++ % PALETTE.length]); })();
const PSEUDO_CAT = new Set(["(homepage)", "(cart)", "(all)"]);
const ICON = { yes: "●", partial: "◐", no: "○" };

// ---------- formatting ----------
const nf0 = new Intl.NumberFormat(P.currency.number_locale || "en-GB", { maximumFractionDigits: 0 });
const fmt = {
  int: v => v == null ? "–" : nf0.format(v),
  money: v => v == null ? "–" : CUR + nf0.format(v),
  money2: v => v == null || !isFinite(v) ? "–" : CUR + v.toFixed(2),
  pct: v => v == null || !isFinite(v) ? "–" : (v * 100).toFixed(2) + "%",
  pct1: v => v == null || !isFinite(v) ? "–" : (v * 100).toFixed(1) + "%",
  delta: v => v == null || !isFinite(v) ? '<span class="flat">n/a</span>' :
    `<span class="${v > 0.005 ? "up" : v < -0.005 ? "down" : "flat"}">${v > 0 ? "▲" : v < 0 ? "▼" : ""} ${(Math.abs(v) * 100).toFixed(1)}%</span>`,
  txt: v => v ?? "–",
};
const delta = (a, b) => (b ? (a - b) / b : null);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- dates & state ----------
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekStart = s => { const d = new Date(s + "T00:00:00Z"); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
const END = D.meta.current_end, CUR_START = D.meta.current_start;
const S = { days: 28, compare: "prev", sel: null, hover: null, w: {} };
const range = () => [addDays(END, -(S.days - 1)), END];
function cmpRange(mode = S.compare, rng = range()) {
  const [s, e] = rng;
  if (mode === "yoy") return [addDays(s, -364), addDays(e, -364)];
  const len = Math.round((new Date(e) - new Date(s)) / 864e5) + 1;
  return [addDays(s, -len), addDays(s, -1)];
}
const cmpLabel = () => S.compare === "yoy" ? "Δ YoY" : "Δ vs prev.";

// ---------- data access ----------
const FILTER_DIMS = ["country", "locale", "DEVICE", "segment", "slot", "strategy", "page_category"];
function rowsOf(table, [s, e] = range(), f = {}) {
  const t = T[table], checks = [];
  for (const d of FILTER_DIMS) {
    if (!f[d]) continue;
    if (d === "page_category" && !t.cols.has("page_category")) {
      if (t.cols.has("sku") && !PSEUDO_CAT.has(f[d])) checks.push(o => CAT[name("sku", o.sku)]?.[1] === f[d]);
      continue;
    }
    if (!t.cols.has(d)) continue;
    const idx = DIM[d].indexOf(f[d]);
    checks.push(o => o[d] === idx);
  }
  const useDate = t.cols.has("date"), dates = DIM.date, out = [];
  for (const o of t) {
    if (useDate) { const ds = dates[o.date]; if (ds < s || ds > e) continue; }
    if (checks.every(c => c(o))) out.push(o);
  }
  return out;
}
function group(rows, keyFn, meas) {
  const m = new Map();
  for (const o of rows) {
    const k = keyFn(o);
    let a = m.get(k);
    if (!a) { a = { key: k }; for (const x of meas) a[x] = 0; m.set(k, a); }
    for (const x of meas) a[x] += o[x] || 0;
  }
  return m;
}
const total = (rows, meas) => group(rows, () => "Total", meas).get("Total") || Object.fromEntries(meas.map(m => [m, 0]));
function derive(a) {
  a.ctr = a.imp ? a.clk / a.imp : null; a.cr = a.imp ? a.orders / a.imp : null;
  a.rev1k = a.imp ? a.rev / a.imp * 1000 : null; a.atcr = a.clk ? a.atc / a.clk : null; a.c2o = a.clk ? a.orders / a.clk : null;
  return a;
}
const FM = ["imp", "clk", "pdp", "atc", "orders", "units", "rev", "addon_rev", "addon_orders", "anchor_rev", "anchor_orders", "dy_orders", "dy_rev"];
const keyBy = spec => o => spec.split("|").map(d => name(d, o[d])).join(" · ");
const agg = (dim, rng = range(), f = {}, table = "fact") => [...group(rowsOf(table, rng, f), keyBy(dim), FM).values()].map(derive);
function withCmp(rows, dim, f = {}, rng) {
  const c = group(rowsOf("fact", rng || cmpRange(), f), keyBy(dim), FM);
  rows.forEach(a => { const b = c.get(a.key); a.prev = b ? derive(b) : null; });
  return rows;
}

// ---------- tables ----------
const TABLES = {};
function renderTable(id, cols, rows, { totalRow = null, sort = null, limit = 200 } = {}) {
  const sig = cols.map(c => c.k).join();
  const st = TABLES[id] = TABLES[id]?.sig === sig ? { ...TABLES[id], cols, rows, totalRow } : { cols, rows, totalRow, sig, sort: sort || { k: cols[1]?.k, desc: true } };
  const { k, desc } = st.sort;
  const sorted = [...rows].sort((a, b) => {
    const x = a[k], y = b[k];
    if (typeof x === "string" || typeof y === "string") return desc ? String(y).localeCompare(String(x)) : String(x).localeCompare(String(y));
    return desc ? (y ?? -Infinity) - (x ?? -Infinity) : (x ?? Infinity) - (y ?? Infinity);
  });
  st.sorted = sorted;
  const maxOf = {};
  cols.filter(c => c.bar).forEach(c => (maxOf[c.k] = Math.max(...rows.map(r => r[c.k] || 0), 1e-9)));
  const cell = (c, r) => {
    const v = r[c.k], inner = c.html ? c.html(r) : (c.fmt || fmt.txt)(v);
    const bar = c.bar && v > 0 ? `<span class="bar" style="width:${Math.max(2, 46 * v / maxOf[c.k])}px"></span>` : "";
    return `<td class="${c.cls || ""}">${bar}${inner}</td>`;
  };
  const head = "<thead><tr>" + cols.map(c => `<th data-k="${c.k}" class="${c.cls || ""} ${c.k === k ? "sorted" + (desc ? "" : " asc") : ""}">${c.label}</th>`).join("") + "</tr></thead>";
  const tot = totalRow ? `<tr class="total">${cols.map((c, i) => i === 0 ? "<td>Total</td>" : c.noTotal ? "<td></td>" : cell(c, totalRow)).join("")}</tr>` : "";
  const more = sorted.length > limit ? `<tr><td colspan="${cols.length}" class="t note">Showing ${limit} of ${sorted.length} rows. CSV export contains all rows.</td></tr>` : "";
  const el = $(id);
  el.innerHTML = head + "<tbody>" + tot + sorted.slice(0, limit).map(r => "<tr>" + cols.map(c => cell(c, r)).join("") + "</tr>").join("") + more + "</tbody>";
  el.querySelectorAll("th").forEach(th => th.onclick = () => {
    st.sort = { k: th.dataset.k, desc: st.sort.k === th.dataset.k ? !st.sort.desc : true };
    renderTable(id, st.cols, st.rows, { totalRow: st.totalRow, limit });
  });
}
function exportCsv(id, base) {
  const st = TABLES[id]; if (!st) return;
  const cols = st.cols.filter(c => !c.noCsv);
  const val = v => v == null ? "" : typeof v === "number" ? +v.toFixed(6) : `"${String(v).replace(/"/g, '""')}"`;
  const lines = [cols.map(c => `"${c.csv || c.label.replace(/<[^>]+>/g, "")}"`).join(",")];
  (st.sorted || st.rows).forEach(r => lines.push(cols.map(c => val(c.csvVal ? c.csvVal(r) : r[c.k])).join(",")));
  const [s, e] = range();
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })), download: `${P.slug}_${base}_${s}_${e}.csv` });
  a.click();
}

// ---------- charts ----------
const CH = {};
Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
Chart.defaults.font.size = 11;
Chart.defaults.plugins.legend.labels.boxWidth = 10;
function chart(id, cfg) {
  if (CH[id]) CH[id].destroy();
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false }, cfg.options || {});
  CH[id] = new Chart($(id), cfg);
}
const destroyCharts = () => Object.keys(CH).forEach(k => { CH[k].destroy(); delete CH[k]; });
function bars(id, rows, bar, line, { horizontal = false, top = 0 } = {}) {
  let r = [...rows].sort((a, b) => (b[bar.k] || 0) - (a[bar.k] || 0));
  if (top) r = r.slice(0, top);
  const sc = (s, v) => v == null ? null : s ? s(v) : v;
  const ds = [{ type: "bar", label: bar.label, data: r.map(x => sc(bar.scale, x[bar.k])), backgroundColor: r.map(x => bar.color || colorOf(x.key)), yAxisID: horizontal ? undefined : "y", order: 2 }];
  const scales = horizontal ? { y: { ticks: { autoSkip: false, font: { size: 10 } } }, x: { beginAtZero: true, title: { display: true, text: bar.label } } }
    : { x: { ticks: { autoSkip: false, maxRotation: 35, font: { size: 10 } } }, y: { beginAtZero: true, title: { display: true, text: bar.label } } };
  if (line) {
    ds.push({ type: "line", label: line.label, data: r.map(x => sc(line.scale, x[line.k])), borderColor: "#1d2433", backgroundColor: "#1d2433", yAxisID: "y1", pointRadius: 4, borderWidth: 1.5, order: 1 });
    scales.y1 = { position: "right", beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: line.label } };
  }
  chart(id, { data: { labels: r.map(x => x.key), datasets: ds }, options: { indexAxis: horizontal ? "y" : "x", scales, plugins: { legend: { display: !!line } } } });
}

// ---------- columns ----------
const C = {
  imp: { k: "imp", label: "Impressions", fmt: fmt.int, csv: "impressions" },
  clk: { k: "clk", label: "Clicks", fmt: fmt.int, csv: "clicks" },
  ctr: { k: "ctr", label: "CTR", fmt: fmt.pct },
  pdp: { k: "pdp", label: "PDP views", fmt: fmt.int },
  atc: { k: "atc", label: "ATC", fmt: fmt.int, csv: "add_to_cart" },
  atcr: { k: "atcr", label: "ATC / click", fmt: fmt.pct1 },
  orders: { k: "orders", label: "Orders", fmt: fmt.int },
  units: { k: "units", label: "Units", fmt: fmt.int },
  cr: { k: "cr", label: "CR (orders / impr.)", fmt: fmt.pct, csv: "conversion_rate" },
  c2o: { k: "c2o", label: "Click → order", fmt: fmt.pct1 },
  rev: { k: "rev", label: "Attributed revenue", fmt: fmt.money, bar: true, csv: "attributed_revenue" },
  rev1k: { k: "rev1k", label: "Rev / 1k impr.", fmt: fmt.money2, csv: "revenue_per_1k_impressions" },
  dy: { k: "dy_rev", label: "DY-attributed rev.", fmt: fmt.money, csv: "dy_attributed_revenue" },
};
const K = dim => ({ k: "key", label: dim.replace("|", " × ").replace("page_category", "page category"), cls: "t" });
const D_ = (k, lbl) => ({ k, label: lbl || cmpLabel(), fmt: fmt.delta });

// ---------- DAS columns (left side) ----------
const SOURCES = {
  raw: { label: "DAS raw", cls: "src-raw", desc: "reportType=raw · one row per pageview (UIA), event (DPX) or variation engagement" },
  attr: { label: "DAS attribution", cls: "src-attr", desc: "reportType=attribution · one row per (conversion, credited variation)" },
  feed: { label: "Product feed (join)", cls: "src-feed", desc: `${P.name} product feed joined on SKU · not part of DAS` },
};
const COLUMNS = [
  ["raw", "EVENT_TYPE", "UIA = pageview · DPX = event · VARIATION_ENGAGEMENT = reco impression/click"],
  ["raw", "ENGAGEMENT_TYPE", "IMPRESSION · STRATEGY_IMPRESSION · CLICK"],
  ["raw", "SECTION_ID", "DY section = site (one per country)"],
  ["raw", "SECTION_DATE", "Event date (partition)"],
  ["raw", "URL_CLEAN", "Page URL without parameters"],
  ["raw", "DY_ID", "DY user ID"],
  ["raw", "SESSION_ID", "Session ID"],
  ["raw", "REQ_TIMESTAMP", "Event time, gives the order of events in a session"],
  ["raw", "CAMPAIGN_NAME", "Recommendation campaign = slot"],
  ["raw", "VARIATION_IDS", "Variation ID(s) served"],
  ["raw", "VARIATION_NAMES", "Variation name, e.g. A/B test arm or business rule"],
  ["raw", "STRATEGY_NAME", "Recommendation strategy (STRATEGY_IMPRESSION and CLICK rows)"],
  ["raw", "SKUS", "Clicked product. Only on CLICK rows, not on impressions"],
  ["raw", "CONTEXT_TYPE", "Page type: HOMEPAGE, CATEGORY, PRODUCT, CART"],
  ["raw", "CONTEXT_DATA", "Page context: PDP SKU or category"],
  ["raw", "EVENT_NAME", "DPX event name: Add to Cart, Purchase"],
  ["raw", "EVENT_VALUE", "Event value (order value for Purchase)"],
  ["raw", "EVENT_PROPERTIES", "Event JSON: productId, quantity, cart[] with itemPrice"],
  ["raw", "DEVICE", "Smartphone, Desktop, Tablet"],
  ["raw", "AUDIENCES_NAMES", "Audiences, e.g. New / Returning Visitors"],
  ["raw", "TRAFFIC_SOURCE", "Search, Direct, Paid Search, Email, Social, Referral"],
  ["attr", "INTERACTION_ID", "Conversion ID (joins to the raw Purchase row)"],
  ["attr", "VARIATIONS", "Variation credited with the conversion"],
  ["attr", "EVENT_VALUE", "Conversion value in cents"],
  ["feed", "sku", "Product ID (catalog size)"],
  ["feed", "name", "Product name and image"],
  ["feed", "top_category", "Category"],
  ["feed", "color_group", "Colour"],
  ["feed", "material_group", "Material"],
  ["feed", "price", "Price (bands)"],
  ["feed", "in_stock", "Stock status"],
].map(([src, col, desc]) => ({ key: `${src}:${col}`, src, col, desc }));
const COL = Object.fromEntries(COLUMNS.map(c => [c.key, c]));
const srcBadge = src => `<span class="src-badge ${SOURCES[src].cls}">${SOURCES[src].label}</span>`;

// shared "uses" building blocks: [columnKey, filter / logic]
const VE = ["raw:EVENT_TYPE", "= 'VARIATION_ENGAGEMENT'"];
const IMP = { slot: ["raw:ENGAGEMENT_TYPE", "= 'IMPRESSION' (slot was shown)"], strategy: ["raw:ENGAGEMENT_TYPE", "= 'STRATEGY_IMPRESSION' (strategy returned results and was shown)"] };
const IMPCLK = { slot: ["raw:ENGAGEMENT_TYPE", "'IMPRESSION' → impressions · 'CLICK' → clicks"], strategy: ["raw:ENGAGEMENT_TYPE", "'STRATEGY_IMPRESSION' → impressions · 'CLICK' → clicks"] };
const CLK = ["raw:ENGAGEMENT_TYPE", "= 'CLICK'"];
const DIMC = { slot: ["raw:CAMPAIGN_NAME", "Group by slot (campaign)"], strategy: ["raw:STRATEGY_NAME", "Group by strategy"] };
const DATE = ["raw:SECTION_DATE", "Selected period + comparison period"];
const SESSION = [["raw:DY_ID", "Session key = DY_ID + SESSION_ID"], ["raw:SESSION_ID", "Session key"], ["raw:REQ_TIMESTAMP", "The click must come before the next event"]];
const SKU = ["raw:SKUS", "Clicked SKU (CLICK rows)"];
const PDPV = [["raw:CONTEXT_TYPE", "UIA row with 'PRODUCT' = PDP view"], ["raw:CONTEXT_DATA", "PDP SKU = clicked SKU"]];
const ATC = [["raw:EVENT_NAME", "= 'Add to Cart'"], ["raw:EVENT_PROPERTIES", "productId = clicked SKU"]];
const PUR = [["raw:EVENT_NAME", "= 'Purchase'"], ["raw:EVENT_PROPERTIES", "cart[].productId = clicked SKU → quantity × itemPrice"]];
const dimCol = dim => dim === "slot" ? "CAMPAIGN_NAME" : "STRATEGY_NAME";
const impType = dim => dim === "slot" ? "IMPRESSION" : "STRATEGY_IMPRESSION";

// ---------- widget controls (kept per requirement session) ----------
const wv = (n, d) => S.w[n] ?? d;
const sel = (n, opts, d, label = "") => `<label>${label} <select data-w="${n}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${wv(n, d) === v ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
const box = (html, ctl = "") => `${ctl ? `<div class="w-ctrl">${ctl}</div>` : ""}${html}`;
const CHART = (id = "wc", cls = "") => `<div class="chart ${cls}"><canvas id="${id}"></canvas></div>`;
const TABLE = (id = "wt", cls = "") => `<div class="tablewrap ${cls}"><table id="${id}"></table></div>`;
const kpi = (l, v, d) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${d != null ? `<div class="d">${d}</div>` : ""}</div>`;

// ---------- capability library: def(name, (dim, req) => spec) ----------
// spec = { title, uses: [[columnKey, logic]], sql, note?, render(el) }.  Register new capabilities in engine/capabilities.json too.
const CAP = {};
const def = (name, make) => (CAP[name] = typeof make === "function" ? make : () => ({ ...make }));
const per = dim => dim === "slot" ? "slot" : "strategy";

def("impressions", dim => ({
  title: `Impressions per ${per(dim)}`,
  uses: [VE, IMP[dim], DIMC[dim], DATE],
  sql: `SELECT ${dimCol(dim)} AS ${dim}, COUNT(*) AS impressions
FROM dy.das_raw
WHERE EVENT_TYPE = 'VARIATION_ENGAGEMENT'
  AND ENGAGEMENT_TYPE = '${impType(dim)}'
  AND SECTION_DATE BETWEEN @start AND @end
GROUP BY ${dim}
ORDER BY impressions DESC;`,
  render(el) {
    const rows = withCmp(agg(dim), dim), t = derive(total(rows, FM));
    rows.forEach(r => { r.share = r.imp / t.imp; r.d = r.prev ? delta(r.imp, r.prev.imp) : null; });
    el.innerHTML = box(CHART() + TABLE());
    bars("wc", rows, { k: "imp", label: "Impressions" });
    renderTable("wt", [K(dim), { ...C.imp, bar: true }, { k: "share", label: "% of impressions", fmt: fmt.pct1 }, D_("d")], rows, { totalRow: t, sort: { k: "imp", desc: true } });
  },
}));

def("clicks_ctr", dim => ({
  title: `Clicks and CTR per ${per(dim)}`,
  uses: [VE, IMPCLK[dim], DIMC[dim], DATE],
  sql: `SELECT ${dimCol(dim)} AS ${dim},
       COUNTIF(ENGAGEMENT_TYPE = '${impType(dim)}') AS impressions,
       COUNTIF(ENGAGEMENT_TYPE = 'CLICK') AS clicks,
       SAFE_DIVIDE(COUNTIF(ENGAGEMENT_TYPE = 'CLICK'),
                   COUNTIF(ENGAGEMENT_TYPE = '${impType(dim)}')) AS ctr
FROM dy.das_raw
WHERE EVENT_TYPE = 'VARIATION_ENGAGEMENT'
  AND SECTION_DATE BETWEEN @start AND @end
GROUP BY ${dim};`,
  render(el) {
    const rows = withCmp(agg(dim), dim);
    rows.forEach(r => { r.d = r.prev ? delta(r.ctr, r.prev.ctr) : null; });
    el.innerHTML = box(CHART() + TABLE());
    bars("wc", rows, { k: "clk", label: "Clicks" }, { k: "ctr", label: "CTR %", scale: v => v * 100 });
    renderTable("wt", [K(dim), C.imp, { ...C.clk, bar: true }, C.ctr, D_("d", `CTR ${cmpLabel()}`)], rows, { totalRow: derive(total(rows, FM)), sort: { k: "clk", desc: true } });
  },
}));

def("add_to_cart", dim => ({
  title: `Add-to-cart from recommendation clicks per ${per(dim)}`,
  uses: [VE, CLK, DIMC[dim], SKU, ...ATC, ...SESSION, DATE],
  sql: `WITH clicks AS (
  SELECT DY_ID, SESSION_ID, REQ_TIMESTAMP AS click_ts, ${dimCol(dim)} AS ${dim},
         JSON_VALUE(SKUS, '$[0]') AS sku
  FROM dy.das_raw
  WHERE EVENT_TYPE = 'VARIATION_ENGAGEMENT' AND ENGAGEMENT_TYPE = 'CLICK'),
atc AS (
  SELECT DY_ID, SESSION_ID, REQ_TIMESTAMP AS atc_ts,
         JSON_VALUE(EVENT_PROPERTIES, '$.productId') AS sku
  FROM dy.das_raw
  WHERE EVENT_TYPE = 'DPX' AND EVENT_NAME = 'Add to Cart')
SELECT c.${dim}, COUNT(DISTINCT c.click_ts) AS clicks,
       COUNT(a.atc_ts) AS add_to_carts            -- same SKU, later in the session
FROM clicks c
LEFT JOIN atc a USING (DY_ID, SESSION_ID, sku)
WHERE a.atc_ts IS NULL OR a.atc_ts > c.click_ts
GROUP BY c.${dim};`,
  render(el) {
    const rows = withCmp(agg(dim), dim);
    rows.forEach(r => { r.d = r.prev ? delta(r.atc, r.prev.atc) : null; });
    el.innerHTML = box(CHART() + TABLE());
    bars("wc", rows, { k: "atc", label: "Add to cart" }, { k: "atcr", label: "ATC per click %", scale: v => v * 100 });
    renderTable("wt", [K(dim), C.clk, { ...C.atc, bar: true }, C.atcr, D_("d")], rows, { totalRow: derive(total(rows, FM)), sort: { k: "atc", desc: true } });
  },
}));

def("units_purchased", dim => ({
  title: `Recommended products purchased per ${per(dim)}`,
  uses: [VE, CLK, DIMC[dim], SKU, ...PUR, ...SESSION, DATE],
  sql: `SELECT ${dim}, SUM(orders) AS orders, SUM(units) AS units_purchased
FROM dy.fct_reco_clicks      -- click on SKU X -> Purchase whose cart[] contains X
WHERE SECTION_DATE BETWEEN @start AND @end
GROUP BY ${dim};`,
  render(el) {
    const rows = withCmp(agg(dim), dim);
    rows.forEach(r => { r.d = r.prev ? delta(r.units, r.prev.units) : null; });
    el.innerHTML = box(CHART() + TABLE());
    bars("wc", rows, { k: "units", label: "Units purchased" }, { k: "orders", label: "Orders" });
    renderTable("wt", [K(dim), C.clk, C.orders, { ...C.units, bar: true }, C.c2o, D_("d")], rows, { totalRow: derive(total(rows, FM)), sort: { k: "units", desc: true } });
  },
}));

def("conversion_rate", dim => ({
  title: `Conversion rate (orders / impressions) per ${per(dim)}`,
  uses: [VE, IMPCLK[dim], DIMC[dim], SKU, ...PUR, ...SESSION, DATE],
  sql: `SELECT ${dim},
       SUM(impressions) AS impressions, SUM(orders) AS orders,
       SAFE_DIVIDE(SUM(orders), SUM(impressions)) AS conversion_rate
FROM dy.rpt_reco_kpis
WHERE SECTION_DATE BETWEEN @start AND @end
GROUP BY ${dim};`,
  render(el) {
    const rows = withCmp(agg(dim), dim);
    rows.forEach(r => { r.d = r.prev ? delta(r.cr, r.prev.cr) : null; });
    el.innerHTML = box(CHART() + TABLE());
    bars("wc", rows, { k: "cr", label: "Conversion rate %", scale: v => v * 100 });
    renderTable("wt", [K(dim), C.imp, C.orders, C.cr, D_("d", `CR ${cmpLabel()}`), C.ctr, C.c2o], rows, { totalRow: derive(total(rows, FM)), sort: { k: "cr", desc: true } });
  },
}));

def("attributed_revenue", dim => ({
  title: `Attributed revenue (click → PDP → order) per ${per(dim)}`,
  uses: [VE, CLK, DIMC[dim], SKU, ...PDPV, ...PUR, ...SESSION, ["raw:EVENT_VALUE", "Total site revenue → reco share"],
    ["attr:VARIATIONS", "DY-attributed revenue (comparison)"], ["attr:EVENT_VALUE", "Whole order value in cents"], DATE],
  sql: `-- ${P.name} definition: clicked SKU -> PDP view of that SKU -> order containing that SKU
SELECT ${dim},
       SUM(attributed_revenue) AS attributed_revenue,
       SAFE_DIVIDE(SUM(attributed_revenue), SUM(impressions)) * 1000 AS revenue_per_1k_impressions
FROM dy.rpt_reco_kpis
WHERE SECTION_DATE BETWEEN @start AND @end
GROUP BY ${dim};

-- DY attribution (for reconciliation with the DY UI)
SELECT JSON_VALUE(VARIATIONS, '$[0]') AS variation_id, SUM(EVENT_VALUE) / 100 AS revenue
FROM dy.das_attribution GROUP BY 1;`,
  render(el) {
    const rows = withCmp(agg(dim), dim), t = derive(total(rows, FM));
    rows.forEach(r => { r.d = r.prev ? delta(r.rev, r.prev.rev) : null; });
    const site = total(rowsOf("site"), ["rev"]).rev;
    el.innerHTML = box(`<div class="kpis three">${kpi("Attributed revenue", fmt.money(t.rev))}${kpi("Share of site revenue", fmt.pct1(t.rev / site))}${kpi("DY-attributed (attribution table)", fmt.money(t.dy_rev))}</div>` + CHART() + TABLE());
    bars("wc", rows, { k: "rev", label: `Attributed revenue (${CUR})` }, { k: "rev1k", label: `Revenue / 1k impr. (${CUR})` });
    renderTable("wt", [K(dim), { ...C.rev }, D_("d"), C.rev1k, C.dy], rows, { totalRow: t, sort: { k: "rev", desc: true } });
  },
  note: `Direct (product-level, ${P.name} definition) and DY-attributed (whole order, every exposed variation) revenue use the same data but different logic. Agree one definition per KPI.`,
}));

def("addon_revenue", dim => ({
  title: `Add-on revenue on PDP ${dim === "slot" ? "slots" : "strategies"} vs the main product`,
  uses: [VE, CLK, ["raw:CONTEXT_TYPE", "= 'PRODUCT' on the CLICK row → the click came from a PDP"], ["raw:CONTEXT_DATA", "Main (anchor) product = PDP SKU of the click"],
    DIMC[dim], SKU, ...PUR.map(u => u[0] === "raw:EVENT_PROPERTIES" ? [u[0], "cart[]: reco product revenue + main product revenue in the same order"] : u), ...SESSION, DATE],
  sql: `SELECT ${dim},
       SUM(attributed_revenue) AS addon_revenue,       -- recommended product in the order
       SUM(anchor_revenue)     AS main_product_revenue -- original PDP product, same order
FROM dy.fct_reco_clicks
WHERE anchor_sku IS NOT NULL   -- anchor_sku = CONTEXT_DATA[0] when CONTEXT_TYPE = 'PRODUCT'
  AND SECTION_DATE BETWEEN @start AND @end
GROUP BY ${dim};`,
  render(el) {
    const rows = [...group(rowsOf("fact").filter(o => SLOT_PAGE[name("slot", o.slot)] === "PRODUCT"), keyBy(dim), FM).values()].map(derive);
    rows.forEach(a => { a.anchor_in = a.addon_orders ? a.anchor_orders / a.addon_orders : null; a.ratio = a.anchor_rev ? a.addon_rev / a.anchor_rev : null; });
    const t = derive(total(rows, FM)); t.anchor_in = t.anchor_orders / t.addon_orders; t.ratio = t.addon_rev / t.anchor_rev;
    el.innerHTML = box(`<div class="kpis three">${kpi("Add-on revenue", fmt.money(t.addon_rev))}${kpi("Main product revenue (same orders)", fmt.money(t.anchor_rev))}${kpi("Main product also bought", fmt.pct1(t.anchor_in))}</div>` + CHART() + TABLE());
    const r = rows.sort((a, b) => b.addon_rev - a.addon_rev);
    chart("wc", { type: "bar", data: { labels: r.map(a => a.key), datasets: [
      { label: "Add-on revenue (recommended product)", data: r.map(a => a.addon_rev), backgroundColor: "#f28c28" },
      { label: "Main (PDP) product revenue, same orders", data: r.map(a => a.anchor_rev), backgroundColor: "#1c3d5a" }] } });
    renderTable("wt", [K(dim), C.clk, { k: "addon_orders", label: "Orders with add-on", fmt: fmt.int }, { k: "addon_rev", label: "Add-on revenue", fmt: fmt.money, bar: true },
      { k: "anchor_rev", label: "Main product rev.", fmt: fmt.money }, { k: "anchor_in", label: "Main also bought", fmt: fmt.pct1 }, { k: "ratio", label: "Add-on / main", fmt: v => v == null ? "–" : v.toFixed(1) + "×" }],
      rows, { totalRow: t, sort: { k: "addon_rev", desc: true } });
  },
}));

def("product_clicks", dim => ({
  title: `Product clicks per product ID, by ${per(dim)}`,
  uses: [VE, CLK, SKU, DIMC[dim], DATE, ["feed:name", "Product name + image"]],
  sql: `SELECT JSON_VALUE(SKUS, '$[0]') AS product_id, ${dimCol(dim)} AS ${dim}, COUNT(*) AS clicks
FROM dy.das_raw
WHERE EVENT_TYPE = 'VARIATION_ENGAGEMENT' AND ENGAGEMENT_TYPE = 'CLICK'
  AND SECTION_DATE BETWEEN @start AND @end
GROUP BY ALL
ORDER BY clicks DESC;`,
  note: "Click counts per product. A product CTR is not possible: DAS has no SKU on impression rows.",
  render(el) {
    const f = wv("f_" + dim, "");
    const opts = [["", `All ${dim === "slot" ? "slots" : "strategies"}`], ...DIM[dim].map(v => [v, v])];
    const fl = f ? { [dim]: f } : {};
    const m = group(rowsOf("prod", range(), fl), o => name("sku", o.sku) + "\u0001" + name(dim, o[dim]), ["clk"]);
    const tot = {}; for (const a of m.values()) tot[a.key.split("\u0001")[1]] = (tot[a.key.split("\u0001")[1]] || 0) + a.clk;
    const rows = [...m.values()].map(a => { const [sku, g] = a.key.split("\u0001"); return Object.assign(enrich(a, sku), { grp: g, share: a.clk / tot[g], key: CAT[sku]?.[0] || sku }); });
    const bySku = [...group(rows, r => r.key, ["clk"]).values()];
    el.innerHTML = box(CHART("wc", "tall") + TABLE("wt", "tall"), sel("f_" + dim, opts, "", per(dim)[0].toUpperCase() + per(dim).slice(1)) + `<button class="csv" data-csv="wt">⬇ CSV</button>`);
    bars("wc", bySku, { k: "clk", label: "Clicks", color: "#1c3d5a" }, null, { horizontal: true, top: 12 });
    renderTable("wt", prodCols([{ k: "grp", label: dim, cls: "t" }, { ...C.clk, bar: true }, { k: "share", label: `% of ${dim} clicks`, fmt: fmt.pct1 }]), rows, { sort: { k: "clk", desc: true } });
  },
}));

def("time_comparison", dim => ({
  title: `Time-over-time comparison per ${per(dim)}`,
  uses: [DATE, DIMC[dim], VE, IMPCLK[dim], SKU, ...PUR, ...SESSION],
  note: `DY keeps DAS files for 30 days only. ${P.name} must load them daily into BigQuery to compare with last year.`,
  sql: `SELECT SECTION_DATE, ${dim}, rev,
       rev_wow,  rev_wow_pct,   -- same ${dim}, 7 days earlier
       rev_yoy,  rev_yoy_pct    -- same ${dim}, 364 days earlier (same weekday)
FROM dy.rpt_reco_tot
WHERE SECTION_DATE BETWEEN @start AND @end;`,
  render(el) {
    const mode = wv("tot_mode", "wow"), metric = wv("tot_metric", "rev");
    const cur = mode === "wow" ? [addDays(END, -6), END] : range();
    const prev = mode === "wow" ? [addDays(END, -13), addDays(END, -7)] : cmpRange(mode === "yoy" ? "yoy" : "prev", cur);
    const rows = withCmp(agg(dim, cur), dim, {}, prev);
    const M = { rev: ["Attributed revenue", fmt.money], imp: ["Impressions", fmt.int], clk: ["Clicks", fmt.int], ctr: ["CTR", fmt.pct], orders: ["Orders", fmt.int], cr: ["Conversion rate", fmt.pct] };
    rows.forEach(r => { r.cur = r[metric]; r.cmp = r.prev ? r.prev[metric] : null; r.d = r.cmp != null ? delta(r.cur, r.cmp) : null; });
    const t = derive(total(rows, FM)), tp = derive(total(rows.map(r => r.prev).filter(Boolean), FM));
    Object.assign(t, { cur: t[metric], cmp: tp[metric], d: delta(t[metric], tp[metric]) });
    const lbl = { wow: "Last 7 days vs the 7 days before", prev: "Selected period vs previous period", yoy: "Selected period vs same period last year" }[mode];
    el.innerHTML = box(`<p class="note">${lbl}: ${cur[0]} → ${cur[1]} vs ${prev[0]} → ${prev[1]}</p>` + CHART() + TABLE(),
      sel("tot_mode", [["wow", "Week over week"], ["prev", "Date range vs previous"], ["yoy", "Year over year"]], "wow", "Compare") +
      sel("tot_metric", Object.entries(M).map(([k, [l]]) => [k, l]), "rev", "Metric"));
    const r = [...rows].sort((a, b) => (b.cur || 0) - (a.cur || 0));
    const sc = ["ctr", "cr"].includes(metric) ? v => v * 100 : v => v;
    chart("wc", { type: "bar", data: { labels: r.map(x => x.key), datasets: [
      { label: "Current", data: r.map(x => sc(x.cur)), backgroundColor: "#1c3d5a" },
      { label: "Comparison", data: r.map(x => x.cmp == null ? null : sc(x.cmp)), backgroundColor: "#c9cfd9" }] },
      options: { scales: { x: { ticks: { autoSkip: false, maxRotation: 35, font: { size: 10 } } } } } });
    renderTable("wt", [K(dim), { k: "cur", label: `${M[metric][0]} (current)`, fmt: M[metric][1] }, { k: "cmp", label: "Comparison", fmt: M[metric][1] }, D_("d", "Δ")], rows, { totalRow: t, sort: { k: "cur", desc: true } });
  },
}));

def("trend", dim => ({
  title: `Historical trend per ${per(dim)}`,
  uses: [DATE, DIMC[dim], VE, IMPCLK[dim], SKU, ...PUR, ...SESSION],
  sql: `SELECT SECTION_DATE, ${dim},
       SUM(impressions) AS imp, SUM(clicks) AS clk, SUM(attributed_revenue) AS rev
FROM dy.rpt_reco_kpis
GROUP BY ALL
ORDER BY SECTION_DATE;`,
  render(el) {
    const metric = wv("tr_metric", "rev"), grain = wv("tr_grain", "week");
    const bucket = grain === "week" ? weekStart : d => d;
    const rows = rowsOf("fact", [CUR_START, END]);
    const m = new Map();
    for (const o of rows) {
      const b = bucket(name("date", o.date)), k = name(dim, o[dim]), key = b + "\u0001" + k;
      let a = m.get(key); if (!a) { a = { b, k, imp: 0, clk: 0, orders: 0, rev: 0, atc: 0 }; m.set(key, a); }
      a.imp += o.imp; a.clk += o.clk; a.orders += o.orders; a.rev += o.rev; a.atc += o.atc;
    }
    const pts = [...m.values()].map(derive), labels = [...new Set(pts.map(p => p.b))].sort(), groups = [...new Set(pts.map(p => p.k))].sort();
    const pct = ["ctr", "cr"].includes(metric);
    el.innerHTML = box(CHART("wc", "tall") + `<p class="note">${D.meta.weeks} weeks of history. More history needs the daily BigQuery load (30-day S3 retention).</p>`,
      sel("tr_metric", [["rev", "Attributed revenue"], ["imp", "Impressions"], ["clk", "Clicks"], ["ctr", "CTR"], ["atc", "Add to cart"], ["orders", "Orders"], ["cr", "Conversion rate"], ["rev1k", "Revenue / 1k impr."]], "rev", "Metric") +
      sel("tr_grain", [["week", "Weekly"], ["day", "Daily"]], "week", "Grain"));
    chart("wc", { type: "line", data: { labels, datasets: groups.map(g => {
      const byB = Object.fromEntries(pts.filter(p => p.k === g).map(p => [p.b, p[metric]]));
      return { label: g, data: labels.map(l => byB[l] == null ? null : pct ? byB[l] * 100 : byB[l]), borderColor: colorOf(g), backgroundColor: colorOf(g), tension: .25, pointRadius: grain === "week" ? 3 : 0, borderWidth: 2 };
    }) }, options: { interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, title: { display: true, text: pct ? metric.toUpperCase() + " %" : metric } } }, plugins: { legend: { position: "bottom" } } } });
  },
}));

def("filters", {
  title: "Filters: site, country, locale, device, visitor, slot, category, strategy",
  uses: [["raw:SECTION_ID", "Site (one DY section per country)"], ["raw:URL_CLEAN", "Country domain + locale path (one rule per site)"], ["raw:DEVICE", "Device"],
    ["raw:AUDIENCES_NAMES", "Visitor: New / Returning"], DIMC.slot, DIMC.strategy, ["raw:CONTEXT_TYPE", "Page type"], ["raw:CONTEXT_DATA", "Page SKU / category"],
    ["feed:top_category", "Category of the page SKU"], DATE, VE, IMPCLK.strategy, SKU, ...PUR],
  sql: `-- Filter dimensions, derived once in dy.stg_events
SELECT
${COUNTRY_SQL}
  DEVICE,
  IF(AUDIENCES_NAMES LIKE '%Returning%', 'Returning', 'New')  AS visitor,
  CAMPAIGN_NAME AS slot, STRATEGY_NAME AS strategy,
  f.top_category AS category
FROM dy.das_raw r
LEFT JOIN dy.product_feed f ON f.sku = JSON_VALUE(r.CONTEXT_DATA, '$[0]');`,
  render(el) {
    const F = Object.fromEntries(FILTER_DIMS.map(d => [d, wv("f21_" + d, "")]));
    const L = { country: "Country", locale: "Locale", DEVICE: "Device", segment: "Visitor", slot: "Slot", strategy: "Strategy", page_category: "Category" };
    const ctl = FILTER_DIMS.map(d => sel("f21_" + d, [["", "All"], ...DIM[d].filter(v => v !== "(all)").map(v => [v, v])], "", L[d])).join("");
    const rows = agg("slot", range(), F), t = derive(total(rows, FM));
    el.innerHTML = box(`<div class="kpis three">${kpi("Impressions", fmt.int(t.imp))}${kpi("CTR", fmt.pct(t.ctr))}${kpi("Attributed revenue", fmt.money(t.rev))}</div>` + TABLE(), ctl + `<button class="ghost" id="f21-reset">Reset</button>`);
    $("f21-reset").onclick = () => { FILTER_DIMS.forEach(d => delete S.w["f21_" + d]); renderWidget(); };
    renderTable("wt", [K("slot"), C.imp, C.clk, C.ctr, C.orders, C.cr, C.rev], rows, { totalRow: t, sort: { k: "rev", desc: true } });
  },
});

def("csv_export", {
  title: "Export to CSV",
  uses: [DIMC.slot, DIMC.strategy, VE, IMPCLK.strategy, SKU, ...ATC, ...PUR, ...SESSION, DATE],
  sql: `-- Any model can be exported: from the BI tool, or straight from BigQuery
EXPORT DATA OPTIONS (uri = '${BUCKET}/reco_kpis_*.csv', format = 'CSV', header = true) AS
SELECT * FROM dy.rpt_reco_kpis WHERE SECTION_DATE BETWEEN @start AND @end;`,
  render(el) {
    const rows = agg("slot|strategy");
    el.innerHTML = box(`<p class="note">Every table in this demo can be exported. The DY Experience Report also has a CSV export and a revenue event log.</p>` + TABLE(),
      `<button class="csv big" data-csv="wt">⬇ Download CSV</button>`);
    renderTable("wt", [K("slot|strategy"), C.imp, C.clk, C.ctr, C.atc, C.orders, C.units, C.cr, C.rev, C.rev1k], rows, { totalRow: derive(total(rows, FM)), sort: { k: "rev", desc: true } });
  },
});

def("realtime_gap", {
  title: "Real-time dashboard",
  uses: [],
  sql: `-- Not possible on DAS (daily batch). Option: send reco clicks in real time from the site.
-- e.g. GA4 event 'reco_click' {slot, strategy, sku} from the DY API response / JS callback,
-- streamed to BigQuery (GA4 streaming export) or Pub/Sub.`,
  render(el) {
    el.innerHTML = `<div class="gap">
      <h4>○ Not possible with the Daily Activity Stream</h4>
      <div class="flow small">
        <div class="box">Event on site<br><small>today 10:00</small></div><div class="arrow">→</div>
        <div class="box">DAS file in S3<br><small>next day (D+1)</small></div><div class="arrow">→</div>
        <div class="box">BigQuery load<br><small>daily</small></div><div class="arrow">→</div>
        <div class="box">Dashboard<br><small>yesterday's data</small></div>
      </div>
      <p><b>Options:</b></p>
      <ul>
        <li><b>DY Experience Report</b>: the "Today" view shows near-real-time results per variation.</li>
        <li><b>Own real-time stream</b>: the site sends recommendation impressions and clicks (slot, strategy, SKU from the DY API response) to GA4 or Pub/Sub → BigQuery streaming.</li>
      </ul></div>`;
  },
});

def("segments", {
  title: "Segment performance: new vs returning, device, traffic source",
  uses: [["raw:AUDIENCES_NAMES", "New / Returning Visitors"], ["raw:DEVICE", "Device"], ["raw:TRAFFIC_SOURCE", "Traffic source"], VE, IMPCLK.strategy, SKU, ...PUR, ...SESSION, DATE],
  sql: `SELECT IF(AUDIENCES_NAMES LIKE '%Returning%', 'Returning', 'New') AS visitor,
       DEVICE, TRAFFIC_SOURCE,
       SUM(impressions) AS imp, SUM(clicks) AS clk,
       SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
       SUM(attributed_revenue) AS rev
FROM dy.rpt_reco_kpis
WHERE SECTION_DATE BETWEEN @start AND @end
GROUP BY ALL;`,
  render(el) {
    const by = wv("seg_by", "segment"), SM = ["imp", "clk", "atc", "orders", "rev"];
    const rows = [...group(rowsOf("seg"), keyBy(by), SM).values()].map(derive), t = derive(total(rows, SM));
    rows.forEach(r => (r.share = r.imp / t.imp));
    el.innerHTML = box(CHART() + TABLE(), sel("seg_by", [["segment", "New vs returning"], ["DEVICE", "Device"], ["TRAFFIC_SOURCE", "Traffic source"]], "segment", "Segment"));
    bars("wc", rows, { k: "ctr", label: "CTR %", scale: v => v * 100 }, { k: "rev1k", label: `Revenue / 1k impr. (${CUR})` });
    renderTable("wt", [K(by === "segment" ? "visitor" : by.toLowerCase().replace("_", " ")), C.imp, { k: "share", label: "% impr.", fmt: fmt.pct1 }, C.clk, C.ctr, C.orders, C.cr, C.rev, C.rev1k], rows, { totalRow: t, sort: { k: "imp", desc: true } });
  },
});

def("category_performance", {
  title: "Category-level performance",
  uses: [["raw:CONTEXT_TYPE", "Page type"], ["raw:CONTEXT_DATA", "PDP SKU or category name"], SKU, VE, IMPCLK.strategy, ...PUR, ...SESSION,
    ["feed:top_category", "Category of the page SKU / the recommended SKU"], DATE],
  sql: `-- Page (context) category
SELECT page_category, SUM(impressions) AS imp, SUM(clicks) AS clk
FROM dy.fct_reco_engagement GROUP BY 1;

-- Category of the recommended product
SELECT top_category, SUM(clicks) AS clicks, SUM(orders) AS orders, SUM(revenue) AS revenue
FROM dy.rpt_reco_products GROUP BY 1;`,
  render(el) {
    const by = wv("cat_by", "page");
    const ctl = sel("cat_by", [["page", "Page category (where the slot is)"], ["prod", "Recommended product category"]], "page", "Category of");
    if (by === "page") {
      const rows = agg("page_category"), t = derive(total(rows, FM));
      el.innerHTML = box(CHART() + TABLE(), ctl);
      bars("wc", rows.filter(r => !PSEUDO_CAT.has(r.key)), { k: "rev", label: `Attributed revenue (${CUR})` }, { k: "ctr", label: "CTR %", scale: v => v * 100 });
      renderTable("wt", [K("page_category"), C.imp, C.clk, C.ctr, C.orders, C.cr, C.rev, C.rev1k], rows, { totalRow: t, sort: { k: "imp", desc: true } });
    } else {
      const PM = ["clk", "atc", "orders", "units", "rev"];
      const rows = [...group(rowsOf("prod"), o => CAT[name("sku", o.sku)]?.[1] || "?", PM).values()].map(derive), t = derive(total(rows, PM));
      rows.forEach(r => (r.share = r.clk / t.clk));
      el.innerHTML = box(CHART() + TABLE(), ctl);
      bars("wc", rows, { k: "clk", label: "Clicks" }, { k: "c2o", label: "Click → order %", scale: v => v * 100 });
      renderTable("wt", [K("category"), C.clk, { k: "share", label: "% clicks", fmt: fmt.pct1 }, C.atc, C.orders, C.units, C.rev, C.c2o], rows, { totalRow: t, sort: { k: "clk", desc: true } });
    }
  },
});

def("bigquery_feed", {
  title: "Data feed to BigQuery",
  uses: [["raw:SECTION_ID", "S3 path sectionId=… (one per site)"], ["raw:SECTION_DATE", "S3 path date=… → table partition"], ["attr:INTERACTION_ID", "reportType=attribution → dy.das_attribution"]],
  sql: `-- BigQuery Data Transfer Service, source: Amazon S3, schedule: daily
-- raw:         s3://dy-raw-data-export${P.bigquery.s3_region_suffix || ""}/sectionId=*/date={run_date}/reportType=raw/*
--              -> dy.das_raw          PARTITION BY SECTION_DATE  CLUSTER BY SECTION_ID, CAMPAIGN_NAME
-- attribution: s3://dy-raw-data-export${P.bigquery.s3_region_suffix || ""}/sectionId=*/date={run_date}/reportType=attribution/*
--              -> dy.das_attribution  PARTITION BY SECTION_DATE
-- then a scheduled query rebuilds dy.fct_reco_* (sql/bigquery_models.sql)`,
  render(el) {
    el.innerHTML = `
      <div class="flow">
        <div class="box dy">Dynamic Yield<br><small>sections ${COUNTRIES.join(" · ")}</small></div><div class="arrow">→</div>
        <div class="box">S3, daily Parquet<br><small>reportType=raw · attribution<br>kept 30 days</small></div><div class="arrow">→</div>
        <div class="box">BigQuery<br><small>Data Transfer Service (S3)<br>das_raw · das_attribution</small></div><div class="arrow">→</div>
        <div class="box">SQL models<br><small>fct_reco_clicks · rpt_reco_*</small></div><div class="arrow">→</div>
        <div class="box bi">BI tool<br><small>${esc(P.bi_tools)}</small></div>
      </div>
      <div class="kpis three">${kpi("das_raw rows (demo)", fmt.int(D.meta.raw_rows))}${kpi("das_attribution rows (demo)", fmt.int(D.meta.attribution_rows))}${kpi("Days loaded (demo)", fmt.int(DIM.date.length))}</div>
      <p class="note">+ the ${esc(P.name)} product feed, joined on SKU, for category, colour, material and price.</p>`;
  },
});

def("product_attributes", {
  title: "Product attribute analysis: colour, price, material",
  uses: [SKU, ...PUR, ...SESSION, ["feed:color_group", "Colour"], ["feed:material_group", "Material"], ["feed:price", "Price band"], ["feed:in_stock", "Stock"], DATE],
  note: "Click share and click → order rate per attribute. No CTR per attribute (no SKU on impression rows).",
  sql: `SELECT color_group, material_group, price_band,
       SUM(clicks) AS clicks, SUM(orders) AS orders, SUM(revenue) AS revenue,
       SAFE_DIVIDE(SUM(orders), SUM(clicks)) AS click_to_order
FROM dy.rpt_reco_products       -- clicked SKU joined to dy.product_feed
GROUP BY ALL;`,
  render(el) {
    const at = wv("attr_by", "color"), PM = ["clk", "atc", "orders", "units", "rev"];
    const band = p => p < 25 ? `1. < ${CUR}25` : p < 50 ? `2. ${CUR}25–50` : p < 100 ? `3. ${CUR}50–100` : p < 200 ? `4. ${CUR}100–200` : `5. ${CUR}200+`;
    const keyFn = o => { const c = CAT[name("sku", o.sku)] || []; return at === "color" ? c[3] || "unknown" : at === "material" ? c[4] || "unknown" : at === "price" ? band(c[5]) : (c[6] ? "In stock" : "Out of stock"); };
    const rows = [...group(rowsOf("prod"), keyFn, PM).values()].map(derive), t = derive(total(rows, PM));
    rows.forEach(x => (x.share = x.clk / t.clk));
    el.innerHTML = box(CHART() + TABLE(), sel("attr_by", [["color", "Colour"], ["material", "Material"], ["price", "Price band"], ["stock", "In stock"]], "color", "Attribute"));
    bars("wc", rows, { k: "share", label: "% of reco clicks", scale: v => v * 100, color: "#1c3d5a" }, { k: "c2o", label: "Click → order %", scale: v => v * 100 }, { top: 10 });
    renderTable("wt", [K(at), C.clk, { k: "share", label: "% clicks", fmt: fmt.pct1 }, C.atc, C.orders, C.units, C.rev, C.c2o], rows, { totalRow: t, sort: { k: "clk", desc: true } });
  },
});

def("business_rule_test", {
  title: "Business rule performance (A/B test of the rule)",
  uses: [DIMC.slot, ["raw:VARIATION_NAMES", "Rule variation vs control"], ["raw:VARIATION_IDS", "Variation"], DIMC.strategy, VE, IMPCLK.strategy, SKU, ...PUR, ...SESSION, DATE],
  sql: `SELECT slot, variation, strategy,
       SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
       SAFE_DIVIDE(SUM(orders), SUM(impressions)) AS cr,
       SAFE_DIVIDE(SUM(attributed_revenue), SUM(impressions)) * 1000 AS rev_per_1k
FROM dy.rpt_reco_kpis
WHERE slot IN (SELECT slot FROM dy.rpt_reco_kpis GROUP BY slot HAVING COUNT(DISTINCT variation) > 1)
GROUP BY ALL;
-- Statistical significance: DY Experience Report (probability to be best).`,
  render(el) {
    const g = agg("slot|variation|strategy");
    const n = {}; g.forEach(a => { const s = a.key.split(" · ")[0]; n[s] = (n[s] || 0) + 1; });
    const out = g.filter(a => n[a.key.split(" · ")[0]] > 1).map(a => { const [slot, variation, strategy] = a.key.split(" · "); return Object.assign(a, { slot, variation, strategy }); });
    out.forEach(a => {
      const ctl = out.find(b => b.slot === a.slot && CONTROLS.has(b.variation)) || out.find(b => b.slot === a.slot && /control/i.test(b.variation));
      a.isCtl = ctl === a;
      for (const m of ["ctr", "cr", "rev1k"]) a["u_" + m] = ctl && !a.isCtl ? delta(a[m], ctl[m]) : null;
    });
    const rules = out.filter(a => !a.isCtl && a.u_ctr != null);
    const pc = v => v == null || !isFinite(v) ? "n/a" : (v > 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
    const story = rules.map(a => `<b>${esc(a.variation)}</b> vs control: CTR ${pc(a.u_ctr)}, CR ${pc(a.u_cr)}, revenue / 1k impr. ${pc(a.u_rev1k)}.`).join("<br>");
    el.innerHTML = box(CHART() + TABLE() + `<p class="note">${story || "No A/B test with a control variation in the selected period."}<br>Use the DY Experience Report for statistical significance.</p>`);
    chart("wc", { type: "bar", data: { labels: rules.map(a => a.variation), datasets: [
      { label: "CTR uplift", data: rules.map(a => a.u_ctr * 100), backgroundColor: "#1c3d5a" },
      { label: "CR uplift", data: rules.map(a => a.u_cr * 100), backgroundColor: "#1a9e5c" },
      { label: "Revenue / 1k uplift", data: rules.map(a => a.u_rev1k * 100), backgroundColor: "#f28c28" }] },
      options: { scales: { y: { title: { display: true, text: "Uplift vs control %" } } } } });
    renderTable("wt", [{ k: "slot", label: "Slot", cls: "t" }, { k: "variation", label: "Variation", cls: "t", html: r => esc(r.variation) + (r.isCtl ? " <span class='pill partial'>control</span>" : "") },
      C.imp, C.ctr, { k: "u_ctr", label: "CTR uplift", fmt: fmt.delta }, C.cr, { k: "u_cr", label: "CR uplift", fmt: fmt.delta }, C.rev1k, { k: "u_rev1k", label: "Rev/1k uplift", fmt: fmt.delta }],
      out, { sort: { k: "slot", desc: false } });
  },
});

def("product_performance", dim => ({
  title: `Product-level performance per ${per(dim)}`,
  uses: [SKU, DIMC[dim], VE, CLK, ...ATC, ...PUR, ...SESSION, DATE, ["feed:name", "Product name + image"], ["feed:top_category", "Category"], ["feed:price", "Price"]],
  note: "Partial: clicks, ATC, units and revenue per product are available. Product impressions and product CTR are not (DAS has no SKU on impression rows).",
  sql: `SELECT sku, name, top_category, price, ${dim},
       SUM(clicks) AS clicks, SUM(add_to_carts) AS atc,
       SUM(orders) AS orders, SUM(units) AS units, SUM(revenue) AS revenue
FROM dy.rpt_reco_products
WHERE SECTION_DATE BETWEEN @start AND @end
GROUP BY ALL;`,
  render(el) {
    const f = wv("p_" + dim, ""), PM = ["clk", "atc", "orders", "units", "rev"];
    const m = group(rowsOf("prod", range(), f ? { [dim]: f } : {}), o => name("sku", o.sku) + "\u0001" + name(dim, o[dim]), PM);
    const rows = [...m.values()].map(a => { const [sku, g] = a.key.split("\u0001"); derive(a); return Object.assign(enrich(a, sku), { grp: g }); });
    el.innerHTML = box(TABLE("wt", "tall"), sel("p_" + dim, [["", "All"], ...DIM[dim].map(v => [v, v])], "", per(dim)) + `<button class="csv" data-csv="wt">⬇ CSV</button>`);
    renderTable("wt", prodCols([{ k: "grp", label: dim, cls: "t" }, { ...C.clk, bar: true }, C.atc, C.atcr, C.orders, C.units, C.rev, C.c2o,
      { k: "na", label: "Impr. / CTR", noCsv: true, html: () => '<span class="flat">n/a</span>' }]), rows, { sort: { k: "clk", desc: true }, limit: 150 });
  },
}));

def("funnel", {
  title: "Click-to-conversion funnel and main → recommended product sold",
  uses: [VE, IMPCLK.strategy, SKU, ...PDPV, ...ATC, ...PUR, ["raw:CONTEXT_DATA", "PDP SKU = clicked SKU · main product of a PDP click"], ...SESSION, DATE, ["feed:name", "Product names"]],
  sql: `-- Funnel
SELECT COUNT(*) AS clicks, COUNTIF(pdp_viewed) AS pdp_views,
       SUM(add_to_carts) AS atc, SUM(orders) AS orders
FROM dy.fct_reco_clicks WHERE SECTION_DATE BETWEEN @start AND @end;

-- Main product -> recommended product sold
SELECT anchor_sku, reco_sku, slot, clicks, orders, reco_revenue
FROM dy.rpt_reco_pairs ORDER BY orders DESC;`,
  render(el) {
    const t = total(rowsOf("fact"), FM);
    const steps = [["Impressions", t.imp], ["Clicks", t.clk], ["PDP view of clicked product", t.pdp], ["Add to cart", t.atc], ["Order", t.orders]];
    el.innerHTML = box(`<div class="kpis five">${steps.map(([l, v], i) => kpi(l, fmt.int(v), i ? fmt.pct1(v / steps[i - 1][1]) + " of previous" : "")).join("")}</div>` + CHART() +
      `<h4 class="w-h">Main product → recommended product sold</h4>` + TABLE("wt", "tall"));
    const fs = steps.slice(1);
    chart("wc", { type: "bar", data: { labels: fs.map(s => s[0]), datasets: [{ data: fs.map(s => s[1]), backgroundColor: ["#1c3d5a", "#2f86c9", "#f28c28", "#1a9e5c"] }] },
      options: { indexAxis: "y", plugins: { legend: { display: false } } } });
    const pm = group(rowsOf("pairs"), o => name("anchor", o.anchor) + "\u0001" + name("sku", o.sku) + "\u0001" + name("slot", o.slot), ["clk", "atc", "orders", "rev"]);
    const pr = [...pm.values()].map(a => { const [an, sk, sl] = a.key.split("\u0001"); return Object.assign(a, { anchor: an, aname: CAT[an]?.[0] || an, sku: sk, rname: CAT[sk]?.[0] || sk, slot: sl, aimg: CAT[an]?.[7], rimg: CAT[sk]?.[7] }); });
    renderTable("wt", [
      { k: "aname", label: "Main product (PDP)", cls: "t wrap", html: r => `${thumb(r.aimg, r.aname, CAT[r.anchor]?.[1])} ${esc(r.aname)}`, csvVal: r => r.anchor + " " + r.aname },
      { k: "rname", label: "Recommended product", cls: "t wrap", html: r => `${thumb(r.rimg, r.rname, CAT[r.sku]?.[1])} ${esc(r.rname)}`, csvVal: r => r.sku + " " + r.rname },
      { k: "slot", label: "Slot", cls: "t" }, C.clk, C.atc, C.orders, { ...C.rev, label: "Reco revenue" }], pr, { sort: { k: "orders", desc: true }, limit: 60 });
  },
});

def("coverage", {
  title: "Recommendation coverage on PDP slots",
  uses: [["raw:EVENT_TYPE", "UIA (PDP views) and VARIATION_ENGAGEMENT"], ["raw:CONTEXT_TYPE", "= 'PRODUCT'"], ["raw:CONTEXT_DATA", "PDP SKU"],
    ["raw:ENGAGEMENT_TYPE", "STRATEGY_IMPRESSION exists = the strategy returned results"], DIMC.slot, ["feed:sku", "Catalog size"], ["feed:name", "Product name"]],
  note: "Measures products that SHOW recommendations on their PDP. Products shown AS a recommendation cannot be measured (no SKU on impression rows).",
  sql: `SELECT country, slot,
       COUNT(*) AS skus_viewed,
       COUNTIF(served) AS skus_with_recos,
       SAFE_DIVIDE(COUNTIF(served), COUNT(*)) AS coverage
FROM (
  SELECT v.country, s.slot, v.sku,
         EXISTS(SELECT 1 FROM dy.stg_events e
                WHERE e.ENGAGEMENT_TYPE = 'STRATEGY_IMPRESSION' AND e.CONTEXT_TYPE = 'PRODUCT'
                  AND e.CAMPAIGN_NAME = s.slot AND e.context_item = v.sku) AS served
  FROM (SELECT DISTINCT country, context_item AS sku FROM dy.stg_events
        WHERE EVENT_TYPE = 'UIA' AND CONTEXT_TYPE = 'PRODUCT') v
  CROSS JOIN (SELECT DISTINCT CAMPAIGN_NAME AS slot FROM dy.stg_events WHERE CONTEXT_TYPE = 'PRODUCT'
              AND ENGAGEMENT_TYPE = 'STRATEGY_IMPRESSION') s)
GROUP BY ALL;`,
  render(el) {
    const bySlot = {};
    for (const o of rowsOf("cov")) {
      const sl = name("slot", o.slot), sku = name("sku", o.sku), s = bySlot[sl] || (bySlot[sl] = { views: {}, served: {} });
      s.views[sku] = (s.views[sku] || 0) + o.views; s.served[sku] = (s.served[sku] || 0) + o.served;
    }
    const catalogN = Object.keys(CAT).length;
    const cr = Object.entries(bySlot).map(([slot, s]) => {
      const viewed = Object.keys(s.views), covered = viewed.filter(k => s.served[k] > 0);
      const views = viewed.reduce((t, k) => t + s.views[k], 0), vc = covered.reduce((t, k) => t + s.views[k], 0);
      return { key: slot, viewed: viewed.length, covered: covered.length, cov: covered.length / viewed.length, vcov: vc / views, ccov: covered.length / catalogN };
    });
    const slot = wv("cov_slot", Object.keys(bySlot).sort()[0]);
    el.innerHTML = box(CHART() + TABLE() + `<h4 class="w-h">Most viewed products without recommendations: ${esc(slot)}</h4>` + TABLE("wt2", "tall"),
      sel("cov_slot", Object.keys(bySlot).sort().map(s => [s, s]), slot, "Slot for the gap list"));
    chart("wc", { type: "bar", data: { labels: cr.map(c => c.key), datasets: [
      { label: "% of viewed SKUs with recommendations", data: cr.map(c => c.cov * 100), backgroundColor: "#1a9e5c" },
      { label: "% of PDP views covered", data: cr.map(c => c.vcov * 100), backgroundColor: "#2f86c9" }] },
      options: { scales: { y: { min: 0, max: 100, ticks: { callback: v => v + "%" } } } } });
    renderTable("wt", [{ k: "key", label: "PDP slot", cls: "t" }, { k: "viewed", label: "SKUs viewed", fmt: fmt.int }, { k: "covered", label: "SKUs with recos", fmt: fmt.int },
      { k: "cov", label: "Coverage (SKUs)", fmt: fmt.pct1, bar: true }, { k: "vcov", label: "Coverage (PDP views)", fmt: fmt.pct1 }, { k: "ccov", label: "Catalog coverage", fmt: fmt.pct1 }], cr, { sort: { k: "cov", desc: true } });
    const s = bySlot[slot] || { views: {}, served: {} };
    renderTable("wt2", prodCols([{ k: "views", label: "PDP views", fmt: fmt.int, bar: true }]), Object.keys(s.views).filter(k => !s.served[k]).map(k => enrich({ views: s.views[k] }, k)), { sort: { k: "views", desc: true }, limit: 50 });
  },
});

def("alerts", {
  title: "Scheduled reports and alerts",
  uses: [DATE, DIMC.slot, VE, IMPCLK.slot, SKU, ...PUR, ...SESSION],
  sql: `-- Daily alert at 07:00: slot CTR or revenue drops week over week
WITH w AS (
  SELECT slot,
         SUM(IF(SECTION_DATE >= CURRENT_DATE() - 7,  clk, 0)) AS clk_cur,
         SUM(IF(SECTION_DATE >= CURRENT_DATE() - 7,  imp, 0)) AS imp_cur,
         SUM(IF(SECTION_DATE <  CURRENT_DATE() - 7,  clk, 0)) AS clk_prev,
         SUM(IF(SECTION_DATE <  CURRENT_DATE() - 7,  imp, 0)) AS imp_prev,
         SUM(IF(SECTION_DATE >= CURRENT_DATE() - 7,  rev, 0)) AS rev_cur,
         SUM(IF(SECTION_DATE <  CURRENT_DATE() - 7,  rev, 0)) AS rev_prev
  FROM dy.rpt_reco_tot
  WHERE SECTION_DATE >= CURRENT_DATE() - 14
  GROUP BY slot)
SELECT * FROM w
WHERE SAFE_DIVIDE(clk_cur, imp_cur) < 0.85 * SAFE_DIVIDE(clk_prev, imp_prev)
   OR rev_cur < 0.80 * rev_prev;`,
  render(el) {
    const ctrT = +wv("al_ctr", "15") / 100, revT = +wv("al_rev", "20") / 100;
    const rows = withCmp(agg("slot", [addDays(END, -6), END]), "slot", {}, [addDays(END, -13), addDays(END, -7)]);
    rows.forEach(r => {
      r.d_ctr = r.prev ? delta(r.ctr, r.prev.ctr) : null; r.d_rev = r.prev ? delta(r.rev, r.prev.rev) : null;
      r.alert = (r.d_ctr != null && r.d_ctr < -ctrT) || (r.d_rev != null && r.d_rev < -revT);
    });
    const n = rows.filter(r => r.alert).length;
    el.innerHTML = box(`<div class="alert-mail"><b>📧 Daily 07:00 · "Reco alerts" → ${esc(P.contact_email)}</b><br>
      ${n ? `🔔 ${n} slot${n > 1 ? "s" : ""} triggered an alert (last 7 days vs the 7 days before).` : "✓ No alerts today."}</div>` + TABLE(),
      sel("al_ctr", [["10", "10%"], ["15", "15%"], ["20", "20%"]], "15", "Alert if CTR drops >") + sel("al_rev", [["10", "10%"], ["20", "20%"], ["30", "30%"]], "20", "or revenue drops >"));
    renderTable("wt", [{ k: "alert", label: "", noCsv: true, html: r => r.alert ? "🔔" : '<span class="flat">✓</span>' }, K("slot"), C.ctr, D_("d_ctr", "CTR WoW"), C.rev, D_("d_rev", "Revenue WoW")], rows, { sort: { k: "d_rev", desc: false } });
  },
  note: "Scheduling and alerts are configured in the BI tool on the DAS models. Check the current DY UI scheduling options too.",
});

def("gap", (dim, r) => ({
  title: "Not possible with the Daily Activity Stream",
  uses: [],
  sql: "-- No DAS column can answer this requirement.",
  render(el) {
    const opts = r.options || [];
    el.innerHTML = `<div class="gap"><h4>○ Not possible with the Daily Activity Stream</h4>
      ${opts.length ? `<p><b>Options:</b></p><ul>${opts.map(o => `<li>${esc(o)}</li>`).join("")}</ul>` : `<p class="note">See the talking point above.</p>`}</div>`;
  },
}));

// ---------- one widget spec per requirement ----------
const SPEC = {};
for (const r of REQS) {
  const sp = (CAP[r.capability] || CAP.gap)(r.dim || "slot", r);
  if (r.title) sp.title = r.title;
  if (r.note) sp.note = r.note;
  SPEC[r.id] = sp;
}

// ---------- product helpers ----------
function thumb(src, label = "", cat = "") {
  if (src) return `<img loading="lazy" src="${esc(src)}" alt="">`;
  const ini = String(label).replace(new RegExp("^" + P.name + "\\s+", "i"), "").split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
  return `<span class="thumb" style="background:${colorOf("cat:" + cat)}">${esc(ini)}</span>`;
}
function enrich(r, sku) { const c = CAT[sku] || []; r.sku = sku; r.pname = c[0] || sku; r.cat = c[1]; r.price = c[5]; r.img = c[7]; return r; }
const prodCols = (extra = []) => [
  { k: "img", label: "", noCsv: true, noTotal: true, html: r => thumb(r.img, r.pname, r.cat) },
  { k: "sku", label: "SKU", cls: "t" }, { k: "pname", label: "Product", cls: "t wrap" }, { k: "cat", label: "Category", cls: "t" }, ...extra];

// dedupe uses + compute column→requirement edges
for (const id of ORDER) {
  const sp = SPEC[id]; if (!sp) continue;
  const seen = new Set(); sp.uses = sp.uses.filter(([k]) => !seen.has(k) && seen.add(k)); sp.cols = sp.uses.map(u => u[0]);
}
const USED = new Set(ORDER.flatMap(id => SPEC[id]?.cols || []));

// =====================================================================================
// LINEAGE (left + middle)
// =====================================================================================
function renderLineage() {
  const groups = Object.keys(SOURCES).map(src => `
    <div class="lin-group"><div class="lin-gh">${srcBadge(src)}<small>${esc(SOURCES[src].desc)}</small></div>
      ${COLUMNS.filter(c => c.src === src && USED.has(c.key)).map(c => `<div class="lin-item lin-col" data-n="c:${c.key}" title="${esc(c.desc)}"><code>${esc(c.col)}</code><small>${esc(c.desc)}</small></div>`).join("")}
    </div>`).join("");
  const reqs = ORDER.map(id => {
    const r = REQ[id], n = SPEC[id]?.cols.length || 0;
    return `<div class="lin-item lin-r ${n ? "" : "orphan"}" data-n="r:${id}"><span class="lin-req ${r.das}">${ICON[r.das]} ${id}</span><span class="pri ${r.pri}">${r.pri}</span><span class="rt">${esc(r.req)}</span><small>${n ? n + " cols" : "no DAS source"}</small></div>`;
  }).join("");
  $("lineage").innerHTML = `
    <div class="lin-c"><h4>DAS data <small>columns</small></h4>${groups}</div>
    <div class="lin-c"><h4>${esc(P.name)} requirement <small>● full ◐ partial ○ no (with DAS)</small></h4>${reqs}</div>
    <svg class="lin-svg"></svg>`;
  $("lineage").querySelectorAll(".lin-item").forEach(it => {
    it.onmouseenter = () => { S.hover = it.dataset.n; paint(); };
    it.onmouseleave = () => { S.hover = null; paint(); };
    it.onclick = () => {
      const [t, id] = [it.dataset.n.slice(0, 1), it.dataset.n.slice(2)];
      if (t === "r") select(id);
      else { S.colSel = S.colSel === id ? null : id; paint(); }
    };
  });
  const must = REQS.filter(r => r.pri === "MUST"), should = REQS.filter(r => r.pri === "SHOULD");
  const cnt = (a, s) => a.filter(r => r.das === s).length;
  const pill = (l, a) => a.length ? `<span class="pill">${l}: <b class="yes">${cnt(a, "yes")} ●</b> <b class="partial">${cnt(a, "partial")} ◐</b> <b class="no">${cnt(a, "no")} ○</b></span>` : "";
  $("req-summary").innerHTML = pill("MUST", must) + pill("SHOULD", should) + pill("COULD", REQS.filter(r => r.pri === "COULD"));
  paint();
}

function related(n) {
  const [t, id] = [n.slice(0, 1), n.slice(2)], nodes = new Set([n]), edges = [];
  if (t === "r") (SPEC[id]?.cols || []).forEach(c => { nodes.add("c:" + c); edges.push(["c:" + c, n]); });
  else ORDER.filter(r => SPEC[r]?.cols.includes(id)).forEach(r => { nodes.add("r:" + r); edges.push([n, "r:" + r]); });
  return { nodes, edges };
}

function paint() {
  const box = $("lineage"); if (!box) return;
  const focus = S.hover || (S.colSel ? "c:" + S.colSel : S.sel ? "r:" + S.sel : null);
  const rel = focus ? related(focus) : null;
  box.querySelectorAll(".lin-item").forEach(it => {
    it.classList.toggle("dim", !!rel && !rel.nodes.has(it.dataset.n));
    it.classList.toggle("hi", !!rel && rel.nodes.has(it.dataset.n));
    it.classList.toggle("sel", it.dataset.n === "r:" + S.sel || it.dataset.n === "c:" + S.colSel);
  });
  const svg = box.querySelector(".lin-svg"), b = box.getBoundingClientRect();
  svg.setAttribute("width", b.width); svg.setAttribute("height", b.height);
  const pos = {};
  box.querySelectorAll(".lin-item").forEach(it => { const r = it.getBoundingClientRect(); pos[it.dataset.n] = { l: r.left - b.left, r: r.right - b.left, y: r.top - b.top + r.height / 2 }; });
  const path = ([a, z], cls) => {
    const p = pos[a], q = pos[z]; if (!p || !q) return "";
    const x1 = p.r, x2 = q.l, dx = (x2 - x1) / 2;
    return `<path class="${cls}" d="M${x1},${p.y} C${x1 + dx},${p.y} ${x2 - dx},${q.y} ${x2},${q.y}"/>`;
  };
  const all = ORDER.flatMap(r => (SPEC[r]?.cols || []).map(c => ["c:" + c, "r:" + r]));
  svg.innerHTML = rel ? rel.edges.map(e => path(e, "on")).join("") : all.map(e => path(e, "")).join("");
}

// =====================================================================================
// PANEL (right)
// =====================================================================================
const srcIcon = v => `<span class="${v}">${ICON[v]}</span>`;
function select(id) {
  S.sel = id; S.colSel = null; paint(); renderPanel();
  const it = document.querySelector(`.lin-item[data-n="r:${id}"]`);
  const r = it?.getBoundingClientRect();
  if (r && (r.top < 0 || r.bottom > innerHeight)) it.scrollIntoView({ block: "center" });
}
function step(d) {
  const i = S.sel ? ORDER.indexOf(S.sel) : -1;
  const j = Math.min(ORDER.length - 1, Math.max(0, i + d));
  select(ORDER[j]);
}

function renderPanel() {
  destroyCharts();
  const p = $("panel");
  if (!S.sel) {
    p.innerHTML = `<div class="intro">
      <h2>Walk through the requirements</h2>
      <p>Each ${esc(P.name)} requirement on the left is linked to the <b>DAS columns</b> it needs. Select a requirement to see:</p>
      <ol><li>the columns and the filter / logic that are used,</li><li>a widget, built on the DAS data, that answers the requirement,</li><li>the BigQuery SQL behind it.</li></ol>
      <button id="start">Start with ${esc(ORDER[0])} ›</button>
      <p class="note">Tip: use the ↑ ↓ keys to go to the next or previous requirement.</p></div>`;
    $("start").onclick = () => select(ORDER[0]);
    return;
  }
  const r = REQ[S.sel], sp = SPEC[S.sel], i = ORDER.indexOf(S.sel);
  p.innerHTML = `
    <div class="p-nav">
      <button class="ghost" id="p-prev" ${i ? "" : "disabled"}>‹ ${i ? ORDER[i - 1] : ""}</button>
      <span class="flat">${i + 1} / ${ORDER.length}</span>
      <button class="ghost" id="p-next" ${i < ORDER.length - 1 ? "" : "disabled"}>${i < ORDER.length - 1 ? ORDER[i + 1] : ""} ›</button>
    </div>
    <div class="p-h"><span class="lin-req big ${r.das}">${ICON[r.das]} ${r.id}</span><span class="pri ${r.pri}">${r.pri}</span><h2>${esc(r.req)}</h2></div>
    <div class="p-src">Recs Report ${srcIcon(r.rr)} · Experience Report ${srcIcon(r.er)} · <b>DAS + BI ${srcIcon(r.das)}</b></div>
    <p class="p-how">${esc(r.how)}</p>
    ${sp.note ? `<p class="warn">⚠ ${esc(sp.note)}</p>` : ""}
    <div class="p-sec"><h4>1 · DAS data used</h4>
      ${sp.uses.length ? `<table class="uses"><tbody>
      ${sp.uses.map(([k, how]) => `<tr data-col="${k}"><td><code class="${SOURCES[COL[k].src].cls}" title="${SOURCES[COL[k].src].label}">${esc(COL[k].col)}</code></td><td>${esc(how)}</td></tr>`).join("")}</tbody></table>`
      : `<p class="note">No DAS column can answer this requirement.</p>`}</div>
    <div class="p-sec"><div class="p-sec-h"><h4>2 · Widget: ${esc(sp.title)}</h4>
      <div class="ctrl"><label>Period <select id="p-days"><option value="7">Last 7 days</option><option value="28">Last 28 days</option><option value="${D.meta.weeks * 7}">Last ${D.meta.weeks} weeks</option></select></label>
      <label>Compare <select id="p-cmp"><option value="prev">Previous period</option><option value="yoy">Last year</option></select></label></div></div>
      <div class="p-widget" id="p-widget"></div></div>
    <details class="lin-sql p-sec"><summary>3 · BigQuery SQL</summary><pre><code>${esc(sp.sql.replace(/\bdy\./g, DS + "."))}</code></pre></details>`;
  $("p-prev").onclick = () => step(-1);
  $("p-next").onclick = () => step(1);
  $("p-days").value = S.days; $("p-cmp").value = S.compare;
  $("p-days").onchange = e => { S.days = +e.target.value; renderWidget(); };
  $("p-cmp").onchange = e => { S.compare = e.target.value; renderWidget(); };
  p.querySelectorAll("tr[data-col]").forEach(tr => {
    tr.onmouseenter = () => { S.hover = "c:" + tr.dataset.col; paint(); };
    tr.onmouseleave = () => { S.hover = null; paint(); };
  });
  renderWidget();
  p.scrollTop = 0;
}

function renderWidget() {
  destroyCharts();
  const el = $("p-widget");
  SPEC[S.sel].render(el);
  el.querySelectorAll("select[data-w]").forEach(s => s.onchange = () => { S.w[s.dataset.w] = s.value; renderWidget(); });
  el.querySelectorAll("button[data-csv]").forEach(b => b.onclick = () => exportCsv(b.dataset.csv, S.sel));
}

// ---------- boot ----------
function brand() {
  const root = document.documentElement.style;
  root.setProperty("--brand", P.brand.primary); root.setProperty("--accent", P.brand.accent);
  document.title = `${P.name} · Recommendation measurement with the DY Daily Activity Stream`;
  $("logo").innerHTML = P.logo_html; $("title").textContent = P.title;
  $("footer").innerHTML = `Synthetic data generated from the DAS schema and ${P.feed_synthetic ? "a synthetic" : "the " + esc(P.name)} product feed. Not real ${esc(P.name)} performance.`;
}
brand();
document.addEventListener("keydown", e => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); step(1); }
  if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
});
window.addEventListener("resize", paint);
$("meta").textContent = `${D.meta.raw_rows.toLocaleString("en-GB")} raw + ${D.meta.attribution_rows.toLocaleString("en-GB")} attribution rows · ${CUR_START} → ${END} + same weeks last year`;
renderLineage();
renderPanel();
window.DEMO = { select, SPEC, ORDER };
})();
