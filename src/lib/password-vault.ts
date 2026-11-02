import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'crypto';
/**
 * Reversible storage of the password so administrators can view it (owner's explicit requirement).
 * It is encrypted with AES-256-GCM, so a leaked database dump alone does not reveal passwords.
 * Key: PASSWORD_VIEW_KEY if set, otherwise derived from SESSION_SECRET.
 */
function key(){const s=process.env.PASSWORD_VIEW_KEY||process.env.SESSION_SECRET;if(!s||s.length<16)throw Error('PASSWORD_VIEW_KEY or SESSION_SECRET is required');return createHash('sha256').update('pwview:'+s).digest()}
export function sealPassword(plain:string){const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',key(),iv);const enc=Buffer.concat([c.update(plain,'utf8'),c.final()]);return ['v1',iv.toString('base64'),c.getAuthTag().toString('base64'),enc.toString('base64')].join(':')}
export function openPassword(stored:string|null|undefined){
 if(!stored)return null;const p=String(stored).split(':');if(p.length!==4||p[0]!=='v1')return null;
 try{const d=createDecipheriv('aes-256-gcm',key(),Buffer.from(p[1],'base64'));d.setAuthTag(Buffer.from(p[2],'base64'));return Buffer.concat([d.update(Buffer.from(p[3],'base64')),d.final()]).toString('utf8')}catch{return null}
}
