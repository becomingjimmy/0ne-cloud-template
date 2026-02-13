-- =============================================================================
-- KPI Instant Filtering - Phase 1: Enhanced Aggregation Tables
-- =============================================================================
-- Created: 2026-02-12
-- Purpose: Add dimension tables and indexes for instant client-side filtering
-- Run via: psql "$DATABASE_URL" -f packages/db/migrations/2026-02-12-instant-filtering.sql

-- =============================================================================
-- 1) DIMENSION TABLES FOR FAST FILTER POPULATION
-- =============================================================================
-- These track available filter options with counts for quick UI population

-- Source dimension table
CREATE TABLE IF NOT EXISTS dimension_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT UNIQUE NOT NULL,
  display_name TEXT,
  contact_count INTEGER DEFAULT 0,
  last_seen_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dimension_sources_active ON dimension_sources(is_active);

-- Campaign dimension table
CREATE TABLE IF NOT EXISTS dimension_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_name TEXT,
  contact_count INTEGER DEFAULT 0,
  last_seen_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dimension_campaigns_active ON dimension_campaigns(is_active);

-- Stage dimension table (for funnel stage counts)
CREATE TABLE IF NOT EXISTS dimension_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stage TEXT UNIQUE NOT NULL,
  display_name TEXT,
  color TEXT,
  sort_order INTEGER DEFAULT 0,
  contact_count INTEGER DEFAULT 0,
  last_updated DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dimension_stages_order ON dimension_stages(sort_order);

-- Expense category dimension
CREATE TABLE IF NOT EXISTS dimension_expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT UNIQUE NOT NULL,
  display_name TEXT,
  color TEXT,
  expense_count INTEGER DEFAULT 0,
  total_amount DECIMAL(12,2) DEFAULT 0,
  is_system BOOLEAN DEFAULT false,
  last_used_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 2) ENHANCED DAILY AGGREGATES INDEXES
-- =============================================================================
-- Add compound indexes for fast filtered queries

-- Source + date index for source-filtered queries
CREATE INDEX IF NOT EXISTS idx_daily_agg_source_date ON daily_aggregates(source, date);

-- Campaign + source + date for multi-dimension queries
CREATE INDEX IF NOT EXISTS idx_daily_agg_campaign_source_date ON daily_aggregates(campaign_id, source, date);

-- =============================================================================
-- 3) DAILY EXPENSES BY CATEGORY (Pre-aggregated)
-- =============================================================================
-- For instant expense filtering without querying expenses table

CREATE TABLE IF NOT EXISTS daily_expenses_by_category (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  category TEXT NOT NULL,
  amount DECIMAL(12,2) DEFAULT 0,
  is_system BOOLEAN DEFAULT false,
  expense_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(date, category)
);

CREATE INDEX IF NOT EXISTS idx_daily_expenses_date ON daily_expenses_by_category(date);
CREATE INDEX IF NOT EXISTS idx_daily_expenses_category ON daily_expenses_by_category(category);

-- =============================================================================
-- 4) WEEKLY TRENDS (Pre-computed sparklines)
-- =============================================================================
-- Pre-computed weekly aggregates for sparkline charts

CREATE TABLE IF NOT EXISTS weekly_trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL,
  week_number TEXT, -- e.g., '2026-W06'
  source TEXT, -- NULL = all sources
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,

  -- Funnel metrics
  new_leads INTEGER DEFAULT 0,
  new_hand_raisers INTEGER DEFAULT 0,
  new_qualified INTEGER DEFAULT 0,
  new_clients INTEGER DEFAULT 0,

  -- Revenue metrics
  total_revenue DECIMAL(12,2) DEFAULT 0,
  ad_spend DECIMAL(12,2) DEFAULT 0,

  -- Unit economics (pre-calculated)
  cost_per_lead DECIMAL(10,2),
  cost_per_client DECIMAL(10,2),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(week_start, source, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_trends_week ON weekly_trends(week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_trends_source ON weekly_trends(source);

-- =============================================================================
-- 5) ENABLE RLS ON NEW TABLES
-- =============================================================================

ALTER TABLE dimension_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE dimension_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE dimension_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE dimension_expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_expenses_by_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_trends ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 6) CREATE RLS POLICIES (Service role full access)
-- =============================================================================

CREATE POLICY "Service role full access" ON dimension_sources FOR ALL USING (true);
CREATE POLICY "Service role full access" ON dimension_campaigns FOR ALL USING (true);
CREATE POLICY "Service role full access" ON dimension_stages FOR ALL USING (true);
CREATE POLICY "Service role full access" ON dimension_expense_categories FOR ALL USING (true);
CREATE POLICY "Service role full access" ON daily_expenses_by_category FOR ALL USING (true);
CREATE POLICY "Service role full access" ON weekly_trends FOR ALL USING (true);

-- =============================================================================
-- 7) SEED DIMENSION TABLES WITH EXISTING DATA
-- =============================================================================

-- Seed dimension_sources from contacts
INSERT INTO dimension_sources (source, display_name, contact_count, last_seen_date, is_active)
SELECT
  source,
  CASE source
    WHEN 'meta_ads' THEN 'Meta Ads'
    WHEN 'youtube' THEN 'YouTube'
    WHEN 'organic' THEN 'Organic'
    WHEN 'referral' THEN 'Referral'
    WHEN 'google_ads' THEN 'Google Ads'
    ELSE INITCAP(REPLACE(source, '_', ' '))
  END,
  COUNT(*),
  MAX(created_at::DATE),
  true
FROM contacts
WHERE source IS NOT NULL
GROUP BY source
ON CONFLICT (source) DO UPDATE SET
  contact_count = EXCLUDED.contact_count,
  last_seen_date = EXCLUDED.last_seen_date;

-- Seed dimension_stages from config (hardcoded values matching config.ts)
INSERT INTO dimension_stages (stage, display_name, color, sort_order, contact_count) VALUES
  ('member', 'Member', '#94a3b8', 0, 0),
  ('hand_raiser', 'Hand Raiser', '#60a5fa', 1, 0),
  ('qualified_premium', 'Qualified (Premium)', '#a78bfa', 2, 0),
  ('qualified_vip', 'Qualified (VIP)', '#8b5cf6', 3, 0),
  ('offer_made_premium', 'Offer Made (Premium)', '#f59e0b', 4, 0),
  ('offer_made_vip', 'Offer Made (VIP)', '#eab308', 5, 0),
  ('offer_seen', 'Offer Seen', '#fb923c', 6, 0),
  ('premium', 'Premium', '#22c55e', 7, 0),
  ('vip', 'VIP', '#10b981', 8, 0)
ON CONFLICT (stage) DO NOTHING;

-- Update stage counts from contacts
UPDATE dimension_stages ds
SET contact_count = (
  SELECT COUNT(*)
  FROM contacts c
  WHERE c.current_stage = ds.stage
),
last_updated = CURRENT_DATE;

-- Seed dimension_campaigns from campaigns table
INSERT INTO dimension_campaigns (campaign_id, campaign_name, is_active)
SELECT id, name, is_active
FROM campaigns
ON CONFLICT DO NOTHING;

-- =============================================================================
-- 8) VERIFICATION
-- =============================================================================

SELECT 'dimension_sources' as table_name, COUNT(*) as rows FROM dimension_sources
UNION ALL
SELECT 'dimension_stages', COUNT(*) FROM dimension_stages
UNION ALL
SELECT 'dimension_campaigns', COUNT(*) FROM dimension_campaigns;
