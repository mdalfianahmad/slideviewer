import { useEffect, useState } from 'react';

export interface ViewportSize {
    width: number;
    height: number;
    pixelRatio: number;
}

/**
 * Hook to track viewport size and device pixel ratio
 * Used for image sizing optimization
 */
export function useViewportSize(): ViewportSize {
    const [size, setSize] = useState<ViewportSize>(() => ({
        width: typeof window !== 'undefined' ? window.innerWidth : 1920,
        height: typeof window !== 'undefined' ? window.innerHeight : 1080,
        pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    }));

    useEffect(() => {
        const updateSize = () => {
            setSize({
                width: window.innerWidth,
                height: window.innerHeight,
                pixelRatio: window.devicePixelRatio || 1,
            });
        };

        // Initial update
        updateSize();

        // Listen for resize events
        window.addEventListener('resize', updateSize);
        window.addEventListener('orientationchange', updateSize);

        return () => {
            window.removeEventListener('resize', updateSize);
            window.removeEventListener('orientationchange', updateSize);
        };
    }, []);

    return size;
}

/**
 * Calculate optimal image width based on viewport and pixel ratio
 * Mobile: 1x resolution, Desktop: 2x for retina (max 1920px)
 */
export function getOptimalImageWidth(viewportWidth: number, pixelRatio: number): number {
    // Calculate optimal width based on viewport
    const baseWidth = viewportWidth;
    
    // Apply pixel ratio (retina displays need 2x)
    const scaledWidth = baseWidth * pixelRatio;
    
    // Cap at 1920px (no need for larger images)
    return Math.min(scaledWidth, 1920);
}
