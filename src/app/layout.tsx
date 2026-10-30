import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'AttendPro | Neon',description:'Employee attendance system'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en" dir="ltr"><head><link rel="manifest" href="/manifest.webmanifest"/><meta name="theme-color" content="#009b67"/></head><body>{children}</body></html>}
