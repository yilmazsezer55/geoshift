mod adb;
mod ios;

use adb::Device;
use ios::IosDevice;
use std::collections::{HashMap, HashSet};
use std::process::Child;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use futures_util::FutureExt;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct LocationPayload {
    pub lat: f64,
    pub lng: f64,
    pub speed: f64,
    pub bearing: f64,
    pub altitude: f64,
}

pub struct LocationState {
    pub active_ios_processes: Mutex<HashMap<String, Child>>,
    pub tunneld_process: Mutex<Option<Child>>,
    pub active_udid: Mutex<Option<(String, String)>>,
    pub helper_checked_android: Mutex<HashSet<String>>,
    pub pending_locations: Mutex<HashMap<String, LocationPayload>>,
    pub active_workers: Mutex<HashSet<String>>,
}

impl Default for LocationState {
    fn default() -> Self {
        Self {
            active_ios_processes: Mutex::new(HashMap::new()),
            tunneld_process: Mutex::new(None),
            active_udid: Mutex::new(None),
            helper_checked_android: Mutex::new(HashSet::new()),
            pending_locations: Mutex::new(HashMap::new()),
            active_workers: Mutex::new(HashSet::new()),
        }
    }
}

impl LocationState {
    pub fn cleanup(&self) {
        let mut processes = self.active_ios_processes.lock().unwrap();
        for (_, mut child) in processes.drain() {
            let _ = child.kill();
        }
        let mut tunneld = self.tunneld_process.lock().unwrap();
        if let Some(mut child) = tunneld.take() {
            let _ = child.kill();
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(&["/F", "/IM", "python.exe", "/T"])
                .creation_flags(0x08000000)
                .spawn();
        }
    }
}

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
            if GetTokenInformation(handle, TokenElevation, &mut elevation as *mut _ as *mut _, size, &mut size) != 0 {
                let is_elevated = elevation.TokenIsElevated != 0;
                let _ = winapi::um::handleapi::CloseHandle(handle);
                return is_elevated;
            }
            let _ = winapi::um::handleapi::CloseHandle(handle);
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn is_admin() -> bool { true }

fn is_dev_mode() -> bool {
    cfg!(debug_assertions) || std::env::var("TAURI_DEV").is_ok() || std::env::var("CARGO_MANIFEST_DIR").is_ok()
}

#[tauri::command]
async fn get_android_devices(state: tauri::State<'_, LocationState>) -> Result<Vec<Device>, String> {
    let devices = adb::list_devices().await?;
    {
        let mut checked = state.helper_checked_android.lock().unwrap();
        for d in devices.iter() {
            if d.connection_mode == "usb" && !checked.contains(&d.id) {
                checked.insert(d.id.clone());
                let dev_id = d.id.clone();
                tauri::async_runtime::spawn(async move { let _ = adb::ensure_helper_app(&dev_id).await; });
            }
        }
    }
    Ok(devices)
}

#[tauri::command]
async fn get_ios_devices() -> Result<Vec<IosDevice>, String> { ios::list_ios_devices().await }

#[tauri::command]
async fn check_device_health(os: String, udid: String, require_usb: bool) -> bool {
    if os == "ios" {
        if require_usb { return ios::is_ios_usb_connected_hardware(&udid); }
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
    speed: f64,
    bearing: f64,
    altitude: f64,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let state = app_handle.state::<LocationState>();
    {
        let mut pending = state.pending_locations.lock().unwrap();
        pending.insert(udid.clone(), LocationPayload { lat, lng, speed, bearing, altitude });
    }
    let mut workers = state.active_workers.lock().unwrap();
    if !workers.contains(&udid) {
        workers.insert(udid.clone());
        let udid_worker = udid.clone();
        let os_worker = os.clone();
        let handle_worker = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let state_handle = handle_worker.state::<LocationState>();
                let payload = {
                    let mut pending = state_handle.pending_locations.lock().unwrap();
                    pending.remove(&udid_worker)
                };
                if let Some(p) = payload {
                    if os_worker == "ios" {
                        let _ = ios::set_ios_location(&udid_worker, p.lat, p.lng, &state_handle).await;
                    } else {
                        let _ = adb::set_mock_location(&udid_worker, p.lat, p.lng, p.speed, p.bearing, p.altitude).await;
                    }
                } else {
                    let mut workers_lock = state_handle.active_workers.lock().unwrap();
                    workers_lock.remove(&udid_worker);
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        });
    }
    {
        let mut active = state.active_udid.lock().unwrap();
        *active = Some((os, udid));
    }
    Ok("Location queued".to_string())
}

#[tauri::command]
async fn clear_location(os: String, udid: String, state: tauri::State<'_, LocationState>) -> Result<String, String> {
    if os == "ios" {
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
    Ok("Stopped".to_string())
}

#[tauri::command]
async fn wake_up_android(device_id: String) -> Result<(), String> { adb::wake_up_helper(&device_id).await }

#[tauri::command]
async fn silence_android_notifications(device_id: String) -> Result<String, String> { adb::silence_notifications(&device_id).await }

#[tauri::command]
async fn check_android_developer_mode(device_id: String) -> Result<bool, String> { adb::check_developer_mode(&device_id).await }

#[tauri::command]
async fn ensure_android_helper(device_id: String) -> Result<bool, String> {
    match std::panic::AssertUnwindSafe(async { adb::ensure_helper_app(&device_id).await }).catch_unwind().await {
        Ok(inner) => inner,
        Err(_) => Err("ensure_android_helper panicked".to_string()),
    }
}

#[tauri::command]
async fn open_android_developer_settings(device_id: String) -> Result<(), String> { adb::open_developer_settings(&device_id).await }

#[tauri::command]
async fn check_ios_developer_mode(udid: String) -> Result<ios::DevModeResult, String> { ios::check_ios_developer_mode(&udid).await }

#[tauri::command]
async fn enable_ios_developer_mode(udid: String) -> Result<String, String> { ios::enable_ios_developer_mode(&udid).await }

#[tauri::command]
async fn repair_apple_services() -> Result<String, String> { ios::repair_apple_services().await }

#[tauri::command]
async fn check_itunes_components() -> Result<Vec<ios::ComponentStatus>, String> { ios::check_itunes_components().await }

#[tauri::command]
async fn open_itunes_download() -> Result<(), String> { ios::open_itunes_download().await }

#[tauri::command]
async fn download_and_install_itunes(window: tauri::Window) -> Result<String, String> { ios::download_and_install_itunes(window).await }

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
        if is_dev_mode() { return false; }
        let mut env_map = HashMap::new();
        for (key, value) in std::env::vars() { if key.starts_with("TAURI") || key == "PATH" { env_map.insert(key, value); } }
        if let Ok(cwd) = std::env::current_dir() { env_map.insert("GEOSHIFT_PWD".to_string(), cwd.to_string_lossy().to_string()); }
        if let Ok(json) = serde_json::to_string(&env_map) { let _ = std::fs::write(&env_file, json); }
        let status = Command::new("schtasks").args(&["/run", "/tn", task_name]).creation_flags(CREATE_NO_WINDOW).status();
        if let Ok(s) = status {
            if s.success() {
                std::thread::sleep(std::time::Duration::from_secs(2));
                loop {
                    let check = Command::new("tasklist").args(&["/FI", "IMAGENAME eq geoshift.exe", "/NH"]).creation_flags(CREATE_NO_WINDOW).output();
                    if let Ok(output) = check {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        if stdout.matches("geoshift.exe").count() <= 1 { break; }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
                return true;
            }
        }
        false
    } else {
        if env_file.exists() {
            if let Ok(content) = std::fs::read_to_string(&env_file) {
                if let Ok(env_map) = serde_json::from_str::<HashMap<String, String>>(&content) {
                    if let Some(pwd) = env_map.get("GEOSHIFT_PWD") { let _ = std::env::set_current_dir(pwd); }
                    for (key, value) in env_map { if key != "GEOSHIFT_PWD" { std::env::set_var(key, value); } }
                }
            }
            let _ = std::fs::remove_file(&env_file);
        }
        let _ = Command::new("schtasks").args(&["/create", "/f", "/tn", task_name, "/tr", &format!("\"{}\"", exe_path.to_str().unwrap()), "/sc", "once", "/st", "00:00", "/rl", "highest"]).creation_flags(CREATE_NO_WINDOW).status();
        false
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    {
        if manage_bypass_task() { std::process::exit(0); }
        if !is_admin() && !is_dev_mode() {
            use std::os::windows::ffi::OsStrExt;
            let exe = std::env::current_exe().unwrap();
            let exe_path: Vec<u16> = exe.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
            let runas: Vec<u16> = "runas\0".encode_utf16().collect();
            unsafe { winapi::um::shellapi::ShellExecuteW(std::ptr::null_mut(), runas.as_ptr(), exe_path.as_ptr(), std::ptr::null_mut(), std::ptr::null_mut(), winapi::um::winuser::SW_SHOWNORMAL); }
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
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    let state = handle.state::<LocationState>();
                    let active_info = { let lock = state.active_udid.lock().unwrap(); lock.clone() };
                    if let Some((os, udid)) = active_info {
                        let is_connected = if os == "ios" { ios::is_ios_device_connected(&udid).await } else { adb::is_android_device_connected(&udid).await };
                        if !is_connected {
                            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                            let still_lost = if os == "ios" { !ios::is_ios_device_connected(&udid).await } else { !adb::is_android_device_connected(&udid).await };
                            if still_lost {
                                let _ = handle.emit("device-lost", udid.clone());
                                { let mut lock = state.active_udid.lock().unwrap(); *lock = None; }
                                state.cleanup();
                            }
                        }
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| { if let tauri::WindowEvent::CloseRequested { .. } = event { let state = window.state::<LocationState>(); state.cleanup(); } })
        .invoke_handler(tauri::generate_handler![
            get_android_devices, get_ios_devices, set_location, clear_location,
            check_android_developer_mode, check_ios_developer_mode, enable_ios_developer_mode,
            silence_android_notifications, repair_apple_services, check_itunes_components,
            open_itunes_download, download_and_install_itunes, check_device_health,
            stop_all_simulations, ensure_android_helper, open_android_developer_settings, wake_up_android,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
