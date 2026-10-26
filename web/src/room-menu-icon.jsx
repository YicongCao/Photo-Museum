import React from 'react';
import {roomIconPaths} from './room-menu-icons.mjs';

export function RoomMenuIcon({room}){
 return <svg className="room-menu-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
  {roomIconPaths[room]?.map((d,i)=><path key={i} d={d}/>)}
 </svg>;
}
