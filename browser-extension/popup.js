function updateUI() {
  chrome.storage.local.get(['connected', 'browserActive', 'deviceType', 'deviceName', 'currentLocation'], (data) => {
    const badge = document.getElementById('statusBadge');
    const dot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const coordsText = document.getElementById('coordsText');
    const noteText = document.getElementById('noteText');

    if (!data.connected) {
      badge.className = 'badge badge-offline';
      dot.className = 'dot dot-offline';
      statusText.textContent = 'Masaüstü Bağlantısı Yok';
      coordsText.textContent = 'GeoShift uygulamasını açın';
      if (noteText) noteText.textContent = 'Masaüstü uygulaması açık olduğunda otomatik bağlanır.';
      return;
    }

    if (!data.browserActive) {
      // Masaüstü bağlı fakat telefon seçili veya henüz hiçbir cihaz seçilmedi
      badge.className = 'badge badge-passive';
      dot.className = 'dot dot-passive';
      if (data.deviceType === 'android' || data.deviceType === 'ios') {
        const devLabel = data.deviceType === 'ios' ? 'iPhone' : 'Android';
        statusText.textContent = `Pasif (${devLabel} Seçili)`;
        coordsText.textContent = 'Tarayıcı konumu etkilenmez';
        if (noteText) noteText.textContent = `GeoShift uygulamasında telefon seçili. Konum sadece telefona aktarılır, tarayıcı normal çalışır.`;
      } else {
        statusText.textContent = 'Hazır (Cihaz Seçilmedi)';
        coordsText.textContent = 'Uygulamadan bir cihaz seçin';
        if (noteText) noteText.textContent = 'GeoShift uygulamasından tarayıcınızı seçtiğinizde anlık senkronizasyon başlar.';
      }
      return;
    }

    // Tarayıcı aktif
    badge.className = 'badge badge-online';
    dot.className = 'dot dot-online';
    statusText.textContent = 'GeoShift Aktif (Tarayıcı)';

    if (data.currentLocation) {
      coordsText.textContent = `${data.currentLocation.lat.toFixed(5)}, ${data.currentLocation.lng.toFixed(5)}`;
    } else {
      coordsText.textContent = 'Haritada bir konum seçin';
    }
    if (noteText) noteText.textContent = 'GeoShift haritasındaki her hareket açık sekmelerinize anlık yansır.';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // İlk açılışta mevcut depolananı göster
  updateUI();
  // Arka plandaki WebSocket'ten taze veri talep et
  try {
    chrome.runtime.sendMessage({ type: 'REFRESH_STATUS' }, () => {
      if (chrome.runtime.lastError) { /* ignore */ }
    });
  } catch (_) {}
  // Değişiklikleri dinle
  chrome.storage.onChanged.addListener(updateUI);
});
