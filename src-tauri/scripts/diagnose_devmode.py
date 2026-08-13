import json
import sys
import time
import subprocess
from pymobiledevice3.usbmux import select_device
from pymobiledevice3.lockdown import create_using_usbmux

def diagnose_developer_mode():
    """Simple diagnosis via lockdown values"""
    try:
        from pymobiledevice3.usbmux import select_device
        from pymobiledevice3.lockdown import create_using_usbmux
        
        device = select_device()
        udid = device.serial
        lockdown = create_using_usbmux(serial=udid)
        
        # Try to get DeveloperModeStatus directly from lockdown values
        # This is non-blocking and very fast
        all_values = lockdown.all_values
        dev_mode = all_values.get('DeveloperModeStatus', False)
        
        return {
            "success": True,
            "developer_mode": dev_mode,
            "device_name": lockdown.display_name,
            "udid": udid,
            "method": "lockdown_values"
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

if __name__ == "__main__":
    result = diagnose_developer_mode()
    print(json.dumps(result, ensure_ascii=False))
