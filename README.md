# DAS demo kit

Build a prospect-specific demo of **Dynamic Yield Daily Activity Stream (DAS)** reporting in about 15 minutes with your AI assistant.

The demo page shows, for each of the prospect's measurement requirements:
**requirement → the DAS columns it needs → a live widget on (synthetic) DAS data → the BigQuery SQL**,
plus the status in the Recommendations Report, the Experience Report and DAS + BI.

Use it when a prospect asks for reporting the DY UI does not provide out of the box (product-level attribution, add-to-cart per slot,
add-on revenue, funnels, coverage, YoY, BI / warehouse integration …).

## Quick start

```bash
pip install pandas pyarrow                    # Python 3.10+
python3 build.py prospects/vidaxl             # the reference demo (~30 s)
open prospects/vidaxl/dist/index.html
```

Click **Start with A1 ›** and use ↓ to walk through the requirements. The talk track is in [prospects/vidaxl/TALK_TRACK.md](prospects/vidaxl/TALK_TRACK.md).

## Make one for your prospect (with AI)

Open this folder in VS Code with GitHub Copilot (agent mode). The repository-level skill
[`.github/skills/das-demo`](.github/skills/das-demo/SKILL.md) is picked up automatically. Then ask, for example:

> Build a DAS demo for **Contoso Fashion** (contoso.de, contoso.at, contoso.ch/de + /fr, EUR + CHF).
> Their requirements are in the attached RFP. They use Looker on BigQuery.

Attach or paste the prospect's requirements. The assistant will:

1. copy `prospects/_template` to `prospects/<slug>/`,
2. configure the sites, slots, strategies and A/B tests (`prospect.json`),
3. map each requirement to a widget and status (`requirements.json`), and be clear about what DAS **cannot** do,
4. build and check the demo, and
5. write `TALK_TRACK.md`.

Review the result before you use it with the prospect. Look at the statuses (●/◐/○) and the talking points in particular.

Using another AI tool? `AGENTS.md` points every agent to the same skill. You can also paste `SKILL.md` into the chat.

## Make one by hand

```bash
cp -R prospects/_template prospects/<slug>
# edit prospects/<slug>/prospect.json and requirements.json
python3 build.py prospects/<slug> --check     # validate
python3 build.py prospects/<slug>             # build -> prospects/<slug>/dist/index.html
```

Field reference: [config-reference.md](.github/skills/das-demo/references/config-reference.md) ·
widgets: [capabilities.md](.github/skills/das-demo/references/capabilities.md) ·
what DAS can and cannot do: [das-reference.md](.github/skills/das-demo/references/das-reference.md).

## Share the demo

`prospects/<slug>/dist/` is self-contained. You can zip it and open `index.html` on any machine, with no server and no
install. Chart.js is bundled. The page needs an internet connection only for product images from a real feed.

## Layout

```
build.py                      validate → generate synthetic DAS → build models → dist/
engine/                       shared by all prospects
  generate_feed.py            synthetic product feed (configurable taxonomy)
  generate_das.py             synthetic DAS raw + attribution (Parquet), driven by prospect.json
  build_model.py              BI models (same logic as the SQL)
  capabilities.json           widget registry + default RR/ER/DAS statuses
  dashboard/                  demo page (app.js = capability library)
  sql/                        BigQuery models template → dist/bigquery_models.sql
prospects/
  _template/                  generic starting point (synthetic feed, 34 requirements incl. a gap example)
  vidaxl/                     reference: real RFP requirements, real product feed
.github/skills/das-demo/      the AI skill (SKILL.md + references)
AGENTS.md                     entry point for any AI agent
```

`prospects/*/data/` and `prospects/*/dist/` are generated and git-ignored.

## Important

- **All data is synthetic.** The footer of every demo says so. Do not present the numbers as the prospect's performance.
- The **DAS has no SKU-level impressions**, so there is no product CTR. It is D+1 and DY keeps the files for 30 days. Say this in every demo.
- Do not commit a customer's product feed or RFP unless you are sure it can be shared internally.
