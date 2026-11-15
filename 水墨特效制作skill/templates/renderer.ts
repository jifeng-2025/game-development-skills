// TEMPLATE. Generic: spawns one entity per mesh effect (material copy from the prototype) + one point-list batch per
// particle texture. Per-frame: skip unchanged transforms/values, upload only the used particle prefix.
import type { AssetRegistry } from '@forgeax/engine/assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine/ecs';
import { MeshFilter, MeshRenderer, Points, PointShapeValue, PointSizeUnitsValue, ShadowParticipation } from '@forgeax/engine/render';
import { Transform } from '@forgeax/engine/scene';
import type { AssetHandle, MaterialAsset, MeshAsset } from '@forgeax/engine/types';
import { effectMesh, particleMesh } from './geometry.ts';
import { materialKey, meshNumbers, OVERLAY_KEYS, PAPER_RIM, vfxGuid, WARNING_RIM } from './materials.ts';
import { VFX_TEXTURES, type TextureKey } from './textures.ts';
import { LIMITS, type Effect } from './timeline.ts';

interface Draw {entity:EntityHandle;material:AssetHandle<'material'>;texture:TextureKey;warning:boolean;xf?:string;mat?:string}
interface Batch {entity:EntityHandle;mesh:AssetHandle<'mesh'>;position:Float32Array;color:Float32Array;size:Float32Array;used:number}
export async function createVfxRenderer(world:World,assets:AssetRegistry) {
  const materials=new Map<string,AssetHandle<'material'>>();
  const meshes=new Map<string,AssetHandle<'mesh'>>();
  const draws=new Map<number,Draw>();
  const batches=new Map<TextureKey,Batch>();
  const owned:number[]=[];
  const own=<T extends number>(handle:T):T=>{owned.push(handle);return handle;};
  const loadMaterial=async(key:TextureKey,points=false,warning=false,overlay=false)=>{
    const source=materialKey(key,points,warning,overlay);
    if(!materials.has(source)) materials.set(source,own((await assets.load(vfxGuid(source),'material')).unwrap()));
    return materials.get(source)!;
  };
  const particleKeys:TextureKey[]=['splat-00','spark-01','spark-02','spark-03','mist-03'];
  const dispose=()=>{
    for(const d of draws.values()){world.despawn(d.entity).unwrap();assets.release(d.material).unwrap();}
    draws.clear();
    for(const b of batches.values()) world.despawn(b.entity).unwrap();
    batches.clear();
    for(const h of owned.reverse())assets.release(h).unwrap();owned.length=0;
  };
  try {
    for(const key of Object.keys(VFX_TEXTURES) as TextureKey[]) {
      if(key==='noise')continue;
      await loadMaterial(key);
    }
    for(const key of ['fan','ring','line'] as TextureKey[])await loadMaterial(key,false,true);
    for(const key of OVERLAY_KEYS)await loadMaterial(key,false,false,true);
    for(const key of ['quad','vertical','arc'])meshes.set(key,own(assets.create(effectMesh(key==='arc',key==='vertical')).unwrap()));
    for(const key of particleKeys) {
      const material=await loadMaterial(key,true);
      const mesh=own(assets.create(particleMesh(LIMITS.particles)).unwrap());
      const entity=world.spawn({component:Transform,data:{}},{component:MeshFilter,data:{assetHandle:mesh}},
        {component:MeshRenderer,data:{materials:[material]}},
        {component:ShadowParticipation,data:{cast:false,receive:false}},
        {component:Points,data:{size:1,sizeUnits:PointSizeUnitsValue.world,shape:key==='splat-00'?PointShapeValue.circle:PointShapeValue.square}}).unwrap();
      batches.set(key,{entity,mesh,position:new Float32Array(LIMITS.particles*3),color:new Float32Array(LIMITS.particles*4),size:new Float32Array(LIMITS.particles*2),used:0});
    }
  } catch(error) {dispose();throw error;}
  let disposed=false;
  return {
    update(effects:readonly Effect[]) {
      if(disposed)throw new Error('VFX renderer disposed');
      const alive=new Set(effects.filter(e=>e.geometry!=='points'&&e.age>=0).map(e=>e.id));
      for(const [id,d] of draws) if(!alive.has(id)) {
        world.despawn(d.entity).unwrap();assets.release(d.material).unwrap();draws.delete(id);
      }
      const counts=new Map<TextureKey,number>();
      for(const e of effects) {
        if(e.age<0)continue;
        if(e.geometry==='points') {
          const b=batches.get(e.texture);if(!b)throw new Error(`Missing point batch: ${e.texture}`);
          const n=counts.get(e.texture)??0;if(n>=LIMITS.particles)continue;counts.set(e.texture,n+1);
          b.position.set(e.position,n*3);b.color.set([...e.tint,e.opacity],n*4);b.size[n*2]=e.size[0];continue;
        }
        let draw=draws.get(e.id);
        if(!draw) {
          const prototype=materials.get(materialKey(e.texture,false,!!e.warning,e.layer==='overlay'));
          if(!prototype)throw new Error(`Missing material: ${e.texture}`);
          const material=assets.copy(prototype).unwrap();
          let entity:EntityHandle;
          try {entity=world.spawn({component:Transform,data:{}},{component:MeshFilter,data:{assetHandle:meshes.get(e.geometry)!}},
            {component:MeshRenderer,data:{materials:[material]}},{component:ShadowParticipation,data:{cast:false,receive:false}}).unwrap();}
          catch(error){assets.release(material).unwrap();throw error;}
          draw={entity,material,texture:e.texture,warning:!!e.warning};draws.set(e.id,draw);
        }
        let angle=e.angle;
        if(e.warning?.shape==='line')angle-=Math.PI/2;
        const sx=e.size[0]*e.grow[0]*(e.mirror?-1:1), sy=e.size[1]*e.grow[1];
        // V003-8: skip unchanged transforms/material values (most decals and telegraphs are static between frames).
        const quat=e.quat?[...e.quat]:[0,Math.sin(angle/2),0,Math.cos(angle/2)];
        const xf=`${e.position.join()}|${quat.join()}|${sx},${sy}`;
        if(xf!==draw.xf){draw.xf=xf;world.set(draw.entity,Transform,{pos:[...e.position],quat,
          scale:e.geometry==='vertical'?[sx,sy,1]:[sx,1,sy]}).unwrap();}
        const q=(v:number)=>Math.round(v*500);
        const mat=`${q(e.opacity)},${q(e.phase)},${q(e.split)},${q(e.scroll)},${q(e.crit)},${q(e.sweep)},${q(e.fill[3])},${e.bloom===undefined?'':q(e.bloom)},${q(e.rim)},${e.tint.join()},${e.rimTint?.join()??''},${e.outlinePx??''},${e.tip??''}`;
        if(mat===draw.mat)continue;
        draw.mat=mat;
        assets.update(draw.material,{values:{...meshNumbers(),outline:e.outlinePx??2.5,tip:e.tip??0,tint:[...e.tint,1],rim:e.warning?[...WARNING_RIM]:[...(e.rimTint??PAPER_RIM.slice(0,3)),PAPER_RIM[3]*e.rim],
          opacity:e.opacity,phase:e.warning?0:e.phase,split:e.split,scroll:e.scroll,crit:e.crit,
          vertical:e.role==='e-cut'?1:0,sweep:e.sweep,fill:[...e.fill],wedge:[...e.wedge],bloom:e.bloom===undefined?[0,0,0,0]:[e.bloom,1,0,0]}}).unwrap();
      }
      // V003-8: upload only the used prefix (plus the tail cleared since last frame); idle batches cost nothing.
      for(const [key,b] of batches) {
        const n=counts.get(key)??0, m=Math.max(n,b.used);
        if(m===0)continue;
        b.color.fill(0,n*4,m*4); b.size.fill(0,n*2,m*2);
        assets.writeRange(b.mesh,[{attribute:'position',first:0,values:b.position.subarray(0,m*3)},
          {attribute:'color',first:0,values:b.color.subarray(0,m*4)},{attribute:'uv1',first:0,values:b.size.subarray(0,m*2)}]).unwrap();
        b.used=n;
      }
    },
    inspect:()=>({meshes:draws.size,particleBatches:batches.size,particleCapacity:LIMITS.particles,disposed}),
    dispose(){if(disposed)return;disposed=true;dispose();},
  };
}
