// Windowed image preloading.
//
// Only the slides around the current one are fetched and decoded, so the slide
// you are about to show is never stuck in a queue behind hundreds of others.

import { useEffect, useState } from 'react';

interface Entry {
    img: HTMLImageElement;
    ready: Promise<void>;
    done: boolean;
}

// Small LRU of decoded images. Older bytes stay in the HTTP / service worker cache.
const MAX_ENTRIES = 40;
const entries = new Map<string, Entry>();

function touch(url: string, entry: Entry) {
    entries.delete(url);
    entries.set(url, entry);
    while (entries.size > MAX_ENTRIES) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
    }
}

/** Fetch and decode an image. Resolves even on error so callers never hang. */
export function preloadImage(url: string): Promise<void> {
    const existing = entries.get(url);
    if (existing) {
        touch(url, existing);
        return existing.ready;
    }

    const img = new Image();
    img.decoding = 'async';
    img.src = url;

    const loaded: Promise<void> = typeof img.decode === 'function'
        ? img.decode()
        : new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error(`Failed to load ${url}`));
        });

    const entry: Entry = { img, ready: Promise.resolve(), done: false };
    entry.ready = loaded
        .then(() => {
            entry.done = true;
        })
        .catch(() => {
            // Drop failed entries so a later call retries.
            entries.delete(url);
        });

    touch(url, entry);
    return entry.ready;
}

export function isImageReady(url: string): boolean {
    return entries.get(url)?.done ?? false;
}

/**
 * Preload the item at `index` first, then `ahead` items after it and `behind`
 * items before it. `items` must be in display order.
 */
export function preloadAround<T>(
    items: T[],
    index: number,
    getUrls: (item: T) => Array<string | null | undefined>,
    { ahead = 3, behind = 1 }: { ahead?: number; behind?: number } = {}
): void {
    if (index < 0 || index >= items.length) return;

    const order: number[] = [index];
    for (let i = 1; i <= Math.max(ahead, behind); i++) {
        if (i <= ahead && index + i < items.length) order.push(index + i);
        if (i <= behind && index - i >= 0) order.push(index - i);
    }

    for (const i of order) {
        for (const url of getUrls(items[i])) {
            if (url) void preloadImage(url);
        }
    }
}

/**
 * Returns the URL to render for `url`: the URL itself once it is decoded,
 * otherwise the last URL that was ready. This keeps the previous slide on
 * screen instead of flashing a half-loaded image.
 */
export function useReadyImage(url: string | null): string | null {
    const [lastReady, setLastReady] = useState<string | null>(null);

    useEffect(() => {
        if (!url) return;
        let cancelled = false;
        preloadImage(url).then(() => {
            if (!cancelled) setLastReady(url);
        });
        return () => {
            cancelled = true;
        };
    }, [url]);

    if (!url) return null;
    if (url === lastReady || isImageReady(url)) return url;
    return lastReady ?? url;
}
