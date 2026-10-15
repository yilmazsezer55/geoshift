import { useState, useEffect } from 'react';
import splashImg from '../assets/splash.png';

export default function Splash({ onFinish }: { onFinish: () => void }) {
    const [progress, setProgress] = useState(0);
    const [isFading, setIsFading] = useState(false);

    useEffect(() => {
        // HTML ön yükleyicideki progress'i React'e aktar (süreklilik hissi)
        const preLoader = document.getElementById('gs-splash');
        const preFill = document.getElementById('sf');
        const currentWidth = preFill ? parseFloat(preFill.style.width) || 5 : 5;
        setProgress(currentWidth);

        // HTML interval'i durdur
        if ((window as any).__gsIv) {
            clearInterval((window as any).__gsIv);
        }

        // HTML splash'ı fading class ile yumuşakça kaldır
        if (preLoader) {
            preLoader.classList.add('fading');
            setTimeout(() => preLoader.remove(), 500);
        }

        // React progress animasyonu – 100'e ulaşınca kapat
        const interval = setInterval(() => {
            setProgress(prev => {
                const next = prev + (Math.random() * 5 + 3);
                if (next >= 100) {
                    clearInterval(interval);
                    setTimeout(() => setIsFading(true), 200);
                    setTimeout(() => {
                        document.getElementById('root')?.classList.remove('app-splash-active');
                        onFinish();
                    }, 600);
                    return 100;
                }
                return next;
            });
        }, 80);

        return () => clearInterval(interval);
    }, [onFinish]);

    return (
        <div
            className="app-splash-visible"
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100000,
                transition: 'opacity 0.5s ease',
                opacity: isFading ? 0 : 1,
                pointerEvents: isFading ? 'none' : 'auto',
            }}
        >
            {/* Floating Splash Card */}
            <div style={{
                width: '640px',
                height: '400px',
                background: `url(${splashImg})`,
                backgroundSize: '100% 100%',
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                padding: '30px',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 32px 64px -16px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255,255,255,0.06)',
                backgroundColor: 'transparent'
            }}>
                <div style={{
                    width: '90%',
                    marginBottom: '15px',
                    zIndex: 2
                }}>
                    <div style={{
                        width: '100%',
                        height: '10px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: '5px',
                        overflow: 'hidden',
                        border: '1px solid rgba(255,255,255,0.12)'
                    }}>
                        <div style={{
                            width: `${progress}%`,
                            height: '100%',
                            background: '#ffffff',
                            boxShadow: '0 0 16px rgba(255, 255, 255, 0.9)',
                            transition: 'width 0.25s ease',
                            borderRadius: '5px'
                        }} />
                    </div>
                </div>
            </div>
        </div>
    );
}
