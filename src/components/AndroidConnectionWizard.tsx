import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle, XCircle, Loader, Smartphone, Settings, Shield, Zap, AlertCircle } from 'lucide-react';

interface AndroidConnectionWizardProps {
    device: {
        id: string;
        name: string;
        model: string;
        status: string;
    };
    onComplete: () => void;
    onCancel: () => void;
}

type StepStatus = 'pending' | 'running' | 'success' | 'error' | 'action_required';

interface ValidationStep {
    id: string;
    title: string;
    icon: React.ReactNode;
    status: StepStatus;
    helpText?: string;
}

export default function AndroidConnectionWizard({ device: initialDevice, onComplete, onCancel }: AndroidConnectionWizardProps) {
    const [device, setDevice] = useState(initialDevice);
    const [steps, setSteps] = useState<ValidationStep[]>([
        { id: 'usb_adb', title: 'Geliştirici Seçenekleri ve USB Hata Ayıklama', icon: <Settings size={18} />, status: 'pending' },
        { id: 'trust_pc', title: 'Bilgisayara İzin Verme (ADB Yetkisi)', icon: <Shield size={18} />, status: 'pending' },
        { id: 'helper', title: 'Yardımcı Uygulama Kurulumu', icon: <Zap size={18} />, status: 'pending' },
        { id: 'mock', title: 'Sahte Konum Uygulaması Seçimi', icon: <Smartphone size={18} />, status: 'pending' },
        { id: 'wake_up', title: 'Son Adım: Uygulamayı Başlatma', icon: <AlertCircle size={18} />, status: 'pending' },
    ]);

    const [isComplete, setIsComplete] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const checkInterval = useRef<any>(null);

    const updateStep = (id: string, updates: Partial<ValidationStep>) => {
        setSteps(prev => prev.map(step => step.id === id ? { ...step, ...updates } : step));
    };

    // Bu fonksiyon gerçek ADB cihazlarını tarar
    const scanForAdbDevice = async () => {
        try {
            const adbDevices = await invoke<any[]>('get_android_devices');
            // 'Missing' olmayan, gerçek bir ADB cihazı ara
            const realDevice = adbDevices.find(d => !d.id.startsWith('usb-') && d.os === 'android');

            console.log('--- ADB SERIAL VERIFICATION ---');
            console.log('Wizard initial ID:', initialDevice.id);
            console.log('Adb devices:', adbDevices.map(d => `${d.id} (${d.status})`).join(', '));

            if (realDevice) {
                console.log('Matched Real Serial:', realDevice.id);
            } else {
                console.log("No real ADB device found yet.");
            }
            console.log('-------------------------------');

            return realDevice;
        } catch (e) {
            console.error("Adb scan error:", e);
            return null;
        }
    };

    const runAutoSetup = async () => {
        setError(null);
        setIsSearching(true);

        // --- ADIM 1: Geliştirici Modu & USB Hata Ayıklama ---
        updateStep('usb_adb', { status: 'running', helpText: 'Cihaz taranıyor...' });

        // 3 kez deneme yap (Adb bazen geç algılar)
        let realAdbDevice = null;
        for (let i = 0; i < 3; i++) {
            realAdbDevice = await scanForAdbDevice();
            if (realAdbDevice) break;
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!realAdbDevice) {
            // Cihaz hala ADB tarafından görülmüyor
            updateStep('usb_adb', {
                status: 'action_required',
                helpText: 'Geliştirici Modu veya USB Hata Ayıklama henüz aktif değil veya bilgisayar tarafından tanınmadı. Lütfen: \n1. USB kablosunu çıkarıp takın. \n2. USB modunu "Dosya Transferi" olarak seçin. \n3. Ayarlar > Geliştirici Seçenekleri > USB Hata Ayıklama\'nın açık olduğundan emin olun.'
            });
            setIsSearching(false);
            return;
        }

        // Cihaz bulundu, ID'yi güncelle
        setDevice(realAdbDevice);
        updateStep('usb_adb', { status: 'success', helpText: 'Aktif edildi.' });

        // --- ADIM 2: Bilgisayara İzin Verme ---
        updateStep('trust_pc', { status: 'running', helpText: 'Yetki kontrol ediliyor...' });

        if (realAdbDevice.status === 'Unauthorized') {
            updateStep('trust_pc', {
                status: 'action_required',
                helpText: 'Telefon ekranında çıkan "USB Hata Ayıklamaya İzin Verilsin mi?" sorusuna "Her zaman izin ver" diyerek onay verin.'
            });
            setIsSearching(false);
            return;
        }

        updateStep('trust_pc', { status: 'success', helpText: 'Yetki verildi.' });

        // --- ADIM 3: Yardımcı Uygulama Kurulumu ---
        updateStep('helper', { status: 'running', helpText: 'APK kuruluyor...' });
        try {
            const helperOk = await invoke<boolean>('ensure_android_helper', { deviceId: realAdbDevice.id });
            if (!helperOk) throw new Error('Yükleme başarısız.');

            updateStep('helper', { status: 'success', helpText: 'GeoShift Helper yüklendi.' });
        } catch (e: any) {
            updateStep('helper', { status: 'error', helpText: `Yardımcı uygulama yüklenemedi: ${String(e)}` });
            setIsSearching(false);
            return;
        }

        // --- ADIM 4: Sahte Konum Seçimi ---
        updateStep('mock', {
            status: 'action_required',
            helpText: 'Geliştirici Seçenekleri > "Sahte konum uygulaması seç" kısmına girin ve "Appium Settings" (GeoShift Helper) uygulamasını seçin.'
        });

        // --- ADIM 5: Uygulamayı Uyandırma ---
        updateStep('wake_up', {
            status: 'pending',
            helpText: 'Uygulama otomatik açılmadıysa "Uygulamayı Aç" butonuna basabilir veya telefondan bir kez tıklayabilirsiniz.'
        });

        setIsComplete(true);
        setIsSearching(false);
    };

    const handleWakeUp = async () => {
        try {
            await invoke('wake_up_android', { deviceId: device.id });
        } catch (e) {
            console.error("Wake up failed:", e);
        }
    };

    const handleOpenSettings = async () => {
        try {
            await invoke('open_android_developer_settings', { deviceId: device.id.startsWith('usb-') ? '' : device.id });
        } catch (e) {
            setError('Ayarlar açılamadı. Lütfen telefondan manuel olarak Geliştirici Seçeneklerini açın.');
        }
    };

    useEffect(() => {
        runAutoSetup();
        return () => { if(checkInterval.current) clearInterval(checkInterval.current); };
    }, []);

    const btnStyle = (bg: string, color: string): React.CSSProperties => ({
        padding: '12px 20px', backgroundColor: bg, color, borderRadius: '10px',
        border: 'none', fontWeight: 700, cursor: 'pointer', flex: 1, fontSize: '0.85rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
    });

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)' }}>
            <div className="floating-panel" style={{ width: '440px', padding: '28px', background: 'white' }}>
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                    <h2 style={{ margin: '0 0 8px', fontWeight: 800 }}>Android Bağlanıyor...</h2>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{device.name} {device.model !== 'Bilinmiyor' ? `(${device.model})` : ''}</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                    {steps.map((step) => (
                        <div key={step.id} style={{
                            display: 'flex', gap: '12px', padding: '14px', borderRadius: '14px',
                            border: '1px solid',
                            borderColor: step.status === 'success' ? '#d1fae5' : step.status === 'running' ? '#dbeafe' : step.status === 'action_required' ? '#fde68a' : '#f1f5f9',
                            background: step.status === 'success' ? '#f0fdf4' : step.status === 'running' ? '#eff6ff' : step.status === 'action_required' ? '#fffbeb' : 'white',
                            transition: 'all 0.3s ease'
                        }}>
                            <div style={{ marginTop: '2px' }}>
                                {step.status === 'running' ? <Loader size={20} className="animate-spin" color="var(--primary)" /> :
                                 step.status === 'success' ? <CheckCircle size={20} color="#10b981" /> :
                                 step.status === 'error' ? <XCircle size={20} color="#ef4444" /> :
                                 step.status === 'action_required' ? <AlertCircle size={20} color="#f59e0b" /> :
                                 <div style={{ opacity: 0.3 }}>{step.icon}</div>}
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{step.title}</div>
                                {step.helpText && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{step.helpText}</div>}
                            </div>
                        </div>
                    ))}
                </div>

                {error && <div style={{ padding: '12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '10px', fontSize: '0.8rem', marginBottom: '20px' }}>{error}</div>}

                <div style={{ display: 'flex', gap: '12px' }}>
                    {!isComplete && (
                        <button onClick={onCancel} style={btnStyle('#f1f5f9', '#475569')}>Vazgeç</button>
                    )}

                    {!isComplete && !isSearching && (
                        <button onClick={runAutoSetup} style={btnStyle('var(--primary)', 'white')}>
                            {steps[0].status === 'action_required' ? 'Aktif Ettim, Tekrar Tara' :
                             steps[1].status === 'action_required' ? 'İzin Verdim, Devam Et' : 'Tekrar Dene'}
                        </button>
                    )}

                    {isComplete ? (
                        <>
                            <button onClick={handleWakeUp} style={btnStyle('var(--primary-bg)', 'var(--primary)')}><Smartphone size={16} /> Uygulamayı Aç</button>
                            <button onClick={onComplete} style={btnStyle('var(--primary)', 'white')}>Tamamlandı, Başlat</button>
                        </>
                    ) : (
                        (steps[0].status === 'action_required' || steps[3].status === 'action_required') && (
                            <button onClick={handleOpenSettings} style={btnStyle('var(--primary-bg)', 'var(--primary)')}><Settings size={16} /> Ayarlar Aç</button>
                        )
                    )}
                </div>
            </div>
        </div>
    );
}
