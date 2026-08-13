import sys
import json
import subprocess
import re
import os
import asyncio
import signal
import time
from pathlib import Path

# Force UTF-8 encoding for stdout
if sys.version_info >= (3, 7):
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Handle silent subprocess execution on Windows
STARTUPINFO = None
if os.name == 'nt':
    STARTUPINFO = subprocess.STARTUPINFO()
    STARTUPINFO.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    STARTUPINFO.wShowWindow = subprocess.SW_HIDE

# Set up simple logging for debugging
LOG_FILE = "discovery_debug.log"

def log_debug(msg):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"{msg}\n")
    except:
        pass

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = None
for parent in [SCRIPT_DIR] + list(SCRIPT_DIR.parents):
    if (parent / ".venv").exists():
        REPO_ROOT = parent
        break
if REPO_ROOT is None:
    REPO_ROOT = SCRIPT_DIR.parents[2] if len(SCRIPT_DIR.parents) >= 3 else SCRIPT_DIR

VENV_PYTHON_WINDOWS = REPO_ROOT / ".venv" / "Scripts" / "python.exe"
VENV_PYTHON_UNIX = REPO_ROOT / ".venv" / "bin" / "python"
VENV_PYTHON = None
if VENV_PYTHON_WINDOWS.exists():
    VENV_PYTHON = str(VENV_PYTHON_WINDOWS)
elif VENV_PYTHON_UNIX.exists():
    VENV_PYTHON = str(VENV_PYTHON_UNIX)

try:
    from pymobiledevice3.usbmux import list_devices
    from pymobiledevice3.lockdown import create_using_usbmux
    pymobiledevice3_available = True
except ImportError:
    pymobiledevice3_available = False
except Exception:
    pymobiledevice3_available = False

def discover_ios():
    if not pymobiledevice3_available:
        return []
    
    devices = []
    try:
        mux_devices = list_devices()
        for mux_device in mux_devices:
            udid = mux_device.serial
            conn_type = "usb" if mux_device.connection_type == "USB" else "wifi"
            
            device_info = {
                "id": udid,
                "os": "ios",
                "connection": conn_type,
                "name": "Apple iPhone",
                "model": "iPhone"
            }
            
            try:
                lockdown = create_using_usbmux(serial=udid)
                name = lockdown.get_value(key="DeviceName")
                model = lockdown.get_value(key="ProductType")
                if name: device_info["name"] = name
                if model: device_info["model"] = model
            except Exception as e:
                log_debug(f"Lockdown failed for {udid}: {e}")
                device_info["name"] = f"iPhone ({udid[:8]})"
                
            devices.append(device_info)
    except Exception as e:
        log_debug(f"discover_ios exception: {e}")
    return devices

def discover_android():
    """Discover Android devices merging Windows MTP results and ADB authority."""
    canonical_devices = {}
    adb_data = {}
    
    def clean_val(s):
        if not s: return ""
        return s.strip()

    # 1. ADB Scan (Authority)
    try:
        adb_exec = "adb"
        try:
            subprocess.check_output([adb_exec, "version"], stderr=subprocess.DEVNULL, startupinfo=STARTUPINFO)
        except:
            potential_paths = [
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk", "platform-tools", "adb.exe"),
                "C:\\Android\\platform-tools\\adb.exe"
            ]
            for p in potential_paths:
                if os.path.exists(p):
                    adb_exec = p
                    break

        adb_out = subprocess.check_output([adb_exec, "devices", "-l"], stderr=subprocess.STDOUT, startupinfo=STARTUPINFO).decode('utf-8', errors='ignore')
        lines = adb_out.strip().split('\n')[1:]
        
        for line in lines:
            if not line.strip(): continue
            parts = re.split(r'\s+', line.strip())
            if not parts: continue
            
            serial = parts[0]
            status = "Device"
            if "unauthorized" in line.lower(): status = "Unauthorized"
            elif "offline" in line.lower(): status = "Offline"
            
            model = "Android"
            m = re.search(r'model:([^\s]+)', line)
            if m: model = m.group(1).replace('_', ' ')
            
            name = model
            try:
                n_out = subprocess.check_output([adb_exec, "-s", serial, "shell", "settings", "get", "global", "device_name"], timeout=1, startupinfo=STARTUPINFO).decode('utf-8', errors='ignore').strip()
                if n_out and n_out != "null": name = n_out
            except: pass
            
            adb_data[serial.upper()] = {
                "id": serial,
                "os": "android",
                "connection": "wifi" if ":" in serial else "usb",
                "name": clean_val(name),
                "model": clean_val(model),
                "status": status,
                "serial": serial
            }
    except Exception as e:
        log_debug(f"ADB Scan Error: {e}")

    # 2. Windows WPD/MTP Scan
    if os.name == 'nt':
        try:
            cmd = ["wmic", "path", "Win32_PnPEntity", "where", "PNPClass='WPD' or PNPClass='PortableDevices'", "get", "Caption,PNPDeviceID,ContainerId", "/format:csv"]
            out_bytes = subprocess.check_output(cmd, startupinfo=STARTUPINFO, stderr=subprocess.DEVNULL)
            
            content = ""
            for enc in ['utf-16', 'utf-8', 'cp1254', 'latin-1']:
                try:
                    content = out_bytes.decode(enc)
                    if "PNPDeviceID" in content: break
                except: continue
            
            if content:
                for line in content.strip().split('\n'):
                    line = line.strip()
                    if not line or "PNPDeviceID" in line: continue
                    parts = line.split(',')
                    if len(parts) < 4: continue
                    
                    caption = clean_val(parts[1])
                    container_id = clean_val(parts[2]).strip('{}').upper()
                    pnp_id = clean_val(parts[3])
                    
                    if any(x in caption.lower() for x in ["apple", "iphone", "ipad", "ipod", "microphone", "speakers", "audio", "array", "drive"]):
                        continue

                    serial_part = pnp_id.split('\\')[-1].upper()
                    serial_hint = serial_part.split('&')[0]
                    
                    matched_serial = None
                    if serial_hint in adb_data:
                        matched_serial = serial_hint
                    else:
                        for s in adb_data.keys():
                            if s in pnp_id.upper():
                                matched_serial = s
                                break
                    
                    if not matched_serial:
                        for s, dev in adb_data.items():
                            if dev['name'].lower() == caption.lower():
                                matched_serial = s
                                break

                    if not matched_serial:
                        canonical_devices[container_id or serial_hint or caption] = {
                            "id": f"usb-wpd-{serial_hint or caption}",
                            "os": "android",
                            "connection": "usb",
                            "name": caption,
                            "model": "Geliştirici Modu Kapalı",
                            "status": "Missing",
                            "serial": serial_hint,
                            "container_id": container_id
                        }
        except Exception as e:
            log_debug(f"Windows WPD Error: {e}")

    for serial, info in adb_data.items():
        canonical_devices[serial] = info

    return list(canonical_devices.values())

def get_active_ios_udid():
    if not pymobiledevice3_available: return None
    try:
        python_exe = VENV_PYTHON if VENV_PYTHON and os.path.exists(VENV_PYTHON) else sys.executable
        cmd = [python_exe, "-m", "pymobiledevice3", "usbmux", "list"]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10, startupinfo=STARTUPINFO)
        if result.returncode != 0: return None
        output = result.stdout.strip()
        if output:
            try:
                parsed = json.loads(output)
                entries = parsed.get("Devices") or parsed.get("devices") or parsed.get("usbmux") or []
                for item in entries:
                    if isinstance(item, dict):
                        serial = item.get("serial") or item.get("udid") or item.get("UDID")
                        if serial: return serial
            except: pass
            match = re.search(r"([0-9A-Fa-f]{40}|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})", output)
            if match: return match.group(1)
    except: pass
    return None

def check_ios_developer_mode(udid):
    if not pymobiledevice3_available: return {"success": False, "enabled": False}
    if not udid: udid = get_active_ios_udid() or ""
    if not udid: return {"success": False, "enabled": False}
    ios_version = "17.0"
    try:
        from pymobiledevice3.lockdown import create_using_usbmux
        lockdown = create_using_usbmux(serial=udid)
        ios_version = lockdown.get_value(None, "ProductVersion")
    except: pass
    try:
        python_exe = VENV_PYTHON if VENV_PYTHON else sys.executable
        cmd = [python_exe, "-m", "pymobiledevice3", "amfi", "developer-mode-status", "--udid", udid]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10, startupinfo=STARTUPINFO)
        if result.returncode == 0:
            is_enabled = result.stdout.strip().lower() == "true"
            return {"success": True, "enabled": is_enabled, "ios_version": ios_version}
    except: pass
    return {"success": False, "enabled": False, "ios_version": ios_version}

def get_rsd_for_device(udid, timeout_sec=6):
    import urllib.request
    target_udid = udid.replace("-", "").lower() if udid else ""
    start = time.time()
    while time.time() - start < timeout_sec:
        try:
            with urllib.request.urlopen("http://127.0.0.1:49151/", timeout=0.5) as response:
                data = json.loads(response.read().decode())
                if isinstance(data, dict):
                    for dev_udid, tunnels in data.items():
                        clean_key = str(dev_udid).replace("-", "").lower()
                        if clean_key == target_udid or target_udid == "":
                            if tunnels and isinstance(tunnels, list) and len(tunnels) > 0:
                                t = tunnels[0]
                                addr = t.get("tunnel-address") or t.get("hostname") or t.get("host") or "127.0.0.1"
                                port = t.get("tunnel-port") or t.get("port")
                                if addr and port:
                                    return addr, port
        except: pass
        time.sleep(0.15)
    return None, None

def persistent_set_location(udid, latitude, longitude, interval_seconds=3):
    stop_requested = {"flag": False}
    current_coords = {"lat": latitude, "lon": longitude}

    async def _stdin_watcher(loc_sim):
        while not stop_requested["flag"]:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line: break
            line = line.strip()
            if not line: continue
            if line.upper() == "STOP": 
                stop_requested["flag"] = True
                break
            parts = [p.strip() for p in line.split(",") if p.strip()]
            if len(parts) == 2:
                try:
                    current_coords["lat"] = float(parts[0])
                    current_coords["lon"] = float(parts[1])
                    loc_sim.set(current_coords["lat"], current_coords["lon"])
                except: pass

    async def _run_persistent_connection():
        from pymobiledevice3.services.dvt.dvt_secure_socket_proxy import DvtSecureSocketProxyService
        from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation

        rsd_addr, rsd_port = get_rsd_for_device(udid, timeout_sec=8)
        if rsd_addr and rsd_port:
            from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
            async with RemoteServiceDiscoveryService((rsd_addr, rsd_port)) as rsd:
                with DvtSecureSocketProxyService(lockdown=rsd) as dvt:
                    loc_sim = LocationSimulation(dvt)
                    loc_sim.set(current_coords["lat"], current_coords["lon"])
                    print(json.dumps({"success": True, "message": "Persistent location process starting."}, ensure_ascii=False))
                    sys.stdout.flush()
                    watcher = asyncio.create_task(_stdin_watcher(loc_sim))
                    while not stop_requested["flag"]:
                        await asyncio.sleep(interval_seconds)
                        try: loc_sim.set(current_coords["lat"], current_coords["lon"])
                        except: break
                    watcher.cancel()
        else:
            from pymobiledevice3.lockdown import create_using_usbmux
            try:
                lockdown = create_using_usbmux(udid)
                with DvtSecureSocketProxyService(lockdown=lockdown) as dvt:
                    loc_sim = LocationSimulation(dvt)
                    loc_sim.set(current_coords["lat"], current_coords["lon"])
                    print(json.dumps({"success": True, "message": "Persistent location process starting."}, ensure_ascii=False))
                    sys.stdout.flush()
                    watcher = asyncio.create_task(_stdin_watcher(loc_sim))
                    while not stop_requested["flag"]:
                        await asyncio.sleep(interval_seconds)
                        try: loc_sim.set(current_coords["lat"], current_coords["lon"])
                        except: break
                    watcher.cancel()
            except Exception as e:
                print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
                sys.stdout.flush()

    try: asyncio.run(_run_persistent_connection())
    except: pass

def clear_ios_location(udid):
    python_exe = VENV_PYTHON if VENV_PYTHON and os.path.exists(VENV_PYTHON) else sys.executable
    rsd_addr, rsd_port = get_rsd_for_device(udid)
    if rsd_addr and rsd_port:
        cmd = [python_exe, "-m", "pymobiledevice3", "developer", "dvt", "simulate-location", "clear", "--rsd", rsd_addr, str(rsd_port)]
    else:
        cmd = [python_exe, "-m", "pymobiledevice3", "developer", "dvt", "simulate-location", "clear", "--udid", udid]
    subprocess.run(cmd, capture_output=True, text=True, timeout=10, startupinfo=STARTUPINFO)
    return {"success": True, "message": "Konum sıfırlandı."}

def main():
    if len(sys.argv) > 1:
        command = sys.argv[1]
        if command == "check_developer_mode" and len(sys.argv) > 2:
            print(json.dumps(check_ios_developer_mode(sys.argv[2]), ensure_ascii=False))
            return
        elif command == "persistent_set_location" and len(sys.argv) > 4:
            persistent_set_location(sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5]) if len(sys.argv) > 5 else 3)
            return
        elif command == "clear_location" and len(sys.argv) > 2:
            print(json.dumps(clear_ios_location(sys.argv[2]), ensure_ascii=False))
            return
    
    # Discovery
    ios_devs = discover_ios()
    android_devs = discover_android()
    print("---JSON_START---")
    print(json.dumps({"devices": ios_devs + android_devs}, indent=2, ensure_ascii=False))
    print("---JSON_END---")

if __name__ == "__main__":
    main()
