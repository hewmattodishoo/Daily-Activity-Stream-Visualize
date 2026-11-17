"""Generate a synthetic DY-style product feed (no customer data).

Config (prospect.json -> feed.synthetic):
  products : number of SKUs (default 300)
  brand    : brand name used in product names (default prospect.name)
  taxonomy : {top: {sub: {leaf: [min_price, max_price]}}}  (default: home & living)
  colors / materials : lists of [label, group]
"""
import hashlib
import random

import pandas as pd

HOME = {
    "Furniture": {
        "Living Room": {"Sofas": [249, 899], "Coffee Tables": [49, 229], "TV Stands": [59, 249], "Armchairs": [129, 449]},
        "Bedroom": {"Bed Frames": [119, 599], "Mattresses": [99, 499], "Wardrobes": [149, 649], "Bedside Tables": [29, 119]},
        "Dining": {"Dining Tables": [129, 699], "Dining Chairs": [39, 159], "Bar Stools": [35, 129]},
    },
    "Home & Garden": {
        "Decor": {"Mirrors": [25, 149], "Rugs": [29, 249], "Cushions": [9, 39], "Vases": [12, 59]},
        "Storage": {"Shelving Units": [39, 199], "Storage Boxes": [12, 49], "Shoe Racks": [19, 89]},
        "Textiles": {"Bedding Sets": [24, 89], "Curtains": [19, 79], "Throws": [15, 59]},
    },
    "Garden": {
        "Garden Furniture": {"Lounge Sets": [299, 1299], "Garden Chairs": [39, 179], "Parasols": [39, 249]},
        "Outdoor Living": {"Planters": [15, 129], "BBQs": [89, 599], "Outdoor Lighting": [15, 99]},
    },
    "Lighting": {
        "Indoor Lighting": {"Ceiling Lamps": [29, 199], "Floor Lamps": [39, 229], "Table Lamps": [19, 99]},
    },
    "Kitchen": {
        "Cookware": {"Pan Sets": [39, 199], "Knife Sets": [25, 149]},
        "Tableware": {"Dinner Sets": [29, 149], "Glassware": [12, 59]},
    },
}
COLORS = [("Black", "black"), ("White", "white"), ("Grey", "grey"), ("Light Grey", "grey"), ("Oak", "brown"),
          ("Walnut", "brown"), ("Beige", "beige"), ("Navy", "blue"), ("Sage Green", "green"), ("Anthracite", "grey")]
MATERIALS = [("Solid wood", "solid_wood"), ("Engineered wood", "engineered_wood"), ("Metal", "metal"),
             ("Fabric", "fabric"), ("Velvet", "fabric"), ("Rattan", "rattan"), ("Glass", "glass"), ("Ceramic", "ceramic")]
STYLES = ["Nordic", "Classic", "Industrial", "Modern", "Rustic", "Compact", "Premium", "Essential", "Loft", "Coastal"]


def _singular(w):
    return w[:-2] if w.endswith("sses") else w if w.endswith("ss") else w[:-1] if w.endswith("s") else w


def generate(cfg, out_path):
    syn = cfg["feed"].get("synthetic") or {}
    rnd = random.Random(cfg["period"]["seed"] + 7)
    taxonomy = syn.get("taxonomy") or HOME
    colors = [tuple(c) for c in syn.get("colors") or COLORS]
    materials = [tuple(m) for m in syn.get("materials") or MATERIALS]
    brand = syn.get("brand") or cfg["prospect"]["name"]
    n = int(syn.get("products", 300))
    leaves = [(t, s, l, rng) for t, subs in taxonomy.items() for s, ls in subs.items() for l, rng in ls.items()]
    domain = cfg["sites"][0]["domain"]
    rows = []
    for i in range(n):
        top, sub, leaf, (lo, hi) = leaves[i % len(leaves)] if i < len(leaves) else rnd.choice(leaves)
        color, cg = rnd.choice(colors)
        mat, mg = rnd.choice(materials)
        price = round(rnd.triangular(lo, hi, lo + (hi - lo) * 0.3)) - 0.01
        sku = str(8700000000000 + int(hashlib.md5(f"{cfg['prospect']['slug']}{i}".encode()).hexdigest()[:9], 16) % 10**11)
        name = f"{brand} {rnd.choice(STYLES)} {_singular(leaf)} {color} {mat}"
        # cheaper items carry a higher margin -> a margin-boost rule lifts CTR/CR but lowers revenue per 1k
        margin = round(min(0.6, max(0.05, 0.45 - 0.25 * (price - lo) / max(hi - lo, 1) + rnd.uniform(-0.08, 0.08))), 2)
        rows.append(dict(sku=sku, group_id=f"G{i:05d}", name=name, url=f"https://{domain}/e/{sku}.html", price=price,
                         in_stock=str(rnd.random() > 0.12).lower(), image_url="", categories=f"{top}|{sub}|{leaf}",
                         brand=brand, top_category=top, sub_category=sub, leaf_category=leaf, color=color,
                         color_group=cg, material=mat, material_group=mg, **{"type:number:margin": margin}))
    df = pd.DataFrame(rows)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False)
    return df
