// IndexedDB caching for slide images to reduce latency

const DB_NAME = 'slideviewer_cache';
const DB_VERSION = 1;
const STORE_NAME = 'slides';

interface CachedSlide {
    presentationId: string;
    slideNumber: number;
    imageUrl: string;
    thumbnailUrl: string | null;
    imageBlob: Blob;
    thumbnailBlob: Blob | null;
    cachedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Initialize IndexedDB database
 */
function initDB(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            
            // Create object store if it doesn't exist
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: ['presentationId', 'slideNumber'] });
                store.createIndex('presentationId', 'presentationId', { unique: false });
                store.createIndex('cachedAt', 'cachedAt', { unique: false });
            }
        };
    });

    return dbPromise;
}

/**
 * Convert URL to Blob
 */
async function urlToBlob(url: string): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);
    return response.blob();
}

/**
 * Cache a slide image
 */
export async function cacheSlide(
    presentationId: string,
    slideNumber: number,
    imageUrl: string,
    thumbnailUrl: string | null = null
): Promise<void> {
    try {
        // Fetch images BEFORE opening transaction to avoid transaction timeout
        const [imageBlob, thumbnailBlob] = await Promise.all([
            urlToBlob(imageUrl),
            thumbnailUrl ? urlToBlob(thumbnailUrl).catch(() => null) : Promise.resolve(null),
        ]);

        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        const cachedSlide: CachedSlide = {
            presentationId,
            slideNumber,
            imageUrl,
            thumbnailUrl,
            imageBlob,
            thumbnailBlob,
            cachedAt: Date.now(),
        };

        await new Promise<void>((resolve, reject) => {
            // Ensure transaction doesn't complete before request
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            
            const request = store.put(cachedSlide);
            request.onerror = () => reject(request.error);
            
            // If request succeeds, wait for transaction to complete
            request.onsuccess = () => {
                // Transaction will complete automatically, oncomplete will fire
            };
        });
    } catch (error) {
        console.warn('Failed to cache slide:', error);
        // Don't throw - caching is optional
    }
}

/**
 * Cache multiple slides with priority (load priority slides first)
 */
export async function cacheSlides(
    presentationId: string,
    slides: Array<{ slideNumber: number; imageUrl: string; thumbnailUrl: string | null }>,
    priorityIndices: number[] = []
): Promise<void> {
    // Separate priority and non-priority slides
    const prioritySlides: typeof slides = [];
    const normalSlides: typeof slides = [];

    slides.forEach((slide, index) => {
        if (priorityIndices.includes(index)) {
            prioritySlides.push(slide);
        } else {
            normalSlides.push(slide);
        }
    });

    // Cache priority slides first
    await Promise.all(
        prioritySlides.map((slide) =>
            cacheSlide(presentationId, slide.slideNumber, slide.imageUrl, slide.thumbnailUrl)
        )
    );

    // Then cache remaining slides in background
    normalSlides.forEach((slide) => {
        cacheSlide(presentationId, slide.slideNumber, slide.imageUrl, slide.thumbnailUrl).catch(() => {
            // Ignore errors for background caching
        });
    });
}

/**
 * Get cached slide image URL (as blob URL)
 */
export async function getCachedSlide(
    presentationId: string,
    slideNumber: number,
    preferThumbnail: boolean = false
): Promise<string | null> {
    try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const key = [presentationId, slideNumber];

        const cachedSlide = await new Promise<CachedSlide | null>((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });

        if (!cachedSlide) return null;

        // Return blob URL for the requested image
        const blob = preferThumbnail && cachedSlide.thumbnailBlob
            ? cachedSlide.thumbnailBlob
            : cachedSlide.imageBlob;

        return URL.createObjectURL(blob);
    } catch (error) {
        console.warn('Failed to get cached slide:', error);
        return null;
    }
}

/**
 * Check if a slide is cached
 */
export async function isSlideCached(
    presentationId: string,
    slideNumber: number
): Promise<boolean> {
    try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const key = [presentationId, slideNumber];

        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(!!request.result);
            request.onerror = () => reject(request.error);
        });
    } catch {
        return false;
    }
}

/**
 * Clear all cached slides for a presentation
 */
export async function clearPresentationCache(presentationId: string): Promise<void> {
    try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('presentationId');

        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.only(presentationId));
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('Failed to clear presentation cache:', error);
    }
}

/**
 * Clear all cached slides (cleanup old cache)
 */
export async function clearAllCache(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('cachedAt');
        const cutoff = Date.now() - maxAge;

        return new Promise((resolve, reject) => {
            const request = index.openCursor(IDBKeyRange.upperBound(cutoff));
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.warn('Failed to clear old cache:', error);
    }
}

/**
 * Get cache size estimate (approximate)
 */
export async function getCacheSize(): Promise<number> {
    try {
        const db = await initDB();
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);

        return new Promise((resolve, reject) => {
            let size = 0;
            const request = store.openCursor();
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
                if (cursor) {
                    const slide = cursor.value as CachedSlide;
                    size += slide.imageBlob.size;
                    if (slide.thumbnailBlob) {
                        size += slide.thumbnailBlob.size;
                    }
                    cursor.continue();
                } else {
                    resolve(size);
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch {
        return 0;
    }
}
