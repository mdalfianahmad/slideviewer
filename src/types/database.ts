// Database types for SlideViewer

export type PresentationStatus = 'processing' | 'ready' | 'error';

export interface Presentation {
    id: string;
    user_id: string | null;
    title: string;
    file_url: string;
    slide_count: number;
    status: PresentationStatus;
    invite_code: string;
    presenter_token: string;
    current_slide_index: number;
    is_live: boolean;
    created_at: string;
    last_presented_at: string | null;
}

export interface Slide {
    id: string;
    presentation_id: string;
    slide_number: number;
    image_url: string;
    thumbnail_url: string | null;
    created_at: string;
}

export interface RecentPresentation {
    id: string;
    title: string;
    slideCount: number;
    createdAt: string;
    thumbnailUrl?: string;
    presenterToken?: string; // Stored locally to allow presenting again
}
