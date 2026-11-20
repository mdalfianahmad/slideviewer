import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { formatInviteCodeForDisplay, getJoinUrl } from '../lib/invite-code';
import { getRecentPresentations } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { QRCodeDisplay } from '../components/ui/QRCodeDisplay';
import { preloadAround, useReadyImage } from '../lib/imagePreloader';
import {
    ENDED_EVENT,
    SLIDE_EVENT,
    SYNC_REQUEST_EVENT,
    createLatestWinsWriter,
    createSeqGate,
    nextSeq,
    slideSyncTopic,
    type SlideMessage,
} from '../lib/slideSync';
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
                // Images are preloaded in a window around the current slide (see effect below).

                setIsLoading(false);
            } catch (err) {
                console.error('Fetch error:', err);
                setError(err instanceof Error ? err.message : 'Failed to load');
                setIsLoading(false);
            }
        }

        fetchData();
    }, [presentationId, user]);

    // Slide sync channel (Realtime Broadcast).
    // The presenter does NOT listen to its own database updates: those echoes
    // arrive late and used to pull the presenter back to an earlier slide.
    const syncChannelRef = useRef<RealtimeChannel | null>(null);
    const seqGateRef = useRef(createSeqGate());
    const lastSentRef = useRef<SlideMessage | null>(null);

    useEffect(() => {
        if (!presentationId) return;

        const channel = supabase
            .channel(slideSyncTopic(presentationId), {
                config: { broadcast: { self: false } },
            })
            // Another presenter device (e.g. phone as remote) changed the slide
            .on('broadcast', { event: SLIDE_EVENT }, ({ payload }) => {
                const msg = payload as SlideMessage;
                if (seqGateRef.current.accept(msg.seq)) {
                    setCurrentSlideIndex(msg.slide);
                }
            })
            // A viewer just connected and wants the current slide
            .on('broadcast', { event: SYNC_REQUEST_EVENT }, () => {
                const last = lastSentRef.current;
                if (last) {
                    channel.send({ type: 'broadcast', event: SLIDE_EVENT, payload: last });
                }
            })
            .subscribe();

        syncChannelRef.current = channel;
        return () => {
            syncChannelRef.current = null;
            supabase.removeChannel(channel);
        };
    }, [presentationId]);

    // Persist the slide index for late joiners / polling. One request in flight,
    // newest value wins, so writes can never land out of order.
    const persistSlide = useMemo(
        () =>
            createLatestWinsWriter<number>(async (slideNumber) => {
                if (!presentationId) return;
                const { error } = await supabase
                    .from('presentations')
                    .update({ current_slide_index: slideNumber })
                    .eq('id', presentationId);
                if (error) throw error;
            }),
        [presentationId]
    );

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

    // Slides in display order, computed once per slides change
    const sortedSlides = useMemo(
        () => [...slides].sort((a, b) => a.slide_number - b.slide_number),
        [slides]
    );
    const currentPosition = sortedSlides.findIndex(s => s.slide_number === currentSlideIndex);

    // Preload the current slide, the next 3 and the previous 1 (plus next thumbnail)
    useEffect(() => {
        preloadAround(sortedSlides, currentPosition, s => [s.image_url], { ahead: 3, behind: 1 });
        const next = sortedSlides[currentPosition + 1];
        if (next?.thumbnail_url) preloadAround([next], 0, s => [s.thumbnail_url], { ahead: 0, behind: 0 });
    }, [sortedSlides, currentPosition]);

    const goToSlide = useCallback((slideNumber: number) => {
        if (!presentationId || !hasPresenterToken || sortedSlides.length === 0) return;

        // If slide doesn't exist, use the closest one
        if (!sortedSlides.some(s => s.slide_number === slideNumber)) {
            const closest = sortedSlides.find(s => s.slide_number >= slideNumber) || sortedSlides[sortedSlides.length - 1];
            slideNumber = closest.slide_number;
        }

        setCurrentSlideIndex(slideNumber);
        setShowSlideOverview(false); // Close overview when selecting a slide

        // 1. Instant: broadcast to viewers
        const msg: SlideMessage = { slide: slideNumber, seq: nextSeq() };
        seqGateRef.current.accept(msg.seq);
        lastSentRef.current = msg;
        syncChannelRef.current?.send({ type: 'broadcast', event: SLIDE_EVENT, payload: msg });

        // 2. Background: persist for late joiners and the polling fallback
        persistSlide(slideNumber);
    }, [presentationId, hasPresenterToken, sortedSlides, persistSlide]);

    const nextSlide = useCallback(() => {
        if (currentPosition >= 0 && currentPosition < sortedSlides.length - 1) {
            goToSlide(sortedSlides[currentPosition + 1].slide_number);
        }
    }, [currentPosition, sortedSlides, goToSlide]);

    const prevSlide = useCallback(() => {
        if (currentPosition > 0) {
            goToSlide(sortedSlides[currentPosition - 1].slide_number);
        }
    }, [currentPosition, sortedSlides, goToSlide]);

    const endPresentation = useCallback(async () => {
        if (!presentationId) return;
        syncChannelRef.current?.send({ type: 'broadcast', event: ENDED_EVENT, payload: {} });
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
                case 'ArrowDown':
                case 'PageDown':
                case ' ':
                    e.preventDefault();
                    nextSlide();
                    break;
                case 'ArrowLeft':
                case 'ArrowUp':
                case 'PageUp':
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
    
    // Next slide preview
    const nextSlidePreview: Slide | undefined =
        currentPosition >= 0 ? sortedSlides[currentPosition + 1] : undefined;

    // Keep the previous slide on screen until the new image is decoded
    const currentSlideImageUrl = useReadyImage(currentSlide?.image_url ?? null);

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

    // Position in sorted slides for navigation buttons
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
                                    loading="lazy"
                                    onError={(e) => {
                                        // Fallback to full image if thumbnail fails
                                        if (slide.thumbnail_url && (e.target as HTMLImageElement).src !== slide.image_url) {
                                            (e.target as HTMLImageElement).src = slide.image_url;
                                        }
                                    }}
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
                        src={currentSlideImageUrl ?? currentSlide.image_url}
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
