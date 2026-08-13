from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.usbmux import select_device
from pymobiledevice3.services.amfi import AmfiService
import json
import sys

def enable_developer_mode():
    try:
        # Try to find device
        device = select_device()
        
        # Try to establish lockdown connection
        lockdown = create_using_usbmux(serial=device.serial)
        
        # Enable developer mode
        amfi = AmfiService(lockdown=lockdown)
        
        # This call sets the developer mode to True. 
        # On iOS, this will trigger a request to the user to confirm 
        # and then the device will restart.
        result = amfi.enable_developer_mode(True)
        
        return {
            "success": True,
            "developer_mode_enabled": True,
            "requires_restart": True,
            "message": "Geliştirici modu etkinleştirildi. Cihaz yeniden başlatılacak. Yeniden başlatıldıktan sonra iPhone ekranında Geliştirici Modu'nu etkinleştirmeyi onaylayın."
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

if __name__ == "__main__":
    result = enable_developer_mode()
    print(json.dumps(result, ensure_ascii=False))
