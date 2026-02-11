-- =============================================================================
-- SKOOL CATEGORIES CACHE
-- Cache of Skool community categories/labels fetched from the Skool page
-- Run: psql "$DATABASE_URL" -f packages/db/schemas/skool-categories.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS skool_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Group this category belongs to
  group_slug TEXT NOT NULL DEFAULT 'fruitful',

  -- Category details from Skool
  skool_id TEXT NOT NULL,             -- Skool's internal label/category ID
  name TEXT NOT NULL,                  -- Display name (e.g., "The Money Room")
  position INTEGER,                    -- Sort order from Skool

  -- Cache metadata
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint on group_slug + skool_id
  UNIQUE(group_slug, skool_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_skool_categories_group_slug
  ON skool_categories(group_slug);

CREATE INDEX IF NOT EXISTS idx_skool_categories_fetched_at
  ON skool_categories(fetched_at DESC);

-- RLS
ALTER TABLE skool_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON skool_categories FOR ALL USING (true);

-- Function to upsert categories (replace all for a group)
CREATE OR REPLACE FUNCTION upsert_skool_categories(
  p_group_slug TEXT,
  p_categories JSONB
)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Delete existing categories for this group
  DELETE FROM skool_categories WHERE group_slug = p_group_slug;

  -- Insert new categories
  INSERT INTO skool_categories (group_slug, skool_id, name, position, fetched_at)
  SELECT
    p_group_slug,
    (cat->>'id')::TEXT,
    cat->>'name',
    (cat->>'position')::INTEGER,
    NOW()
  FROM jsonb_array_elements(p_categories) AS cat;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
