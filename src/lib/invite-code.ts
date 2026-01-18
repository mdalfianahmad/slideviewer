// Invite code generation utilities

const INVITE_CODE_LENGTH = 6;
const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars: 0, O, I, 1

/**
 * Generate a random invite code
 * 6 characters, alphanumeric, case-insensitive safe
 */
export function generateInviteCode(): string {
    let code = '';
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
        const randomIndex = Math.floor(Math.random() * INVITE_CODE_CHARS.length);
        code += INVITE_CODE_CHARS[randomIndex];
    }
    return code;
}

/**
 * Normalize an invite code for comparison (uppercase, trimmed)
 */
export function normalizeInviteCode(code: string): string {
    return code.replace(/\s+/g, '').toUpperCase().trim();
}

/**
 * Validate invite code format (6 alphanumeric characters)
 */
export function isValidInviteCodeFormat(code: string): boolean {
    const normalized = normalizeInviteCode(code);
    if (normalized.length !== INVITE_CODE_LENGTH) {
        return false;
    }
    // Check all characters are valid
    for (const char of normalized) {
        if (!INVITE_CODE_CHARS.includes(char)) {
            return false;
        }
    }
    return true;
}

/**
 * Format invite code for display (add spaces for readability)
 * Example: "ABC123" -> "ABC 123"
 */
export function formatInviteCodeForDisplay(code: string): string {
    const normalized = normalizeInviteCode(code);
    if (normalized.length !== INVITE_CODE_LENGTH) {
        return normalized;
    }
    return `${normalized.slice(0, 3)} ${normalized.slice(3)}`;
}

/**
 * Generate a shareable URL for joining a presentation
 * Uses VITE_BASE_URL env var if set, otherwise uses current origin
 */
export function getJoinUrl(inviteCode: string): string {
    const baseUrl = import.meta.env.VITE_BASE_URL ||
        (typeof window !== 'undefined' ? window.location.origin : '');
    return `${baseUrl}/join/${normalizeInviteCode(inviteCode)}`;
}
