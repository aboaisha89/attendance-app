"use client";
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polygon, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { GeoPoint } from "@/lib/types";
function ClickCapture({onPoint}:{onPoint:(p:GeoPoint)=>void}){useMapEvents({click(e){onPoint({lat:e.latlng.lat,lng:e.latlng.lng})}});return null}
export default function GeoMap({points,onChange}:{points:GeoPoint[];onChange:(p:GeoPoint[])=>void}) {
 const [ready,setReady]=useState(false);useEffect(()=>{setReady(true)},[]);
 if(!ready)return <div className="h-[460px] rounded-2xl bg-slate-100 animate-pulse"/>;
 return <MapContainer center={[25.2854,51.531]} zoom={12} scrollWheelZoom className="h-[460px]">
  <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
  <ClickCapture onPoint={p=>onChange([...points,p])}/>
  {points.length>=3&&<Polygon positions={points.map(p=>[p.lat,p.lng])} pathOptions={{color:"#047857",fillColor:"#10b981",fillOpacity:.22}}/>}
 </MapContainer>
}
