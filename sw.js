 































































































































































































































































































































































































































































































































































































const CACHE_NAME = 'volta-v101';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/volta.css',
  './css/volta-animations.css',
  './css/volta-sport-theme.css',
  './js/db.js',
  './js/chat.js',
  './js/volta-chat-ai.js',
  './js/data/meals.js',
  './js/data/workouts.js',
  './js/plan-engine.js',
  './js/premium.js',
  './js/notifications.js',
  './js/marketplace.js',
  './js/volta-features.js',
  './js/volta-sounds.js',
  './js/volta.js',
  './js/cloudsync.js',
  './js/volta-animations.js',
  './js/volta-clouds.js',
  './js/volta-google.js',
   
  './vendor/fonts/fonts.css',
  './vendor/fontawesome/css/all.min.css',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js',
  './vendor/chart.umd.js',
  './vendor/tesseract/tesseract.min.js',
  './js/vendor/firebasejs/10.12.2/firebase-app-compat.js',
  './js/vendor/firebasejs/10.12.2/firebase-auth-compat.js',
  './js/vendor/firebasejs/10.12.2/firebase-firestore-compat.js',
  './img1/banner-diet.jpg',
  './img1/banner-sports.jpg',
  './img1/banner-mood.jpg',
  './css/volta-redesign.css',
  './css/volta-premium.css',
    './css/volta-fitness.css',
  './css/volta-mobile.css',
  './js/lang/ar.js',
  './js/pricing-fallback.js',
  './js/volta-local-ai.js',
  './js/pose-engine.js',    
  './js/volta-ai.js',
   
   
  './js/volta-cloud-ai.js',
   
   
   
   
  './js/meal-engine.js',
  './js/data/meals-countries.js',
  './js/data/meals-countries-v60.js',
  './js/data/recipe-ar.js',
  './js/data/workouts-v60.js',
   
   
  './js/data/coach-kb.js',
  './js/volta-coach-matrix.js',
   
   
   
   
   
   
   
   
  './js/food-model.js',
  './vendor/transformers/transformers.min.js',
  './vendor/transformers/ort-wasm-simd-threaded.jsep.mjs',
  './vendor/transformers/ort-wasm-simd-threaded.jsep.wasm',
  './vendor/models/onnx-community/swin-finetuned-food101-ONNX/config.json',
  './vendor/models/onnx-community/swin-finetuned-food101-ONNX/preprocessor_config.json',
  './vendor/models/onnx-community/swin-finetuned-food101-ONNX/onnx/model_quantized.onnx',
   
   
   
   
   
   
   
   
   
   
   
   
  './js/volta-local-llm.js',
  './vendor/models/onnx-community/SmolLM2-135M-Instruct-ONNX/config.json',
  './vendor/models/onnx-community/SmolLM2-135M-Instruct-ONNX/generation_config.json',
  './vendor/models/onnx-community/SmolLM2-135M-Instruct-ONNX/special_tokens_map.json',
  './vendor/models/onnx-community/SmolLM2-135M-Instruct-ONNX/tokenizer.json',
  './vendor/models/onnx-community/SmolLM2-135M-Instruct-ONNX/tokenizer_config.json',
  './vendor/models/onnx-community/SmolLM2-135M-Instruct-ONNX/onnx/model_quantized.onnx',
  './vendor/mediapipe/vision_bundle.mjs',
  './vendor/mediapipe/pose_landmarker_lite.task',
  './vendor/mediapipe/wasm/vision_wasm_internal.js',
  './vendor/mediapipe/wasm/vision_wasm_internal.wasm',
   
  './sounds/ui-click.mp3',
  './icon-192.png',
   
   
];

 
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
       
      return Promise.all(
        APP_SHELL.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn('[Volta SW] Missed precache:', url, err);
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

 
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames.map(function (cacheName) {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

 
 
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

 
self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'show-notification') {
    self.registration.showNotification(data.title || 'Volta', {
      body: data.body || '',
      icon: data.icon || 'icon-192.png',
      badge: data.icon || 'icon-192.png',
      tag: data.tag || 'volta-notification',
      renotify: true,
      data: { url: data.url || './' }
    });
  }
});

 
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'Volta', {
      body: data.body || '',
      icon: data.icon || 'icon-192.png',
      badge: data.icon || 'icon-192.png',
      tag: data.tag || 'volta-push'
    })
  );
});

 
self.addEventListener('fetch', function (event) {
   
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);

   
  if (!url.protocol.startsWith('http')) return;

   
  if (event.request.headers.get('range')) return;

  var sameOrigin = url.origin === self.location.origin;

   
  if (!sameOrigin && (url.pathname.indexOf('/api/') !== -1 || url.hostname.indexOf('textdb.dev') !== -1)) {
    return;
  }

   
   
   
  if (!sameOrigin && (url.hostname === 'huggingface.co' || url.hostname === 'hf.co' ||
      url.hostname.indexOf('.hf.co') !== -1 || url.hostname === 'cdn-lfs.huggingface.co' ||
      url.hostname.indexOf('cdn-lfs') === 0)) {
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreVary: true }).then(function (cachedResponse) {
       
      if (cachedResponse) {
        fetch(event.request).then(function (networkResponse) {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, networkResponse.clone());
            });
          }
        }).catch(function () {   });
        return cachedResponse;
      }

       
      return fetch(event.request).then(function (networkResponse) {
        if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
          var responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(function () {
         
        if (event.request.mode === 'navigate' ||
            (event.request.headers.get('accept') || '').indexOf('text/html') !== -1) {
          return caches.match('./index.html');
        }
        return undefined;
      });
    })
  );
});
