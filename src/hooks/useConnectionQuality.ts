import { useEffect, useState } from 'react';

export type ConnectionQuality = 'fast' | 'slow' | 'unknown';

interface NetworkInformation {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
}

/**
 * Hook to detect network connection quality
 * Returns 'fast' for 4G with >2Mbps, 'slow' otherwise
 */
export function useConnectionQuality(): ConnectionQuality {
    const [quality, setQuality] = useState<ConnectionQuality>('unknown');

    useEffect(() => {
        // Check for Network Information API
        const conn = (navigator as any).connection || 
                     (navigator as any).mozConnection || 
                     (navigator as any).webkitConnection as NetworkInformation | undefined;

        if (conn) {
            const updateQuality = () => {
                const effectiveType = conn.effectiveType;
                const downlink = conn.downlink;
                const rtt = conn.rtt;

                // Determine quality based on connection info
                if (effectiveType === '4g' && downlink && downlink > 2) {
                    setQuality('fast');
                } else if (effectiveType === '4g' || (downlink && downlink > 1)) {
                    // 4G but slower, or good downlink
                    setQuality('fast');
                } else if (rtt && rtt < 100) {
                    // Low latency suggests good connection
                    setQuality('fast');
                } else {
                    setQuality('slow');
                }
            };

            // Initial check
            updateQuality();

            // Listen for changes
            conn.addEventListener('change', updateQuality);

            return () => {
                conn.removeEventListener('change', updateQuality);
            };
        } else {
            // API not available, assume fast (most modern devices are fast)
            setQuality('fast');
        }
    }, []);

    return quality;
}
