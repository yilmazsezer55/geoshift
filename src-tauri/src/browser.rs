use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use tokio_tungstenite::connect_async;
use futures_util::SinkExt;
use tokio_tungstenite::tungstenite::Message;

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

/// Sistemde o anda çalışan process adlarını döndürür (küçük harfli).
#[cfg(target_os = "windows")]
fn get_running_process_names() -> HashSet<String> {
    use std::mem;
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::tlhelp32::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };

    let mut names = HashSet::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == winapi::um::handleapi::INVALID_HANDLE_VALUE {
            return names;
        }

        let mut entry: PROCESSENTRY32W = mem::zeroed();
        entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;

        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                let null_pos = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let exe_name = String::from_utf16_lossy(&entry.szExeFile[..null_pos]).to_lowercase();
                names.insert(exe_name);

                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snapshot);
    }
    names
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

    // (browser_id, görünen ad, motor/model, process_name)
    let candidates = [
        ("browser-chrome", "Google Chrome", "Chromium", "chrome.exe"),
        ("browser-edge", "Microsoft Edge", "Chromium", "msedge.exe"),
        ("browser-brave", "Brave Browser", "Chromium", "brave.exe"),
        ("browser-opera", "Opera", "Chromium", "opera.exe"),
        ("browser-firefox", "Mozilla Firefox", "Gecko", "firefox.exe"),
    ];

    let is_connected = is_cdp_available().await;

    for (id, name, model, proc_name) in candidates {
        // YALNIZCA sistemde o anda process'i çalışan ve exe'si bulunan tarayıcıları listele!
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
        .timeout(std::time::Duration::from_millis(400))
        .build()
        .unwrap_or_default();

    client.get("http://127.0.0.1:9222/json/version")
        .send()
        .await
        .is_ok()
}

pub async fn launch_browser(browser_id: &str) -> Result<String, String> {
    if is_cdp_available().await {
        return Ok("Tarayıcı bağlantısı aktif.".to_string());
    }

    let exe = get_browser_exe(browser_id).ok_or_else(|| "Seçilen tarayıcı bulunamadı.".to_string())?;
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let profile_dir = Path::new(&local_app_data).join("GeoShift\\browser_profile");
    let _ = std::fs::create_dir_all(&profile_dir);

    let mut cmd = Command::new(&exe);

    if browser_id == "browser-firefox" {
        cmd.args(&[
            "--remote-debugging-port=9222",
            "--remote-allow-hosts=127.0.0.1,localhost",
            "--remote-allow-origins=http://127.0.0.1:9222,http://localhost:9222",
            "--no-remote",
            "https://maps.google.com",
        ]);
    } else {
        // Chromium tabanlı tarayıcılar (Chrome, Edge, Brave, Opera)
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
        // CREATE_NEW_PROCESS_GROUP
        cmd.creation_flags(0x00000200);
    }

    cmd.spawn().map_err(|e| format!("Tarayıcı başlatılamadı: {}", e))?;

    // Portun hazır olmasını bekle (maksimum 4 saniye)
    for _ in 0..20 {
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        if is_cdp_available().await {
            return Ok("Tarayıcı GeoShift modunda başarıyla bağlandı.".to_string());
        }
    }

    if is_cdp_available().await {
        Ok("Tarayıcı bağlandı.".to_string())
    } else {
        Err("Tarayıcı başlatıldı fakat 9222 hata ayıklama portu açılamadı. Lütfen mevcut açık pencerelerinizi kapatıp tekrar deneyin.".to_string())
    }
}

pub async fn set_browser_location(lat: f64, lng: f64, accuracy: f64) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(800))
        .build()
        .unwrap_or_default();

    // 1. Açık sekmeleri listele
    let tabs_res = client.get("http://127.0.0.1:9222/json").send().await;
    let tabs: Vec<CdpTab> = match tabs_res {
        Ok(res) => res.json().await.unwrap_or_default(),
        Err(e) => return Err(format!("Tarayıcı CDP bağlantısı yok (port 9222): {}", e)),
    };

    // Geolocation Override komutu
    let override_payload = serde_json::json!({
        "id": 1,
        "method": "Emulation.setGeolocationOverride",
        "params": {
            "latitude": lat,
            "longitude": lng,
            "accuracy": accuracy
        }
    }).to_string();

    // Geolocation izin verme komutu (sitelerin konum popup'ında takılmaması için)
    let grant_payload = serde_json::json!({
        "id": 2,
        "method": "Browser.grantPermissions",
        "params": {
            "permissions": ["geolocation"]
        }
    }).to_string();

    // Sayfa içi JS Geolocation override (bulletproof çift katmanlı spoof)
    let js_override_code = format!(
        r#"
        if (!window.__geoshift_installed) {{
            window.__geoshift_installed = true;
            window.__geoshift_pos = {{ lat: {lat}, lng: {lng}, acc: {accuracy} }};
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
            navigator.geolocation.getCurrentPosition = function(success, error, options) {{
                setTimeout(() => success(makePos()), 10);
            }};
            navigator.geolocation.watchPosition = function(success, error, options) {{
                setTimeout(() => success(makePos()), 10);
                return setInterval(() => success(makePos()), 1000);
            }};
        }} else {{
            window.__geoshift_pos = {{ lat: {lat}, lng: {lng}, acc: {accuracy} }};
        }}
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

    // Her açık 'page' sekmesine bağlanıp hem izin ver hem emülasyon yap hem de JS inject et
    for tab in tabs {
        if tab.tab_type.as_deref() == Some("page") {
            if let Some(ws_url) = tab.websocket_url {
                if let Ok((mut ws_stream, _)) = connect_async(&ws_url).await {
                    let _ = ws_stream.send(Message::Text(grant_payload.clone())).await;
                    let _ = ws_stream.send(Message::Text(override_payload.clone())).await;
                    let _ = ws_stream.send(Message::Text(js_payload.clone())).await;
                    // Hemen kapatmak yerine kısa bir an açık tutuyoruz
                    tokio::time::sleep(std::time::Duration::from_millis(15)).await;
                    let _ = ws_stream.close(None).await;
                    updated_count += 1;
                }
            }
        }
    }

    // Browser-level websocket'e de izin ve override gönder
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
