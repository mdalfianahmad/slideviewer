import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBackgroundLoader } from './imagePreloader';

// Fake Image that records requests and lets the test finish them by hand
const requested: FakeImage[] = [];
class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decoding = 'auto';
    fetchPriority = 'auto';
    private _src = '';
    set src(v: string) {
        this._src = v;
        requested.push(this);
    }
    get src() {
        return this._src;
    }
}

const finishOldest = () => requested.find((i) => i.onload)?.onload?.();
const urls = (n: number) => Array.from({ length: n }, (_, i) => `s${i}`);
const order = () => requested.map((i) => i.src);

describe('createBackgroundLoader', () => {
    beforeEach(() => {
        requested.length = 0;
        vi.stubGlobal('Image', FakeImage);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('downloads every slide, at most `concurrency` at a time', () => {
        const loader = createBackgroundLoader({ concurrency: 2 });
        loader.setUrls(urls(5));
        expect(order()).toEqual(['s0', 's1']);

        for (let i = 0; i < 5; i++) finishOldest();
        expect(order()).toEqual(['s0', 's1', 's2', 's3', 's4']);
    });

    it('goes forward from the cursor first, then backward', () => {
        const loader = createBackgroundLoader({ concurrency: 1 });
        loader.setCursor(3);
        loader.setUrls(urls(6));
        for (let i = 0; i < 6; i++) finishOldest();
        expect(order()).toEqual(['s3', 's4', 's5', 's2', 's1', 's0']);
    });

    it('re-prioritises when the presenter jumps ahead', () => {
        const loader = createBackgroundLoader({ concurrency: 1 });
        loader.setUrls(urls(10)); // requests s0
        finishOldest(); // s1
        loader.setCursor(7);
        finishOldest(); // next should be s7, not s2
        expect(order()).toEqual(['s0', 's1', 's7']);
    });

    it('reports progress', () => {
        const progress: Array<[number, number]> = [];
        const loader = createBackgroundLoader({
            concurrency: 2,
            onProgress: (d, t) => progress.push([d, t]),
        });
        loader.setUrls(urls(3));
        for (let i = 0; i < 3; i++) finishOldest();
        expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
    });

    it('stops requesting after stop()', () => {
        const loader = createBackgroundLoader({ concurrency: 1 });
        loader.setUrls(urls(3));
        loader.stop();
        finishOldest();
        expect(order()).toEqual(['s0']);
    });
});
