"use client";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
export function Guard({children,admin=false}:{children:React.ReactNode;admin?:boolean}) {
 const {user,profile,loading}=useAuth(), router=useRouter();
 useEffect(()=>{if(!loading && !user) router.replace("/login"); else if(!loading && user && (!profile || profile.status!=="active")) router.replace("/pending"); else if(!loading && admin && profile && !["admin","super_admin","hr"].includes(profile.role)) router.replace("/");},[loading,user,profile,admin,router]);
 if(loading || !user || !profile || profile.status!=="active" || (admin && !["admin","super_admin","hr"].includes(profile.role))) return <div className="grid min-h-screen place-items-center text-emerald-900">Loading secure workspace…</div>;
 return <>{children}</>;
}
