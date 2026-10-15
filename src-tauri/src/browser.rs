use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use tokio_tungstenite::connect_async;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;
use tokio::net::TcpListener;
use tokio::sync::broadcast;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BrowserDevice {
    pub id: String,
    pub name: String,
    pub model: String,
    pub status: String,
    pub os: String,
    #[serde(rename = "connectionMode")]
    pub connection_mode: String,
}

#[derive(Debug, Deserialize)]
struct CdpTab {
    #[serde(rename = "type")]
    tab_type: Option<String>,
    #[serde(rename = "webSocketDebuggerUrl")]
    websocket_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CdpVersion {
    #[serde(rename = "webSocketDebuggerUrl")]
    websocket_url: Option<String>,
}

// Eklenti için yayın kanalı (Broadcast channel)
static EXTENSION_TX: OnceLock<broadcast::Sender<String>> = OnceLock::new();
static EXTENSION_SERVER_STARTED: OnceLock<bool> = OnceLock::new();
static LAST_LOCATION: OnceLock<std::sync::Mutex<Option<String>>> = OnceLock::new();
static CURRENT_DEVICE_STATUS: OnceLock<std::sync::Mutex<serde_json::Value>> = OnceLock::new();

fn get_last_location_lock() -> &'static std::sync::Mutex<Option<String>> {
    LAST_LOCATION.get_or_init(|| std::sync::Mutex::new(None))
}

fn get_device_status_lock() -> &'static std::sync::Mutex<serde_json::Value> {
    CURRENT_DEVICE_STATUS.get_or_init(|| {
        std::sync::Mutex::new(serde_json::json!({
            "type": "DEVICE_STATUS",
            "active": false,
            "deviceType": "none",
            "deviceName": ""
        }))
    })
}

/// Tarayıcı eklentilerine seçili aktif cihazın durumunu bildirir.
/// Yalnızca ve yalnızca tarayıcı seçiliyse: active = true
/// Telefon (Android / iOS) seçiliyse veya seçim yoksa: active = false
pub fn notify_extension_device_status(is_browser: bool, device_type: &str, device_name: &str) {
    ensure_extension_server();
    let status_payload = serde_json::json!({
        "type": "DEVICE_STATUS",
        "active": is_browser,
        "deviceType": device_type,
        "deviceName": device_name
    });

    {
        let mut lock = get_device_status_lock().lock().unwrap();
        *lock = status_payload.clone();
    }

    if !is_browser {
        // Tarayıcı aktif değilse (örneğin telefon seçildiyse) son konumu sıfırla
        let mut loc_lock = get_last_location_lock().lock().unwrap();
        *loc_lock = None;
    }

    if let Some(tx) = EXTENSION_TX.get() {
        let _ = tx.send(status_payload.to_string());
    }
}

/// Eklentiler için yerel WebSocket sunucusunu başlatır (ws://127.0.0.1:9223)
pub fn ensure_extension_server() {
    EXTENSION_SERVER_STARTED.get_or_init(|| {
        let (tx, _rx) = broadcast::channel::<String>(200);
        let _ = EXTENSION_TX.set(tx.clone());

        tauri::async_runtime::spawn(async move {
            if let Ok(listener) = TcpListener::bind("127.0.0.1:9223").await {
                while let Ok((stream, _)) = listener.accept().await {
                    let tx_clone = tx.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Ok(ws_stream) = tokio_tungstenite::accept_async(stream).await {
                            let (mut ws_sink, mut ws_reader) = ws_stream.split();

                            // 1. Yeni bağlanan eklentiye hemen güncel cihaz durumunu ilet
                            let current_status = {
                                let lock = get_device_status_lock().lock().unwrap();
                                lock.to_string()
                            };
                            let _ = ws_sink.send(Message::Text(current_status)).await;

                            // 2. Yalnızca tarayıcı aktifse son bilinen konumu ilet (varsa)
                            let is_browser_active = {
                                let lock = get_device_status_lock().lock().unwrap();
                                lock.get("active").and_then(|v| v.as_bool()).unwrap_or(false)
                            };

                            if is_browser_active {
                                let last = {
                                    let lock = get_last_location_lock().lock().unwrap();
                                    lock.clone()
                                };
                                if let Some(msg) = last {
                                    let _ = ws_sink.send(Message::Text(msg)).await;
                                }
                            }

                            let (outgoing_tx, mut outgoing_rx) = tokio::sync::mpsc::channel::<String>(100);

                            // Reader task: Eklentiden gelen GET_STATUS veya ping isteklerini dinle
                            let outgoing_tx_for_reader = outgoing_tx.clone();
                            let read_task = tauri::async_runtime::spawn(async move {
                                while let Some(Ok(msg)) = ws_reader.next().await {
                                    if let Message::Text(text) = msg {
                                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                                            if parsed.get("type").and_then(|v| v.as_str()) == Some("GET_STATUS") {
                                                let status_str = {
                                                    let lock = get_device_status_lock().lock().unwrap();
                                                    lock.to_string()
                                                };
                                                let _ = outgoing_tx_for_reader.send(status_str).await;

                                                let is_active = {
                                                    let lock = get_device_status_lock().lock().unwrap();
                                                    lock.get("active").and_then(|v| v.as_bool()).unwrap_or(false)
                                                };
                                                if is_active {
                                                    let last = {
                                                        let lock = get_last_location_lock().lock().unwrap();
                                                        lock.clone()
                                                    };
                                                    if let Some(loc_str) = last {
                                                        let _ = outgoing_tx_for_reader.send(loc_str).await;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            });

                            // Broadcast receiver task
                            let outgoing_tx_for_broadcast = outgoing_tx.clone();
                            let mut rx = tx_clone.subscribe();
                            let broadcast_task = tauri::async_runtime::spawn(async move {
                                loop {
                                    match rx.recv().await {
                                        Ok(msg) => {
                                            if outgoing_tx_for_broadcast.send(msg).await.is_err() {
                                                break;
                                            }
                                        }
                                        Err(broadcast::error::RecvError::Lagged(_)) => {
                                            // Hızlı konumlarda tampon aşılsa bile bağlantıyı koparma!
                                            continue;
                                        }
                                        Err(broadcast::error::RecvError::Closed) => {
                                            break;
                                        }
                                    }
                                }
                            });

                            // Writer loop: Çıkış kuyruğundaki mesajları istemciye yaz
                            while let Some(msg) = outgoing_rx.recv().await {
                                if ws_sink.send(Message::Text(msg)).await.is_err() {
                                    break;
                                }
                            }

                            read_task.abort();
                            broadcast_task.abort();
                        }
                    });
                }
            }
        });
        true
    });
}

/// Bağlı tarayıcı eklentilerine anlık koordinat yayını yapar (YALNIZCA tarayıcı aktifse!)
pub fn broadcast_to_extension(lat: f64, lng: f64, accuracy: f64) {
    let is_browser_active = {
        let lock = get_device_status_lock().lock().unwrap();
        lock.get("active").and_then(|v| v.as_bool()).unwrap_or(false)
    };

    // Telefon seçiliyse veya tarayıcı aktif değilse eklentiye KESİNLİKLE yayın yapma
    if !is_browser_active {
        return;
    }

    ensure_extension_server();
    let payload = serde_json::json!({
        "type": "LOCATION_UPDATE",
        "lat": lat,
        "lng": lng,
        "accuracy": accuracy,
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    }).to_string();

    {
        let mut lock = get_last_location_lock().lock().unwrap();
        *lock = Some(payload.clone());
    }

    if let Some(tx) = EXTENSION_TX.get() {
        let _ = tx.send(payload);
    }
}

/// Eklenti dosyalarını her Windows bilgisayarda standart olan %LOCALAPPDATA%\GeoShift\browser-extension altına çıkartır
pub fn ensure_extension_files() -> PathBuf {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| "C:\\ProgramData".to_string());
    let ext_dir = Path::new(&local_app_data).join("GeoShift\\browser-extension");
    let icons_dir = ext_dir.join("icons");
    let _ = std::fs::create_dir_all(&icons_dir);

    let manifest = include_str!("../../browser-extension/manifest.json");
    let background = include_str!("../../browser-extension/background.js");
    let bridge = include_str!("../../browser-extension/bridge.js");
    let content = include_str!("../../browser-extension/content.js");
    let popup_html = include_str!("../../browser-extension/popup.html");
    let popup_js = include_str!("../../browser-extension/popup.js");
    let readme = include_str!("../../browser-extension/README.md");

    let icon16 = include_bytes!("../../browser-extension/icons/icon16.png");
    let icon32 = include_bytes!("../../browser-extension/icons/icon32.png");
    let icon48 = include_bytes!("../../browser-extension/icons/icon48.png");
    let icon128 = include_bytes!("../../browser-extension/icons/icon128.png");

    let _ = std::fs::write(ext_dir.join("manifest.json"), manifest);
    let _ = std::fs::write(ext_dir.join("background.js"), background);
    let _ = std::fs::write(ext_dir.join("bridge.js"), bridge);
    let _ = std::fs::write(ext_dir.join("content.js"), content);
    let _ = std::fs::write(ext_dir.join("popup.html"), popup_html);
    let _ = std::fs::write(ext_dir.join("popup.js"), popup_js);
    let _ = std::fs::write(ext_dir.join("README.md"), readme);

    let _ = std::fs::write(icons_dir.join("icon16.png"), icon16);
    let _ = std::fs::write(icons_dir.join("icon32.png"), icon32);
    let _ = std::fs::write(icons_dir.join("icon48.png"), icon48);
    let _ = std::fs::write(icons_dir.join("icon128.png"), icon128);

    ext_dir
}

/// Sistemde o anda GERÇEK GÖRÜNÜR PENCERESİ olan process adlarını döndürür (küçük harfli).
/// Böylece Windows'un arka planda askıda tuttuğu (Startup Boost) Edge gibi işlemler elenir.
#[cfg(target_os = "windows")]
fn get_running_process_names() -> HashSet<String> {
    use std::collections::HashMap;
    use std::mem;
    use winapi::shared::minwindef::{BOOL, LPARAM, TRUE};
    use winapi::shared::windef::HWND;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::tlhelp32::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use winapi::um::winuser::{
        EnumWindows, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible,
    };

    // 1. PID -> exe_name haritası oluştur
    let mut pid_map: HashMap<u32, String> = HashMap::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot != winapi::um::handleapi::INVALID_HANDLE_VALUE {
            let mut entry: PROCESSENTRY32W = mem::zeroed();
            entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;

            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    let null_pos = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                    let exe_name = String::from_utf16_lossy(&entry.szExeFile[..null_pos]).to_lowercase();
                    pid_map.insert(entry.th32ProcessID, exe_name);

                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }
            CloseHandle(snapshot);
        }
    }

    // 2. Yalnızca görünür penceresi olan PID'lerin process adlarını topla
    struct WindowEnumData<'a> {
        pid_map: &'a HashMap<u32, String>,
        visible_names: HashSet<String>,
    }

    unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let data = &mut *(lparam as *mut WindowEnumData);
        if IsWindowVisible(hwnd) != 0 && GetWindowTextLengthW(hwnd) > 0 {
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if let Some(name) = data.pid_map.get(&pid) {
                data.visible_names.insert(name.clone());
            }
        }
        TRUE
    }

    let mut data = WindowEnumData {
        pid_map: &pid_map,
        visible_names: HashSet::new(),
    };

    unsafe {
        EnumWindows(Some(enum_windows_callback), &mut data as *mut _ as LPARAM);
    }

    data.visible_names
}

#[cfg(not(target_os = "windows"))]
fn get_running_process_names() -> HashSet<String> {
    HashSet::new()
}

pub fn get_browser_exe(browser_id: &str) -> Option<PathBuf> {
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let program_files = std::env::var("ProgramFiles").unwrap_or_default();
    let program_files_x86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();

    let paths = match browser_id {
        "browser-chrome" => vec![
            Path::new(&program_files).join("Google\\Chrome\\Application\\chrome.exe"),
            Path::new(&program_files_x86).join("Google\\Chrome\\Application\\chrome.exe"),
            Path::new(&local_app_data).join("Google\\Chrome\\Application\\chrome.exe"),
        ],
        "browser-edge" => vec![
            Path::new(&program_files_x86).join("Microsoft\\Edge\\Application\\msedge.exe"),
            Path::new(&program_files).join("Microsoft\\Edge\\Application\\msedge.exe"),
        ],
        "browser-brave" => vec![
            Path::new(&program_files).join("BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
            Path::new(&local_app_data).join("BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
        ],
        "browser-opera" => vec![
            Path::new(&local_app_data).join("Programs\\Opera\\opera.exe"),
            Path::new(&program_files).join("Opera\\launcher.exe"),
            Path::new(&local_app_data).join("Programs\\Opera GX\\opera.exe"),
            Path::new(&program_files).join("Opera GX\\launcher.exe"),
        ],
        "browser-firefox" => vec![
            Path::new(&program_files).join("Mozilla Firefox\\firefox.exe"),
            Path::new(&program_files_x86).join("Mozilla Firefox\\firefox.exe"),
        ],
        _ => vec![],
    };

    paths.into_iter().find(|p| p.exists())
}

/// SADECE O ANDA AÇIK/ÇALIŞAN tarayıcıları listeler!
pub async fn list_browsers() -> Vec<BrowserDevice> {
    let running = get_running_process_names();
    let mut browsers = Vec::new();

    let candidates = [
        ("browser-chrome", "Google Chrome", "Chromium", "chrome.exe"),
        ("browser-edge", "Microsoft Edge", "Chromium", "msedge.exe"),
        ("browser-brave", "Brave Browser", "Chromium", "brave.exe"),
        ("browser-opera", "Opera", "Chromium", "opera.exe"),
        ("browser-firefox", "Mozilla Firefox", "Gecko", "firefox.exe"),
    ];

    let is_connected = is_cdp_available().await;

    for (id, name, model, proc_name) in candidates {
        if running.contains(proc_name) && get_browser_exe(id).is_some() {
            browsers.push(BrowserDevice {
                id: id.to_string(),
                name: name.to_string(),
                model: model.to_string(),
                status: if is_connected { "Bağlandı (Aktif)".to_string() } else { "Açık (Bağlanılabilir)".to_string() },
                os: "browser".to_string(),
                connection_mode: "local".to_string(),
            });
        }
    }

    browsers
}

pub async fn is_cdp_available() -> bool {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1000))
        .build()
        .unwrap_or_default();

    client.get("http://127.0.0.1:9222/json/version")
        .send()
        .await
        .is_ok()
}

/// Tarayıcının sağlıklı/bağlı olup olmadığını kontrol eder:
/// CDP portu açıksa VEYA tarayıcının görünür penceresi sistemde açıksa sağlıklı kabul edilir.
pub async fn is_browser_healthy(browser_id: &str) -> bool {
    if is_cdp_available().await {
        return true;
    }
    let browsers = list_browsers().await;
    browsers.iter().any(|b| b.id == browser_id)
}

pub async fn launch_browser(browser_id: &str) -> Result<String, String> {
    if is_cdp_available().await {
        return Ok("Tarayıcı bağlantısı aktif.".to_string());
    }

    let exe = get_browser_exe(browser_id).ok_or_else(|| "Seçilen tarayıcı bulunamadı.".to_string())?;
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let mut cmd = Command::new(&exe);

    if browser_id == "browser-firefox" {
        // Firefox için izole profil: var olan açık pencerelerle çakışmaz ve 9222 portunu sorunsuz açar
        let firefox_profile = Path::new(&local_app_data).join("GeoShift\\firefox_profile");
        let _ = std::fs::create_dir_all(&firefox_profile);

        cmd.args(&[
            "--remote-debugging-port=9222",
            "--profile",
            &firefox_profile.to_string_lossy(),
            "--no-remote",
            "--remote-allow-hosts=127.0.0.1,localhost",
            "--remote-allow-origins=http://127.0.0.1:9222,http://localhost:9222",
            "https://maps.google.com",
        ]);
    } else {
        // Chromium tabanlı tarayıcılar (Chrome, Edge, Brave, Opera)
        let profile_dir = Path::new(&local_app_data).join("GeoShift\\browser_profile");
        let _ = std::fs::create_dir_all(&profile_dir);

        cmd.args(&[
            "--remote-debugging-port=9222",
            &format!("--user-data-dir={}", profile_dir.to_string_lossy()),
            "--no-first-run",
            "--no-default-browser-check",
            "https://maps.google.com",
        ]);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x00000200); // CREATE_NEW_PROCESS_GROUP
    }

    cmd.spawn().map_err(|e| format!("Tarayıcı başlatılamadı: {}", e))?;

    // Portun hazır olmasını bekle (maksimum 7 saniye - Opera ve Firefox için yeterli süre)
    for _ in 0..35 {
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        if is_cdp_available().await {
            return Ok("Tarayıcı GeoShift modunda başarıyla bağlandı.".to_string());
        }
    }

    if is_cdp_available().await {
        Ok("Tarayıcı bağlandı.".to_string())
    } else {
        Err("Tarayıcı başlatıldı fakat 9222 hata ayıklama portu açılamadı. Dilerseniz yeni pencere yerine sorunsuz çalışan 'GeoShift Tarayıcı Eklentisi'ni kullanabilirsiniz.".to_string())
    }
}

pub async fn set_browser_location(lat: f64, lng: f64, accuracy: f64) -> Result<String, String> {
    // 1. Eklentiye (Extension) hemen yayın yap - böylece eklenti kullanan tüm açık sekmeler anında güncellenir!
    broadcast_to_extension(lat, lng, accuracy);

    // 2. CDP üzerinden açık 9222 portundaki sekmeleri güncelle
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(1000))
        .build()
        .unwrap_or_default();

    let tabs_res = client.get("http://127.0.0.1:9222/json").send().await;
    let tabs: Vec<CdpTab> = match tabs_res {
        Ok(res) => res.json().await.unwrap_or_default(),
        Err(_) => {
            // CDP portu kapalıysa bile eklentiye yayın yapılmış oldu
            return Ok("Konum eklentiye iletildi.".to_string());
        }
    };

    let override_payload = serde_json::json!({
        "id": 1,
        "method": "Emulation.setGeolocationOverride",
        "params": {
            "latitude": lat,
            "longitude": lng,
            "accuracy": accuracy
        }
    }).to_string();

    let grant_payload = serde_json::json!({
        "id": 2,
        "method": "Browser.grantPermissions",
        "params": {
            "permissions": ["geolocation"]
        }
    }).to_string();

    // CANLI KONUM TETİKLEYİCİ JS: Butona basma zorunluluğunu kaldırır!
    let js_override_code = format!(
        r#"
        (function() {{
            window.__geoshift_pos = {{ lat: {lat}, lng: {lng}, acc: {accuracy} }};
            window.__geoshift_watchers = window.__geoshift_watchers || new Map();
            window.__geoshift_next_id = window.__geoshift_next_id || 1;

            const makePos = () => ({{
                coords: {{
                    latitude: window.__geoshift_pos.lat,
                    longitude: window.__geoshift_pos.lng,
                    accuracy: window.__geoshift_pos.acc,
                    altitude: null,
                    altitudeAccuracy: null,
                    heading: null,
                    speed: null
                }},
                timestamp: Date.now()
            }});

            if (!window.__geoshift_hooked) {{
                window.__geoshift_hooked = true;
                navigator.geolocation.getCurrentPosition = function(success, error, options) {{
                    setTimeout(() => success(makePos()), 5);
                }};
                navigator.geolocation.watchPosition = function(success, error, options) {{
                    const id = window.__geoshift_next_id++;
                    window.__geoshift_watchers.set(id, success);
                    setTimeout(() => success(makePos()), 5);
                    return id;
                }};
                navigator.geolocation.clearWatch = function(id) {{
                    window.__geoshift_watchers.delete(id);
                }};
            }}

            // Kayıtlı watchPosition dinleyicilerine derhal yeni konumu ilet!
            if (window.__geoshift_watchers && window.__geoshift_watchers.size > 0) {{
                const p = makePos();
                window.__geoshift_watchers.forEach(cb => {{
                    try {{ cb(p); }} catch(e) {{}}
                }});
            }}

            // Sayfaya özel event fırlat
            try {{
                window.dispatchEvent(new CustomEvent('geoshift-location', {{ detail: {{ lat: {lat}, lng: {lng} }} }}));
            }} catch(e) {{}}

            // Google Haritalar'daki "Mevcut Konum" butonunu otomatik tıkla
            try {{
                const locBtn = document.querySelector('button[aria-label*="konum" i], button[aria-label*="location" i], div.widget-mylocation-button button, button[data-tooltip*="konum" i]');
                if (locBtn) {{ locBtn.click(); }}
            }} catch(e) {{}}
        }})();
        "#,
        lat = lat,
        lng = lng,
        accuracy = accuracy
    );

    let js_payload = serde_json::json!({
        "id": 3,
        "method": "Runtime.evaluate",
        "params": {
            "expression": js_override_code,
            "awaitPromise": false,
            "returnByValue": false
        }
    }).to_string();

    let mut updated_count = 0;

    for tab in tabs {
        if tab.tab_type.as_deref() == Some("page") {
            if let Some(ws_url) = tab.websocket_url {
                if let Ok((mut ws_stream, _)) = connect_async(&ws_url).await {
                    let _ = ws_stream.send(Message::Text(grant_payload.clone())).await;
                    let _ = ws_stream.send(Message::Text(override_payload.clone())).await;
                    let _ = ws_stream.send(Message::Text(js_payload.clone())).await;
                    tokio::time::sleep(std::time::Duration::from_millis(15)).await;
                    let _ = ws_stream.close(None).await;
                    updated_count += 1;
                }
            }
        }
    }

    if let Ok(ver_res) = client.get("http://127.0.0.1:9222/json/version").send().await {
        if let Ok(version_info) = ver_res.json::<CdpVersion>().await {
            if let Some(browser_ws) = version_info.websocket_url {
                if let Ok((mut ws_stream, _)) = connect_async(&browser_ws).await {
                    let _ = ws_stream.send(Message::Text(grant_payload)).await;
                    let _ = ws_stream.send(Message::Text(override_payload)).await;
                    tokio::time::sleep(std::time::Duration::from_millis(15)).await;
                    let _ = ws_stream.close(None).await;
                }
            }
        }
    }

    if updated_count > 0 {
        Ok(format!("{} sekmenin konumu güncellendi.", updated_count))
    } else {
        Ok("Tarayıcı konumu güncellendi.".to_string())
    }
}

pub async fn clear_browser_location() -> Result<String, String> {
    // 1. Eklentinin hafızasındaki konumu temizle ve sekmelere iptal bildirimi gönder
    {
        let mut lock = get_last_location_lock().lock().unwrap();
        *lock = None;
    }
    if let Some(tx) = EXTENSION_TX.get() {
        let _ = tx.send(serde_json::json!({
            "type": "DEVICE_STATUS",
            "active": false,
            "deviceType": "none",
            "deviceName": ""
        }).to_string());
    }

    // 2. CDP üzerindeki override'ı temizle
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .unwrap_or_default();

    let tabs: Vec<CdpTab> = client.get("http://127.0.0.1:9222/json")
        .send().await
        .map_err(|e| e.to_string())?
        .json().await
        .unwrap_or_default();

    let payload = serde_json::json!({
        "id": 4,
        "method": "Emulation.clearGeolocationOverride"
    }).to_string();

    for tab in tabs {
        if tab.tab_type.as_deref() == Some("page") {
            if let Some(ws_url) = tab.websocket_url {
                if let Ok((mut ws_stream, _)) = connect_async(&ws_url).await {
                    let _ = ws_stream.send(Message::Text(payload.clone())).await;
                    tokio::time::sleep(std::time::Duration::from_millis(15)).await;
                    let _ = ws_stream.close(None).await;
                }
            }
        }
    }

    Ok("Tarayıcı konumu sıfırlandı.".to_string())
}
