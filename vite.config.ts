import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3333',
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': o app avisa "Nova versão disponível" (banner na UI) e o
      // usuário decide quando atualizar — evita trocar o app no meio do uso.
      registerType: 'prompt',
      // Service worker ativo somente em produção.
      devOptions: {
        enabled: false,
      },
      manifest: {
        name: 'FunilTrack',
        short_name: 'FunilTrack',
        description:
          'Tracking de campanhas, funil de leads e alertas em um só console.',
        lang: 'pt-BR',
        dir: 'ltr',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#000000',
        background_color: '#000000',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache do app shell (assets estáticos do build).
        globPatterns: ['**/*.{js,css,html,woff,woff2,svg,png,webmanifest}'],
        // Trade-off: os chunks dos datasets mock (leads/daily-metrics têm
        // centenas de KB) NÃO entram no precache para o install do PWA não
        // baixar ~1 MB de dados de demo. Eles seguem funcionando offline
        // após o primeiro uso via runtime caching (regra "static-assets"
        // abaixo). Se os mocks forem trocados por API real, esses chunks
        // deixam de existir e nada muda.
        globIgnores: [
          '**/assets/leads-*.js',
          '**/assets/daily-metrics-*.js',
          '**/assets/campaigns-*.js',
          '**/assets/adsets-*.js',
          '**/assets/ads-*.js',
          '**/assets/alerts-*.js',
        ],
        // SPA: navegações offline caem no index.html.
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Chunks não precacheados (datasets mock) e demais assets: ficam
            // disponíveis offline depois do primeiro uso.
            urlPattern: /\.(?:js|css)$/i,
            handler: 'StaleWhileRevalidate',
            method: 'GET',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 96,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 dias
              },
            },
          },
          {
            // A API real precisa ser consultada antes do cache para que
            // alterações de estágio/leitura apareçam imediatamente depois de
            // uma mutação.
            urlPattern: /\/api\/.*$/i,
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'api-data',
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 60 * 60 * 24, // 1 dia
              },
            },
          },
          {
            // JSONs estáticos dos mocks continuam revalidando em segundo
            // plano quando o modo de demonstração está ativo.
            urlPattern: /\.json$/i,
            handler: 'StaleWhileRevalidate',
            method: 'GET',
            options: {
              cacheName: 'mock-data',
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 60 * 60 * 24,
              },
            },
          },
          {
            // Imagens: cache-first com expiração.
            urlPattern: /\.(?:png|jpe?g|gif|webp|avif|svg)$/i,
            handler: 'CacheFirst',
            method: 'GET',
            options: {
              cacheName: 'images',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 dias
              },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
  },
})
