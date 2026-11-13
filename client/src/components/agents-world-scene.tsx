import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { departments, type Department, type Entity } from '@/lib/agents-world';
import { renderBudget, rooms, stationLayout, visualMotion } from '@/lib/agents-world-layout';

type Props={entities:Entity[];visible:Entity[];selectedId?:string;suspended?:boolean;onSelect:(entity:Entity,target:HTMLElement)=>void};
type Engine={zoom:(factor:number)=>void;rotate:(angle:number)=>void;tilt:(angle:number)=>void;pan:(x:number,z:number)=>void;reset:()=>void;department:(department:Department)=>void;draw:()=>void};
/** Actual WebGL perspective scene. All character motion is decorative. */
export function AgentsWorldScene(props:Props) {
  const live=useRef(props); live.current=props;
  const canvasRef=useRef<HTMLCanvasElement>(null), labels=useRef(new Map<string,HTMLButtonElement>()),engine=useRef<Engine|null>(null);
  const [mobile,setMobile]=useState(()=>window.matchMedia('(max-width:600px)').matches);
  useEffect(()=>{const media=window.matchMedia('(max-width:600px)');const update=()=>setMobile(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  const [availability,setAvailability]=useState<'loading'|'ready'|'unavailable'>('loading');
  const [reduced,setReduced]=useState(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [motion,setMotion]=useState(true),[zoomLabel,setZoomLabel]=useState(100);
  const animationAllowed=useRef(false); animationAllowed.current=motion&&!reduced&&!props.suspended;
  const sceneKey=useMemo(()=>props.entities.map(e=>[e.id,e.name,e.department].join(':')).join('|'),[props.entities]);
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(media.matches);
    media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
  },[]);
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    let renderer:THREE.WebGLRenderer;
    try {renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});} catch {setAvailability('unavailable');return;}
    setAvailability('ready');
    const budget=renderBudget(mobile,devicePixelRatio);
    renderer.setPixelRatio(budget.pixelRatio);renderer.setClearColor('#0b1523');renderer.outputColorSpace=THREE.SRGBColorSpace;
    const scene=new THREE.Scene();scene.fog=new THREE.Fog('#0b1523',180,320);
    const camera=new THREE.PerspectiveCamera(42,1,.1,400);
    const controls=new OrbitControls(camera,canvas);controls.enableDamping=false;controls.minDistance=30;controls.maxDistance=230;
    controls.minPolarAngle=.25;controls.maxPolarAngle=1.35;controls.target.set(0,0,8);
    const initial=new THREE.Vector3(mobile?100:64,mobile?115:65,mobile?130:86);const initialDistance=initial.distanceTo(controls.target);
    camera.position.copy(initial);controls.update();
    scene.add(new THREE.HemisphereLight('#d4efff','#283342',2.5));const light=new THREE.DirectionalLight('#fff1d6',3);light.position.set(-25,50,15);scene.add(light);
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
    const box=new THREE.BoxGeometry(1,1,1),sphere=new THREE.SphereGeometry(1,10,8),cylinder=new THREE.CylinderGeometry(1,1,1,10);[box,sphere,cylinder].forEach(g=>geometries.add(g));
    const cached=new Map<string,THREE.MeshStandardMaterial>();
    const material=(color:string)=>{if(!cached.has(color)){const m=new THREE.MeshStandardMaterial({color,roughness:.85});cached.set(color,m);materials.add(m);}return cached.get(color)!;};
    const cube=(group:THREE.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:string)=>{const mesh=new THREE.Mesh(box,material(color));mesh.position.set(x,y,z);mesh.scale.set(w,h,d);group.add(mesh);return mesh;};
    const round=(group:THREE.Object3D,x:number,y:number,z:number,r:number,color:string)=>{const mesh=new THREE.Mesh(sphere,material(color));mesh.position.set(x,y,z);mesh.scale.setScalar(r);group.add(mesh);return mesh;};
    const text=(content:string,x:number,y:number,z:number,color:string,size:number)=>{
      const label=document.createElement('canvas');label.width=768;label.height=96;const ctx=label.getContext('2d');if(!ctx)return;
      ctx.fillStyle='#101e2bee';ctx.fillRect(0,0,768,96);ctx.font='600 34px system-ui';ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(content,384,60,735);
      const texture=new THREE.CanvasTexture(label);textures.add(texture);texture.colorSpace=THREE.SRGBColorSpace;
      const m=new THREE.SpriteMaterial({map:texture,depthTest:true});materials.add(m);const sprite=new THREE.Sprite(m);sprite.position.set(x,y,z);sprite.scale.set(size,size/8,1);scene.add(sprite);
    };
    cube(scene,0,-.7,8,59,1.4,66,'#24384a');cube(scene,0,.02,8,58,.12,65,'#354b5b');
    cube(scene,0,.12,1,3,.1,44,'#667c8a');cube(scene,0,.13,0,57,.1,3,'#667c8a');cube(scene,0,.13,23,57,.1,3,'#667c8a');
    // Open-front cutaway walls and genuine 3D windows.
    cube(scene,0,2.3,-24,59,4.6,.6,'#315069');cube(scene,-29,2.3,8,.6,4.6,65,'#284256');
    for(let x=-25;x<28;x+=8)cube(scene,x,2.8,-23.62,5,2.4,.12,'#74b2c4');
    for(let z=-19;z<35;z+=10)cube(scene,-28.62,2.8,z,.12,2.4,5,'#5d99b2');
     for(const department of departments){const r=rooms[department];cube(scene,r.x,.19,r.z,r.width,.2,r.depth,r.color);cube(scene,r.x,.31,r.z,r.width-.5,.05,r.depth-.5,'#2b3e50');
       text(department.toUpperCase(),r.x,4.9,r.z-r.depth/2+1,r.color,14);
      // Low partitions define zones without hiding stations or pretending connections.
      cube(scene,r.x,.8,r.z-r.depth/2,r.width,1,.18,'#4d667a');
    }
    cube(scene,0,1.2,0,3, .25,3,'#84a2a7');for(const [x,z] of [[-2,0],[2,0],[0,-2],[0,2]]){cube(scene,x,.55,z,.8,.2,.8,'#59858d');cube(scene,x,.95,z+.35,.8,.8,.12,'#59858d');}
    for(const [x,z] of [[-27,-1],[27,-1],[-27,23],[27,23],[0,39]]){const pot=new THREE.Mesh(cylinder,material('#8d989c'));pot.scale.set(.6,.8,.6);pot.position.set(x,.7,z);scene.add(pot);round(scene,x,1.6,z,1.1,'#609b7e');round(scene,x+.5,2,z,.65,'#80b28a');}
    canvas.dataset.stationLimit=String(mobile?32:48);
    const stations=stationLayout(live.current.entities.slice(0,mobile?32:48)),nodes=new Map<string,{group:THREE.Group;avatar:THREE.Group;legs:THREE.Mesh[];ring:THREE.Mesh;station:typeof stations[number]}>();
    const ringGeometry=new THREE.TorusGeometry(1.25,.055,4,20);geometries.add(ringGeometry);
    for(const station of stations){
      const g=new THREE.Group();g.position.set(station.x,.4,station.z);g.userData.entityId=station.entity.id;scene.add(g);
      cube(g,0,1.25,0,2.1,.15,1.25,'#8a9ba7');cube(g,-.85,.6,0,.12,1.2,.8,'#4e6477');cube(g,.85,.6,0,.12,1.2,.8,'#4e6477');
      cube(g,.2,1.8,-.35,.95,.65,.12,'#101e2c');cube(g,.2,1.81,-.27,.8,.45,.03,station.color);cube(g,.2,1.35,-.25,.12,.5,.12,'#557589');
      const avatar=new THREE.Group();avatar.position.set(-.8,0,1.25);g.add(avatar);
      cube(avatar,0,1.15,0,.64,.85,.4,station.color);round(avatar,0,1.91,0,.34,'#ddbfa5');round(avatar,0,2.04,-.035,.31,'#243245');
      const legs=[cube(avatar,-.18,.38,0,.22,.7,.24,'#253e53'),cube(avatar,.18,.38,0,.22,.7,.24,'#253e53')];
      cube(avatar,-.42,1.13,0,.16,.7,.18,station.color);cube(avatar,.42,1.13,0,.16,.7,.18,station.color);
      const ring=new THREE.Mesh(ringGeometry,material('#d3fff1'));ring.rotation.x=-Math.PI/2;ring.position.set(0,.02,.65);g.add(ring);ring.visible=false;
      nodes.set(station.entity.id,{group:g,avatar,legs,ring,station});
    }
    const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),projected=new THREE.Vector3();
    let alive=true,visible=true,inViewport=true,dirty=true,frame=0,lastRender=0,startTime:number|null=null,raf=0,dragStart:{x:number;y:number}|null=null;
    const setCameraStatus=()=>{canvas.dataset.camera=JSON.stringify([camera.position.x,camera.position.y,camera.position.z,controls.target.x,controls.target.z].map(n=>Math.round(n*100)/100));setZoomLabel(Math.round(initialDistance/camera.position.distanceTo(controls.target)*100));dirty=true;};
    const draw=()=>{
      if(!alive)return;
      const ids=new Set(live.current.visible.map(e=>e.id));
      for(const [id,node] of nodes){node.group.visible=ids.has(id);node.ring.visible=live.current.selectedId===id;}
      renderer.render(scene,camera);frame++;canvas.dataset.frame=String(frame);canvas.dataset.drawCalls=String(renderer.info.render.calls);canvas.dataset.pixelRatio=String(budget.pixelRatio);
      if(dirty){const occupied:{x:number;y:number;w:number;h:number}[]=[];const ordered=[...nodes].sort(([a,an],[b,bn])=>a===live.current.selectedId?-1:b===live.current.selectedId?1:bn.station.z-an.station.z);for(const [id,node] of ordered){const button=labels.current.get(id);if(!button)continue;
        projected.set(node.station.x,3.2,node.station.z+.8).project(camera);
        const inFrame=Math.abs(projected.x)<.97&&Math.abs(projected.y)<.97&&projected.z<1&&projected.z>-1;
        // Clipped stations remain keyboard reachable in the small selector below.
        const x=(projected.x+1)*canvas.clientWidth/2,y=(1-projected.y)*canvas.clientHeight/2,w=button.offsetWidth,h=button.offsetHeight;const overlaps=occupied.some(r=>Math.abs(r.x-x)<(r.w+w)/2+3&&Math.abs(r.y-y)<(r.h+h)/2+3);const show=inFrame&&!overlaps;if(show)occupied.push({x,y,w,h});button.style.visibility=show?'visible':'hidden';button.style.left=`${(projected.x+1)*50}%`;button.style.top=`${(1-projected.y)*50}%`;
      }dirty=false;}
    };
    const resize=new ResizeObserver(([entry])=>{if(!alive||!entry.contentRect.width||!entry.contentRect.height)return;renderer.setSize(entry.contentRect.width,entry.contentRect.height,false);camera.aspect=entry.contentRect.width/entry.contentRect.height;camera.updateProjectionMatrix();dirty=true;draw();});resize.observe(canvas);
    const changed=()=>{setCameraStatus();draw();};controls.addEventListener('change',changed);
    const manipulate=(action:()=>void)=>{action();controls.update();changed();};
    const orbit=(yaw:number,tilt=0)=>manipulate(()=>{const offset=camera.position.clone().sub(controls.target),spherical=new THREE.Spherical().setFromVector3(offset);spherical.theta+=yaw;spherical.phi=Math.min(1.35,Math.max(.25,spherical.phi+tilt));camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));});
    engine.current={draw:()=>{dirty=true;draw();},zoom:factor=>manipulate(()=>{const v=camera.position.clone().sub(controls.target);v.setLength(Math.max(30,Math.min(230,v.length()*factor)));camera.position.copy(controls.target).add(v);}),rotate:angle=>orbit(angle),tilt:angle=>orbit(0,angle),
      pan:(x,z)=>manipulate(()=>{const dx=Math.max(-32,Math.min(32,controls.target.x+x))-controls.target.x,dz=Math.max(-26,Math.min(40,controls.target.z+z))-controls.target.z;controls.target.add(new THREE.Vector3(dx,0,dz));camera.position.add(new THREE.Vector3(dx,0,dz));}),
      reset:()=>manipulate(()=>{controls.target.set(0,0,8);camera.position.copy(initial);}),
       department:department=>manipulate(()=>{const r=rooms[department],offset=camera.position.clone().sub(controls.target).normalize().multiplyScalar(mobile?Math.max(62,r.width*2.3):Math.max(45,r.width*1.5));controls.target.set(r.x,0,r.z);camera.position.copy(controls.target).add(offset);}),
    };
    const tick=(timestamp:number)=>{if(!alive)return;raf=requestAnimationFrame(tick);
      const moving=animationAllowed.current&&visible&&inViewport;
      if(!moving){if(canvas.dataset.motion!=='paused'){canvas.dataset.motion='paused';for(const node of nodes.values()){node.avatar.position.set(-.8,0,1.25);node.avatar.rotation.y=0;node.legs.forEach(leg=>leg.rotation.x=0);}draw();}return;}
      if(timestamp-lastRender<1000/budget.fps)return;lastRender=timestamp;startTime??=timestamp;canvas.dataset.motion='decorative';
      let index=0;for(const node of nodes.values()){const pose=visualMotion(index++*.7,(timestamp-startTime)/1000,true);node.avatar.position.set(-.8+pose.x,0,1.25+pose.z);node.avatar.rotation.y=pose.yaw;node.legs[0].rotation.x=pose.leg;node.legs[1].rotation.x=-pose.leg;}
      canvas.dataset.decorativePose=JSON.stringify([...nodes.values()][0]?.avatar.position.toArray());
      draw();
    };raf=requestAnimationFrame(tick);
    const visibility=()=>{visible=!document.hidden;};document.addEventListener('visibilitychange',visibility);
    const intersection=new IntersectionObserver(([entry])=>{inViewport=entry.isIntersecting;});intersection.observe(canvas);
    const down=(event:PointerEvent)=>{dragStart={x:event.clientX,y:event.clientY};};
    const up=(event:PointerEvent)=>{if(!dragStart||Math.hypot(event.clientX-dragStart.x,event.clientY-dragStart.y)>6)return;dragStart=null;
      const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
      for(const hit of raycaster.intersectObjects([...nodes.values()].filter(n=>n.group.visible).map(n=>n.group),true)){let object:THREE.Object3D|null=hit.object;while(object&&!object.userData.entityId)object=object.parent;
        const id=object?.userData.entityId,entity=live.current.visible.find(e=>e.id===id);if(entity&&typeof id==='string'){live.current.onSelect(entity,labels.current.get(id)||canvas);break;}}
    };
    const lost=(event:Event)=>{event.preventDefault();release();setAvailability('unavailable');};canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointerup',up);
    setCameraStatus();draw();
    function release(){if(!alive)return;alive=false;cancelAnimationFrame(raf);engine.current=null;resize.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',visibility);controls.removeEventListener('change',changed);controls.dispose();canvas?.removeEventListener('pointerdown',down);canvas?.removeEventListener('pointerup',up);canvas?.removeEventListener('webglcontextlost',lost);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose();if(!canvas?.isConnected)renderer.forceContextLoss();}
    return release;
  },[sceneKey,mobile]);
  useEffect(()=>engine.current?.draw(),[props.visible,props.selectedId,availability]);
  const select=(entity:Entity,target:HTMLElement)=>live.current.onSelect(entity,target);
  return <div className="ops-scene-shell">
    <div className="ops-motion-notice"><strong>Movimiento ambiental decorativo</strong> · No representa ejecución, comunicación ni tareas completadas.</div>
    <div className="ops-scene-controls" role="group" aria-label="Navegación 3D">
      <button aria-label="Alejar escenario" onClick={()=>engine.current?.zoom(1.2)}>−</button><output aria-label="Zoom del escenario">{zoomLabel}%</output><button aria-label="Acercar escenario" onClick={()=>engine.current?.zoom(1/1.2)}>+</button><button onClick={()=>engine.current?.reset()}>Ver todo</button>
      <button aria-label="Girar cámara izquierda" onClick={()=>engine.current?.rotate(-.25)}>↶</button><button aria-label="Girar cámara derecha" onClick={()=>engine.current?.rotate(.25)}>↷</button><button aria-label="Inclinar cámara arriba" onClick={()=>engine.current?.tilt(-.15)}>⤒</button><button aria-label="Inclinar cámara abajo" onClick={()=>engine.current?.tilt(.15)}>⤓</button>
      <button aria-label="Desplazar escenario a la izquierda" onClick={()=>engine.current?.pan(-4,0)}>←</button><button aria-label="Desplazar escenario a la derecha" onClick={()=>engine.current?.pan(4,0)}>→</button><button aria-label="Desplazar escenario arriba" onClick={()=>engine.current?.pan(0,-4)}>↑</button><button aria-label="Desplazar escenario abajo" onClick={()=>engine.current?.pan(0,4)}>↓</button>
      <button aria-pressed={motion&&!reduced} disabled={reduced} onClick={()=>setMotion(m=>!m)}>{reduced?'Movimiento reducido':motion?'Pausar decoración':'Activar decoración'}</button>
    </div>
     <div className="ops-scene-areas" role="group" aria-label="Ir a un departamento">{departments.map(department=><button key={department} onClick={()=>engine.current?.department(department)}>{department}</button>)}</div>
    <div className="ops-3d-stage" role="group" aria-label="Mundo 3D de agentes">
      {availability!=='unavailable'&&<canvas ref={canvasRef} tabIndex={0} aria-label="Cámara 3D: flechas desplazan, + y − zoom, Inicio reinicia" onKeyDown={event=>{const key=event.key;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(key))event.preventDefault();if(key==='Home')engine.current?.reset();if(key==='+'||key==='=')engine.current?.zoom(1/1.2);if(key==='-')engine.current?.zoom(1.2);if(key==='ArrowLeft')engine.current?.pan(-4,0);if(key==='ArrowRight')engine.current?.pan(4,0);if(key==='ArrowUp')engine.current?.pan(0,-4);if(key==='ArrowDown')engine.current?.pan(0,4);}}/>}
      {availability==='ready'&&<div className="ops-3d-labels">{props.visible.filter(entity=>entity.department!=='Desconocido'&&props.entities.slice(0,mobile?32:48).some(e=>e.id===entity.id)).map(entity=><button key={entity.id} ref={element=>{if(element)labels.current.set(entity.id,element);else labels.current.delete(entity.id);}} data-entity-id={entity.id} className="ops-3d-label" aria-label={`${entity.name} ${entity.role} ${entity.signal}`} aria-pressed={entity.id===props.selectedId} title={`${entity.name} · ${entity.connection}`} onClick={event=>select(entity,event.currentTarget)}><span>{entity.name}</span><small>{entity.catalogStatus==='Propuesto · No conectado'?entity.catalogStatus:entity.connection==='No conectado'?'No conectado':entity.signal}</small></button>)}</div>}
      {availability==='unavailable'&&<div className="ops-webgl-fallback" role="status">WebGL no disponible. Directorio accesible de las mismas fuentes, sin movimiento.<ul>{props.visible.map(entity=><li key={entity.id}><button className="ops-entity" data-entity-id={entity.id} aria-label={`${entity.name} ${entity.role} ${entity.signal}`} aria-pressed={entity.id===props.selectedId} onClick={event=>select(entity,event.currentTarget)}>{entity.name} · {entity.connection} · {entity.signal}</button></li>)}</ul></div>}
    </div>
     <p className="ops-motion-notice">La escena muestra hasta 32 estaciones en móvil y 48 en escritorio. Los registros sin departamento verificable permanecen en el selector y la Lista.</p><label className="ops-station-picker">Seleccionar entidad (también fuera de cámara)<select aria-label="Seleccionar entidad 3D" value={props.selectedId||''} onChange={event=>{const entity=props.visible.find(e=>e.id===event.target.value);if(entity)select(entity,event.currentTarget);}}><option value="">Elige rol, proyecto o tarea</option>{props.visible.map(entity=><option value={entity.id} key={entity.id}>{entity.name} · {entity.connection}</option>)}</select></label>
    <p className="ops-scene-help">Arrastra para girar. Dos dedos permiten zoom y desplazamiento. Flechas, + / − e Inicio controlan la cámara. Selecciona una figura, su etiqueta o el selector accesible. Las posiciones y el movimiento son decorativos; las fichas usan fuentes verificables.</p>
  </div>;
}
