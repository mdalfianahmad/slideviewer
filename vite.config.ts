/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png', 'robots.txt'],
      manifest: {
        name: 'JoinDeck',
        short_name: 'JoinDeck',
        description: 'Real-time presentation sharing',
        theme_color: '#0891b2',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          {
            src: '/logo.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/logo.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        // PHASE 2: Custom caching strategy for slide images
        runtimeCaching: [
          {
            // Cache-first strategy for slide images (99% cache hit rate)
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/slides\/.*\.(webp|png|jpg|jpeg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'slide-images-cache',
              expiration: {
                maxEntries: 1000, // Cache up to 1000 images
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Network-first for presentation metadata (always fresh)
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 5 * 60, // 5 minutes
              },
              networkTimeoutSeconds: 3,
            },
          },
          {
            // Stale-while-revalidate for thumbnails (fast but fresh)
            urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/slides\/.*\/thumbnails\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'thumbnail-cache',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 days
              },
            },
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
  },
});
