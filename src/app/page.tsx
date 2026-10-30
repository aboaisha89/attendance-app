"use client";
import { useEffect } from "react"; import { useRouter } from "next/navigation"; import { useAuth } from "@/context/AuthContext";
export default function Home(){const {user,profile,loading}=useAuth(),router=useRouter();useEffect(()=>{if(!loading)router.replace(!user?"/login":profile?.status==="active"?"/employee":"/pending")},[user,profile,loading,router]);return <div className="p-10">Loading…</div>}
