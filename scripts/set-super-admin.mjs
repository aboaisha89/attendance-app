// Run only from a trusted machine with Firebase Admin credentials.
// Usage: GOOGLE_APPLICATION_CREDENTIALS=/secure/service-account.json node scripts/set-super-admin.mjs admin@company.com
import admin from "firebase-admin";
import { readFileSync } from "node:fs";
const serviceAccount=JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS,"utf8"));
admin.initializeApp({credential:admin.credential.cert(serviceAccount)});
const email=process.argv[2];
if(!email) throw new Error("Provide the admin email.");
const user=await admin.auth().getUserByEmail(email);
await admin.auth().setCustomUserClaims(user.uid,{role:"super_admin"});
await admin.firestore().doc(`users/${user.uid}`).set({uid:user.uid,email,role:"super_admin",status:"active"},{merge:true});
console.log(`Super admin assigned: ${email}. Sign out and sign in again to refresh claims.`);
