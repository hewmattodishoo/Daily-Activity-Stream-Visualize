#!/usr/bin/env python3
"""Build a DAS demo for one prospect.

    python3 build.py prospects/<slug>            # validate, (re)generate data if needed, build dist/
    python3 build.py prospects/<slug> --check    # validate config + requirements only
    python3 build.py prospects/<slug> --regen    # force new synthetic data

Output: prospects/<slug>/dist/  (open dist/index.html; zip the folder to share)
"""
import argparse
import json
import shutil
import sys
import time
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT / "engine"))
import build_model  # noqa: E402
import common  # noqa: E402
import generate_das  # noqa: E402
import generate_feed  # noqa: E402


def sql_country_locale(sites):
    ss = sorted(sites, key=lambda s: -len(s["domain"] + s["path"]))
    when = lambda k: "\n".join(f"    WHEN STARTS_WITH(URL_CLEAN, 'https://{s['domain']}{s['path']}/') THEN '{s[k]}'" for s in ss)
    return f"  CASE\n{when('country')}\n  END AS country,\n  CASE\n{when('locale')}\n  END AS locale,"


def prospect_js(cfg, reqs):
    p = cfg["prospect"]
    caps = {k: {"dims": v["dims"], "summary": v["summary"]} for k, v in common.CAPS.items()}
    out = {
        "name": p["name"], "slug": p["slug"], "industry": p.get("industry", ""),
        "contact_email": p.get("contact_email") or f"ecommerce@{cfg['sites'][0]['domain'].removeprefix('www.')}",
        "title": p.get("title") or "Recommendation measurement: requirement → DAS data → widget",
        "logo_html": cfg["brand"]["logo_html"] or p["name"], "brand": cfg["brand"], "currency": cfg["currency"],
        "sites": [{k: s[k] for k in ("domain", "path", "country", "locale", "section_id")} for s in cfg["sites"]],
        "bigquery": cfg["bigquery"], "bi_tools": p.get("bi_tools") or "Looker · Power BI · Looker Studio",
        "feed_synthetic": not cfg["feed"]["path"],
    }
    return (f"window.PROSPECT = {json.dumps(out, ensure_ascii=False, indent=1)};\n"
            f"window.CAPABILITIES = {json.dumps(caps, ensure_ascii=False)};\n"
            f"window.REQS = {json.dumps(reqs, ensure_ascii=False, indent=1)};\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("prospect_dir")
    ap.add_argument("--check", action="store_true", help="validate only")
    ap.add_argument("--regen", action="store_true", help="force regeneration of the synthetic data")
    a = ap.parse_args()

    try:
        cfg, reqs, warnings = common.load(a.prospect_dir)
    except (common.ConfigError, json.JSONDecodeError, FileNotFoundError) as e:
        print(f"✗ {e}")
        sys.exit(1)
    for w in warnings:
        print(f"⚠ {w}")
    print(f"✓ config OK: {cfg['prospect']['name']} · {len(cfg['sites'])} sites · {len(cfg['slots'])} slots · {len(reqs)} requirements")
    if a.check:
        return

    pdir, data = cfg["dir"], cfg["dir"] / "data"
    data.mkdir(exist_ok=True)
    t0 = time.time()
    if not cfg["feed"]["path"] and (a.regen or not (data / "feed.csv").exists()):
        print("· generating synthetic product feed")
        generate_feed.generate(cfg, data / "feed.csv")
    feed = common.load_feed(cfg)
    h = common.generation_hash(cfg)
    stamp = data / ".generation_hash"
    if a.regen or not (data / "das_raw.parquet").exists() or not stamp.exists() or stamp.read_text() != h:
        print(f"· generating synthetic DAS ({cfg['period']['weeks']} weeks + same weeks last year, ~30-60 s)")
        generate_das.run(cfg, feed, data)
        stamp.write_text(h)
    else:
        print("· DAS data up to date (config unchanged), reusing data/*.parquet")

    print("· building BI models")
    payload, summary, cov = build_model.run(cfg, feed, data)

    dist = pdir / "dist"
    if dist.exists():
        shutil.rmtree(dist)
    shutil.copytree(ROOT / "engine" / "dashboard", dist)
    (dist / "data.js").write_text("window.DAS = " + json.dumps(payload, separators=(",", ":")) + ";")
    (dist / "prospect.js").write_text(prospect_js(cfg, reqs))
    sql = (ROOT / "engine" / "sql" / "bigquery_models.sql.tmpl").read_text()
    sql = (sql.replace("{{PROSPECT}}", cfg["prospect"]["name"]).replace("{{DS}}", cfg["bigquery"]["dataset"])
           .replace("{{S3}}", cfg["bigquery"]["s3_region_suffix"] or "").replace("{{COUNTRY_LOCALE}}", sql_country_locale(cfg["sites"])))
    (dist / "bigquery_models.sql").write_text(sql)

    pd.set_option("display.width", 200)
    pd.set_option("display.max_colwidth", 40)
    print(f"\nCurrent period KPIs per slot × variation ({payload['meta']['current_start']} → {payload['meta']['current_end']}):")
    s = summary.copy()
    s["ctr"] = (s.ctr * 100).round(2).astype(str) + "%"
    s["cr"] = (s.cr * 100).round(3).astype(str) + "%"
    print(s[["imp", "clk", "ctr", "orders", "cr", "rev", "rev_1k", "addon_rev"]].round(1).to_string())
    if len(cov):
        print("\nPDP coverage (viewed SKUs with recommendations):", ", ".join(f"{k}: {v:.0%}" for k, v in cov.items()))
    ctl = set(payload["meta"]["controls"])
    for slot, g in summary.reset_index().groupby("slot"):
        c = g[g.variation.isin(ctl)]
        for _, v in g[~g.variation.isin(ctl)].iterrows():
            if len(c) and len(g) > 1:
                cc = c.iloc[0]
                print(f"A/B '{slot}': {v.variation} vs control → CTR {v.ctr / cc.ctr - 1:+.1%}, "
                      f"CR {v.cr / cc.cr - 1:+.1%}, rev/1k {v.rev_1k / cc.rev_1k - 1:+.1%}")
    mb = (dist / "data.js").stat().st_size / 1e6
    print(f"\n✓ built {dist / 'index.html'}  ({mb:.1f} MB data, {time.time() - t0:.0f} s)")


if __name__ == "__main__":
    main()
