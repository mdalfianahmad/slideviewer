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
                            Share slides.
                            <span className={styles.highlight}> Everyone follows.</span>
                        </h1>
                        <p className={styles.subtitle}>
                            Present from any device. Your audience joins with a code and sees slides in real-time.
                        </p>
                    </header>

                    {/* Two-column layout */}
                    <div className={styles.grid}>
                        {/* Presenter side */}
                        <div className={styles.card}>
                            <span className={styles.cardIcon}>🎤</span>
                            <h3 className={styles.cardTitle}>I'm Presenting</h3>
                            <p className={styles.cardDesc}>
                                Upload PDF slides and share with your audience
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

                        {/* Audience side */}
                        <div className={styles.card}>
                            <span className={styles.cardIcon}>👀</span>
                            <h3 className={styles.cardTitle}>I'm Viewing</h3>
                            <p className={styles.cardDesc}>
                                Join a presentation with an invite code
                            </p>
                            <form onSubmit={handleJoinSubmit} className={styles.joinForm}>
                                <Input
                                    placeholder="ABC123"
                                    value={inviteCode}
                                    onChange={(e) => {
                                        setInviteCode(e.target.value.toUpperCase());
                                        setInviteError('');
                                    }}
                                    error={inviteError}
                                    maxLength={6}
                                    aria-label="Invite code"
                                    autoComplete="off"
                                    autoCapitalize="characters"
                                />
                                <Button type="submit" variant="secondary" fullWidth>
                                    Join
                                </Button>
                            </form>
                        </div>
                    </div>

                    {/* How it works - compact */}
                    <div className={styles.howItWorks}>
                        <div className={styles.step}>
                            <span>📄</span>
                            <span>Upload PDF</span>
                        </div>
                        <span className={styles.arrow}>→</span>
                        <div className={styles.step}>
                            <span>🔗</span>
                            <span>Share Code/QR</span>
                        </div>
                        <span className={styles.arrow}>→</span>
                        <div className={styles.step}>
                            <span>🎯</span>
                            <span>Present Live</span>
                        </div>
                    </div>
                </div>
            </Container>
        </div>
    );
}
