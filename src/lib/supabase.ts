import { createClient } from '@supabase/supabase-js';

// Environment variables for Supabase connection
// These should be set in .env file
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
        'Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.'
    );
}

// Create Supabase client
// This client is used for all database operations, storage, and realtime subscriptions
export const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder-key',
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
        },
        realtime: {
            params: {
                eventsPerSecond: 10,
            },
        },
    }
);

// TODO: [AUTH] When authentication is added:
// - Enable persistSession: true
// - Enable autoRefreshToken: true
// - Add auth state listener: supabase.auth.onAuthStateChange()

// Storage bucket name for slide images
export const SLIDES_BUCKET = 'slides';

// Helper to get public URL for a stored file
export function getPublicUrl(bucket: string, path: string): string {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
}
