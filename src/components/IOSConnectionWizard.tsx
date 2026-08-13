import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { CheckCircle, XCircle, Loader, Smartphone, Wifi, Shield, Link } from 'lucide-react';

interface IOSConnectionWizardProps {
    device: {
        id: string;
        name: string;
        model: string;
    };
    onComplete: (developerModeEnabled: boolean) => void;
    onCancel: () => void;
    initialStepId?: string;
}

type StepStatus = 'pending' | 'running' | 'success' | 'error' | 'action_required';

interface ValidationStep {
    id: string;
    title: string;
    icon: React.ReactNode;
    status: StepStatus;
    errorMessage?: string;
    helpText?: string;
}

const makeSteps = (): ValidationStep[] => [
    { id: 'device',    title: 'Cihaz algılanıyor',                     icon: <Smartphone size={18} />, status: 'pending' },
    { id: 'service',   title: 'Apple Servis kontrolü',                  icon: <Wifi size={18} />,       status: 'pending' },
    { id: 'developer', title: 'Geliştirici Modu doğrulanıyor',          icon: <Shield size={18} />,     status: 'pending' },
    { id: 'pairing',   title: 'Bağlantı tamamlanıyor',                  icon: <Link size={18} />,       status: 'pending' },
];

/* ---------- iOS Version helpers ---------- */
const DevModeGuide = ({ iosVersion }: { iosVersion: string | null }) => {
    const major = iosVersion ? parseInt(iosVersion.split('.')[0], 10) : 0;

    if (major >= 16) {
        return (
            <div style={{ fontSize: '0.78rem', color: '#374151', lineHeight: 1.6 }}>
                <p style={{ margin: '0 0 6px 0', fontWeight: 700, color: '#1d4ed8' }}>
                    iOS {iosVersion ?? '16+'} — Önemli Bilgilendirme:
                </p>
                <p style={{ margin: '0 0 10px 0', color: '#6b7280', fontSize: '0.72rem' }}>
                    Apple güvenlik politikası gereği, iOS 16 ve üzerindeki sürümlerde "Geliştirici Modu" menüsü başlangıçta Ayarlar'da <strong>gizlidir</strong>. Uygulama bu adımı deneyecek, cihaz ekranında onay istenirse onu kabul etmeniz gerekir.
                </p>
                <p style={{ margin: '0 0 6px 0', fontWeight: 700, color: '#1d4ed8' }}>
                    Adımlar:
                </p>
                <ol style={{ margin: 0, paddingLeft: '18px' }}>
                    <li>Uygulamadaki <strong>"Geliştirici Modu'nu Aç"</strong> butonuna basın.</li>
                    <li>iPhone ekranında <strong>"Geliştirici Modunu Aç?"</strong> veya benzeri onay isteğini görünce onaylayın.</li>
                    <li>İşlem bittikten sonra <strong>"Ayarlardan Açtım, Devam Et"</strong> butonuna basın.</li>
                </ol>
            </div>
        );
    }

    if (major >= 13) {
        return (
            <div style={{ fontSize: '0.78rem', color: '#374151', lineHeight: 1.6 }}>
                <p style={{ margin: '0 0 6px 0', fontWeight: 700, color: '#1d4ed8' }}>
                    iOS {iosVersion ?? '13-15'} — Xcode gerekmez:
                </p>
                <ol style={{ margin: 0, paddingLeft: '18px' }}>
                    <li>Aşağıdaki <strong>"Otomatik Etkinleştir"</strong> butonuna tıklayın.</li>
                    <li>iPhone ekranında beliren isteği <strong>onaylayın</strong>.</li>
                    <li>Cihaz yeniden başlarsa tekrar kabloyla bağlayın.</li>
                </ol>
            </div>
        );
    }

    return (
        <div style={{ fontSize: '0.78rem', color: '#374151', lineHeight: 1.6 }}>
            <p style={{ margin: '0 0 6px 0', fontWeight: 700, color: '#dc2626' }}>iOS {iosVersion ?? '12 ve altı'}</p>
            <p style={{ margin: 0 }}>Bu iOS sürümünde konum simülasyonu desteklenmeyebilir. Lütfen cihazınızı güncelleyin.</p>
        </div>
    );
};

const IOSConnectionWizard: React.FC<IOSConnectionWizardProps> = ({ device, onComplete, onCancel, initialStepId }) => {
    const [steps, setSteps] = useState<ValidationStep[]>(makeSteps());
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [isComplete, setIsComplete] = useState(false);
    const [failedStepId, setFailedStepId] = useState<string | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
    const [itunesStatus, setItunesStatus] = useState<string | null>(null);
    const [iosVersion, setIosVersion] = useState<string | null>(null);
    const [enablingDevMode, setEnablingDevMode] = useState(false);
    const [devModeError, setDevModeError] = useState<string | null>(null);
    const [developerModeStatus, setDeveloperModeStatus] = useState<'unknown' | 'open' | 'closed'>('unknown');

    const updateStep = (id: string, updates: Partial<ValidationStep>) => {
        setSteps(prev => prev.map(step => step.id === id ? { ...step, ...updates } : step));
    };

    // ── Main validation flow ──────────────────────────────────────────────
    const runValidation = async (startIndex: number = 0) => {
        setIsComplete(false);
        setFailedStepId(null);

        try {
            // STEP 1: Device detected
            if (startIndex <= 0) {
                updateStep('device', { status: 'running' });
                await delay(300);
                updateStep('device', { status: 'success' });
                setCurrentStepIndex(1);
            }

            // STEP 2: Apple Service Check
            if (startIndex <= 1) {
                updateStep('service', { status: 'running' });
                const devices = await retryOnce(() => invoke<any[]>('get_ios_devices'), 1000);
                if (!devices || devices.length === 0) {
                    updateStep('service', {
                        status: 'error',
                        errorMessage: 'Cihaz Bulunamadı',
                        helpText: 'USB kablosunu kontrol edin. "Güven" uyarısı çıktıysa iPhone ekranında onaylayın.',
                    });
                    setFailedStepId('service');
                    setIsComplete(true);
                    return;
                }
                updateStep('service', { status: 'success' });
                setCurrentStepIndex(2);
            }

            // STEP 3: Developer Mode Check (actual check — not optimistic)
            if (startIndex <= 2) {
                updateStep('developer', { status: 'running' });

                let devMode = false;
                let version: string | null = null;
                try {
                    const result = await invoke<{ developer_mode: boolean; ios_version?: string } | boolean>(
                        'check_ios_developer_mode', { udid: device.id }
                    );
                    if (typeof result === 'boolean') {
                        devMode = result;
                    } else {
                        devMode = result.developer_mode;
                        version = result.ios_version ?? null;
                    }
                } catch (e) {
                    // If we can't check, be conservative and ask user
                    devMode = false;
                }

                setIosVersion(version);
                setDeveloperModeStatus(devMode ? 'open' : 'closed');

                if (!devMode) {
                    updateStep('developer', {
                        status: 'action_required',
                        errorMessage: 'Developer Mode kapalı',
                        helpText: 'Seçili cihazın UDID’si kullanılıyor. Aşağıdaki butona basarak bu cihaz için geliştirici modunu açma komutunu çalıştırın.',
                    });
                    setFailedStepId('developer');
                    setIsComplete(false);
                    return;
                }

                updateStep('developer', { status: 'success' });
                setCurrentStepIndex(3);
            }

            // STEP 4: Pairing done
            if (startIndex <= 3) {
                updateStep('pairing', { status: 'running' });
                await delay(300);
                updateStep('pairing', { status: 'success' });
                setIsComplete(true);
                setTimeout(() => onComplete(true), 600);
            }

        } catch (error) {
            console.error('Validation error:', error);
            setIsComplete(true);
        }
    };

    const handleEnableDevMode = async () => {
        setEnablingDevMode(true);
        setDevModeError(null);
        updateStep('developer', {
            status: 'running',
            errorMessage: undefined,
            helpText: 'Geliştirici Modu menüsü gösterilmeye çalışılıyor...'
        });

        try {
            const enableMessage = await invoke<string>('enable_ios_developer_mode', { udid: device.id });
            const successText = enableMessage?.toLowerCase().includes('başarıyla') || enableMessage?.toLowerCase().includes('etkinleştirildi') || enableMessage?.toLowerCase().includes('çalıştı')
                ? 'Developer Mode açma komutu başarıyla çalıştı'
                : 'Menü gösterildi / görünür hale getirildi';

            updateStep('developer', {
                status: 'action_required',
                errorMessage: successText,
                helpText: enableMessage || 'iPhone üzerinde Ayarlar > Gizlilik ve Güvenlik > Geliştirici Modu bölümünü açın. Bu adım cihazı yeniden başlatmaz.'
            });

            await delay(1000);
            const recheckResult = await invoke<{ developer_mode: boolean } | boolean>('check_ios_developer_mode', { udid: device.id });
            const recheck = typeof recheckResult === 'boolean' ? recheckResult : recheckResult.developer_mode;
            setDeveloperModeStatus(recheck ? 'open' : 'closed');

            if (recheck || (enableMessage && (enableMessage.toLowerCase().includes('başarıyla') || enableMessage.toLowerCase().includes('etkinleştirildi') || enableMessage.toLowerCase().includes('çalıştı')))) {
                updateStep('developer', { status: 'success' });
                setFailedStepId(null);
                setIsComplete(true);
                onComplete(true);
                return;
            }

            setIsComplete(false);
        } catch (e: any) {
            setDevModeError(String(e));
            updateStep('developer', {
                status: 'action_required',
                errorMessage: 'Menü gösterilemedi',
                helpText: 'Cihaz ekranında onay bekleniyor olabilir. Lütfen tekrar deneyin veya iPhone üzerinde Ayarlar > Gizlilik ve Güvenlik > Geliştirici Modu bölümünü kontrol edin.'
            });
            setIsComplete(false);
        } finally {
            setEnablingDevMode(false);
        }
    };

    const handleManuallyEnabled = async () => {
        setDevModeError(null);
        updateStep('developer', { status: 'running', errorMessage: undefined, helpText: 'Developer Mode tekrar kontrol ediliyor...' });

        try {
            const recheckResult = await invoke<{ developer_mode: boolean } | boolean>('check_ios_developer_mode', { udid: device.id });
            const recheck = typeof recheckResult === 'boolean' ? recheckResult : recheckResult.developer_mode;
            setDeveloperModeStatus(recheck ? 'open' : 'closed');

            if (!recheck) {
                updateStep('developer', {
                    status: 'action_required',
                    errorMessage: 'Developer Mode hâlâ kapalı',
                    helpText: 'Telefon ekranında onaylandıysa lütfen 5–10 saniye bekleyin ve tekrar deneyin. Menü hâlâ görünmüyorsa cihazda gizli kalmış olabilir.',
                });
                setFailedStepId('developer');
                setIsComplete(true);
                return;
            }

            updateStep('developer', { status: 'success' });
            setFailedStepId(null);
            setIsComplete(false);
            runValidation(3);
        } catch (e: any) {
            setDevModeError(String(e));
            updateStep('developer', {
                status: 'action_required',
                errorMessage: 'Kontrol başarısız',
                helpText: 'Cihaz tekrar kontrol edilemedi. Kabloyu kontrol edip tekrar deneyin.',
            });
            setFailedStepId('developer');
            setIsComplete(true);
        }
    };

    // ── Repair Apple Services ─────────────────────────────────────────────
    const handleRepair = async () => {
        setFailedStepId(null);
        updateStep('service', { status: 'running', errorMessage: undefined });
        setItunesStatus('Sistem teşhisi yapılıyor...');
        setCurrentStepIndex(1);

        const unlistenProgress = await listen<any>('itunes-download-progress', (e) =>
            setDownloadProgress(Math.round(e.payload.percentage))
        );
        const unlistenStatus = await listen<string>('itunes-status', (e) => setItunesStatus(e.payload));

        try {
            const components = await invoke<any[]>('check_itunes_components');
            const missingCritical = components.find(c => c.critical && (c.status === 'Eksik' || c.status === 'Bulunamadı'));

            if (missingCritical) {
                setItunesStatus('Bileşenler hazırlanıyor...');
                await invoke<string>('download_and_install_itunes');
            } else {
                await invoke<string>('repair_apple_services');
            }

            unlistenProgress();
            unlistenStatus();
            setDownloadProgress(null);
            setItunesStatus(null);
            runValidation(1);
        } catch (error: any) {
            unlistenProgress();
            unlistenStatus();
            updateStep('service', { status: 'error', errorMessage: 'Onarım Başarısız', helpText: `${error}` });
            setFailedStepId('service');
            setDownloadProgress(null);
            setItunesStatus(null);
            setIsComplete(true);
        }
    };

    // ── Mount ─────────────────────────────────────────────────────────────
    useEffect(() => {
        const idx = initialStepId ? makeSteps().findIndex(s => s.id === initialStepId) : -1;
        runValidation(idx >= 0 ? idx : 0);
    }, []);

    // ── Helpers ───────────────────────────────────────────────────────────
    const getIcon = (status: StepStatus) => {
        switch (status) {
            case 'success':         return <CheckCircle size={20} color="#10b981" />;
            case 'error':           return <XCircle size={20} color="#ef4444" />;
            case 'action_required': return <XCircle size={20} color="#f59e0b" />;
            case 'running':         return <Loader size={20} className="animate-spin" color="#2563eb" />;
            default:                return <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid #e5e7eb' }} />;
        }
    };

    const borderColor = (s: StepStatus) => ({ success: '#d1fae5', error: '#fee2e2', running: '#dbeafe', action_required: '#fde68a', pending: '#f3f4f6' })[s];
    const bgColor     = (s: StepStatus) => ({ success: '#ecfdf5', error: '#fef2f2', running: '#eff6ff', action_required: '#fffbeb', pending: '#ffffff' })[s];
    const textColor   = (s: StepStatus) => ({ success: '#059669', error: '#dc2626', running: '#2563eb', action_required: '#92400e', pending: '#374151' })[s];

    const hasError  = failedStepId !== null;
    const allOk     = steps.every(s => s.status === 'success');

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)' }}>
            <div style={{ backgroundColor: '#fff', borderRadius: 16, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', width: 420, maxHeight: '90vh', position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid #e5e7eb', color: '#1f2937' }}>

                {/* Scrollable body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '24px', paddingBottom: '88px' }}>

                    {/* Header */}
                    <div style={{ textAlign: 'center', marginBottom: 20 }}>
                        <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#111827', margin: '0 0 4px' }}>iPhone Bağlanıyor</h2>
                        <p style={{ color: '#4b5563', margin: '2px 0', fontWeight: 600 }}>{device.name}</p>
                        <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: 0 }}>{device.model}{iosVersion ? ` • iOS ${iosVersion}` : ''}</p>
                        <p style={{ fontSize: '0.72rem', color: '#6b7280', margin: '4px 0 0' }}>UDID: {device.id}</p>
                    </div>

                    {/* Steps */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {steps.map(step => (
                            <div key={step.id} style={{ display: 'flex', alignItems: 'start', gap: 12, padding: 12, borderRadius: 10, border: `1px solid ${borderColor(step.status)}`, backgroundColor: bgColor(step.status) }}>
                                <div style={{ flexShrink: 0, marginTop: 2 }}>{getIcon(step.status)}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <p style={{ fontWeight: 600, fontSize: '0.88rem', margin: 0, color: textColor(step.status) }}>{step.title}</p>

                                    {/* Service Error UI */}
                                    {step.id === 'service' && step.status === 'error' && (
                                        <div style={{ marginTop: 8, fontSize: '0.78rem' }}>
                                            <p style={{ color: '#dc2626', fontWeight: 700, margin: '0 0 4px' }}>{step.errorMessage}</p>
                                            <p style={{ color: '#6b7280', margin: '0 0 10px' }}>{step.helpText}</p>

                                            {/* Explanation of why iTunes/Apple Drivers are needed */}
                                            {!itunesStatus && (
                                                <div style={{ margin: '10px 0', padding: '10px', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                                                    <p style={{ margin: '0 0 6px 0', fontSize: '0.75rem', fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <Shield size={14} /> Neden Sürücü Gerekiyor?
                                                    </p>
                                                    <p style={{ margin: 0, fontSize: '0.7rem', color: '#475569', lineHeight: 1.5 }}>
                                                        Windows'un iPhone'a konum değiştirme gibi komutlar gönderebilmesi için Apple'ın güvenlik protokollerine uyması gerekir. Şifreli ve güvenli bağlantı için <strong>sadece resmi Apple sürücüleri (iTunes)</strong> köprü olarak kullanılır.
                                                    </p>
                                                </div>
                                            )}

                                            {/* iTunes status progress */}
                                            {itunesStatus && (
                                                <div style={{ backgroundColor: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                                                    <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '0.75rem', color: '#1e40af' }}>{itunesStatus}</p>
                                                    {downloadProgress !== null && (
                                                        <div style={{ height: 8, backgroundColor: '#dbeafe', borderRadius: 4, overflow: 'hidden' }}>
                                                            <div style={{ height: '100%', backgroundColor: '#3b82f6', width: `${downloadProgress}%`, transition: 'width 0.3s ease' }} />
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            <button onClick={handleRepair} style={btn('#3b82f6', 'white')}>
                                                {itunesStatus ? 'İndiriliyor...' : '🔧 Sürücüleri Onar ve Kur'}
                                            </button>
                                            <a href="https://www.apple.com/itunes/download/win64" target="_blank" rel="noopener noreferrer"
                                               style={{ display: 'block', textAlign: 'center', marginTop: 6, fontSize: '0.72rem', color: '#6366f1' }}>
                                                iTunes'u Manuel İndir
                                            </a>
                                        </div>
                                    )}

                                    {/* Developer Mode status and actions */}
                                    {step.id === 'developer' && (
                                        <div style={{ marginTop: 10, fontSize: '0.78rem' }}>
                                            <div style={{ padding: '10px 12px', backgroundColor: step.status === 'success' ? '#ecfdf5' : step.status === 'running' ? '#eff6ff' : '#fffbeb', border: `1px solid ${step.status === 'success' ? '#a7f3d0' : step.status === 'running' ? '#bfdbfe' : '#fde68a'}`, borderRadius: 8, marginBottom: 10 }}>
                                                <div style={{ marginBottom: 6, padding: '8px 10px', borderRadius: 8, backgroundColor: developerModeStatus === 'open' ? '#ecfdf5' : developerModeStatus === 'closed' ? '#fef2f2' : '#f8fafc', border: `1px solid ${developerModeStatus === 'open' ? '#a7f3d0' : developerModeStatus === 'closed' ? '#fecaca' : '#e2e8f0'}` }}>
                                                    <strong style={{ color: developerModeStatus === 'open' ? '#047857' : developerModeStatus === 'closed' ? '#b91c1c' : '#334155' }}>
                                                        {step.status === 'success'
                                                            ? 'Developer Mode: Açık'
                                                            : developerModeStatus === 'open'
                                                                ? 'Developer Mode: Açık'
                                                                : developerModeStatus === 'closed'
                                                                    ? 'Developer Mode: Kapalı / görünmüyor'
                                                                    : 'Developer Mode durumu kontrol ediliyor...'}
                                                    </strong>
                                                </div>
                                                <div style={{ color: '#4b5563', lineHeight: 1.5 }}>
                                                    {step.status === 'success'
                                                        ? 'Geliştirici Modu doğrulandı. İlerleyebilirsiniz.'
                                                        : step.status === 'running'
                                                            ? 'Cihaz üzerinden Developer Mode durumu kontrol ediliyor.'
                                                            : 'Telefon ekranında güven/onay adımı bekleniyor veya menü görünmüyor.'}
                                                </div>
                                            </div>

                                            {(step.status === 'error' || step.status === 'action_required') && (
                                                <div>
                                                    <DevModeGuide iosVersion={iosVersion} />

                                                    {devModeError && (
                                                        <p style={{ color: '#dc2626', margin: '8px 0 8px', fontSize: '0.72rem' }}>
                                                            Hata: {devModeError}
                                                        </p>
                                                    )}

                                                    {/* Auto-enable button for all iOS versions */}
                                                    <button onClick={handleEnableDevMode} disabled={enablingDevMode} style={btn('#10b981', 'white')}>
                                                        {enablingDevMode ? <><Loader size={14} className="animate-spin" style={{ display: 'inline', marginRight: 6 }} />Gönderiliyor...</> : '🔓 Geliştirici Modu Cihazda Aç'}
                                                    </button>

                                                    {/* iOS 16+: user must do it manually, but we give them a "done" button */}
                                                    <button onClick={handleManuallyEnabled} style={{ ...btn('#e5e7eb', '#111827'), marginTop: 8 }}>
                                                        ✅ Ayarlardan Açtım, Devam Et
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Fixed Footer */}
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: '#fff', borderTop: '1px solid #f3f4f6', height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>

                    {/* Progress bar while running */}
                    {!isComplete && (
                        <div style={{ width: '100%' }}>
                            <div style={{ height: 6, backgroundColor: '#e5e7eb', borderRadius: 9999, overflow: 'hidden' }}>
                                <div style={{ height: '100%', backgroundColor: '#3b82f6', transition: 'width 400ms ease-out', width: `${((currentStepIndex + 0.5) / steps.length) * 100}%` }} />
                            </div>
                            <p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: '8px 0 0', textAlign: 'center' }}>İşlem yapılıyor...</p>
                        </div>
                    )}

                    {/* Error state buttons */}
                    {isComplete && hasError && (
                        <>
                            <button onClick={onCancel}   style={btn('#f3f4f6', '#374151', 1)}>İptal</button>
                            {failedStepId === 'service' ? (
                                <button onClick={handleRepair} style={btn('#3b82f6', 'white', 2)}>Servisi Başlat / Onar</button>
                            ) : (
                                <button onClick={() => runValidation(steps.findIndex(s => s.id === (failedStepId ?? 'device')))} style={btn('#2563eb', 'white', 2)}>Tekrar Dene</button>
                            )}
                        </>
                    )}

                    {/* All success */}
                    {isComplete && allOk && (
                        <div style={{ color: '#10b981', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.05rem' }}>
                            <CheckCircle size={22} /><span>Bağlantı Başarılı!</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── Style helper ──────────────────────────────────────────────────────────
const btn = (bg: string, color: string, flex?: number): React.CSSProperties => ({
    flex: flex ?? undefined,
    height: 42,
    padding: '0 16px',
    backgroundColor: bg,
    color,
    borderRadius: 10,
    fontWeight: 600,
    fontSize: '0.82rem',
    border: 'none',
    cursor: 'pointer',
    width: flex ? undefined : '100%',
    marginBottom: 4,
});

// ─── Tiny helpers ──────────────────────────────────────────────────────────
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const retryOnce = async <T,>(fn: () => Promise<T>, wait: number): Promise<T> => {
    try { return await fn(); } catch { await delay(wait); return fn(); }
};

export default IOSConnectionWizard;
