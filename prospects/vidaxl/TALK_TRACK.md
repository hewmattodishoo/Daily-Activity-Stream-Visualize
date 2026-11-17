# vidaXL deep-dive: Recommendations measurement

This document is written in ASD-STE100 (Simplified Technical English).

## 1. The data sources and what they show

There are three data sources:

- The Recommendations Report (RR) in the Dynamic Yield (DY) UI.
- The Experience Report (ER) in the DY UI.
- The Daily Activity Stream (DAS) with a BI tool.

| Source | Use this source for | Limits |
|---|---|---|
| **Recommendations Report** | Standard KPIs for each slot and each strategy. These KPIs are impressions, clicks, CTR, direct revenue, assisted revenue, revenue for each 1,000 impressions, trends and revenue for each page type. | There is no add-to-cart (ATC) data. There is no product-level data. There is no add-on revenue. There are only a small number of filters. The data updates one time each day. |
| **Experience Report** | A/B tests of variations (strategies or business rules). The report shows uplift, probability to be best, credible intervals and an audience breakdown (device, traffic source, new or returning visitor). It also has a "Today" view and a CSV export. | The conversions are for each user. They do not connect to the product that the user clicked. There is no product-level data. |
| **DAS + BI tool** | The KPIs that vidaXL defines. Examples are product-level attribution, ATC, add-on revenue, the funnel, coverage, category, product attributes and year-over-year (YoY). All filters are possible. The data goes into BigQuery. | The data comes one time each day (D+1). DY keeps the files in S3 for 30 days only. vidaXL must keep the files and make the data models. **The DAS does not log SKU-level impressions.** |

**Key message:**

- The DY UI gives the standard KPIs for slots and strategies. It also gives the A/B test results.
- The DAS gives the KPIs that vidaXL defines. vidaXL uses BigQuery and their BI tool for these KPIs.
- The DAS gives full data for 24 of the 26 MUST requirements.
- The DAS gives partial data for A29 and A30 (product-level performance). The cause is that the DAS has no SKU-level impressions.
- The DAS does not give real-time data (A23).

## 2. Requirement map

● = full · ◐ = partial · ○ = no. RR = Recommendations Report. ER = Experience Report.

| ID | Priority | Requirement | RR | ER | DAS | Talking point |
|---|---|---|:-:|:-:|:-:|---|
| A1/A2 | MUST | Impressions for each slot and strategy | ● | ◐ | ● | The RR has a campaign tab and a strategy tab. The DAS has `IMPRESSION` and `STRATEGY_IMPRESSION` rows. DY logs a strategy impression only when the strategy gives results. |
| A3/A4 | MUST | Clicks for each slot and strategy | ● | ◐ | ● | The RR shows clicks and CTR. The DAS `CLICK` rows contain `STRATEGY_NAME` and `SKUS`. |
| A5/A6 | MUST | ATC for each slot and strategy | ○ | ◐ | ● | The ER shows ATC for each user. The DAS connects ATC to the product: a click on SKU X, then an ATC of SKU X. |
| A7/A8 | MUST | Products bought for each slot and strategy | ◐ | ◐ | ● | The RR shows direct purchases. The DAS gives the units of the clicked SKU from `cart[]`. |
| A9/A10 | MUST | Conversion rate (orders / impressions) | ◐ | ◐ | ● | The UI shows CTR, revenue for each 1,000 impressions and user conversion rate. vidaXL's definition is possible only with the DAS. |
| A11/A12 | MUST | Attributed revenue (click → PDP → order) | ● | ◐ | ● | The RR shows "direct revenue". This is a purchase of a clicked item in the attribution window (default: 30 days). The DAS gives the exact path. |
| A13/A14 | MUST | Add-on revenue compared to the first PDP | ◐ | ○ | ● | This is not a standard UI metric. In the DAS, the main product comes from `CONTEXT_DATA` of the PDP click. Compare it to the main product revenue in the same order. |
| A15/A16 | MUST | Product clicks for each product ID, slot and strategy | ○ | ○ | ● | DAS only (`SKUS` on `CLICK` rows). These are click counts. They are not a product CTR. |
| A17/A18 | MUST | Week-over-week (WoW), YoY and date-range comparison | ◐ | ◐ | ● | The UI has a date picker but no deltas. The DAS gives all comparisons. vidaXL must keep the history, because DY keeps the files for 30 days only. |
| A19/A20 | MUST | Historical trend for each slot and strategy | ● | ● | ● | The RR has trend graphs. The ER shows data over time. |
| A21 | MUST | Filters: site, device, locale, country, slot, category, strategy | ◐ | ◐ | ● | Site = DY section. Country and locale come from the URL or the section. Category comes from the product feed. |
| A22 | MUST | CSV export | ◐ | ● | ● | The ER has a CSV export and a revenue event log. The DAS gives Parquet files. The BI tool gives CSV exports. |
| A23 | SHOULD | Real-time dashboard | ○ | ◐ | ○ | The ER has a "Today" view. For real-time data, vidaXL must also send the recommendation clicks to GA4 or Pub/Sub. |
| A24 | SHOULD | Segments (new or returning, device, traffic source) | ○ | ● | ● | The ER has an audience breakdown. The DAS has `AUDIENCES_NAMES`, `DEVICE` and `TRAFFIC_SOURCE`. |
| A25 | SHOULD | Category-level performance | ◐ | ○ | ● | The RR shows revenue for each page type. The DAS and the product feed give the page category and the category of the recommended product. |
| A26 | SHOULD | API to BigQuery | ○ | ○ | ● | Move the S3 Parquet files to BigQuery with the BigQuery Data Transfer Service (S3 connector). |
| A27 | SHOULD | Product attributes (colour, price, material) | ○ | ○ | ● | Join the clicked SKU to the product feed. The dashboard shows click share and click-to-order rate. There is no CTR for each attribute. |
| A28 | SHOULD | Business rule performance | ◐ | ● | ● | Make the rule a variation. Use the ER for statistical significance. Use the DAS for product-level data. |
| A29/A30 | MUST | Product-level performance for each slot and strategy | ○ | ○ | ◐ | The DAS gives clicks, click share, ATC, units, revenue and click-to-order rate for each SKU. **Gap:** there are no product impressions and no product CTR. See section 4. |
| A31 | MUST | Funnel: click → ATC → order, main product → recommended product | ○ | ○ | ● | DAS only. The dashboard shows the funnel and the main-to-recommended product pairs. |
| A32 | MUST | Recommendation coverage | ○ | ○ | ● | The DAS gives the viewed PDP SKUs that show recommendations, divided by all viewed PDP SKUs. See the note below. |
| A33 | SHOULD | Scheduled reports and alerts | ◐ | ◐ | ● | Make sure that you know the current scheduling options in the DY UI. The BI tool gives schedules and alerts on the DAS models. |

> **Note (A32):** The DAS measures the products that *show* recommendations on their PDP. The DAS cannot measure the products that are *shown as* a recommendation. The cause is that the DAS has no SKU-level impressions. The clicked SKUs give only a minimum value. Ask vidaXL which definition they use.

**Before the session, make sure that you know the answers to these questions. Ask DY product or PS:**

1. Is a CSV export possible from the Recommendations Report?
2. Which scheduling and alert options are in the DY UI?

## 3. Demo procedure (approximately 20 minutes)

### 3.1 Recommendations Report (approximately 5 minutes)

Requirements: A1–A4, A11/A12, A19.

1. Show the campaign tab and the strategy tab.
2. Show direct revenue and assisted revenue.
3. Show the trend graph.
4. Tell vidaXL: "You get these KPIs on day 1. You do not have to make a data model."

### 3.2 Experience Report (approximately 5 minutes)

Requirements: A24, A28.

1. Show an A/B test of a strategy or a business rule.
2. Show the probability to be best.
3. Show the audience breakdown (device, new or returning visitor, traffic source).
4. Show the CSV export.
5. Tell vidaXL: "Use this report to find out if a business rule gives better results."

### 3.3 DAS → requirement → widget (approximately 10–15 minutes)

The demo page has one view with three parts:

- Left: the DAS columns (DAS raw, DAS attribution, product feed).
- Middle: the vidaXL requirements A1–A33. Lines connect each requirement to the DAS columns that it uses.
- Right: the widget for the selected requirement. The widget uses the DAS data.

1. Open `prospects/vidaxl/dist/index.html`.
2. Show the summary at the top: the number of MUST and SHOULD requirements that the DAS gives data for.
3. Click **Start with A1 ›**.
4. For each requirement, show these items in the right panel:
   - The status: Recommendations Report, Experience Report and DAS + BI.
   - Section 1, "DAS data used": the columns and the filter or logic for each column.
   - Section 2, the widget with the numbers from the DAS data.
   - Section 3, the BigQuery SQL (only if the audience is technical).
5. Push the ↓ key (or click **›**) to go to the next requirement.
6. Put the mouse on a column in section 1. The line to this column shows on the left.
7. Put the mouse on a column on the left. The lines show all requirements that use this column.
8. At A11/A12, compare direct revenue to DY-attributed revenue. The data is the same, but the attribution logic is different. Tell vidaXL to select one definition for each KPI.
9. At A13/A14, show the add-on revenue and the main product revenue in the same orders.
10. At A23, show the gap. The DAS cannot give real-time data. Show the two options.
11. At A28, show the margin-rule test. The rule gives a higher CTR and a higher conversion rate. But the rule gives less revenue for each 1,000 impressions. Use this result to start a discussion.
12. At A29/A30, tell vidaXL that the DAS has no SKU-level impressions. Product impressions and product CTR are not available.
13. At A32, show the coverage of "Complete The Set". This slot shows recommendations on only approximately 30% of the viewed SKUs.
14. At A33, change the alert limits. Show which slots trigger an alert.

> **Note:** Use the **Period** and **Compare** controls in section 2 to change the date range for all widgets.

## 4. Limits to tell vidaXL

- **Latency:** The DAS data comes one time each day (D+1). The DAS cannot give real-time data (A23).
- **Retention:** DY keeps the files in S3 for 30 days only. vidaXL must load the files into BigQuery each day. This is necessary for WoW and YoY history.
- **No SKU-level impressions:** The DAS logs the SKU only on `CLICK` rows. Thus, the DAS cannot give product impressions, product CTR, or the products shown as a recommendation.
  - **Workaround:** vidaXL logs the SKUs that DY sends in the API response (or in the client-side callback). vidaXL keeps these SKUs in BigQuery.
- **Reconciliation:** The DAS numbers are different from the UI numbers. The UI uses its own attribution window (default: 30 days). It also uses its own outlier and bot filters and user-level logic. Select one source of truth for each KPI.
- **Slot definition:** A slot is a DY campaign. Use a naming convention (`PAGE | Placement`) to keep the reports clear. A variation is a strategy or a rule in a test.
- **Currency:** Each section uses its own currency (GBP on .co.uk). Convert all values to one currency in the data model.
- **Business definitions:** vidaXL must define the add-on and attribution logic. Examples are session or N-day window, and last click or any click. The DAS can give data for all of these definitions.

## 5. Procedure: build and open the demo

```bash
python3 build.py prospects/vidaxl      # approximately 30 seconds the first time
open prospects/vidaxl/dist/index.html
```

> **Note:** The data is synthetic. It does not show the real performance of vidaXL. The numbers in the widgets come from the build. Read the build output before the session (A/B uplifts, coverage).

> **Note:** `feed.csv` is the vidaXL DY product feed (public catalogue data). The product images load from vidaxl.co.uk, so an internet connection is necessary for the images.
