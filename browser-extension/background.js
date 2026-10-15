// GeoShift Browser Extension Background Service Worker
let socket = null;
let reconnectTimer = null;

function connectToGeoShift() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    socket = new WebSocket('ws://127.0.0.1:9223');

    socket.onopen = () => {
      console.log('[GeoShift Extension] Masaüstü uygulamasına bağlandı.');
      chrome.storage.local.set({ connected: true });
      try {
        socket.send(JSON.stringify({ type: 'GET_STATUS' }));
      } catch (_) {}
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // 1. Cihaz durum güncellemesi (Tarayıcı mı seçili, telefon mu?)
        if (data.type === 'DEVICE_STATUS') {
          const isBrowser = !!data.active;
          chrome.storage.local.set({
            browserActive: isBrowser,
            deviceType: data.deviceType || 'none',
            deviceName: data.deviceName || ''
          });

          // Eğer tarayıcı aktif değilse (örneğin telefon seçildiyse), sekmelerdeki sahte konumu devre dışı bırak
          if (!isBrowser) {
            chrome.storage.local.remove(['currentLocation']);
            chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (tabs) => {
              if (!tabs || chrome.runtime.lastError) return;
              for (const tab of tabs) {
                if (tab.id) {
                  chrome.tabs.sendMessage(tab.id, {
                    type: 'GEOSHIFT_DEACTIVATE'
                  }, () => {
                    if (chrome.runtime.lastError) { /* ignore */ }
                  });
                }
              }
            });
          }
        }

        // 2. Konum güncellemesi (Yalnızca masaüstünden geldiğinde)
        if (data.type === 'LOCATION_UPDATE') {
          chrome.storage.local.set({
            currentLocation: {
              lat: data.lat,
              lng: data.lng,
              accuracy: data.accuracy || 10,
              timestamp: data.timestamp || Date.now()
            },
            browserActive: true
          });

          // Yalnızca gerçek web sayfalarına yayın yap (chrome:// ve sistem sayfalarında hata çıkmasını önler)
          chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }, (tabs) => {
            if (!tabs || chrome.runtime.lastError) return;
            for (const tab of tabs) {
              if (tab.id) {
                chrome.tabs.sendMessage(tab.id, {
                  type: 'GEOSHIFT_UPDATE_COORDS',
                  payload: data
                }, () => {
                  if (chrome.runtime.lastError) { /* ignore */ }
                });
              }
            }
          });
        }
      } catch (err) {
        console.error('[GeoShift Extension] Mesaj ayrıştırma hatası:', err);
      }
    };

    socket.onclose = () => {
      chrome.storage.local.set({ connected: false, browserActive: false });
      scheduleReconnect();
    };

    socket.onerror = () => {
      chrome.storage.local.set({ connected: false, browserActive: false });
      try { socket.close(); } catch (_) {}
    };
  } catch (e) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectToGeoShift();
  }, 2500);
}

// Servis işçisi ayağa kalktığında hemen bağlan
connectToGeoShift();

// Popup ve içerik komutlarını dinle
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'REFRESH_STATUS') {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'GET_STATUS' }));
      } catch (_) {}
    } else {
      connectToGeoShift();
    }
    sendResponse({ ok: true });
  }
});

// Periyodik kalp atışı (Service worker'ın uyumasını önlemek için)
setInterval(() => {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    connectToGeoShift();
  }
}, 5000);
