import { describe, it, expect } from 'vitest';
import { createLatestWinsWriter, createSeqGate, nextSeq } from './slideSync';

describe('nextSeq', () => {
    it('is strictly increasing even within the same millisecond', () => {
        const a = nextSeq();
        const b = nextSeq();
        const c = nextSeq();
        expect(b).toBeGreaterThan(a);
        expect(c).toBeGreaterThan(b);
    });
});

describe('createSeqGate', () => {
    it('drops stale and duplicate messages', () => {
        const gate = createSeqGate();
        expect(gate.accept(10)).toBe(true);
        expect(gate.accept(9)).toBe(false); // late, older message
        expect(gate.accept(10)).toBe(false); // duplicate
        expect(gate.accept(11)).toBe(true);
    });

    it('rejects invalid sequence numbers', () => {
        const gate = createSeqGate();
        expect(gate.accept(Number.NaN)).toBe(false);
        expect(gate.accept(undefined as unknown as number)).toBe(false);
    });
});

describe('createLatestWinsWriter', () => {
    it('never runs writes concurrently and ends on the newest value', async () => {
        const written: number[] = [];
        let active = 0;
        let maxActive = 0;
        const releases: Array<() => void> = [];

        const write = createLatestWinsWriter<number>(async (v) => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise<void>((r) => releases.push(r));
            written.push(v);
            active--;
        });

        // Rapid clicks: 2, 3, 4, 5 while the first write is in flight
        write(2);
        write(3);
        write(4);
        write(5);

        // Release writes one by one
        while (releases.length) {
            releases.shift()!();
            await new Promise((r) => setTimeout(r, 0));
        }

        expect(maxActive).toBe(1);
        expect(written).toEqual([2, 5]); // intermediate values collapsed
        expect(written[written.length - 1]).toBe(5);
    });

    it('keeps going after a failed write', async () => {
        const written: number[] = [];
        let first = true;
        const write = createLatestWinsWriter<number>(async (v) => {
            if (first) {
                first = false;
                throw new Error('network');
            }
            written.push(v);
        });

        write(1);
        write(2);
        await new Promise((r) => setTimeout(r, 0));
        expect(written).toEqual([2]);
    });
});
