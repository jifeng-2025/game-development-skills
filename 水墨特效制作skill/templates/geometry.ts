// TEMPLATE. arc = 150° ring sector (r 0.2–1, uv mapped for sweep), quad = ground plane, vertical = camera-facing card,
// particleMesh = point-list batch (uv1.x = point size).
import { createMeshBuilder, packInterleavedVertexAttributes } from '@forgeax/engine/geometry';
import type { MeshAsset } from '@forgeax/engine/types';

export function effectMesh(arc=false,vertical=false):MeshAsset {
  const p:number[]=[],uv:number[]=[],indices:number[]=[];
  if(arc) {
    for(let i=0;i<=32;i++) {
      const angle=(-75+i*150/32)*Math.PI/180;
      for(const r of [.2,1]) {
        const x=Math.sin(angle)*r,z=Math.cos(angle)*r;
        p.push(x,0,z);uv.push(x*.5+.5,1-z);
      }
      if(i<32){const n=i*2;indices.push(n,n+2,n+1,n+1,n+2,n+3);}
    }
  } else {
    p.push(...(vertical?[-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0]:[-.5,0,-.5,.5,0,-.5,.5,0,.5,-.5,0,.5]));
    uv.push(0,1,1,1,1,0,0,0);indices.push(0,1,2,0,2,3);
  }
  return createMeshBuilder({attributes:{position:new Float32Array(p),uv:new Float32Array(uv)},indices:new Uint16Array(indices)}).build().unwrap();
}
export function particleMesh(count:number):MeshAsset {
  const position=new Float32Array(count*3),normal=new Float32Array(count*3),tangent=new Float32Array(count*4);
  for(let i=0;i<count;i++){normal[i*3+2]=1;tangent[i*4]=1;tangent[i*4+3]=1;}
  const attributes={position,normal,tangent,uv:new Float32Array(count*2),uv1:new Float32Array(count*2),color:new Float32Array(count*4)};
  const packed=packInterleavedVertexAttributes(attributes,count).unwrap();
  return {kind:'mesh',vertices:packed.vertices,attributes,aabb:new Float32Array([-32,-8,-32,32,16,32]),
    submeshes:[{indexOffset:0,indexCount:0,vertexCount:count,topology:'point-list',materialSlot:0}],materialSlots:[{slotName:'vfx-particles'}]};
}
