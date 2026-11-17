-- =====================================================================================
-- vidaXL · DY Daily Activity Stream -> BigQuery reporting models
-- Same logic as engine/build_model.py (which powers the demo dashboard).
-- Assumes the daily Parquet files are loaded (BigQuery Data Transfer Service, Amazon S3 source)
-- from  s3://dy-raw-data-export-eu/sectionId=*/date=*/reportType=raw|attribution/
-- into  dy.das_raw  and  dy.das_attribution  (partitioned by SECTION_DATE),
-- plus  dy.product_feed  (the DY product feed export).
-- DAS keeps files for 30 days -> schedule the transfer daily to build history (WoW / YoY).
-- =====================================================================================

-- 1) Session-enriched events --------------------------------------------------------------
CREATE OR REPLACE VIEW dy.stg_events AS
SELECT
  r.*,
  CONCAT(DY_ID, ':', SESSION_ID)                                         AS session_key,
  CASE
    WHEN STARTS_WITH(URL_CLEAN, 'https://www.vidaxl.co.uk/') THEN 'UK'
    WHEN STARTS_WITH(URL_CLEAN, 'https://www.vidaxl.be/nl/') THEN 'BE'
    WHEN STARTS_WITH(URL_CLEAN, 'https://www.vidaxl.be/fr/') THEN 'BE'
    WHEN STARTS_WITH(URL_CLEAN, 'https://www.vidaxl.nl/') THEN 'NL'
    WHEN STARTS_WITH(URL_CLEAN, 'https://www.vidaxl.de/') THEN 'DE'
    WHEN STARTS_WITH(URL_CLEAN, 'https://www.vidaxl.fr/') THEN 'FR'
  END AS country,
  CASE
    WHEN STARTS_WITH(URL_CLEAN, 'https://www.vidaxl.co.uk/') THEN 'en-GB'
    WHEN STARTS_WITH(URL_CLEAN, 'https://www.vidaxl.be/nl/') THEN 'nl-BE'
    WHEN STARTS_WITH(URL_CLEAN, 'https://www.vidaxl.be/fr/') THEN 'fr-BE'
    WHEN STARTS_WITH(URL_CLEAN, 'https://www.vidaxl.nl/') THEN 'nl-NL'
    WHEN STARTS_WITH(URL_CLEAN, 'https://www.vidaxl.de/') THEN 'de-DE'
    WHEN STARTS_WITH(URL_CLEAN, 'https://www.vidaxl.fr/') THEN 'fr-FR'
  END AS locale,
  IF(AUDIENCES_NAMES LIKE '%Returning%', 'Returning', 'New')              AS segment,
  JSON_VALUE(CONTEXT_DATA, '$[0]')                                       AS context_item,   -- PDP SKU / category
  JSON_VALUE(VARIATION_NAMES, '$[0]')                                    AS variation,
  JSON_VALUE(SKUS, '$[0]')                                               AS clicked_sku
FROM dy.das_raw r;

-- 2) Impressions / clicks per slot x strategy x dims (impressions, clicks_ctr, time_comparison, trend, filters) ----------------------
CREATE OR REPLACE TABLE dy.fct_reco_engagement PARTITION BY SECTION_DATE AS
SELECT e.SECTION_DATE, e.country, e.locale, e.DEVICE, e.segment, e.TRAFFIC_SOURCE,
       e.CAMPAIGN_NAME AS slot, e.variation, e.STRATEGY_NAME AS strategy,
       COALESCE(f.top_category, IF(e.CONTEXT_TYPE = 'CATEGORY', e.context_item, CONCAT('(', LOWER(e.CONTEXT_TYPE), ')'))) AS page_category,
       COUNTIF(e.ENGAGEMENT_TYPE = 'STRATEGY_IMPRESSION') AS impressions,
       COUNTIF(e.ENGAGEMENT_TYPE = 'CLICK')               AS clicks
FROM dy.stg_events e
LEFT JOIN dy.product_feed f ON e.CONTEXT_TYPE = 'PRODUCT' AND f.sku = e.context_item
WHERE e.EVENT_TYPE = 'VARIATION_ENGAGEMENT' AND e.ENGAGEMENT_TYPE IN ('STRATEGY_IMPRESSION', 'CLICK')
GROUP BY ALL;

-- 3) Reco clicks with the downstream path (add_to_cart … product_performance, funnel) --------------------------------
CREATE OR REPLACE TABLE dy.fct_reco_clicks PARTITION BY SECTION_DATE AS
WITH clicks AS (
  SELECT INTERACTION_ID AS click_id, session_key, REQ_TIMESTAMP AS click_ts, SECTION_DATE, country, locale, DEVICE,
         segment, TRAFFIC_SOURCE, CAMPAIGN_NAME AS slot, variation, STRATEGY_NAME AS strategy, clicked_sku AS sku,
         IF(CONTEXT_TYPE = 'PRODUCT', context_item, NULL) AS anchor_sku          -- the PDP the click came from (addon_revenue)
  FROM dy.stg_events WHERE EVENT_TYPE = 'VARIATION_ENGAGEMENT' AND ENGAGEMENT_TYPE = 'CLICK'
),
pdp_views AS (
  SELECT DISTINCT c.click_id
  FROM clicks c JOIN dy.stg_events v
    ON v.session_key = c.session_key AND v.context_item = c.sku AND v.REQ_TIMESTAMP > c.click_ts
  WHERE v.EVENT_TYPE = 'UIA' AND v.CONTEXT_TYPE = 'PRODUCT'
),
atc AS (
  SELECT INTERACTION_ID AS atc_id, session_key, JSON_VALUE(EVENT_PROPERTIES, '$.productId') AS sku, REQ_TIMESTAMP AS ts
  FROM dy.stg_events WHERE EVENT_TYPE = 'DPX' AND EVENT_NAME = 'Add to Cart'
),
order_lines AS (
  SELECT INTERACTION_ID AS order_id, session_key, REQ_TIMESTAMP AS ts,
         JSON_VALUE(item, '$.productId') AS sku,
         CAST(JSON_VALUE(item, '$.quantity') AS FLOAT64) AS qty,
         CAST(JSON_VALUE(item, '$.quantity') AS FLOAT64) * CAST(JSON_VALUE(item, '$.itemPrice') AS FLOAT64) AS revenue
  FROM dy.stg_events, UNNEST(JSON_QUERY_ARRAY(EVENT_PROPERTIES, '$.cart')) AS item
  WHERE EVENT_TYPE = 'DPX' AND EVENT_NAME = 'Purchase'
),
-- last reco click on the same SKU before the event wins
atc_attr AS (
  SELECT ARRAY_AGG(c.click_id ORDER BY c.click_ts DESC LIMIT 1)[OFFSET(0)] AS click_id
  FROM atc a JOIN clicks c ON c.session_key = a.session_key AND c.sku = a.sku AND c.click_ts < a.ts
  GROUP BY a.atc_id
),
order_attr AS (
  SELECT o.order_id, o.qty, o.revenue,
         ARRAY_AGG(c.click_id ORDER BY c.click_ts DESC LIMIT 1)[OFFSET(0)] AS click_id
  FROM order_lines o JOIN clicks c ON c.session_key = o.session_key AND c.sku = o.sku AND c.click_ts < o.ts
  GROUP BY o.order_id, o.sku, o.qty, o.revenue
),
atc_per_click AS (SELECT click_id, COUNT(*) AS add_to_carts FROM atc_attr GROUP BY click_id),
orders_per_click AS (
  SELECT oa.click_id, COUNT(DISTINCT oa.order_id) AS orders, SUM(oa.qty) AS units, SUM(oa.revenue) AS attributed_revenue,
         -- addon_revenue: revenue of the anchor (initial PDP) product in the same order(s)
         SUM(COALESCE(anc.revenue, 0)) AS anchor_revenue
  FROM order_attr oa
  JOIN clicks c USING (click_id)
  LEFT JOIN order_lines anc ON anc.order_id = oa.order_id AND anc.sku = c.anchor_sku
  GROUP BY oa.click_id
)
SELECT c.*,
       c.click_id IN (SELECT click_id FROM pdp_views)  AS pdp_viewed,
       COALESCE(a.add_to_carts, 0)                      AS add_to_carts,
       COALESCE(o.orders, 0)                            AS orders,
       COALESCE(o.units, 0)                             AS units,
       COALESCE(o.attributed_revenue, 0)                AS attributed_revenue,
       COALESCE(o.anchor_revenue, 0)                    AS anchor_revenue
FROM clicks c
LEFT JOIN atc_per_click a USING (click_id)
LEFT JOIN orders_per_click o USING (click_id);

-- 4) Slot / strategy KPI view for the BI tool (slot / strategy KPIs) -------------------------------------
CREATE OR REPLACE VIEW dy.rpt_reco_kpis AS
SELECT e.*, SAFE_DIVIDE(e.clicks, e.impressions) AS ctr,
       k.add_to_carts, k.orders, k.units, k.attributed_revenue, k.addon_revenue, k.anchor_revenue,
       SAFE_DIVIDE(k.orders, e.impressions)                     AS conversion_rate,            -- conversion_rate (orders / impressions)
       SAFE_DIVIDE(k.attributed_revenue, e.impressions) * 1000  AS revenue_per_1k_impressions
FROM (SELECT SECTION_DATE, country, locale, DEVICE, segment, TRAFFIC_SOURCE, slot, variation, strategy,
             SUM(impressions) AS impressions, SUM(clicks) AS clicks
      FROM dy.fct_reco_engagement GROUP BY ALL) e
LEFT JOIN (
  SELECT SECTION_DATE, country, locale, DEVICE, segment, TRAFFIC_SOURCE, slot, variation, strategy,
         SUM(add_to_carts) AS add_to_carts, SUM(orders) AS orders, SUM(units) AS units,
         SUM(attributed_revenue) AS attributed_revenue,
         SUM(IF(anchor_sku IS NOT NULL, attributed_revenue, 0)) AS addon_revenue,           -- addon_revenue
         SUM(anchor_revenue) AS anchor_revenue
  FROM dy.fct_reco_clicks GROUP BY ALL) k
USING (SECTION_DATE, country, locale, DEVICE, segment, TRAFFIC_SOURCE, slot, variation, strategy);

-- 5) Time-over-time (time_comparison): WoW and YoY (364 days = weekday aligned) ---------------------
CREATE OR REPLACE VIEW dy.rpt_reco_tot AS
WITH d AS (SELECT SECTION_DATE, slot, strategy, SUM(impressions) AS imp, SUM(clicks) AS clk, SUM(attributed_revenue) AS rev
           FROM dy.rpt_reco_kpis GROUP BY ALL)
SELECT cur.*, wow.rev AS rev_wow, yoy.rev AS rev_yoy,
       SAFE_DIVIDE(cur.rev - wow.rev, wow.rev) AS rev_wow_pct, SAFE_DIVIDE(cur.rev - yoy.rev, yoy.rev) AS rev_yoy_pct
FROM d cur
LEFT JOIN d wow ON wow.slot = cur.slot AND wow.strategy = cur.strategy AND wow.SECTION_DATE = DATE_SUB(cur.SECTION_DATE, INTERVAL 7 DAY)
LEFT JOIN d yoy ON yoy.slot = cur.slot AND yoy.strategy = cur.strategy AND yoy.SECTION_DATE = DATE_SUB(cur.SECTION_DATE, INTERVAL 364 DAY);

-- 6) Product level per slot / strategy + attributes (product_clicks, category_performance, product_attributes, product_performance) -----------
CREATE OR REPLACE VIEW dy.rpt_reco_products AS
SELECT c.SECTION_DATE, c.country, c.DEVICE, c.slot, c.strategy, c.sku,
       f.name, f.top_category, f.color_group, f.material_group, f.price,
       CASE WHEN f.price < 25 THEN '< 25' WHEN f.price < 50 THEN '25-50' WHEN f.price < 100 THEN '50-100'
            WHEN f.price < 200 THEN '100-200' ELSE '200+' END AS price_band,
       COUNT(*) AS clicks, SUM(c.add_to_carts) AS add_to_carts, SUM(c.orders) AS orders, SUM(c.units) AS units,
       SUM(c.attributed_revenue) AS revenue
FROM dy.fct_reco_clicks c LEFT JOIN dy.product_feed f ON f.sku = c.sku
GROUP BY ALL;

-- 7) Main product -> recommended product sold (funnel) ---------------------------------------
CREATE OR REPLACE VIEW dy.rpt_reco_pairs AS
SELECT slot, strategy, anchor_sku, sku AS reco_sku, COUNT(*) AS clicks, SUM(add_to_carts) AS add_to_carts,
       SUM(orders) AS orders, SUM(attributed_revenue) AS reco_revenue, SUM(anchor_revenue) AS anchor_revenue
FROM dy.fct_reco_clicks WHERE anchor_sku IS NOT NULL GROUP BY ALL;

-- 8) Recommendation coverage on PDP slots (coverage) -------------------------------------------
--    STRATEGY_IMPRESSION is only logged when the strategy returned results.
CREATE OR REPLACE VIEW dy.rpt_reco_coverage AS
WITH viewed AS (
  SELECT DISTINCT country, context_item AS sku FROM dy.stg_events
  WHERE EVENT_TYPE = 'UIA' AND CONTEXT_TYPE = 'PRODUCT' AND SECTION_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)
), served AS (
  SELECT DISTINCT country, CAMPAIGN_NAME AS slot, context_item AS sku FROM dy.stg_events
  WHERE ENGAGEMENT_TYPE = 'STRATEGY_IMPRESSION' AND CONTEXT_TYPE = 'PRODUCT'
    AND SECTION_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 28 DAY)
), slots AS (SELECT DISTINCT slot FROM served)
SELECT v.country, s.slot, COUNT(*) AS skus_viewed, COUNTIF(sv.sku IS NOT NULL) AS skus_with_recos,
       SAFE_DIVIDE(COUNTIF(sv.sku IS NOT NULL), COUNT(*)) AS coverage,
       (SELECT COUNT(*) FROM dy.product_feed) AS catalog_skus
FROM viewed v CROSS JOIN slots s
LEFT JOIN served sv ON sv.country = v.country AND sv.slot = s.slot AND sv.sku = v.sku
GROUP BY ALL;

-- 9) DY-style attributed revenue from the attribution table (reconciliation with the DY UI) --
CREATE OR REPLACE VIEW dy.rpt_dy_attribution AS
SELECT a.SECTION_DATE, CAST(JSON_VALUE(a.VARIATIONS, '$[0]') AS INT64) AS variation_id,
       COUNT(DISTINCT a.INTERACTION_ID) AS orders, SUM(a.EVENT_VALUE) / 100 AS revenue   -- EVENT_VALUE is in cents
FROM dy.das_attribution a
WHERE a.EVENT_ID = 27000001          -- Purchase event id (site specific)
GROUP BY ALL;
