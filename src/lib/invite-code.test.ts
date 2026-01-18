import { describe, it, expect } from 'vitest';
import {
    generateInviteCode,
    normalizeInviteCode,
    isValidInviteCodeFormat,
    formatInviteCodeForDisplay,
    getJoinUrl,
} from '../lib/invite-code';

// Valid characters used in invite codes (no 0, O, I, 1)
const VALID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

describe('invite-code utilities', () => {
    describe('generateInviteCode', () => {
        it('should generate a 6-character code', () => {
            const code = generateInviteCode();
            expect(code).toHaveLength(6);
        });

        it('should only contain valid characters (no confusing chars like 0, O, I, 1)', () => {
            for (let i = 0; i < 100; i++) {
                const code = generateInviteCode();
                for (const char of code) {
                    expect(VALID_CHARS).toContain(char);
                }
            }
        });

        it('should generate unique codes', () => {
            const codes = new Set<string>();
            for (let i = 0; i < 100; i++) {
                codes.add(generateInviteCode());
            }
            // High probability of all being unique
            expect(codes.size).toBeGreaterThan(95);
        });
    });

    describe('normalizeInviteCode', () => {
        it('should uppercase the code', () => {
            expect(normalizeInviteCode('abc234')).toBe('ABC234');
        });

        it('should remove spaces', () => {
            expect(normalizeInviteCode('ABC 234')).toBe('ABC234');
            expect(normalizeInviteCode(' ABC 234 ')).toBe('ABC234');
        });

        it('should trim whitespace', () => {
            expect(normalizeInviteCode('  ABC234  ')).toBe('ABC234');
        });
    });

    describe('isValidInviteCodeFormat', () => {
        it('should return true for valid 6-character codes', () => {
            // Use only valid chars (no 0, O, I, 1)
            expect(isValidInviteCodeFormat('ABC234')).toBe(true);
            expect(isValidInviteCodeFormat('XYZ789')).toBe(true);
        });

        it('should return true for lowercase (normalized internally)', () => {
            expect(isValidInviteCodeFormat('abc234')).toBe(true);
        });

        it('should return false for codes with invalid length', () => {
            expect(isValidInviteCodeFormat('ABC')).toBe(false);
            expect(isValidInviteCodeFormat('ABC2345678')).toBe(false);
        });

        it('should return false for codes with invalid characters', () => {
            expect(isValidInviteCodeFormat('ABC12O')).toBe(false); // O is excluded
            expect(isValidInviteCodeFormat('ABC12I')).toBe(false); // I is excluded
            expect(isValidInviteCodeFormat('ABC120')).toBe(false); // 0 is excluded
            expect(isValidInviteCodeFormat('ABC121')).toBe(false); // 1 is excluded
        });

        it('should return false for empty string', () => {
            expect(isValidInviteCodeFormat('')).toBe(false);
        });
    });

    describe('formatInviteCodeForDisplay', () => {
        it('should add a space in the middle for 6-char codes', () => {
            expect(formatInviteCodeForDisplay('ABC234')).toBe('ABC 234');
        });

        it('should uppercase the code', () => {
            expect(formatInviteCodeForDisplay('abc234')).toBe('ABC 234');
        });

        it('should return normalized code if not 6 chars', () => {
            expect(formatInviteCodeForDisplay('ABC')).toBe('ABC');
            expect(formatInviteCodeForDisplay('ABCDEFGH')).toBe('ABCDEFGH');
        });
    });

    describe('getJoinUrl', () => {
        it('should return a valid join URL', () => {
            const url = getJoinUrl('ABC234');
            expect(url).toContain('/join/ABC234');
        });

        it('should normalize the code in the URL', () => {
            const url = getJoinUrl('abc 234');
            expect(url).toContain('/join/ABC234');
        });
    });
});
