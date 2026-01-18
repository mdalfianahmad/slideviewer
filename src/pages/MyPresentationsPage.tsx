import { useEffect, useState } from 'react';
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
                        <button className={styles.backLink} onClick={() => navigate('/')}>
                            ← Back to home
                        </button>
                    </div>
                </Container>
            </div>
        );
    }

    return (
        <div className={styles.page}>
            <Container size="md" centered>
                <header className={styles.header}>
                    <button className={styles.backButton} onClick={() => navigate('/')}>
                        ← Back
                    </button>
                    <h1 className={styles.title}>My Presentations</h1>
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
                            <button
                                key={presentation.id}
                                className={styles.card}
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
                        ))}
                    </div>
                )}

                <div className={styles.footer}>
                    <Button variant="secondary" onClick={() => navigate('/upload')}>
                        Upload New Presentation
                    </Button>
                </div>
            </Container>
        </div>
    );
}
