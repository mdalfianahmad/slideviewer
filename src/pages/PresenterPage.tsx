import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatInviteCodeForDisplay, getJoinUrl } from '../lib/invite-code';
import { getRecentPresentations } from '../lib/storage';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { QRCodeDisplay } from '../components/ui/QRCodeDisplay';
import type { Presentation, Slide } from '../types/database';
import styles from './PresenterPage.module.css';

export function PresenterPage() {
    const { presentationId } = useParams<{ presentationId: string }>();
    const navigate = useNavigate();
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

        const recents = getRecentPresentations();
        const owned = recents.find(p => p.id === presentationId && p.presenterToken);
        setHasPresenterToken(!!owned?.presenterToken);

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

                setPresentation(pres as Presentation);
                setCurrentSlideIndex((pres as Presentation).current_slide_index);

                // Mark as live when presenter opens
                const { error: liveError } = await supabase
                    .from('presentations')
                    .update({ is_live: true })
                    .eq('id', presentationId);

                if (liveError) {
                    console.error('Failed to set is_live:', liveError);
                }

                // Try to update last_presented_at (may fail if column doesn't exist)
                await supabase
                    .from('presentations')
                    .update({ last_presented_at: new Date().toISOString() })
                    .eq('id', presentationId);

                const { data: slideData, error: slideErr } = await supabase
                    .from('slides')
                    .select('*')
                    .eq('presentation_id', presentationId)
                    .order('slide_number', { ascending: true });

                if (slideErr) throw new Error('Failed to load slides');

                const loadedSlides = (slideData as Slide[]) || [];
                setSlides(loadedSlides);

                // Preload all slide images
                loadedSlides.forEach(slide => {
                    const img = new Image();
                    img.src = slide.image_url;
                    if (slide.thumbnail_url) {
                        const thumb = new Image();
                        thumb.src = slide.thumbnail_url;
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
    }, [presentationId]);

    // Track audience with Supabase Presence
    useEffect(() => {
        if (!presentationId) return;

        const channel = supabase.channel(`presence:${presentationId}`, {
            config: { presence: { key: 'presenter' } }
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

    const goToSlide = useCallback(async (index: number) => {
        if (!presentationId || !hasPresenterToken) return;
        const clampedIndex = Math.max(1, Math.min(index, slides.length));
        setCurrentSlideIndex(clampedIndex);
        setShowSlideOverview(false); // Close overview when selecting a slide

        await supabase
            .from('presentations')
            .update({ current_slide_index: clampedIndex })
            .eq('id', presentationId);
    }, [presentationId, hasPresenterToken, slides.length]);

    const nextSlide = useCallback(() => {
        if (currentSlideIndex < slides.length) goToSlide(currentSlideIndex + 1);
    }, [currentSlideIndex, slides.length, goToSlide]);

    const prevSlide = useCallback(() => {
        if (currentSlideIndex > 1) goToSlide(currentSlideIndex - 1);
    }, [currentSlideIndex, goToSlide]);

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

    // Current and next slide
    const currentSlide = slides.find(s => s.slide_number === currentSlideIndex);
    const nextSlidePreview = slides.find(s => s.slide_number === currentSlideIndex + 1);

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

    if (!currentSlide) {
        return (
            <div className={styles.error}>
                <h2>No Slides</h2>
                <p>This presentation has no slides</p>
                <Button onClick={() => navigate('/')}>Back to Home</Button>
            </div>
        );
    }

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
                        <button className={styles.navButton} onClick={prevSlide} disabled={currentSlideIndex <= 1}>←</button>
                        <button
                            className={styles.slideCounter}
                            onClick={() => setShowSlideOverview(true)}
                        >
                            <span className={styles.slideCounterIcon}>▤</span>
                            {currentSlideIndex} / {slides.length}
                        </button>
                        <button className={styles.navButton} onClick={nextSlide} disabled={currentSlideIndex >= slides.length}>→</button>
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
