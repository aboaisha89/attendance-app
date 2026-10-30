import {neon} from '@neondatabase/serverless';
export function db(){if(!process.env.DATABASE_URL)throw Error('DATABASE_URL missing. Connect Neon in Vercel Marketplace.');return neon(process.env.DATABASE_URL)}
