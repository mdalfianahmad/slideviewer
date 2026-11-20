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

// Realtime heartbeat listeners (see realtimeHealth.ts)
type HeartbeatStatus = 'sent' | 'ok' | 'error' | 'timeout' | 'disconnected';
const heartbeatListeners = new Set<(status: HeartbeatStatus) => void>();
export function onRealtimeHeartbeat(listener: (status: HeartbeatStatus) => void): () => void {
    heartbeatListeners.add(listener);
    return () => heartbeatListeners.delete(listener);
}

// Reconnect fast. The library default backs off 1s, 2s, 5s, then 10s, and the
// same schedule is used for channels rejoining, so a phone waking up could
// wait up to 10s before live updates resumed.
const FAST_RECONNECT_MS = [200, 500, 1000, 2000];
const reconnectAfterMs = (tries: number) => FAST_RECONNECT_MS[tries - 1] ?? 3000;

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
            // Detect a dead connection in ~15s instead of the default 25s
            heartbeatIntervalMs: 15000,
            reconnectAfterMs,
            heartbeatCallback: (status: HeartbeatStatus) => {
                heartbeatListeners.forEach((l) => l(status));
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
