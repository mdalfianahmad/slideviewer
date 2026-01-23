import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatInviteCodeForDisplay, getJoinUrl } from '../lib/invite-code';
import { getRecentPresentations } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { QRCodeDisplay } from '../components/ui/QRCodeDisplay';
import { cacheSlides } from '../lib/cache';
import type { Presentation, Slide } from '../types/database';
import styles from './PresenterPage.module.css';

export function PresenterPage() {
    const { presentationId } = useParams<{ presentationId: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();
    const pageRef = useRef<HTMLDivElement>(null);
    const [isCopied, setIsCopied] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showSlideOverview, setShowSlideOverview] = useState(false);

    // Data state
    const [presentation, setPresentation] = useState<Presentation | null>(null);
    const [slides, setSlides] = useState<Slide[]>([]);
    const [currentSlideIndex, setCurrentSlideIndex] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasPresenterToken, setHasPresenterToken] = useState(false);

    // Audience count using Supabase Presence
    const [audienceCount, setAudienceCount] = useState(0);

    useEffect(() => {
        if (!presentationId) {
            setError('No presentation ID provided');
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

                if (presErr || !pres) {
                    throw new Error('Presentation not found');
                }

                const presentationData = pres as Presentation;
                setPresentation(presentationData);
                setCurrentSlideIndex(presentationData.current_slide_index);

                // Check for presenter access:
                // 1. Check localStorage for presenter token (from recent presentations)
                const recents = getRecentPresentations();
                const owned = recents.find(p => p.id === presentationId && p.presenterToken);
                const hasTokenInStorage = !!owned?.presenterToken;
                
                // 2. Check if user owns the presentation (user_id matches)
                const isOwner = user && presentationData.user_id === user.id;
                
                // User has presenter access if they have the token OR they own the presentation
                setHasPresenterToken(hasTokenInStorage || !!isOwner);

                // Mark as live and update last_presented_at (only if user has presenter access)
                if (hasTokenInStorage || isOwner) {
                    const { error: updateError } = await supabase
                        .from('presentations')
                        .update({
                            is_live: true,
                            last_presented_at: new Date().toISOString()
                        })
                        .eq('id', presentationId);

                    if (updateError) {
                        console.error('Failed to update presentation:', updateError);
                    } else {
                        console.log('Presentation marked as live, last_presented_at updated');
                    }
                }

                const { data: slideData, error: slideErr } = await supabase
                    .from('slides')
                    .select('*')
                    .eq('presentation_id', presentationId)
                    .order('slide_number', { ascending: true });

                if (slideErr) throw new Error('Failed to load slides');

                const loadedSlides = (slideData as Slide[]) || [];
                setSlides(loadedSlides);

                // Progressive caching: Load current + next 3 slides first
                const currentIndex = presentationData.current_slide_index;
                const currentSlideIndexInArray = loadedSlides.findIndex(s => s.slide_number === currentIndex);
                
                // Priority indices: current slide + next 3 slides
                const priorityIndices: number[] = [];
                for (let i = 0; i < 4 && (currentSlideIndexInArray + i) < loadedSlides.length; i++) {
                    priorityIndices.push(currentSlideIndexInArray + i);
                }

                // Start caching with priority
                if (presentationId) {
                    cacheSlides(
                        presentationId,
                        loadedSlides.map(s => ({
                            slideNumber: s.slide_number,
                            imageUrl: s.image_url,
                            thumbnailUrl: s.thumbnail_url,
                        })),
                        priorityIndices
                    ).catch(() => {
                        // Ignore caching errors
                    });
                }

                // Preload priority slides immediately
                priorityIndices.forEach(idx => {
                    const slide = loadedSlides[idx];
                    if (slide) {
                        const img = new Image();
                        img.src = slide.image_url;
                        if (slide.thumbnail_url) {
                            const thumb = new Image();
                            thumb.src = slide.thumbnail_url;
                        }
                    }
                });

                // Preload remaining slides in background
                loadedSlides.forEach((slide, idx) => {
                    if (!priorityIndices.includes(idx)) {
                        const img = new Image();
                        img.src = slide.image_url;
                        if (slide.thumbnail_url) {
                            const thumb = new Image();
                            thumb.src = slide.thumbnail_url;
                        }
                    }
                });

                setIsLoading(false);
            } catch (err) {
                console.error('Fetch error:', err);
                setError(err instanceof Error ? err.message : 'Failed to load');
                setIsLoading(false);
            }
        }

        fetchData();
    }, [presentationId, user]);

    // Subscribe to realtime presentation updates
    useEffect(() => {
        if (!presentationId) return;

        // PHASE 3: WebSocket optimization - configure channel with keep-alive
        const updateChannel = supabase
            .channel(`presenter:${presentationId}`, {
                config: {
                    broadcast: { self: true },
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
                    const updated = payload.new as Presentation;
                    setPresentation(updated);
                    // Sync current slide index from database (only if different to avoid loops)
                    setCurrentSlideIndex(prevIndex => {
                        if (updated.current_slide_index !== prevIndex) {
                            return updated.current_slide_index;
                        }
                        return prevIndex;
                    });
                }
            )
            .subscribe((status) => {
                // PHASE 3: WebSocket optimization - faster reconnection
                if (status === 'SUBSCRIBED') {
                    console.log('Presenter channel subscribed');
                } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
                    console.warn('Presenter channel error, reconnecting...');
                    // Faster reconnection: 500ms instead of 2000ms
                    setTimeout(() => {
                        updateChannel.subscribe();
                    }, 500);
                }
            });

        return () => {
            supabase.removeChannel(updateChannel);
        };
    }, [presentationId]);

    // Track audience with Supabase Presence
    useEffect(() => {
        if (!presentationId) return;

        // PHASE 3: Optimized presence channel
        const channel = supabase.channel(`presence:${presentationId}`, {
            config: {
                broadcast: { self: false },
                presence: { key: 'presenter' }
            }
        });

        channel
            .on('presence', { event: 'sync' }, () => {
                const state = channel.presenceState();
                // Count all users in the channel (excluding presenter)
                let count = 0;
                Object.keys(state).forEach(key => {
                    if (key !== 'presenter') {
                        count += state[key].length;
                    }
                });
                setAudienceCount(count);
            })
            .subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await channel.track({ type: 'presenter' });
                }
            });

        return () => {
            supabase.removeChannel(channel);
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

    const goToSlide = useCallback(async (slideNumber: number) => {
        if (!presentationId || !hasPresenterToken || slides.length === 0) return;
        
        // Find the slide with this slide_number
        const targetSlide = slides.find(s => s.slide_number === slideNumber);
        if (!targetSlide) {
            // If slide doesn't exist, find the closest one
            const sortedSlides = [...slides].sort((a, b) => a.slide_number - b.slide_number);
            const closestSlide = sortedSlides.find(s => s.slide_number >= slideNumber) || sortedSlides[sortedSlides.length - 1];
            if (closestSlide) {
                slideNumber = closestSlide.slide_number;
            } else {
                return; // No slides available
            }
        }
        
        setCurrentSlideIndex(slideNumber);
        setShowSlideOverview(false); // Close overview when selecting a slide

        console.log('🎯 Presenter updating database - slide:', slideNumber, 'presentationId:', presentationId);
        const { error } = await supabase
            .from('presentations')
            .update({ current_slide_index: slideNumber })
            .eq('id', presentationId);
        
        if (error) {
            console.error('❌ Failed to update database:', error);
        } else {
            console.log('✅ Database updated successfully');
        }
    }, [presentationId, hasPresenterToken, slides]);

    const nextSlide = useCallback(() => {
        console.log('▶️ Next slide button clicked');
        if (slides.length === 0) {
            console.warn('⚠️ No slides available');
            return;
        }
        
        // Find current slide's position in the sorted array
        const sortedSlides = [...slides].sort((a, b) => a.slide_number - b.slide_number);
        const currentIndex = sortedSlides.findIndex(s => s.slide_number === currentSlideIndex);
        console.log('📍 Current slide index in array:', currentIndex, 'currentSlideIndex:', currentSlideIndex);
        
        // Get next slide
        if (currentIndex >= 0 && currentIndex < sortedSlides.length - 1) {
            const nextSlideNumber = sortedSlides[currentIndex + 1].slide_number;
            console.log('➡️ Going to slide:', nextSlideNumber);
            goToSlide(nextSlideNumber);
        } else {
            console.warn('⚠️ Already at last slide');
        }
    }, [currentSlideIndex, slides, goToSlide]);

    const prevSlide = useCallback(() => {
        if (slides.length === 0) return;
        
        // Find current slide's position in the sorted array
        const sortedSlides = [...slides].sort((a, b) => a.slide_number - b.slide_number);
        const currentIndex = sortedSlides.findIndex(s => s.slide_number === currentSlideIndex);
        
        // Get previous slide
        if (currentIndex > 0) {
            const prevSlideNumber = sortedSlides[currentIndex - 1].slide_number;
            goToSlide(prevSlideNumber);
        }
    }, [currentSlideIndex, slides, goToSlide]);

    const endPresentation = useCallback(async () => {
        if (!presentationId) return;
        await supabase
            .from('presentations')
            .update({ is_live: false })
            .eq('id', presentationId);
        navigate('/');
    }, [presentationId, navigate]);

    // Keyboard navigation
    useEffect(() => {
        if (!hasPresenterToken) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement) return;
            switch (e.key) {
                case 'ArrowRight':
                case ' ':
                    e.preventDefault();
                    nextSlide();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    prevSlide();
                    break;
                case 'Escape':
                    if (showSlideOverview) {
                        e.preventDefault();
                        setShowSlideOverview(false);
                    }
                    break;
                case 'g':
                case 'G':
                    e.preventDefault();
                    setShowSlideOverview(prev => !prev);
                    break;
                case 'f':
                case 'F':
                    e.preventDefault();
                    toggleFullscreen();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [nextSlide, prevSlide, hasPresenterToken, showSlideOverview, toggleFullscreen]);

    const handleCopyLink = useCallback(async () => {
        if (!presentation) return;
        try {
            await navigator.clipboard.writeText(getJoinUrl(presentation.invite_code));
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Copy failed:', err);
        }
    }, [presentation]);

    // Fix slide index mismatch - if currentSlideIndex doesn't match any slide, use first slide
    useEffect(() => {
        if (slides.length > 0) {
            const matchingSlide = slides.find(s => s.slide_number === currentSlideIndex);
            if (!matchingSlide) {
                // Index doesn't match, use first slide's number (sorted by slide_number)
                const sortedSlides = [...slides].sort((a, b) => a.slide_number - b.slide_number);
                const firstSlide = sortedSlides[0];
                if (firstSlide) {
                    setCurrentSlideIndex(firstSlide.slide_number);
                }
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slides.length]); // Only run when slides array length changes

    // Current and next slide
    // Find current slide, with fallback to first slide if index doesn't match
    let currentSlide = slides.find(s => s.slide_number === currentSlideIndex);
    if (!currentSlide && slides.length > 0) {
        // If currentSlideIndex doesn't match, use the first slide
        currentSlide = slides[0];
    }
    
    // Find next slide by finding current position and getting the next one
    let nextSlidePreview: Slide | undefined;
    if (slides.length > 0 && currentSlide) {
        const sortedSlides = [...slides].sort((a, b) => a.slide_number - b.slide_number);
        const currentIndex = sortedSlides.findIndex(s => s.slide_number === currentSlideIndex);
        if (currentIndex >= 0 && currentIndex < sortedSlides.length - 1) {
            nextSlidePreview = sortedSlides[currentIndex + 1];
        }
    }

    if (isLoading) {
        return (
            <div className={styles.loading}>
                <Spinner size="lg" />
                <p>Loading presentation...</p>
            </div>
        );
    }

    if (error || !presentation) {
        return (
            <div className={styles.error}>
                <h2>Error</h2>
                <p>{error || 'Presentation not found'}</p>
                <Button onClick={() => navigate('/')}>Back to Home</Button>
            </div>
        );
    }

    if (!hasPresenterToken) {
        navigate(`/view/${presentationId}`, { replace: true });
        return null;
    }

    // Check if slides array is empty, not if currentSlide is null
    if (slides.length === 0) {
        return (
            <div className={styles.error}>
                <h2>No Slides</h2>
                <p>This presentation has no slides</p>
                <Button onClick={() => navigate('/')}>Back to Home</Button>
            </div>
        );
    }

    // Safety check - if somehow currentSlide is still null, use first slide
    if (!currentSlide && slides.length > 0) {
        currentSlide = slides[0];
    }

    // Final safety check - if currentSlide is still null, return error
    if (!currentSlide) {
        return (
            <div className={styles.error}>
                <h2>Error</h2>
                <p>Unable to load current slide</p>
                <Button onClick={() => navigate('/')}>Back to Home</Button>
            </div>
        );
    }

    // Calculate position in sorted slides for navigation buttons
    const sortedSlides = [...slides].sort((a, b) => a.slide_number - b.slide_number);
    const currentPosition = sortedSlides.findIndex(s => s.slide_number === currentSlideIndex);
    const isFirstSlide = currentPosition === 0;
    const isLastSlide = currentPosition === sortedSlides.length - 1;
    const slidePosition = currentPosition >= 0 ? currentPosition + 1 : 0;

    return (
        <div className={styles.page} ref={pageRef}>
            {/* Slide Overview Modal */}
            {showSlideOverview && (
                <div className={styles.overviewModal}>
                    <div className={styles.overviewHeader}>
                        <h3>Go to Slide</h3>
                        <button
                            className={styles.closeBtn}
                            onClick={() => setShowSlideOverview(false)}
                        >
                            ✕
                        </button>
                    </div>
                    <div className={styles.overviewGrid}>
                        {slides.map(slide => (
                            <button
                                key={slide.id}
                                className={`${styles.overviewSlide} ${slide.slide_number === currentSlideIndex ? styles.overviewActive : ''}`}
                                onClick={() => goToSlide(slide.slide_number)}
                            >
                                <img
                                    src={slide.thumbnail_url || slide.image_url}
                                    alt={`Slide ${slide.slide_number}`}
                                />
                                <span className={styles.overviewNumber}>{slide.slide_number}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Main content area */}
            <div className={styles.mainArea}>
                {/* Current slide */}
                <div className={styles.currentSlideContainer}>
                    <img
                        src={currentSlide.image_url}
                        alt={`Slide ${currentSlideIndex}`}
                        className={styles.currentSlide}
                    />
                </div>

                {/* Side panel */}
                <div className={styles.sidePanel}>
                    {/* Audience count */}
                    <div className={styles.audienceBox}>
                        <span className={styles.audienceIcon}>👥</span>
                        <span className={styles.audienceCount}>{audienceCount}</span>
                        <span className={styles.audienceLabel}>
                            {audienceCount === 1 ? 'viewer' : 'viewers'}
                        </span>
                    </div>

                    {/* Next slide preview */}
                    <div className={styles.nextSlideBox}>
                        <span className={styles.nextLabel}>Next</span>
                        {nextSlidePreview ? (
                            <img
                                src={nextSlidePreview.thumbnail_url || nextSlidePreview.image_url}
                                alt="Next slide"
                                className={styles.nextSlideImage}
                            />
                        ) : (
                            <div className={styles.endSlide}>End of slides</div>
                        )}
                    </div>

                    {/* Invite code + QR */}
                    <div className={styles.inviteBox}>
                        <QRCodeDisplay
                            url={getJoinUrl(presentation.invite_code)}
                            size={120}
                            className={styles.qrCode}
                        />
                        <span className={styles.inviteLabel}>Invite Code</span>
                        <span className={styles.inviteCode}>
                            {formatInviteCodeForDisplay(presentation.invite_code)}
                        </span>
                        <button className={styles.copyBtn} onClick={handleCopyLink}>
                            {isCopied ? 'Copied!' : 'Copy Link'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Bottom controls */}
            <div className={styles.controlsWrapper}>
                <div className={styles.controls}>
                    <Button variant="ghost" size="sm" onClick={endPresentation}>
                        End Presentation
                    </Button>

                    <div className={styles.navigation}>
                        <button className={styles.navButton} onClick={prevSlide} disabled={isFirstSlide}>←</button>
                        <button
                            className={styles.slideCounter}
                            onClick={() => setShowSlideOverview(true)}
                        >
                            <span className={styles.slideCounterIcon}>▤</span>
                            {slidePosition} / {slides.length}
                        </button>
                        <button className={styles.navButton} onClick={nextSlide} disabled={isLastSlide}>→</button>
                    </div>

                    <button
                        className={styles.fullscreenBtn}
                        onClick={toggleFullscreen}
                    >
                        {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                    </button>
                </div>
                <p className={styles.controlsHint}>
                    💡 Click the slide number to jump to any slide (doesn't affect what viewers see until you select)
                </p>
            </div>
        </div>
    );
}
