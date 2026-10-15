# GeoShift Tarayıcı Eklentisi Kurulum Rehberi

Bu eklenti, GeoShift masaüstü uygulamasındaki harita konumunu **mevcut tüm açık tarayıcı sekmelerinizle anlık senkronize eder**. 
Yeni bir pencere açmanıza veya hata ayıklama portuyla uğraşmanıza gerek kalmaz.

---

### Kurulum (Sadece 20 Saniye)

#### 1. Google Chrome / Microsoft Edge / Brave / Opera İçin:
1. Tarayıcınızın adres çubuğuna şunu yazın ve Enter'a basın:
   - **Chrome:** `chrome://extensions`
   - **Edge:** `edge://extensions`
   - **Opera:** `opera://extensions`
   - **Brave:** `brave://extensions`
2. Sağ üst köşedeki **"Geliştirici Modu" (Developer Mode)** anahtarını açın.
3. Sol üstteki **"Paketlenmemiş Öğe Yükle" (Load unpacked)** butonuna tıklayın.
4. Bu klasörü (`browser-extension`) seçin.

#### 2. Mozilla Firefox İçin:
1. Adres çubuğuna `about:debugging#/runtime/this-firefox` yazın.
2. **"Geçici Eklenti Yükle" (Load Temporary Add-on)** butonuna tıklayın.
3. Bu klasördeki `manifest.json` dosyasını seçin.

---

### Kullanım:
- GeoShift uygulamasını açın ve haritada istediğiniz konumu seçin.
- Tarayıcınızda Google Haritalar, Yandex veya herhangi bir konuma duyarlı siteye girin; konumunuz anında haritada seçtiğiniz yere taşınacaktır!
