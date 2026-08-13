from pymobiledevice3.lockdown import create_using_usbmux, PairingError
from pymobiledevice3.usbmux import select_device
import json
import sys

def check_pairing_status():
    """Check if device is paired with this computer"""
    try:
        # Try to find device
        device = select_device()
        
        # Try to establish lockdown connection (requires pairing)
        try:
            lockdown = create_using_usbmux(serial=device.serial)
            
            # If we got here, device is paired
            return {
                "success": True,
                "paired": True,
                "device_name": lockdown.display_name,
                "device_udid": device.serial
            }
            
        except PairingError as e:
            # Device found but not paired/trusted
            return {
                "success": False,
                "paired": False,
                "error": "iPhone bu bilgisayara güvenmiyor. Lütfen iPhone'da 'Bu Bilgisayara Güven' seçeneğine dokunun.",
                "error_code": "NOT_PAIRED",
                "device_udid": device.serial
            }
            
    except Exception as e:
        # No device found at all
        return {
            "success": False,
            "paired": False,
            "error": f"iPhone bulunamadı. Kablo bağlantısını kontrol edin: {str(e)}",
            "error_code": "NO_DEVICE"
        }

if __name__ == "__main__":
    result = check_pairing_status()
    print(json.dumps(result, ensure_ascii=False))
