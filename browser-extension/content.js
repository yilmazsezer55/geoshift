// GeoShift Content Script (Running in MAIN World - modifies window.navigator.geolocation)
(function () {
  let fakePos = null;
  let isEnabled = false;
  const watchers = new Map();
  let nextWatcherId = 1;

  // Gerçek orijinal geolocation fonksiyonlarını yedekle
  const origGetCurrentPosition = navigator.geolocation ? navigator.geolocation.getCurrentPosition.bind(navigator.geolocation) : null;
  const origWatchPosition = navigator.geolocation ? navigator.geolocation.watchPosition.bind(navigator.geolocation) : null;
  const origClearWatch = navigator.geolocation ? navigator.geolocation.clearWatch.bind(navigator.geolocation) : null;

  function createPositionObject() {
    if (!fakePos) return null;
    return {
      coords: {
        latitude: fakePos.lat,
        longitude: fakePos.lng,
        accuracy: fakePos.acc || 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    };
  }

  function triggerWatchers() {
    if (!isEnabled || !fakePos) return;
    const pos = createPositionObject();
    if (!pos) return;

    watchers.forEach((callback) => {
      try {
        callback(pos);
      } catch (e) {}
    });

    // Sayfa içi haritalar için özel event fırlat
    try {
      window.dispatchEvent(
        new CustomEvent('geoshift-location', {
          detail: { latitude: fakePos.lat, longitude: fakePos.lng },
        })
      );
    } catch (e) {}

    // Google Haritalar'da "Mevcut Konum" butonu varsa otomatik odakla
    try {
      const locBtn = document.querySelector(
        'button[aria-label*="konum" i], button[aria-label*="location" i], div.widget-mylocation-button button, button[data-tooltip*="konum" i]'
      );
      if (locBtn) {
        locBtn.click();
      }
    } catch (e) {}
  }

  // HTML5 Geolocation API Hook
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition = function (success, error, options) {
      if (isEnabled && fakePos) {
        setTimeout(() => {
          if (typeof success === 'function') success(createPositionObject());
        }, 5);
      } else if (origGetCurrentPosition) {
        origGetCurrentPosition(success, error, options);
      }
    };

    navigator.geolocation.watchPosition = function (success, error, options) {
      const id = nextWatcherId++;
      watchers.set(id, success);
      if (isEnabled && fakePos) {
        setTimeout(() => {
          if (typeof success === 'function') success(createPositionObject());
        }, 5);
      } else if (origWatchPosition) {
        return origWatchPosition(success, error, options);
      }
      return id;
    };

    navigator.geolocation.clearWatch = function (id) {
      watchers.delete(id);
      if (origClearWatch) origClearWatch(id);
    };
  }

  // Bridge scriptinden gelen mesajları dinleme (Sayfa içi postMessage)
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.from === 'geoshift-extension') {
      if (event.data.type === 'GEOSHIFT_UPDATE_COORDS' && event.data.payload) {
        fakePos = {
          lat: event.data.payload.lat,
          lng: event.data.payload.lng,
          acc: event.data.payload.accuracy || 10,
        };
        isEnabled = true;
        triggerWatchers();
      } else if (event.data.type === 'GEOSHIFT_DEACTIVATE') {
        isEnabled = false;
        fakePos = null;
      }
    }
  });
})();
