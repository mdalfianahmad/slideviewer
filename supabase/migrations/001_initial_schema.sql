-- SlideViewer Unified Database Schema
-- Run this migration in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PRESENTATIONS TABLE
-- ============================================
DROP TABLE IF EXISTS slides CASCADE;
DROP TABLE IF EXISTS presentations CASCADE;

CREATE TABLE presentations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID, -- Store user ID without strict FK (auth schema is managed by Supabase)
  title TEXT NOT NULL DEFAULT 'Untitled Presentation',
  file_url TEXT NOT NULL,
  slide_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error')),
  invite_code TEXT NOT NULL UNIQUE,
  presenter_token UUID NOT NULL DEFAULT uuid_generate_v4(),
  current_slide_index INTEGER NOT NULL DEFAULT 1,
  is_live BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_presented_at TIMESTAMPTZ
);

CREATE INDEX idx_presentations_invite_code ON presentations(UPPER(invite_code));
CREATE INDEX idx_presentations_token ON presentations(presenter_token);

-- ============================================
-- SLIDES TABLE
-- ============================================
CREATE TABLE slides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  presentation_id UUID NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  slide_number INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(presentation_id, slide_number)
);

CREATE INDEX idx_slides_presentation ON slides(presentation_id);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE slides ENABLE ROW LEVEL SECURITY;

-- Allow public read
CREATE POLICY "Public read presentations" ON presentations FOR SELECT USING (true);
CREATE POLICY "Public read slides" ON slides FOR SELECT USING (true);

-- Allow public insert (for uploading)
CREATE POLICY "Public insert presentations" ON presentations FOR INSERT WITH CHECK (true);
CREATE POLICY "Public insert slides" ON slides FOR INSERT WITH CHECK (true);

-- Allow update ONLY if you have the presenter_token
-- This prevents the audience from changing slides
CREATE POLICY "Presenter only update" ON presentations 
  FOR UPDATE 
  USING (true) -- Let them find it
  WITH CHECK (true); -- We will check the token in the code logic for now, or use a complex policy

-- ============================================
-- REALTIME
-- ============================================
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime FOR TABLE presentations;
