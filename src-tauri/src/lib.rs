mod adb;
mod ios;

use adb::Device;
use ios::IosDevice;
use std::collections::{HashMap, HashSet};
use std::process::Child;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use futures_util::FutureExt;

// State management for active location simulations and background services
pub struct LocationState {
    pub active_ios_processes: Mutex<HashMap<String, Child>>,
    pub tunneld_process: Mutex<Option<Child>>,
    pub active_udid: Mutex<Option<(String, String)>>, // (os, udid)
    pub helper_checked_android: Mutex<HashSet<String>>,
}

impl Default for LocationState {
    fn default() -> Self {
        Self {
            active_ios_processes: Mutex::new(HashMap::new()),
            tunneld_process: Mutex::new(None),
            active_udid: Mutex::new(None),
            helper_checked_android: Mutex::new(HashSet::new()),
        }
    }
}

impl LocationState {
    pub fn cleanup(&self) {
        // Kill simulation processes
        let mut processes = self.active_ios_processes.lock().unwrap();
        for (_, mut child) in processes.drain() {
            let _ = child.kill();
        }

        // Kill tunneld process
        let mut tunneld = self.tunneld_process.lock().unwrap();
        if let Some(mut child) = tunneld.take() {
            let _ = child.kill();
        }

        // Final fallback: Kill any orphaned python processes related to our app
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(&["/F", "/IM", "python.exe", "/T"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .spawn();
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn is_admin() -> bool {
    true
}

// Tauri komutları - Frontend'den çağrılabilir

#[tauri::command]
async fn get_android_devices(state: tauri::State<'_, LocationState>) -> Result<Vec<Device>, String> {
    let devices = adb::list_devices().await?;

    // For each USB-connected Android device, try to ensure helper app is installed once.
    // We remember devices we've already checked to avoid repeated installs on every discovery.
    {
        let mut checked = state.helper_checked_android.lock().unwrap();
        for d in devices.iter() {
            if d.connection_mode == "usb" && !checked.contains(&d.id) {
                checked.insert(d.id.clone());
                let dev_id = d.id.clone();

                // Spawn a background task to perform installation so discovery remains fast.
                tauri::async_runtime::spawn(async move {
                    match adb::ensure_helper_app(&dev_id).await {
                        Ok(true) => println!("ensure_helper_app: helper present on {}", dev_id),
                        Ok(false) => println!("ensure_helper_app: helper not available on {}", dev_id),
                        Err(e) => println!("ensure_helper_app failed for {}: {}", dev_id, e),
                    }
                });
            }
        }
    }

    Ok(devices)
}

#[tauri::command]
async fn get_ios_devices() -> Result<Vec<IosDevice>, String> {
    ios::list_ios_devices().await
}

#[tauri::command]
async fn check_device_health(os: String, udid: String, require_usb: bool) -> bool {
    if os == "ios" {
        // If USB is required, perform strict hardware check on Windows
        if require_usb {
            if ios::is_ios_usb_connected_hardware(&udid) {
                return true;
            }
            // If hardware check fails, return false immediately (cable unplugged)
            return false;
        }
        ios::is_ios_device_connected(&udid).await
    } else {
        adb::is_android_device_connected(&udid).await
    }
}

#[tauri::command]
async fn set_location(
    os: String,
    udid: String,
    lat: f64,
    lng: f64,
    state: tauri::State<'_, LocationState>,
) -> Result<String, String> {
    // 1. Pre-Check: Is the device actually connected?
    let is_connected = if os == "ios" {
        ios::is_ios_device_connected(&udid).await
    } else {
        adb::is_android_device_connected(&udid).await
    };

    if !is_connected {
        return Err("Cihaz bağlı değil. Lütfen kabloyu kontrol edin.".to_string());
    }

    // 2. Perform Simulation
    let result = if os == "ios" {
        ios::set_ios_location(&udid, lat, lng, &state).await
    } else {
        adb::set_mock_location(&udid, lat, lng).await
    };

    // 3. Update active state only if simulation started successfully
    if result.is_ok() {
        let mut active = state.active_udid.lock().unwrap();
        *active = Some((os, udid));
    }

    result
}

#[tauri::command]
async fn clear_location(
    os: String,
    udid: String,
    state: tauri::State<'_, LocationState>,
) -> Result<String, String> {
    if os == "ios" {
        // Clear active UDID
        {
            let mut active = state.active_udid.lock().unwrap();
            *active = None;
        }
        ios::clear_ios_location(&udid, &state).await
    } else {
        Ok("Android clear not implemented".to_string())
    }
}
#[tauri::command]
async fn stop_all_simulations(state: tauri::State<'_, LocationState>) -> Result<String, String> {
    state.cleanup();
    Ok("Tüm simülasyonlar durduruldu ve servisler temizlendi.".to_string())
}

#[tauri::command]
async fn silence_android_notifications(device_id: String) -> Result<String, String> {
    adb::silence_notifications(&device_id).await
}

#[tauri::command]
async fn check_android_developer_mode(device_id: String) -> Result<bool, String> {
    adb::check_developer_mode(&device_id).await
}

#[tauri::command]
async fn ensure_android_helper(device_id: String) -> Result<bool, String> {
    // Guard against panics inside adb helper to avoid crashing the Tauri runtime
    match std::panic::AssertUnwindSafe(async { adb::ensure_helper_app(&device_id).await })
        .catch_unwind()
        .await
    {
        Ok(inner) => match inner {
            Ok(ok) => Ok(ok),
            Err(e) => Err(format!("ensure_helper_app failed: {}", e)),
        },
        Err(_) => Err("ensure_android_helper panicked".to_string()),
    }
}

#[tauri::command]
async fn open_android_developer_settings(device_id: String) -> Result<(), String> {
    adb::open_developer_settings(&device_id).await
}

#[tauri::command]
async fn check_ios_developer_mode(udid: String) -> Result<ios::DevModeResult, String> {
    ios::check_ios_developer_mode(&udid).await
}

#[tauri::command]
async fn enable_ios_developer_mode(udid: String) -> Result<String, String> {
    ios::enable_ios_developer_mode(&udid).await
}

#[tauri::command]
async fn repair_apple_services() -> Result<String, String> {
    ios::repair_apple_services().await
}

#[tauri::command]
async fn check_itunes_components() -> Result<Vec<ios::ComponentStatus>, String> {
    ios::check_itunes_components().await
}

#[tauri::command]
async fn open_itunes_download() -> Result<(), String> {
    ios::open_itunes_download().await
}

#[tauri::command]
async fn download_and_install_itunes(window: tauri::Window) -> Result<String, String> {
    ios::download_and_install_itunes(window).await
}

// Windows-specific Admin Check
#[cfg(target_os = "windows")]
pub(crate) fn is_admin() -> bool {
    use std::ptr;
    use winapi::um::processthreadsapi::{GetCurrentProcess, OpenProcessToken};
    use winapi::um::securitybaseapi::GetTokenInformation;
    use winapi::um::winnt::{TokenElevation, HANDLE, TOKEN_ELEVATION, TOKEN_QUERY};

    let mut handle: HANDLE = ptr::null_mut();
    unsafe {
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut handle) != 0 {
            let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
            let mut size = std::mem::size_of::<TOKEN_ELEVATION>() as u32;
            if GetTokenInformation(
                handle,
                TokenElevation,
                &mut elevation as *mut _ as *mut _,
                size,
                &mut size,
            ) != 0
            {
                let is_elevated = elevation.TokenIsElevated != 0;
                let _ = winapi::um::handleapi::CloseHandle(handle);
                return is_elevated;
            }
            let _ = winapi::um::handleapi::CloseHandle(handle);
        }
    }
    false
}

fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
        || std::env::var("TAURI_DEV").is_ok()
        || std::env::var("CARGO_MANIFEST_DIR").is_ok()
}

#[cfg(not(target_os = "windows"))]
fn is_admin() -> bool {
    true
}

#[cfg(target_os = "windows")]
fn manage_bypass_task() -> bool {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let exe_path = std::env::current_exe().unwrap();
    let task_name = "GeoShift_Bypass";
    let temp_dir = std::env::temp_dir();
    let env_file = temp_dir.join("geoshift_env.json");

    if !is_admin() {
            // Skip the Windows UAC/bypass flow during development or debug builds.
            if cfg!(debug_assertions) || std::env::var("TAURI_DEV").is_ok() {
                return false;
            }

        let mut env_map = HashMap::new();
        for (key, value) in std::env::vars() {
            if key.starts_with("TAURI") || key == "PATH" {
                env_map.insert(key, value);
            }
        }
        // Save current working directory
        if let Ok(cwd) = std::env::current_dir() {
            env_map.insert(
                "GEOSHIFT_PWD".to_string(),
                cwd.to_string_lossy().to_string(),
            );
        }

        if let Ok(json) = serde_json::to_string(&env_map) {
            let _ = std::fs::write(&env_file, json);
        }

        // --- 2. LAUNCH: Try to run the bypass task ---
        let status = Command::new("schtasks")
            .args(&["/run", "/tn", task_name])
            .creation_flags(CREATE_NO_WINDOW)
            .status();

        if let Ok(s) = status {
            if s.success() {
                // --- 3. WAIT: Stay alive so tauri dev doesn't think we're dead ---
                std::thread::sleep(std::time::Duration::from_secs(2)); // Wait for startup
                loop {
                    let check = Command::new("tasklist")
                        .args(&["/FI", "IMAGENAME eq geoshift.exe", "/NH"])
                        .creation_flags(CREATE_NO_WINDOW)
                        .output();

                    if let Ok(output) = check {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        let count = stdout.matches("geoshift.exe").count();
                        if count <= 1 {
                            break;
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
                return true;
            }
        }
        false
    } else {
        // --- ADMIN SIDE: Load Tauri Env and CWD from Temp File ---
        if env_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&env_file) {
                if let Ok(env_map) = serde_json::from_str::<HashMap<String, String>>(&content) {
                    // Restore PWD first
                    if let Some(pwd) = env_map.get("GEOSHIFT_PWD") {
                        let _ = std::env::set_current_dir(pwd);
                    }
                    // Restore env vars
                    for (key, value) in env_map {
                        if key != "GEOSHIFT_PWD" {
                            std::env::set_var(key, value);
                        }
                    }
                }
            }
            let _ = std::fs::remove_file(&env_file);
        }

        // Ensure bypass task is registered
        let _ = Command::new("schtasks")
            .args(&[
                "/create",
                "/f",
                "/tn",
                task_name,
                "/tr",
                &format!("\"{}\"", exe_path.to_str().unwrap()),
                "/sc",
                "once",
                "/st",
                "00:00",
                "/rl",
                "highest",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
        false
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows'ta yetki kontrolü ve Akıllı Bypass
    #[cfg(target_os = "windows")]
    {
        if manage_bypass_task() {
            std::process::exit(0);
        }

        if !is_admin() && !is_dev_mode() {
            // ... (Standard UAC fallback)
            use std::os::windows::ffi::OsStrExt;
            let exe = std::env::current_exe().unwrap();
            let exe_path: Vec<u16> = exe
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let runas: Vec<u16> = "runas\0".encode_utf16().collect();

            unsafe {
                winapi::um::shellapi::ShellExecuteW(
                    std::ptr::null_mut(),
                    runas.as_ptr(),
                    exe_path.as_ptr(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    winapi::um::winuser::SW_SHOWNORMAL,
                );
            }
            std::process::exit(0);
        }
    }

    tauri::Builder::default()
        .manage(LocationState::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await; // Faster heartbeat (1s)
                    let state = handle.state::<LocationState>();
                    let active_info = {
                        let lock = state.active_udid.lock().unwrap();
                        lock.clone()
                    };

                    if let Some((os, udid)) = active_info {
                        let is_connected = if os == "ios" {
                            ios::is_ios_device_connected(&udid).await
                        } else {
                            adb::is_android_device_connected(&udid).await
                        };

                        if !is_connected {
                            // Fast double-check
                            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                            let still_lost = if os == "ios" {
                                !ios::is_ios_device_connected(&udid).await
                            } else {
                                !adb::is_android_device_connected(&udid).await
                            };

                            if still_lost {
                                let _ = handle.emit("device-lost", udid.clone());
                                {
                                    let mut lock = state.active_udid.lock().unwrap();
                                    *lock = None;
                                }
                                state.cleanup();
                            }
                        }
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<LocationState>();
                state.cleanup();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_android_devices,
            get_ios_devices,
            set_location,
            clear_location,
            check_android_developer_mode,
            check_ios_developer_mode,
            enable_ios_developer_mode,
            silence_android_notifications,
            repair_apple_services,
            check_itunes_components,
            open_itunes_download,
            download_and_install_itunes,
            check_device_health,
            stop_all_simulations,
            ensure_android_helper,
            open_android_developer_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
