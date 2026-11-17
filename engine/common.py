"""Shared helpers: load + validate a prospect folder, normalise the product feed."""
import hashlib
import json
from pathlib import Path

import pandas as pd

ENGINE = Path(__file__).parent
CAPS = {k: v for k, v in json.loads((ENGINE / "capabilities.json").read_text()).items() if not k.startswith("_")}
STATUS = {"yes", "partial", "no"}
PAGES = {"HOMEPAGE", "CATEGORY", "PRODUCT", "CART"}
STRATEGY_TYPES = {"affinity", "popular", "recently_viewed", "popular_in_category", "similar",
                  "complementary", "budget_alternative", "bought_together"}
FEED_FIELDS = ["sku", "name", "price", "in_stock", "image_url", "top_category", "sub_category", "leaf_category",
               "color_group", "material_group", "margin"]

DEFAULTS = {
    "currency": {"code": "EUR", "symbol": "€", "number_locale": "en-GB"},
    "brand": {"primary": "#1c3d5a", "accent": "#f28c28", "logo_html": None},
    "period": {"end": "2026-11-15", "weeks": 8, "sessions_per_day": 1100, "seed": 42,
               "last_year_factor": 0.86, "growth_in_period": 0.25},
    "feed": {"path": None, "columns": {}, "synthetic": {"products": 300}},
    "bigquery": {"dataset": "dy", "export_bucket": None, "s3_region_suffix": "-eu"},
    "traffic_sources": [["Search", 0.38, "google.com"], ["Direct", 0.22, ""], ["Paid Search", 0.17, "googleadservices.com"],
                        ["Email", 0.08, None], ["Social", 0.09, "facebook.com"], ["Referral", 0.06, "pinterest.com"]],
    "devices": [["Smartphone", 0.62], ["Desktop", 0.31], ["Tablet", 0.07]],
}


class ConfigError(Exception):
    pass


def _merge(d, default):
    if isinstance(default, dict):
        d = d or {}
        return {**{k: _merge(d.get(k), v) for k, v in default.items()}, **{k: v for k, v in d.items() if k not in default}}
    return default if d is None else d


def load(prospect_dir):
    pdir = Path(prospect_dir).resolve()
    if not (pdir / "prospect.json").exists():
        raise ConfigError(f"{pdir}/prospect.json not found")
    raw = json.loads((pdir / "prospect.json").read_text())
    cfg = {k: _merge(raw.get(k), v) for k, v in DEFAULTS.items()}
    cfg.update({k: v for k, v in raw.items() if k not in DEFAULTS})
    reqs = json.loads((pdir / "requirements.json").read_text())
    if isinstance(reqs, dict):
        reqs = reqs.get("requirements", [])
    errors, warnings = validate(cfg, reqs, pdir)
    if errors:
        raise ConfigError("\n".join(["Config errors:"] + [f"  - {e}" for e in errors]))
    _fill_ids(cfg)
    for r in reqs:
        cap = CAPS[r["capability"]]
        if cap["dims"]:
            r.setdefault("dim", "slot")
        st = cap["status"].get(r.get("dim")) if cap["dims"] else cap["status"]
        for k in ("rr", "er", "das"):
            r.setdefault(k, st[k])
        r.setdefault("pri", "MUST")
        r.setdefault("how", "")
    cfg["dir"] = pdir
    return cfg, reqs, warnings


def validate(cfg, reqs, pdir):
    e, w = [], []
    p = cfg.get("prospect") or {}
    for k in ("name", "slug"):
        if not p.get(k):
            e.append(f"prospect.{k} is required")
    if not cfg.get("sites"):
        e.append("sites: at least one site is required")
    for i, s in enumerate(cfg.get("sites", [])):
        for k in ("domain", "country", "locale"):
            if not s.get(k):
                e.append(f"sites[{i}].{k} is required")
        if s.get("path") and not str(s["path"]).startswith("/"):
            e.append(f"sites[{i}].path must start with '/' (e.g. '/fr')")
    names = [s.get("name") for s in cfg.get("slots", [])]
    if not names:
        e.append("slots: at least one slot is required")
    if len(names) != len(set(names)):
        e.append("slots: slot names must be unique")
    pages = set()
    for s in cfg.get("slots", []):
        n = s.get("name", "?")
        if s.get("page") not in PAGES:
            e.append(f"slot '{n}': page must be one of {sorted(PAGES)}")
        pages.add(s.get("page"))
        vs = s.get("variations") or []
        if not vs:
            e.append(f"slot '{n}': needs at least one variation")
        if len(vs) > 1 and sum(bool(v.get("control")) for v in vs) != 1:
            w.append(f"slot '{n}': A/B test without exactly one variation marked \"control\": true")
        for v in vs:
            if v.get("type") not in STRATEGY_TYPES:
                e.append(f"slot '{n}' variation '{v.get('name')}': type must be one of {sorted(STRATEGY_TYPES)}")
            if not v.get("strategy") or not v.get("name"):
                e.append(f"slot '{n}': every variation needs 'name' and 'strategy'")
            if not 0 < float(v.get("ctr", 0)) < 0.5:
                e.append(f"slot '{n}' variation '{v.get('name')}': ctr must be between 0 and 0.5 (e.g. 0.035)")
            if v.get("type") == "recently_viewed" and s.get("page") == "PRODUCT":
                w.append(f"slot '{n}': recently_viewed on a PDP is unusual")
    if cfg["feed"]["path"] and not (pdir / cfg["feed"]["path"]).exists():
        e.append(f"feed.path '{cfg['feed']['path']}' not found in {pdir}")
    ids = [r.get("id") for r in reqs]
    if not reqs:
        e.append("requirements.json: no requirements")
    if len(ids) != len(set(ids)):
        e.append("requirements.json: ids must be unique")
    for r in reqs:
        rid = r.get("id", "?")
        if not r.get("req"):
            e.append(f"requirement {rid}: 'req' (requirement text) is required")
        cap = CAPS.get(r.get("capability"))
        if not cap:
            e.append(f"requirement {rid}: unknown capability '{r.get('capability')}'. Valid: {', '.join(CAPS)}")
            continue
        if r.get("dim") and r["dim"] not in cap["dims"]:
            e.append(f"requirement {rid}: dim '{r['dim']}' not valid for {r['capability']} (valid: {cap['dims'] or 'none'})")
        for k in ("rr", "er", "das"):
            if k in r and r[k] not in STATUS:
                e.append(f"requirement {rid}: {k} must be yes | partial | no")
        if r.get("pri", "MUST") not in ("MUST", "SHOULD", "COULD"):
            e.append(f"requirement {rid}: pri must be MUST | SHOULD | COULD")
        if r["capability"] in ("addon_revenue", "coverage") and "PRODUCT" not in pages:
            w.append(f"requirement {rid}: {r['capability']} needs at least one PRODUCT (PDP) slot")
        if r["capability"] == "business_rule_test" and not any(len(s.get("variations", [])) > 1 for s in cfg.get("slots", [])):
            w.append(f"requirement {rid}: business_rule_test needs a slot with 2+ variations (an A/B test)")
    return e, w


def _fill_ids(cfg):
    """Assign stable DY-like IDs where the config does not give them."""
    sec, by_domain = 8770001, {}
    for s in cfg["sites"]:
        s.setdefault("path", "")
        s.setdefault("share", 1 / len(cfg["sites"]))
        if "section_id" not in s:
            s["section_id"] = by_domain.setdefault(s["domain"], sec + len(by_domain))
    strat_ids = {}
    for i, s in enumerate(cfg["slots"]):
        s.setdefault("id", 310001 + i)
        s.setdefault("audience", "All users")
        s.setdefault("experience_id", 410001 + i)
        s.setdefault("experiment_id", 510001 + i)
        s.setdefault("version_id", 61000001 + i * 100)
        for j, v in enumerate(s["variations"]):
            v.setdefault("id", 71000001 + i * 100 + j)
            v.setdefault("weight", 1 / len(s["variations"]))
            v.setdefault("params", {})
            v["strategy_id"] = v.get("strategy_id") or strat_ids.setdefault(v["strategy"], 81001 + len(strat_ids))
    email_dom = "mail." + cfg["sites"][0]["domain"].removeprefix("www.")
    cfg["traffic_sources"] = [[n, sh, email_dom if ref is None else ref] for n, sh, ref in cfg["traffic_sources"]]


def generation_hash(cfg):
    keys = ("period", "feed", "sites", "slots", "traffic_sources", "devices", "currency")
    blob = json.dumps({k: cfg.get(k) for k in keys}, sort_keys=True, default=str)
    feed = cfg["dir"] / cfg["feed"]["path"] if cfg["feed"]["path"] else None
    if feed and feed.exists():
        blob += hashlib.md5(feed.read_bytes()).hexdigest()
    return hashlib.md5((blob + _engine_version()).encode()).hexdigest()


def _engine_version():
    return "".join(hashlib.md5((ENGINE / f).read_bytes()).hexdigest() for f in ("generate_das.py", "generate_feed.py"))


def feed_path(cfg):
    return cfg["dir"] / cfg["feed"]["path"] if cfg["feed"]["path"] else cfg["dir"] / "data" / "feed.csv"


def load_feed(cfg):
    """Return the feed with canonical columns (FEED_FIELDS) + the original columns."""
    df = pd.read_csv(feed_path(cfg), dtype=str, keep_default_na=False)
    m = cfg["feed"]["columns"]
    out = pd.DataFrame(index=df.index)
    aliases = {"margin": ["type:number:margin"], "color_group": ["color"], "material_group": ["material"]}
    for f in FEED_FIELDS:
        src = next((c for c in [m.get(f, f), *aliases.get(f, [])] if c in df.columns), None)
        out[f] = df[src].replace("", None) if src else None
    if out["sku"].isna().all() or out["price"].isna().all():
        raise ConfigError("feed: 'sku' and 'price' columns are required (map them with feed.columns)")
    out["name"] = out["name"].fillna(out["sku"])
    out["price"] = pd.to_numeric(out["price"], errors="coerce").fillna(0)
    out["in_stock"] = out["in_stock"].fillna("true").astype(str).str.lower().isin(["true", "1", "yes", "in stock"])
    out["image_url"] = out["image_url"].fillna("")
    out["top_category"] = out["top_category"].replace("", None).fillna("Other")
    out["sub_category"] = out["sub_category"].replace("", None).fillna(out["top_category"])
    out["leaf_category"] = out["leaf_category"].replace("", None).fillna(out["sub_category"])
    for f in ("color_group", "material_group"):
        out[f] = out[f].replace("", None).fillna("unknown")
    out["margin"] = pd.to_numeric(out["margin"], errors="coerce")
    extra = [c for c in df.columns if c.startswith("algo:items:")]
    out = pd.concat([out, df[extra]], axis=1)
    out = out[out.price > 0].drop_duplicates("sku").reset_index(drop=True)
    return out
