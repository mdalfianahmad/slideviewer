// Slide sync over Supabase Realtime Broadcast.
//
// Presenter -> viewers messages go over a broadcast channel (no database round-trip).
// The database write of `current_slide_index` is kept for late joiners and the
// polling fallback, but it is no longer on the hot path.

export const SLIDE_EVENT = 'slide';
export const SYNC_REQUEST_EVENT = 'sync-request';
export const ENDED_EVENT = 'ended';

export interface SlideMessage {
    slide: number;
    seq: number;
}

/** Realtime topic shared by the presenter and all viewers of a presentation. */
export function slideSyncTopic(presentationId: string): string {
    return `slide-sync:${presentationId}`;
}

let lastSeq = 0;

/**
 * Monotonic sequence number. Time-based so a presenter that reloads the page
 * still outranks the messages it sent before the reload.
 */
export function nextSeq(): number {
    lastSeq = Math.max(Date.now(), lastSeq + 1);
    return lastSeq;
}

/** Accepts a message only if it is newer than every message accepted before it. */
export function createSeqGate() {
    let latest = 0;
    return {
        accept(seq: number): boolean {
            if (!Number.isFinite(seq) || seq <= latest) return false;
            latest = seq;
            return true;
        },
    };
}

/**
 * Wraps an async write so that at most one call is in flight and only the
 * newest value is written next. Writes can therefore never land out of order,
 * and rapid clicks collapse into one trailing write.
 */
export function createLatestWinsWriter<T>(write: (value: T) => Promise<void>): (value: T) => void {
    let inFlight = false;
    let pending: { value: T } | null = null;

    async function flush() {
        while (pending) {
            const { value } = pending;
            pending = null;
            inFlight = true;
            try {
                await write(value);
            } catch (err) {
                console.error('Slide write failed:', err);
            } finally {
                inFlight = false;
            }
        }
    }

    return (value: T) => {
        pending = { value };
        if (!inFlight) void flush();
    };
}
