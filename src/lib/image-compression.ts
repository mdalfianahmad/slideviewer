/**
 * Image compression utilities for Phase 2 optimizations
 * Converts images to WebP format with optimized quality settings
 */

/**
 * Check if browser supports WebP format
 */
export function supportsWebP(): boolean {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
}

/**
 * Convert a blob/image to WebP format with specified quality
 * Falls back to original format if WebP is not supported
 * 
 * @param blob - Image blob to convert
 * @param quality - Quality (0-1), default 0.85
 * @param maxWidth - Optional max width to resize
 * @param maxHeight - Optional max height to resize
 * @returns WebP blob (or original if WebP not supported)
 */
export async function convertToWebP(
    blob: Blob,
    quality: number = 0.85,
    maxWidth?: number,
    maxHeight?: number
): Promise<Blob> {
    // Check if WebP is supported
    if (!supportsWebP()) {
        console.warn('WebP not supported, using original format');
        return blob;
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;

            // Resize if max dimensions specified
            if (maxWidth || maxHeight) {
                const aspectRatio = width / height;
                if (maxWidth && width > maxWidth) {
                    width = maxWidth;
                    height = width / aspectRatio;
                }
                if (maxHeight && height > maxHeight) {
                    height = maxHeight;
                    width = height * aspectRatio;
                }
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Could not get canvas context'));
                return;
            }

            // Draw image to canvas
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to WebP
            canvas.toBlob(
                (webpBlob) => {
                    if (webpBlob) {
                        resolve(webpBlob);
                    } else {
                        reject(new Error('Failed to convert to WebP'));
                    }
                },
                'image/webp',
                quality
            );
        };

        img.onerror = () => {
            reject(new Error('Failed to load image for conversion'));
        };

        img.src = URL.createObjectURL(blob);
    });
}

/**
 * Compress an image blob with WebP conversion
 * Optimized settings for slide images
 * 
 * @param blob - Image blob to compress
 * @param isThumbnail - Whether this is a thumbnail (uses lower quality)
 * @returns Compressed WebP blob
 */
export async function compressImage(
    blob: Blob,
    isThumbnail: boolean = false
): Promise<Blob> {
    // Use different quality settings for thumbnails vs full images
    const quality = isThumbnail ? 0.75 : 0.85;
    
    // For thumbnails, also limit size
    const maxWidth = isThumbnail ? 400 : undefined;
    const maxHeight = isThumbnail ? 400 : undefined;

    return convertToWebP(blob, quality, maxWidth, maxHeight);
}

/**
 * Get file extension for WebP format
 */
export function getWebPExtension(): string {
    return supportsWebP() ? 'webp' : 'png';
}

/**
 * Get MIME type for WebP format
 */
export function getWebPMimeType(): string {
    return supportsWebP() ? 'image/webp' : 'image/png';
}
