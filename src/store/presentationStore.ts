import { create } from 'zustand';
import type { Presentation, Slide } from '../types/database';

interface PresentationStore {
    // Current presentation data
    presentation: Presentation | null;
    slides: Slide[];

    // UI state
    currentSlideIndex: number;
    isLoading: boolean;
    error: string | null;

    // Connection state for realtime
    isConnected: boolean;
    isReconnecting: boolean;

    // Actions
    setPresentation: (presentation: Presentation | null) => void;
    setSlides: (slides: Slide[]) => void;
    setCurrentSlideIndex: (index: number) => void;
    nextSlide: () => void;
    prevSlide: () => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    setConnectionState: (connected: boolean, reconnecting?: boolean) => void;
    reset: () => void;
}

const initialState = {
    presentation: null,
    slides: [],
    currentSlideIndex: 1,
    isLoading: false,
    error: null,
    isConnected: false,
    isReconnecting: false,
};

export const usePresentationStore = create<PresentationStore>((set, get) => ({
    ...initialState,

    setPresentation: (presentation) => set({
        presentation,
        currentSlideIndex: presentation?.current_slide_index ?? 1
    }),

    setSlides: (slides) => set({ slides }),

    setCurrentSlideIndex: (index) => {
        const { slides } = get();
        const validIndex = Math.max(1, Math.min(index, slides.length || 1));
        set({ currentSlideIndex: validIndex });
    },

    nextSlide: () => {
        const { currentSlideIndex, slides } = get();
        if (currentSlideIndex < slides.length) {
            set({ currentSlideIndex: currentSlideIndex + 1 });
        }
    },

    prevSlide: () => {
        const { currentSlideIndex } = get();
        if (currentSlideIndex > 1) {
            set({ currentSlideIndex: currentSlideIndex - 1 });
        }
    },

    setLoading: (isLoading) => set({ isLoading }),

    setError: (error) => set({ error }),

    setConnectionState: (isConnected, isReconnecting = false) =>
        set({ isConnected, isReconnecting }),

    reset: () => set(initialState),
}));

// Selector hooks
export const useCurrentSlide = () => {
    const slides = usePresentationStore((state) => state.slides);
    const currentSlideIndex = usePresentationStore((state) => state.currentSlideIndex);
    return slides.find((s) => s.slide_number === currentSlideIndex) || null;
};

export const useTotalSlides = () => {
    return usePresentationStore((state) => state.slides.length);
};

export const useCanNavigate = () => {
    const currentSlideIndex = usePresentationStore((state) => state.currentSlideIndex);
    const totalSlides = usePresentationStore((state) => state.slides.length);

    return {
        canGoNext: currentSlideIndex < totalSlides,
        canGoPrev: currentSlideIndex > 1,
    };
};
