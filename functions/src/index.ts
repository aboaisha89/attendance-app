import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
initializeApp();
const db=getFirestore();
type Point={lat:number;lng:number};
function inside(point:Point,poly:Point[]){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if(((a.lat>point.lat)!==(b.lat>point.lat))&&(point.lng<(b.lng-a.lng)*(point.lat-a.lat)/(b.lat-a.lat)+a.lng))c=!c;}return c;}
export const attendanceAction=onCall({enforceAppCheck:true},async request=>{
 if(!request.auth)throw new HttpsError("unauthenticated","Sign in first.");
 const uid=request.auth.uid, {action,latitude,longitude,accuracy}=request.data||{};
 if(!["checkIn","checkOut"].includes(action)||![latitude,longitude,accuracy].every(Number.isFinite))throw new HttpsError("invalid-argument","Valid location coordinates are required.");
 if(accuracy>75)throw new HttpsError("failed-precondition","GPS accuracy is too low. Move to an open area and try again.");
 const userSnap=await db.doc(`users/${uid}`).get(), user=userSnap.data();
 if(!userSnap.exists||user?.status!=="active")throw new HttpsError("permission-denied","Your employee account is not active.");
 const zones=await db.collection("geofences").where("enabled","==",true).get();
 const point={lat:latitude,lng:longitude};
 const allowed=zones.docs.some(d=>{const z=d.data();return (!z.assignedUserIds?.length||z.assignedUserIds.includes(uid))&&Array.isArray(z.points)&&z.points.length>=3&&inside(point,z.points);});
 if(!allowed)throw new HttpsError("permission-denied","You are outside the approved work area.");
 const now=new Date(), dateKey=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Qatar"}).format(now);
 const openQuery=await db.collection("attendance").where("uid","==",uid).where("status","==","open").limit(1).get();
 if(action==="checkIn"){
  if(!openQuery.empty)throw new HttpsError("already-exists","You already have an open attendance session.");
  const ref=db.collection("attendance").doc();
  await ref.set({uid,dateKey,checkInAt:now.toISOString(),checkInTimestamp:Timestamp.fromDate(now),checkInLocation:point,checkInAccuracy:accuracy,status:"open",createdAt:Timestamp.fromDate(now)});
  return {ok:true,recordId:ref.id};
 }
 if(openQuery.empty)throw new HttpsError("failed-precondition","No open attendance session was found.");
 const ref=openQuery.docs[0].ref, data=openQuery.docs[0].data(), start=new Date(data.checkInAt);
 const totalMinutes=Math.max(0,Math.floor((now.getTime()-start.getTime())/60000));
 await ref.update({checkOutAt:now.toISOString(),checkOutTimestamp:Timestamp.fromDate(now),checkOutLocation:point,checkOutAccuracy:accuracy,totalMinutes,status:"completed"});
 return {ok:true,totalMinutes};
});

export const setEmployeeRole=onCall(async request=>{
 if(!request.auth)throw new HttpsError("unauthenticated","Sign in first.");
 const caller=await getAuth().getUser(request.auth.uid);
 if(caller.customClaims?.role!=="super_admin")throw new HttpsError("permission-denied","Super admin only.");
 const {uid,role,status}=request.data||{};
 const roles=["super_admin","admin","hr","manager","employee"];
 if(typeof uid!=="string"||!roles.includes(role))throw new HttpsError("invalid-argument","Invalid user or role.");
 const target=await getAuth().getUser(uid);
 await getAuth().setCustomUserClaims(uid,{...(target.customClaims||{}),role});
 await db.doc(`users/${uid}`).set({role,status:status||"active",updatedAt:Timestamp.now()},{merge:true});
 return {ok:true};
});
