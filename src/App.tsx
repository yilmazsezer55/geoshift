import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  const manualDisconnectRef = useRef(false);
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
  const [hardwareLocation, setHardwareLocation] = useState<Location | null>(null);
  const [debugInfo, setDebugInfo] = useState<{ rtt: number; lagMeters: number }>({ rtt: 0, lagMeters: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [mapRotation, setMapRotation] = useState(0);

  // Cooldown State
  const [cooldownTime, setCooldownTime] = useState(0); // in seconds

  // Selection Mode ('start', 'end', or 'none')
  const [selectionMode, setSelectionMode] = useState<'start' | 'end' | 'none'>('none');

  // Movement speed
  const [speed, setSpeed] = useState<'walk' | 'run' | 'drive'>('walk');
  const speedRef = useRef<number>(5); // Default 5 km/h

  const SPEED_KMH = { walk: 5, run: 12, drive: 60 };

  // Device Panel & Notification States
  const [showDevicePanel, setShowDevicePanel] = useState(false);
  const [hasNewDeviceNotification, setHasNewDeviceNotification] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [showIOSWizard, setShowIOSWizard] = useState(false);
  const [showAndroidWizard, setShowAndroidWizard] = useState(false);
  const [showGeneralGuide, setShowGeneralGuide] = useState(false);
  const [wizardDevice, setWizardDevice] = useState<Device | null>(null);
  const [initialWizardStep, setInitialWizardStep] = useState<string | undefined>(undefined);

  // --- Central Routing Configuration ---
  const ROUTING_CONFIG = {
    walk: {
      baseUrl: 'https://routing.openstreetmap.de/routed-foot',
      radius: 30,
      continueStraight: false
    },
    run: { // Cycle mode in UI
      baseUrl: 'https://routing.openstreetmap.de/routed-bike',
      radius: 50,
      continueStraight: true
    },
    drive: {
      baseUrl: 'https://routing.openstreetmap.de/routed-car',
      radius: 100,
      continueStraight: true
    }
  };

  const [routeSimulation, setRouteSimulation] = useState<{
    active: boolean;
    paused: boolean;
    progress: number;
    path: Location[];
    currentIndex: number;
  }>({ active: false, paused: false, progress: 0, path: [], currentIndex: 0 });

  const routeTimerRef = useRef<any>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isRouteRunning = useRef<boolean>(false);
  const isRoutePaused = useRef<boolean>(false);
  const isDeviceBusyRef = useRef<boolean>(false); // Lock for phone sync
  const lastSegmentIndexRef = useRef<number>(0);
  const emaRttRef = useRef<number>(300); // Measured RTT for look-ahead

  // Refs for high-precision movement
  const simulationDataRef = useRef<{
    path: Location[];
    segmentDistances: number[];
    totalDist: number;
    currentDistCovered: number;
    lastTickTimestamp: number;
    lastDeviceUpdate: number;
    simulationStartTime: number; // Absolute start for drift prevention
    distCoveredOnPause: number;   // Distance already covered before last pause
  } | null>(null);

  // Hız değiştiğinde mesafeyi snapshot yap (Sorun 2: geçmiş sürenin yeni hızla çarpılıp atlama yapmasını önler)
  useEffect(() => {
    if (simulationDataRef.current && isRouteRunning.current && !isRoutePaused.current) {
      const data = simulationDataRef.current;
      if (data.simulationStartTime > 0) {
        const elapsed = (performance.now() - data.simulationStartTime) / 1000;
        const oldSpeedKmMs = speedRef.current / (3600 * 1000);
        data.distCoveredOnPause += (elapsed * 1000) * oldSpeedKmMs;
        data.simulationStartTime = performance.now();
      }
    }
    speedRef.current = SPEED_KMH[speed];
  }, [speed]);

  const stopRouteSimulation = () => {
    isRouteRunning.current = false;
    isRoutePaused.current = false;
    isDeviceBusyRef.current = false;
    lastSegmentIndexRef.current = 0;

    if (routeTimerRef.current) {
      clearTimeout(routeTimerRef.current);
      routeTimerRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    simulationDataRef.current = null;
    setHardwareLocation(null);
    setRouteSimulation({ active: false, paused: false, progress: 0, path: [], currentIndex: 0 });
    setIsLoading(false);
  };

  const pauseRouteSimulation = () => {
    isRoutePaused.current = true;
    if (simulationDataRef.current) {
      const data = simulationDataRef.current;
      if (data.simulationStartTime > 0) {
        const elapsed = (performance.now() - data.simulationStartTime) / 1000;
        const speedKmMs = speedRef.current / (3600 * 1000);
        data.distCoveredOnPause += (elapsed * 1000) * speedKmMs;
      }
      data.simulationStartTime = 0;
    }
    setRouteSimulation(prev => ({ ...prev, paused: true }));
  };

  const resumeRouteSimulation = () => {
    isRoutePaused.current = false;
    if (simulationDataRef.current) {
      simulationDataRef.current.simulationStartTime = performance.now();
    }
    setRouteSimulation(prev => ({ ...prev, paused: false }));

    if (!animationFrameRef.current && isRouteRunning.current) {
      animationFrameRef.current = requestAnimationFrame(simulationStep);
    }
  };

  const simulationStep = async (timestamp: number) => {
    if (!isRouteRunning.current || isRoutePaused.current || !simulationDataRef.current) {
      animationFrameRef.current = null;
      return;
    }

    const data = simulationDataRef.current;
    if (data.simulationStartTime === 0) {
      data.simulationStartTime = timestamp;
    }

    const currentSpeedKmh = speedRef.current;
    const speedKmMs = currentSpeedKmh / (3600 * 1000);
    const totalElapsedMs = timestamp - data.simulationStartTime;

    // 1. CALCULATE ABSOLUTE PROGRESS
    const distanceJustNow = totalElapsedMs * speedKmMs;
    const totalDistCovered = Math.min(data.distCoveredOnPause + distanceJustNow, data.totalDist);
    const progress = totalDistCovered / data.totalDist;

    // Helper: Interpolate coordinates along route at given distance
    const getCoordinatesAtDistance = (dist: number) => {
      const clampedDist = Math.max(0, Math.min(dist, data.totalDist));
      let segIdx = 0;
      const segDists = data.segmentDistances;
      while (segIdx < segDists.length - 1 && segDists[segIdx + 1] < clampedDist) {
        segIdx++;
      }
      const sD = segDists[segIdx];
      const eD = segDists[segIdx + 1] || sD;
      const segD = eD - sD;
      const segProg = segD > 0 ? (clampedDist - sD) / segD : 1;
      const segP1 = data.path[segIdx];
      const segP2 = data.path[segIdx + 1] || segP1;
      return {
        lat: segP1.latitude + (segP2.latitude - segP1.latitude) * segProg,
        lng: segP1.longitude + (segP2.longitude - segP1.longitude) * segProg,
        segmentIndex: segIdx,
        p1: segP1,
        p2: segP2
      };
    };

    // 2. UI POSITION & UPDATE
    const currentPos = getCoordinatesAtDistance(totalDistCovered);
    setCurrentLocation({ latitude: currentPos.lat, longitude: currentPos.lng });
    setRouteSimulation(prev => ({ ...prev, progress, currentIndex: currentPos.segmentIndex }));

    // 3. DEVICE UPDATE (Throttled approx 1Hz + In-Flight Lock + Look-Ahead Compensation)
    if (timestamp - data.lastDeviceUpdate >= 1000 && !isDeviceBusyRef.current) {
      data.lastDeviceUpdate = timestamp;
      isDeviceBusyRef.current = true;

      // Look-ahead gecikme telafisi (iMyFone AnyTo mantığı):
      // Donanım/USB/Ağ iletim gecikmesi (EMA RTT) süresince UI ilerleyecektir.
      // Cihazın haritada UI ile senkron görünmesi için RTT süresi kadar ilerideki koordinatı gönderiyoruz.
      const lookAheadMs = Math.min(Math.max(emaRttRef.current, 50), 1200);
      const lookAheadDistKm = lookAheadMs * speedKmMs;
      const targetDeviceDist = Math.min(totalDistCovered + lookAheadDistKm, data.totalDist);
      const devicePos = getCoordinatesAtDistance(targetDeviceDist);

      const calculateBearing = (sLat: number, sLng: number, dLat: number, dLng: number) => {
        const sLatRad = sLat * Math.PI / 180;
        const dLatRad = dLat * Math.PI / 180;
        const dLngRad = (dLng - sLng) * Math.PI / 180;
        const y = Math.sin(dLngRad) * Math.cos(dLatRad);
        const x = Math.cos(sLatRad) * Math.sin(dLatRad) - Math.sin(sLatRad) * Math.cos(dLatRad) * Math.cos(dLngRad);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
      };

      const bearing = calculateBearing(devicePos.p1.latitude, devicePos.p1.longitude, devicePos.p2.latitude, devicePos.p2.longitude);
      setMapRotation(bearing);

      const invokeStart = performance.now();
      invoke('set_location', {
        os: selectedDevice!.os,
        udid: selectedDevice!.id,
        lat: devicePos.lat,
        lng: devicePos.lng,
        speed: currentSpeedKmh / 3.6,
        bearing: bearing,
        altitude: 100.0
      }).then(() => {
        const rtt = performance.now() - invokeStart;
        emaRttRef.current = emaRttRef.current * 0.8 + rtt * 0.2;
        setHardwareLocation({ latitude: devicePos.lat, longitude: devicePos.lng });
        setDebugInfo({ rtt: Math.round(emaRttRef.current), lagMeters: Math.round(lookAheadDistKm * 1000) });
      }).catch(e => {
        console.error("Hardware update failed:", e);
      }).finally(() => {
        isDeviceBusyRef.current = false;
      });
    }

    // 4. FINISH CHECK
    if (progress >= 1) {
      isDeviceBusyRef.current = false;
      const final = data.path[data.path.length - 1];
      await invoke('set_location', {
        os: selectedDevice!.os,
        udid: selectedDevice!.id,
        lat: final.latitude,
        lng: final.longitude,
        speed: 0.0,
        bearing: 0.0,
        altitude: 100.0
      }).catch(() => {});

      setCurrentLocation(final);
      setHardwareLocation(final);
      setRouteSimulation(prev => ({ ...prev, progress: 1 }));
      stopRouteSimulation();
      setMessage({ type: 'success', text: 'Hedefe ulaşıldı! 🏁' });
      return;
    }

    animationFrameRef.current = requestAnimationFrame(simulationStep);
  };

  const startRouteSimulation = async (_initialSpeedKmh: number, speedMode: 'walk' | 'run' | 'drive' = 'walk') => {
    if (!selectedDevice || !startLocation || !selectedLocation) return;

    stopRouteSimulation();
    setIsLoading(true);

    try {
      const config = ROUTING_CONFIG[speedMode];
      const url = `${config.baseUrl}/route/v1/driving/${startLocation.longitude},${startLocation.latitude};${selectedLocation.longitude},${selectedLocation.latitude}?overview=full&geometries=geojson&continue_straight=${config.continueStraight}&radiuses=${config.radius};${config.radius}`;

      const res = await fetch(url);
      const data = await res.json();

      if (!data.code || data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
        throw new Error(data.message || "Yol tarifi bulunamadı.");
      }

      const coordinates = data.routes[0].geometry.coordinates;
      let path: Location[] = coordinates.map((c: any) => ({ latitude: c[1], longitude: c[0] }));
      path = [startLocation, ...path, selectedLocation];

      let totalDist = 0;
      const segmentDistances: number[] = [0];
      for (let i = 0; i < path.length - 1; i++) {
        const d = getDistance(path[i].latitude, path[i].longitude, path[i+1].latitude, path[i+1].longitude);
        totalDist += d;
        segmentDistances.push(totalDist);
      }

      isRouteRunning.current = true;
      lastSegmentIndexRef.current = 0;
      simulationDataRef.current = {
        path,
        segmentDistances,
        totalDist,
        currentDistCovered: 0,
        lastTickTimestamp: 0,
        lastDeviceUpdate: 0,
        simulationStartTime: 0,
        distCoveredOnPause: 0
      };

      // Cihazı hemen rotanın başlangıç noktasına ışınla (hızlı sync ve atlamayı engelleme)
      try {
        await invoke('set_location', {
          os: selectedDevice.os,
          udid: selectedDevice.id,
          lat: startLocation.latitude,
          lng: startLocation.longitude,
          speed: 0.0,
          bearing: 0.0,
          altitude: 100.0
        });
        setCurrentLocation(startLocation);
        setHardwareLocation(startLocation);
      } catch (err) {
        console.warn("Initial route teleport warning:", err);
      }

      setIsLoading(false);
      setRouteSimulation({ active: true, paused: false, progress: 0, path, currentIndex: 0 });
      animationFrameRef.current = requestAnimationFrame(simulationStep);

    } catch (e) {
      console.error("Route simulation failed:", e);
      stopRouteSimulation();
      setMessage({ type: 'error', text: 'Rota başlatılamadı.' });
    }
  };

  const [hasAcceptedDisclaimer, setHasAcceptedDisclaimer] = useState<boolean>(() => {
    return localStorage.getItem('geoshift_disclaimer_accepted') === 'true';
  });

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    if (showSplash) { root.classList.add('app-splash-active'); }
    else { root.classList.remove('app-splash-active'); }
    return () => root.classList.remove('app-splash-active');
  }, [showSplash]);

  const openWizard = (device: Device, stepId?: string) => {
    setWizardDevice(device);
    setInitialWizardStep(stepId);
    setShowIOSWizard(true);
  };

  const uniqueDevices = Array.from(devices.reduce((acc, dev) => {
    const existing = acc.get(dev.id);
    if (!existing || (dev.connectionMode === 'usb' && existing.connectionMode !== 'usb')) {
      acc.set(dev.id, dev);
    }
    return acc;
  }, new Map<string, Device>()).values());

  useEffect(() => {
    if (mode !== 'joystick') { setMapRotation(0); }
  }, [mode]);

  const fetchAddress = async (loc: Location): Promise<string> => {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${loc.latitude}&lon=${loc.longitude}&zoom=18&addressdetails=1`, {
        headers: { 'User-Agent': 'GeoShift-App' }
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      const addr = data.address;
      if (addr) {
        const parts = [];
        if (addr.road) parts.push(addr.road);
        if (addr.house_number) parts.push(addr.house_number);
        if (parts.length === 0 && (addr.suburb || addr.neighbourhood)) parts.push(addr.suburb || addr.neighbourhood);
        if (parts.length === 0 && addr.city) parts.push(addr.city);
        return parts.join(' ') || data.display_name.split(',')[0];
      }
      return data.display_name.split(',')[0] || `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`;
    } catch (e) {
      return `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`;
    }
  };

  const calculateRoute = async (start: Location, end: Location, speedMode: 'walk' | 'run' | 'drive') => {
    const config = ROUTING_CONFIG[speedMode];
    const url = `${config.baseUrl}/route/v1/driving/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson&continue_straight=${config.continueStraight}&radiuses=${config.radius};${config.radius}`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) { throw new Error("Rota bulunamadı"); }
      const route = data.routes[0];
      const coordinates = route.geometry.coordinates;
      let path: Location[] = coordinates.map((c: any) => ({ latitude: c[1], longitude: c[0] }));
      path = [start, ...path, end];
      setRouteSimulation(prev => ({ ...prev, path, currentIndex: 0, progress: 0 }));
      return path;
    } catch (e) {
      return null;
    }
  };

  useEffect(() => {
    if (mode === 'route' && startLocation && selectedLocation && !isRouteRunning.current) {
      calculateRoute(startLocation, selectedLocation, speed);
    }
  }, [speed, startLocation, selectedLocation, mode]);

  const handleLocationSelect = async (loc: Location | null, mode_param?: 'start' | 'end', addr?: string) => {
    if (!loc) { setSelectedLocation(null); setSelectedAddress(''); return; }
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
      else { setStartAddress("Adres alınıyor..."); const a = await fetchAddress(loc); setStartAddress(a); }
    } else if (activeMode === 'end') {
      setSelectedLocation(loc);
      setSelectionMode('none');
      if (addr) setSelectedAddress(addr);
      else { setSelectedAddress("Adres alınıyor..."); const a = await fetchAddress(loc); setSelectedAddress(a); }
    } else {
      if (startLocation && selectedLocation) {
        setStartLocation(loc); setSelectedLocation(null); setSelectedAddress(''); const a = await fetchAddress(loc); setStartAddress(a);
      } else if (!startLocation) {
        setStartLocation(loc); const a = await fetchAddress(loc); setStartAddress(a);
      } else {
        setSelectedLocation(loc); const a = await fetchAddress(loc); setSelectedAddress(a);
      }
    }
  };

  const swapLocations = () => {
    if (routeSimulation.active) return;
    const prevStartLoc = startLocation;
    const prevStartAddr = startAddress;
    setStartLocation(selectedLocation);
    setStartAddress(selectedAddress);
    setSelectedLocation(prevStartLoc);
    setSelectedAddress(prevStartAddr);
  };

  useEffect(() => {
    if (selectedDevice && selectedDevice.os === 'android') {
      invoke('silence_android_notifications', { deviceId: selectedDevice.id }).catch(() => {});
    }
  }, [selectedDevice]);

  useEffect(() => {
    if (cooldownTime > 0) {
      const timer = window.setInterval(() => { setCooldownTime(prev => Math.max(0, prev - 1)); }, 1000);
      return () => clearInterval(timer);
    }
  }, [cooldownTime]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => { setMessage(null); }, 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const loadDevices = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [androidResult, iosResult] = await Promise.allSettled([
        invoke<any[]>('get_android_devices'),
        invoke<any[]>('get_ios_devices')
      ]);

      const rawAndroid = androidResult.status === 'fulfilled' ? androidResult.value : [];
      const rawIos = iosResult.status === 'fulfilled' ? iosResult.value : [];
      const deviceMap = new Map<string, Device>();

      [...rawAndroid, ...rawIos].forEach((d: any) => {
        const id = d.udid || d.id;
        const os = d.os;
        const name = d.name || d.model || (os === 'android' ? 'Android Cihazı' : 'iPhone');
        const mode = (d.connection_mode || d.connectionMode || 'usb') as 'usb' | 'wifi';
        const mergeKey = `${os}:${id}`;
        const existing = deviceMap.get(mergeKey);
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

      const storedPaired = localStorage.getItem('usbPairedDevices');
      const pairedDeviceIds = storedPaired ? new Set(JSON.parse(storedPaired)) : new Set();
      deviceMap.forEach((device) => { device.isPaired = device.usbId ? pairedDeviceIds.has(device.usbId) : false; });

      const allDevices = Array.from(deviceMap.values()).map(d => ({ ...d, uniqueId: `${d.id}-${d.connectionMode}` }));
      setDevices(allDevices as any);

      if (selectedDevice) {
        const stillConnected = allDevices.some(d => d.id === selectedDevice.id);
        if (!stillConnected && !locationChangeInProgressRef.current) {
          setMessage({ type: 'error', text: '⚠️ Cihaz bağlantısı koptu!' });
          setSelectedDevice(null);
        }
      }

      if (allDevices.length > 0 && !showDevicePanel && !silent) {
        setHasNewDeviceNotification(true);
      }
    } catch (error) {
      console.error(error);
    } finally {
      if (!silent) setIsLoading(false);
    }
  };

  const handleStopAllSimulations = async () => {
    manualDisconnectRef.current = true;
    try {
      await invoke('stop_all_simulations');
      setSelectedLocation(null);
      setStartLocation(null);
      setSelectedDevice(null);
      setShowDevicePanel(false);
      setMessage({ type: 'success', text: 'Tüm simülasyonlar durduruldu.' });
      await loadDevices();
      setTimeout(() => { manualDisconnectRef.current = false; }, 3000);
    } catch (error) {
      setMessage({ type: 'error', text: 'Durdurma hatası.' });
      manualDisconnectRef.current = false;
    }
  };

  const handleDisconnectDevice = async (device: Device) => {
    manualDisconnectRef.current = true;
    try {
      await invoke('clear_location', { os: device.os, udid: device.id });
      if (selectedDevice?.id === device.id) { setSelectedDevice(null); setShowDevicePanel(false); }
      setMessage({ type: 'success', text: `${device.name} bağlantısı kesildi.` });
      await loadDevices();
      setTimeout(() => { manualDisconnectRef.current = false; }, 3000);
    } catch (error) { manualDisconnectRef.current = false; }
  };

  const handleDeviceSelect = async (device: Device) => {
    manualDisconnectRef.current = false;
    if (device.connectionMode === 'usb' && device.usbId) {
      const newPairedDevices = new Set(usbPairedDevices);
      newPairedDevices.add(device.usbId);
      setUsbPairedDevices(newPairedDevices);
      localStorage.setItem('usbPairedDevices', JSON.stringify(Array.from(newPairedDevices)));
      setTimeout(() => loadDevices(), 200);
    }
    setShowDevicePanel(false);
    if (device.os === 'ios') { setWizardDevice(device); setShowIOSWizard(true); }
    else if (device.os === 'android') { setWizardDevice(device); setShowAndroidWizard(true); }
    else { setSelectedDevice(device); }
  };

  const handleWizardComplete = (developerModeEnabled: boolean) => {
    setShowIOSWizard(false);
    if (wizardDevice) {
      setDevices(prev => prev.map(d => d.id === wizardDevice.id ? { ...d, developerModeEnabled, developerModeChecked: true } : d));
      const updated = { ...wizardDevice, developerModeEnabled, developerModeChecked: true };
      setSelectedDevice(updated);
      if (!developerModeEnabled) { setMessage({ type: 'error', text: '⚠️ Developer Mode kapalı.' }); }
      else { setMessage({ type: 'success', text: '✅ iOS cihaz hazır!' }); }
    }
    setWizardDevice(null);
  };

  const changeLocation = async () => {
    if (!selectedDevice || !selectedLocation) {
      setMessage({ type: 'error', text: 'Lütfen cihaz ve konum seçin!' });
      return;
    }

    if (selectedDevice.os === 'ios' && selectedDevice.developerModeChecked && !selectedDevice.developerModeEnabled) {
      setMessage({ type: 'error', text: '❌ iOS Developer Mode kapalı!' });
      return;
    }

    locationChangeInProgressRef.current = true;
    setIsLoading(true);
    setMessage(null);
    try {
      const target = { ...selectedLocation };
      setCurrentLocation(target);
      setSelectedLocation(null);
      setSelectedAddress('');

      // Send with all required params
      await invoke('set_location', {
        os: selectedDevice.os,
        udid: selectedDevice.id,
        lat: target.latitude,
        lng: target.longitude,
        speed: 0.0,
        bearing: 0.0,
        altitude: 100.0
      });

      setMessage({ type: 'success', text: 'Konum başarıyla ışınlandı! 📍' });
    } catch (error) {
      console.error('Teleport failed:', error);
      setMessage({ type: 'error', text: `Konum güncellenemedi: ${error}` });
    } finally {
      locationChangeInProgressRef.current = false;
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
    const handleOpenAndroidGuide = () => {
      setWizardDevice({ id: 'generic-android', name: 'Android Cihaz', model: 'Bilinmiyor', os: 'android', status: 'Missing', connectionMode: 'usb' });
      setShowAndroidWizard(true);
    };
    window.addEventListener('open-android-guide', handleOpenAndroidGuide);
    const interval = setInterval(() => loadDevices(true), 2000);

    const healthInterval = setInterval(async () => {
      if (selectedDevice) {
        try {
          let isAlive = await invoke<boolean>('check_device_health', {
            os: selectedDevice.os,
            udid: selectedDevice.id,
            requireUsb: selectedDevice.connectionMode === 'usb'
          });
          if (!isAlive && selectedDevice.connectionMode === 'usb') {
            const isWifiAlive = await invoke<boolean>('check_device_health', { os: selectedDevice.os, udid: selectedDevice.id, requireUsb: false });
            if (isWifiAlive) { setSelectedDevice({ ...selectedDevice, connectionMode: 'wifi' }); isAlive = true; }
          }
          if (!isAlive && !manualDisconnectRef.current && !locationChangeInProgressRef.current) {
            setSelectedDevice(null);
            loadDevices(true);
          }
        } catch (e) { console.error(e); }
      }
    }, 500);

    return () => {
      window.removeEventListener('open-android-guide', handleOpenAndroidGuide);
      clearInterval(interval);
      clearInterval(healthInterval);
    };
  }, [selectedDevice]);

  return (
    <>
      {showSplash && <Splash onFinish={() => setShowSplash(false)} />}

      {!showSplash && !hasAcceptedDisclaimer && (
        <LegalDisclaimer onAccept={() => { localStorage.setItem('geoshift_disclaimer_accepted', 'true'); setHasAcceptedDisclaimer(true); }} />
      )}

      {showIOSWizard && wizardDevice && (
        <IOSConnectionWizard device={wizardDevice} onComplete={handleWizardComplete} onCancel={() => setShowIOSWizard(false)} initialStepId={initialWizardStep} />
      )}

      {showAndroidWizard && wizardDevice && (
        <AndroidConnectionWizard
          device={wizardDevice}
          onComplete={() => { setSelectedDevice(wizardDevice); setShowAndroidWizard(false); setWizardDevice(null); setMessage({ type: 'success', text: '✅ Android cihaz hazır!' }); }}
          onCancel={() => { setShowAndroidWizard(false); setWizardDevice(null); }}
        />
      )}

      <div className={`app-container ${showSplash ? 'app-splash-active' : ''}`} style={{ height: '100%', width: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative', borderRadius: 'var(--radius-lg)', background: 'var(--bg-primary)' }}>
        <CustomTitlebar setMessage={setMessage} />

        {message && !isLoading && (
          <div style={{ position: 'absolute', top: '68px', left: '50%', transform: 'translateX(-50%)', zIndex: 99998, padding: '10px 18px', borderRadius: '30px', background: 'rgba(15, 23, 42, 0.92)', backdropFilter: 'blur(16px)', color: '#ffffff', border: `1px solid ${message.type === 'success' ? 'rgba(16, 185, 129, 0.4)' : message.type === 'error' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(59, 130, 246, 0.4)'}`, boxShadow: '0 12px 32px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.88rem', fontWeight: 600 }}>
            {message.type === 'success' && <CheckCircle2 size={18} color="#10b981" />}
            {message.type === 'error' && <AlertCircle size={18} color="#ef4444" />}
            {message.type === 'info' && <Info size={18} color="#3b82f6" />}
            <span>{message.text}</span>
            <button onClick={() => setMessage(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}><X size={14} /></button>
          </div>
        )}

        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <MapComponent
            mode={mode} setMode={setMode} isDeviceSelected={!!selectedDevice || showIOSWizard}
            startLocation={startLocation} selectedLocation={selectedLocation} currentLocation={currentLocation}
            onLocationSelect={handleLocationSelect} focusTrigger={focusTrigger} onTeleport={changeLocation}
            mapRotation={mapRotation} showDevicePanel={showDevicePanel} setShowDevicePanel={setShowDevicePanel}
            hasDeviceNotification={hasNewDeviceNotification} onScanDevices={loadDevices} isScanning={isLoading}
            devices={uniqueDevices} onSelectDevice={handleDeviceSelect} onOpenWizard={openWizard}
            routePath={routeSimulation.path} routeProgress={routeSimulation.progress} routeCurrentIndex={routeSimulation.currentIndex}
            selectionMode={selectionMode} forceShowGuide={showGeneralGuide} onCloseGuide={() => setShowGeneralGuide(false)}
            isRouteSimulating={routeSimulation.active} hardwareLocation={hardwareLocation} debugInfo={debugInfo}
          />

          {isLoading && locationChangeInProgressRef.current && (
            <div style={{ position: 'fixed', top: '68px', left: '50%', transform: 'translateX(-50%)', zIndex: 99999, background: 'rgba(15, 23, 42, 0.90)', backdropFilter: 'blur(16px)', color: '#ffffff', padding: '10px 22px', borderRadius: '30px', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.9rem', fontWeight: 600 }}>
              <div className="animate-spin" style={{ width: '16px', height: '16px', border: '2px solid rgba(255, 255, 255, 0.25)', borderTopColor: '#3b82f6', borderRadius: '50%' }} />
              <span>⚡ Işınlanıyor...</span>
            </div>
          )}

          {showDevicePanel && (
            <div className="floating-right-panel">
              <DeviceManager devices={uniqueDevices} selectedDevice={selectedDevice} onSelectDevice={handleDeviceSelect} onDisconnectAll={handleStopAllSimulations} onDisconnectDevice={handleDisconnectDevice} />
            </div>
          )}

          {selectedDevice && (
            <div className={`floating-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
              <button className="collapse-toggle" onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}>
                {isSidebarCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
              </button>

              <div className="floating-panel" style={{ flex: 1, overflow: 'auto' }}>
                <LocationControls
                  mode={mode} setMode={setMode} selectedDevice={selectedDevice}
                  startLocation={startLocation} startAddress={startAddress}
                  selectedLocation={selectedLocation} selectedAddress={selectedAddress}
                  currentLocation={currentLocation} onSetStartLocation={setStartLocation} onSetEndLocation={setSelectedLocation}
                  selectionMode={selectionMode} setSelectionMode={setSelectionMode} onChangeLocation={changeLocation}
                  mapRotation={mapRotation}
                  onJoystickMove={async (lat, lng, isFollow = false, isRoute = false, rotation?: number) => {
                    if (!selectedDevice) return;
                    if (selectedDevice.os === 'ios' && selectedDevice.developerModeChecked && !selectedDevice.developerModeEnabled) return;
                    try {
                      if (isFollow && rotation !== undefined) setMapRotation(rotation);
                      invoke('set_location', {
                        os: selectedDevice.os, udid: selectedDevice.id, lat, lng,
                        speed: speedRef.current / 3.6, bearing: rotation || 0.0, altitude: 100.0
                      });
                      setCurrentLocation({ latitude: lat, longitude: lng });
                      if (!isRoute) {
                        setSelectedLocation({ latitude: lat, longitude: lng });
                        if (isFollow) setFocusTrigger(prev => prev + 1);
                      }
                    } catch (e) { console.error(e); }
                  }}
                  isLoading={isLoading} onStartRoute={startRouteSimulation} onStopRoute={stopRouteSimulation}
                  onPauseRoute={pauseRouteSimulation} onResumeRoute={resumeRouteSimulation}
                  routeActive={routeSimulation.active} routePaused={routeSimulation.paused}
                  speed={speed} onSpeedChange={setSpeed}
                  onSwapLocations={swapLocations}
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
