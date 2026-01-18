import { useState, useCallback, useEffect } from 'react';

interface UseFullscreenReturn {
    isFullscreen: boolean;
    toggleFullscreen: () => void;
    isSupported: boolean;
}

export function useFullscreen(): UseFullscreenReturn {
    const [isFullscreen, setIsFullscreen] = useState(false);

    const isSupported = typeof document !== 'undefined' &&
        !!(document.documentElement.requestFullscreen ||
            (document.documentElement as any).webkitRequestFullscreen);

    useEffect(() => {
        const handleChange = () => {
            setIsFullscreen(!!(
                document.fullscreenElement ||
                (document as any).webkitFullscreenElement
            ));
        };

        document.addEventListener('fullscreenchange', handleChange);
        document.addEventListener('webkitfullscreenchange', handleChange);

        return () => {
            document.removeEventListener('fullscreenchange', handleChange);
            document.removeEventListener('webkitfullscreenchange', handleChange);
        };
    }, []);

    const toggleFullscreen = useCallback(() => {
        const doc = document as any;
        const elem = document.documentElement as any;

        if (!document.fullscreenElement && !doc.webkitFullscreenElement) {
            // Enter fullscreen
            if (elem.requestFullscreen) {
                elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) {
                elem.webkitRequestFullscreen();
            }
        } else {
            // Exit fullscreen
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (doc.webkitExitFullscreen) {
                doc.webkitExitFullscreen();
            }
        }
    }, []);

    return { isFullscreen, toggleFullscreen, isSupported };
}
