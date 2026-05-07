-- Supabase schema for Node Banana boards
-- Run this in Supabase SQL Editor

-- Boards table
CREATE TABLE IF NOT EXISTS boards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  board_name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  status TEXT DEFAULT 'draft',
  notes TEXT DEFAULT '',
  workflow_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Board images table (stores base64 images separately to keep boards table fast)
CREATE TABLE IF NOT EXISTS board_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  image_key TEXT NOT NULL,
  image_data TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(board_id, image_key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_boards_client_id ON boards(client_id);
CREATE INDEX IF NOT EXISTS idx_boards_updated_at ON boards(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_board_images_board_id ON board_images(board_id);

-- Enable RLS (but allow all for service role)
ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_images ENABLE ROW LEVEL SECURITY;

-- Policies: allow all for service role (used server-side)
CREATE POLICY "Allow all for service role" ON boards FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for service role" ON board_images FOR ALL USING (true) WITH CHECK (true);
