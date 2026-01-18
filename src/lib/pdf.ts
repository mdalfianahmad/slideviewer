import * as pdfjsLib from 'pdfjs-dist';
// Use Vite's ?url suffix to get the path to the worker in node_modules
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export interface ProcessedSlide {
    slideNumber: number;
    imageBlob: Blob;
    thumbnailBlob: Blob;
    width: number;
    height: number;
}

export interface PdfProcessingProgress {
    stage: 'loading' | 'processing' | 'complete' | 'error';
    currentPage: number;
    totalPages: number;
    percentage: number;
}

export type ProgressCallback = (progress: PdfProcessingProgress) => void;

/**
 * Render a PDF page to a canvas and return as blob
 */
async function renderPageToBlob(
    page: pdfjsLib.PDFPageProxy,
    scale: number
): Promise<{ blob: Blob; width: number; height: number }> {
    const viewport = page.getViewport({ scale });

    // Create canvas
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
        throw new Error('Could not get canvas 2D context');
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // Render page to canvas
    await page.render({
        canvasContext: context,
        viewport,
        canvas,
    }).promise;

    // Convert canvas to blob
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve({
                        blob,
                        width: viewport.width,
                        height: viewport.height,
                    });
                } else {
                    reject(new Error('Failed to create blob from canvas'));
                }
            },
            'image/png',
            0.92
        );
    });
}

/**
 * Process a PDF file and convert each page to an image
 * 
 * @param file - PDF file to process
 * @param onProgress - Callback for progress updates
 * @returns Array of processed slides with image and thumbnail blobs
 */
export async function processPdf(
    file: File,
    onProgress?: ProgressCallback
): Promise<ProcessedSlide[]> {
    const slides: ProcessedSlide[] = [];

    try {
        // Report loading stage
        onProgress?.({
            stage: 'loading',
            currentPage: 0,
            totalPages: 0,
            percentage: 0,
        });

        // Load PDF from file
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;

        // Process each page
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            onProgress?.({
                stage: 'processing',
                currentPage: pageNum,
                totalPages,
                percentage: Math.round((pageNum / totalPages) * 100),
            });

            const page = await pdf.getPage(pageNum);

            // Render full-size image (scale 2 for good quality on retina displays)
            const fullSize = await renderPageToBlob(page, 2);

            // Render thumbnail (smaller scale)
            const thumbnail = await renderPageToBlob(page, 0.5);

            slides.push({
                slideNumber: pageNum,
                imageBlob: fullSize.blob,
                thumbnailBlob: thumbnail.blob,
                width: fullSize.width,
                height: fullSize.height,
            });
        }

        onProgress?.({
            stage: 'complete',
            currentPage: totalPages,
            totalPages,
            percentage: 100,
        });

        return slides;
    } catch (error) {
        onProgress?.({
            stage: 'error',
            currentPage: 0,
            totalPages: 0,
            percentage: 0,
        });
        throw error;
    }
}

/**
 * Validate that a file is a valid PDF
 */
export function isValidPdf(file: File): boolean {
    // Check MIME type
    if (file.type !== 'application/pdf') {
        return false;
    }

    // Check file extension
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension !== 'pdf') {
        return false;
    }

    return true;
}

/**
 * Get recommended max file size (50MB for MVP)
 */
export const MAX_PDF_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export function isFileSizeValid(file: File): boolean {
    return file.size <= MAX_PDF_SIZE_BYTES;
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
