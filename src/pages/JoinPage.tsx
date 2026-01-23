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
    const [debugInfo, setDebugInfo] = useState<string>('');

    const handleJoin = useCallback(async (code?: string) => {
        const rawCode = code || inviteCode;
        const codeToValidate = normalizeInviteCode(rawCode);

        // Clear previous debug info
        setDebugInfo('');

        if (!codeToValidate) {
            setError('Please enter an invite code');
            setDebugInfo(`Raw code: "${rawCode}"`);
            return;
        }

        if (!isValidInviteCodeFormat(codeToValidate)) {
            setError(`Invalid code format. Enter 6 characters. (Got: "${codeToValidate}")`);
            setDebugInfo(`Raw: "${rawCode}" → Normalized: "${codeToValidate}"`);
            return;
        }

        setIsValidating(true);
        setError('');
        setDebugInfo(`Verifying code: ${codeToValidate}`);

        try {
            // Lookup presentation by invite code
            // Code is normalized to uppercase to match database storage
            const { data: presentation, error: fetchError } = await supabase
                .from('presentations')
                .select('*')
                .eq('invite_code', codeToValidate)
                .maybeSingle();

            // Check for actual database errors
            if (fetchError) {
                const errorMsg = fetchError.message || 'Unknown error';
                const errorCode = fetchError.code || 'NO_CODE';
                
                // PGRST116 is "not found" - treat as invalid code, not error
                if (errorCode === 'PGRST116' || 
                    errorMsg.toLowerCase().includes('no rows') ||
                    errorMsg.toLowerCase().includes('not found')) {
                    setError('Invalid invite code. Please check and try again.');
                    setDebugInfo(`Code "${codeToValidate}" not found in database.`);
                    setIsValidating(false);
                    return;
                }
                
                // Network/connection errors
                if (errorMsg.toLowerCase().includes('network') || 
                    errorMsg.toLowerCase().includes('fetch') ||
                    errorCode === 'PGRST301') {
                    setError('Connection error. Please check your internet and try again.');
                    setDebugInfo(`Network error: ${errorMsg}`);
                    setIsValidating(false);
                    return;
                }
                
                // Real database/network error - show more details
                setError(`Failed to verify code: ${errorMsg}`);
                setDebugInfo(`Error code: ${errorCode}. Details: ${fetchError.details || 'None'}`);
                setIsValidating(false);
                return;
            }

            if (!presentation) {
                setError('Invalid invite code. Please check and try again.');
                setDebugInfo(`Code "${codeToValidate}" not found.`);
                setIsValidating(false);
                return;
            }

            // Success!
            setDebugInfo('');
            const typedPresentation = presentation as Presentation;
            navigate(`/view/${typedPresentation.id}`);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            const errorStack = err instanceof Error ? err.stack : String(err);
            setError(`Failed to join: ${errorMessage}`);
            setDebugInfo(`Exception caught: ${errorMessage}\nStack: ${errorStack?.substring(0, 200)}`);
            setIsValidating(false);
        }
    }, [inviteCode, navigate]);

    useEffect(() => {
        if (urlCode) {
            const normalized = normalizeInviteCode(urlCode);
            setDebugInfo(`URL code: "${urlCode}" → Normalized: "${normalized}"`);
            
            if (isValidInviteCodeFormat(urlCode)) {
                handleJoin(urlCode);
            } else {
                setError(`Invalid code format from URL: "${urlCode}"`);
                setDebugInfo(`URL code "${urlCode}" failed format validation. Expected 6 characters.`);
            }
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

                {/* Error message */}
                {error && (
                    <div style={{ 
                        marginTop: '1rem',
                        padding: '0.75rem',
                        fontSize: '0.875rem',
                        color: '#d32f2f',
                        backgroundColor: '#ffebee',
                        borderRadius: '4px',
                        border: '1px solid #ffcdd2',
                        wordBreak: 'break-word'
                    }}>
                        <strong>Error:</strong> {error}
                    </div>
                )}

                {/* Debug info for mobile users - always show when there's debug info or error */}
                {(debugInfo || error) && (
                    <div style={{ 
                        marginTop: '0.5rem', 
                        padding: '0.75rem', 
                        fontSize: '0.75rem', 
                        color: '#666',
                        backgroundColor: '#f5f5f5',
                        borderRadius: '4px',
                        wordBreak: 'break-all',
                        fontFamily: 'monospace',
                        border: '1px solid #e0e0e0'
                    }}>
                        {debugInfo ? (
                            <>
                                <strong>Debug Info:</strong><br />
                                {debugInfo}
                            </>
                        ) : error ? (
                            <>
                                <strong>Debug:</strong> Error occurred but no debug info available.<br />
                                URL Code: "{urlCode || 'none'}"<br />
                                Normalized: "{normalizeInviteCode(urlCode || inviteCode)}"<br />
                                Valid Format: {isValidInviteCodeFormat(urlCode || inviteCode) ? 'Yes' : 'No'}
                            </>
                        ) : null}
                    </div>
                )}

                <button className={styles.backLink} onClick={() => navigate('/')}>
                    ← Back to home
                </button>
            </div>
        </Container>
    );
}
