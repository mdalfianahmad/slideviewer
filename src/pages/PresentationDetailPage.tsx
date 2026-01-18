import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container } from '../components/layout/Container';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { Input } from '../components/ui/Input';
import { QRCodeDisplay } from '../components/ui/QRCodeDisplay';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatInviteCodeForDisplay, getJoinUrl } from '../lib/invite-code';
import type { Presentation } from '../types/database';
import styles from './PresentationDetailPage.module.css';

export function PresentationDetailPage() {
    const { presentationId } = useParams<{ presentationId: string }>();
    const navigate = useNavigate();
    const { user, isLoading: authLoading } = useAuth();

    const [presentation, setPresentation] = useState<Presentation | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [isEditing, setIsEditing] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [isCopied, setIsCopied] = useState(false);

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            navigate('/');
            return;
        }
        if (!presentationId) {
            setError('No presentation ID');
            setIsLoading(false);
            return;
        }

        async function fetchPresentation() {
            const { data, error: err } = await supabase
                .from('presentations')
                .select('*')
                .eq('id', presentationId)
                .eq('user_id', user!.id)
                .single();

            if (err || !data) {
                setError('Presentation not found or access denied');
            } else {
                setPresentation(data as Presentation);
                setNewTitle(data.title);
            }
            setIsLoading(false);
        }

        fetchPresentation();
    }, [presentationId, user, authLoading, navigate]);

    const handleRename = useCallback(async () => {
        if (!presentation || !newTitle.trim()) return;

        const { error } = await supabase
            .from('presentations')
            .update({ title: newTitle.trim() })
            .eq('id', presentation.id);

        if (!error) {
            setPresentation(prev => prev ? { ...prev, title: newTitle.trim() } : null);
            setIsEditing(false);
        }
    }, [presentation, newTitle]);

    const handleDelete = useCallback(async () => {
        if (!presentation) return;
        if (!confirm('Delete this presentation? This cannot be undone.')) return;

        await supabase.from('presentations').delete().eq('id', presentation.id);
        navigate('/my-presentations');
    }, [presentation, navigate]);

    const handleCopyLink = useCallback(async () => {
        if (!presentation) return;
        await navigator.clipboard.writeText(getJoinUrl(presentation.invite_code));
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    }, [presentation]);

    const formatDate = (dateString: string | null) => {
        if (!dateString) return 'Never';
        const date = new Date(dateString);
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        });
    };

    if (authLoading || isLoading) {
        return (
            <div className={styles.page}>
                <Container size="sm" centered>
                    <div className={styles.loading}>
                        <Spinner size="lg" />
                        <p>Loading...</p>
                    </div>
                </Container>
            </div>
        );
    }

    if (error || !presentation) {
        return (
            <div className={styles.page}>
                <Container size="sm" centered>
                    <div className={styles.error}>
                        <h2>Error</h2>
                        <p>{error || 'Presentation not found'}</p>
                        <Button onClick={() => navigate('/my-presentations')}>
                            Back to Presentations
                        </Button>
                    </div>
                </Container>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <Container size="sm" centered>
                <div className={styles.content}>
                    {/* Back link */}
                    <button className={styles.backButton} onClick={() => navigate('/my-presentations')}>
                        ← Back to presentations
                    </button>

                    {/* Title with edit */}
                    <div className={styles.titleSection}>
                        {isEditing ? (
                            <div className={styles.editTitle}>
                                <Input
                                    value={newTitle}
                                    onChange={(e) => setNewTitle(e.target.value)}
                                    placeholder="Presentation title"
                                    fullWidth
                                />
                                <div className={styles.editActions}>
                                    <Button size="sm" onClick={handleRename}>Save</Button>
                                    <Button size="sm" variant="ghost" onClick={() => {
                                        setIsEditing(false);
                                        setNewTitle(presentation.title);
                                    }}>Cancel</Button>
                                </div>
                            </div>
                        ) : (
                            <div className={styles.titleRow}>
                                <h1 className={styles.title}>{presentation.title}</h1>
                                <button className={styles.editBtn} onClick={() => setIsEditing(true)}>
                                    ✏️ Rename
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Stats */}
                    <div className={styles.stats}>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Slides</span>
                            <span className={styles.statValue}>{presentation.slide_count}</span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Uploaded</span>
                            <span className={styles.statValue}>{formatDate(presentation.created_at)}</span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.statLabel}>Last Presented</span>
                            <span className={styles.statValue}>{formatDate(presentation.last_presented_at)}</span>
                        </div>
                    </div>

                    {/* QR Code section */}
                    <div className={styles.qrSection}>
                        <h3 className={styles.sectionTitle}>Share with Audience</h3>
                        <QRCodeDisplay
                            url={getJoinUrl(presentation.invite_code)}
                            size={180}
                            showDownload
                        />
                        <div className={styles.inviteCode}>
                            <span className={styles.codeLabel}>Invite Code</span>
                            <span className={styles.code}>
                                {formatInviteCodeForDisplay(presentation.invite_code)}
                            </span>
                        </div>
                        <button className={styles.copyBtn} onClick={handleCopyLink}>
                            {isCopied ? '✓ Copied!' : 'Copy Share Link'}
                        </button>
                    </div>

                    {/* Actions */}
                    <div className={styles.actions}>
                        <Button fullWidth size="lg" onClick={() => navigate(`/present/${presentation.id}`)}>
                            Start Presentation
                        </Button>
                        <Button fullWidth variant="ghost" onClick={handleDelete}>
                            Delete Presentation
                        </Button>
                    </div>
                </div>
            </Container>
        </div>
    );
}
