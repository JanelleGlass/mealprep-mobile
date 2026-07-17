const CACHE = 'mealprep-mobile-v8';
const SHELL = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png',
  'js/app.js', 'js/supa.js', 'js/store.js', 'js/nutrition.js', 'js/backup.js',
  'js/ui/common.js', 'js/ui/log.js', 'js/ui/plan.js', 'js/ui/recipes.js', 'js/ui/pantry.js',
  'js/ui/settings.js', 'js/ui/pickers.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.hostname.endsWith('.supabase.co') || url.hostname === 'api.github.com') return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && url.origin === location.origin){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
