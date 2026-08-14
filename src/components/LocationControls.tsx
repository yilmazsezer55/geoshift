import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowUp, Gamepad2, Zap, Car, Footprints, Route, MapPin, ArrowUpDown, Target, Upload } from 'lucide-react';

interface Device {
    id: string;
    name: string;
    model: string;
    status: string;
    os: 'android' | 'ios';
}

interface Location {
    latitude: number;
    longitude: number;
}

interface LocationControlsProps {
    mode: 'teleport' | 'joystick' | 'route';
    setMode: (mode: 'teleport' | 'joystick' | 'route') => void;
    selectedDevice: Device | null;
    selectedLocation: Location | null;
    selectedAddress?: string;
    startLocation: Location | null;
    startAddress?: string;
    currentLocation: Location | null;
    onChangeLocation: () => void;
    onJoystickMove: (lat: number, lng: number, isFollow?: boolean, isRoute?: boolean, rotation?: number) => void;
    onSetStartLocation: (loc: Location | null) => void;
    onSetEndLocation: (loc: Location | null) => void;
    selectionMode: 'start' | 'end' | 'none';
    setSelectionMode: (mode: 'start' | 'end' | 'none') => void;
    isLoading: boolean;
    mapRotation: number;
}

export default function LocationControls({
    mode,
    selectedDevice,
    selectedLocation,
    selectedAddress,
    startLocation,
    startAddress,
    currentLocation,
    onChangeLocation,
    onJoystickMove,
    onSetStartLocation,
    onSetEndLocation,
    selectionMode,
    setSelectionMode,
    isLoading,
    mapRotation
}: LocationControlsProps) {
    const canChangeLocation = selectedDevice && selectedLocation && !isLoading;
    const [speed, setSpeed] = useState<'walk' | 'run' | 'drive'>('walk');
    const [realisticMode, setRealisticMode] = useState(false);
    const [followMode, setFollowMode] = useState(false);
    const [isMoving, setIsMoving] = useState(false);
    const [distanceInfo, setDistanceInfo] = useState({ km: 0, time: '--:--' });
    const [currentAddress, setCurrentAddress] = useState<string>('Konum alınıyor...');

    const SPEED_VALUES = { walk: 0.00001, run: 0.00004, drive: 0.00008 };
    const SPEED_KMH = { walk: 5, run: 12, drive: 60 };

    // Mevcut konumun adresini takip et
    useEffect(() => {
        if (currentLocation) {
            const fetchCurrentAddr = async () => {
                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${currentLocation.latitude}&lon=${currentLocation.longitude}&zoom=18`);
                    const data = await res.json();
                    setCurrentAddress(data.display_name.split(',')[0] || "Mevcut Konum");
                } catch (e) {
                    setCurrentAddress(`${currentLocation.latitude.toFixed(4)}, ${currentLocation.longitude.toFixed(4)}`);
                }
            };
            fetchCurrentAddr();
        }
    }, [currentLocation]);

    // Mesafe ve Tahmini Süre Hesaplama
    useEffect(() => {
        if (selectedLocation && currentLocation) {
            const R = 6371;
            const lat1 = currentLocation.latitude * Math.PI / 180;
            const lat2 = selectedLocation.latitude * Math.PI / 180;
            const dLat = (selectedLocation.latitude - currentLocation.latitude) * Math.PI / 180;
            const dLon = (selectedLocation.longitude - currentLocation.longitude) * Math.PI / 180;

            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1) * Math.cos(lat2) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const d = R * c;

            const speedKmh = SPEED_KMH[speed];
            const timeHours = d / speedKmh;
            const timeMins = Math.round(timeHours * 60);

            const hours = Math.floor(timeMins / 60);
            const mins = timeMins % 60;
            const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;

            setDistanceInfo({ km: parseFloat(d.toFixed(2)), time: timeStr });
        } else {
            setDistanceInfo({ km: 0, time: '--:--' });
        }
    }, [selectedLocation, currentLocation, speed]);

    const handleMove = useCallback(async (screenDegrees: number) => {
        if (!selectedDevice || mode !== 'joystick' || isMoving) return;
        setIsMoving(true);
        try {
            let { latitude, longitude } = currentLocation || selectedLocation || { latitude: 0, longitude: 0 };
            if (!latitude || !longitude) return;

            const step = SPEED_VALUES[speed];
            let newHeading = (screenDegrees - mapRotation + 360) % 360;
            const mathRad = ((90 - newHeading) * Math.PI / 180);
            let targetLat = latitude + Math.sin(mathRad) * step;
            let targetLng = longitude + Math.cos(mathRad) * step;

            await onJoystickMove(targetLat, targetLng, followMode, false, newHeading);
        } finally {
            setTimeout(() => setIsMoving(false), 50);
        }
    }, [selectedDevice, mode, isMoving, currentLocation, selectedLocation, speed, followMode, mapRotation, onJoystickMove]);

    useEffect(() => {
        if (mode !== 'joystick') return;
        const handleKeyDown = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if (key === 'w' || key === 'arrowup') handleMove(0);
            if (key === 's' || key === 'arrowdown') handleMove(180);
            if (key === 'a' || key === 'arrowleft') handleMove(270);
            if (key === 'd' || key === 'arrowright') handleMove(90);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [mode, handleMove]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }} className="floating-panel">
            {/* Header */}
            <div style={{ padding: '20px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--primary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                    {mode === 'teleport' ? <MapPin size={22} /> : mode === 'joystick' ? <Gamepad2 size={22} /> : <Route size={22} />}
                </div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                    {mode === 'teleport' ? 'Işınlanma Modu' : mode === 'joystick' ? 'Joystick Modu' : 'İki Nokta Modu'}
                </h2>
            </div>

            {/* Scrollable Content */}
            <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {mode === 'teleport' && (
                    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div style={{ padding: '16px', background: 'rgba(59, 130, 246, 0.05)', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.1)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                <div style={{ width: '8px', height: '8px', background: '#3b82f6', borderRadius: '50%' }} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase' }}>Mevcut Konum</span>
                            </div>
                            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                {currentLocation ? currentAddress : (selectedDevice ? 'Konum Henüz Başlatılmadı' : 'Cihaz Bağlı Değil')}
                            </div>
                        </div>

                        {/* Hedef Konum Bölümü */}
                        <div style={{ padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid var(--border-light)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                <div style={{ width: '8px', height: '8px', background: 'var(--primary)', borderRadius: '50%' }} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase' }}>Hedef Konum</span>
                            </div>
                            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                                {selectedAddress || (selectedLocation ? `${selectedLocation.latitude.toFixed(6)}, ${selectedLocation.longitude.toFixed(6)}` : 'Henüz Konum Seçilmedi')}
                            </div>
                        </div>

                        <button
                            className="btn btn-primary"
                            onClick={onChangeLocation}
                            disabled={!canChangeLocation}
                        >
                            <Zap size={18} /> {isLoading ? 'Işınlanıyor...' : 'Buraya Işınlan'}
                        </button>
                    </div>
                )}

                {mode === 'joystick' && (
                    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        <div>
                            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '12px', display: 'block' }}>Hız Ayarı</label>
                            <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '6px', borderRadius: '14px' }}>
                                {(['walk', 'run', 'drive'] as const).map((s) => (
                                    <button
                                        key={s}
                                        onClick={() => setSpeed(s)}
                                        style={{ flex: 1, height: '40px', border: 'none', borderRadius: '10px', background: speed === s ? 'white' : 'transparent', color: speed === s ? 'var(--primary)' : 'var(--text-secondary)', cursor: 'pointer', boxShadow: speed === s ? '0 2px 8px rgba(0,0,0,0.05)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                                    >
                                        {s === 'walk' ? <Footprints size={18} /> : s === 'run' ? <Zap size={18} /> : <Car size={18} />}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <div style={{ position: 'relative', width: '160px', height: '160px', background: 'rgba(79, 70, 229, 0.03)', borderRadius: '50%', border: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <button onClick={() => handleMove(0)} className="btn-icon" style={{ position: 'absolute', top: '4px', width: '38px', height: '38px' }}><ArrowUp size={20} /></button>
                                <button onClick={() => handleMove(180)} className="btn-icon" style={{ position: 'absolute', bottom: '4px', width: '38px', height: '38px', transform: 'rotate(180deg)' }}><ArrowUp size={20} /></button>
                                <button onClick={() => handleMove(270)} className="btn-icon" style={{ position: 'absolute', left: '4px', width: '38px', height: '38px', transform: 'rotate(-90deg)' }}><ArrowUp size={20} /></button>
                                <button onClick={() => handleMove(90)} className="btn-icon" style={{ position: 'absolute', right: '4px', width: '38px', height: '38px', transform: 'rotate(90deg)' }}><ArrowUp size={20} /></button>
                                <div style={{ width: '56px', height: '56px', background: 'var(--primary)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', boxShadow: '0 8px 20px rgba(79, 70, 229, 0.3)' }}>
                                    <Gamepad2 size={28} />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Footer Info */}
                <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid var(--border-light)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        <span>Aktif Cihaz:</span>
                        <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{selectedDevice?.name || 'Bağlı Değil'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        <span>Uzaklık:</span>
                        <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{distanceInfo.km} km</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        <span>Tahmini Varış:</span>
                        <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{distanceInfo.time}</span>
                    </div>
                </div>

                <div style={{ marginTop: '12px', textAlign: 'center', opacity: 0.5 }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)' }}>GeoShift v0.1.0</span>
                </div>

            </div>
        </div>
    );
}
