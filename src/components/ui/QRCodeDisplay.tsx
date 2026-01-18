import { useEffect, useState, useCallback } from 'react';
import QRCode from 'qrcode';
import styles from './QRCodeDisplay.module.css';

interface QRCodeDisplayProps {
    url: string;
    size?: number;
    showDownload?: boolean;
    className?: string;
}

export function QRCodeDisplay({ url, size = 150, showDownload = false, className }: QRCodeDisplayProps) {
    const [qrDataUrl, setQrDataUrl] = useState<string>('');

    useEffect(() => {
        QRCode.toDataURL(url, {
            width: size * 2, // Higher res for download
            margin: 1,
            color: {
                dark: '#000000',
                light: '#ffffff',
            },
        })
            .then(setQrDataUrl)
            .catch(console.error);
    }, [url, size]);

    const handleDownload = useCallback(() => {
        if (!qrDataUrl) return;

        const link = document.createElement('a');
        link.download = 'qr-code.png';
        link.href = qrDataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [qrDataUrl]);

    if (!qrDataUrl) return null;

    return (
        <div className={`${styles.container} ${className || ''}`}>
            <img
                src={qrDataUrl}
                alt="QR Code to join presentation"
                width={size}
                height={size}
                className={styles.qrImage}
            />
            {showDownload && (
                <button className={styles.downloadBtn} onClick={handleDownload}>
                    Download QR Code
                </button>
            )}
        </div>
    );
}
