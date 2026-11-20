import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake realtime client + heartbeat emitter
const listeners = new Set<(s: string) => void>();
const rt = {
    connected: true,
    connecting: false,
    conn: {} as object | null,
    answerHeartbeat: true as boolean,
    isConnected: () => rt.connected,
    isConnecting: () => rt.connecting,
    sendHeartbeat: vi.fn(async () => {
        if (rt.answerHeartbeat) setTimeout(() => listeners.forEach((l) => l('ok')), 5);
    }),
    disconnect: vi.fn(() => {
        rt.connected = false;
    }),
    connect: vi.fn(() => {
        rt.connecting = true;
    }),
};

vi.mock('./supabase', () => ({
    supabase: { realtime: rt },
    onRealtimeHeartbeat: (l: (s: string) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
    },
}));

const { ensureRealtimeConnected, probeRealtime } = await import('./realtimeHealth');

describe('realtimeHealth', () => {
    beforeEach(() => {
        Object.assign(rt, { connected: true, connecting: false, conn: {}, answerHeartbeat: true });
        rt.disconnect.mockClear();
        rt.connect.mockClear();
        listeners.clear();
    });

    it('probe succeeds when the server answers', async () => {
        expect(await probeRealtime(100)).toBe(true);
    });

    it('probe fails on a dead socket that never answers', async () => {
        rt.answerHeartbeat = false;
        expect(await probeRealtime(50)).toBe(false);
    });

    it('leaves a healthy socket alone', async () => {
        expect(await ensureRealtimeConnected()).toBe('ok');
        expect(rt.disconnect).not.toHaveBeenCalled();
        expect(rt.connect).not.toHaveBeenCalled();
    });

    it('reconnects a socket that is open but dead', async () => {
        rt.answerHeartbeat = false;
        expect(await ensureRealtimeConnected()).toBe('reconnected');
        expect(rt.disconnect).toHaveBeenCalledOnce();
        expect(rt.connect).toHaveBeenCalledOnce();
    }, 5000);

    it('connects straight away when the socket is closed', async () => {
        rt.connected = false;
        rt.conn = null;
        expect(await ensureRealtimeConnected()).toBe('reconnected');
        expect(rt.disconnect).not.toHaveBeenCalled();
        expect(rt.connect).toHaveBeenCalledOnce();
    });
});
