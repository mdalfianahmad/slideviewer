import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { clearAllCache } from './lib/cache';
import './styles/reset.css';
import './styles/globals.css';

// Clean up old cache on app startup (older than 7 days)
clearAllCache(7 * 24 * 60 * 60 * 1000).catch(() => {
  // Ignore errors
});

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.log('SW registration failed:', error);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);
