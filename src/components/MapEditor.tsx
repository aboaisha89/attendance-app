'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {MapContainer,TileLayer,Polygon,Polyline,Marker,useMapEvents,useMap} from 'react-leaflet';
import L from 'leaflet';

type Point=[number,number]; // Stored as [longitude, latitude]
type Props={onSave:(points:number[][])=>void;initial?:number[][];selectedId?:string};
type Mode='draw'|'edit';
const toLatLng=([lng,lat]:Point):[number,number]=>[lat,lng];
function MapClick({enabled,onAdd,skipUntil}:{enabled:boolean;onAdd:(p:Point)=>void;skipUntil:React.MutableRefObject<number>}){
  useMapEvents({click:e=>{
    if(!enabled||Date.now()<skipUntil.current)return;
    onAdd([e.latlng.lng,e.latlng.lat]);
  }});
  return null;
}
function Recenter({location}:{location:[number,number]|null}){
  const map=useMap();useEffect(()=>{if(location)map.flyTo(location,18)},[map,location]);return null;
}
function FitInitial({initial}:{initial:number[][]}){
  const map=useMap();const hasFitted=useRef(false);
  useEffect(()=>{hasFitted.current=false},[initial]);
  useEffect(()=>{
    if(hasFitted.current||initial.length<3)return;
    const bounds=L.latLngBounds(initial.map(p=>toLatLng(p as Point)));
    if(bounds.isValid()){map.fitBounds(bounds,{padding:[38,38],maxZoom:19});hasFitted.current=true}
  },[map,initial]);
  return null;
}
function PointMarker({point,index,onMove,onRemove,editable,skipUntil}:{point:Point;index:number;onMove:(point:Point)=>void;onRemove:()=>void;editable:boolean;skipUntil:React.MutableRefObject<number>}){
  const map=useMap();
  const icon=useMemo(()=>L.divIcon({
    className:'fence-marker-wrap',iconSize:[44,44],iconAnchor:[22,22],
    html:`<div class="fence-marker" aria-label="Boundary point ${index+1}">${index+1}</div>`
  }),[index]);
  return <Marker position={toLatLng(point)} icon={icon} draggable={editable} autoPan={editable}
    eventHandlers={{
      dragstart:()=>{skipUntil.current=Date.now()+800;map.dragging.disable()},
      dragend:e=>{const p=e.target.getLatLng();onMove([p.lng,p.lat]);skipUntil.current=Date.now()+900;map.dragging.enable()},
      click:e=>{L.DomEvent.stopPropagation(e.originalEvent);skipUntil.current=Date.now()+500},
      contextmenu:e=>{L.DomEvent.stopPropagation(e.originalEvent);onRemove();skipUntil.current=Date.now()+500}
    }}/>
}
export default function MapEditor({onSave,initial=[],selectedId}:Props){
  const [points,setPoints]=useState<Point[]>(initial.map(p=>[Number(p[0]),Number(p[1])]));
  const [mode,setMode]=useState<Mode>('draw');
  const [location,setLocation]=useState<[number,number]|null>(null);
  const [error,setError]=useState('');
  const skipUntil=useRef(0);
  const initialKey=JSON.stringify(initial);
  useEffect(()=>{setPoints(initial.map(p=>[Number(p[0]),Number(p[1])]));setMode(initial.length?'edit':'draw');setError('')},[selectedId,initialKey]);
  const locate=()=>{
    if(!navigator.geolocation){setError('Geolocation is not available in this browser');return}
    navigator.geolocation.getCurrentPosition(p=>{setLocation([p.coords.latitude,p.coords.longitude]);setError('')},()=>setError('Allow location access to center the map'),{enableHighAccuracy:true,timeout:15000});
  };
  const undo=()=>setPoints(p=>p.slice(0,-1));
  const move=(i:number,p:Point)=>setPoints(old=>old.map((x,j)=>i===j?p:x));
  return <div className="fence-editor">
    <div className="fence-toolbar" role="group" aria-label="Boundary tools">
      <button type="button" className={mode==='draw'?'primary':'secondary'} onClick={()=>setMode('draw')}>+ Draw points</button>
      <button type="button" className={mode==='edit'?'primary':'secondary'} onClick={()=>setMode('edit')} disabled={!points.length}>↔ Move points</button>
      <button type="button" className="secondary" onClick={locate}>⌖ My location</button>
      <button type="button" className="secondary" disabled={!points.length} onClick={undo}>↶ Undo</button>
      <button type="button" className="danger" disabled={!points.length} onClick={()=>setPoints([])}>Clear</button>
    </div>
    <div className="fence-hint" role="status">{mode==='draw'?'Tap the map to add boundary points.':'Drag the numbered handles to move points. Right-click a handle to remove it.'}</div>
    <MapContainer center={[25.2854,51.531]} zoom={14} className="map fence-map" style={{height:470,width:'100%'}} scrollWheelZoom={false}>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
      <Recenter location={location}/><FitInitial initial={initial}/>
      <MapClick enabled={mode==='draw'} onAdd={p=>setPoints(old=>[...old,p])} skipUntil={skipUntil}/>
      {points.length>=3?<Polygon positions={points.map(toLatLng)} pathOptions={{color:'#059669',weight:3,fillColor:'#10b981',fillOpacity:.18}}/>:points.length>=2?<Polyline positions={points.map(toLatLng)} pathOptions={{color:'#059669',weight:3,dashArray:'6,6'}}/>:null}
      {points.map((p,i)=><PointMarker key={i} point={p} index={i} onMove={next=>move(i,next)} onRemove={()=>setPoints(old=>old.filter((_,j)=>j!==i))} editable={mode==='edit'} skipUntil={skipUntil}/>)}
    </MapContainer>
    <div className="fence-bottom">
      <span>{points.length} points · {points.length<3?'At least 3 required':'Boundary ready'}</span>
      <button type="button" className="primary" disabled={points.length<3} onClick={()=>onSave(points)}>Save boundary</button>
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
  </div>;
}
