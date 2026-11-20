// Realtime connection health checks.
//
// Phones suspend WebSockets when the screen locks or the browser is
// backgrounded. The socket can come back "open" but dead, and the library only
// notices on its next heartbeat. These helpers check immediately on wake.

import { supabase, onRealtimeHeartbeat } from './supabase';

const PROBE_TIMEOUT_MS = 2000;

/** Send a heartbeat now and resolve true if the server answers in time. */
export function probeRealtime(timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
    if (!supabase.realtime.isConnected()) return Promise.resolve(false);

    return new Promise((resolve) => {
        let done = false;
        const finish = (ok: boolean) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            unsubscribe();
            resolve(ok);
        };
        const unsubscribe = onRealtimeHeartbeat((status) => {
            if (status === 'ok') finish(true);
            else if (status === 'timeout' || status === 'error' || status === 'disconnected') finish(false);
        });
        const timer = window.setTimeout(() => finish(false), timeoutMs);
        void supabase.realtime.sendHeartbeat();
    });
}

/**
 * Make sure the realtime socket is alive. Returns 'ok' if it already was, or
 * 'reconnected' if a new socket was opened (callers should then recreate their
 * channels so they join immediately instead of waiting for rejoin timers).
 */
export async function ensureRealtimeConnected(): Promise<'ok' | 'reconnected'> {
    const rt = supabase.realtime;

    if (rt.isConnected() && (await probeRealtime())) return 'ok';

    if (rt.isConnecting()) return 'reconnected';

    if (rt.conn) {
        rt.disconnect();
        // disconnect() settles within ~100ms; connect() is ignored until then
        await new Promise((r) => setTimeout(r, 150));
    }
    rt.connect();
    return 'reconnected';
}
