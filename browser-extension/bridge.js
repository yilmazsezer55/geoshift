// GeoShift Bridge (Isolated World <-> Main World & Background)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type) {
      window.postMessage({ from: 'geoshift-extension', ...message }, '*');
    }
  });
}
