// Local storage utilities for SlideViewer

const STORAGE_PREFIX = 'slideviewer_';

interface RecentPresentation {
    id: string;
    title: string;
    slideCount: number;
    createdAt: string;
    thumbnailUrl?: string;
    presenterToken?: string; // Add this
}

/**
 * Get recent presentations from local storage
 */
export function getRecentPresentations(): RecentPresentation[] {
    try {
        const stored = localStorage.getItem(`${STORAGE_PREFIX}recent_presentations`);
        if (!stored) return [];
        return JSON.parse(stored);
    } catch {
        return [];
    }
}

/**
 * Add a presentation to recent list
 * Keeps only the last 10 presentations
 */
export function addRecentPresentation(presentation: RecentPresentation): void {
    try {
        const recent = getRecentPresentations();
        // Remove if already exists
        const filtered = recent.filter((p) => p.id !== presentation.id);
        // Add to front
        filtered.unshift(presentation);
        // Keep only last 10
        const trimmed = filtered.slice(0, 10);
        localStorage.setItem(
            `${STORAGE_PREFIX}recent_presentations`,
            JSON.stringify(trimmed)
        );
    } catch {
        // Ignore storage errors
    }
}

/**
 * Remove a presentation from recent list
 */
export function removeRecentPresentation(id: string): void {
    try {
        const recent = getRecentPresentations();
        const filtered = recent.filter((p) => p.id !== id);
        localStorage.setItem(
            `${STORAGE_PREFIX}recent_presentations`,
            JSON.stringify(filtered)
        );
    } catch {
        // Ignore storage errors
    }
}

/**
 * Store the last viewed slide for offline support
 */
export function setLastViewedSlide(sessionId: string, slideUrl: string): void {
    try {
        localStorage.setItem(`${STORAGE_PREFIX}last_slide_${sessionId}`, slideUrl);
    } catch {
        // Ignore storage errors
    }
}

/**
 * Get the last viewed slide for offline fallback
 */
export function getLastViewedSlide(sessionId: string): string | null {
    try {
        return localStorage.getItem(`${STORAGE_PREFIX}last_slide_${sessionId}`);
    } catch {
        return null;
    }
}

/**
 * Clear all SlideViewer data from local storage
 */
export function clearAllStorage(): void {
    try {
        const keys = Object.keys(localStorage);
        keys.forEach((key) => {
            if (key.startsWith(STORAGE_PREFIX)) {
                localStorage.removeItem(key);
            }
        });
    } catch {
        // Ignore storage errors
    }
}
