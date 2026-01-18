import React from 'react';
import styles from './Container.module.css';

export interface ContainerProps {
    children: React.ReactNode;
    size?: 'sm' | 'md' | 'lg' | 'full';
    centered?: boolean;
    className?: string;
}

export function Container({
    children,
    size = 'md',
    centered = false,
    className = '',
}: ContainerProps) {
    const classNames = [
        styles.container,
        styles[size],
        centered ? styles.centered : '',
        className,
    ]
        .filter(Boolean)
        .join(' ');

    return <div className={classNames}>{children}</div>;
}
