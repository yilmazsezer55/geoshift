import React, { useState } from 'react';
import { ShieldAlert, Check, AlertTriangle } from 'lucide-react';

interface LegalDisclaimerProps {
    onAccept: () => void;
}

const LegalDisclaimer: React.FC<LegalDisclaimerProps> = ({ onAccept }) => {
    const [agreed, setAgreed] = useState(false);

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999999,
            padding: '20px'
        }}>
            <div style={{
                maxWidth: '560px',
                width: '100%',
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                borderRadius: '24px',
                padding: '40px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                display: 'flex',
                flexDirection: 'column',
                gap: '24px',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                animation: 'fadeUp 0.4s ease-out'
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '16px' }}>
                    <div style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '20px',
                        backgroundColor: '#fef3c7',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#d97706'
                    }}>
                        <ShieldAlert size={32} />
                    </div>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1e293b', margin: 0 }}>Yasal Sorumluluk Sınırlandırması</h2>
                </div>

                <div style={{
                    backgroundColor: '#f8fafc',
                    borderRadius: '16px',
                    padding: '20px',
                    fontSize: '0.95rem',
                    lineHeight: '1.6',
                    color: '#475569',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    border: '1px solid #e2e8f0'
                }}>
                    <p style={{ marginTop: 0 }}><strong>GeoShift</strong>, yazılım geliştirme, hata ayıklama ve test süreçlerinde yardımcı olması amacıyla tasarlanmış bir araçtır.</p>

                    <p>Uygulamayı kullanarak aşağıdaki şartları kabul etmiş sayılırsınız:</p>

                    <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <li>Konum değiştirme özelliğinin kullanımı sonucu üçüncü taraf uygulamalarda (oyunlar, sosyal medya, bankacılık vb.) yaşanabilecek hesap kısıtlamaları veya engellemelerden tamamen <strong>kullanıcı sorumludur</strong>.</li>
                        <li>GeoShift, bu aracın kötüye kullanımı veya hizmet şartlarına aykırı kullanımı nedeniyle oluşabilecek zararlardan sorumlu tutulamaz.</li>
                        <li>Bu araç, yerel yasalara ve kullandığınız diğer hizmetlerin kullanım koşullarına uygun olarak kullanılmalıdır.</li>
                    </ul>

                    <div style={{
                        marginTop: '15px',
                        padding: '12px',
                        backgroundColor: '#fffbeb',
                        borderRadius: '12px',
                        border: '1px solid #fef3c7',
                        display: 'flex',
                        gap: '12px',
                        color: '#92400e',
                        fontSize: '0.85rem'
                    }}>
                        <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                        <span>Sorumsuz kullanım, kullandığınız platformlardaki hesaplarınızın kalıcı olarak kapatılmasına neden olabilir.</span>
                    </div>
                </div>

                <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    padding: '4px'
                }}>
                    <div
                        onClick={() => setAgreed(!agreed)}
                        style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '6px',
                            border: `2px solid ${agreed ? '#4f46e5' : '#cbd5e1'}`,
                            backgroundColor: agreed ? '#4f46e5' : 'transparent',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'white',
                            transition: 'all 0.2s'
                        }}
                    >
                        {agreed && <Check size={16} strokeWidth={3} />}
                    </div>
                    <span style={{ fontSize: '0.9rem', color: '#1e293b', fontWeight: 500 }}>
                        Şartları okudum ve tüm sorumluluğu kabul ediyorum.
                    </span>
                    <input
                        type="checkbox"
                        checked={agreed}
                        onChange={() => setAgreed(!agreed)}
                        style={{ display: 'none' }}
                    />
                </label>

                <button
                    disabled={!agreed}
                    onClick={onAccept}
                    style={{
                        backgroundColor: agreed ? '#4f46e5' : '#94a3b8',
                        color: 'white',
                        border: 'none',
                        borderRadius: '14px',
                        padding: '16px',
                        fontSize: '1rem',
                        fontWeight: 700,
                        cursor: agreed ? 'pointer' : 'not-allowed',
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        boxShadow: agreed ? '0 10px 15px -3px rgba(79, 70, 229, 0.4)' : 'none',
                        transform: agreed ? 'scale(1)' : 'scale(1)',
                    }}
                    onMouseEnter={(e) => agreed && (e.currentTarget.style.backgroundColor = '#4338ca')}
                    onMouseLeave={(e) => agreed && (e.currentTarget.style.backgroundColor = '#4f46e5')}
                >
                    Kabul Et ve Başlat
                </button>
            </div>
        </div>
    );
};

export default LegalDisclaimer;
