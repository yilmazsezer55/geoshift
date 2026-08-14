import { useState, useEffect } from 'react';
import splashImg from '../assets/splash.png';

export default function Splash({ onFinish }: { onFinish: () => void }) {
    const [progress, setProgress] = useState(0);
    const [isFading, setIsFading] = useState(false);

    useEffect(() => {
        const interval = setInterval(() => {
            setProgress(prev => {
                const next = prev + Math.random() * 8;
                if (next >= 100) {
                    clearInterval(interval);
                    setTimeout(() => setIsFading(true), 1200);
                    setTimeout(() => {
                        // Remove the anti-flicker class right before finishing
                        document.getElementById('root')?.classList.remove('app-splash-active');
                        onFinish();
                    }, 1800);
                    return 100;
                }
                return next;
            });
        }, 100);

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
                backdropFilter: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100000,
                transition: 'opacity 0.6s ease',
                opacity: isFading ? 0 : 1,
                pointerEvents: isFading ? 'none' : 'auto',
            }}
        >
            {/* Compact Floating Splash Window (iMyFone Style) */}
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
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                border: 'none',
                backgroundColor: 'transparent'
            }}>
                {/* Refined Progress Bar with white color */}
                <div style={{
                    width: '90%',
                    marginBottom: '15px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    zIndex: 2
                }}>
                    <div style={{
                        width: '100%',
                        height: '10px',
                        background: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: '5px',
                        overflow: 'hidden',
                        backdropFilter: 'blur(4px)',
                        border: '1px solid rgba(255,255,255,0.1)'
                    }}>
                        <div style={{
                            width: `${progress}%`,
                            height: '100%',
                            background: '#ffffff',
                            boxShadow: '0 0 15px rgba(255, 255, 255, 0.6)',
                            transition: 'width 0.4s cubic-bezier(0.1, 0.5, 0.5, 1)',
                            borderRadius: '5px'
                        }} />
                    </div>
                </div>
            </div>
        </div>
    );
}
