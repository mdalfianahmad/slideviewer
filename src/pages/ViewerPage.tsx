import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import type { Presentation, Slide } from '../types/database';
import styles from './ViewerPage.module.css';

export function ViewerPage() {
    const { presentationId } = useParams<{ presentationId: string }>();
    const navigate = useNavigate();

    const [presentation, setPresentation] = useState<Presentation | null>(null);
    const [slides, setSlides] = useState<Slide[]>([]);
    const [currentSlideIndex, setCurrentSlideIndex] = useState(1);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [hasEnded, setHasEnded] = useState(false);

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

                // Preload all slide images for instant switching
                loadedSlides.forEach(slide => {
                    const img = new Image();
                    img.src = slide.image_url;
                });

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
                (payload) => {
                    const updated = payload.new as Presentation;
                    setPresentation(updated);
                    setCurrentSlideIndex(updated.current_slide_index);

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

    const currentSlide = slides.find(s => s.slide_number === currentSlideIndex);

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

    return (
        <div className={styles.page}>
            <div className={styles.slideContainer}>
                <img
                    src={currentSlide.image_url}
                    alt={`Slide ${currentSlideIndex}`}
                    className={styles.slideImage}
                />
            </div>

            <div className={styles.overlay}>
                <div className={styles.slideCounter}>
                    {currentSlideIndex} / {slides.length}
                </div>
            </div>
        </div>
    );
}
