import { Smartphone, Plus, CheckCircle, AlertCircle, Apple, X } from 'lucide-react';

interface Device {
    id: string;
    name: string;
    model: string;
    status: string;
    os: 'android' | 'ios';
    connectionMode: 'usb' | 'wifi';
    availableModes?: ('usb' | 'wifi')[];
    isPaired?: boolean;
}

interface DeviceManagerProps {
    devices: Device[];
    selectedDevice: Device | null;
    onSelectDevice: (device: Device) => void;
    onDisconnectAll: () => void;
    onDisconnectDevice: (device: Device) => void;
}

export default function DeviceManager({ devices, selectedDevice, onSelectDevice, onDisconnectAll, onDisconnectDevice }: DeviceManagerProps) {
    return (
        <div className="floating-panel" style={{
            height: '100%',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--primary-light)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.15)'
        }}>
            <div style={{
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-light)',
                background: 'var(--primary-bg)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
            }}>
                <div>
                    <h2 style={{ fontSize: '0.85rem', fontWeight: 800, margin: 0, color: 'var(--primary)' }}>
                        Cihaz Yönetimi
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', margin: 0, fontWeight: 500 }}>
                        {devices.length} aktif bağlantı
                    </p>
                </div>
                <button className="btn-icon" style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid var(--primary-light)', color: 'var(--primary)' }}>
                    <Plus size={16} />
                </button>
            </div>

            {/* Bilgilendirme Notu */}
            <div style={{ padding: '10px 15px', background: '#fffbeb', borderBottom: '1px solid #fef3c7' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '0.65rem', color: '#92400e', lineHeight: 1.4, fontWeight: 600 }}>
                    ℹ️ Konum kontrolü sadece **seçili** cihaz üzerinde çalışır. Diğer cihazlar mevcut konumlarında kalır.
                </p>
                <button
                    onClick={() => window.dispatchEvent(new CustomEvent('open-general-guide'))}
                    style={{ background: 'none', border: 'none', padding: 0, color: 'var(--primary)', fontSize: '0.65rem', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}
                >
                    Cihazlarım görünmüyor mu?
                </button>
            </div>

            <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
            }}>
                {devices.length === 0 ? (
                    <div style={{
                        textAlign: 'center',
                        padding: '2rem 1rem',
                        color: 'var(--text-muted)'
                    }}>
                        <Smartphone size={32} style={{ opacity: 0.2, marginBottom: '0.5rem' }} />
                        <p style={{ fontSize: '0.75rem' }}>Bağlı cihaz bulunamadı</p>
                    </div>
                ) : (
                    devices.map((device) => (
                        <div key={(device as any).uniqueId || device.id} style={{ position: 'relative' }}>
                            <button
                                onClick={() => onSelectDevice(device)}
                                className="btn-device"
                                style={{
                                    padding: '10px 12px',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    borderRadius: '10px',
                                    border: selectedDevice?.id === device.id
                                        ? '1.5px solid var(--primary)'
                                        : '1px solid var(--border)',
                                    background: selectedDevice?.id === device.id
                                        ? 'var(--primary-bg)'
                                        : 'white',
                                    transition: 'all 0.2s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    width: '100%',
                                    outline: 'none',
                                    boxShadow: selectedDevice?.id === device.id ? '0 4px 10px rgba(79, 70, 229, 0.1)' : 'none'
                                }}
                            >
                                <div style={{
                                    width: '32px', height: '32px', borderRadius: '8px',
                                    background: selectedDevice?.id === device.id ? 'var(--primary)' : 'var(--border-light)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: selectedDevice?.id === device.id ? 'white' : 'var(--text-secondary)',
                                    flexShrink: 0
                                }}>
                                    {device.os === 'ios' ? <Apple size={16} /> : <Smartphone size={16} />}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontWeight: 700,
                                        fontSize: '0.85rem',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        color: 'var(--text-primary)'
                                    }}>
                                        {device.name}
                                    </div>
                                    <div style={{
                                        fontSize: '0.65rem',
                                        color: 'var(--text-muted)',
                                        fontWeight: 500,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap'
                                    }}>
                                        {device.model}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                                    {selectedDevice?.id === device.id && (
                                        <CheckCircle size={14} color="var(--primary)" fill="white" />
                                    )}
                                    {device.status.includes('Device') || device.status.includes('Connected') ? (
                                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success)' }}></div>
                                    ) : (
                                        <AlertCircle size={12} color="var(--warning)" />
                                    )}
                                </div>
                            </button>

                            {/* Individual Disconnect Button */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDisconnectDevice(device);
                                }}
                                style={{
                                    position: 'absolute',
                                    right: '-8px',
                                    top: '-8px',
                                    background: '#ef4444',
                                    color: 'white',
                                    border: '2.5px solid white',
                                    borderRadius: '50%',
                                    width: '28px',
                                    height: '28px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    zIndex: 20,
                                    boxShadow: '0 4px 12px rgba(239, 68, 68, 0.4)'
                                }}
                                title="Bağlantıyı Kes"
                            >
                                <X size={16} strokeWidth={4} color="white" />
                            </button>
                        </div>
                    ))
                )}
            </div>

            <div style={{
                padding: '12px 16px',
                borderTop: '1px solid var(--border-light)',
                background: 'white'
            }}>
                <button
                    className="btn btn-primary"
                    onClick={onDisconnectAll}
                    style={{ width: '100%', height: '38px', fontSize: '0.75rem', borderRadius: '10px' }}
                >
                    Tüm Bağlantıları Kes
                </button>
            </div>
        </div>
    );
}
