import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Container } from '../components/layout/Container';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../context/AuthContext';
import { normalizeInviteCode, isValidInviteCodeFormat } from '../lib/invite-code';
import styles from './HomePage.module.css';

export function HomePage() {
    const navigate = useNavigate();
    const { user, signInWithGoogle } = useAuth();
    const [inviteCode, setInviteCode] = useState('');
    const [inviteError, setInviteError] = useState('');

    const handleJoinSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setInviteError('');

        const normalizedCode = normalizeInviteCode(inviteCode);

        if (!normalizedCode) {
            setInviteError('Please enter an invite code');
            return;
        }

        if (!isValidInviteCodeFormat(normalizedCode)) {
            setInviteError('Invalid code format');
            return;
        }

        navigate(`/join/${normalizedCode}`);
    };

    return (
        <div className={styles.page}>
            <Container size="md" centered>
                <div className={styles.content}>
                    {/* Hero */}
                    <header className={styles.hero}>
                        <h1 className={styles.title}>
                            Present together.
                            <span className={styles.highlight}> Everyone stays in sync.</span>
                        </h1>
                        <p className={styles.subtitle}>
                            Upload your slides, share a code, and your audience follows along in real-time.
                        </p>
                    </header>

                    {/* Two-column layout */}
                    <div className={styles.grid}>
                        {/* Presenter side */}
                        <div className={`${styles.card} ${styles.presenterCard}`}>
                            <div className={styles.cardHeader}>
                                <span className={styles.cardIcon}>🎤</span>
                                <h3 className={styles.cardTitle}>I'm Presenting</h3>
                            </div>
                            <p className={styles.cardDesc}>
                                Upload your PDF and get a shareable code instantly
                            </p>
                            {user ? (
                                <Button fullWidth onClick={() => navigate('/upload')}>
                                    Upload Slides
                                </Button>
                            ) : (
                                <Button fullWidth onClick={signInWithGoogle}>
                                    Sign in to Start
                                </Button>
                            )}
                            {user && (
                                <button
                                    className={styles.linkButton}
                                    onClick={() => navigate('/my-presentations')}
                                >
                                    View my presentations →
                                </button>
                            )}
                        </div>

                        {/* Viewer side */}
                        <div className={`${styles.card} ${styles.viewerCard}`}>
                            <div className={styles.cardHeader}>
                                <span className={styles.cardIcon}>👀</span>
                                <h3 className={styles.cardTitle}>I'm Viewing</h3>
                            </div>
                            <p className={styles.cardDesc}>
                                Enter the code shared by your presenter
                            </p>
                            <form onSubmit={handleJoinSubmit} className={styles.joinForm}>
                                <Input
                                    type="text"
                                    placeholder="ABC123"
                                    value={inviteCode}
                                    onChange={(e) => setInviteCode(e.target.value)}
                                    className={styles.codeInput}
                                    error={inviteError}
                                    maxLength={7}
                                />
                                <Button type="submit" fullWidth variant="secondary">
                                    Join Presentation
                                </Button>
                            </form>
                        </div>
                    </div>

                    {/* How it works - more inviting */}
                    <div className={styles.howItWorks}>
                        <div className={styles.stepsContainer}>
                            <div className={styles.step}>
                                <div className={styles.stepNumber}>1</div>
                                <span className={styles.stepText}>Upload PDF</span>
                            </div>
                            <div className={styles.stepDivider}></div>
                            <div className={styles.step}>
                                <div className={styles.stepNumber}>2</div>
                                <span className={styles.stepText}>Share Code</span>
                            </div>
                            <div className={styles.stepDivider}></div>
                            <div className={styles.step}>
                                <div className={styles.stepNumber}>3</div>
                                <span className={styles.stepText}>Present Live</span>
                            </div>
                        </div>
                    </div>
                </div>
            </Container>
        </div>
    );
}
