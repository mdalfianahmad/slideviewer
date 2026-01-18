import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { Container } from '../components/layout/Container';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { QRCodeDisplay } from '../components/ui/QRCodeDisplay';
import { supabase, SLIDES_BUCKET, getPublicUrl } from '../lib/supabase';
import {
    processPdf,
    isValidPdf,
    isFileSizeValid,
    formatFileSize,
    MAX_PDF_SIZE_BYTES,
    type PdfProcessingProgress,
} from '../lib/pdf';
import { generateInviteCode, getJoinUrl } from '../lib/invite-code';
import { addRecentPresentation } from '../lib/storage';
import { useAuth } from '../context/AuthContext';
import styles from './UploadPage.module.css';

type UploadStage = 'idle' | 'processing' | 'uploading' | 'saving' | 'complete' | 'error';

interface UploadState {
    stage: UploadStage;
    progress: number;
    message: string;
    presentationId?: string;
    inviteCode?: string;
}

export function UploadPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, isLoading: authLoading, signInWithGoogle, signOut } = useAuth();
    const [file, setFile] = useState<File | null>(null);
    const [uploadState, setUploadState] = useState<UploadState>({
        stage: 'idle',
        progress: 0,
        message: '',
    });
    const [error, setError] = useState('');

    // Check if a file was passed from the home page
    useEffect(() => {
        const passedFile = location.state?.file as File | undefined;
        if (passedFile && isValidPdf(passedFile)) {
            setFile(passedFile);
        }
    }, [location.state]);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        setError('');
        if (acceptedFiles.length === 0) return;

        const selectedFile = acceptedFiles[0];

        if (!isValidPdf(selectedFile)) {
            setError('Please select a valid PDF file');
            return;
        }

        if (!isFileSizeValid(selectedFile)) {
            setError(`File size must be under ${formatFileSize(MAX_PDF_SIZE_BYTES)}`);
            return;
        }

        setFile(selectedFile);
    }, []);

    const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
        onDrop,
        accept: { 'application/pdf': ['.pdf'] },
        multiple: false,
        noClick: true,
        disabled: uploadState.stage !== 'idle',
    });

    const handleUpload = async () => {
        if (!file) return;

        setError('');

        try {
            // Step 1: Process PDF to images
            setUploadState({
                stage: 'processing',
                progress: 0,
                message: 'Processing PDF...',
            });

            const slides = await processPdf(file, (progress: PdfProcessingProgress) => {
                setUploadState({
                    stage: 'processing',
                    progress: progress.percentage * 0.4, // 0-40%
                    message: `Processing page ${progress.currentPage} of ${progress.totalPages}...`,
                });
            });

            // Step 2: Create presentation record
            setUploadState({
                stage: 'saving',
                progress: 40,
                message: 'Creating presentation...',
            });

            const presentationId = crypto.randomUUID();
            const presenterToken = crypto.randomUUID(); // Secret for the uploader
            // Sanitize filename to prevent XSS
            const title = file.name
                .replace(/\.pdf$/i, '')
                .replace(/[<>:"\/\\|?*&]/g, '') // Remove dangerous chars
                .trim()
                .slice(0, 100) // Limit length
                || 'Untitled Presentation';
            const inviteCode = generateInviteCode();

            // Upload original PDF
            const pdfPath = `${presentationId}/original.pdf`;
            const { error: pdfUploadError } = await supabase.storage
                .from(SLIDES_BUCKET)
                .upload(pdfPath, file);

            if (pdfUploadError) {
                throw new Error(`Failed to upload PDF: ${pdfUploadError.message}`);
            }

            const pdfUrl = getPublicUrl(SLIDES_BUCKET, pdfPath);

            // Insert presentation record with invite code and presenter token
            const { error: insertError } = await supabase.from('presentations').insert({
                id: presentationId,
                user_id: user?.id,
                title,
                file_url: pdfUrl,
                slide_count: slides.length,
                status: 'processing',
                invite_code: inviteCode,
                presenter_token: presenterToken,
                current_slide_index: 1,
            });

            if (insertError) {
                throw new Error(`Failed to create presentation: ${insertError.message}`);
            }

            // Step 3: Upload slide images
            setUploadState({
                stage: 'uploading',
                progress: 45,
                message: 'Uploading slides...',
            });

            const slideRecords = [];
            const totalSlides = slides.length;

            for (let i = 0; i < slides.length; i++) {
                const slide = slides[i];
                const progressPercent = 45 + (i / totalSlides) * 50; // 45-95%

                setUploadState({
                    stage: 'uploading',
                    progress: progressPercent,
                    message: `Uploading slide ${i + 1} of ${totalSlides}...`,
                });

                // Upload full image
                const imagePath = `${presentationId}/slides/${slide.slideNumber}.png`;
                const { error: imageError } = await supabase.storage
                    .from(SLIDES_BUCKET)
                    .upload(imagePath, slide.imageBlob);

                if (imageError) {
                    console.error(`Failed to upload slide ${slide.slideNumber}:`, imageError);
                    continue;
                }

                // Upload thumbnail
                const thumbnailPath = `${presentationId}/thumbnails/${slide.slideNumber}.png`;
                const { error: thumbError } = await supabase.storage
                    .from(SLIDES_BUCKET)
                    .upload(thumbnailPath, slide.thumbnailBlob);

                if (thumbError) {
                    console.error(`Failed to upload thumbnail ${slide.slideNumber}:`, thumbError);
                }

                slideRecords.push({
                    presentation_id: presentationId,
                    slide_number: slide.slideNumber,
                    image_url: getPublicUrl(SLIDES_BUCKET, imagePath),
                    thumbnail_url: thumbError ? null : getPublicUrl(SLIDES_BUCKET, thumbnailPath),
                });
            }

            // Insert slide records
            if (slideRecords.length > 0) {
                const { error: slidesError } = await supabase.from('slides').insert(slideRecords);
                if (slidesError) {
                    console.error('Failed to insert slide records:', slidesError);
                }
            }

            // Update presentation status to ready
            await supabase
                .from('presentations')
                .update({ status: 'ready' })
                .eq('id', presentationId);

            // Add to recent presentations
            addRecentPresentation({
                id: presentationId,
                title,
                slideCount: slides.length,
                createdAt: new Date().toISOString(),
                thumbnailUrl: slideRecords[0]?.thumbnail_url || undefined,
                presenterToken,
            });

            // Step 4: Complete
            setUploadState({
                stage: 'complete',
                progress: 100,
                message: 'Upload complete!',
                presentationId,
                inviteCode,
            });
        } catch (err) {
            console.error('Upload error:', err);
            setUploadState({
                stage: 'error',
                progress: 0,
                message: '',
            });
            setError(err instanceof Error ? err.message : 'An unknown error occurred');
        }
    };

    const handleStartPresentation = () => {
        if (uploadState.presentationId) {
            navigate(`/present/${uploadState.presentationId}`);
        }
    };

    const handleReset = () => {
        setFile(null);
        setError('');
        setUploadState({
            stage: 'idle',
            progress: 0,
            message: '',
        });
    };

    const isProcessing = ['processing', 'uploading', 'saving'].includes(uploadState.stage);

    // Auth loading state
    if (authLoading) {
        return (
            <div className={styles.page}>
                <Container size="sm" centered>
                    <div className={styles.authLoading}>
                        <Spinner size="lg" />
                        <p>Loading...</p>
                    </div>
                </Container>
            </div>
        );
    }

    // Not logged in - show sign in
    if (!user) {
        return (
            <div className={styles.page}>
                <Container size="sm" centered>
                    <div className={styles.signIn}>
                        <h1 className={styles.signInTitle}>Sign in to Upload</h1>
                        <p className={styles.signInText}>
                            Sign in with your Google account to upload and present slides.
                        </p>
                        <Button fullWidth onClick={signInWithGoogle}>
                            Sign in with Google
                        </Button>
                        <button className={styles.backLink} onClick={() => navigate('/')}>
                            ← Back to home
                        </button>
                    </div>
                </Container>
            </div>
        );
    }

    return (
        <div {...getRootProps()} className={styles.page}>
            <input {...getInputProps()} />

            {/* Top bar with user info */}
            {user && (
                <div className={styles.topBar}>
                    <span className={styles.userEmail}>{user.email}</span>
                    <button className={styles.signOutBtn} onClick={signOut}>
                        Sign out
                    </button>
                </div>
            )}

            <Container size="sm" centered>
                <div className={styles.content}>
                    {/* Header */}
                    <header className={styles.header}>
                        <button
                            className={styles.backButton}
                            onClick={() => navigate('/')}
                            disabled={isProcessing}
                            aria-label="Back to home"
                        >
                            ← Back
                        </button>
                        <h1 className={styles.title}>Upload Slides</h1>
                    </header>

                    {/* Upload State Content */}
                    {uploadState.stage === 'idle' && (
                        <>
                            {/* Dropzone */}
                            <div
                                className={`${styles.dropzone} ${isDragActive ? styles.dragActive : ''} ${file ? styles.hasFile : ''}`}
                                onClick={open}
                            >
                                {file ? (
                                    <div className={styles.fileInfo}>
                                        <span className={styles.fileName}>{file.name}</span>
                                        <span className={styles.fileSize}>{formatFileSize(file.size)}</span>
                                    </div>
                                ) : (
                                    <div className={styles.dropzoneContent}>
                                        <span className={styles.dropIcon}>📄</span>
                                        <p className={styles.dropText}>
                                            {isDragActive ? 'Drop your PDF here' : 'Click or drag PDF to upload'}
                                        </p>
                                        <p className={styles.dropHint}>PDF only, max {formatFileSize(MAX_PDF_SIZE_BYTES)}</p>
                                    </div>
                                )}
                            </div>

                            {/* Error */}
                            {error && <p className={styles.error}>{error}</p>}

                            {/* Actions */}
                            <div className={styles.actions}>
                                {file && (
                                    <>
                                        <Button fullWidth onClick={handleUpload}>
                                            Process & Upload
                                        </Button>
                                        <Button variant="ghost" fullWidth onClick={handleReset}>
                                            Choose Different File
                                        </Button>
                                    </>
                                )}
                            </div>
                        </>
                    )}

                    {/* Processing State */}
                    {isProcessing && (
                        <div className={styles.processing}>
                            <div className={styles.progressBar}>
                                <div
                                    className={styles.progressFill}
                                    style={{ width: `${uploadState.progress}%` }}
                                />
                            </div>
                            <p className={styles.progressText}>{uploadState.message}</p>
                            <p className={styles.progressPercent}>{Math.round(uploadState.progress)}%</p>
                        </div>
                    )}

                    {/* Complete State */}
                    {uploadState.stage === 'complete' && (
                        <div className={styles.complete}>
                            <span className={styles.successIcon}>✓</span>
                            <h2 className={styles.successTitle}>Upload Complete</h2>
                            <p className={styles.successMessage}>Your slides are ready to present</p>

                            {/* Invite Code Display */}
                            {uploadState.inviteCode && (
                                <div className={styles.inviteCodeBox}>
                                    <QRCodeDisplay
                                        url={getJoinUrl(uploadState.inviteCode)}
                                        size={120}
                                        className={styles.qrCode}
                                    />
                                    <span className={styles.inviteLabel}>Invite Code</span>
                                    <span className={styles.inviteCode}>
                                        {uploadState.inviteCode.slice(0, 3)} {uploadState.inviteCode.slice(3)}
                                    </span>
                                    <button
                                        className={styles.copyButton}
                                        onClick={() => {
                                            navigator.clipboard.writeText(
                                                getJoinUrl(uploadState.inviteCode!)
                                            );
                                        }}
                                    >
                                        Copy Link
                                    </button>
                                </div>
                            )}

                            <div className={styles.actions}>
                                <Button fullWidth onClick={handleStartPresentation}>
                                    Start Presentation
                                </Button>
                                <Button variant="secondary" fullWidth onClick={handleReset}>
                                    Upload Another
                                </Button>
                                <Button
                                    variant="ghost"
                                    fullWidth
                                    onClick={async () => {
                                        if (uploadState.presentationId && confirm('Delete this presentation?')) {
                                            await supabase.from('presentations').delete().eq('id', uploadState.presentationId);
                                            handleReset();
                                        }
                                    }}
                                >
                                    Delete Presentation
                                </Button>
                                <Button
                                    variant="ghost"
                                    fullWidth
                                    onClick={() => navigate('/my-presentations')}
                                >
                                    View All Presentations
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Error State */}
                    {uploadState.stage === 'error' && (
                        <div className={styles.errorState}>
                            <span className={styles.errorIcon}>!</span>
                            <h2 className={styles.errorTitle}>Upload Failed</h2>
                            <p className={styles.errorMessage}>{error}</p>
                            <Button variant="secondary" fullWidth onClick={handleReset}>
                                Try Again
                            </Button>
                        </div>
                    )}
                </div>
            </Container>
        </div>
    );
}
