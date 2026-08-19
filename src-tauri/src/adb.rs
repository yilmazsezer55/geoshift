use adb_client::server::ADBServer;
use adb_client::ADBDeviceExt;
use serde::{Deserialize, Serialize};
use std::net::{Ipv4Addr, SocketAddrV4};
use std::path::Path;
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub model: String,
    pub status: String,
    pub os: String,
    #[serde(rename = "connectionMode")]
    pub connection_mode: String,
}

/// Python scriptini kullanarak cihazları listele, hata durumunda native fallback kullan
pub async fn list_devices() -> Result<Vec<Device>, String> {
    // Önce ADB sunucusunun çalıştığından emin ol
    let mut adb_start = Command::new("adb");
    adb_start.arg("start-server");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        adb_start.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let _ = adb_start.output();

    let mut device_list = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    // 1. Python ile deneme yap
    let python_exe = if Path::new(".venv/Scripts/python.exe").exists() {
        ".venv/Scripts/python.exe"
    } else {
        "python"
    };

    let script_path = if Path::new("src-tauri/scripts/discovery.py").exists() {
        "src-tauri/scripts/discovery.py"
    } else if Path::new("scripts/discovery.py").exists() {
        "scripts/discovery.py"
    } else {
        "discovery.py"
    };

    let python_error;

    let mut py_cmd = Command::new(python_exe);
    py_cmd.args(&[script_path]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        py_cmd.creation_flags(0x08000000);
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
                    if let Some(devices) = data["devices"].as_array() {
                        for d in devices {
                            if d["os"] == "android" {
                                let id = d["id"].as_str().unwrap_or_default().to_string();
                                if !id.is_empty() {
                                    device_list.push(Device {
                                        id: id.clone(),
                                        name: d["name"]
                                            .as_str()
                                            .unwrap_or("Android Device")
                                            .to_string(),
                                        model: d["model"].as_str().unwrap_or("Android").to_string(),
                                        status: d["status"].as_str().unwrap_or("Device").to_string(),
                                        os: "android".to_string(),
                                        connection_mode: d["connection"]
                                            .as_str()
                                            .unwrap_or("usb")
                                            .to_lowercase(),
                                    });
                                    seen_ids.insert(id);
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

    // 2. Native Fallback (Eğer Python sonuç vermediyse veya eksikse)
    if let Ok(mut server) = Ok::<ADBServer, String>(ADBServer::new(SocketAddrV4::new(
        Ipv4Addr::new(127, 0, 0, 1),
        5037,
    ))) {
        if let Ok(devices) = server.devices() {
            for d in devices {
                if !seen_ids.contains(&d.identifier) {
                    // Temel model bilgisini çekmeye çalış
                    let model = match server.get_device_by_name(&d.identifier) {
                        Ok(mut dev) => {
                            let mut buf = Vec::new();
                            if dev
                                .shell_command(&"getprop ro.product.model", Some(&mut buf), None)
                                .is_ok()
                            {
                                String::from_utf8_lossy(&buf).trim().to_string()
                            } else {
                                "Android Cihaz".to_string()
                            }
                        }
                        Err(_) => "Android Cihaz".to_string(),
                    };

                    device_list.push(Device {
                        id: d.identifier.clone(),
                        name: "Android Device".to_string(), // Native fallback doesn't fetch custom name
                        model,
                        status: format!("{:?}", d.state),
                        os: "android".to_string(),
                        connection_mode: if d.identifier.contains(':') {
                            "wifi".to_string()
                        } else {
                            "usb".to_string()
                        },
                    });
                    seen_ids.insert(d.identifier);
                }
            }
        }
    }

    // 3. Hata raporlama: Eğer hiçbir cihaz bulunamadıysa ve Python hata verdiyse bildir
    if device_list.is_empty()
        && !python_error.is_empty()
        && python_error != "Bilinmeyen Python hatası"
    {
        println!("Android Keşif Hatası (Python): {}", python_error);
    }

    Ok(device_list)
}

/// Android cihazda yardımcı uygulamanın yüklü olup olmadığını kontrol et ve gerekirse yükle
pub async fn ensure_helper_app(device_id: &str) -> Result<bool, String> {
    let mut server = ADBServer::new(SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 5037));
    let mut device = server
        .get_device_by_name(device_id)
        .map_err(|e| format!("Cihaz bulunamadı: {}", e))?;

    // Paket kontrolü
    let mut output = Vec::new();
    let _ = device.shell_command(
        &"pm list packages io.appium.settings",
        Some(&mut output),
        None,
    );
    let output_str = String::from_utf8_lossy(&output);

    if output_str.contains("package:io.appium.settings") {
        return Ok(true);
    }

    // Uygulama yüklü değil, yüklemeye çalış
    println!("Yardımcı uygulama bulunamadı, yükleniyor: {}", device_id);

    // APK yolu (Tauri resources veya bin dizini)
    let mut apk_path = std::path::PathBuf::from("resources/settings_apk-debug.apk");

    // Check multiple locations for the APK
    if !apk_path.exists() {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(parent) = exe_path.parent() {
                let alt_path = parent.join("resources").join("settings_apk-debug.apk");
                if alt_path.exists() {
                    apk_path = alt_path;
                }
            }
        }
    }

    // 2. Try looking upwards (for dev mode where CWD might be src-tauri)
    if !apk_path.exists() {
        let mut current = std::env::current_dir().unwrap_or_default();
        for _ in 0..3 {
            let candidate = current.join("resources").join("settings_apk-debug.apk");
            if candidate.exists() {
                apk_path = candidate;
                break;
            }
            if !current.pop() { break; }
        }
    }

    if !apk_path.exists() {
        println!("Yardımcı APK bulunamadı ({:?}), indirme scripti deneniyor...", apk_path);
        // Python scriptini çalıştır
        let python_exe = if Path::new(".venv/Scripts/python.exe").exists() {
            ".venv/Scripts/python.exe"
        } else if Path::new("../.venv/Scripts/python.exe").exists() {
            "../.venv/Scripts/python.exe"
        } else {
            "python"
        };

        let script_path = if Path::new("scripts/download_helper.py").exists() {
            "scripts/download_helper.py"
        } else if Path::new("../scripts/download_helper.py").exists() {
            "../scripts/download_helper.py"
        } else {
            "download_helper.py"
        };

        let mut py_cmd = Command::new(python_exe);
        py_cmd.args(&[script_path]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            py_cmd.creation_flags(0x08000000);
        }

        if let Ok(output) = py_cmd.output() {
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                println!("APK indirme scripti başarısız: {}", err);
            }
        }
    }

    if !apk_path.exists() {
        return Err("Yardımcı APK dosyası bulunamadı (resources/settings_apk-debug.apk). Lütfen internet bağlantınızı kontrol edin veya dosyayı manuel ekleyin.".to_string());
    }

    // adb install komutunu çalıştır
    let mut adb_cmd = std::process::Command::new("adb");
    let apk_str = apk_path.to_str().unwrap_or("");

    // -r: replace existing, -t: allow test packages, -g: grant all runtime permissions
    adb_cmd.args(&["-s", device_id, "install", "-r", "-t", "-g", apk_str]);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        adb_cmd.creation_flags(0x08000000);
    }

    println!("--- ADB INSTALL DEBUG START ---");
    println!("Command: adb -s {} install -r -t -g {}", device_id, apk_str);

    let output = adb_cmd
        .output()
        .map_err(|e| format!("ADB komutu (install) çalıştırılamadı: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    println!("STDOUT: {}", stdout);
    println!("STDERR: {}", stderr);
    println!("--- ADB INSTALL DEBUG END ---");

    if output.status.success() || stdout.contains("Success") {
        println!("Yardımcı uygulama başarıyla yüklendi: {}", device_id);

        // Try to start the settings activity
        let mut am_start = std::process::Command::new("adb");
        am_start.args(&["-s", device_id, "shell", "am", "start", "-n", "io.appium.settings/.Settings"]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            am_start.creation_flags(0x08000000);
        }
        let _ = am_start.output();

        Ok(true)
    } else {
        let error_detail = if !stderr.is_empty() { stderr.to_string() } else { stdout.to_string() };
        Err(format!("APK yükleme hatası: {}", error_detail))
    }
}

/// Android cihazda Geliştirici Seçeneklerini açmaya çalış
pub async fn open_developer_settings(device_id: &str) -> Result<(), String> {
    let mut adb_cmd = std::process::Command::new("adb");
    adb_cmd.args(&["-s", device_id, "shell", "am", "start", "-a", "android.settings.APPLICATION_DEVELOPMENT_SETTINGS"]);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        adb_cmd.creation_flags(0x08000000);
    }
    let _ = adb_cmd.output();
    Ok(())
}

/// Android cihazda mock location ayarla
pub async fn set_mock_location(
    device_id: &str,
    latitude: f64,
    longitude: f64,
) -> Result<String, String> {
    // 1. Yardımcı uygulama kontrolü kaldırıldı (Performans için Discovery/Connect aşamasında yapılıyor)

    let mut server = ADBServer::new(SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 5037));
    let mut device = server
        .get_device_by_name(device_id)
        .map_err(|e| format!("Cihaz bulunamadı: {}", e))?;

    // 2. Mock location komutunu çalıştır
    // Önceki çalışan sürümdeki Service komutunu kullanıyoruz (dama stabil)
    let command = format!(
        "am startservice -e latitude {} -e longitude {} -e altitude 10 io.appium.settings/.LocationService",
        latitude, longitude
    );

    let mut output = Vec::new();
    device
        .shell_command(&command, Some(&mut output), None)
        .map_err(|e| format!("Mock location komutu başarısız: {}", e))?;

    // Bazı cihazlar için broadcast fallback (ikisini birden göndermek en garantisi)
    let broadcast_cmd = format!(
        "am broadcast -a io.appium.settings.set_location --es longitude {} --es latitude {}",
        longitude, latitude
    );
    let mut b_output = Vec::new();
    let _ = device.shell_command(&broadcast_cmd, Some(&mut b_output), None);

    Ok(format!(
        "Konum başarıyla değiştirildi: {}, {}",
        latitude, longitude
    ))
}

/// Developer options ve mock location ayarlarını kontrol et
pub async fn check_developer_mode(device_id: &str) -> Result<bool, String> {
    let mut server = ADBServer::new(SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 5037));
    let mut device = server
        .get_device_by_name(device_id)
        .map_err(|e| format!("Cihaz bulunamadı: {}", e))?;

    // Developer options kontrolü
    let mut output = Vec::new();
    device
        .shell_command(
            &"settings get global development_settings_enabled",
            Some(&mut output),
            None,
        )
        .map_err(|e| format!("Developer mode kontrolü başarısız: {}", e))?;

    let output_str = String::from_utf8_lossy(&output);
    Ok(output_str.trim() == "1")
}

/// Bildirim seslerini ve panel kirliliğini engellemek için Appium Settings bildirimlerini kapat
pub async fn silence_notifications(device_id: &str) -> Result<String, String> {
    let mut server = ADBServer::new(SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 5037));
    let mut device = server
        .get_device_by_name(device_id)
        .map_err(|e| format!("Cihaz bulunamadı: {}", e))?;

    // Bildirim iznini iptal et (Sessiz çalışma için)
    let command = "pm revoke io.appium.settings android.permission.POST_NOTIFICATIONS";

    let mut output = Vec::new();
    let _ = device.shell_command(&command, Some(&mut output), None);

    Ok("Bildirimler susturuldu".to_string())
}

/// ID bazlı hızlı bağlantı kontrolü (Heartbeat için optimize edildi)
pub async fn is_android_device_connected(device_id: &str) -> bool {
    // 1. Try adb get-state (Fastest)
    for _ in 0..2 {
        // Retry once for stability (prevents false positives while busy)
        let mut cmd = Command::new("adb");
        cmd.args(&["-s", device_id, "get-state"]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        if let Ok(output) = cmd.output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.contains("device") {
                    return true;
                }
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }

    // 2. Fallback: Use the main discovery
    if let Ok(devices) = list_devices().await {
        return devices.iter().any(|d| d.id == device_id);
    }

    false
}
