from pymobiledevice3.usbmux import select_device
from pymobiledevice3.services.dvt.dvt_secure_socket_proxy import DvtSecureSocketProxyService
from pymobiledevice3.services.dvt.instruments.location_simulation import LocationSimulation
from pymobiledevice3.lockdown import create_using_usbmux
import json
import sys

def test_location(lat, lon):
    try:
        device = select_device()
        udid = device.serial
        print(f"DEBUG: Using device {udid}", file=sys.stderr)
        
        lockdown = create_using_usbmux(serial=udid)
        
        # In 7.5.0 for iOS 17+, we use DvtSecureSocketProxyService
        try:
            print(f"DEBUG: Attempting DVT method (iOS 17+)...", file=sys.stderr)
            with DvtSecureSocketProxyService(lockdown=lockdown) as dvt:
                sim = LocationSimulation(dvt)
                sim.set(lat, lon)
                return {"success": True, "message": f"Location set to {lat}, {lon} via DVT"}
        except Exception as dvt_err:
            print(f"DEBUG: DVT method failed: {dvt_err}", file=sys.stderr)
            
            # Fallback to legacy (iOS < 17)
            try:
                print(f"DEBUG: Attempting Legacy method (iOS < 17)...", file=sys.stderr)
                from pymobiledevice3.services.simulate_location import DtSimulateLocation
                sim = DtSimulateLocation(lockdown=lockdown)
                sim.set(lat, lon)
                return {"success": True, "message": f"Location set to {lat}, {lon} via Legacy"}
            except Exception as legacy_err:
                return {"success": False, "error": f"DVT: {dvt_err}, Legacy: {legacy_err}"}

    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    result = test_location(41.0082, 28.9784)
    print(json.dumps(result, ensure_ascii=False))
