import { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Search, Layers, Target, Smartphone, MapPin, Route, Gamepad2, Plus, Minus, Loader2, X, Apple, ChevronLeft } from 'lucide-react';

// Fix Leaflet default marker icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// --- Custom Icons ---
const UserIcon = L.divIcon({
    className: 'custom-user-icon',
    html: `<div style="
        background-color: #3b82f6;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 0 15px rgba(59, 130, 246, 0.6);
    "></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
});

const TargetIcon = L.divIcon({
    className: 'custom-target-icon',
    html: `<div style="
        background-color: #ef4444;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid white;
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: bold;
        font-size: 12px;
        box-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
    ">B</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
});

interface Device {
    id: string;
    name: string;
    model: string;
    status: string;
    os: 'android' | 'ios';
    connectionMode: 'usb' | 'wifi';
}

interface MapProps {
    mode: 'teleport' | 'joystick' | 'route';
    setMode: (mode: 'teleport' | 'joystick' | 'route') => void;
    isDeviceSelected: boolean;
    selectedLocation: { latitude: number; longitude: number } | null;
    startLocation: { latitude: number; longitude: number } | null;
    currentLocation: { latitude: number; longitude: number } | null;
    onLocationSelect: (location: { latitude: number; longitude: number } | null, mode?: 'start' | 'end', address?: string) => void;
    onTeleport?: (location: { latitude: number; longitude: number }) => void;
    focusTrigger?: number;
    showDevicePanel: boolean;
    setShowDevicePanel: (val: boolean) => void;
    devices: Device[];
    onSelectDevice: (device: Device) => void;
    onScanDevices: () => void;
    hasDeviceNotification?: boolean;
    isScanning?: boolean;
}

// SAFE MapFlyTo - PREVENTS LOOPS
function MapFlyTo({ center, trigger, zoom = 15 }: { center: { latitude: number, longitude: number } | null, trigger?: number, zoom?: number }) {
    const map = useMap();
    const lastTrigger = useRef(trigger);

    useEffect(() => {
        if (!center) return;

        const currentCenter = map.getCenter();
        const dist = Math.abs(currentCenter.lat - center.latitude) + Math.abs(currentCenter.lng - center.longitude);
        const triggerChanged = trigger !== undefined && trigger !== lastTrigger.current;

        // Move if forced by trigger OR significant distance
        if (triggerChanged || dist > 0.0001) {
            map.flyTo([center.latitude, center.longitude], triggerChanged ? 17 : Math.max(map.getZoom(), zoom));
            lastTrigger.current = trigger;
        }
    }, [center, map, trigger, zoom]);

    return null;
}

function MapClickHandler({ onLocationSelect }: { onLocationSelect: (loc: { latitude: number, longitude: number }) => void }) {
    useMapEvents({
        click: (e) => onLocationSelect({ latitude: e.latlng.lat, longitude: e.latlng.lng }),
    });
    return null;
}

// Custom Popup-like Overlay for Teleporting
function TeleportOverlay({
    location,
    onClose,
    onTeleport,
    map
}: {
    location: { latitude: number; longitude: number };
    onClose: () => void;
    onTeleport: (loc: { latitude: number; longitude: number }) => void;
    map: L.Map;
}) {
    const [pos, setPos] = useState<{ x: number, y: number } | null>(null);

    const updatePos = () => {
        if (!location) return;
        try {
            const point = map.latLngToContainerPoint([location.latitude, location.longitude]);
            setPos({ x: point.x, y: point.y });
        } catch (e) {
            // Ignore if map is not ready
        }
    };

    useEffect(() => {
        updatePos();
        map.on('move moveend zoom zoomend rotate', updatePos);
        return () => { map.off('move moveend zoom zoomend rotate', updatePos); };
    }, [location, map]);

    if (!pos) return null;

    return (
        <div style={{
            position: 'absolute', left: pos.x, top: pos.y,
            transform: 'translate(-50%, calc(-100% - 25px))',
            zIndex: 1000, pointerEvents: 'auto'
        }}>
            <div className="floating-panel" style={{ padding: '12px', minWidth: '160px', textAlign: 'center', border: '1.5px solid var(--primary-light)', background: 'white' }}>
                <button onClick={onClose} style={{ position: 'absolute', top: '-8px', right: '-8px', background: '#ef4444', color: 'white', border: '2px solid white', borderRadius: '50%', width: '22px', height: '22px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={12} /></button>
                <div style={{ fontWeight: 800, fontSize: '0.85rem', marginBottom: '8px', color: 'var(--text-primary)' }}>📍 Hedef Nokta</div>
                <button className="btn btn-primary" onClick={() => onTeleport(location)} style={{ width: '100%', fontSize: '0.8rem', padding: '8px' }}>Buraya Işınlan</button>
            </div>
            <div style={{ width: 0, height: 0, borderLeft: '8px solid transparent', borderRight: '8px solid transparent', borderTop: '10px solid var(--primary-light)', margin: '0 auto' }}></div>
        </div>
    );
}

export default function Map({
    mode,
    setMode,
    isDeviceSelected,
    selectedLocation,
    currentLocation,
    onLocationSelect,
    onTeleport,
    focusTrigger = 0,
    showDevicePanel,
    setShowDevicePanel,
    devices,
    onSelectDevice,
    onScanDevices,
    hasDeviceNotification,
    isScanning
}: MapProps) {
    const [overlayMode, setOverlayMode] = useState<'default' | 'guide'>('default');
    const [guideOS, setGuideOS] = useState<'android' | 'ios'>('android');
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [showResults, setShowResults] = useState(false);
    const [mapStyle, setMapStyle] = useState<'osm' | 'satellite'>('osm');
    const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
    const [popupVisible, setPopupVisible] = useState(false);
    const [internalFocusTrigger, setInternalFocusTrigger] = useState(0);

    // Sync isSearching prop with local state
    useEffect(() => {
        if (isScanning !== undefined) setIsSearching(isScanning);
    }, [isScanning]);

    // Show popup when a new location is selected from map
    useEffect(() => {
        if (selectedLocation && mode === 'teleport') {
            setPopupVisible(true);
        } else {
            setPopupVisible(false);
        }
    }, [selectedLocation, mode]);

    // Search logic
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (searchQuery.trim().length < 3) { setSearchResults([]); return; }
            setIsSearching(true);
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`);
                const data = await res.json();
                setSearchResults(data);
                setShowResults(true);
            } catch (e) { console.error(e); }
            finally { setIsSearching(false); }
        }, 800);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Internal Focus Handler
    const handleFocusClick = () => {
        setInternalFocusTrigger(prev => prev + 1);
    };

    return (
        <div style={{ height: '100%', width: '100%', position: 'relative', background: 'white' }}>
            {/* Unified Search Bar */}
            <div className="floating-search floating-panel" style={{ padding: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input
                        type="text"
                        placeholder="Şehir, sokak veya koordinat..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onFocus={() => setShowResults(true)}
                        onKeyDown={(e) => { if(e.key === 'Enter') setShowResults(true); }}
                        style={{ width: '100%', padding: '10px 40px 10px 38px', borderRadius: '10px', border: '1px solid var(--border-light)', outline: 'none', background: '#f8fafc', fontSize: '0.9rem' }}
                    />
                    {searchQuery && (
                        <button
                            className="search-clear-btn"
                            onClick={() => { setSearchQuery(''); setSearchResults([]); setShowResults(false); }}
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
                <button className="btn btn-primary" style={{ width: '42px', height: '42px', padding: 0 }} onClick={() => setShowResults(true)}>
                    {isSearching ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
                </button>
                {showResults && searchResults.length > 0 && (
                    <div className="floating-panel" style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '10px', overflow: 'hidden', padding: '4px', background: '#ffffff', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #f1f5f9' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-muted)' }}>ARAMA SONUÇLARI</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowResults(false);
                                }}
                                style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.7rem', fontWeight: 800, cursor: 'pointer' }}
                            >
                                KAPAT
                            </button>
                        </div>
                        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                            {searchResults.map((r, i) => (
                                <div key={i} onClick={() => {
                                    onLocationSelect({ latitude: parseFloat(r.lat), longitude: parseFloat(r.lon) }, 'end', r.display_name);
                                    setSearchQuery('');
                                    setShowResults(false);
                                    setSearchResults([]);
                                }} style={{ padding: '12px', cursor: 'pointer', borderRadius: '8px', fontSize: '0.85rem', color: '#1e293b' }} className="search-result-item">
                                    {r.display_name}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Mode Select */}
            <div className="floating-modes floating-panel">
                <button onClick={() => setMode('teleport')} className={`btn-icon ${mode === 'teleport' ? 'active' : ''}`} title="Işınlanma"><MapPin size={22} /></button>
                <button onClick={() => setMode('route')} className={`btn-icon ${mode === 'route' ? 'active' : ''}`} title="İki Nokta"><Route size={22} /></button>
                <button onClick={() => setMode('joystick')} className={`btn-icon ${mode === 'joystick' ? 'active' : ''}`} title="Joystick"><Gamepad2 size={22} /></button>
            </div>

            {/* Floating Utils */}
            <div className="floating-utils">
                <button onClick={() => setShowDevicePanel(!showDevicePanel)} className={`btn-icon ${showDevicePanel ? 'active' : ''}`} title="Cihazlar" style={{ position: 'relative' }}>
                    <Smartphone size={22} />
                    {hasDeviceNotification && <div style={{ position: 'absolute', top: '-2px', right: '-2px', width: '12px', height: '12px', background: '#ef4444', borderRadius: '50%', border: '2px solid white' }} />}
                </button>
                <button onClick={handleFocusClick} className="btn-icon" title="Konuma Odaklan"><Target size={22} /></button>
                <button onClick={() => setMapStyle(mapStyle === 'osm' ? 'satellite' : 'osm')} className="btn-icon" title="Harita Tipi"><Layers size={22} /></button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <button onClick={() => mapInstance?.zoomIn()} className="btn-icon"><Plus size={20} /></button>
                    <button onClick={() => mapInstance?.zoomOut()} className="btn-icon"><Minus size={20} /></button>
                </div>
            </div>

            {/* Leaflet Map */}
            <MapContainer center={[41.0082, 28.9784]} zoom={13} style={{ height: '100%', width: '100%' }} zoomControl={false} whenReady={(e) => setMapInstance(e.target)}>
                <TileLayer url={mapStyle === 'osm' ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"} />
                <MapClickHandler onLocationSelect={onLocationSelect} />

                {/* Focus logic: Priority to Current, then Selected */}
                <MapFlyTo
                    center={currentLocation || selectedLocation}
                    trigger={focusTrigger + internalFocusTrigger}
                />

                {currentLocation && (
                    <Marker position={[currentLocation.latitude, currentLocation.longitude]} icon={UserIcon} zIndexOffset={1000} />
                )}

                {selectedLocation && (
                    <Marker position={[selectedLocation.latitude, selectedLocation.longitude]} icon={TargetIcon} />
                )}
            </MapContainer>

            {/* Teleport Popup */}
            {mode === 'teleport' && selectedLocation && mapInstance && popupVisible && (
                <TeleportOverlay
                    location={selectedLocation}
                    map={mapInstance}
                    onClose={() => setPopupVisible(false)}
                    onTeleport={(loc) => {
                        onTeleport?.(loc);
                        setPopupVisible(false);
                    }}
                />
            )}

            {/* Device Selection Overlay */}
            {!isDeviceSelected && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(10px)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {overlayMode === 'default' ? (
                        <div className="floating-panel fade-in" style={{ padding: '40px', width: '440px', textAlign: 'center' }}>
                            <div style={{ width: '80px', height: '80px', borderRadius: '24px', background: 'var(--primary-bg)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                                <Smartphone size={40} />
                            </div>
                            <h2 style={{ margin: '0 0 8px', fontWeight: 800 }}>Cihazınızı Bağlayın</h2>
                            <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', lineHeight: 1.6 }}>Konum simülasyonunu başlatmak için listeden cihazınızı seçin veya USB ile bağlayın.</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {devices.length === 0 ? (
                                    <div style={{ padding: '20px', background: '#f8fafc', borderRadius: '12px', color: '#94a3b8', border: '1px dashed var(--border)' }}>Cihazlar aranıyor...</div>
                                ) : (
                                    devices.map(d => (
                                        <button key={d.id} onClick={() => onSelectDevice(d)} className="btn btn-secondary" style={{ width: '100%', justifyContent: 'flex-start', padding: '16px', border: (d.status === 'Unauthorized' || d.status === 'Missing' || d.id === 'generic-android') ? '1.5px solid #fde68a' : '1px solid var(--border)', background: (d.status === 'Unauthorized' || d.status === 'Missing' || d.id === 'generic-android') ? '#fffbeb' : 'white' }}>
                                            {d.os === 'ios' ? <Apple size={20} style={{ color: 'var(--primary)' }} /> : <Smartphone size={20} style={{ color: (d.status !== 'Device' && d.status !== 'Connected') ? '#f59e0b' : 'var(--primary)' }} />}
                                            <div style={{ textAlign: 'left' }}>
                                                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    {d.name}
                                                    {d.status === 'Unauthorized' && <span style={{ fontSize: '0.6rem', padding: '2px 6px', background: '#f59e0b', color: 'white', borderRadius: '4px' }}>İZİN GEREKLİ</span>}
                                                    {(d.status === 'Missing' || d.id === 'generic-android') && <span style={{ fontSize: '0.6rem', padding: '2px 6px', background: 'var(--text-muted)', color: 'white', borderRadius: '4px' }}>KAPALI / BULUNAMADI</span>}
                                                </div>
                                                <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>{d.model} {d.status !== 'Device' && d.status !== 'Connected' && d.status !== 'Missing' ? `(${d.status})` : ''}</div>
                                            </div>
                                        </button>
                                    ))
                                )}
                                <button onClick={onScanDevices} className="btn btn-primary" style={{ marginTop: '12px', height: '48px' }}>Cihazları Tekrar Tara</button>
                                <button
                                    onClick={() => setOverlayMode('guide')}
                                    style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', marginTop: '12px' }}
                                >
                                    Cihazınız Görünmüyor mu?
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="floating-panel fade-in" style={{ padding: '30px', width: '520px', textAlign: 'left', position: 'relative' }}>
                            <button
                                onClick={() => setOverlayMode('default')}
                                style={{ position: 'absolute', top: '20px', left: '20px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
                            >
                                <ChevronLeft size={24} />
                            </button>

                            <h3 style={{ fontSize: '1.4rem', fontWeight: 800, textAlign: 'center', marginBottom: '20px' }}>Bağlantı Rehberi</h3>

                            <div style={{ display: 'flex', background: '#f1f5f9', padding: '4px', borderRadius: '12px', marginBottom: '20px' }}>
                                <button onClick={() => setGuideOS('android')} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: guideOS === 'android' ? 'white' : 'transparent', fontWeight: 600, color: guideOS === 'android' ? 'var(--primary)' : 'var(--text-secondary)', cursor: 'pointer' }}>Android</button>
                                <button onClick={() => setGuideOS('ios')} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: guideOS === 'ios' ? 'white' : 'transparent', fontWeight: 600, color: guideOS === 'ios' ? 'var(--primary)' : 'var(--text-secondary)', cursor: 'pointer' }}>iOS</button>
                            </div>

                            <div style={{ minHeight: '260px' }}>
                                {guideOS === 'android' ? (
                                    <div className="fade-in">
                                        <p style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>Android cihazınızın algılanması için:</p>
                                        <ol style={{ paddingLeft: '20px', lineHeight: 1.8, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            <li>Ayarlar &gt; Telefon Hakkında &gt; <b>Yapım Numarası</b>'na 7 kez üst üste tıklayın.</li>
                                            <li>Geliştirici Seçenekleri'ne gidin ve <b>USB Hata Ayıklama</b>'yı açın.</li>
                                            <li>USB kablosunu çıkarıp tekrar takın.</li>
                                            <li>Telefonda çıkan "İzin Ver" uyarısını onaylayın.</li>
                                        </ol>
                                    </div>
                                ) : (
                                    <div className="fade-in">
                                        <p style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>iOS cihazınızın algılanması için:</p>
                                        <ul style={{ paddingLeft: '20px', lineHeight: 1.8, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            <li>iPhone'u bilgisayara bağladığınızda <b>"Bu Bilgisayara Güven"</b> uyarısını onaylayın.</li>
                                            <li><b>iTunes</b>'un bilgisayarınızda yüklü ve güncel olduğundan emin olun.</li>
                                            <li>Ayarlar &gt; Gizlilik ve Güvenlik &gt; <b>Geliştirici Modu</b>'nu açın ve cihazı yeniden başlatın.</li>
                                        </ul>
                                    </div>
                                )}
                            </div>

                            <button onClick={() => setOverlayMode('default')} className="btn btn-primary" style={{ width: '100%', marginTop: '20px', height: '48px' }}>Tamam, Anladım</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
