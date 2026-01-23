import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container } from '../components/layout/Container';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Spinner } from '../components/ui/Spinner';
import { supabase } from '../lib/supabase';
import { normalizeInviteCode, isValidInviteCodeFormat } from '../lib/invite-code';
import type { Presentation } from '../types/database';
import styles from './JoinPage.module.css';

export function JoinPage() {
    const { code: urlCode } = useParams<{ code?: string }>();
    const navigate = useNavigate();
    const [inviteCode, setInviteCode] = useState(urlCode || '');
    const [error, setError] = useState('');
    const [isValidating, setIsValidating] = useState(false);

    const handleJoin = useCallback(async (code?: string) => {
        const codeToValidate = normalizeInviteCode(code || inviteCode);

        if (!codeToValidate) {
            setError('Please enter an invite code');
            return;
        }

        if (!isValidInviteCodeFormat(codeToValidate)) {
            setError('Invalid code format. Enter 6 characters.');
            return;
        }

        setIsValidating(true);
        setError('');

        try {
            // Lookup presentation by invite code
            // Code is normalized to uppercase to match database storage
            const { data: presentation, error: fetchError } = await supabase
                .from('presentations')
                .select('*')
                .eq('invite_code', codeToValidate)
                .maybeSingle();

            if (fetchError) {
                // Log detailed error for debugging
                console.error('Database error when verifying code:', {
                    code: codeToValidate,
                    error: fetchError.message,
                    details: fetchError.details,
                    hint: fetchError.hint,
                    code: fetchError.code,
                });
                throw new Error('Failed to verify code. Please check your connection and try again.');
            }

            if (!presentation) {
                setError('Invalid invite code. Please check and try again.');
                setIsValidating(false);
                return;
            }

            const typedPresentation = presentation as Presentation;
            navigate(`/view/${typedPresentation.id}`);
        } catch (err) {
            console.error('Join error:', err);
            setError(err instanceof Error ? err.message : 'Failed to join presentation');
            setIsValidating(false);
        }
    }, [inviteCode, navigate]);

    useEffect(() => {
        if (urlCode && isValidInviteCodeFormat(urlCode)) {
            handleJoin(urlCode);
        }
    }, [urlCode, handleJoin]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        handleJoin();
    };

    if (urlCode && isValidating) {
        return (
            <div className={styles.loading}>
                <Spinner size="lg" />
                <p>Joining presentation...</p>
            </div>
        );
    }

    return (
        <Container size="sm" centered>
            <div className={styles.content}>
                <header className={styles.header}>
                    <h1 className={styles.title}>Join Presentation</h1>
                    <p className={styles.subtitle}>
                        Enter the 6-character code shared by the presenter
                    </p>
                </header>

                <form onSubmit={handleSubmit} className={styles.form}>
                    <Input
                        value={inviteCode}
                        onChange={(e) => {
                            setInviteCode(e.target.value.toUpperCase());
                            setError('');
                        }}
                        placeholder="ABC 123"
                        error={error}
                        maxLength={7}
                        autoComplete="off"
                        autoCapitalize="characters"
                        autoFocus
                        fullWidth
                        className={styles.codeInput}
                    />

                    <Button
                        type="submit"
                        fullWidth
                        loading={isValidating}
                        disabled={!inviteCode.trim()}
                    >
                        Join
                    </Button>
                </form>

                <button className={styles.backLink} onClick={() => navigate('/')}>
                    ← Back to home
                </button>
            </div>
        </Container>
    );
}
