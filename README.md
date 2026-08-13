# 📱 GPS Konum Değiştirme Uygulaması

iMyFone AnyTo benzeri, iOS ve Android cihazlar için GPS konum değiştirme desktop uygulaması.

## ✨ Özellikler

- 🗺️ **İnteraktif Harita** - Leaflet harita üzerinde konum seçimi
- 📱 **Android Desteği** - ADB üzerinden mock location
- 🍎 **iOS Desteği** - Developer Mode ile konum değiştirme (yakında)
- 🎨 **Modern UI** - Dark mode, glassmorphism, smooth animasyonlar
- ⚡ **Performanslı** - Tauri ile native performans

## 🚀 Kurulum

### Gereksinimler

1. **Node.js** (v18 veya üzeri)
2. **Rust** (https://rustup.rs/)
3. **ADB** (Android Debug Bridge)
   - Windows: `choco install adb` veya Android SDK Platform Tools
   - ADB'nin PATH'de olduğundan emin olun

### Proje Kurulumu

```bash
# Bağımlılıkları yükle
npm install

# Geliştirme modunda çalıştır
npm run tauri dev

# Production build
npm run tauri build
```

## 📖 Kullanım

### Android Cihaz Hazırlığı

1. **Developer Options'ı Aktifleştir:**
   - Ayarlar → Telefon Hakkında → Yapı Numarası'na 7 kez tıkla

2. **USB Debugging'i Aç:**
   - Ayarlar → Geliştirici Seçenekleri → USB Debugging ✓

3. **Mock Location Uygulaması Seç:**
   - Geliştirici Seçenekleri → Mock Location App → Bu uygulamayı seç

4. **Cihazı Bağla:**
   - USB kablosu ile bilgisayara bağla
   - "USB Debugging'e izin ver" onayını kabul et

### Uygulama Kullanımı

1. **Cihazları Tara** butonuna tıkla
2. Sol panelden cihazını seç
3. Haritadan konum seç (tıklayarak)
4. **Konumu Değiştir** butonuna tıkla
5. Cihazında Google Maps açıp konumun değiştiğini kontrol et

## 🛠️ Teknoloji Stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** Rust + Tauri
- **Harita:** Leaflet + React Leaflet
- **Styling:** Vanilla CSS (Modern Design System)
- **ADB:** adb_client crate

## ⚠️ Önemli Notlar

- Bu uygulama **sadece test ve geliştirme amaçlı** kullanılmalıdır
- Android cihazda **Developer Options** ve **USB Debugging** aktif olmalı
- iOS desteği için **Developer Mode** gereklidir (henüz implementasyonda)
- Bazı uygulamalar konum doğrulama mekanizmaları kullanabilir

## 🔜 Gelecek Özellikler

- [ ] iOS tam desteği (libimobiledevice entegrasyonu)
- [ ] Hareket simülasyon modları:
  - [ ] Teleport Mode (anında konum değiştirme)
  - [ ] Two-Point Mode (iki nokta arası hareket)
  - [ ] Multi-Point Mode (çoklu nokta rotası)
  - [ ] Joystick Mode (manuel kontrol)
- [ ] GPX dosya import/export
- [ ] Favori konumlar
- [ ] Hız ayarları (yürüme/bisiklet/araba)

## 📝 Lisans

Bu proje eğitim ve test amaçlıdır.

## 🤝 Katkıda Bulunma

Pull request'ler memnuniyetle karşılanır!

---

**Geliştirici:** Yılmaz Sezer  
**Tarih:** 2026
