import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { cacheSlides, getCachedSlide, isSlideCached } from '../lib/cache';
import { useConnectionQuality } from '../hooks/useConnectionQuality';
import { useViewportSize } from '../hooks/useViewportSize';
import type { Presentation, Slide } from '../types/database';
import styles from './ViewerPage.module.css';

export function ViewerPage() {
    const { presentationId } = useParams<{ presentationId: string }>();
    const navigate = useNavigate();
    const connectionQuality = useConnectionQuality();
    const viewportSize = useViewportSize();

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
    
    // PHASE 3: Adaptive preload count based on connection quality
    // PHASE 3: Lazy loading - only preload slides within ±5 range
    const preloadCount = connectionQuality === 'fast' ? 5 : 2;
    const lazyLoadRange = 5; // Only preload slides within ±5 of current

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

                // PHASE 3: Lazy loading - only preload slides within ±lazyLoadRange
                // This reduces initial bandwidth usage while keeping nearby slides ready
                if (presentationId && loadedSlides.length > 0) {
                    const currentIndex = typedPres.current_slide_index;
                    const currentSlideIndexInArray = loadedSlides.findIndex(s => s.slide_number === currentIndex);
                    
                    // Determine which slides to preload (within range)
                    const slidesToPreload: typeof loadedSlides = [];
                    const priorityIndices: number[] = [];
                    
                    for (let i = 0; i < loadedSlides.length; i++) {
                        const distance = Math.abs(i - currentSlideIndexInArray);
                        if (distance <= lazyLoadRange) {
                            slidesToPreload.push(loadedSlides[i]);
                            priorityIndices.push(i);
                        }
                    }

                    // Cache priority slides (within range) immediately
                    if (slidesToPreload.length > 0) {
                        cacheSlides(
                            presentationId,
                            slidesToPreload.map(s => ({
                                slideNumber: s.slide_number,
                                imageUrl: s.image_url,
                                thumbnailUrl: s.thumbnail_url,
                            })),
                            priorityIndices
                        ).catch(() => {
                            // Ignore caching errors - non-critical
                        });
                    }

                    // Preload current slide immediately for instant display
                    const currentSlide = loadedSlides.find(s => s.slide_number === currentIndex);
                    if (currentSlide) {
                        // Try cache first
                        const cachedUrl = await getCachedSlide(presentationId, currentSlide.slide_number);
                        if (cachedUrl) {
                            setCachedImageUrls(prev => new Map(prev).set(currentSlide.slide_number, cachedUrl));
                        } else {
                            // Preload via Image for browser cache
                            const img = new Image();
                            img.src = currentSlide.image_url;
                        }
                    }

                    // Preload nearby slides in background (for browser HTTP cache)
                    slidesToPreload.forEach((slide) => {
                        // Check if already cached in IndexedDB
                        isSlideCached(presentationId, slide.slide_number).then(cached => {
                            if (cached) {
                                // Get cached URL and add to state
                                getCachedSlide(presentationId, slide.slide_number).then(url => {
                                    if (url) {
                                        setCachedImageUrls(prev => new Map(prev).set(slide.slide_number, url));
                                    }
                                });
                            }
                            // Also preload for browser HTTP cache
                            const img = new Image();
                            img.src = slide.image_url;
                        });
                    });

                    // PHASE 3: Lazy load distant slides only when needed
                    // They'll be cached on-demand when user navigates to them
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
    }, [presentationId]);

    // Subscribe to realtime updates and track presence
    useEffect(() => {
        if (!presentationId) return;

        // Generate a unique viewer ID for this session
        const viewerId = `viewer_${Math.random().toString(36).substring(2, 9)}`;

        // PHASE 3: WebSocket optimization - configure channel with keep-alive
        const updateChannel = supabase
            .channel(`viewer:${presentationId}`, {
                config: {
                    broadcast: { self: false },
                    presence: { key: viewerId },
                },
            })
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'presentations',
                    filter: `id=eq.${presentationId}`,
                },
                (payload) => {
                    try {
                        console.log('🔔 Realtime event received:', payload);
                        const updated = payload.new as Presentation;
                        const newSlideIndex = updated.current_slide_index;
                        console.log('📄 New slide index:', newSlideIndex);
                        
                        // CRITICAL: Always update slide index first (ensures UI follows presenter)
                        setCurrentSlideIndex(newSlideIndex);
                        console.log('✅ Slide index updated to:', newSlideIndex);

                        // Sync with database state
                        setPresentation(updated);

                        // PHASE 1 OPTIMIZATION: Optimistic UI update (non-blocking)
                        // Show slide immediately if cached, before waiting for database sync
                        if (cacheInitializedRef.current && slidesRef.current.length > 0 && presentationId) {
                            const currentSlides = slidesRef.current;
                            const nextSlide = currentSlides.find(s => s.slide_number === newSlideIndex);
                            if (nextSlide) {
                                // Try to get cached URL (non-blocking, async)
                                getCachedSlide(presentationId, nextSlide.slide_number).then(cachedUrl => {
                                    if (cachedUrl) {
                                        // OPTIMISTIC: Update cached URL for instant display
                                        setCachedImageUrls(prev => {
                                            const newMap = new Map(prev);
                                            newMap.set(nextSlide.slide_number, cachedUrl);
                                            return newMap;
                                        });
                                    }
                                }).catch(err => {
                                    console.warn('Failed to get cached slide:', err);
                                });
                            }

                            // PHASE 3: Lazy loading - preload slides within range when slide changes
                            // Only preload slides within ±lazyLoadRange of new position
                            const currentSlideIndexInArray = currentSlides.findIndex(s => s.slide_number === newSlideIndex);
                            if (currentSlideIndexInArray >= 0) {
                                // Preload slides within range (ahead and behind)
                                for (let offset = -lazyLoadRange; offset <= lazyLoadRange; offset++) {
                                    const targetIndex = currentSlideIndexInArray + offset;
                                    if (targetIndex >= 0 && targetIndex < currentSlides.length) {
                                        const targetSlide = currentSlides[targetIndex];
                                        if (targetSlide) {
                                            // Check cache first
                                            getCachedSlide(presentationId, targetSlide.slide_number).then(cachedUrl => {
                                                if (cachedUrl) {
                                                    setCachedImageUrls(prev => new Map(prev).set(targetSlide.slide_number, cachedUrl));
                                                } else {
                                                    // Lazy load: cache on-demand
                                                    cacheSlides(
                                                        presentationId,
                                                        [{
                                                            slideNumber: targetSlide.slide_number,
                                                            imageUrl: targetSlide.image_url,
                                                            thumbnailUrl: targetSlide.thumbnail_url,
                                                        }],
                                                        []
                                                    ).catch(() => {
                                                        // Ignore errors
                                                    });
                                                }
                                            });
                                            // Also preload for browser cache
                                            const img = new Image();
                                            img.src = targetSlide.image_url;
                                        }
                                    }
                                }
                            }
                        }

                        if (!updated.is_live) {
                            setHasEnded(true);
                        }
                    } catch (error) {
                        console.error('Error in realtime handler:', error);
                    }
                }
            )
            .subscribe((status) => {
                // PHASE 3: WebSocket optimization - faster reconnection
                if (status === 'SUBSCRIBED') {
                    console.log('Viewer channel subscribed');
                } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
                    console.warn('Viewer channel error, reconnecting...');
                    // Faster reconnection: 500ms instead of 2000ms
                    setTimeout(() => {
                        updateChannel.subscribe();
                    }, 500);
                }
            });

        // Track presence for audience count
        const presenceChannel = supabase.channel(`presence:${presentationId}`, {
            config: { presence: { key: viewerId } }
        });

        presenceChannel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track({ type: 'viewer' });
            }
        });

        return () => {
            supabase.removeChannel(updateChannel);
            supabase.removeChannel(presenceChannel);
        };
    }, [presentationId, preloadCount, lazyLoadRange]);

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
