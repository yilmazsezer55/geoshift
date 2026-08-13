import json
from pymobiledevice3.usbmux import list_devices
from pymobiledevice3.lockdown import create_using_usbmux

def main():
    devices = list_devices()
    if not devices:
        print("No devices found")
        return
        
    device = devices[0]
    try:
        lockdown = create_using_usbmux(serial=device.serial)
        root = lockdown.all_values
        print("--- ROOT VALUES ---")
        print(f"ProductVersion: {root.get('ProductVersion')}")
        print(f"DeviceName: {root.get('DeviceName')}")
        print(f"DeveloperModeStatus (Root): {root.get('DeveloperModeStatus')}")
        
        print("\n--- DEV DOMAIN VALUES ---")
        try:
            dev = lockdown.get_value("com.apple.xcode.developerdomain", "DeveloperModeStatus")
            print(f"DeveloperModeStatus (Dev Domain): {dev}")
        except Exception as e:
            print(f"Dev Domain Error: {e}")
            
    except Exception as e:
        print(f"Lockdown Error: {e}")

if __name__ == "__main__":
    main()
