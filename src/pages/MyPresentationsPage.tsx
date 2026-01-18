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
        e.stopPropagation(); // Don't navigate to detail page
        if (!confirm('Delete this presentation? This cannot be undone.')) return;

        await supabase.from('presentations').delete().eq('id', id);
        setPresentations(prev => prev.filter(p => p.id !== id));
    }, []);

    const formatDate = (dateString: string) => {
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
                <Container size="md" centered>
                    <div className={styles.loading}>
                        <Spinner size="lg" />
                        <p>Loading...</p>
                    </div>
                </Container>
            </div>
        );
    }

    if (!user) {
        return (
            <div className={styles.page}>
                <Container size="sm" centered>
                    <div className={styles.signIn}>
                        <h1>Sign in Required</h1>
                        <p>Sign in to view your presentations</p>
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
            <Container size="md" centered>
                <header className={styles.header}>
                    <h1 className={styles.title}>My Presentations</h1>
                    <Button size="sm" onClick={() => navigate('/upload')}>
                        + Upload New
                    </Button>
                </header>

                {presentations.length === 0 ? (
                    <div className={styles.empty}>
                        <p>You haven't uploaded any presentations yet.</p>
                        <Button onClick={() => navigate('/upload')}>
                            Upload Your First Presentation
                        </Button>
                    </div>
                ) : (
                    <div className={styles.grid}>
                        {presentations.map((presentation) => (
                            <div key={presentation.id} className={styles.card}>
                                <button
                                    className={styles.cardMain}
                                    onClick={() => navigate(`/presentation/${presentation.id}`)}
                                >
                                    <div className={styles.cardContent}>
                                        <h2 className={styles.cardTitle}>{presentation.title}</h2>
                                        <span className={styles.cardMeta}>
                                            {presentation.slide_count} slides • {formatDate(presentation.created_at)}
                                        </span>
                                    </div>
                                    <span className={styles.cardArrow}>→</span>
                                </button>
                                <button
                                    className={styles.deleteBtn}
                                    onClick={(e) => handleDelete(e, presentation.id)}
                                    title="Delete presentation"
                                >
                                    🗑
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </Container>
        </div>
    );
}
