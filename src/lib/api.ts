'use client';
import {httpsCallable} from 'firebase/functions';
import {functions} from './firebase';
export async function call<T=Record<string,unknown>>(name:string,payload:Record<string,unknown>={}):Promise<T>{const result=await httpsCallable<Record<string,unknown>,T>(functions,name)(payload);return result.data;}
export async function position():Promise<{latitude:number;longitude:number;accuracy:number}>{if(!navigator.geolocation)throw Error('Geolocation is not supported');return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}),reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));}
export function formatTime(ts?:{seconds:number}){return ts?new Date(ts.seconds*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—';}
