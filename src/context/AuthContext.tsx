"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { UserRole, UserStatus } from "@/lib/types";

type Profile = { uid:string; displayName:string; email:string; role:UserRole; status:UserStatus; department?:string };
type AuthValue = { user:User|null; profile:Profile|null; loading:boolean };
const Ctx = createContext<AuthValue>({user:null,profile:null,loading:true});
export function AuthProvider({children}:{children:React.ReactNode}) {
  const [value,setValue] = useState<AuthValue>({user:null,profile:null,loading:true});
  useEffect(()=>onAuthStateChanged(auth,async user=>{
    if (!user) { setValue({user:null,profile:null,loading:false}); return; }
    try {
      const [snap, token] = await Promise.all([getDoc(doc(db,"users",user.uid)),user.getIdTokenResult(true)]);
      const data = snap.exists() ? snap.data() : null;
      setValue({user,profile:data ? {...data, role:(token.claims.role as UserRole)||data.role} as Profile : null,loading:false});
    } catch { setValue({user,profile:null,loading:false}); }
  }),[]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth=()=>useContext(Ctx);
