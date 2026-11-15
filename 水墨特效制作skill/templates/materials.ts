// TEMPLATE. Replace VFX_PACKAGE_ID with a fresh UUID per game; colours (tint/PAPER_RIM/WARNING_RIM) are per art direction.
// Keep the meshNumbers / meshValues split: per-frame updates send numbers only (never texture bindings).
import { AssetGuid } from '@forgeax/engine/pack/guid';
import { definePackageId } from '@forgeax/engine/pack/source';
import { Materials } from '@forgeax/engine/render';
import { RenderQueue, type MaterialAsset } from '@forgeax/engine/types';
import { VFX_TEXTURES, type TextureKey } from './textures.ts';

export const VFX_PACKAGE_ID=definePackageId('e4d86ad0-6535-4f2c-9e5c-56798fbe1001');
export const vfxGuid=(key: string)=>AssetGuid.derive(VFX_PACKAGE_ID,key);
export function materialKey(key:TextureKey, points=false, warning=false, overlay=false) {
  return `material/${points?'points':warning?'warning':overlay?'overlay':'mesh'}/${key}`;
}
/** Screen ink bloom (转场墨晕) textures: drawn last, ignoring scene depth. */
export const OVERLAY_KEYS=['splat-06','splat-08','splat-10'] as const satisfies readonly TextureKey[];
/** Paper-white outline on ink strokes; alpha is outline strength (0 = none). */
export const PAPER_RIM=[.88,.84,.74,.85] as const;
/** Telegraph edge: brighter vermilion so the danger outline reads over its own fill. */
export const WARNING_RIM=[1,.32,.16,1] as const;
/** Numeric parameters only. Per-frame updates must never resend texture bindings (F001: engine 0.4.19
 *  republishes the same texture revision when bindings re-enter the closure, and the render side rejects it). */
export const meshNumbers = () => ({
  tint:[.035,.045,.065,1],rim:[...PAPER_RIM],outline:2.5,tip:0,
  opacity:0,phase:0,split:0,scroll:0,crit:0,vertical:0,sweep:-1,fill:[0,0,0,-1],wedge:[0,0,0,0],bloom:[0,0,0,0],
});
/** Full initial values (bindings + numbers): only for authoring the prototype material. */
export const meshValues = (key:TextureKey) => ({
  maskTexture:{texture:VFX_TEXTURES[key]},noiseTexture:{texture:VFX_TEXTURES.noise},...meshNumbers(),
});
export function createVfxMaterial(key:TextureKey, points=false, warning=false, overlay=false):MaterialAsset {
  const renderState={cullMode:'none' as const,depthWriteEnabled:false,...(overlay?{depthCompare:'always' as const}:{}),
    blend:{color:{srcFactor:'src-alpha' as const,dstFactor:'one-minus-src-alpha' as const,operation:'add' as const},
      alpha:{srcFactor:'one' as const,dstFactor:'one-minus-src-alpha' as const,operation:'add' as const}}};
  // 'splat-00' point batch = solid ink/vermilion droplets (circle sprite, no texture): a textured
  // first splat frame is a tiny star that vanishes at 7–20 px.
  if(points) return Materials.unlit([1,1,1,1],{...(key==='splat-00'?{}:{baseColorTexture:{texture:VFX_TEXTURES[key]}}),
    alphaMode:'preserve',queue:RenderQueue.Transparent+10,renderState:key.startsWith('spark')?{
      ...renderState,blend:{...renderState.blend,color:{srcFactor:'src-alpha',dstFactor:'one',operation:'add'}},
    }:renderState});
  return Materials.standard({surfaceModule:'inkblade::vfx_surface',parameters:[
    {name:'maskTexture',type:'texture'},{name:'noiseTexture',type:'texture'},
    {name:'tint',type:'vec4'},{name:'rim',type:'vec4'},{name:'outline',type:'f32'},{name:'tip',type:'f32'},
    {name:'opacity',type:'f32'},{name:'phase',type:'f32'},
    {name:'split',type:'f32'},{name:'scroll',type:'f32'},{name:'crit',type:'f32'},{name:'vertical',type:'f32'},
    {name:'sweep',type:'f32'},{name:'fill',type:'vec4'},{name:'wedge',type:'vec4'},{name:'bloom',type:'vec4'},
  ],values:meshValues(key),queue:overlay?RenderQueue.Overlay:RenderQueue.Transparent+(warning?100:0),renderState});
}
