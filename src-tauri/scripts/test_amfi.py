import sys
from pymobiledevice3.usbmux import list_devices
from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.amfi import AmfiService

def main():
    devices = list_devices()
    if not devices:
        print("No devices found")
        return
        
    device = devices[0]
    try:
        lockdown = create_using_usbmux(serial=device.serial)
        amfi = AmfiService(lockdown)
        # Check if developer mode is enabled via AMFI
        print(f"AMFI Developer Mode Enabled: {amfi.is_developer_mode_enabled}")
    except Exception as e:
        print(f"AMFI Error: {e}")

if __name__ == "__main__":
    main()
