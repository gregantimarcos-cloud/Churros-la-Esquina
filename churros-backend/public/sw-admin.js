// Service Worker para notificaciones push — Churros La Esquina Admin

self.addEventListener('push', function(event) {
  let data = { title: '🥐 Nuevo pedido', body: 'Hay un pedido nuevo esperando.', url: '/churros_admin.html' };
  try { data = event.data.json(); } catch(e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'nuevo-pedido',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: data.url }
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const url = event.notification.data?.url || '/churros_admin.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url.includes('churros_admin') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
