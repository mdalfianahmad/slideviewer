import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    getRecentPresentations,
    addRecentPresentation,
    removeRecentPresentation,
    clearAllStorage,
} from '../lib/storage';

// Interface matching the actual storage module
interface RecentPresentation {
    id: string;
    title: string;
    slideCount: number;
    createdAt: string;
    thumbnailUrl?: string;
    presenterToken?: string;
}

describe('storage utilities', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    describe('getRecentPresentations', () => {
        it('should return empty array when no presentations stored', () => {
            expect(getRecentPresentations()).toEqual([]);
        });

        it('should return stored presentations', () => {
            const presentation: RecentPresentation = {
                id: 'test-id',
                title: 'Test Presentation',
                slideCount: 10,
                createdAt: new Date().toISOString(),
                presenterToken: 'token-123',
            };
            addRecentPresentation(presentation);

            const result = getRecentPresentations();
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('test-id');
        });
    });

    describe('addRecentPresentation', () => {
        it('should add a presentation to storage', () => {
            const presentation: RecentPresentation = {
                id: 'test-id',
                title: 'Test Presentation',
                slideCount: 5,
                createdAt: new Date().toISOString(),
                presenterToken: 'token-123',
            };

            addRecentPresentation(presentation);

            const stored = getRecentPresentations();
            expect(stored).toHaveLength(1);
            expect(stored[0].title).toBe('Test Presentation');
        });

        it('should add new presentations at the beginning', () => {
            const pres1: RecentPresentation = {
                id: 'id-1',
                title: 'First',
                slideCount: 1,
                createdAt: new Date().toISOString(),
                presenterToken: 'token-1',
            };
            const pres2: RecentPresentation = {
                id: 'id-2',
                title: 'Second',
                slideCount: 2,
                createdAt: new Date().toISOString(),
                presenterToken: 'token-2',
            };

            addRecentPresentation(pres1);
            addRecentPresentation(pres2);

            const stored = getRecentPresentations();
            expect(stored[0].title).toBe('Second');
            expect(stored[1].title).toBe('First');
        });

        it('should not duplicate presentations with same id', () => {
            const presentation: RecentPresentation = {
                id: 'same-id',
                title: 'Original',
                slideCount: 3,
                createdAt: new Date().toISOString(),
                presenterToken: 'token-123',
            };

            addRecentPresentation(presentation);
            addRecentPresentation({ ...presentation, title: 'Updated' });

            const stored = getRecentPresentations();
            expect(stored).toHaveLength(1);
            expect(stored[0].title).toBe('Updated');
        });

        it('should keep only last 10 presentations', () => {
            for (let i = 0; i < 15; i++) {
                addRecentPresentation({
                    id: `id-${i}`,
                    title: `Pres ${i}`,
                    slideCount: i,
                    createdAt: new Date().toISOString(),
                });
            }

            expect(getRecentPresentations()).toHaveLength(10);
        });
    });

    describe('removeRecentPresentation', () => {
        it('should remove a presentation by id', () => {
            const presentation: RecentPresentation = {
                id: 'to-remove',
                title: 'Test',
                slideCount: 5,
                createdAt: new Date().toISOString(),
            };

            addRecentPresentation(presentation);
            expect(getRecentPresentations()).toHaveLength(1);

            removeRecentPresentation('to-remove');
            expect(getRecentPresentations()).toHaveLength(0);
        });

        it('should not fail when removing non-existent id', () => {
            removeRecentPresentation('non-existent');
            expect(getRecentPresentations()).toEqual([]);
        });
    });

    describe('clearAllStorage', () => {
        it('should remove all slideviewer data', () => {
            for (let i = 0; i < 5; i++) {
                addRecentPresentation({
                    id: `id-${i}`,
                    title: `Pres ${i}`,
                    slideCount: i,
                    createdAt: new Date().toISOString(),
                });
            }

            expect(getRecentPresentations().length).toBeGreaterThan(0);
            clearAllStorage();
            expect(getRecentPresentations()).toHaveLength(0);
        });
    });
});
