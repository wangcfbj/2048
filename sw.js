// Service Worker for 2048 Game PWA
const CACHE_NAME = '2048-game-v27';

// Get the base path from the service worker's location
let basePath = self.location.pathname.replace('/sw.js', '');
if (!basePath.endsWith('/') && basePath !== '') {
  basePath += '/';
}
if (basePath === '/') {
  basePath = '';
}

const urlsToCache = [
  basePath + 'index.html',
  basePath + 'game.html',
  basePath + 'game.js',
  basePath + 'game.css',
  basePath + 'img/icon.png',
  basePath + 'manifest.webmanifest'
].filter(url => {
  // Remove any double slashes except after http(s):
  return url.replace(/([^:]\/)\/+/g, '$1');
});

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch((error) => {
        // console.log('Cache failed:', error);
        // Continue even if some files fail to cache
        return Promise.resolve();
      })
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            // console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Take control of all pages immediately
  return self.clients.claim();
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
      .catch(() => {
        // If both cache and network fail, return offline page if available
        if (event.request.destination === 'document') {
          return caches.match(basePath + 'game.html');
        }
      })
  );
});

