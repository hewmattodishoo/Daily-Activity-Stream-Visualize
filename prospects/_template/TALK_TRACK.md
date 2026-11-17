# {{PROSPECT}} deep-dive: Recommendations measurement

<!-- Talk track template. The AI fills every {{…}} and removes this comment. Keep the style short and factual.
     See prospects/vidaxl/TALK_TRACK.md for a complete example. -->

## 1. The data sources and what they show

| Source | Use this source for | Limits |
|---|---|---|
| **Recommendations Report** | Standard KPIs for each slot and strategy: impressions, clicks, CTR, direct and assisted revenue, revenue per 1,000 impressions, trends. | No ATC, no product-level data, no add-on revenue, few filters, daily refresh. |
| **Experience Report** | A/B tests of variations: uplift, probability to be best, credible intervals, audience breakdown, "Today" view, CSV export. | User-level conversions, not tied to the clicked product. No product-level data. |
| **DAS + BI tool** | The KPIs that {{PROSPECT}} defines: {{list the custom KPIs from their RFP}}. | D+1 batch. DY keeps files in S3 for 30 days only. **No SKU-level impressions.** |

**Key message:**

- The DAS gives full data for {{n_full}} of the {{n_must}} MUST requirements.
- Partial: {{ids + one-line reason}}.
- Not possible with DAS: {{ids + one-line reason}}.

## 2. Requirement map

● = full · ◐ = partial · ○ = no.

| ID | Priority | Requirement | RR | ER | DAS | Talking point |
|---|---|---|:-:|:-:|:-:|---|
| {{id}} | {{pri}} | {{req}} | {{●/◐/○}} | {{●/◐/○}} | {{●/◐/○}} | {{how}} |

**Before the session, check with DY product / PS:** {{open questions}}

## 3. Demo procedure (approximately 20 minutes)

1. Recommendations Report (5 min): campaign + strategy tabs, direct revenue, trend.
2. Experience Report (5 min): an A/B test, probability to be best, audience breakdown, CSV export.
3. DAS demo page (10–15 min): open `prospects/{{slug}}/dist/index.html`, click **Start with {{first id}} ›**, use ↓ to step.
   Highlights to stop at:
   - {{id}}: {{what to show and say — use the numbers printed by build.py}}
   - {{gap id}}: show the gap and the options.

## 4. Limits to tell {{PROSPECT}}

- **Latency:** D+1, no real time.
- **Retention:** 30 days in S3 → load daily into BigQuery for WoW / YoY history.
- **No SKU-level impressions:** no product CTR, no "shown as a recommendation" coverage. Workaround: log the served SKUs from the DY API response.
- **Reconciliation:** DAS numbers differ from the UI (attribution window, bot filtering, user-level logic). Pick one source of truth per KPI.
- **Business definitions:** {{PROSPECT}} must define attribution and add-on logic; DAS supports all of them.
{{prospect-specific limits, e.g. currency, multiple sections}}

> **Caution:** The data is synthetic. It does not show the real performance of {{PROSPECT}}.
