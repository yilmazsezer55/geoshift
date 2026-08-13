# Proje Durumu — konum-degistirme (agent: Raptor Mini)

> **Bu dosya, farklı yapay zeka araçları (ChatGPT, Claude, Gemini, Copilot vb.)
> arasında geçiş yapılsa bile projenin hafızası olarak kullanılmak üzere
> tasarlanmıştır. Hangi araç olursa olsun, bu dosyayı okuyan ilk mesajda
> aşağıdaki talimatları uygulamalıdır.**

> **"Raptor Mini" bir agent/asistan adıdır, proje adı değildir.** Proje adı
> `konum-degistirme`. Kullanıcı "Raptor Mini" dediğinde, bu dosyayı okuyup
> bu kurallara göre çalışan yapay zeka agent'ından bahsettiğini anla.

## 📋 KULLANIM (kullanıcı için)

Hangi yapay zeka aracını kullanıyorsanız kullanın (ücretsiz/farklı model/farklı
sağlayıcı fark etmez), her yeni konuşmanın **en başında bu dosyayı yükleyin
veya yapıştırın**, ardından isteğinizi yazın. Hiçbir araç bu dosyayı kendiliğinden
hatırlamaz — siz her seferinde vermelisiniz. Şablon aşağıda.

## 🤖 BU DOSYAYI OKUYAN HER YAPAY ZEKA İÇİN TALİMAT

- Bu bir devam eden proje. Sen bu projeyi daha önce hiç görmemiş olabilirsin —
önce "ÇALIŞAN VE DOKUNULMAMASI GEREKEN KISIMLAR" ve "KRİTİK SABİTLER"
bölümlerini oku, bunlara aksi açıkça istenmedikçe dokunma.
- Kullanıcı bir değişiklik sonrası **"tamam çalışıyor", "oldu", "şimdi oldu"**
gibi bir onay cümlesi kurduğunda: bunu **"Değişiklik Geçmişi"** tablosuna yeni
bir satır olarak ekle (tarih, ne değişti, neden) ve güncellenmiş dosyanın
tamamını kullanıcıya tekrar ver (kopyala-yapıştır veya indirilebilir dosya
olarak — aracın desteklediği şekilde).
- Eğer değişiklik yeni bir "dokunulmama" kuralı gerektiriyorsa (kritik bir
sabit, hassas bir mantık bloğu vb.), bunu da ilgili bölüme ekle.
- Dosyanın sonundaki "Ortam / Araç Notları" bölümünü kontrol et — kullanıcı
hangi yapay zekayı/aracı kullandığını orada belirtmiş olabilir, ona göre
cevap formatını uyarla (örn. Claude'da dosya indirme linki, ChatGPT'de
kod bloğu içinde tam dosya içeriği gibi).

---

## ✅ ÇALIŞAN VE DOKUNULMAMASI GEREKEN KISIMLAR

### `enable_developer_mode(udid)` — 2026-07-13 itibarıyla çalışıyor

**Dosya:** (dosya yolunu buraya yazın, örn. `ios_tools.py`)

- [x] `amfi enable-developer-mode` komutu tek başına arm + reboot + finalize yapıyor
- [x] Cihaz reboot olup geri bağlandığında Developer Mode otomatik aktif oluyor
- [x] Terminalde de, kod üzerinden de doğrulandı

**KRİTİK SABİTLER — DEĞİŞTİRME:**

```
timeout=300   # ÖNEMLİ: 120sn'den düşürülmesin. Reboot + USB reconnect
              # bazı cihazlarda 90-120sn+ sürebiliyor. Timeout'a takılırsa
              # cihaz reboot olur ama Developer Mode finalize edilmeden
              # process öldürülür → "reboot oluyor ama açılmıyor" hatası geri gelir.
```

**DOKUNMA:**

- `enable_result.returncode == 0` kontrolü ve dönen `success`/`enabled`/`revealed` alan yapısı
- `python_exe = VENV_PYTHON if VENV_PYTHON else sys.executable` satırı — VENV_PYTHON
  gerçek venv path'ini gösteriyor olmalı, terminaldeki ile aynı olmalı
- `reveal-developer-mode` fallback mantığı (enable başarısız olursa devreye giriyor)

### `persistent_set_location` / iOS canlı konum güncellemesi — 2026-07-13 itibarıyla çalışıyor

**Dosya:** `src-tauri/scripts/discovery.py`, `src-tauri/src/ios.rs`

- [x] iOS konum simülasyonu artık mevcut persistent process'i yeniden başlatmadan stdin üzerinden güncelleniyor
- [x] `set_ios_location` iOS için önceki process'i kill etmiyor; sadece stdin'e yeni koordinat yolluyor
- [x] Bu kod bloğu stabil ise değiştirilmeyin; aksi istenmedikçe süreç flow'una dokunmayın

**KRİTİK SABİTLER — DEĞİŞTİRME:**

```
stdin üzerinden canlı koordinat güncellemesi mantığını bozan değişiklikler, iOS'un
kısa süreli gerçek konuma dönmesine neden olabilir. Bu sürecin kill/restart
patikasını yeniden getirmeyin.
```

**DOKUNMA:**

- `src-tauri/scripts/discovery.py` içindeki `persistent_set_location` fonksiyonu
- `src-tauri/src/ios.rs` içindeki `set_ios_location` ve `active_ios_processes`
  yönetimi

- `enable_result.returncode == 0` kontrolü ve dönen `success`/`enabled`/`revealed` alan yapısı
- `python_exe = VENV_PYTHON if VENV_PYTHON else sys.executable` satırı — VENV_PYTHON
gerçek venv path'ini gösteriyor olmalı, terminaldeki ile aynı olmalı
- `reveal-developer-mode` fallback mantığı (enable başarısız olursa devreye giriyor)

---

## 🕓 DEĞİŞİKLİK GEÇMİŞİ

Tarih
Değişiklik
Sebep

2026-07-13
`timeout` 120 → 300
Reboot+reconnect süresi timeout'u aşıyordu, dev mode finalize edilemiyordu

2026-07-13
iOS konum simülasyonu artık mevcut persistent process'i yeniden başlatmadan stdin üzerinden güncelleniyor
Kill/restart patikası ortadan kalktı; iOS'un gerçek konuma dönmesi önlenecek

2026-07-13
iOS auto-connect mesajları artık aynı cihaz için duplicate tetiklenmiyor
Tekrar bağlanılıyor / bağlandı bildirimi sadece tek kez gösterilecek şekilde guard eklendi

2026-07-14
Blank GeoShift penceresi sorununu çözmek için eski kilitli `geoshift.exe` süreçlerini temizledim ve Vite watcher'ı `target`/`target_tmp` dizinlerini yok sayacak şekilde güncelledim
Windows üzerinde derleme hedefi kilidi ve `EBUSY` hatası engellendi

2026-08-05
iOS 17+ cihazlar için tunneld otomatik yetkilendirme/başlatma, RSD tünel tespiti ve hata yakalama düzeltildi. Tünel keşfi 150ms polling ile hızlandırıldı. "⚡ Işınlanıyor, lütfen bekleyiniz..." görsel yükleme banner'ı eklendi.

*(Her değişiklikten sonra buraya bir satır ekleyin — sadece 1 dakikanızı alır ama gelecekte çok zaman kurtarır.)*

---

## 🧪 MANUEL TEST CHECKLIST

Yeni bir değişiklik yapıldığında gerçek cihazla şunları test edin:

- [ ] `enable_developer_mode`: cihaz reboot oluyor, Developer Mode aktif oluyor
- [ ] `reveal-developer-mode`: menü Ayarlar'da görünür hale geliyor
- [ ] UDID boş/None gönderildiğinde `get_active_ios_udid()` doğru cihazı buluyor
- [ ] Cihaz bağlı değilken doğru hata mesajı dönüyor (Türkçe, kullanıcı dostu)
- [ ] Timeout durumunda anlamlı hata mesajı dönüyor (sessizce başarısız olmuyor)

---

## 📌 YENİ İSTEK VERİRKEN KULLANILACAK ŞABLON

Hangi yapay zekayı kullanıyorsanız kullanın, dosyayı verip şunu ekleyin:

```
Ekli PROJECT_STATE.md dosyasındaki "ÇALIŞAN VE 
DOKUNULMAMASI GEREKEN KISIMLAR" bölümüne dokunma.

SORUN: [sorunu tarif et]
İSTENEN: kodu düzelt (sadece dosyaya not düşme, gerçek kod değişikliği yap)


Değişiklik çalıştıysa "tamam çalışıyor" diyeceğim, o zaman PROJECT_STATE.md'yi 
güncelleyip Değişiklik Geçmişi'ne satır ekle ve tam güncel halini ver.
```

## 🖥️ ORTAM / ARAÇ NOTLARI

*(Hangi aracı/modeli kullandığınızı buraya not edin — özellikle ücretsiz
katmanda sürekli model değişiyorsa, farklı modellerin farklı davranışları
olabileceğini bilerek okuması için sonraki yapay zekaya ipucu olur.)*

Tarih
Kullanılan araç/model
Not

2026-07-13
Claude (claude.ai, ücretsiz)
Dosya formatı burada oluşturuldu

**Genel kural:** Dosya indirme/kod bloğu gösterme gibi özellikler araçtan
araca değişir. Hangi araç olursa olsun, cevabını verirken bu dosyanın
**güncel ve eksiksiz halini** kullanıcıya sun — kısmi diff yeterli değildir,
çünkü kullanıcı bir sonraki oturumda farklı bir araca geçebilir ve o araç
önceki konuşmayı görmeyecektir.

---

## 🔧 BİLİNEN KIRILGAN NOKTALAR (dikkatli olunmalı)

- Subprocess timeout değerleri cihaza/USB bağlantısına göre değişebilir, düşürülmemeli
- Cihaz reboot sonrası UDID veya pairing değişebilir — kablosuz bağlantıda özellikle
- `VENV_PYTHON` yanlış path'e işaret ederse sessizce farklı bir pymobiledevice3
sürümü kullanılabilir (hata vermez, sadece davranış değişir)
 - Uygulama ile bağlantı kurulmasına rağmen iOS (cihaz) anlık konum değiştirip mevcut konuma geri dönüyor — bu durumda `set-location` çağrısından hemen sonra konumun sıfırlandığı gözlemleniyor; olası nedenler: cihaz/OS otomatik konum hizmetleri, başka bir süreç veya uygulama konumu geri alıyor, veya `set-location` akışında reveal/finalize adımı eksik kalıyor. Öneri: `discovery_debug.log` ve cihaz loglarını kontrol ederek `set-location` komutunun çıktısını ve olası hataları kaydedin.
