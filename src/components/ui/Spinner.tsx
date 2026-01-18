import styles from './Spinner.module.css';

export interface SpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
    const classNames = [styles.spinner, styles[size], className]
        .filter(Boolean)
        .join(' ');

    return (
        <div className={classNames} role="status" aria-label="Loading">
            <span className="visually-hidden">Loading...</span>
        </div>
    );
}
