// TEMPLATE. Run: pnpm exec tsx <vfx dir>/verify-materials.mts — cooks one material per kind (mesh / warning / points / overlay).
// Every entry must print "ok": true before you capture anything; a WGSL/parameter mismatch only shows up here or as a blank effect.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMaterialPackCooker } from '@forgeax/engine/shader-compiler';
import { createVfxMaterial } from './materials.ts';
const root=fileURLToPath(new URL('.',import.meta.url));
const cooker=createMaterialPackCooker([root],{profile:'webgpu-storage'});
const results=[];
for(const [key,points,warning,overlay] of [['slash',false,false,false],['fan',false,true,false],['spark-01',true,false,false],['splat-06',false,false,true]] as const){
  try {
    const result=await cooker.cook({guid:`v001-${key}`,source:createVfxMaterial(key,points,warning,overlay),sourcePath:root+'vfx.pack.ts'});
    results.push({key,ok:true,kind:result.kind});
  }catch(error){results.push({key,ok:false,error:String(error),detail:error});}
}
console.log(JSON.stringify(results,null,2));
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(results,null,2)+'\n');
if(results.some(r=>!r.ok))process.exitCode=1;
