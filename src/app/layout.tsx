import './globals.css';
import type {Metadata} from 'next';
export const metadata:Metadata={title:'Attendance Management System',description:'Secure workforce attendance and operations'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
