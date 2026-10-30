'use client';
import {useState} from 'react';
import {MapContainer,TileLayer,Polygon,useMapEvents} from 'react-leaflet';
type Props={onSave:(points:number[][])=>void};
function Click({add}:{add:(lat:number,lng:number)=>void}){useMapEvents({click:e=>add(e.latlng.lat,e.latlng.lng)});return null}
export default function MapEditor({onSave}:Props){const [pts,setPts]=useState<number[][]>([]);
return <div><div className="toolbar" style={{marginBottom:10}}><button className="btn alt" onClick={()=>setPts(p=>p.slice(0,-1))}>تراجع</button><button className="btn alt" onClick={()=>setPts([])}>مسح</button><button className="btn" disabled={pts.length<3} onClick={()=>onSave(pts)}>حفظ الحدود ({pts.length} نقطة)</button></div><MapContainer center={[25.2854,51.531]} zoom={13} className="map" style={{height:450}}><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Click add={(lat,lng)=>setPts(p=>[...p,[lng,lat]])}/>{pts.length>=2&&<Polygon positions={pts.map(([lng,lat])=>[lat,lng])} pathOptions={{color:'#166534',fillOpacity:.2}}/>}</MapContainer><p className="muted">اضغط على الخريطة لتحديد 3 نقاط أو أكثر. تحفظ النقاط بصيغة [longitude, latitude].</p></div>}
