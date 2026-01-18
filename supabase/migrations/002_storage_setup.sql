-- Storage Bucket Setup for SlideViewer
-- Run these commands in the Supabase SQL Editor

-- Create the slides bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('slides', 'slides', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow public read access to slide images
CREATE POLICY "Public read access for slides"
ON storage.objects FOR SELECT
USING (bucket_id = 'slides');

-- Allow anyone to upload (no auth for MVP)
-- TODO: [AUTH] Restrict to authenticated users
CREATE POLICY "Allow public uploads to slides"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'slides');

-- TODO: [AUTH] Add delete policy for presentation owners
-- CREATE POLICY "Allow owners to delete slides"
-- ON storage.objects FOR DELETE
-- USING (
--   bucket_id = 'slides' 
--   AND auth.uid() = owner_id
-- );
