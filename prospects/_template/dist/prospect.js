window.PROSPECT = {
 "name": "Acme Living",
 "slug": "acme-living",
 "industry": "Home & living e-commerce (multi-country)",
 "contact_email": "ecommerce@acmeliving.example",
 "title": "Recommendation measurement: requirement → DAS data → widget",
 "logo_html": "Acme<b>Living</b>",
 "brand": {
  "primary": "#23395d",
  "accent": "#e07a5f",
  "logo_html": "Acme<b>Living</b>"
 },
 "currency": {
  "code": "EUR",
  "symbol": "€",
  "number_locale": "en-GB"
 },
 "sites": [
  {
   "domain": "www.acmeliving.nl",
   "path": "",
   "country": "NL",
   "locale": "nl-NL",
   "section_id": 8770001
  },
  {
   "domain": "www.acmeliving.de",
   "path": "",
   "country": "DE",
   "locale": "de-DE",
   "section_id": 8770002
  },
  {
   "domain": "www.acmeliving.be",
   "path": "/nl",
   "country": "BE",
   "locale": "nl-BE",
   "section_id": 8770003
  },
  {
   "domain": "www.acmeliving.be",
   "path": "/fr",
   "country": "BE",
   "locale": "fr-BE",
   "section_id": 8770003
  }
 ],
 "bigquery": {
  "dataset": "dy",
  "export_bucket": "gs://acme-living-exports",
  "s3_region_suffix": "-eu"
 },
 "bi_tools": "Looker · Power BI · Looker Studio",
 "feed_synthetic": true
};
window.CAPABILITIES = {"impressions": {"dims": ["slot", "strategy"], "summary": "Impressions per slot / strategy, share and delta vs comparison period."}, "clicks_ctr": {"dims": ["slot", "strategy"], "summary": "Clicks and CTR per slot / strategy."}, "add_to_cart": {"dims": ["slot", "strategy"], "summary": "Add-to-cart of the clicked SKU after a reco click (product-level ATC attribution)."}, "units_purchased": {"dims": ["slot", "strategy"], "summary": "Orders and units of the clicked SKU purchased."}, "conversion_rate": {"dims": ["slot", "strategy"], "summary": "Custom conversion rate = attributed orders / impressions."}, "attributed_revenue": {"dims": ["slot", "strategy"], "summary": "Product-level attributed revenue (click -> PDP -> order) vs DY-attributed revenue from the attribution table."}, "addon_revenue": {"dims": ["slot", "strategy"], "summary": "Add-on revenue from PDP slots vs the main (anchor) product revenue in the same orders."}, "product_clicks": {"dims": ["slot", "strategy"], "summary": "Clicks per product ID by slot / strategy (no product CTR: DAS has no SKU-level impressions)."}, "time_comparison": {"dims": ["slot", "strategy"], "summary": "WoW, date range vs previous, YoY per slot / strategy."}, "trend": {"dims": ["slot", "strategy"], "summary": "Daily / weekly historical trend per slot / strategy."}, "product_performance": {"dims": ["slot", "strategy"], "summary": "Per SKU x slot/strategy: clicks, ATC, units, revenue, click->order. PARTIAL: no product impressions / CTR."}, "filters": {"dims": [], "summary": "Filter by country, locale, device, visitor type, slot, strategy, category."}, "csv_export": {"dims": [], "summary": "CSV export of any model."}, "segments": {"dims": [], "summary": "New vs returning, device, traffic source."}, "category_performance": {"dims": [], "summary": "Page category (where the slot is) or recommended-product category."}, "bigquery_feed": {"dims": [], "summary": "Architecture: S3 Parquet -> BigQuery -> SQL models -> BI tool."}, "product_attributes": {"dims": [], "summary": "Click share and click->order by colour, material, price band, stock (feed join)."}, "business_rule_test": {"dims": [], "summary": "Uplift of each variation vs the control in every slot with an A/B test."}, "funnel": {"dims": [], "summary": "Impression -> click -> PDP -> ATC -> order, plus main -> recommended product pairs."}, "coverage": {"dims": [], "summary": "% of viewed PDP SKUs where each PDP slot returned recommendations."}, "alerts": {"dims": [], "summary": "Scheduled report + WoW alert thresholds per slot."}, "realtime_gap": {"dims": [], "summary": "Explains why DAS is not real time (D+1) and the options."}, "gap": {"dims": [], "summary": "Generic 'not possible with DAS' panel. Uses the requirement's 'how' and optional 'options' list."}};
window.REQS = [
 {
  "id": "R1",
  "pri": "MUST",
  "req": "Impressions per slot",
  "capability": "impressions",
  "dim": "slot",
  "how": "Recs Report campaign tab shows impressions per recommendation campaign (= slot). DAS: VARIATION_ENGAGEMENT / IMPRESSION per CAMPAIGN_NAME.",
  "rr": "yes",
  "er": "partial",
  "das": "yes"
 },
 {
  "id": "R2",
  "pri": "MUST",
  "req": "Impressions per strategy",
  "capability": "impressions",
  "dim": "strategy",
  "how": "Recs Report strategy tab. DAS: STRATEGY_IMPRESSION rows with STRATEGY_NAME. Strategy impressions only count when the strategy returned results.",
  "rr": "yes",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R3",
  "pri": "MUST",
  "req": "Clicks per slot",
  "capability": "clicks_ctr",
  "dim": "slot",
  "how": "Recs Report clicks + CTR per campaign. Experience Report shows CTR per variation. DAS: ENGAGEMENT_TYPE = CLICK.",
  "rr": "yes",
  "er": "partial",
  "das": "yes"
 },
 {
  "id": "R4",
  "pri": "MUST",
  "req": "Clicks per strategy",
  "capability": "clicks_ctr",
  "dim": "strategy",
  "how": "Recs Report strategy tab. DAS: CLICK rows carry STRATEGY_ID / STRATEGY_NAME and the clicked SKU.",
  "rr": "yes",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R5",
  "pri": "MUST",
  "req": "Add-to-cart per slot",
  "capability": "add_to_cart",
  "dim": "slot",
  "how": "Experience Report: Add to Cart as a secondary metric per variation (user-level, not tied to the clicked product). DAS: CLICK on SKU X followed by DPX 'Add to Cart' with productId X in the session.",
  "rr": "no",
  "er": "partial",
  "das": "yes"
 },
 {
  "id": "R6",
  "pri": "MUST",
  "req": "Add-to-cart per strategy",
  "capability": "add_to_cart",
  "dim": "strategy",
  "how": "DAS only: same click -> ATC join, grouped by STRATEGY_NAME of the click.",
  "rr": "no",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R7",
  "pri": "MUST",
  "req": "Products purchased per slot",
  "capability": "units_purchased",
  "dim": "slot",
  "how": "Recs Report: direct purchases/revenue per campaign. Experience Report: purchases per variation (user-level). DAS: units of the clicked SKU in the Purchase cart.",
  "rr": "partial",
  "er": "partial",
  "das": "yes"
 },
 {
  "id": "R8",
  "pri": "MUST",
  "req": "Products purchased per strategy",
  "capability": "units_purchased",
  "dim": "strategy",
  "how": "Recs Report: direct revenue per strategy. DAS: units / orders grouped by the clicked strategy.",
  "rr": "partial",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R9",
  "pri": "MUST",
  "req": "Conversion rate (orders / impressions) per slot",
  "capability": "conversion_rate",
  "dim": "slot",
  "how": "UI gives CTR, revenue per 1,000 impressions and the user conversion rate per variation. DAS lets the customer use its own definition: attributed orders / impressions.",
  "rr": "partial",
  "er": "partial",
  "das": "yes"
 },
 {
  "id": "R10",
  "pri": "MUST",
  "req": "Conversion rate per strategy",
  "capability": "conversion_rate",
  "dim": "strategy",
  "how": "As A9, grouped by strategy.",
  "rr": "partial",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R11",
  "pri": "MUST",
  "req": "Attributed revenue per slot (click -> PDP -> order)",
  "capability": "attributed_revenue",
  "dim": "slot",
  "how": "Recs Report 'direct revenue' = purchase of a clicked recommended item within the attribution window (default 30 days, configurable). DAS: rebuild the exact click -> PDP view -> purchase path per SKU.",
  "rr": "yes",
  "er": "partial",
  "das": "yes"
 },
 {
  "id": "R12",
  "pri": "MUST",
  "req": "Attributed revenue per strategy",
  "capability": "attributed_revenue",
  "dim": "strategy",
  "how": "Recs Report strategy tab (direct revenue, revenue per 1,000 impressions). DAS: the same path grouped by strategy.",
  "rr": "yes",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R13",
  "pri": "MUST",
  "req": "Add-on revenue per slot (PDP -> reco click -> PDP -> order) vs initial PDP",
  "capability": "addon_revenue",
  "dim": "slot",
  "how": "Not a standard UI metric (the Recs Report has direct and assisted revenue). DAS: the anchor product comes from CONTEXT_DATA of the PDP click; compare reco-item revenue with anchor-item revenue in the same order.",
  "rr": "partial",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R14",
  "pri": "MUST",
  "req": "Add-on revenue per strategy",
  "capability": "addon_revenue",
  "dim": "strategy",
  "how": "DAS only: as A13, grouped by strategy.",
  "rr": "no",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R15",
  "pri": "MUST",
  "req": "Product clicks per product ID, by slot",
  "capability": "product_clicks",
  "dim": "slot",
  "how": "DAS only: SKUS on CLICK rows, grouped by CAMPAIGN_NAME. Note: DAS has no SKU-level impressions, so this is a click count, not a product CTR.",
  "rr": "no",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R16",
  "pri": "MUST",
  "req": "Product clicks per product ID, by strategy",
  "capability": "product_clicks",
  "dim": "strategy",
  "how": "DAS only: SKUS on CLICK rows, grouped by STRATEGY_NAME.",
  "rr": "no",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R17",
  "pri": "MUST",
  "req": "Time-over-time comparison per slot (WoW, YoY, range)",
  "capability": "time_comparison",
  "dim": "slot",
  "how": "UI: free date-range picker, but no built-in WoW/YoY delta. DAS: any comparison. NB: DAS files are kept only 30 days in S3, so the customer must store them daily in BigQuery to get YoY.",
  "rr": "partial",
  "er": "partial",
  "das": "yes"
 },
 {
  "id": "R18",
  "pri": "MUST",
  "req": "Time-over-time comparison per strategy",
  "capability": "time_comparison",
  "dim": "strategy",
  "how": "As A17, grouped by strategy.",
  "rr": "partial",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R19",
  "pri": "MUST",
  "req": "Historical trend per slot",
  "capability": "trend",
  "dim": "slot",
  "how": "Recs Report monthly/weekly/daily trend. Experience Report data over time per variation. DAS: daily time series.",
  "rr": "yes",
  "er": "yes",
  "das": "yes"
 },
 {
  "id": "R20",
  "pri": "MUST",
  "req": "Historical trend per strategy",
  "capability": "trend",
  "dim": "strategy",
  "how": "UI strategy tab for a selected date range. DAS: daily series per strategy.",
  "rr": "partial",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R21",
  "pri": "MUST",
  "req": "Filters: site, device, locale, country, slot, category, strategy",
  "capability": "filters",
  "how": "UI: site via section, device and audience breakdowns in the Experience Report. DAS: every dimension. Country and locale come from SECTION_ID / URL; category comes from a join with the product feed.",
  "rr": "partial",
  "er": "partial",
  "das": "yes"
 },
 {
  "id": "R22",
  "pri": "MUST",
  "req": "Export to CSV",
  "capability": "csv_export",
  "how": "Experience Report CSV export plus revenue event log. DAS: Parquet files, and every BI widget exports to CSV (try the download buttons).",
  "rr": "partial",
  "er": "yes",
  "das": "yes"
 },
 {
  "id": "R23",
  "pri": "SHOULD",
  "req": "Real-time dashboard",
  "capability": "realtime_gap",
  "how": "DAS and the UI reports refresh daily. The Experience Report has a 'Today' near-real-time view. For true real time, also send reco click events to GA4 or a stream (the DY Experience API response holds slot and strategy IDs).",
  "rr": "no",
  "er": "partial",
  "das": "no"
 },
 {
  "id": "R24",
  "pri": "SHOULD",
  "req": "Segment performance (new/returning, device, traffic source)",
  "capability": "segments",
  "how": "Experience Report audience breakdown (device, traffic source, new vs returning, custom audiences). DAS: AUDIENCES_NAMES, DEVICE, TRAFFIC_SOURCE.",
  "rr": "no",
  "er": "yes",
  "das": "yes"
 },
 {
  "id": "R25",
  "pri": "SHOULD",
  "req": "Category-level performance",
  "capability": "category_performance",
  "how": "The Recs Report shows revenue by page type. DAS + product feed join gives page (context) category and recommended-product category.",
  "rr": "partial",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R26",
  "pri": "SHOULD",
  "req": "API / feed to BigQuery",
  "capability": "bigquery_feed",
  "how": "DAS delivers daily Parquet to S3 (s3://dy-raw-data-export[-eu]/sectionId=/date=/reportType=). Load with BigQuery Data Transfer Service (Amazon S3 source) or Storage Transfer.",
  "rr": "no",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R27",
  "pri": "SHOULD",
  "req": "Product attribute analysis (colour, price, material)",
  "capability": "product_attributes",
  "how": "DAS clicked SKU joined with the the product feed (color_group, material_group, price band). Measured as click share and click -> order rate; no CTR per attribute (no SKU-level impressions).",
  "rr": "no",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R28",
  "pri": "SHOULD",
  "req": "Business rule performance",
  "capability": "business_rule_test",
  "how": "Best: A/B test the rule as a variation (with vs without), then read the Experience Report (probability to be best, uplift, credible intervals). DAS: the same variations at product level.",
  "rr": "partial",
  "er": "yes",
  "das": "yes"
 },
 {
  "id": "R29",
  "pri": "MUST",
  "req": "Product-level performance per slot",
  "capability": "product_performance",
  "dim": "slot",
  "how": "DAS: clicks, click share, ATC, units, revenue and click -> order rate per SKU x slot. GAP: DAS has no SKU-level impressions, so no product impressions or product CTR. Workaround: The customer logs the served SKUs from the DY API response / client callback to BigQuery.",
  "rr": "no",
  "er": "no",
  "das": "partial"
 },
 {
  "id": "R30",
  "pri": "MUST",
  "req": "Product-level performance per strategy",
  "capability": "product_performance",
  "dim": "strategy",
  "how": "As A29, per SKU x strategy. Same gap: no product impressions or product CTR in DAS.",
  "rr": "no",
  "er": "no",
  "das": "partial"
 },
 {
  "id": "R31",
  "pri": "MUST",
  "req": "Click-to-conversion funnel (click, ATC, order; main -> reco product sold)",
  "capability": "funnel",
  "how": "DAS: impression -> click -> PDP view -> ATC -> order per slot, plus anchor -> recommended product pairs.",
  "rr": "no",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R32",
  "pri": "MUST",
  "req": "Recommendation coverage (% of products receiving recos)",
  "capability": "coverage",
  "how": "DAS: viewed PDP SKUs with a STRATEGY_IMPRESSION (the strategy returned results) / all viewed PDP SKUs, per slot. Compare with the catalog from the feed. If the customer means '% of products that are shown AS a recommendation': DAS cannot measure this (no SKU-level impressions); clicked SKUs give only a lower bound.",
  "rr": "no",
  "er": "no",
  "das": "yes"
 },
 {
  "id": "R33",
  "pri": "SHOULD",
  "req": "Scheduled reports & alerts",
  "capability": "alerts",
  "how": "Check the current DY scheduling and email options for the UI reports. On DAS: BI-native schedules and alerts (Looker / Power BI / Looker Studio), e.g. CTR drop > 20% WoW.",
  "rr": "partial",
  "er": "partial",
  "das": "yes"
 },
 {
  "id": "R34",
  "pri": "COULD",
  "req": "Recommendation influence on in-store (offline) sales",
  "capability": "gap",
  "how": "DAS only contains online DY events. Offline sales are not in DAS.",
  "options": [
   "Send offline transactions to DY as a Purchase event with the customer's CUID, then they appear in DAS.",
   "Join DAS to the customer's own POS data in BigQuery on a shared customer ID."
  ],
  "rr": "no",
  "er": "no",
  "das": "no"
 }
];
