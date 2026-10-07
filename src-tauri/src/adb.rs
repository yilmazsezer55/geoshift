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

pub async fn list_devices() -> Result<Vec<Device>, String> {
    let mut adb_start = Command::new("adb");
    adb_start.arg("start-server");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        adb_start.creation_flags(0x08000000);
    }
    let _ = adb_start.output();

    let mut device_list = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    let python_exe = if Path::new(".venv/Scripts/python.exe").exists() { ".venv/Scripts/python.exe" } else { "python" };
    let script_path = if Path::new("src-tauri/scripts/discovery.py").exists() { "src-tauri/scripts/discovery.py" } else { "discovery.py" };

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
            if let (Some(start), Some(end)) = (stdout.find("---JSON_START---"), stdout.find("---JSON_END---")) {
                let json_slice = &stdout[start + "---JSON_START---".len()..end].trim();
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(json_slice) {
                    if let Some(devices) = data["devices"].as_array() {
                        for d in devices {
                            if d["os"] == "android" {
                                let id = d["id"].as_str().unwrap_or_default().to_string();
                                if !id.is_empty() {
                                    device_list.push(Device {
                                        id: id.clone(),
                                        name: d["name"].as_str().unwrap_or("Android Device").to_string(),
                                        model: d["model"].as_str().unwrap_or("Android").to_string(),
                                        status: d["status"].as_str().unwrap_or("Device").to_string(),
                                        os: "android".to_string(),
                                        connection_mode: d["connection"].as_str().unwrap_or("usb").to_lowercase(),
                                    });
                                    seen_ids.insert(id);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Ok(mut server) = Ok::<ADBServer, String>(ADBServer::new(SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 5037))) {
        if let Ok(devices) = server.devices() {
            for d in devices {
                if !seen_ids.contains(&d.identifier) {
                    let model = match server.get_device_by_name(&d.identifier) {
                        Ok(mut dev) => {
                            let mut buf = Vec::new();
                            if dev.shell_command(&"getprop ro.product.model", Some(&mut buf), None).is_ok() {
                                String::from_utf8_lossy(&buf).trim().to_string()
                            } else { "Android Cihaz".to_string() }
                        }
                        Err(_) => "Android Cihaz".to_string(),
                    };
                    device_list.push(Device {
                        id: d.identifier.clone(),
                        name: "Android Device".to_string(),
                        model,
                        status: format!("{:?}", d.state),
                        os: "android".to_string(),
                        connection_mode: if d.identifier.contains(':') { "wifi".to_string() } else { "usb".to_string() },
                    });
                    seen_ids.insert(d.identifier);
                }
            }
        }
    }
    Ok(device_list)
}

fn get_apk_path() -> std::path::PathBuf {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap_or(manifest_dir);
    let candidates = [
        repo_root.join("resources").join("settings_apk-debug.apk"),
        manifest_dir.join("resources").join("settings_apk-debug.apk"),
        std::path::PathBuf::from("resources/settings_apk-debug.apk"),
        std::path::PathBuf::from("../resources/settings_apk-debug.apk"),
    ];
    for p in &candidates {
        if p.exists() {
            return p.clone();
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let p1 = parent.join("resources").join("settings_apk-debug.apk");
            if p1.exists() { return p1; }
            if let Some(p2) = parent.parent() {
                let p2_candidate = p2.join("resources").join("settings_apk-debug.apk");
                if p2_candidate.exists() { return p2_candidate; }
            }
        }
    }
    repo_root.join("resources").join("settings_apk-debug.apk")
}

pub async fn ensure_helper_app(device_id: &str) -> Result<bool, String> {
    let mut server = ADBServer::new(SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 5037));
    let mut device = server.get_device_by_name(device_id).map_err(|e| format!("Cihaz bulunamadı: {}", e))?;
    let mut output = Vec::new();
    let _ = device.shell_command(&"pm list packages io.appium.settings", Some(&mut output), None);
    if String::from_utf8_lossy(&output).contains("package:io.appium.settings") { return Ok(true); }

    let mut apk_path = get_apk_path();
    if !apk_path.exists() {
        let python_exe = if Path::new(".venv/Scripts/python.exe").exists() { ".venv/Scripts/python.exe" } else { "python" };
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest_dir.parent().unwrap_or(manifest_dir);
        let script_path = repo_root.join("scripts").join("download_helper.py");
        let mut py_cmd = Command::new(python_exe);
        py_cmd.arg(&script_path);
        #[cfg(target_os = "windows")] { use std::os::windows::process::CommandExt; py_cmd.creation_flags(0x08000000); }
        let _ = py_cmd.output();
        apk_path = get_apk_path();
    }
    if !apk_path.exists() { return Err(format!("APK bulunamadı (Aranan konum: {:?})", apk_path)); }

    // 1. Önce izinleri otomatik vererek yüklemeyi dene (-g)
    let mut adb_cmd = Command::new("adb");
    adb_cmd.args(&["-s", device_id, "install", "-r", "-t", "-g", apk_path.to_str().unwrap()]);
    #[cfg(target_os = "windows")] { use std::os::windows::process::CommandExt; adb_cmd.creation_flags(0x08000000); }
    let out = adb_cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    if out.status.success() || stdout.contains("Success") {
        return Ok(true);
    }

    // 2. Bazı Huawei ve eski cihazlarda -g hata verebilir, standart install fallback dene
    let mut fallback_cmd = Command::new("adb");
    fallback_cmd.args(&["-s", device_id, "install", "-r", "-t", apk_path.to_str().unwrap()]);
    #[cfg(target_os = "windows")] { use std::os::windows::process::CommandExt; fallback_cmd.creation_flags(0x08000000); }
    let fb_out = fallback_cmd.output().map_err(|e| e.to_string())?;
    let fb_stdout = String::from_utf8_lossy(&fb_out.stdout);
    if fb_out.status.success() || fb_stdout.contains("Success") {
        return Ok(true);
    }

    Err(format!("APK yüklenemedi: {}", if !fb_stdout.is_empty() { fb_stdout.trim() } else { stdout.trim() }))
}

pub async fn open_developer_settings(device_id: &str) -> Result<(), String> {
    let mut adb_cmd = Command::new("adb");
    adb_cmd.args(&["-s", device_id, "shell", "am", "start", "-a", "android.settings.APPLICATION_DEVELOPMENT_SETTINGS"]);
    #[cfg(target_os = "windows")] { use std::os::windows::process::CommandExt; adb_cmd.creation_flags(0x08000000); }
    let _ = adb_cmd.output();
    Ok(())
}

pub async fn wake_up_helper(device_id: &str) -> Result<(), String> {
    let mut adb_cmd = Command::new("adb");
    adb_cmd.args(&["-s", device_id, "shell", "am", "start", "-n", "io.appium.settings/.Settings"]);
    #[cfg(target_os = "windows")] { use std::os::windows::process::CommandExt; adb_cmd.creation_flags(0x08000000); }
    let _ = adb_cmd.output();
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    let mut svc_cmd = Command::new("adb");
    svc_cmd.args(&["-s", device_id, "shell", "am", "startservice", "io.appium.settings/.LocationService"]);
    #[cfg(target_os = "windows")] { use std::os::windows::process::CommandExt; svc_cmd.creation_flags(0x08000000); }
    let _ = svc_cmd.output();
    Ok(())
}

pub async fn set_mock_location(
    device_id: &str,
    latitude: f64,
    longitude: f64,
    speed: f64,
    bearing: f64,
    altitude: f64,
) -> Result<String, String> {
    // Force DOT decimal separator and limit precision for shell command stability
    let lat_str = format!("{:.7}", latitude);
    let lng_str = format!("{:.7}", longitude);
    let spd_str = format!("{:.2}", speed);
    let brg_str = format!("{:.2}", bearing);
    let alt_str = format!("{:.1}", altitude);

    let mut server = ADBServer::new(SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 5037));
    let mut device = server.get_device_by_name(device_id).map_err(|e| format!("ADB error: {}", e))?;

    // 1. am startservice: Modern Android cihazlar için
    let command = format!(
        "am startservice -n io.appium.settings/.LocationService --es latitude {} --es longitude {} --es altitude {} --es speed {} --es bearing {} --es accuracy 8.0",
        lat_str, lng_str, alt_str, spd_str, brg_str
    );
    let mut output = Vec::new();
    let _ = device.shell_command(&command, Some(&mut output), None);

    // 2. am broadcast: Emülatörler ve background-service kısıtlaması olan Android 8+ cihazlar için kritik fallback!
    let broadcast_cmd = format!(
        "am broadcast -a io.appium.settings.set_location --es longitude {} --es latitude {} --es altitude {} --es speed {} --es bearing {}",
        lng_str, lat_str, alt_str, spd_str, brg_str
    );
    let mut b_output = Vec::new();
    let _ = device.shell_command(&broadcast_cmd, Some(&mut b_output), None);

    Ok("OK".to_string())
}

pub async fn check_developer_mode(device_id: &str) -> Result<bool, String> {
    let mut server = ADBServer::new(SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 5037));
    let mut device = server.get_device_by_name(device_id).map_err(|e| e.to_string())?;
    let mut output = Vec::new();
    device.shell_command(&"settings get global development_settings_enabled", Some(&mut output), None).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&output).trim() == "1")
}

pub async fn silence_notifications(device_id: &str) -> Result<String, String> {
    let mut server = ADBServer::new(SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 5037));
    let mut device = server.get_device_by_name(device_id).map_err(|e| e.to_string())?;
    let _ = device.shell_command(&"pm revoke io.appium.settings android.permission.POST_NOTIFICATIONS", Some(&mut Vec::new()), None);
    Ok("OK".to_string())
}

pub async fn is_android_device_connected(device_id: &str) -> bool {
    let mut cmd = Command::new("adb");
    cmd.args(&["-s", device_id, "get-state"]);
    #[cfg(target_os = "windows")] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x08000000); }
    if let Ok(out) = cmd.output() { if out.status.success() && String::from_utf8_lossy(&out.stdout).contains("device") { return true; } }
    false
}
