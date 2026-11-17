"""
Generate a synthetic Dynamic Yield Daily Activity Stream (DAS) export for a prospect (config-driven).

Mirrors the documented DAS layout:
  reportType=raw          -> one row per UIA (pageview) / DPX (custom event) / VARIATION_ENGAGEMENT event
  reportType=attribution  -> one row per (DPX conversion event, attributed variation)

Two windows are generated so time-over-time works:
  current period : N weeks ending period.end
  last year      : the same weeks shifted by 364 days (weekday aligned) for YoY
Note: DY only retains DAS files for 30 days in S3 -> history/YoY requires the customer to persist
the daily files in their own warehouse (e.g. BigQuery).
"""
import hashlib
import json
import random
from datetime import date, datetime, timedelta, timezone

import pandas as pd

UA = {"Smartphone": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Desktop": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
      "Tablet": "Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36"}
DEVICE_META = {"Smartphone": ("iOS", "Safari", "Low (1024px and below)"),
               "Desktop": ("Windows", "Chrome", "High (1440px and above)"),
               "Tablet": ("Android", "Chrome", "Medium (1025px - 1439px)")}
AUD_NEW, AUD_RET = (1000001, "New Visitors"), (1000002, "Returning Visitors")
AUD_DEV = {"Smartphone": (1000003, "Mobile Users"), "Desktop": (1000004, "Desktop Users"), "Tablet": (1000005, "Tablet Users")}
DEVICE_CTR = {"Smartphone": 0.9, "Desktop": 1.25, "Tablet": 1.0}
VIEWABILITY = {"HOMEPAGE": 0.78, "CATEGORY": 0.55, "PRODUCT": 0.62, "CART": 0.85}
EV_PURCHASE, EV_ATC = 27000001, 27000002

COLS = ["EVENT_TYPE", "TIMESTAMP", "REQ_TIMESTAMP", "PROC_TIMESTAMP", "SECTION_ID", "SECTION_DATE", "DY_ID",
        "SESSION_ID", "AUDIENCES", "AUDIENCES_NAMES", "EVENT_ID", "EVENT_NAME", "EVENT_VALUE", "EVENT_PROPERTIES",
        "BROWSER", "CONTEXT_DATA", "CONTEXT_TYPE", "DEVICE", "OPERATING_SYSTEM", "PRODUCT_IDS",
        "SCREEN_RESOLUTION", "TRAFFIC_SOURCE", "REFERRING_DOMAIN", "URL", "URL_CLEAN", "USER_AGENT",
        "CAMPAIGN_ID", "CAMPAIGN_NAME", "PARENT_CAMPAIGN_ID", "PARENT_CAMPAIGN_NAME", "ENGAGEMENT_TYPE",
        "EXPERIENCE_ID", "EXPERIENCE_NAME", "EXPERIMENT_ID", "EXPERIMENT_VERSION_ID", "VARIATION_IDS",
        "ATTRIBUTION_VARIATION_IDS", "VARIATION_NAMES", "SKUS", "STRATEGY_ID", "STRATEGY_NAME", "INTERACTION_ID"]


def run(cfg, feed, out_dir):
    per = cfg["period"]
    random.seed(per["seed"])
    END = date.fromisoformat(per["end"])
    WEEKS, SESSIONS_PER_DAY = int(per["weeks"]), int(per["sessions_per_day"])
    CUR = cfg["currency"]["code"]

    P = {r.sku: r for r in feed.itertuples()}
    SKUS = list(P)
    by_leaf = feed.groupby("leaf_category")["sku"].apply(list).to_dict()
    by_top = feed.groupby("top_category")["sku"].apply(list).to_dict()
    TOPS = list(by_top)
    pop_weight = {s: random.paretovariate(1.3) for s in SKUS}  # long-tail popularity
    margin = {s: (m if m == m else random.uniform(0.05, 0.5)) for s, m in zip(feed.sku, feed.margin)}
    instock = dict(zip(feed.sku, feed.in_stock))

    def feed_algo(col):
        if col not in feed.columns:
            raise SystemExit(f"feed has no column '{col}' (used by a strategy feed_column param)")
        return {s: [x for x in str(v).split("|") if x in P] for s, v in zip(feed.sku, feed[col])}

    def stable_sample(pool, k, key):
        r = random.Random(int(hashlib.md5(key.encode()).hexdigest()[:8], 16))
        return r.sample(pool, min(k, len(pool)))

    SITES = [(s["section_id"], s["domain"], s["country"], s["locale"], s["path"], s["share"]) for s in cfg["sites"]]
    DEVICES = [(d, sh, *DEVICE_META.get(d, DEVICE_META["Desktop"])) for d, sh in cfg["devices"]]
    TRAFFIC = [tuple(t) for t in cfg["traffic_sources"]]
    # (campaignId, campaignName, page, experienceId, experienceName, experimentId, versionId, [variations])
    SLOTS = [(s["id"], s["name"], s["page"], s["experience_id"], s["audience"], s["experiment_id"], s["version_id"],
              [(v["id"], v["name"], v["strategy_id"], v["strategy"], v["weight"], v["ctr"], v["type"], v["params"])
               for v in s["variations"]]) for s in cfg["slots"]]
    cache = {}

    def strategy_results(v, ctx_sku, ctx_cat, history):
        """Returns recommended SKUs or [] (-> no STRATEGY_IMPRESSION, i.e. coverage gap)."""
        typ, prm, name = v[6], v[7], v[3]
        if typ == "affinity":
            cats = [P[s].top_category for s in history[-5:]] or random.sample(TOPS, min(2, len(TOPS)))
            pool = list({s for c in cats for s in by_top[c]})
            return random.sample(pool, min(8, len(pool)))
        if typ == "popular":
            return random.choices(SKUS, weights=[pop_weight[s] for s in SKUS], k=8)
        if typ == "recently_viewed":
            return list(dict.fromkeys(reversed(history)))[:8]
        if typ == "popular_in_category":
            return sorted(by_top.get(ctx_cat, []), key=lambda s: -pop_weight[s])[:8]
        if ctx_sku is None:
            return []
        key = (name, ctx_sku)
        if key in cache:
            return cache[key]
        r = P[ctx_sku]
        if prm.get("categories") and r.top_category not in prm["categories"]:
            res = []  # strategy only configured for some categories -> coverage gap elsewhere
        elif typ == "similar":
            pool = [s for s in by_leaf.get(r.leaf_category, []) if s != ctx_sku]
            if len(pool) < 3:
                pool = [s for s in by_top[r.top_category] if s != ctx_sku]
            if prm.get("rule") == "margin_instock":
                pool = sorted([s for s in pool if instock[s]], key=lambda s: -margin[s]) or pool
            res = pool[:8]
        elif typ == "complementary":
            if prm.get("feed_column"):
                res = cache.setdefault(("_algo", prm["feed_column"]), feed_algo(prm["feed_column"]))[ctx_sku][:6]
            else:
                pool = [s for s in by_top[r.top_category] if P[s].leaf_category != r.leaf_category]
                res = stable_sample(sorted(pool, key=lambda s: -pop_weight[s])[:24], 6, ctx_sku + name)
        elif typ == "budget_alternative":
            if r.price < float(prm.get("min_price", 40)):
                res = []
            elif prm.get("feed_column"):
                algo = cache.setdefault(("_algo", prm["feed_column"]), feed_algo(prm["feed_column"]))
                res = [s for s in algo[ctx_sku] if P[s].price < r.price][:6]
            else:
                res = sorted([s for s in by_leaf.get(r.leaf_category, []) if P[s].price < r.price * 0.85],
                             key=lambda s: -pop_weight[s])[:6]
        elif typ == "bought_together":
            if prm.get("feed_column"):
                res = cache.setdefault(("_algo", prm["feed_column"]), feed_algo(prm["feed_column"]))[ctx_sku][:6]
            else:
                pool = [s for s in SKUS if P[s].leaf_category != r.leaf_category and P[s].price < max(r.price, 30)]
                res = stable_sample(sorted(pool, key=lambda s: -pop_weight[s])[:40], 6, ctx_sku + name)
        else:
            res = []
        cache[key] = res
        return res

    rows, attr_rows = [], []
    iid = [100000000]
    users = {s[2] + s[3]: [] for s in SITES}  # returning-user pool per site/locale
    PAGE_SLOTS = {pg: [s for s in SLOTS if s[2] == pg] for pg in ("HOMEPAGE", "CATEGORY", "PRODUCT", "CART")}

    def pick(options, wkey=1):
        return random.choices(options, weights=[o[wkey] for o in options])[0]

    def nid():
        iid[0] += random.randint(1, 9)
        return str(iid[0])

    def simulate_session(day):
        sec, domain, country, locale, prefix, _ = pick(SITES, 5)
        dev, _, os_, browser, res = pick(DEVICES)
        traffic, _, ref = pick(TRAFFIC)
        pool = users[country + locale]
        returning = bool(pool) and random.random() < 0.42
        if returning:
            user = random.choice(pool)
        else:
            user = {"dyid": str(-random.randint(10**17, 9 * 10**17)), "history": []}
            pool.append(user)
            if len(pool) > 4000:
                pool.pop(0)
        aud = [AUD_RET if returning else AUD_NEW, AUD_DEV.get(dev, AUD_DEV["Desktop"])]
        sess = str(random.randint(10**9, 9 * 10**9))
        ts = datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + timedelta(
            seconds=random.randint(6 * 3600, 22 * 3600))
        variant = {s[0]: random.choices(s[7], weights=[v[4] for v in s[7]])[0] for s in SLOTS}  # sticky allocation
        base = f"https://{domain}{prefix}"
        common = dict(SECTION_ID=sec, SECTION_DATE=day.isoformat(), DY_ID=user["dyid"], SESSION_ID=sess,
                      AUDIENCES=json.dumps([a[0] for a in aud]), AUDIENCES_NAMES=json.dumps([a[1] for a in aud]),
                      BROWSER=browser, DEVICE=dev, OPERATING_SYSTEM=os_, SCREEN_RESOLUTION=res,
                      TRAFFIC_SOURCE=traffic, REFERRING_DOMAIN=ref, USER_AGENT=UA.get(dev, UA["Desktop"]))
        cart, engaged = [], set()
        state = {"t": ts}

        def emit(**kw):
            state["t"] += timedelta(seconds=random.randint(2, 40))
            ms = int(state["t"].timestamp() * 1000)
            r = dict(common, TIMESTAMP=ms + random.randint(0, 2500), REQ_TIMESTAMP=ms,
                     PROC_TIMESTAMP=ms + random.randint(2500, 4000), INTERACTION_ID=nid(), **kw)
            rows.append(r)
            return r

        def pageview(ctype, ctx, url):
            emit(EVENT_TYPE="UIA", CONTEXT_TYPE=ctype, CONTEXT_DATA=json.dumps(ctx),
                 URL=url + f"?utm_source={traffic.lower().replace(' ', '_')}", URL_CLEAN=url)

        def serve(page, ctx_sku, ctx_cat, ctx, url):
            """Serve all slots of a page; return the clicked (slot, variation, sku) or None."""
            clicked = None
            for s in PAGE_SLOTS[page]:
                v = variant[s[0]]
                recs = strategy_results(v, ctx_sku, ctx_cat, user["history"])
                if not recs or random.random() > VIEWABILITY[page]:
                    continue
                camp = dict(CAMPAIGN_ID=s[0], CAMPAIGN_NAME=s[1], EXPERIENCE_ID=s[3], EXPERIENCE_NAME=s[4],
                            EXPERIMENT_ID=s[5], EXPERIMENT_VERSION_ID=s[6], VARIATION_IDS=json.dumps([v[0]]),
                            ATTRIBUTION_VARIATION_IDS=json.dumps([v[0]]), VARIATION_NAMES=json.dumps([v[1]]),
                            CONTEXT_TYPE=page, CONTEXT_DATA=json.dumps(ctx), URL=url, URL_CLEAN=url)
                emit(EVENT_TYPE="VARIATION_ENGAGEMENT", ENGAGEMENT_TYPE="IMPRESSION", **camp)
                emit(EVENT_TYPE="VARIATION_ENGAGEMENT", ENGAGEMENT_TYPE="STRATEGY_IMPRESSION",
                     STRATEGY_ID=v[2], STRATEGY_NAME=v[3], **camp)
                engaged.add((s[5], s[6], v[0]))
                ctr = v[5] * DEVICE_CTR.get(dev, 1.0) * (1.15 if returning else 1.0)
                if clicked is None and random.random() < ctr:
                    sku = random.choices(recs, weights=[1 / (i + 1) for i in range(len(recs))])[0]
                    emit(EVENT_TYPE="VARIATION_ENGAGEMENT", ENGAGEMENT_TYPE="CLICK", SKUS=json.dumps([sku]),
                         STRATEGY_ID=v[2], STRATEGY_NAME=v[3], **camp)
                    clicked = (s, v, sku)
            return clicked

        def pdp(sku, from_reco):
            r = P[sku]
            url = f"{base}/e/{sku}.html"
            pageview("PRODUCT", [sku], url)
            user["history"].append(sku)
            c = serve("PRODUCT", sku, r.top_category, [sku], url)
            p_atc = 0.085 * (1.35 if from_reco else 1.0) * (0.8 if r.price > 150 else 1.0)
            if random.random() < p_atc:
                qty = random.choices([1, 2, 3], weights=[85, 11, 4])[0]
                cart.append((sku, qty, float(r.price)))
                val = round(r.price * qty, 2)
                emit(EVENT_TYPE="DPX", EVENT_ID=EV_ATC, EVENT_NAME="Add to Cart", EVENT_VALUE=val,
                     EVENT_PROPERTIES=json.dumps({"dyType": "add-to-cart-v1", "value": val, "currency": CUR,
                                                  "productId": sku, "quantity": qty}),
                     PRODUCT_IDS=json.dumps([sku]), CONTEXT_TYPE="PRODUCT", CONTEXT_DATA=json.dumps([sku]),
                     URL=url, URL_CLEAN=url)
            return c

        entry = random.choices(["HOMEPAGE", "CATEGORY", "PRODUCT"], weights=[32, 26, 42])[0]
        pending = None
        for step in range(random.choice([1, 2, 3, 3, 4, 5, 6, 7, 9])):
            if pending and random.random() < 0.93:  # click -> PDP view of the clicked product
                pending = pdp(pending[2], True)
                continue
            pending = None
            page = entry if step == 0 else random.choices(["HOMEPAGE", "CATEGORY", "PRODUCT"], weights=[8, 30, 62])[0]
            if page == "HOMEPAGE":
                url = f"{base}/"
                pageview("HOMEPAGE", [], url)
                pending = serve("HOMEPAGE", None, None, [], url)
            elif page == "CATEGORY":
                cat = random.choice([P[s].top_category for s in user["history"][-3:]] or TOPS)
                url = f"{base}/g/{cat.lower().replace(' & ', '-').replace(' ', '-')}"
                pageview("CATEGORY", [cat], url)
                pending = serve("CATEGORY", None, cat, [cat], url)
            else:
                pool = by_top[P[user["history"][-1]].top_category] if user["history"] and random.random() < 0.5 else SKUS
                pending = pdp(random.choices(pool, weights=[pop_weight[s] for s in pool])[0], False)

        if cart:
            url = f"{base}/cart"
            pageview("CART", [s for s, _, _ in cart], url)
            c = serve("CART", cart[-1][0], None, [s for s, _, _ in cart], url)
            if c and random.random() < 0.9:
                pdp(c[2], True)
            if random.random() < 0.46:
                total = round(sum(q * p for _, q, p in cart), 2)
                tx = nid()
                r = emit(EVENT_TYPE="DPX", EVENT_ID=EV_PURCHASE, EVENT_NAME="Purchase", EVENT_VALUE=total,
                         EVENT_PROPERTIES=json.dumps({"value": total, "currency": CUR, "uniqueTransactionId": tx,
                                                      "dyType": "purchase-v1",
                                                      "cart": [{"productId": s, "quantity": q, "itemPrice": p}
                                                               for s, q, p in cart]}),
                         PRODUCT_IDS=json.dumps([s for s, _, _ in cart]), CONTEXT_TYPE="OTHER", CONTEXT_DATA="[]",
                         URL=f"{base}/checkout/thank-you", URL_CLEAN=f"{base}/checkout/thank-you")
                for exp, ver, var in engaged:
                    attr_rows.append(dict(SECTION_ID=sec, INTERACTION_ID=r["INTERACTION_ID"], SECTION_DATE=day.isoformat(),
                                          EVENT_TYPE="DPX", DY_ID=user["dyid"], EXPERIMENT_ID=exp,
                                          EXPERIMENT_VERSION_ID=ver, REPORT_VERSION_ID=ver, VARIATIONS=json.dumps([var]),
                                          EVENT_ID=EV_PURCHASE, EVENT_VALUE=int(round(total * 100))))

    days = 7 * WEEKS
    cur_start = END - timedelta(days=days - 1)
    for start, factor in [(cur_start, 1.0), (cur_start - timedelta(days=364), float(per["last_year_factor"]))]:
        for d in range(days):
            day = start + timedelta(days=d)
            weekday_factor = [1.0, 0.96, 0.95, 0.97, 0.93, 0.88, 1.12][day.weekday()]
            trend = 1 + float(per["growth_in_period"]) * d / days
            for _ in range(int(SESSIONS_PER_DAY * factor * weekday_factor * trend * random.uniform(0.92, 1.08))):
                simulate_session(day)

    raw = pd.DataFrame(rows).reindex(columns=COLS).sort_values(["SECTION_DATE", "REQ_TIMESTAMP"])
    for c in ["EVENT_ID", "CAMPAIGN_ID", "PARENT_CAMPAIGN_ID", "EXPERIENCE_ID", "EXPERIMENT_ID",
              "EXPERIMENT_VERSION_ID", "STRATEGY_ID"]:
        raw[c] = raw[c].astype("Int64")
    raw["PARENT_CAMPAIGN_NAME"] = raw["PARENT_CAMPAIGN_NAME"].astype("string")
    attr = pd.DataFrame(attr_rows)
    out_dir.mkdir(parents=True, exist_ok=True)
    raw.to_parquet(out_dir / "das_raw.parquet", index=False)
    attr.to_parquet(out_dir / "das_attribution.parquet", index=False)
    # Human-readable 1-day samples, same shape as the DY sample files
    raw[raw.SECTION_DATE == END.isoformat()].head(3000).to_csv(out_dir / f"sample_raw_{END}.csv", index=False)
    attr[attr.SECTION_DATE == END.isoformat()].head(500).to_csv(out_dir / f"sample_attribution_{END}.csv", index=False)
    print(f"  raw rows: {len(raw):,}  attribution rows: {len(attr):,}")
