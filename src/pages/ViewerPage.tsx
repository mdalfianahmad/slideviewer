import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { cacheSlides, getCachedSlide, isSlideCached } from '../lib/cache';
import { useViewportSize } from '../hooks/useViewportSize';
import type { Presentation, Slide } from '../types/database';
import styles from './ViewerPage.module.css';

export function ViewerPage() {
    const { presentationId } = useParams<{ presentationId: string }>();
    const navigate = useNavigate();
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

                    // Progressive caching: Load current + next 3 slides first, then rest in background
                    if (presentationId && loadedSlides.length > 0) {
                        const currentIndex = typedPres.current_slide_index;
                        const currentSlideIndexInArray = loadedSlides.findIndex(s => s.slide_number === currentIndex);
                        
                        // Priority indices: current slide + next 3 slides
                        const priorityIndices: number[] = [];
                        for (let i = 0; i < 4 && (currentSlideIndexInArray + i) < loadedSlides.length; i++) {
                            priorityIndices.push(currentSlideIndexInArray + i);
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

                        // Preload remaining slides in background
                        loadedSlides.forEach((slide, idx) => {
                            if (!priorityIndices.includes(idx)) {
                                // Check cache first
                                isSlideCached(presentationId, slide.slide_number).then(cached => {
                                    if (cached) {
                                        getCachedSlide(presentationId, slide.slide_number).then(url => {
                                            if (url) {
                                                setCachedImageUrls(prev => new Map(prev).set(slide.slide_number, url));
                                            }
                                        });
                                    }
                                    // Also preload for browser HTTP cache (works even if IndexedDB fails)
                                    const img = new Image();
                                    img.src = slide.image_url;
                                });
                            }
                        });
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

        // Subscribe to slide updates
        const updateChannel = supabase
            .channel(`viewer:${presentationId}`)
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

                    // Preload next slides when slide changes
                    if (cacheInitializedRef.current && slidesRef.current.length > 0 && presentationId) {
                        const currentSlides = slidesRef.current;
                        const currentSlideIndexInArray = currentSlides.findIndex(s => s.slide_number === newSlideIndex);
                        if (currentSlideIndexInArray >= 0) {
                            // Preload next 3 slides
                            for (let i = 1; i <= 3 && (currentSlideIndexInArray + i) < currentSlides.length; i++) {
                                const nextSlide = currentSlides[currentSlideIndexInArray + i];
                                if (nextSlide) {
                                    // Check cache first
                                    getCachedSlide(presentationId, nextSlide.slide_number).then(cachedUrl => {
                                        if (cachedUrl) {
                                            setCachedImageUrls(prev => new Map(prev).set(nextSlide.slide_number, cachedUrl));
                                        }
                                    });
                                    // Also preload for browser cache
                                    const img = new Image();
                                    img.src = nextSlide.image_url;
                                }
                            }
                        }
                    }

                    if (!updated.is_live) {
                        setHasEnded(true);
                    }
                }
            )
            .subscribe();

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
    }, [presentationId]);

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
