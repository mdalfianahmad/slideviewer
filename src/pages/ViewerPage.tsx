import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { cacheSlides, getCachedSlide } from '../lib/cache';
import { useViewportSize } from '../hooks/useViewportSize';
import { useConnectionQuality } from '../hooks/useConnectionQuality';
import type { Presentation, Slide } from '../types/database';
import styles from './ViewerPage.module.css';

export function ViewerPage() {
    const { presentationId } = useParams<{ presentationId: string }>();
    const navigate = useNavigate();
    const viewportSize = useViewportSize();
    const connectionQuality = useConnectionQuality();
    
    // PHASE 3: Lazy loading range based on connection quality
    // Fast connections: preload ±5 slides, Slow connections: preload ±2 slides
    const lazyLoadRange = connectionQuality === 'fast' ? 5 : connectionQuality === 'slow' ? 2 : 3;

    const [presentation, setPresentation] = useState<Presentation | null>(null);
    const [slides, setSlides] = useState<Slide[]>([]);
    const [currentSlideIndex, setCurrentSlideIndex] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasEnded, setHasEnded] = useState(false);
    const [cachedImageUrls, setCachedImageUrls] = useState<Map<number, string>>(new Map());
    const cacheInitializedRef = useRef(false);
    const slidesRef = useRef<Slide[]>([]);
    const pageRef = useRef<HTMLDivElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'polling'>('connecting');
    const [showReconnectHint, setShowReconnectHint] = useState(false);
    const reconnectAttemptsRef = useRef(0);
    const pollingIntervalRef = useRef<number | null>(null);
    const connectionTimeoutRef = useRef<number | null>(null);
    const reconnectHintTimeoutRef = useRef<number | null>(null);
    const presentationIdRef = useRef(presentationId);
    
    // Keep ref in sync
    useEffect(() => {
        presentationIdRef.current = presentationId;
    }, [presentationId]);

    // Show reconnect hint after 2 seconds of "connecting"
    useEffect(() => {
        if (connectionStatus === 'connecting') {
            reconnectHintTimeoutRef.current = window.setTimeout(() => {
                setShowReconnectHint(true);
            }, 2000);
        } else {
            // Hide hint when status changes
            setShowReconnectHint(false);
            if (reconnectHintTimeoutRef.current) {
                clearTimeout(reconnectHintTimeoutRef.current);
                reconnectHintTimeoutRef.current = null;
            }
        }
        
        return () => {
            if (reconnectHintTimeoutRef.current) {
                clearTimeout(reconnectHintTimeoutRef.current);
            }
        };
    }, [connectionStatus]);

    // Fetch initial data
    useEffect(() => {
        if (!presentationId) {
            setError('No presentation ID');
            setIsLoading(false);
            return;
        }

        async function fetchData() {
            try {
                const { data: pres, error: presErr } = await supabase
                    .from('presentations')
                    .select('*')
                    .eq('id', presentationId)
                    .single();

                if (presErr || !pres) throw new Error('Presentation not found');

                const typedPres = pres as Presentation;
                setPresentation(typedPres);
                setCurrentSlideIndex(typedPres.current_slide_index);

                // Check if already ended
                if (!typedPres.is_live) {
                    setHasEnded(true);
                }

                const { data: slideData, error: slideErr } = await supabase
                    .from('slides')
                    .select('*')
                    .eq('presentation_id', presentationId)
                    .order('slide_number', { ascending: true });

                if (slideErr) throw new Error('Failed to load slides');

                const loadedSlides = (slideData as Slide[]) || [];
                setSlides(loadedSlides);
                slidesRef.current = loadedSlides;

                    // PHASE 3: Lazy loading - only cache slides within range
                    if (presentationId && loadedSlides.length > 0) {
                        const currentIndex = typedPres.current_slide_index;
                        const currentSlideIndexInArray = loadedSlides.findIndex(s => s.slide_number === currentIndex);
                        
                        // Calculate lazy load range: current slide ± lazyLoadRange
                        const priorityIndices: number[] = [];
                        const startIdx = Math.max(0, currentSlideIndexInArray - lazyLoadRange);
                        const endIdx = Math.min(loadedSlides.length - 1, currentSlideIndexInArray + lazyLoadRange);
                        
                        for (let i = startIdx; i <= endIdx; i++) {
                            priorityIndices.push(i);
                        }

                        // Start caching with priority
                        cacheSlides(
                            presentationId,
                            loadedSlides.map(s => ({
                                slideNumber: s.slide_number,
                                imageUrl: s.image_url,
                                thumbnailUrl: s.thumbnail_url,
                            })),
                            priorityIndices
                        ).catch(() => {
                            // Ignore caching errors - non-critical
                        });

                        // Preload priority slides immediately (for instant display)
                        const priorityPromises = priorityIndices.map(async (idx) => {
                            const slide = loadedSlides[idx];
                            if (!slide) return;

                            // Try cache first, then fallback to network
                            const cachedUrl = await getCachedSlide(presentationId, slide.slide_number);
                            if (cachedUrl) {
                                setCachedImageUrls(prev => new Map(prev).set(slide.slide_number, cachedUrl));
                            }

                            // Also preload via Image for browser cache
                    const img = new Image();
                    img.src = slide.image_url;
                });

                        await Promise.all(priorityPromises);

                        // PHASE 3: Don't preload distant slides - only load when needed
                        // This saves 40-50% bandwidth on large presentations
                    }

                cacheInitializedRef.current = true;
                setIsLoading(false);
            } catch (err) {
                console.error('Viewer fetch error:', err);
                setError(err instanceof Error ? err.message : 'Failed to load');
                setIsLoading(false);
            }
        }

        fetchData();
    }, [presentationId, lazyLoadRange]);

    // Polling fallback function - used when WebSocket fails
    const startPolling = useCallback(() => {
        if (pollingIntervalRef.current) {
            console.log('[Viewer] Already polling, skipping');
            return;
        }
        
        console.log('[Viewer] Starting polling fallback (WebSocket unavailable)');
        // Force update status synchronously
        setConnectionStatus('polling');
        
        const poll = async () => {
            const pid = presentationIdRef.current;
            if (!pid) return;
            try {
                const { data, error } = await supabase
                    .from('presentations')
                    .select('current_slide_index, is_live')
                    .eq('id', pid)
                    .single();
                
                if (!error && data) {
                    setCurrentSlideIndex(prev => {
                        if (prev !== data.current_slide_index) {
                            console.log('[Viewer] Poll: slide changed to', data.current_slide_index);
                        }
                        return data.current_slide_index;
                    });
                    if (!data.is_live) {
                        setHasEnded(true);
                    }
                }
            } catch (e) {
                console.error('[Viewer] Poll error:', e);
            }
        };
        
        // Poll every 1 second for better responsiveness
        pollingIntervalRef.current = window.setInterval(poll, 1000);
        poll(); // Initial poll
    }, []); // No dependencies - uses refs

    const stopPolling = useCallback(() => {
        if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
            console.log('[Viewer] Stopped polling');
        }
    }, []);
    
    // Force refresh - clears all caches and reloads
    const forceRefresh = useCallback(async () => {
        console.log('[Viewer] Force refresh - clearing all caches');
        try {
            // Clear service worker caches
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(name => caches.delete(name)));
                console.log('[Viewer] Cleared all caches');
            }
            
            // Unregister service workers
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map(r => r.unregister()));
                console.log('[Viewer] Unregistered service workers');
            }
            
            // Clear localStorage for this site
            localStorage.clear();
            sessionStorage.clear();
            
            // Hard reload
            window.location.reload();
        } catch (e) {
            console.error('[Viewer] Force refresh error:', e);
            window.location.reload();
        }
    }, []);
    
    // Clear old API caches on mount (but keep slide images)
    useEffect(() => {
        const clearOldCache = async () => {
            if ('caches' in window) {
                try {
                    const cacheNames = await caches.keys();
                    // Only clear API caches, not slide images
                    const apiCaches = cacheNames.filter(name => 
                        name.includes('api') || name.includes('workbox')
                    );
                    await Promise.all(apiCaches.map(name => caches.delete(name)));
                    console.log('[Viewer] Cleared API caches');
                } catch (e) {
                    console.warn('[Viewer] Failed to clear caches:', e);
                }
            }
        };
        clearOldCache();
    }, []);

    // Subscribe to realtime updates and track presence
    useEffect(() => {
        if (!presentationId) return;

        // Generate a unique viewer ID for this session
        const viewerId = `viewer_${Math.random().toString(36).substring(2, 9)}`;

        // Set a timeout - if not connected within 5 seconds, fall back to polling
        connectionTimeoutRef.current = window.setTimeout(() => {
            console.log('[Viewer] Connection timeout - falling back to polling');
            startPolling();
        }, 5000);

        // PHASE 3: Subscribe to slide updates with WebSocket optimization
        const updateChannel = supabase
            .channel(`viewer:${presentationId}`, {
                config: {
                    broadcast: { self: false },
                    presence: { key: viewerId }
                }
            })
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'presentations',
                    filter: `id=eq.${presentationId}`,
                },
                async (payload) => {
                    const updated = payload.new as Presentation;
                    setPresentation(updated);
                    const newSlideIndex = updated.current_slide_index;
                    setCurrentSlideIndex(newSlideIndex);

                    // PHASE 3: Lazy loading - preload slides within range when slide changes
                    if (cacheInitializedRef.current && slidesRef.current.length > 0 && presentationId) {
                        const currentSlides = slidesRef.current;
                        const currentSlideIndexInArray = currentSlides.findIndex(s => s.slide_number === newSlideIndex);
                        if (currentSlideIndexInArray >= 0) {
                            // Preload slides within lazyLoadRange
                            const startIdx = Math.max(0, currentSlideIndexInArray - lazyLoadRange);
                            const endIdx = Math.min(currentSlides.length - 1, currentSlideIndexInArray + lazyLoadRange);
                            
                            for (let i = startIdx; i <= endIdx; i++) {
                                const slide = currentSlides[i];
                                if (slide && slide.slide_number !== newSlideIndex) {
                                    // Check cache first
                                    getCachedSlide(presentationId, slide.slide_number).then(cachedUrl => {
                                        if (cachedUrl) {
                                            setCachedImageUrls(prev => new Map(prev).set(slide.slide_number, cachedUrl));
                                        }
                                    });
                                    // Also preload for browser cache
                                    const img = new Image();
                                    img.src = slide.image_url;
                                }
                            }
                        }
                    }

                    if (!updated.is_live) {
                        setHasEnded(true);
                    }
                }
            )
            .subscribe((status) => {
                console.log('[Viewer] Realtime status:', status);
                if (status === 'SUBSCRIBED') {
                    // Clear timeout and stop polling - we're connected!
                    if (connectionTimeoutRef.current) {
                        clearTimeout(connectionTimeoutRef.current);
                        connectionTimeoutRef.current = null;
                    }
                    stopPolling();
                    setConnectionStatus('connected');
                    reconnectAttemptsRef.current = 0;
                } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
                    setConnectionStatus('disconnected');
                    reconnectAttemptsRef.current += 1;
                    
                    // After 3 failed attempts, switch to polling
                    if (reconnectAttemptsRef.current >= 3) {
                        console.log('[Viewer] Too many reconnection attempts, switching to polling');
                        startPolling();
                    } else {
                        // Exponential backoff: 500ms, 1s, 2s
                        const delay = Math.min(500 * Math.pow(2, reconnectAttemptsRef.current - 1), 2000);
                        console.log(`[Viewer] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
                        setTimeout(() => {
                            setConnectionStatus('connecting');
                            updateChannel.subscribe();
                        }, delay);
                    }
                }
            });

        // PHASE 3: Track presence for audience count with optimized config
        const presenceChannel = supabase.channel(`presence:${presentationId}`, {
            config: {
                broadcast: { self: false },
                presence: { key: viewerId }
            }
        });

        presenceChannel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track({ type: 'viewer' });
            }
        });

        return () => {
            if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
            }
            stopPolling();
            supabase.removeChannel(updateChannel);
            supabase.removeChannel(presenceChannel);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [presentationId]); // Only re-run when presentationId changes

    // Fullscreen change listener
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!(
                document.fullscreenElement ||
                (document as any).webkitFullscreenElement ||
                (document as any).mozFullScreenElement
            ));
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('mozfullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
        };
    }, []);

    // Handle tab visibility changes - refetch current slide when tab becomes visible
    // This fixes issues on mobile where WebSocket connections are suspended
    useEffect(() => {
        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible' && presentationId) {
                console.log('[Viewer] Tab became visible, checking for updates...');
                // Refetch current presentation state
                const { data, error } = await supabase
                    .from('presentations')
                    .select('current_slide_index, is_live')
                    .eq('id', presentationId)
                    .single();
                
                if (!error && data) {
                    console.log('[Viewer] Fetched current slide:', data.current_slide_index);
                    setCurrentSlideIndex(data.current_slide_index);
                    if (!data.is_live) {
                        setHasEnded(true);
                    }
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [presentationId]);

    const toggleFullscreen = useCallback(async () => {
        try {
            const elem = pageRef.current;
            if (!elem) return;

            const isCurrentlyFullscreen = !!(
                document.fullscreenElement ||
                (document as any).webkitFullscreenElement ||
                (document as any).mozFullScreenElement
            );

            if (isCurrentlyFullscreen) {
                if (document.exitFullscreen) {
                    await document.exitFullscreen();
                } else if ((document as any).webkitExitFullscreen) {
                    (document as any).webkitExitFullscreen();
                } else if ((document as any).mozCancelFullScreen) {
                    (document as any).mozCancelFullScreen();
                }
            } else {
                if (elem.requestFullscreen) {
                    await elem.requestFullscreen();
                } else if ((elem as any).webkitRequestFullscreen) {
                    (elem as any).webkitRequestFullscreen();
                } else if ((elem as any).mozRequestFullScreen) {
                    (elem as any).mozRequestFullScreen();
                }
            }
        } catch (err) {
            console.error('Fullscreen error:', err);
        }
    }, []);

    const currentSlide = slides.find(s => s.slide_number === currentSlideIndex);
    
    // Get cached image URL if available, otherwise use original URL
    const currentSlideImageUrl = currentSlide
        ? (cachedImageUrls.get(currentSlide.slide_number) || currentSlide.image_url)
        : null;

    // Loading
    if (isLoading) {
        return (
            <div className={styles.loading}>
                <Spinner size="lg" />
                <p>Loading presentation...</p>
            </div>
        );
    }

    // Presentation ended
    if (hasEnded) {
        return (
            <div className={styles.ended}>
                <div className={styles.endedContent}>
                    <span className={styles.endedIcon}>👋</span>
                    <h2>Presentation Ended</h2>
                    <p>The presenter has ended this session.</p>
                    <p className={styles.thankYou}>Thank you for watching!</p>
                    <Button onClick={() => navigate('/')}>Back to Home</Button>
                </div>
            </div>
        );
    }

    // Error
    if (error || !presentation) {
        return (
            <div className={styles.error}>
                <h2>Error</h2>
                <p>{error || 'Presentation not found'}</p>
                <Button onClick={() => navigate('/')}>Back to Home</Button>
            </div>
        );
    }

    // No slides
    if (!currentSlide) {
        return (
            <div className={styles.waiting}>
                <Spinner size="lg" />
                <p>Waiting for presenter...</p>
            </div>
        );
    }

    // PHASE 3: Image sizing optimization - calculate optimal width
    const optimalWidth = Math.min(viewportSize.width * viewportSize.pixelRatio, 1920);
    
    return (
        <div className={styles.page} ref={pageRef}>
            <div className={styles.slideContainer}>
                {currentSlideImageUrl && (
                <img
                        src={currentSlideImageUrl}
                    alt={`Slide ${currentSlideIndex}`}
                    className={styles.slideImage}
                        width={optimalWidth}
                        loading="eager"
                        decoding="async"
                        onError={(e) => {
                            // Fallback to original URL if cached URL fails
                            if (currentSlide && currentSlideImageUrl !== currentSlide.image_url) {
                                (e.target as HTMLImageElement).src = currentSlide.image_url;
                            }
                        }}
                    />
                )}
            </div>

            <div className={styles.overlay}>
                <div className={styles.slideCounter}>
                    {currentSlideIndex} / {slides.length}
                </div>
                
                {/* Connection status indicator */}
                <div 
                    className={`${styles.connectionStatus} ${styles[connectionStatus]} ${showReconnectHint ? styles.withHint : ''}`}
                    title={
                        connectionStatus === 'connected' ? 'Connected - receiving live updates' :
                        connectionStatus === 'connecting' ? 'Connecting... (tap to force refresh)' :
                        connectionStatus === 'polling' ? 'Backup mode - updates every 1s' :
                        'Disconnected - tap to force refresh'
                    }
                    onClick={() => {
                        if (connectionStatus !== 'connected') {
                            forceRefresh();
                        }
                    }}
                >
                    <span className={styles.statusDot} />
                    {connectionStatus !== 'connected' && (
                        <span className={styles.statusText}>
                            {connectionStatus === 'connecting' ? 'Connecting...' : 
                             connectionStatus === 'polling' ? 'Backup mode' : 
                             'Tap to refresh'}
                        </span>
                    )}
                    {showReconnectHint && connectionStatus === 'connecting' && (
                        <span className={styles.reconnectHint}>Tap here to reconnect</span>
                    )}
                </div>

                <button
                    className={styles.fullscreenButton}
                    onClick={toggleFullscreen}
                    aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                    title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                >
                    {isFullscreen ? '⤓' : '⤢'}
                </button>
            </div>
        </div>
    );
}
