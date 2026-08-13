import os
import urllib.request
import ssl
from pathlib import Path

def download_helper():
    # Reliable URL discovered via testing (v8.0.5)
    url = "https://github.com/appium/io.appium.settings/releases/download/v8.0.5/settings_apk-debug.apk"

    # Get project root
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent

    resources_dir = repo_root / "resources"
    if not resources_dir.exists():
        os.makedirs(resources_dir)

    target_path = resources_dir / "settings_apk-debug.apk"

    print(f"Downloading helper APK to {target_path}...")

    try:
        # Create unverified context to bypass SSL issues on some Windows environments
        context = ssl._create_unverified_context()

        # User agent to avoid some blocks
        opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context))
        opener.addheaders = [('User-agent', 'Mozilla/5.0')]
        urllib.request.install_opener(opener)

        urllib.request.urlretrieve(url, str(target_path))

        if target_path.exists() and target_path.stat().st_size > 100000: # APK should be > 100KB
            print("Download complete successfully.")
            return True
        else:
            print(f"Download failed: File size is too small ({target_path.stat().st_size if target_path.exists() else 0} bytes).")
            return False
    except Exception as e:
        print(f"Error downloading APK: {e}")
        return False

if __name__ == "__main__":
    download_helper()
