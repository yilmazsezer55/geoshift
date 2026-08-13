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
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000,
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
                // TOTAL SILENCE: No shadow, no border to eliminate "ghost lines"
                boxShadow: 'none',
                border: 'none',
                backgroundColor: 'transparent'
            }}>
                {/* Refined Progress Bar with branded color instead of white */}
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
                        height: '12px',
                        background: 'rgba(15, 23, 42, 0.35)',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(255,255,255,0.08)'
                    }}>
                        <div style={{
                            width: `${progress}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, #4f46e5, #4338ca)',
                            boxShadow: '0 0 18px rgba(79, 70, 229, 0.35)',
                            transition: 'width 0.4s cubic-bezier(0.1, 0.5, 0.5, 1)',
                            borderRadius: '6px'
                        }} />
                    </div>
                </div>
            </div>
        </div>
    );
}
