"""
Transform the DAS export into BI-ready aggregate tables (what you'd build as BigQuery views/tables)
and return the payload for the demo dashboard (dist/data.js).

The same logic is expressed in SQL in engine/sql/bigquery_models.sql.tmpl.

Attribution logic (product level):
  reco CLICK on SKU X (slot/strategy)  ->  later in the session a PRODUCT pageview of X
  ->  Add to Cart with productId X  ->  Purchase whose cart contains X
  Revenue credited = quantity * itemPrice of X (last reco click on X wins).
Add-on revenue = the above, restricted to clicks made on a PDP slot; it's compared with the
revenue of the anchor product (the PDP the click came from) in the same order.
"""
import json

import numpy as np
import pandas as pd


def run(cfg, feed, data_dir):
    raw = pd.read_parquet(data_dir / "das_raw.parquet")
    attr = pd.read_parquet(data_dir / "das_attribution.parquet")

    raw["SKEY"] = raw.DY_ID + ":" + raw.SESSION_ID
    raw["date"] = raw.SECTION_DATE
    raw["country"], raw["locale"] = None, None
    for s in sorted(cfg["sites"], key=lambda s: -len(s["domain"] + s["path"])):  # longest prefix wins
        m = raw.country.isna() & raw.URL_CLEAN.str.startswith(f"https://{s['domain']}{s['path']}/", na=False)
        raw.loc[m, "country"], raw.loc[m, "locale"] = s["country"], s["locale"]
    raw["country"] = raw.country.fillna("(unknown)")
    raw["locale"] = raw.locale.fillna("(unknown)")
    raw["segment"] = raw.AUDIENCES_NAMES.str.contains("Returning").map({True: "Returning", False: "New"})
    raw["ctx_first"] = raw.CONTEXT_DATA.str.extract(r'^\["([^"]+)"')[0]
    top_cat = dict(zip(feed.sku, feed.top_category))

    SDIMS = ["date", "country", "locale", "DEVICE", "segment", "TRAFFIC_SOURCE"]
    sess = raw.groupby("SKEY")[SDIMS].first()

    ve = raw[raw.EVENT_TYPE == "VARIATION_ENGAGEMENT"].copy()
    ve["slot"] = ve.CAMPAIGN_NAME
    ve["variation"] = ve.VARIATION_NAMES.str.extract(r'\["(.+)"\]')[0]
    ve["page_category"] = ve.ctx_first.map(top_cat)
    ve.loc[ve.CONTEXT_TYPE == "CATEGORY", "page_category"] = ve.ctx_first
    ve.loc[ve.CONTEXT_TYPE == "HOMEPAGE", "page_category"] = "(homepage)"
    ve.loc[ve.CONTEXT_TYPE == "CART", "page_category"] = "(cart)"
    var_strategy = ve[ve.ENGAGEMENT_TYPE == "STRATEGY_IMPRESSION"].groupby("variation").STRATEGY_NAME.first().to_dict()
    ve["strategy"] = ve.variation.map(var_strategy)
    FDIMS = ["date", "country", "locale", "DEVICE", "segment", "slot", "variation", "strategy", "page_category"]
    GDIMS = SDIMS + ["slot", "variation", "strategy"]  # segment fact incl. traffic source, no page category

    # ---- impressions & clicks ---------------------------------------------------------------
    imp = ve[ve.ENGAGEMENT_TYPE == "STRATEGY_IMPRESSION"].groupby(FDIMS).size().rename("imp")
    clicks = ve[ve.ENGAGEMENT_TYPE == "CLICK"].copy()
    clicks["sku"] = clicks.SKUS.str.extract(r'\["([^"]+)"')[0]
    clicks["anchor"] = clicks.ctx_first.where(clicks.CONTEXT_TYPE == "PRODUCT")
    clicks["cid"] = clicks.INTERACTION_ID
    clk = clicks.groupby(FDIMS).size().rename("clk")

    # ---- click -> PDP view of the clicked product ----------------------------------------------
    pv = raw[(raw.EVENT_TYPE == "UIA") & (raw.CONTEXT_TYPE == "PRODUCT")][["SKEY", "REQ_TIMESTAMP", "ctx_first"]]
    m = clicks[["cid", "SKEY", "REQ_TIMESTAMP", "sku"]].merge(
        pv.rename(columns={"ctx_first": "sku", "REQ_TIMESTAMP": "pv_ts"}), on=["SKEY", "sku"])
    clicks["pdp"] = clicks.cid.isin(m[m.pv_ts > m.REQ_TIMESTAMP].cid).astype(int)

    def last_click_before(events, ts_col):
        """Attach each product-level event to the last reco click on that SKU earlier in the session."""
        j = events.merge(clicks[["cid", "SKEY", "sku", "REQ_TIMESTAMP"]], on=["SKEY", "sku"])
        j = j[j.REQ_TIMESTAMP < j[ts_col]]
        return j.sort_values("REQ_TIMESTAMP").groupby("eid").tail(1)

    # ---- click -> add to cart -------------------------------------------------------------------
    atc = raw[(raw.EVENT_TYPE == "DPX") & (raw.EVENT_NAME == "Add to Cart")]
    atc = pd.DataFrame({"eid": atc.INTERACTION_ID, "SKEY": atc.SKEY, "sku": atc.ctx_first, "ts": atc.REQ_TIMESTAMP})
    atc_c = last_click_before(atc, "ts").groupby("cid").size().rename("atc")

    # ---- click -> purchase (product level) ---------------------------------------------------
    pur = raw[(raw.EVENT_TYPE == "DPX") & (raw.EVENT_NAME == "Purchase")]
    lines = []
    for r in pur.itertuples():
        for it in json.loads(r.EVENT_PROPERTIES)["cart"]:
            lines.append((r.INTERACTION_ID, r.SKEY, r.REQ_TIMESTAMP, it["productId"], it["quantity"], it["itemPrice"]))
    lines = pd.DataFrame(lines, columns=["tx", "SKEY", "ts", "sku", "qty", "item_price"])
    lines["eid"] = lines.tx + ":" + lines.sku
    lines["rev"] = lines.qty * lines.item_price
    pl = last_click_before(lines, "ts")
    pur_c = pl.groupby("cid").agg(orders=("tx", "nunique"), units=("qty", "sum"), rev=("rev", "sum"))
    anchor = pl.merge(clicks[["cid", "anchor"]], on="cid").dropna(subset=["anchor"])
    anchor = anchor.merge(lines[["tx", "sku", "rev"]].rename(columns={"sku": "anchor", "rev": "anchor_rev"}),
                          on=["tx", "anchor"], how="left")
    anchor_c = anchor.groupby("cid").agg(addon_orders=("tx", "nunique"), anchor_rev=("anchor_rev", "sum"),
                                         anchor_orders=("anchor_rev", lambda s: s.notna().sum()))

    clicks = clicks.set_index("cid").join([atc_c, pur_c, anchor_c]).fillna(
        {"atc": 0, "orders": 0, "units": 0, "rev": 0, "addon_orders": 0, "anchor_rev": 0, "anchor_orders": 0})
    clicks["addon_rev"] = clicks.rev.where(clicks.anchor.notna(), 0)
    MEAS = ["pdp", "atc", "orders", "units", "rev", "addon_rev", "addon_orders", "anchor_rev", "anchor_orders"]
    conv = clicks.groupby(FDIMS)[MEAS].sum()

    # ---- DY standard attribution (attribution table: whole order value, all engaged variations) ----
    vu = ve.drop_duplicates("VARIATION_IDS")
    var_id_name = dict(zip(vu.VARIATION_IDS.str.strip("[]").astype(int), vu.variation))
    var_slot = ve.drop_duplicates("variation").set_index("variation").slot.to_dict()
    a = attr.copy()
    a["variation"] = a.VARIATIONS.str.strip("[]").astype(int).map(var_id_name)
    a = a.merge(raw[raw.EVENT_NAME == "Purchase"][["INTERACTION_ID", "SKEY"]], on="INTERACTION_ID")
    a = a.join(sess, on="SKEY")
    a["slot"], a["strategy"], a["page_category"] = a.variation.map(var_slot), a.variation.map(var_strategy), "(all)"
    assist = a.groupby(FDIMS).agg(dy_orders=("INTERACTION_ID", "nunique"), dy_rev=("EVENT_VALUE", "sum"))
    assist["dy_rev"] /= 100

    fact = pd.concat([imp, clk, conv, assist], axis=1).fillna(0).reset_index()
    seg = pd.concat([ve[ve.ENGAGEMENT_TYPE == "STRATEGY_IMPRESSION"].groupby(GDIMS).size().rename("imp"),
                     clicks.groupby(GDIMS).agg(clk=("pdp", "size"), atc=("atc", "sum"), orders=("orders", "sum"),
                                               rev=("rev", "sum"))], axis=1).fillna(0).reset_index()

    # ---- product fact --------------------------------------------------------------------------
    prod = clicks.reset_index().groupby(FDIMS[:-1] + ["sku"]).agg(
        clk=("sku", "size"), atc=("atc", "sum"), orders=("orders", "sum"), units=("units", "sum"), rev=("rev", "sum")
    ).reset_index()

    # ---- anchor (main PDP product) -> recommended product pairs ------------------------------------
    pairs = clicks[clicks.anchor.notna()].reset_index().groupby(FDIMS[:-1] + ["anchor", "sku"]).agg(
        clk=("sku", "size"), atc=("atc", "sum"), orders=("orders", "sum"), rev=("rev", "sum"),
        anchor_rev=("anchor_rev", "sum")).reset_index()

    # ---- site totals (for reco share of revenue) ------------------------------------------------
    site = pd.concat([
        sess.groupby(SDIMS).size().rename("sessions"),
        pur.groupby(SDIMS).agg(orders=("INTERACTION_ID", "size"), rev=("EVENT_VALUE", "sum")),
    ], axis=1).fillna(0).reset_index()

    # ---- coverage: of the PDPs viewed, which got recommendations per PDP slot ---------------------
    days = 7 * int(cfg["period"]["weeks"])
    all_dates = sorted(raw.date.unique())
    cur_start = all_dates[-days]
    pdpv = raw[(raw.EVENT_TYPE == "UIA") & (raw.CONTEXT_TYPE == "PRODUCT") & (raw.date >= cur_start)]
    served = ve[(ve.ENGAGEMENT_TYPE == "STRATEGY_IMPRESSION") & (ve.CONTEXT_TYPE == "PRODUCT") & (ve.date >= cur_start)]
    cov_v = pdpv.groupby(["ctx_first", "country"]).size().rename("views")
    cov_s = served.groupby(["ctx_first", "country", "slot"]).size().rename("served").reset_index()
    pdp_slots = [s["name"] for s in cfg["slots"] if s["page"] == "PRODUCT"]
    cov = (cov_v.reset_index().merge(pd.DataFrame({"slot": pdp_slots}), how="cross")
           .merge(cov_s, on=["ctx_first", "country", "slot"], how="left").fillna({"served": 0})
           .rename(columns={"ctx_first": "sku"}))

    # ---- encode for the browser ----------------------------------------------------------------
    dims = {}

    def enc(df, cols, meas):
        for c in cols:
            for v in sorted(df[c].astype(str).unique()):
                if v not in dims.setdefault(c, []):
                    dims[c].append(v)
        idx = {c: {v: i for i, v in enumerate(dims[c])} for c in cols}
        out = []
        for r in df[cols + meas].itertuples(index=False):
            row = [idx[c][str(getattr(r, c))] for c in cols]
            for mm in meas:
                v = float(getattr(r, mm))
                row.append(int(v) if v.is_integer() else round(v, 2))
            out.append(row)
        return {"cols": cols + meas, "rows": out}

    FM = ["imp", "clk"] + MEAS + ["dy_orders", "dy_rev"]
    payload = {
        "fact": enc(fact, FDIMS, FM),
        "prod": enc(prod, FDIMS[:-1] + ["sku"], ["clk", "atc", "orders", "units", "rev"]),
        "seg": enc(seg, GDIMS, ["imp", "clk", "atc", "orders", "rev"]),
        "pairs": enc(pairs, FDIMS[:-1] + ["anchor", "sku"], ["clk", "atc", "orders", "rev", "anchor_rev"]),
        "site": enc(site, SDIMS, ["sessions", "orders", "rev"]),
        "cov": enc(cov, ["sku", "country", "slot"], ["views", "served"]),
    }
    payload["dims"] = dims
    payload["catalog"] = {r.sku: [r.name, r.top_category, r.sub_category, r.color_group, r.material_group,
                                  float(r.price), bool(r.in_stock), r.image_url or ""]
                          for r in feed.itertuples()}
    payload["meta"] = {"current_start": cur_start, "current_end": all_dates[-1], "weeks": int(cfg["period"]["weeks"]),
                       "raw_rows": int(len(raw)), "attribution_rows": int(len(attr)),
                       "slot_page": {s["name"]: s["page"] for s in cfg["slots"]},
                       "controls": [v["name"] for s in cfg["slots"] for v in s["variations"] if v.get("control")]}

    cur = fact[fact.date >= cur_start]
    summary = cur.groupby(["slot", "variation"])[["imp", "clk", "orders", "rev", "addon_rev", "dy_rev"]].sum()
    summary["ctr"] = summary.clk / summary.imp
    summary["cr"] = summary.orders / summary.imp
    summary["rev_1k"] = summary.rev / summary.imp * 1000
    cov_by_slot = (cov[cov.served > 0].groupby("slot").sku.nunique() / cov.groupby("slot").sku.nunique()).replace(np.nan, 0)
    return payload, summary, cov_by_slot
