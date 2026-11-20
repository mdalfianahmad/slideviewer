import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, onRealtimeHeartbeat } from '../lib/supabase';
import { ensureRealtimeConnected } from '../lib/realtimeHealth';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import {
    createBackgroundLoader,
    preloadAround,
    preloadImage,
    useReadyImage,
} from '../lib/imagePreloader';
import {
    ENDED_EVENT,
    SLIDE_EVENT,
    SYNC_REQUEST_EVENT,
    createSeqGate,
    slideSyncTopic,
    type SlideMessage,
} from '../lib/slideSync';
import { useViewportSize } from '../hooks/useViewportSize';
import { useConnectionQuality } from '../hooks/useConnectionQuality';
import type { Presentation, Slide } from '../types/database';

// After a broadcast, ignore database-sourced slide values for this long.
// DB updates arrive later than broadcasts and can be stale.
const BROADCAST_PRIORITY_MS = 3000;
import styles from './ViewerPage.module.css';

export function ViewerPage() {
    const { presentationId } = useParams<{ presentationId: string }>();
    const navigate = useNavigate();
    const viewportSize = useViewportSize();
    const connectionQuality = useConnectionQuality();
    
    // How many slides ahead are kept decoded and ready to swap in instantly.
    // (All slides are downloaded in the background regardless; see below.)
    // iOS does not report connection quality ('unknown'), so treat that as fast.
    const lazyLoadRange = connectionQuality === 'slow' ? 3 : 5;

    const [presentation, setPresentation] = useState<Presentation | null>(null);
    const [slides, setSlides] = useState<Slide[]>([]);
    const [currentSlideIndex, setCurrentSlideIndex] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasEnded, setHasEnded] = useState(false);
    const seqGateRef = useRef(createSeqGate());
    const lastBroadcastAtRef = useRef(0);
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

    // Apply a slide index read from the database (initial load, polling,
    // reconnect, tab refocus) unless a fresher broadcast arrived recently.
    const applyDbSlide = useCallback((slideIndex: number) => {
        if (Date.now() - lastBroadcastAtRef.current < BROADCAST_PRIORITY_MS) return;
        setCurrentSlideIndex(slideIndex);
    }, []);

    // One-off read of the live state from the database
    const fetchLiveState = useCallback(async () => {
        const pid = presentationIdRef.current;
        if (!pid) return;
        try {
            const { data, error } = await supabase
                .from('presentations')
                .select('current_slide_index, is_live')
                .eq('id', pid)
                .single();
            if (!error && data) {
                applyDbSlide(data.current_slide_index);
                if (!data.is_live) setHasEnded(true);
            }
        } catch (e) {
            console.error('[Viewer] Live state fetch error:', e);
        }
    }, [applyDbSlide]);

    // Bumping this recreates the realtime channels (used after a socket reconnect,
    // so channels join immediately instead of waiting on rejoin timers)
    const [channelEpoch, setChannelEpoch] = useState(0);
    const updateChannelRef = useRef<RealtimeChannel | null>(null);
    const viewerIdRef = useRef(`viewer_${Math.random().toString(36).substring(2, 9)}`);

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
                applyDbSlide(typedPres.current_slide_index);

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
                // Images are preloaded in a window around the current slide (see effect below).

                setIsLoading(false);
            } catch (err) {
                console.error('Viewer fetch error:', err);
                setError(err instanceof Error ? err.message : 'Failed to load');
                setIsLoading(false);
            }
        }

        fetchData();
    }, [presentationId, applyDbSlide]);

    // Preload current slide ± lazyLoadRange (forward-biased: the deck moves forward)
    const currentPosition = slides.findIndex(s => s.slide_number === currentSlideIndex);
    useEffect(() => {
        preloadAround(slides, currentPosition, s => [s.image_url], {
            ahead: lazyLoadRange,
            behind: 1,
        });
    }, [slides, currentPosition, lazyLoadRange]);

    // Download every slide in the background, nearest-ahead first.
    // Starts once the current slide is on screen so it never competes with it.
    const backgroundLoaderRef = useRef<ReturnType<typeof createBackgroundLoader> | null>(null);
    const [preload, setPreload] = useState({ done: 0, total: 0 });
    const [hidePreloadStatus, setHidePreloadStatus] = useState(false);
    const preloadComplete = preload.total > 0 && preload.done >= preload.total;
    useEffect(() => {
        if (!preloadComplete) return;
        const t = window.setTimeout(() => setHidePreloadStatus(true), 4000);
        return () => clearTimeout(t);
    }, [preloadComplete]);
    const currentPositionRef = useRef(currentPosition);
    useEffect(() => {
        currentPositionRef.current = currentPosition;
        backgroundLoaderRef.current?.setCursor(Math.max(0, currentPosition));
    }, [currentPosition]);

    useEffect(() => {
        if (slides.length === 0) return;
        const loader = createBackgroundLoader({
            concurrency: 3,
            onProgress: (done, total) => setPreload({ done, total }),
        });
        backgroundLoaderRef.current = loader;

        const start = () => {
            loader.setCursor(Math.max(0, currentPositionRef.current));
            loader.setUrls(slides.map(s => s.image_url));
        };
        const first = slides[Math.max(0, currentPositionRef.current)];
        // Start after the current slide loads, or after 1.5s at the latest
        const fallback = window.setTimeout(start, 1500);
        preloadImage(first.image_url).then(() => {
            clearTimeout(fallback);
            start();
        });

        return () => {
            clearTimeout(fallback);
            loader.stop();
            backgroundLoaderRef.current = null;
        };
    }, [slides]);

    // Polling fallback function - used when WebSocket fails
    const startPolling = useCallback(() => {
        if (pollingIntervalRef.current) {
            console.log('[Viewer] Already polling, skipping');
            return;
        }
        
        console.log('[Viewer] Starting polling fallback (WebSocket unavailable)');
        // Force update status synchronously
        setConnectionStatus('polling');

        // Every 1s, but only while the page is visible: a hidden tab or locked
        // phone sends nothing. Waking up triggers an immediate fetch (see wake handler).
        const poll = () => {
            if (document.visibilityState !== 'visible') return;
            void fetchLiveState();
        };
        pollingIntervalRef.current = window.setInterval(poll, 1000);
        poll(); // Initial poll
    }, [fetchLiveState]); // Stable - uses refs

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
            
            // localStorage is deliberately kept: it holds the Supabase login
            // and the presenter's recent presentations.

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

        const viewerId = viewerIdRef.current;

        // Set a timeout - if not connected within 5 seconds, fall back to polling
        connectionTimeoutRef.current = window.setTimeout(() => {
            console.log('[Viewer] Connection timeout - falling back to polling');
            startPolling();
        }, 5000);

        // Slide sync channel: Broadcast only. Anything missed while disconnected
        // is caught up from the database on (re)subscribe and on wake.
        const updateChannel = supabase
            .channel(slideSyncTopic(presentationId), {
                config: {
                    broadcast: { self: false },
                }
            })
            .on('broadcast', { event: SLIDE_EVENT }, ({ payload }) => {
                const msg = payload as SlideMessage;
                if (seqGateRef.current.accept(msg.seq)) {
                    lastBroadcastAtRef.current = Date.now();
                    setCurrentSlideIndex(msg.slide);
                }
            })
            .on('broadcast', { event: ENDED_EVENT }, () => {
                setHasEnded(true);
            })
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
                    // Catch up on anything missed: ask the presenter directly, and read the DB
                    updateChannel.send({ type: 'broadcast', event: SYNC_REQUEST_EVENT, payload: {} });
                    void fetchLiveState();
                } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
                    // supabase-js rejoins the channel automatically; calling subscribe()
                    // again on the same channel throws, so we only track attempts here.
                    setConnectionStatus('disconnected');
                    reconnectAttemptsRef.current += 1;

                    // After 3 failed attempts, poll as well until we are back
                    if (reconnectAttemptsRef.current >= 3) {
                        console.log('[Viewer] Too many reconnection attempts, switching to polling');
                        startPolling();
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

        updateChannelRef.current = updateChannel;

        return () => {
            if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
            }
            stopPolling();
            updateChannelRef.current = null;
            supabase.removeChannel(updateChannel);
            supabase.removeChannel(presenceChannel);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [presentationId, channelEpoch]); // Re-run on presentation change or forced reconnect

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

    // Wake handling: phones suspend the WebSocket when the screen locks or the
    // browser is backgrounded, and it can come back open but dead. On wake we
    // (1) read the current slide from the DB at once, and (2) check the socket
    // with an immediate heartbeat, reconnecting and rejoining if it is dead.
    const resyncOnWake = useCallback(async (reason: string) => {
        if (!presentationIdRef.current) return;
        console.log(`[Viewer] Wake (${reason}): resyncing`);
        void fetchLiveState();

        const result = await ensureRealtimeConnected();
        if (result === 'reconnected') {
            console.log('[Viewer] Socket was dead, reconnected');
            setConnectionStatus('connecting');
            setChannelEpoch((e) => e + 1);
        } else {
            // Socket alive: still ask the presenter in case a broadcast was missed
            updateChannelRef.current?.send({ type: 'broadcast', event: SYNC_REQUEST_EVENT, payload: {} });
        }
    }, [fetchLiveState]);

    useEffect(() => {
        const onVisibility = () => {
            if (document.visibilityState === 'visible') void resyncOnWake('visible');
        };
        const onOnline = () => void resyncOnWake('online');
        const onPageShow = (e: PageTransitionEvent) => {
            if (e.persisted) void resyncOnWake('pageshow'); // restored from back/forward cache
        };

        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('online', onOnline);
        window.addEventListener('pageshow', onPageShow);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('online', onOnline);
            window.removeEventListener('pageshow', onPageShow);
        };
    }, [resyncOnWake]);

    // Status dot: reflect a dead socket as soon as a heartbeat fails
    useEffect(() => {
        return onRealtimeHeartbeat((status) => {
            if (status === 'timeout' || status === 'disconnected') {
                setConnectionStatus((s) => (s === 'polling' ? s : 'disconnected'));
            }
        });
    }, []);

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
    
    // Keep the previous slide on screen until the new image is decoded
    const currentSlideImageUrl = useReadyImage(currentSlide?.image_url ?? null);

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
                    />
                )}
            </div>

            <div className={styles.overlay}>
                <div className={styles.slideCounter}>
                    {currentSlideIndex} / {slides.length}
                    {preload.total > 0 && !hidePreloadStatus && (
                        <span className={styles.preloadStatus}>
                            {preloadComplete
                                ? ' · all slides ready'
                                : ` · loading ${preload.done}/${preload.total}`}
                        </span>
                    )}
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
