// TEMPLATE (from a shipped ForgeaX 0.4.19 game). Rename the import path `inkblade::vfx_surface` to <game>::vfx_surface
// and keep it in sync with materials.ts `surfaceModule`. Uniform names must match materials.ts parameters exactly.
#define_import_path inkblade::vfx_surface
#import forgeax_material::parameters::{material, maskTexture, maskTexture_sampler, noiseTexture, noiseTexture_sampler}
#import forgeax_material::surface_v1::{SurfaceData, SurfaceInput, surfaceEmissionOnly}

const VERMILION = vec3<f32>(0.85, 0.055, 0.025);

// Mip-filtered: strokes are minified ~5-8x on screen; level-0 sampling aliases dry-brush detail.
fn coverage(uv: vec2<f32>) -> f32 {
  return textureSample(maskTexture, maskTexture_sampler, uv).a;
}

// Ink body + thin paper-white outline: the black stroke matches the in-game reference on
// mid-grey stone; the outline keeps it readable on the current darker ground.
fn evaluate_surface(input: SurfaceInput) -> SurfaceData {
  let uv = select(input.uv0, input.uv0.yx, material.vertical > 0.5);
  // Fan telegraphs (wedge.x > 0): square quad centred on the enemy; remap polar coordinates so the
  // painted wedge (texture half-angle wedge.y, apex v wedge.z, radius wedge.w) matches the real
  // damage half-angle (wedge.x) and radius (fill.z in quad uv). Outside the wedge samples transparent.
  let q = input.uv0 - material.fill.xy;
  let rho = length(q) / max(material.fill.z, 0.001);
  let theta = atan2(q.x, -q.y) * material.wedge.y / max(material.wedge.x, 0.001);
  let wedgeUv = vec2<f32>(0.5, material.wedge.z) + material.wedge.w * rho * vec2<f32>(sin(theta), -cos(theta));
  let shifted = select(uv + vec2<f32>(material.scroll, 0.0), wedgeUv, material.wedge.x > 0.0);
  // Clip to the real footprint: the painted arc brush spills past the straight edges, and the sampler
  // wraps behind the apex. Soft 0.03 rad / 0.04 radius edges.
  let wedgeClip = (1.0 - smoothstep(material.wedge.x, material.wedge.x + 0.03, abs(atan2(q.x, -q.y))))
    * (1.0 - smoothstep(1.08, 1.12, rho));
  let inWedge = select(1.0, wedgeClip, material.wedge.x > 0.0);
  let raw = coverage(shifted);
  // Telegraphs (fill.w >= 0) keep the painted tonal layers; player strokes become solid ink.
  let isWarning = material.fill.w >= 0.0;
  let body = select(smoothstep(0.03, 0.3, raw), raw, isWarning);
  // Outline width in screen pixels (material.outline), constant at any camera distance.
  let d = vec2<f32>(fwidth(shifted.x), fwidth(shifted.y)) * material.outline * (1.0 + 1.2 * material.crit);
  let dx = vec2<f32>(d.x, 0.0);
  let dy = vec2<f32>(0.0, d.y);
  let around = max(
    max(coverage(shifted + dx), coverage(shifted - dx)),
    max(coverage(shifted + dy), coverage(shifted - dy)));
  // Outer silhouette only: dry-brush gaps enclosed by ink on all sides get no paper rim.
  let far = min(
    min(coverage(shifted + dx * 3.0), coverage(shifted - dx * 3.0)),
    min(coverage(shifted + dy * 3.0), coverage(shifted - dy * 3.0)));
  // Rim fades ahead of the ink while dissolving so no paper-white residue floats alone.
  // RGB carries baked rim permission (0 inside gaps enclosed by the stroke silhouette; 1 elsewhere).
  let rimAllowed = smoothstep(0.3, 0.8, textureSample(maskTexture, maskTexture_sampler, shifted).r);
  let ring = clamp(around - body, 0.0, 1.0) * (1.0 - smoothstep(0.15, 0.5, far)) * rimAllowed * material.rim.a
    * (1.0 - smoothstep(0.0, 0.45, material.phase));

  // Arc slashes: angular position on the arc mesh, 0 = thick head (left), 1 = thin tail.
  let p = vec2<f32>((input.uv0.x - 0.5) * 2.0, 1.0 - input.uv0.y);
  let along = clamp((atan2(p.x, p.y) + 1.35) / 2.7, 0.0, 1.0);
  let isSweep = material.sweep >= 0.0;
  let front = 1.0 - clamp(material.sweep, 0.0, 1.0) * 1.12;
  let reveal = select(1.0, smoothstep(front - 0.05, front + 0.05, along), isSweep);
  let tailBias = select(0.0, (along - 0.35) * 0.55, isSweep);

  let noise = textureSample(noiseTexture, noiseTexture_sampler, uv * 2.0).r;
  let erosion = smoothstep(0.4, 1.0, material.phase) * 1.15 + tailBias * step(0.001, material.phase);
  let dissolve = 1.0 - smoothstep(noise - 0.06, noise + 0.06, erosion);
  let split = smoothstep(material.split * 0.52, material.split * 0.52 + 0.025, abs(uv.x - 0.5));
  let edge = smoothstep(0.0, 0.018, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  let shape = reveal * dissolve * select(1.0, split, material.split > 0.0) * edge * inWedge * material.opacity;

  // Telegraph countdown: area within fill.w of the apex (fill.xy, radius fill.z in uv) is solid,
  // the rest stays at 40% so the full danger shape reads from the first frame.
  let reach = select(length(input.uv0 - material.fill.xy) / max(material.fill.z, 0.001), rho, material.wedge.x > 0.0);
  let filled = 1.0 - smoothstep(material.fill.w - 0.04, material.fill.w, reach);
  // Interior stays translucent (≤ ~0.75) so enemies and the player read through; the rim draws the edge.
  let countdown = select(1.0, 0.3 + 0.45 * filled, isWarning);

  var alpha = max(body * countdown, ring) * shape;
  var inkRim = ring;
  // 转场墨晕 (bloom.y > 0): solid ink grows from the screen centre; edge = radius + ink noise.
  if (material.bloom.y > 0.0) {
    let r = length(input.uv0 - vec2<f32>(0.5)) * 2.0;
    let n = textureSample(noiseTexture, noiseTexture_sampler, input.uv0 * 1.7).r;
    // cover 1 reaches the screen corners (quad = 1.15 × diagonal, corners at r ≈ 0.87).
    // Ease-in: the short screen axis fills at r ≈ 0.5, so slow the early growth to keep a visible blob.
    let radius = pow(material.bloom.x, 1.5) * 1.12;
    let front = radius - r + (n - 0.5) * 0.3;
    let bounded = 1.0 - smoothstep(radius + 0.12, radius + 0.2, r);
    let ink = smoothstep(0.0, 0.03, front) * bounded;
    let wash = (smoothstep(-0.06, 0.0, front) - smoothstep(0.0, 0.03, front)) * 0.45 * bounded;
    alpha = max(ink, wash) * material.opacity;
    inkRim = 0.0;
  }
  // 墨锋 multi-Q (tip > 0): the last `tip` of the stroke length (uv0.x) gets a vermilion outline.
  let tipMix = select(0.0, smoothstep(1.0 - material.tip - 0.04, 1.0 - material.tip, input.uv0.x), material.tip > 0.0);
  let rimColor = mix(mix(material.rim.rgb, VERMILION, material.crit), VERMILION, tipMix);
  let rimWeight = select(clamp(ring / max(body + ring, 0.001), 0.0, 1.0), clamp(inkRim / max(alpha, 0.001), 0.0, 1.0), material.bloom.y > 0.0);
  let color = mix(material.tint.rgb, rimColor, rimWeight);
  return surfaceEmissionOnly(input, color, alpha);
}
