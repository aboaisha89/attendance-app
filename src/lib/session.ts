import {SignJWT,jwtVerify} from 'jose';
import {cookies} from 'next/headers';
export type Session={id:string;role:string;name:string};
function key(){const s=process.env.SESSION_SECRET;if(!s||s.length<32)throw Error('SESSION_SECRET must be at least 32 characters');return new TextEncoder().encode(s)}
export async function session(){const token=(await cookies()).get('attendance_session')?.value;if(!token)return null;try{const v=await jwtVerify(token,key());return {id:String(v.payload.sub),role:String(v.payload.role),name:String(v.payload.name)} as Session}catch{return null}}
export async function createToken(user:Session){return new SignJWT({role:user.role,name:user.name}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setIssuedAt().setExpirationTime('7d').sign(key())}
