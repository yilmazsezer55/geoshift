import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './index.css';
import 'leaflet/dist/leaflet.css';
import MapComponent from './components/Map';
import DeviceManager from './components/DeviceManager';
import LocationControls from './components/LocationControls';
import Splash from './components/Splash';
import IOSConnectionWizard from './components/IOSConnectionWizard';
import AndroidConnectionWizard from './components/AndroidConnectionWizard';
import LegalDisclaimer from './components/LegalDisclaimer';
import logo from './assets/logo.png';
import {
  ChevronLeft,
  ChevronRight,
  User,
  Settings,
  Minus,
  Square,
  X,
  CheckCircle2,
  AlertCircle,
  Info
} from 'lucide-react';

interface Device {
  id: string;
  name: string;
  model: string;
  status: string;
  os: 'android' | 'ios';
  connectionMode: 'usb' | 'wifi';
  availableModes?: ('usb' | 'wifi')[];
  isPaired?: boolean;
  usbId?: string; // Original USB ID for pairing tracking (Android: serial, iOS: UDID)
  developerModeEnabled?: boolean; // iOS only
  developerModeChecked?: boolean; // iOS only
}

interface Location {
  latitude: number;
  longitude: number;
}

// Distance calculation (Haversine formula) in kilometers
function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Estimate cooldown in minutes based on distance (Table based on Pokémon GO standards)
function getCooldownMinutes(distanceKm: number) {
  if (distanceKm < 0.1) return 0;
  if (distanceKm < 2) return 1;
  if (distanceKm < 5) return 2;
  if (distanceKm < 10) return 7;
  if (distanceKm < 25) return 11;
  if (distanceKm < 100) return 35;
  if (distanceKm < 250) return 45;
  if (distanceKm < 500) return 60;
  if (distanceKm < 1000) return 90;
  return 120; // Max cooldown
}

// Custom Titlebar Component (Checklist Optimized)
const CustomTitlebar = ({ setMessage }: { setMessage: (msg: any) => void }) => {
  const appWindow = getCurrentWindow();

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  return (
    <div className="custom-titlebar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <img src={logo} alt="GeoShift" style={{ width: '32px', height: '32px' }} />
        <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0f172a', letterSpacing: '-0.02em' }}>GeoShift</span>
      </div>

      <div className="titlebar-controls">
        <button className="titlebar-btn" title="Kullanıcı" onClick={() => setMessage({ type: 'info', text: 'Profil yakında!' })}><User size={18} /></button>
        <button className="titlebar-btn" title="Ayarlar" onClick={() => setMessage({ type: 'info', text: 'Ayarlar yakında!' })}><Settings size={18} /></button>
        <div style={{ width: '1px', height: '24px', background: '#e2e8f0', margin: '0 8px' }} />
        <button className="titlebar-btn" onClick={handleMinimize}><Minus size={18} /></button>
        <button className="titlebar-btn" onClick={handleMaximize}><Square size={14} /></button>
        <button className="titlebar-btn close" onClick={handleClose}><X size={18} /></button>
      </div>
    </div>
  );
};

function App() {
  // State for all devices
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [disabledAutoConnectDevices, setDisabledAutoConnectDevices] = useState<Set<string>>(new Set());
  const manualDisconnectRef = useRef(false);
  const autoConnectPendingRef = useRef<Set<string>>(new Set());
  const locationChangeInProgressRef = useRef(false);

  // Track devices that have been successfully paired via USB (persisted in localStorage)
  const [usbPairedDevices, setUsbPairedDevices] = useState<Set<string>>(() => {
    const stored = localStorage.getItem('usbPairedDevices');
    return stored ? new Set(JSON.parse(stored)) : new Set();
  });

  // Active Mode ('teleport', 'joystick', 'route')
  const [mode, setMode] = useState<'teleport' | 'joystick' | 'route'>('teleport');

  // Point A and B selection
  const [startLocation, setStartLocation] = useState<Location | null>(null);
  const [startAddress, setStartAddress] = useState<string>('');
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null); // This is Point B
  const [selectedAddress, setSelectedAddress] = useState<string>('');

  const [currentLocation, setCurrentLocation] = useState<Location | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [mapRotation, setMapRotation] = useState(0);

  // Cooldown State
  const [cooldownTime, setCooldownTime] = useState(0); // in seconds

  // Selection Mode ('start', 'end', or 'none')
  const [selectionMode, setSelectionMode] = useState<'start' | 'end' | 'none'>('none');

  // Device Panel & Notification States
  const [showDevicePanel, setShowDevicePanel] = useState(false);
  const [hasNewDeviceNotification, setHasNewDeviceNotification] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showIOSWizard, setShowIOSWizard] = useState(false);
  const [showAndroidWizard, setShowAndroidWizard] = useState(false);
  const [wizardDevice, setWizardDevice] = useState<Device | null>(null);
  const [initialWizardStep, setInitialWizardStep] = useState<string | undefined>(undefined);

  const [hasAcceptedDisclaimer, setHasAcceptedDisclaimer] = useState<boolean>(() => {
    return localStorage.getItem('geoshift_disclaimer_accepted') === 'true';
  });

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    if (showSplash) {
      root.classList.add('app-splash-active');
    } else {
      root.classList.remove('app-splash-active');
    }
    return () => root.classList.remove('app-splash-active');
  }, [showSplash]);

  const openWizard = (device: Device, stepId?: string) => {
    setWizardDevice(device);
    setInitialWizardStep(stepId);
    setShowIOSWizard(true);
  };

  // Deduplicate devices by ID (UDID/Serial) to ensure clean UI, prioritizing USB connection if both exist
  const uniqueDevices = Array.from(devices.reduce((acc, dev) => {
    const existing = acc.get(dev.id);
    if (!existing || (dev.connectionMode === 'usb' && existing.connectionMode !== 'usb')) {
      acc.set(dev.id, dev);
    }
    return acc;
  }, new Map<string, Device>()).values());

  // Reset rotation when switching to Teleport or Route modes to fix click accuracy
  useEffect(() => {
    if (mode !== 'joystick') {
      setMapRotation(0);
    }
  }, [mode]);

  // Reverse Geocoding Helper
  const fetchAddress = async (loc: Location): Promise<string> => {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.latitude}&lon=${loc.longitude}&zoom=18&addressdetails=1`);
      const data = await response.json();
      // Try to get a short name: road + house_number or just suburb/city
      const addr = data.address;
      if (addr) {
        const parts = [];
        if (addr.road) parts.push(addr.road);
        if (addr.house_number) parts.push(addr.house_number);
        if (parts.length === 0 && addr.suburb) parts.push(addr.suburb);
        if (parts.length === 0 && addr.city) parts.push(addr.city);

        return parts.join(' ') || data.display_name.split(',')[0];
      }
      return data.display_name.split(',')[0] || "Bilinmeyen Adres";
    } catch (e) {
      console.error("Reverse geocode failed", e);
      return "Adres alınamadı";
    }
  };

  // Handle Map Clicks for A/B Point selection
  const handleLocationSelect = async (loc: Location | null, mode_param?: 'start' | 'end', addr?: string) => {
    if (!loc) {
      setSelectedLocation(null);
      setSelectedAddress('');
      return;
    }

    // If we're not in route mode, we only care about Point B (selectedLocation)
    if (mode !== 'route') {
      setSelectedLocation(loc);
      setSelectionMode('none');
      if (addr) setSelectedAddress(addr);
      else {
        setSelectedAddress("Adres alınıyor...");
        const a = await fetchAddress(loc);
        setSelectedAddress(a);
      }
      return;
    }

    const activeMode = mode_param || selectionMode;

    if (activeMode === 'start') {
      setStartLocation(loc);
      setSelectionMode('none');
      if (addr) setStartAddress(addr);
      else {
        setStartAddress("Adres alınıyor...");
        const a = await fetchAddress(loc);
        setStartAddress(a);
      }
    } else if (activeMode === 'end') {
      setSelectedLocation(loc);
      setSelectionMode('none');
      if (addr) setSelectedAddress(addr);
      else {
        setSelectedAddress("Adres alınıyor...");
        const a = await fetchAddress(loc);
        setSelectedAddress(a);
      }
    } else {
      // Default behavior if no mode is active in Route mode
      if (!startLocation) {
        setStartLocation(loc);
        const a = await fetchAddress(loc);
        setStartAddress(a);
      } else {
        setSelectedLocation(loc);
        const a = await fetchAddress(loc);
        setSelectedAddress(a);
      }
    }
  };

  // Silence phone notifications on device selection (Android only)
  useEffect(() => {
    if (selectedDevice && selectedDevice.os === 'android') {
      invoke('silence_android_notifications', { deviceId: selectedDevice.id })
        .then(() => console.log("Phone notifications silenced"))
        .catch(err => console.error("Could not silence phone:", err));
    }
  }, [selectedDevice]);

  // Manage cooldown countdown
  useEffect(() => {
    if (cooldownTime > 0) {
      const timer = window.setInterval(() => {
        setCooldownTime(prev => Math.max(0, prev - 1));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [cooldownTime]);

  // Auto-clear message
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 3000); // 3 seconds
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Cihazları yükle (Android & iOS)
  const loadDevices = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [androidResult, iosResult] = await Promise.allSettled([
        invoke<any[]>('get_android_devices'),
        invoke<any[]>('get_ios_devices')
      ]);

      if (androidResult.status === 'rejected') {
        console.error("Android scan failed:", androidResult.reason);
        if (!silent) setMessage({ type: 'error', text: `Android tarama hatası: ${androidResult.reason}` });
      }

      if (iosResult.status === 'rejected') {
        console.error("iOS scan failed:", iosResult.reason);
        if (!silent) setMessage({ type: 'error', text: `iOS tarama hatası: ${iosResult.reason}` });
      }

      const rawAndroid = androidResult.status === 'fulfilled' ? androidResult.value : [];
      const rawIos = iosResult.status === 'fulfilled' ? iosResult.value : [];

      console.log("Raw Android:", rawAndroid);
      console.log("Raw iOS:", rawIos);

      // Group devices by ID
      const deviceMap = new Map<string, Device>();

      console.log('--- RAW DISCOVERY DATA ---');
      rawAndroid.forEach((d: any) => {
          console.log(`Android Raw: Name="${d.name}", Serial="${d.serial || d.id}", ContainerId="${d.container_id || 'N/A'}", Status="${d.status}"`);
      });

      // Process All Discovered Devices
      [...rawAndroid, ...rawIos].forEach((d: any) => {
        const id = d.udid || d.id;
        const os = d.os;
        const name = d.name || d.model || (os === 'android' ? 'Android Cihazı' : 'iPhone');
        const mode = (d.connection_mode || d.connectionMode || 'usb') as 'usb' | 'wifi';

        // Canonical Key: Hardware ID
        const mergeKey = `${os}:${id}`;

        const existing = deviceMap.get(mergeKey);

        // Authority Merge: If ADB device (Status != Missing) exists, it should overwrite MTP device
        if (existing && existing.status === 'Missing' && d.status !== 'Missing') {
            console.log(`[MERGE] ADB device ${id} is overwriting MTP placeholder.`);
        }

        if (existing && existing.status !== 'Missing' && d.status === 'Missing') {
            // Don't let a "Missing" placeholder overwrite a live ADB connection
            return;
        }

        const availableModes = existing ? [...(existing.availableModes || []), mode] : [mode];

        deviceMap.set(mergeKey, {
          id,
          name,
          model: d.model || (os === 'android' ? 'Android' : 'Apple Cihazı'),
          status: d.status || (os === 'ios' ? 'Connected' : 'Device'),
          os,
          connectionMode: existing?.connectionMode === 'usb' ? 'usb' : mode,
          availableModes: Array.from(new Set(availableModes)),
          isPaired: false,
          usbId: os === 'android' ? (mode === 'usb' ? id : existing?.usbId) : id
        } as Device);
      });

      const finalDevices = Array.from(deviceMap.values());
      console.log('--- CANONICAL DEVICES ---');
      finalDevices.forEach(d => {
          console.log(`Canonical: OS=${d.os}, ID=${d.id}, Name="${d.name}", Model="${d.model}", Status="${d.status}"`);
      });
      console.log(`UI Render Count (Android): ${finalDevices.filter(d => d.os === 'android').length}`);

      const storedPaired = localStorage.getItem('usbPairedDevices');
      const pairedDeviceIds = storedPaired ? new Set(JSON.parse(storedPaired)) : new Set();

      deviceMap.forEach((device) => {
        device.isPaired = device.usbId ? pairedDeviceIds.has(device.usbId) : false;
      });

      const allDevices = Array.from(deviceMap.values()).map(d => ({
        ...d,
        uniqueId: `${d.id}-${d.connectionMode}`
      }));

      // Filter Logic
      const hasSpecificAndroid = allDevices.some(d => d.os === 'android' && d.id !== 'generic-android' && d.name !== 'Android Cihazı' && d.name !== 'Android');
      const filteredDevices = allDevices.filter(d => {
        if (d.os === 'android' && hasSpecificAndroid && (d.name === 'Android Cihazı' || d.name === 'Android')) {
          return false;
        }
        return true;
      });

      setDevices(filteredDevices as any);

      setDevices(filteredDevices as any);

      // Update Disabled Auto-Connect Set: Remove devices that are no longer physically connected
      const currentlyConnectedIds = new Set(filteredDevices.map(d => d.id));
      setDisabledAutoConnectDevices(prev => {
        let changed = false;
        const next = new Set(prev);
        prev.forEach(id => {
          if (!currentlyConnectedIds.has(id)) {
            next.delete(id);
            changed = true;
          }
        });
        return changed ? next : prev;
      });

      // --- AUTO-DETECT DISCONNECTION FOR SELECTED DEVICE ---
      if (selectedDevice) {
        const stillConnected = filteredDevices.some(d => d.id === selectedDevice.id);
        if (!stillConnected) {
          if (locationChangeInProgressRef.current) {
            console.warn(`[AUTO-REFRESH] Skipping disconnect detection during location change for ${selectedDevice.id}.`);
          } else {
            console.warn(`[AUTO-REFRESH] Selected device ${selectedDevice.id} disappeared.`);
            setMessage({ type: 'error', text: '⚠️ Cihaz bağlantısı koptu! (Otomatik Tespit)' });

            if (selectedDevice.os === 'ios' && !manualDisconnectRef.current) {
              // Optional: Open wizard for help
              openWizard(selectedDevice, 'service');
            }
            setSelectedDevice(null);
          }
        }
      }

      if (allDevices.length > 0 && !showDevicePanel && !silent) {
        setHasNewDeviceNotification(true);
      }
    } catch (error) {
      if (!silent) setMessage({ type: 'error', text: `Hata: ${error}` });
      console.error(error);
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const handleStopAllSimulations = async () => {
    manualDisconnectRef.current = true;

    // Disable auto-connect for all current devices
    const currentDeviceIds = uniqueDevices.map(d => d.id);
    setDisabledAutoConnectDevices(new Set(currentDeviceIds));

    try {
      await invoke('stop_all_simulations');
      setSelectedLocation(null);
      setStartLocation(null);
      setSelectedDevice(null);
      setShowDevicePanel(false);
      setMessage({ type: 'success', text: 'Tüm simülasyonlar durduruldu.' });

      // Refresh devices to update statuses
      await loadDevices();

      // Allow auto-connect again after a short delay (e.g. if they pull cable and re-plug)
      setTimeout(() => {
        manualDisconnectRef.current = false;
      }, 3000);
    } catch (error) {
      console.error('Failed to stop all simulations:', error);
      setMessage({ type: 'error', text: 'Durdurma sırasında bir hata oluştu.' });
      manualDisconnectRef.current = false;
    }
  };

  const handleDisconnectDevice = async (device: Device) => {
    manualDisconnectRef.current = true;
    autoConnectPendingRef.current.delete(device.id);

    // Disable auto-connect for this specific device
    setDisabledAutoConnectDevices(prev => new Set(prev).add(device.id));

    try {
      await invoke('clear_location', { os: device.os, udid: device.id });

      if (selectedDevice?.id === device.id) {
        setSelectedDevice(null);
        setShowDevicePanel(false);
      }

      setMessage({ type: 'success', text: `${device.name} bağlantısı kesildi.` });

      await loadDevices();

      setTimeout(() => {
        manualDisconnectRef.current = false;
      }, 3000);
    } catch (error) {
      console.error('Failed to disconnect device:', error);
      setMessage({ type: 'error', text: 'Cihaz bağlantısı kesilemedi.' });
      manualDisconnectRef.current = false;
    }
  };

  const handleDeviceSelect = async (device: Device) => {
    manualDisconnectRef.current = false;

    // Re-enable auto-connect for this device since user is manually selecting it
    setDisabledAutoConnectDevices(prev => {
      if (prev.has(device.id)) {
        const next = new Set(prev);
        next.delete(device.id);
        return next;
      }
      return prev;
    });

    // If connected via USB, mark device as paired
    if (device.connectionMode === 'usb' && device.usbId) {
      console.log('[USB PAIRING] Saving to localStorage on CONNECT:', device.usbId);
      const newPairedDevices = new Set(usbPairedDevices);
      newPairedDevices.add(device.usbId);
      setUsbPairedDevices(newPairedDevices);
      localStorage.setItem('usbPairedDevices', JSON.stringify(Array.from(newPairedDevices)));

      // Reload devices to update isPaired status immediately
      setTimeout(() => loadDevices(), 200);
    }

    setShowDevicePanel(false);

    // Trigger Setup Wizard immediately based on OS
    if (device.os === 'ios') {
      setWizardDevice(device);
      setShowIOSWizard(true);
    } else if (device.os === 'android') {
      setWizardDevice(device);
      setShowAndroidWizard(true);
    } else {
      setSelectedDevice(device);
    }
  };

  // Smart Auto-Connect Logic
  const autoConnectDevice = async (device: Device) => {
    // If iOS, verify Dev Mode silently first
    if (device.os === 'ios') {
      try {
        const devMode = await invoke<any>('check_ios_developer_mode', { udid: device.id });
        const isEnabled = typeof devMode === 'boolean' ? devMode : devMode?.developer_mode;

        if (isEnabled) {
          console.log(`[AUTO-CONNECT] iOS Dev Mode enabled for ${device.name}. Skipping wizard.`);
          setSelectedDevice({ ...device, developerModeEnabled: true, developerModeChecked: true });
          setMessage({ type: 'success', text: `✅ ${device.name} bağlandı!` });
          setShowIOSWizard(false);
          setWizardDevice(null);
        } else {
          console.warn(`[AUTO-CONNECT] iOS Dev Mode disabled for ${device.name}. Opening wizard.`);
          handleDeviceSelect(device);
        }
      } catch (e) {
        console.error(`[AUTO-CONNECT] iOS Dev Mode check failed: ${e}`);
        handleDeviceSelect(device); // Open wizard as fallback
      }
    } else {
      // Android auto-connect
      setSelectedDevice(device);
      setMessage({ type: 'success', text: `✅ ${device.name} bağlandı!` });
      // Force close wizard
      setShowIOSWizard(false);
      setWizardDevice(null);
    }
  };

  const handleWizardComplete = (developerModeEnabled: boolean) => {
    setShowIOSWizard(false);

    if (wizardDevice) {
      // Update device with developer mode status
      setDevices(prevDevices =>
        prevDevices.map(d =>
          d.id === wizardDevice.id
            ? { ...d, developerModeEnabled, developerModeChecked: true }
            : d
        )
      );

      const updatedDevice = { ...wizardDevice, developerModeEnabled, developerModeChecked: true };
      setSelectedDevice(updatedDevice);

      if (!developerModeEnabled) {
        setMessage({
          type: 'error',
          text: '⚠️ Developer Mode kapalı. Konum değiştirme çalışmayacak.'
        });
      } else {
        setMessage({ type: 'success', text: '✅ iOS cihaz başarıyla bağlandı!' });
      }
    }

    setWizardDevice(null);
  };

  const handleWizardCancel = () => {
    setShowIOSWizard(false);
    setWizardDevice(null);
  };

  const handleAcceptDisclaimer = () => {
    localStorage.setItem('geoshift_disclaimer_accepted', 'true');
    setHasAcceptedDisclaimer(true);
  };


  // Konumu değiştir (Teleport)
  const changeLocation = async () => {
    if (!selectedDevice || !selectedLocation) {
      setMessage({ type: 'error', text: 'Lütfen cihaz ve konum seçin!' });
      return;
    }

    // iOS developer mode check
    if (selectedDevice.os === 'ios') {
      if (selectedDevice.developerModeChecked && !selectedDevice.developerModeEnabled) {
        setMessage({
          type: 'error',
          text: '❌ iOS Developer Mode kapalı! Ayarlar → Gizlilik ve Güvenlik → Developer Mode → Aç. Sonra cihazı yeniden başlatın.'
        });
        return;
      }
    }

    locationChangeInProgressRef.current = true;
    setIsLoading(true);
    setMessage(null); // Clear previous messages while loading banner displays
    try {
      const before = { ...currentLocation };
      console.log('--- iOS SPOOF VERIFICATION START ---');
      console.log('Target Device:', selectedDevice.name, `(${selectedDevice.id})`);
      console.log('Before Coordinates:', before.latitude, before.longitude);
      console.log('Target Coordinates:', selectedLocation.latitude, selectedLocation.longitude);

      await invoke('set_location', {
        os: selectedDevice.os,
        udid: selectedDevice.id,
        lat: selectedLocation.latitude,
        lng: selectedLocation.longitude
      });

      // Wait 3 seconds for the device/OS to update its internal state
      await new Promise(resolve => setTimeout(resolve, 3000));

      console.log('[SPOOF] Command sent. Simulation should be active.');

      // Verification: Check if the device is still reachable
      const isAlive = await invoke<boolean>('check_device_health', {
          os: selectedDevice.os,
          udid: selectedDevice.id,
          requireUsb: selectedDevice.connectionMode === 'usb'
      });

      console.log('[VERIFY] Device still connected:', isAlive);
      console.log('[VERIFY] Target applied in UI.');
      console.log('--- iOS SPOOF VERIFICATION END ---');

      setCurrentLocation(selectedLocation);

      // Reset selected location to null after arrival
      setSelectedLocation(null);
      setSelectedAddress('');

      // Sequential delay so the loading banner fades out before success message pops up
      setTimeout(() => {
        setMessage({ type: 'success', text: 'Konum başarıyla ışınlandı! 📍' });
      }, 100);
    } catch (error) {
      const errorMsg = String(error);
      console.error('Teleport failed:', errorMsg);

      if (selectedDevice.os === 'android') {
          setMessage({ type: 'error', text: '❌ Konum değiştirilemedi. Kurulum yapılıyor...' });
          setTimeout(() => {
              setWizardDevice(selectedDevice);
              setShowAndroidWizard(true);
          }, 1000);
      } else if (errorMsg.includes('Developer Mode') || errorMsg.includes('developer mode')) {
        setMessage({ type: 'error', text: '❌ Developer Mode kapalı! Sihirbaz başlatılıyor...' });
        setTimeout(() => openWizard(selectedDevice, 'developer'), 1500);
      } else if (errorMsg.includes('trust') || errorMsg.includes('Trust') || errorMsg.includes('lockdown') || errorMsg.includes('lock')) {
        setMessage({ type: 'error', text: '❌ Cihaz kilitli veya güvenilmiyor! Sihirbaz başlatılıyor...' });
        setTimeout(() => openWizard(selectedDevice, 'device'), 1500);
      } else {
        setMessage({ type: 'error', text: `Hata: ${error}. Bağlantıyı kontrol edin.` });
        // Optional: Open wizard at 'service' step if it seems like a driver issue
        if (errorMsg.includes('device not found') || errorMsg.includes('communication')) {
          setTimeout(() => openWizard(selectedDevice, 'service'), 1500);
        }
      }
    } finally {
      locationChangeInProgressRef.current = false;
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();

    // Listen for manual guide request
    const handleOpenAndroidGuide = () => {
      setWizardDevice({ id: 'generic-android', name: 'Android Cihaz', model: 'Bilinmiyor', os: 'android', status: 'Missing', connectionMode: 'usb' });
      setShowAndroidWizard(true);
    };
    window.addEventListener('open-android-guide', handleOpenAndroidGuide);

    // Auto-refresh devices every 2 seconds (Discovery - Slower)
    const interval = setInterval(() => {
      loadDevices(true);
    }, 2000);

    // ACTIVE HEALTH CHECK (500ms) - Instant Disconnection Detection
    const healthInterval = setInterval(async () => {
      if (selectedDevice) {
        try {
          let isAlive = await invoke<boolean>('check_device_health', {
            os: selectedDevice.os,
            udid: selectedDevice.id,
            requireUsb: selectedDevice.connectionMode === 'usb'
          });

          // Graceful Wi-Fi Fallback
          if (!isAlive && selectedDevice.connectionMode === 'usb') {
             const isWifiAlive = await invoke<boolean>('check_device_health', {
                os: selectedDevice.os,
                udid: selectedDevice.id,
                requireUsb: false
             });

             if (isWifiAlive) {
                 console.log(`[HEALTH-CHECK] Device ${selectedDevice.id} lost USB, falling back to Wi-Fi`);
                 setSelectedDevice({ ...selectedDevice, connectionMode: 'wifi' });
                 setMessage({ type: 'info', text: 'Kablo çıkarıldı, Wi-Fi üzerinden devam ediliyor...' });
                 isAlive = true; // Prevent disconnect
             }
          }

          if (!isAlive && !manualDisconnectRef.current && !disabledAutoConnectDevices.has(selectedDevice.id)) {
            if (locationChangeInProgressRef.current) {
              console.warn(`[HEALTH-CHECK] Skipping disconnect detection during location change for ${selectedDevice.id}.`);
            } else {
              console.warn(`[HEALTH-CHECK] Device ${selectedDevice.id} lost!`);
              setMessage({ type: 'error', text: '⚠️ Cihaz bağlantısı koptu!' });

              if (selectedDevice.os === 'ios') {
                openWizard(selectedDevice, 'service');
              }
              setSelectedDevice(null);
              // Force refresh to update list
              loadDevices(true);
            }
          }
        } catch (e) {
          console.error("Health check failed:", e);
        }
      }
    }, 500);

    // Listen for device disconnection (Professional Heartbeat - Active Simulation)
    const unlisten = listen<string>('device-lost', (event) => {
      const lostUdid = event.payload;
        if (locationChangeInProgressRef.current) {
          console.warn(`[HEARTBEAT] Ignoring device-lost event during location change for ${lostUdid}.`);
          return;
        }

      // If the lost device is our selected device, reset the state
      setSelectedDevice(current => {
        if (current && current.id === lostUdid && !manualDisconnectRef.current && !disabledAutoConnectDevices.has(lostUdid)) {
          console.warn(`[HEARTBEAT] Active device lost: ${lostUdid}`);
          setMessage({ type: 'error', text: '⚠️ Cihaz bağlantısı kesildi! Sihirbaz başlatılıyor...' });
          // Auto-open wizard for redirection
          openWizard(current, 'service');
          return null;
        }
        return current;
      });
    });

    return () => {
      window.removeEventListener('open-android-guide', handleOpenAndroidGuide);
      clearInterval(interval);
      clearInterval(healthInterval);
      unlisten.then(f => f());
    };
  }, [selectedDevice]);




  return (
    <>
      {showSplash && <Splash onFinish={() => setShowSplash(false)} />}

      {!showSplash && !hasAcceptedDisclaimer && (
        <LegalDisclaimer onAccept={handleAcceptDisclaimer} />
      )}

      {/* iOS Connection Wizard */}
      {showIOSWizard && wizardDevice && (
        <IOSConnectionWizard
          device={wizardDevice}
          onComplete={handleWizardComplete}
          onCancel={handleWizardCancel}
          initialStepId={initialWizardStep}
        />
      )}

      {/* Android Connection Wizard */}
      {showAndroidWizard && wizardDevice && (
        <AndroidConnectionWizard
          device={wizardDevice}
          onComplete={() => {
            setSelectedDevice(wizardDevice);
            setShowAndroidWizard(false);
            setWizardDevice(null);
            setMessage({ type: 'success', text: '✅ Android cihaz hazır!' });
          }}
          onCancel={() => {
            setShowAndroidWizard(false);
            setWizardDevice(null);
          }}
        />
      )}

      <div className={`app-container ${showSplash ? 'app-splash-active' : ''}`} style={{
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-primary)'
      }}>
          <CustomTitlebar setMessage={setMessage} />

          {/* Message Banner (Toast) */}
          {message && !isLoading && (
            <div style={{
              position: 'absolute',
              top: '68px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 99998,
              padding: '10px 18px',
              borderRadius: '30px',
              background: 'rgba(15, 23, 42, 0.92)',
              backdropFilter: 'blur(16px)',
              color: '#ffffff',
              border: `1px solid ${message.type === 'success' ? 'rgba(16, 185, 129, 0.4)' : message.type === 'error' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(59, 130, 246, 0.4)'}`,
              boxShadow: '0 12px 32px rgba(0,0,0,0.3), 0 0 15px rgba(0,0,0,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              fontSize: '0.88rem',
              fontWeight: 600,
              animation: 'fadeUp 0.2s ease-out'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {message.type === 'success' && <CheckCircle2 size={18} style={{ color: '#10b981' }} />}
                {message.type === 'error' && <AlertCircle size={18} style={{ color: '#ef4444' }} />}
                {message.type === 'info' && <Info size={18} style={{ color: '#3b82f6' }} />}
                <span>{message.text}</span>
              </div>
              <button
                onClick={() => setMessage(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.6)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  transition: 'color 0.2s'
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Main Content - Full Screen Map with Floating Panels */}
          <div style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden'
          }}>
            <MapComponent
              mode={mode}
              setMode={setMode}
              isDeviceSelected={!!selectedDevice || showIOSWizard}
              startLocation={startLocation}
              selectedLocation={selectedLocation}
              currentLocation={currentLocation}
              onLocationSelect={handleLocationSelect}
              focusTrigger={focusTrigger}
              onTeleport={changeLocation}
              mapRotation={mapRotation}
              showDevicePanel={showDevicePanel}
              setShowDevicePanel={(val: boolean) => {
                setShowDevicePanel(val);
                if (val) setHasNewDeviceNotification(false);
              }}
              hasDeviceNotification={hasNewDeviceNotification}
              onScanDevices={loadDevices}
              isScanning={isLoading}
              devices={uniqueDevices}
              onSelectDevice={handleDeviceSelect}
              onOpenWizard={openWizard}
            />

            {/* Teleporting Loading Indicator Overlay */}
            {isLoading && locationChangeInProgressRef.current && (
              <div style={{
                position: 'fixed',
                top: '68px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 99999,
                background: 'rgba(15, 23, 42, 0.90)',
                backdropFilter: 'blur(16px)',
                color: '#ffffff',
                padding: '10px 22px',
                borderRadius: '30px',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.1)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                fontSize: '0.9rem',
                fontWeight: 600,
                letterSpacing: '-0.01em',
                pointerEvents: 'none',
                animation: 'fadeUp 0.2s ease-out'
              }}>
                <div className="animate-spin" style={{
                  width: '16px',
                  height: '16px',
                  border: '2px solid rgba(255, 255, 255, 0.25)',
                  borderTopColor: '#3b82f6',
                  borderRadius: '50%'
                }} />
                <span>⚡ Işınlanıyor, lütfen bekleyiniz...</span>
              </div>
            )}

            {/* Floating Device Manager (Right Side) */}
            {showDevicePanel && (
              <div className="floating-right-panel">
                <DeviceManager
                  devices={uniqueDevices}
                  selectedDevice={selectedDevice}
                  onSelectDevice={(dev) => handleDeviceSelect(dev)}
                  onDisconnectAll={handleStopAllSimulations}
                  onDisconnectDevice={handleDisconnectDevice}
                />
              </div>
            )}

            {/* Floating Left Panel - Location Controls */}
            {selectedDevice && (
              <div className={`floating-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
                <button
                  className="collapse-toggle"
                  onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                  title={isSidebarCollapsed ? "Paneli Göster" : "Paneli Gizle"}
                >
                  {isSidebarCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                </button>

                <div className="floating-panel" style={{ flex: 1, overflow: 'auto' }}>
                  <LocationControls
                    mode={mode}
                    setMode={setMode}
                    selectedDevice={selectedDevice}
                    startLocation={startLocation}
                    startAddress={startAddress}
                    selectedLocation={selectedLocation}
                    selectedAddress={selectedAddress}
                    currentLocation={currentLocation}
                    onSetStartLocation={(loc) => { setStartLocation(loc); if (!loc) setStartAddress(''); }}
                    onSetEndLocation={(loc) => { setSelectedLocation(loc); if (!loc) setSelectedAddress(''); }}
                    selectionMode={selectionMode}
                    setSelectionMode={setSelectionMode}
                    onChangeLocation={changeLocation}
                    mapRotation={mapRotation}
                    onJoystickMove={async (lat, lng, isFollow = false, isRoute = false, rotation?: number) => {
                      if (selectedDevice) {
                        // iOS developer mode check
                        if (selectedDevice.os === 'ios' && selectedDevice.developerModeChecked && !selectedDevice.developerModeEnabled) {
                          setMessage({
                            type: 'error',
                            text: '❌ iOS Developer Mode kapalı! Konum değiştirme devre dışı.'
                          });
                          return;
                        }

                        try {
                          if (isFollow && rotation !== undefined) {
                            setMapRotation(rotation);
                          }

                          await invoke('set_location', {
                            os: selectedDevice.os,
                            udid: selectedDevice.id,
                            lat: lat,
                            lng: lng
                          });

                          setCurrentLocation({ latitude: lat, longitude: lng });

                          if (!isRoute) {
                            setSelectedLocation({ latitude: lat, longitude: lng });
                            if (isFollow) {
                              setFocusTrigger(prev => prev + 1);
                            }
                          }
                        } catch (e) {
                          console.error("Move failed:", e);
                          const errorMsg = String(e);

                          if (errorMsg.includes('Developer Mode') || errorMsg.includes('developer mode')) {
                            setMessage({ type: 'error', text: '❌ Developer Mode kapalı!' });
                            openWizard(selectedDevice, 'developer');
                          } else if (errorMsg.includes('trust') || errorMsg.includes('Trust') || errorMsg.includes('lockdown')) {
                            setMessage({ type: 'error', text: '❌ Bağlantı koptu veya cihaz kilitlendi!' });
                            openWizard(selectedDevice, 'device');
                          } else {
                            setMessage({ type: 'error', text: 'Hareket sırasında hata oluştu!' });
                          }
                        }
                      }
                    }}
                    isLoading={isLoading}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
    </>
  );
}

export default App;
