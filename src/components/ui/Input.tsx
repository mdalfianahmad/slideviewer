import React, { forwardRef } from 'react';
import styles from './Input.module.css';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    hint?: string;
    fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ label, error, hint, fullWidth = false, className = '', id, ...props }, ref) => {
        const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

        const wrapperClass = [
            styles.wrapper,
            fullWidth ? styles.fullWidth : '',
            className,
        ]
            .filter(Boolean)
            .join(' ');

        const inputClass = [
            styles.input,
            error ? styles.error : '',
        ]
            .filter(Boolean)
            .join(' ');

        return (
            <div className={wrapperClass}>
                {label && (
                    <label htmlFor={inputId} className={styles.label}>
                        {label}
                    </label>
                )}
                <input
                    ref={ref}
                    id={inputId}
                    className={inputClass}
                    aria-invalid={!!error}
                    aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
                    {...props}
                />
                {error && (
                    <span id={`${inputId}-error`} className={styles.errorText} role="alert">
                        {error}
                    </span>
                )}
                {hint && !error && (
                    <span id={`${inputId}-hint`} className={styles.hint}>
                        {hint}
                    </span>
                )}
            </div>
        );
    }
);

Input.displayName = 'Input';
