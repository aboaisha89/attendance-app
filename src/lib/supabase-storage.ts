import { createClient } from '@supabase/supabase-js';

const BUCKET = 'employee-avatars';

/** Select the matching URL/secret pair provided by the Vercel Supabase integration.
 * All credentials remain server-only. No defaults or fake credentials.
 */
export function storageConfig() {
  const env = process.env;
  const prefixes = ['SUPABASE', 'attendance', 'ATTENDANCE'];
  // Integration names may be customized (e.g. MYPROJECT_URL / MYPROJECT_SECRET_KEY).
  const discovered = Object.keys(env)
    .filter(k => k.endsWith('_URL') && k !== 'DATABASE_URL' && !k.startsWith('NEXT_PUBLIC_'))
    .map(k => k.slice(0, -4));
  const candidates = [...new Set([...prefixes, ...discovered])];
  for (const prefix of candidates) {
    const url = env[`${prefix}_URL`];
    const key = env[`${prefix}_SECRET_KEY`] || env[`${prefix}_SERVICE_ROLE_KEY`];
    if (url && key && /^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(url)) {
      return {url: url.replace(/\/$/, ''), key, prefix};
    }
  }
  // Legacy public URL is allowed only if a server secret exists; never use anon keys as admin.
  const url = env.SUPABASE_URL || env.attendance_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.attendance_SECRET_KEY || env.attendance_SERVICE_ROLE_KEY;
  if (url && key && /^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(url)) return {url:url.replace(/\/$/,''),key,prefix:'manual'};
  throw new Error('Supabase Storage connection missing. Connect the Supabase integration to this Vercel project and ensure a server SECRET_KEY (or SERVICE_ROLE_KEY) is available for Production. Redeploy after linking.');
}

export function storageClient(){
  const config = storageConfig();
  const client=createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false}});
  return {client,url:config.url,bucket:BUCKET};
}

/** Idempotent setup: only create the bucket if it is missing. Existing files remain untouched. */
export async function ensureAvatarBucket(client:ReturnType<typeof storageClient>['client']){
  const {data,error}=await client.storage.getBucket(BUCKET);
  if (data) return;
  if (error && !/not found|does not exist|404/i.test(error.message) && String((error as {status?:number}).status||'')!=='404') {
    throw new Error(`Supabase Storage access failed: ${error.message}`);
  }
  const {error:createError}=await client.storage.createBucket(BUCKET,{
    public:true, fileSizeLimit:2_000_000, allowedMimeTypes:['image/jpeg','image/png','image/webp']
  });
  if(createError && !/already exists|duplicate/i.test(createError.message)) {
    throw new Error(`Cannot create employee-avatars bucket: ${createError.message}. Verify the server-side Supabase key has storage administration permissions.`);
  }
}
