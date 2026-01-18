import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { usePresentationStore } from '../store/presentationStore';
import { setLastViewedSlide, getLastViewedSlide } from '../lib/storage';
import type { Presentation, Slide } from '../types/database';

interface UseRealtimeSessionOptions {
    presentationId: string;
    isPresenter?: boolean;
}

interface UseRealtimeSessionReturn {
    presentation: Presentation | null;
    slides: Slide[];
    currentSlide: Slide | null;
    currentSlideIndex: number;
    isConnected: boolean;
    isReconnecting: boolean;
    error: string | null;
    isLoading: boolean;
    goToSlide: (index: number) => Promise<void>;
    nextSlide: () => Promise<void>;
    prevSlide: () => Promise<void>;
}

export function useRealtimeSession({
    presentationId,
    isPresenter = false,
}: UseRealtimeSessionOptions): UseRealtimeSessionReturn {
    const [isLoading, setIsLoading] = useState(true);

    // Select only the actions/state we need to avoid infinite loops
    const presentation = usePresentationStore((state) => state.presentation);
    const slides = usePresentationStore((state) => state.slides);
    const currentSlideIndex = usePresentationStore((state) => state.currentSlideIndex);
    const isConnected = usePresentationStore((state) => state.isConnected);
    const isReconnecting = usePresentationStore((state) => state.isReconnecting);
    const error = usePresentationStore((state) => state.error);

    const setPresentation = usePresentationStore((state) => state.setPresentation);
    const setSlides = usePresentationStore((state) => state.setSlides);
    const setCurrentSlideIndex = usePresentationStore((state) => state.setCurrentSlideIndex);
    const setConnectionState = usePresentationStore((state) => state.setConnectionState);
    const setError = usePresentationStore((state) => state.setError);

    const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const reconnectTimeoutRef = useRef<number | null>(null);

    // Fetch initial data
    const fetchData = useCallback(async () => {
        if (!presentationId) {
            setIsLoading(false);
            return;
        }

        try {
            setIsLoading(true);
            setError(null);

            // 1. Fetch presentation
            const { data: presData, error: presError } = await supabase
                .from('presentations')
                .select('*')
                .eq('id', presentationId)
                .single();

            if (presError || !presData) {
                throw new Error('Presentation not found or database error. Did you run the migration?');
            }

            setPresentation(presData as Presentation);
            setCurrentSlideIndex((presData as Presentation).current_slide_index);

            // 2. Fetch slides
            const { data: slidesData, error: slidesError } = await supabase
                .from('slides')
                .select('*')
                .eq('presentation_id', presentationId)
                .order('slide_number', { ascending: true });

            if (slidesError) {
                throw new Error('Failed to load slides');
            }

            setSlides((slidesData as Slide[]) || []);

            // 3. Cache for offline
            const currentSlide = (slidesData as Slide[])?.find(
                (s) => s.slide_number === (presData as Presentation).current_slide_index
            );
            if (currentSlide) {
                setLastViewedSlide(presentationId, currentSlide.image_url);
            }

        } catch (err) {
            console.error('Error fetching data:', err);
            setError(err instanceof Error ? err.message : 'Failed to load presentation');
        } finally {
            setIsLoading(false);
        }
    }, [presentationId, setError, setPresentation, setCurrentSlideIndex, setSlides]);

    // Subscribe to changes
    const subscribeToPresentation = useCallback(() => {
        if (!presentationId) return;

        if (subscriptionRef.current) {
            subscriptionRef.current.unsubscribe();
        }

        const channel = supabase
            .channel(`presentation:${presentationId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'presentations',
                    filter: `id=eq.${presentationId}`,
                },
                (payload) => {
                    const updatedPresentation = payload.new as Presentation;
                    setPresentation(updatedPresentation);

                    // For audience, sync the slide index
                    if (!isPresenter) {
                        setCurrentSlideIndex(updatedPresentation.current_slide_index);

                        // Async cache update
                        const currentSlide = slides.find(
                            (s) => s.slide_number === updatedPresentation.current_slide_index
                        );
                        if (currentSlide) {
                            setLastViewedSlide(presentationId, currentSlide.image_url);
                        }
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    setConnectionState(true, false);
                } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    setConnectionState(false, true);
                    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
                    reconnectTimeoutRef.current = window.setTimeout(subscribeToPresentation, 2000);
                }
            });

        subscriptionRef.current = channel;
    }, [presentationId, isPresenter, setPresentation, setCurrentSlideIndex, setConnectionState, slides]);

    useEffect(() => {
        fetchData();
        subscribeToPresentation();

        return () => {
            if (subscriptionRef.current) subscriptionRef.current.unsubscribe();
            if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        };
    }, [fetchData, subscribeToPresentation]);

    // Presenter Actions
    const goToSlide = useCallback(
        async (index: number) => {
            if (!isPresenter || !presentation) return;

            const clampedIndex = Math.max(1, Math.min(index, slides.length));

            // Optimistic update
            setCurrentSlideIndex(clampedIndex);

            const { error } = await supabase
                .from('presentations')
                .update({ current_slide_index: clampedIndex })
                .eq('id', presentationId);

            if (error) {
                console.error('Failed to update slide index:', error);
                // Rollback if needed or show error? 
                // For simplicity, we just log it.
            }
        },
        [isPresenter, presentationId, presentation, slides.length, setCurrentSlideIndex]
    );

    const nextSlide = useCallback(async () => {
        if (currentSlideIndex < slides.length) {
            await goToSlide(currentSlideIndex + 1);
        }
    }, [currentSlideIndex, slides.length, goToSlide]);

    const prevSlide = useCallback(async () => {
        if (currentSlideIndex > 1) {
            await goToSlide(currentSlideIndex - 1);
        }
    }, [currentSlideIndex, goToSlide]);

    const currentSlide = slides.find(
        (s) => s.slide_number === currentSlideIndex
    ) || null;

    // Offline fallback
    const offlineSlideUrl = !isConnected ? getLastViewedSlide(presentationId) : null;
    const displaySlide = currentSlide || (offlineSlideUrl
        ? { image_url: offlineSlideUrl, slide_number: currentSlideIndex } as Slide
        : null);

    return {
        presentation,
        slides,
        currentSlide: displaySlide,
        currentSlideIndex,
        isConnected,
        isReconnecting,
        error,
        isLoading,
        goToSlide,
        nextSlide,
        prevSlide,
    };
}
