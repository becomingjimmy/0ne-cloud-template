const CACHE_NAME = "0ne-v1";
const OFFLINE_URL = "/~offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip API routes, Clerk, and cross-origin requests
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/__clerk") ||
    url.hostname.includes("clerk.") ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Network-first for navigation, with offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
  }
});

// Push notification handlers (ready for future use)
self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || "0ne", {
        body: data.body || "",
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-192x192.png",
      })
    );
  } catch (err) {
    console.error("[sw] Failed to parse push payload:", err);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        if (clients.length > 0) {
          return clients[0].focus();
        }
        return self.clients.openWindow("/");
      })
  );
});
