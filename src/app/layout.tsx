import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'AttendPro | Neon',description:'Employee attendance system'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl"><body>{children}</body></html>}
