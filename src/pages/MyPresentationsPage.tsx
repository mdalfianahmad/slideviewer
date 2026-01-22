import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container } from '../components/layout/Container';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Presentation } from '../types/database';
import styles from './MyPresentationsPage.module.css';

export function MyPresentationsPage() {
    const navigate = useNavigate();
    const { user, isLoading: authLoading, signInWithGoogle } = useAuth();
    const [presentations, setPresentations] = useState<Presentation[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (authLoading) return;

        if (!user) {
            setIsLoading(false);
            return;
        }

        async function fetchPresentations() {
            const { data, error } = await supabase
                .from('presentations')
                .select('*')
                .eq('user_id', user!.id)
                .order('created_at', { ascending: false });

            if (!error && data) {
                setPresentations(data as Presentation[]);
            }
            setIsLoading(false);
        }

        fetchPresentations();
    }, [user, authLoading]);

    const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm('Delete this presentation? This cannot be undone.')) return;

        await supabase.from('presentations').delete().eq('id', id);
        setPresentations(prev => prev.filter(p => p.id !== id));
    }, []);

    const handleStopPresentation = useCallback(async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm('Stop this presentation? Viewers will see that it has ended.')) return;

        const { error } = await supabase
            .from('presentations')
            .update({ is_live: false })
            .eq('id', id);

        if (!error) {
            setPresentations(prev => 
                prev.map(p => p.id === id ? { ...p, is_live: false } : p)
            );
        }
    }, []);

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    };

    if (authLoading || isLoading) {
        return (
            <div className={styles.page}>
                <Container size="lg">
                    <div className={styles.loading}>
                        <Spinner size="lg" />
                        <p>Loading presentations...</p>
                    </div>
                </Container>
            </div>
        );
    }

    if (!user) {
        return (
            <div className={styles.page}>
                <Container size="sm">
                    <div className={styles.signInCard}>
                        <div className={styles.signInIcon}>🔐</div>
                        <h1>Sign in to continue</h1>
                        <p>Access your presentations by signing in with your Google account.</p>
                        <Button fullWidth onClick={signInWithGoogle}>
                            Sign in with Google
                        </Button>
                    </div>
                </Container>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <Container size="lg">
                {/* Page Header */}
                <div className={styles.pageHeader}>
                    <div className={styles.headerLeft}>
                        <h1 className={styles.pageTitle}>My Presentations</h1>
                        <p className={styles.pageSubtitle}>
                            {presentations.length} presentation{presentations.length !== 1 ? 's' : ''}
                        </p>
                    </div>
                    <Button onClick={() => navigate('/upload')}>
                        + New Presentation
                    </Button>
                </div>

                {presentations.length === 0 ? (
                    <div className={styles.emptyState}>
                        <div className={styles.emptyIcon}>📑</div>
                        <h2>No presentations yet</h2>
                        <p>Upload your first PDF to get started</p>
                        <Button onClick={() => navigate('/upload')}>
                            Upload PDF
                        </Button>
                    </div>
                ) : (
                    <div className={styles.tableWrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Slides</th>
                                    <th>Created</th>
                                    <th>Status</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {presentations.map((presentation) => (
                                    <tr
                                        key={presentation.id}
                                        onClick={() => navigate(`/presentation/${presentation.id}`)}
                                        className={styles.tableRow}
                                    >
                                        <td className={styles.nameCell}>
                                            <span className={styles.presentationName}>{presentation.title}</span>
                                        </td>
                                        <td className={styles.slidesCell}>
                                            {presentation.slide_count}
                                        </td>
                                        <td className={styles.dateCell}>
                                            {formatDate(presentation.created_at)}
                                        </td>
                                        <td>
                                            {presentation.is_live ? (
                                                <span className={styles.statusLive}>● Live</span>
                                            ) : (
                                                <span className={styles.statusReady}>Ready</span>
                                            )}
                                        </td>
                                        <td className={styles.actionsCell}>
                                            {presentation.is_live ? (
                                                <button
                                                    className={`${styles.actionBtn} ${styles.stopBtn}`}
                                                    onClick={(e) => handleStopPresentation(e, presentation.id)}
                                                    title="Stop presentation"
                                                >
                                                    ⏹️
                                                </button>
                                            ) : (
                                                <button
                                                    className={styles.actionBtn}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navigate(`/present/${presentation.id}`);
                                                    }}
                                                    title="Start presenting"
                                                >
                                                    ▶️
                                                </button>
                                            )}
                                            <button
                                                className={`${styles.actionBtn} ${styles.deleteBtn}`}
                                                onClick={(e) => handleDelete(e, presentation.id)}
                                                title="Delete"
                                            >
                                                🗑️
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Container>
        </div>
    );
}
