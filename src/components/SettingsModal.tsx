import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Settings, Globe, Monitor, HelpCircle, FolderOpen, Check, X } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  setMessage: (msg: { type: 'success' | 'error' | 'info'; text: string }) => void;
}

export type BrowserPreference = 'extension' | 'standalone' | 'ask';

export default function SettingsModal({ isOpen, onClose, setMessage }: SettingsModalProps) {
  const [browserPref, setBrowserPref] = useState<BrowserPreference>('extension');
  const [copiedFolder, setCopiedFolder] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const stored = localStorage.getItem('geoshift_browser_preference');
      if (stored === 'extension' || stored === 'standalone') {
        setBrowserPref(stored);
      } else {
        setBrowserPref('ask');
      }
      setCopiedFolder(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (browserPref === 'ask') {
      localStorage.removeItem('geoshift_browser_preference');
    } else {
      localStorage.setItem('geoshift_browser_preference', browserPref);
    }
    setMessage({ type: 'success', text: '✅ Ayarlar başarıyla kaydedildi.' });
    onClose();
  };

  const handleOpenFolder = async () => {
    try {
      const path = await invoke<string>('open_extension_folder');
      if (path && navigator.clipboard) {
        await navigator.clipboard.writeText(path);
        setCopiedFolder(true);
        setTimeout(() => setCopiedFolder(false), 3000);
      }
      setMessage({ type: 'success', text: '📁 Eklenti klasörü açıldı ve adresi panoya kopyalandı.' });
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: 'Eklenti klasörü açılamadı: ' + String(e) });
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(8px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        background: 'white',
        borderRadius: '16px',
        maxWidth: '520px',
        width: '100%',
        padding: '24px',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
        border: '1px solid #e2e8f0',
        textAlign: 'left',
        maxHeight: '90vh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #f1f5f9', paddingBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: '#e0e7ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#4338ca'
            }}>
              <Settings size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#1e293b' }}>
                Uygulama Ayarları
              </h3>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>
                Tarayıcı bağlantı tercihi ve eklenti yönetimi
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#94a3b8',
              padding: '6px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = '#fee2e2'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'none'; }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Section 1: Tarayıcı Bağlantı Tercihi */}
        <div>
          <label style={{ fontSize: '0.85rem', fontWeight: 800, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <Globe size={16} color="var(--primary)" /> Tarayıcı Bağlantı Yöntemi
          </label>
          <p style={{ margin: '0 0 12px 0', fontSize: '0.76rem', color: '#64748b', lineHeight: 1.4 }}>
            Listeden bir tarayıcı (Chrome, Edge, Brave, Opera) seçtiğinizde varsayılan olarak hangi yöntemle çalışılacağını belirleyin:
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Seçenek 1: Eklenti */}
            <div
              onClick={() => setBrowserPref('extension')}
              style={{
                padding: '12px 14px',
                borderRadius: '12px',
                border: browserPref === 'extension' ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                background: browserPref === 'extension' ? '#eef2ff' : '#f8fafc',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#312e81', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Globe size={16} color="#4f46e5" /> GeoShift Eklentisi İle (Önerilen)
                </span>
                {browserPref === 'extension' && <Check size={18} color="#4f46e5" strokeWidth={3} />}
              </div>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#4b5563', lineHeight: 1.4 }}>
                Ayrı pencere açmaz. Mevcut açık sekmelerinizde (Google Maps vb.) konumu doğrudan ve kesintisiz senkronize eder.
              </p>
            </div>

            {/* Seçenek 2: Ayrı Pencere */}
            <div
              onClick={() => setBrowserPref('standalone')}
              style={{
                padding: '12px 14px',
                borderRadius: '12px',
                border: browserPref === 'standalone' ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                background: browserPref === 'standalone' ? '#eef2ff' : '#f8fafc',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#312e81', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Monitor size={16} color="#4f46e5" /> Ayrı Pencere (Hata Ayıklama Modu)
                </span>
                {browserPref === 'standalone' && <Check size={18} color="#4f46e5" strokeWidth={3} />}
              </div>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#4b5563', lineHeight: 1.4 }}>
                Hata ayıklama portunda (9222) bağımsız yeni bir izole tarayıcı penceresi açar.
              </p>
            </div>

            {/* Seçenek 3: Her Seferinde Sor */}
            <div
              onClick={() => setBrowserPref('ask')}
              style={{
                padding: '12px 14px',
                borderRadius: '12px',
                border: browserPref === 'ask' ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                background: browserPref === 'ask' ? '#eef2ff' : '#f8fafc',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#312e81', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <HelpCircle size={16} color="#4f46e5" /> Her Seferinde Sor
                </span>
                {browserPref === 'ask' && <Check size={18} color="#4f46e5" strokeWidth={3} />}
              </div>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#4b5563', lineHeight: 1.4 }}>
                Tarayıcı seçtiğinizde hangi yöntemi kullanmak istediğinizi soran pencereyi tekrar gösterir.
              </p>
            </div>
          </div>
        </div>

        {/* Section 2: Eklenti Klasörü ve Kurulum */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
          <div style={{ fontWeight: 800, fontSize: '0.82rem', color: '#1e293b', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <FolderOpen size={16} color="#4f46e5" /> Eklenti Dosyaları
          </div>
          <p style={{ margin: '0 0 10px 0', fontSize: '0.75rem', color: '#64748b', lineHeight: 1.4 }}>
            Eklentiyi tarayıcınıza yüklemek veya güncellemek için eklenti klasörünü açabilirsiniz:
          </p>

          <button
            onClick={handleOpenFolder}
            className="btn btn-secondary"
            style={{ width: '100%', height: '36px', fontSize: '0.78rem', gap: '8px', fontWeight: 700 }}
          >
            {copiedFolder ? <Check size={15} color="#16a34a" /> : <FolderOpen size={15} />}
            {copiedFolder ? 'Klasör Açıldı & Adres Kopyalandı!' : 'Eklenti Klasörünü Aç (Adres Otomatik Kopyalanır)'}
          </button>
        </div>

        {/* Footer Actions */}
        <div style={{ display: 'flex', gap: '10px', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ flex: 1, height: '42px', fontSize: '0.85rem' }}
          >
            Vazgeç
          </button>
          <button
            onClick={handleSave}
            className="btn btn-primary"
            style={{ flex: 1.5, height: '42px', fontSize: '0.85rem', fontWeight: 800 }}
          >
            Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}
