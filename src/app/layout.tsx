import type {Metadata,Viewport} from 'next';
import './globals.css';
import './theme.css';
export const metadata:Metadata={title:'AttendPro | Neon',description:'Employee attendance system'};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#009b67'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en" dir="ltr"><head><link rel="manifest" href="/manifest.webmanifest"/><link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin=""/><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"/></head><body>{children}</body></html>}
