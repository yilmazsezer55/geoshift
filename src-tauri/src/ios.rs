use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::process::Command;
use std::process::Stdio;

fn get_python_executable() -> String {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let venv_root = manifest_dir.parent().unwrap_or(manifest_dir);

    #[cfg(target_os = "windows")]
    {
        let candidate = venv_root.join(".venv").join("Scripts").join("python.exe");
        if candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
        "python".to_string()
    }

    #[cfg(not(target_os = "windows"))]
    {
        let candidate = venv_root.join(".venv").join("bin").join("python");
        if candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
        "python3".to_string()
    }
}

fn get_discovery_script_path() -> String {
    let script_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("scripts").join("discovery.py");
    script_path.to_string_lossy().into_owned()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IosDevice {
    pub udid: String,
    pub name: String,
    pub status: String,
    pub os: String,
    #[serde(rename = "connectionMode")]
    pub connection_mode: String,
}

/// libimobiledevice komutlarını bulmaya çalış (Windows'ta PATH dışındaki yerlerde olabilir)
fn get_command_path(bin_name: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        let common_paths = [
            "C:\\Program Files\\Common Files\\Apple\\Mobile Device Support\\bin",
            "C:\\Program Files (x86)\\Common Files\\Apple\\Mobile Device Support\\bin",
            "C:\\Program Files\\iTunes",
            "C:\\Program Files (x86)\\iTunes",
            "C:\\Program Files\\Common Files\\Apple\\Devices",
            "C:\\Program Files (x86)\\Common Files\\Apple\\Devices",
            "C:\\Program Files\\Apple Music",
        ];

        for path in common_paths {
            let full_path = format!("{}\\{}.exe", path, bin_name);
            if Path::new(&full_path).exists() {
                return full_path;
            }
        }
    }

    bin_name.to_string() // macOS/Linux veya PATH'de ise doğrudan ismi döndür
}

/// Python scriptini kullanarak iOS cihazları listele, hata durumunda native fallback kullan
pub async fn list_ios_devices() -> Result<Vec<IosDevice>, String> {
    let mut ios_devices = Vec::new();
    let mut seen_ids = HashSet::new();

    // 1. Python ile deneme yap
    let python_exe = get_python_executable();
    let script_path = get_discovery_script_path();

    let python_error;

    let mut py_cmd = Command::new(&python_exe);
    py_cmd.arg(&script_path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        py_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    if let Ok(output) = py_cmd.output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);

            // Ayraçları bul ve JSON verisini ayıkla
            if let (Some(start), Some(end)) = (
                stdout.find("---JSON_START---"),
                stdout.find("---JSON_END---"),
            ) {
                let json_slice = &stdout[start + "---JSON_START---".len()..end].trim();

                if let Ok(data) = serde_json::from_str::<serde_json::Value>(json_slice) {
                    if let Some(device_list) = data["devices"].as_array() {
                        for d in device_list {
                            if d["os"] == "ios" {
                                let udid = d["id"].as_str().unwrap_or_default().to_string();
                                if !udid.is_empty() {
                                    ios_devices.push(IosDevice {
                                        udid: udid.clone(),
                                        name: d["name"].as_str().unwrap_or_default().to_string(),
                                        status: "Connected".to_string(),
                                        os: "ios".to_string(),
                                        connection_mode: d["connection"]
                                            .as_str()
                                            .unwrap_or("usb")
                                            .to_lowercase(),
                                    });
                                    seen_ids.insert(udid);
                                }
                            }
                        }
                    }
                    python_error = String::new(); // Başarılı
                } else {
                    python_error = format!("JSON parse hatası. Ham veri şurada: {}", json_slice);
                }
            } else {
                python_error = format!("JSON ayraçları bulunamadı. Ham çıktı: {}", stdout);
            }
        } else {
            python_error = String::from_utf8_lossy(&output.stderr).to_string();
        }
    } else {
        python_error = format!(
            "Python (v) veya script (s) bulunamadı. v: {}, s: {}",
            python_exe, script_path
        );
    }

    // 2. Native Fallback (libimobiledevice kullanarak)
    if ios_devices.is_empty() {
        let idevice_id_path = get_command_path("idevice_id");
        let ideviceinfo_path = get_command_path("ideviceinfo");

        let mut id_cmd = Command::new(&idevice_id_path);
        id_cmd.arg("-l");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            id_cmd.creation_flags(0x08000000);
        }

        if let Ok(out) = id_cmd.output() {
            let udids_str = String::from_utf8_lossy(&out.stdout);
            for udid in udids_str.lines() {
                let udid_trimmed = udid.trim();
                if udid_trimmed.is_empty() || seen_ids.contains(udid_trimmed) {
                    continue;
                }

                // Cihaz ismini almaya çalış
                let mut info_cmd = Command::new(&ideviceinfo_path);
                info_cmd.args(&["-u", udid_trimmed, "-k", "DeviceName"]);
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    info_cmd.creation_flags(0x08000000);
                }

                let name = match info_cmd.output() {
                    Ok(name_out) => String::from_utf8_lossy(&name_out.stdout).trim().to_string(),
                    Err(_) => "iPhone (Bağlı)".to_string(),
                };

                ios_devices.push(IosDevice {
                    udid: udid_trimmed.to_string(),
                    name: if name.is_empty() {
                        "iPhone".to_string()
                    } else {
                        name
                    },
                    status: "Connected".to_string(),
                    os: "ios".to_string(),
                    connection_mode: "usb".to_string(),
                });
                seen_ids.insert(udid_trimmed.to_string());
            }
        }
    }

    // 3. Hata raporlama: Eğer hiçbir cihaz bulunamadıysa ve Python hata verdiyse bildir
    if ios_devices.is_empty()
        && !python_error.is_empty()
        && python_error != "Bilinmeyen Python hatası"
    {
        println!("iOS Keşif Hatası (Python): {}", python_error);
    }

    return Ok(ios_devices);
}

/// UDID bazlı hızlı bağlantı kontrolü (Heartbeat için optimize edildi)
pub async fn is_ios_device_connected(udid: &str) -> bool {
    let idevice_id = get_command_path("idevice_id");

    // 1. Try idevice_id -l (Fastest)
    for _ in 0..2 {
        // Retry once for stability
        let mut cmd = Command::new(&idevice_id);
        cmd.arg("-l");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.lines().any(|line| line.trim() == udid) {
                    return true;
                }
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }

    // 2. Fallback: Use the main discovery (uses Python/usbmux)
    if let Ok(devices) = list_ios_devices().await {
        return devices.iter().any(|d| d.udid == udid);
    }

    false
}

/// tunneld servisinin çalışıp çalışmadığını kontrol et (Port 49151)
fn is_tunneld_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::net::TcpStream;
        use std::time::Duration;
        TcpStream::connect_timeout(
            &"127.0.0.1:49151".parse().unwrap(),
            Duration::from_millis(500),
        )
        .is_ok()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}

/// tunneld servisini sessizce başlat
fn ensure_tunneld_running(state: &crate::LocationState) -> Result<(), String> {
    if is_tunneld_running() {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        println!("DEBUG: Starting tunneld silently...");

        let python_exe = get_python_executable();

        if crate::is_admin() {
            // CREATE_NO_WINDOW = 0x08000000
            if let Ok(child) = Command::new(&python_exe)
                .args(&["-m", "pymobiledevice3", "remote", "tunneld"])
                .creation_flags(0x08000000)
                .spawn()
            {
                let mut tunneld_storage = state.tunneld_process.lock().unwrap();
                *tunneld_storage = Some(child);
            }
        } else {
            // Un-elevated fallback: attempt RunAs via powershell
            let ps_script = format!(
                "Start-Process '{}' -ArgumentList '-m pymobiledevice3 remote tunneld' -Verb RunAs -WindowStyle Hidden",
                python_exe
            );
            let _ = Command::new("powershell")
                .args(&["-NoProfile", "-Command", &ps_script])
                .creation_flags(0x08000000)
                .spawn();
        }

        // Wait up to 10 seconds for tunneld to respond on port 49151 (100 * 100ms)
        for _ in 0..100 {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if is_tunneld_running() {
                println!("DEBUG: tunneld servisi başlatıldı (Port 49151 aktif).");
                return Ok(());
            }
        }
        println!("WARN: tunneld servisi 10s içerisinde yanıt vermedi. Devam ediliyor (usbmux fallback).");
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(())
    }
}

/// iOS cihazda konum değiştir
pub async fn set_ios_location(
    udid: &str,
    latitude: f64,
    longitude: f64,
    state: &crate::LocationState,
) -> Result<String, String> {
    // Ensure tunneld is running for iOS 17+ (best effort)
    let _ = ensure_tunneld_running(state);

    let python_exe = get_python_executable();
    let script_path = get_discovery_script_path();

    let valid_udid = udid.trim();
    let normalized_udid: String = valid_udid.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if normalized_udid.is_empty() || normalized_udid.chars().all(|c| c == '0') {
        return Err("Geçersiz UDID. Lütfen cihazı yeniden bağlayın.".to_string());
    }

    // First attempt live update if a persistent process already exists.
    {
        let mut processes = state.active_ios_processes.lock().unwrap();
        if let Some(child) = processes.get_mut(udid) {
            if let Some(stdin) = child.stdin.as_mut() {
                use std::io::Write;
                let update = format!("{},{}\n", latitude, longitude);
                if let Err(e) = stdin.write_all(update.as_bytes()) {
                    eprintln!("İOS canlı koordinat güncellemesi yazılamadı: {}", e);
                    // Broken pipe or closed stdin: clean up stale child so we can spawn a new one.
                    let _ = child.kill();
                    let _ = child.wait();
                    // Remove the stale entry from the map so spawn path runs below.
                    processes.remove(udid);
                } else {
                    return Ok("Konum güncellendi.".to_string());
                }
            }
        }
    }

    // Spawn a persistent helper process that reapplies the simulated location
    // periodically. The child process is stored in `active_ios_processes` so
    // it can be updated on later location changes.
    use std::io::{BufRead, BufReader};
    use std::time::Duration;

    let mut cmd = Command::new(&python_exe);
    cmd.args(&[
        &script_path,
        "persistent_set_location",
        udid,
        &latitude.to_string(),
        &longitude.to_string(),
        "3",
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    match cmd.spawn() {
        Ok(mut child) => {
            let stdout = child.stdout.take();
            let output_future = if let Some(out) = stdout {
                Ok(tokio::task::spawn_blocking(move || {
                    let mut reader = BufReader::new(out);
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(_) => Ok(line),
                        Err(e) => Err(format!("Child stdout okunamadı: {}", e)),
                    }
                }))
            } else {
                Err("Persistent process stdout'u açılamadı.".to_string())
            };

            let output_result: Result<String, String> = match output_future {
                Ok(handle) => match tokio::time::timeout(Duration::from_secs(6), handle).await {
                    Ok(join_result) => match join_result {
                        Ok(line) => line,
                        Err(err) => Err(format!("Child stdout task hatası: {}", err)),
                    },
                    Err(_) => Err("Persistent process başlangıç çıktısı zaman aşımına uğradı.".to_string()),
                },
                Err(err) => Err(err),
            };

            match output_result {
                Ok(line) => {
                    let line = line.trim();
                    if !line.is_empty() {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
                            if parsed.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
                                let mut processes = state.active_ios_processes.lock().unwrap();
                                processes.insert(udid.to_string(), child);
                                return Ok("Konum simülasyonu başlatıldı.".to_string());
                            }
                            let msg = parsed.get("error").and_then(|v| v.as_str()).unwrap_or("Bilinmeyen hata");
                            let _ = child.kill();
                            return Err(format!("Python süreci hata döndü: {}", msg));
                        }
                        // Eğer çıktıyı parse edemezsek bile child çalışmaya başlamış olabilir.
                        println!("WARN: Persistent iOS process stdout parse edilemedi: {}", line);
                    }

                    // Spawn başarılı olduysa eski davranışı koru.
                    let mut processes = state.active_ios_processes.lock().unwrap();
                    processes.insert(udid.to_string(), child);
                    Ok("Konum simülasyonu başlatıldı.".to_string())
                }
                Err(err) => {
                    // Eğer stdout okunamazsa bile spawn başarılı olmuşsa devam edebilir.
                    println!("WARN: Persistent iOS process stdout okunamadı: {}", err);
                    let mut processes = state.active_ios_processes.lock().unwrap();
                    processes.insert(udid.to_string(), child);
                    Ok("Konum simülasyonu başlatıldı.".to_string())
                }
            }
        }
        Err(e) => Err(format!("Komut çalıştırılamadı: {}", e)),
    }
}

/// iOS cihazda simüle edilen konumu temizle
pub async fn clear_ios_location(
    udid: &str,
    state: &crate::LocationState,
) -> Result<String, String> {
    // 1. Kill the active session process
    {
        let mut processes = state.active_ios_processes.lock().unwrap();
        if let Some(mut child) = processes.remove(udid) {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    let python_exe = get_python_executable();
    let script_path = get_discovery_script_path();

    let mut clear_cmd = Command::new(&python_exe);
    clear_cmd.args(&[&script_path, "clear_location", udid]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        clear_cmd.creation_flags(0x08000000);
    }

    match clear_cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if output.status.success() {
                match serde_json::from_str::<serde_json::Value>(&stdout) {
                    Ok(data) => {
                        if data["success"].as_bool().unwrap_or(false) {
                            Ok(data["message"]
                                .as_str()
                                .unwrap_or("Konum temizlendi")
                                .to_string())
                        } else {
                            Err(data["error"]
                                .as_str()
                                .unwrap_or("Bilinmeyen hata")
                                .to_string())
                        }
                    }
                    Err(_) => Err(format!("JSON parse hatası: {}", stdout)),
                }
            } else {
                Err(String::from_utf8_lossy(&output.stderr).to_string())
            }
        }
        Err(e) => Err(format!("Komut çalıştırma hatası: {}", e)),
    }
}

/// iOS Developer Mode'u otomatik etkinleştir (reveal + enable)
pub async fn enable_ios_developer_mode(udid: &str) -> Result<String, String> {
    let python_exe = get_python_executable();
    let script_path = get_discovery_script_path();

    let mut cmd = Command::new(&python_exe);
    cmd.args(&[&script_path, "enable_developer_mode", udid]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    match cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if output.status.success() {
                match serde_json::from_str::<serde_json::Value>(&stdout) {
                    Ok(data) => {
                        if data["success"].as_bool().unwrap_or(false) {
                            Ok(data["message"]
                                .as_str()
                                .unwrap_or("Geliştirici Modu etkinleştirildi")
                                .to_string())
                        } else {
                            Err(data["error"]
                                .as_str()
                                .unwrap_or("Bilinmeyen hata")
                                .to_string())
                        }
                    }
                    Err(_) => Err(format!("JSON parse hatası: {}", stdout)),
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("Python skripti hata ile sonlandı: {}", stderr))
            }
        }
        Err(e) => Err(format!("Komut çalıştırılamadı: {}", e)),
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct DevModeResult {
    pub developer_mode: bool,
    pub ios_version: Option<String>,
}

/// iOS Developer Mode kontrolü - developer_mode + ios_version döndürür
pub async fn check_ios_developer_mode(udid: &str) -> Result<DevModeResult, String> {
    let python_exe = get_python_executable();
    let script_path = get_discovery_script_path();

    let mut check_cmd = Command::new(&python_exe);
    check_cmd.args(&[&script_path, "check_developer_mode", udid]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        check_cmd.creation_flags(0x08000000);
    }

    match check_cmd.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if output.status.success() {
                match serde_json::from_str::<serde_json::Value>(&stdout) {
                    Ok(data) => {
                        if data["success"].as_bool().unwrap_or(false) {
                            Ok(DevModeResult {
                                developer_mode: data["enabled"].as_bool().unwrap_or(false),
                                ios_version: data["ios_version"].as_str().map(|s| s.to_string()),
                            })
                        } else {
                            let error_msg = data["error"].as_str().unwrap_or("Bilinmeyen hata");
                            Err(error_msg.to_string())
                        }
                    }
                    Err(_) => Err(format!("JSON ayrıştırma hatası: {}", stdout)),
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("Python skripti hata ile sonlandı: {}", stderr))
            }
        }
        Err(e) => Err(format!("Komut çalıştırılamadı: {}", e)),
    }
}

#[derive(serde::Serialize)]
pub struct ComponentStatus {
    pub name: String,
    pub status: String,
    pub description: String,
    pub critical: bool,
}

/// Tüm iTunes bileşenlerini ve servislerini kontrol et
pub async fn check_itunes_components() -> Result<Vec<ComponentStatus>, String> {
    let mut components = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // 0. iTunes.exe Kontrolü (Ana Uygulama)
        let mut itunes_exists = false;
        let itunes_paths = [
            "C:\\Program Files\\iTunes\\iTunes.exe",
            "C:\\Program Files (x86)\\iTunes\\iTunes.exe",
        ];

        if itunes_paths.iter().any(|path| Path::new(path).exists()) {
            itunes_exists = true;
        } else {
            // Microsoft Store versiyonu kontrolü (PowerShell ile)
            let mut store_cmd = Command::new("powershell");
            store_cmd.args(&["-Command", "Get-AppxPackage -Name AppleInc.iTunes"]);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                store_cmd.creation_flags(0x08000000);
            }
            let store_check = store_cmd.output();
            if let Ok(out) = store_check {
                if !out.stdout.is_empty() {
                    itunes_exists = true;
                }
            }
        }

        components.push(ComponentStatus {
            name: "iTunes Ana Uygulama".to_string(),
            status: if itunes_exists { "Yüklü" } else { "Eksik" }.to_string(),
            description: "Apple cihaz yönetimi için ana uygulama (Opsiyonel).".to_string(),
            critical: false,
        });

        // 1. Apple Mobile Device Service
        let mut amds_cmd = Command::new("sc");
        amds_cmd.args(&["query", "Apple Mobile Device Service"]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            amds_cmd.creation_flags(0x08000000);
        }
        let amds_query = amds_cmd.output();
        let amds_status = match amds_query {
            Ok(out) => {
                let s = String::from_utf8_lossy(&out.stdout);
                if s.contains("RUNNING") {
                    "Çalışıyor"
                } else if s.contains("STOPPED") {
                    "Durduruldu"
                } else {
                    "Bulunamadı"
                }
            }
            Err(_) => "Hata",
        };
        components.push(ComponentStatus {
            name: "Apple Mobile Device Service".to_string(),
            status: amds_status.to_string(),
            description: "Cihaz bağlantısını sağlayan ana servis.".to_string(),
            critical: true,
        });

        // 2. Bonjour Service
        let mut bonjour_cmd = Command::new("sc");
        bonjour_cmd.args(&["query", "Bonjour Service"]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            bonjour_cmd.creation_flags(0x08000000);
        }
        let bonjour_query = bonjour_cmd.output();
        let bonjour_status = match bonjour_query {
            Ok(out) => {
                let s = String::from_utf8_lossy(&out.stdout);
                if s.contains("RUNNING") {
                    "Çalışıyor"
                } else if s.contains("STOPPED") {
                    "Durduruldu"
                } else {
                    "Bulunamadı"
                }
            }
            Err(_) => "Hata",
        };
        components.push(ComponentStatus {
            name: "Bonjour Service".to_string(),
            status: bonjour_status.to_string(),
            description: "Ağ üzerinden cihaz keşfi için gereklidir.".to_string(),
            critical: false,
        });

        // 3. USB Sürücüsü (usbaapl64.sys veya usbaapl.sys)
        let mut driver_exists = false;
        let driver_paths = [
            "C:\\Windows\\System32\\drivers\\usbaapl64.sys",
            "C:\\Windows\\System32\\drivers\\usbaapl.sys",
            "C:\\Program Files\\Common Files\\Apple\\Mobile Device Support\\Drivers\\usbaapl64.sys",
            "C:\\Program Files (x86)\\Common Files\\Apple\\Mobile Device Support\\Drivers\\usbaapl64.sys",
        ];

        if driver_paths.iter().any(|path| Path::new(path).exists()) {
            driver_exists = true;
        } else {
            // Check DriverStore (FileRepository)
            let driver_repo = "C:\\Windows\\System32\\DriverStore\\FileRepository";
            if let Ok(entries) = std::fs::read_dir(driver_repo) {
                for entry in entries.flatten() {
                    let folder_name = entry.file_name().to_string_lossy().to_lowercase();
                    if folder_name.contains("usbaapl64.inf") || folder_name.contains("usbaapl.inf")
                    {
                        driver_exists = true;
                        break;
                    }
                }
            }
        }

        components.push(ComponentStatus {
            name: "Apple USB Sürücüsü".to_string(),
            status: if driver_exists { "Yüklü" } else { "Eksik" }.to_string(),
            description: "USB üzerinden veri aktarımı için kritik sürücü dosyası.".to_string(),
            critical: true,
        });

        // 4. Apple Mobile Device Support (Folder)
        let common_apple = "C:\\Program Files\\Common Files\\Apple\\Mobile Device Support";
        let folder_exists = Path::new(common_apple).exists();
        components.push(ComponentStatus {
            name: "Apple Mobil Cihaz Desteği".to_string(),
            status: if folder_exists { "Mevcut" } else { "Eksik" }.to_string(),
            description: "Apple kütüphanelerinin yüklü olduğu ana dizin.".to_string(),
            critical: true,
        });
    }

    Ok(components)
}

/// Apple servislerini kontrol et ve gerekirse başlat (Windows)
pub async fn repair_apple_services() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        println!("DEBUG: Restarting Apple services with existing admin privileges...");

        // Simple silent restart for relevant services, requiring elevation (UAC prompt if not admin)
        let ps_script = "Start-Process powershell -ArgumentList '-NoProfile -WindowStyle Hidden -Command Restart-Service \"Apple Mobile Device Service\",\"Bonjour Service\",\"iPod Service\" -ErrorAction SilentlyContinue -Force' -Verb RunAs -Wait";

        let status = Command::new("powershell")
            .args(&["-NoProfile", "-Command", ps_script])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .status()
            .map_err(|e| format!("Servis onarım komutları yürütülemedi: {}", e))?;

        if status.success() {
            Ok("Apple servisleri arka planda yenilendi. Lütfen 5-10 saniye bekleyin.".to_string())
        } else {
            Err("Servisler yenilenirken bir hata oluştu.".to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok("Bu özellik sadece Windows üzerinde desteklenmektedir.".to_string())
    }
}

use futures_util::StreamExt;
use std::io::Write;
use tauri::Emitter;

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    percentage: f64,
}

/// iTunes'u arka planda indir ve kur
pub async fn download_and_install_itunes(window: tauri::Window) -> Result<String, String> {
    // Mimari algılama (64-bit vs 32-bit)
    let is_64bit = std::env::consts::ARCH == "x86_64";
    let arch_label = if is_64bit { "win64" } else { "win32" };

    // Apple'ın Windows için direkt indirme linkleri (Mimariye göre)
    let urls = if is_64bit {
        vec![
            "https://www.apple.com/itunes/download/win64",
            "https://itunes.apple.com/download/itunes12/win64",
            "https://secure-appldnld.apple.com/itunes12/052-57116-20240523-DA2C9449-74C7-4144-98F1-4F44FCD66E99/iTunes64Setup.exe"
        ]
    } else {
        vec![
            "https://www.apple.com/itunes/download/win32",
            "https://itunes.apple.com/download/itunes12/win32",
            "https://secure-appldnld.apple.com/itunes12/032-90180-20231213-9BDB02AF-D8C6-4C5C-A77A-EB2B40D0E190/iTunesSetup.exe"
        ]
    };

    let temp_dir = std::env::temp_dir();
    let setup_path = temp_dir.join(format!("itunes_setup_{}.exe", arch_label));
    let setup_path_str = setup_path.to_string_lossy().to_string();

    // --- DOSYA KONTROLÜ (CACHE) ---
    let mut skip_download = false;
    println!("DEBUG: iTunes Setup Path: {:?}", setup_path);
    if setup_path.exists() {
        if let Ok(meta) = std::fs::metadata(&setup_path) {
            println!("DEBUG: Existing file size: {}", meta.len());
            if meta.len() > 100 * 1024 * 1024 {
                println!("DEBUG: Cache HIT. Skipping download.");
                window
                    .emit(
                        "itunes-status",
                        "Yükleyici dosyası zaten mevcut, kuruluma geçiliyor...",
                    )
                    .unwrap();
                window
                    .emit(
                        "itunes-download-progress",
                        DownloadProgress { percentage: 100.0 },
                    )
                    .unwrap();
                skip_download = true;
            } else {
                println!("DEBUG: Cache MISS. File too small.");
            }
        }
    } else {
        println!("DEBUG: Cache MISS. File does not exist.");
    }

    if !skip_download {
        window
            .emit(
                "itunes-status",
                format!(
                    "{} sürümü algılandı, indiriliyor...",
                    if is_64bit { "64-bit" } else { "32-bit" }
                ),
            )
            .unwrap();
    }

    if !skip_download {
        println!("DEBUG: Starting download...");
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .map_err(|e| format!("İstemci oluşturulamadı: {}", e))?;

        let mut response = None;
        let mut last_err = String::new();

        for url in &urls {
            println!("DEBUG: Trying URL: {}", url);
            match client
                .get(*url)
                .header("Referer", "https://www.apple.com/itunes/download/")
                .send()
                .await
            {
                Ok(res) => {
                    if res.status().is_success() {
                        println!("DEBUG: Download connection established.");
                        response = Some(res);
                        break;
                    } else {
                        last_err = format!("Sunucu hata döndürdü: {} ({})", res.status(), url);
                        println!("DEBUG: {}", last_err);
                    }
                }
                Err(e) => {
                    last_err = format!("Bağlantı kurulamadı: {} ({})", e, url);
                    println!("DEBUG: {}", last_err);
                }
            }
        }

        let res_result = response.ok_or_else(|| {
            format!(
                "İndirme başlatılamadı. Tüm sunucular reddetti. Detay: {}",
                last_err
            )
        });

        // --- FALLBACK TO POWERSHELL IF REQWEST FAILS ---
        if res_result.is_err() {
            println!("DEBUG: Reqwest failed. Trying PowerShell fallback.");
            window
                .emit(
                    "itunes-status",
                    "Reqwest başarısız, PowerShell deneniyor...",
                )
                .unwrap();

            let url = if is_64bit {
                "https://www.apple.com/itunes/download/win64"
            } else {
                "https://www.apple.com/itunes/download/win32"
            };
            let mut ps_cmd = Command::new("powershell");
            ps_cmd.args(&[
                    "-Command",
                    &format!("$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '{}' -OutFile '{}' -UserAgent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'", url, setup_path_str)
                ]);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                ps_cmd.creation_flags(0x08000000);
            }
            let status = ps_cmd
                .status()
                .map_err(|e| format!("PowerShell fallback hatası: {}", e))?;

            if !status.success() {
                return Err(format!("Tüm indirme yöntemleri başarısız oldu. Lütfen manuel indirme linkini kullanın. Hata: {}", last_err));
            }

            // Success via PowerShell
            println!("DEBUG: PowerShell download success.");
            window
                .emit(
                    "itunes-download-progress",
                    DownloadProgress { percentage: 100.0 },
                )
                .unwrap();
        } else {
            // Native reqwest download
            let res = res_result.unwrap();
            let total_size = res.content_length().unwrap_or(0);
            let mut downloaded: u64 = 0;
            let mut stream = res.bytes_stream();

            let mut file = std::fs::File::create(&setup_path)
                .map_err(|e| format!("Dosya oluşturulamadı ({}): {}", setup_path_str, e))?;

            while let Some(item) = stream.next().await {
                let chunk = item.map_err(|e| format!("İndirme sırasında hata: {}", e))?;
                file.write_all(&chunk)
                    .map_err(|e| format!("Dosyaya yazılamadı: {}", e))?;

                downloaded += chunk.len() as u64;
                if total_size > 0 {
                    let percentage = (downloaded as f64 / total_size as f64) * 100.0;
                    window
                        .emit("itunes-download-progress", DownloadProgress { percentage })
                        .unwrap();
                }
            }
            println!("DEBUG: Download complete. Total size: {}", downloaded);
        }
    }

    window
        .emit(
            "itunes-status",
            "Kurulum başlatıldı. Lütfen ekranınıza gelecek Windows onay penceresini (UAC) kabul edin.",
        )
        .unwrap();

    // Sessiz kurulum denemesi
    #[cfg(target_os = "windows")]
    {
        let metadata = std::fs::metadata(&setup_path)
            .map_err(|e| format!("Dosya kontrolü başarısız: {}", e))?;
        if metadata.len() < 1024 * 1024 {
            return Err(
                "İndirilen dosya geçersiz veya çok küçük. Lütfen manuel indirme linkini kullanın."
                    .to_string(),
            );
        }

        println!(
            "DEBUG: Launching installer: {} /passive /norestart",
            setup_path_str
        );
        let mut install_cmd = Command::new(&setup_path);
        install_cmd.args(&["/passive", "/norestart"]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            install_cmd.creation_flags(0x08000000);
        }
        let status = install_cmd
            .status()
            .map_err(|e| format!("Kurulum başlatılamadı ({}): {}", setup_path_str, e))?;

        println!("DEBUG: Installer exit status: {:?}", status);

        if !status.success() {
            return Err(
                "Kurulum başlatıldı ancak hata ile sonuçlandı. Lütfen dosyayı manuel olarak çalıştırın."
                    .to_string(),
            );
        }

        // --- KURULUM SONRASI KRİTİK ADIM: SERVİSLERİ BAŞLAT ---
        window
            .emit("itunes-status", "Servisler başlatılıyor...")
            .unwrap();
        // Birkaç saniye bekle ki sistem dosyaları yerleşsin
        std::thread::sleep(std::time::Duration::from_secs(3));

        println!("DEBUG: Restarting Apple services...");
        match repair_apple_services().await {
            Ok(msg) => {
                println!("DEBUG: Services restarted: {}", msg);
                Ok(format!("iTunes kuruldu ve servisler başlatıldı. {}", msg))
            }
            Err(e) => {
                println!("DEBUG: Service restart failed: {}", e);
                // Servis hatası olsa bile kurulum başarılı sayılabilir ama kullanıcıyı uyaralım
                Ok(format!("iTunes kuruldu ancak servisler başlatılamadı: {}. Bilgisayarı yeniden başlatmanız gerekebilir.", e))
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    Ok("Kurulum tamamlandı (Simülasyon)".to_string())
}

/// iTunes indirme sayfasını aç (Microsoft Store veya Apple)
pub async fn open_itunes_download() -> Result<(), String> {
    let url = "https://www.apple.com/itunes/download/win64";

    #[cfg(target_os = "windows")]
    {
        let mut browser_cmd = Command::new("cmd");
        browser_cmd.args(&["/C", "start", url]);
        use std::os::windows::process::CommandExt;
        browser_cmd.creation_flags(0x08000000);
        browser_cmd
            .spawn()
            .map_err(|e| format!("Tarayıcı açılamadı: {}", e))?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn is_ios_usb_connected_hardware(udid: &str) -> bool {
    use std::process::Command;
    let clean_udid = udid.replace("-", "");

    // Efficient wmic query checking for DeviceID presence and Status='OK' (Working USB)
    // Command: wmic path Win32_PnPEntity where "DeviceID like '%<CleanUDID>%' and Status='OK'" get DeviceID
    let mut cmd = Command::new("wmic");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd.args(&[
        "path",
        "Win32_PnPEntity",
        "where",
        &format!("DeviceID like '%{}%' and Status='OK'", clean_udid),
        "get",
        "DeviceID",
    ]);

    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if stdout.to_lowercase().contains(&clean_udid.to_lowercase()) {
                return true;
            }
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
pub fn is_ios_usb_connected_hardware(_udid: &str) -> bool {
    true
}
