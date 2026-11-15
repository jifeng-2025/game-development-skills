#!/usr/bin/env python3
"""Add KHR_materials_unlit to pure-black materials (ink parts, outline shells, weapon outlines) in a GLB, in place.

Why: Blender's glTF exporter only writes unlit for emission/background shader setups; our Principled-BSDF black
materials come out lit. In ForgeaX two skinned color-factor-only lit materials with different defaults compile to one
program key -> `material-artifact-conflict (param-schema)` at startup. Outlines must be unlit anyway.

usage: glb_set_unlit.py <file.glb> [--names M_a,M_b] [--suffix _outline --suffix _inkarm]
default: every material whose name ends with `_outline` or `_inkarm`.
Prints the material list after patching; exits 1 if a requested --names entry is missing.
"""
import json, struct, sys

def patch(path, names=None, suffixes=('_outline', '_inkarm')):
    b = open(path, 'rb').read()
    magic, ver, _ = struct.unpack('<4sII', b[:12]); assert magic == b'glTF' and ver == 2
    jlen, jtype = struct.unpack('<II', b[12:20]); assert jtype == 0x4E4F534A
    g = json.loads(b[20:20 + jlen]); rest = b[20 + jlen:]
    hit = []
    for m in g.get('materials', []):
        n = m.get('name', '')
        if (names and n in names) or (not names and n.endswith(tuple(suffixes))):
            m.setdefault('extensions', {})['KHR_materials_unlit'] = {}
            hit.append(n)
    if names:
        missing = set(names) - set(hit)
        if missing: print('MISSING', sorted(missing)); sys.exit(1)
    if hit:
        used = g.setdefault('extensionsUsed', [])
        if 'KHR_materials_unlit' not in used: used.append('KHR_materials_unlit')
    js = json.dumps(g, separators=(',', ':'), ensure_ascii=False).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + len(rest)) + struct.pack('<II', len(js), 0x4E4F534A) + js + rest
    open(path, 'wb').write(out)
    print('UNLIT', path, hit, 'extensionsUsed', g.get('extensionsUsed'))
    return hit

if __name__ == '__main__':
    a = sys.argv[1:]; f = a[0]; names = None; suf = []
    for i, x in enumerate(a):
        if x == '--names': names = set(a[i + 1].split(','))
        if x == '--suffix': suf.append(a[i + 1])
    patch(f, names, tuple(suf) or ('_outline', '_inkarm'))
