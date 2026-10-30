"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, MapPinned, CalendarClock, ClipboardList, ChartNoAxesCombined, Settings, LogOut, Clock3 } from "lucide-react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
const nav=[["/admin","Overview",LayoutDashboard],["/admin/employees","Employees",Users],["/admin/geofences","Geofences",MapPinned],["/admin/schedules","Work schedules",CalendarClock],["/admin/requests","Requests",ClipboardList],["/admin/reports","Reports",ChartNoAxesCombined],["/admin/roles","Roles & permissions",Users],["/admin/settings","Settings",Settings]] as const;
export function Shell({children}:{children:React.ReactNode}) {
 const path=usePathname(),{profile}=useAuth();
 return <div className="min-h-screen md:flex">
  <aside className="w-full md:w-64 bg-[#063f31] text-white md:min-h-screen p-5 flex flex-col">
   <div className="flex items-center gap-3 mb-9"><div className="rounded-xl bg-white/10 p-2"><Clock3/></div><div><b>AttendPro</b><p className="text-xs text-emerald-100">Management Console</p></div></div>
   <p className="text-[10px] uppercase tracking-widest text-emerald-200 mb-3">Workspace</p>
   <nav className="grid grid-cols-2 md:grid-cols-1 gap-1">{nav.map(([href,label,Icon])=><Link key={href} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${path===href?"bg-white text-emerald-900 font-semibold":"text-emerald-50 hover:bg-white/10"}`}><Icon size={18}/>{label}</Link>)}</nav>
   <div className="mt-auto pt-8"><div className="rounded-xl bg-white/10 p-3 mb-3"><p className="text-sm font-semibold">{profile?.displayName||"Administrator"}</p><p className="text-xs text-emerald-200">{profile?.role}</p></div><button onClick={()=>signOut(auth)} className="flex gap-2 items-center text-sm text-emerald-100"><LogOut size={17}/> Sign out</button></div>
  </aside>
  <main className="flex-1 min-w-0 p-4 md:p-8"><div className="max-w-7xl mx-auto">{children}</div></main>
 </div>;
}
