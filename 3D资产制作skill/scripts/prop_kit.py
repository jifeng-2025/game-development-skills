"""道具手工低模工具（Blender 5.x，经 Blender MCP execute_blender_code 或命令行 exec 载入）。
约定：Blender Z 向上，道具正面朝 +Y（glTF 导出后朝 -Z）；单位米；原点在底面中心。
用法（在 Blender 里）：
    ASSET_ROOT = '/path/to/project'      # 必填：下面有 assets/source|exports|previews
    PROP_VERSION = 'v001'                # 可选
    OUTLINE_HEX = '#0A0A0A'              # 可选：描边外壳颜色
    exec(open('<skill>/scripts/prop_kit.py').read())
    k = PropKit('prop-xxx'); stone = k.mat('stone', tex=...); k.box(...); k.build_object()
    k.outline(0.01); k.export_and_preview(target_z=..., scale=...)
"""
import bpy, bmesh, math, os, json, mathutils

import os as _os
ROOT = globals().get('ASSET_ROOT') or _os.environ.get('ASSET_ROOT')
assert ROOT, '先设置 ASSET_ROOT（项目根目录）'
OUTLINE_HEX = globals().get('OUTLINE_HEX', '#0A0A0A')


def srgb(h):
    c = [int(h.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


def _new_scene(name):
    """有窗口（MCP 交互）时新建独立 Scene 并切过去；命令行 -b 模式没有 window，就清空并复用当前 Scene。"""
    if bpy.context.window is not None:
        sc = bpy.data.scenes.new(name)
        bpy.context.window.scene = sc
        return sc
    sc = bpy.context.scene
    for o in list(sc.objects):
        bpy.data.objects.remove(o)
    sc.name = name
    return sc


class PropKit:
    def __init__(self, aid, version=None):
        version = version or globals().get('PROP_VERSION', 'v001')
        self.aid, self.ver = aid, version
        self.src = f'{ROOT}/assets/source/{aid}/{version}'
        self.exp = f'{ROOT}/assets/exports/{aid}/{version}'
        self.prev = f'{ROOT}/assets/previews/{aid}/{version}'
        for d in (self.src, self.exp, self.prev):
            os.makedirs(d, exist_ok=True)
        name = f'A003_{aid}'
        old = bpy.data.scenes.get(name)
        if old and bpy.context.window is not None:
            for o in list(old.objects):
                if o.name != 'A003_cam':
                    bpy.data.objects.remove(o)
            bpy.data.scenes.remove(old)
        for coll in (bpy.data.objects, bpy.data.meshes):
            for n in (f'{aid}_body', f'{aid}_outline'):
                while True:
                    hit = [x for x in coll if x.name == n or x.name.startswith(n + '.')]
                    if not hit:
                        break
                    for x in hit:
                        coll.remove(x)
        self.sc = _new_scene(name)
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('UVMap')
        self.mats = []          # material order == material_index
        self.mat_idx = {}

    # ---------- materials ----------
    def mat(self, part, color=None, tex=None, emit=0.0, emit_tex=False):
        key = part
        if key in self.mat_idx:
            return self.mat_idx[key]
        mname = f'M_{self.aid}_{part}'
        m = bpy.data.materials.get(mname)
        if m:
            bpy.data.materials.remove(m)
        m = bpy.data.materials.new(mname)
        m.use_nodes = True
        nt = m.node_tree
        b = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
        b.inputs['Metallic'].default_value = 0.0
        b.inputs['Roughness'].default_value = 1.0
        b.inputs['Specular IOR Level'].default_value = 0.5
        b.inputs['IOR'].default_value = 1.5
        if tex:
            iname = f'T_{self.aid}_{part}_basecolor'
            im = bpy.data.images.get(iname)
            if im:
                bpy.data.images.remove(im)
            im = bpy.data.images.load(tex, check_existing=False)
            im.name = iname
            t = nt.nodes.new('ShaderNodeTexImage')
            t.image = im
            t.name = iname
            nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
            if emit_tex:
                nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
                b.inputs['Emission Strength'].default_value = emit
            m.diffuse_color = (0.5, 0.5, 0.5, 1)
        if color:
            col = srgb(color)
            b.inputs['Base Color'].default_value = col
            m.diffuse_color = col
            if emit and not emit_tex:
                b.inputs['Emission Color'].default_value = col
                b.inputs['Emission Strength'].default_value = emit
        m.use_backface_culling = True
        self.mat_idx[key] = len(self.mats)
        self.mats.append(m)
        return self.mat_idx[key]

    # ---------- geometry ----------
    def _uv_face(self, f, scale, fixed=None):
        if fixed is not None:
            for l, uv in zip(f.loops, fixed):
                l[self.uv].uv = uv
            return
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        a, b = [(1, 2), (0, 2), (0, 1)][ax]
        for l in f.loops:
            co = l.vert.co
            l[self.uv].uv = (co[a] / scale, co[b] / scale)

    def face(self, verts, mi, scale=1.0, fixed=None):
        f = self.bm.faces.new(verts)
        f.material_index = mi
        f.normal_update()
        self._uv_face(f, scale, fixed)
        return f

    def box(self, c, size, mi, scale=1.0, rot_z=0.0, skip=(), taper=None):
        """c=中心(x,y,z)，size=(sx,sy,sz)。taper=(tx,ty) 顶面缩放。skip 可含 'top','bottom','-x','+x','-y','+y'."""
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        R = mathutils.Matrix.Rotation(rot_z, 3, 'Z')
        cv = mathutils.Vector(c)
        tx, ty = taper or (1, 1)
        P = {}
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    k = (tx if sz > 0 else 1, ty if sz > 0 else 1)
                    P[(sx, sy, sz)] = self.bm.verts.new(cv + R @ mathutils.Vector((sx * hx * k[0], sy * hy * k[1], sz * hz)))
        quads = {
            'bottom': [(-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1)],
            'top': [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)],
            '-y': [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)],
            '+y': [(1, 1, -1), (-1, 1, -1), (-1, 1, 1), (1, 1, 1)],
            '-x': [(-1, 1, -1), (-1, -1, -1), (-1, -1, 1), (-1, 1, 1)],
            '+x': [(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)],
        }
        out = {}
        for k2, q in quads.items():
            if k2 in skip:
                continue
            out[k2] = self.face([P[i] for i in q], mi, scale)
        return out

    def cyl(self, base, h, r, mi, sides=8, r_top=None, caps=(True, True), scale=1.0, axis=None):
        """竖直圆柱（axis=None），或沿 axis 方向（单位向量）。UV：u 绕周，v 沿高。"""
        r_top = r if r_top is None else r_top
        base = mathutils.Vector(base)
        d = mathutils.Vector(axis).normalized() if axis else mathutils.Vector((0, 0, 1))
        q = mathutils.Vector((0, 0, 1)).rotation_difference(d)
        ring = lambda rr, z: [self.bm.verts.new(base + q @ mathutils.Vector((rr * math.cos(2 * math.pi * i / sides), rr * math.sin(2 * math.pi * i / sides), z))) for i in range(sides)]
        a, b = ring(r, 0), ring(r_top, h)
        circ = 2 * math.pi * r
        for i in range(sides):
            j = (i + 1) % sides
            u0, u1 = circ * i / sides / scale, circ * (i + 1) / sides / scale
            self.face([a[i], a[j], b[j], b[i]], mi, fixed=[(u0, 0), (u1, 0), (u1, h / scale), (u0, h / scale)])
        if caps[0]:
            self.face(list(reversed(a)), mi, scale)
        if caps[1]:
            self.face(b, mi, scale)
        return a, b

    def poly_prism(self, pts2d, y0, y1, mi, scale=1.0):
        """在 XZ 平面给出轮廓（逆时针，从 +Y 看），沿 Y 从 y0 挤到 y1。用于齿轮等。"""
        fr = [self.bm.verts.new((x, y1, z)) for x, z in pts2d]
        bk = [self.bm.verts.new((x, y0, z)) for x, z in pts2d]
        self.face(fr, mi, scale)
        self.face(list(reversed(bk)), mi, scale)
        n = len(pts2d)
        for i in range(n):
            j = (i + 1) % n
            self.face([bk[i], bk[j], fr[j], fr[i]], mi, scale)

    # ---------- finish ----------
    def build_object(self):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(f'{self.aid}_body')
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(f'{self.aid}_body', me)
        self.sc.collection.objects.link(ob)
        self.body = ob
        return ob

    def outline(self, thick):
        me = self.body.data.copy()
        me.name = f'{self.aid}_outline'
        ob = bpy.data.objects.new(f'{self.aid}_outline', me)
        self.sc.collection.objects.link(ob)
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bm.normal_update()
        for v in bm.verts:
            v.co += v.normal * thick
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        for v in bm.verts:
            if v.co.z < 0:
                v.co.z = 0.0
        bm.to_mesh(me)
        bm.free()
        me.materials.clear()
        mn = f'M_{self.aid}_outline'
        m = bpy.data.materials.get(mn)
        if m:
            bpy.data.materials.remove(m)
        m = bpy.data.materials.new(mn)
        m.use_nodes = True
        b = [n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'][0]
        b.inputs['Base Color'].default_value = srgb(OUTLINE_HEX)
        b.inputs['Roughness'].default_value = 1.0
        b.inputs['Metallic'].default_value = 0.0
        m.use_backface_culling = True
        m.diffuse_color = (0.003, 0.003, 0.003, 1)
        me.materials.append(m)
        for p in me.polygons:
            p.material_index = 0
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        self.outl = ob
        return ob

    def stats(self):
        out = {}
        for o in (self.body, self.outl):
            vs = [v.co for v in o.data.vertices]
            out[o.name] = dict(tris=sum(len(p.vertices) - 2 for p in o.data.polygons),
                               min=[round(min(v[i] for v in vs), 4) for i in range(3)],
                               max=[round(max(v[i] for v in vs), 4) for i in range(3)],
                               mats=[m.name for m in o.data.materials])
        return out

    def export_and_preview(self, target_z, scale, side_sign=-1):
        sc = self.sc
        glb = f'{self.exp}/{self.aid}.glb'
        for o in sc.objects:
            o.select_set(o.name in (self.body.name, self.outl.name))
        bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, use_active_scene=True,
                                  export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
                                  export_animations=False, export_skins=False, export_morph=False, export_extras=False)
        cam = bpy.data.objects.get('A003_cam') or bpy.data.objects.new('A003_cam', bpy.data.cameras.new('A003_cam'))
        if cam.name not in sc.collection.objects:
            sc.collection.objects.link(cam)
        cam.data.type = 'ORTHO'
        sc.camera = cam
        sc.render.engine = 'BLENDER_WORKBENCH'
        sc.render.resolution_x = sc.render.resolution_y = 1024
        sh = sc.display.shading
        sh.light = 'FLAT'; sh.color_type = 'TEXTURE'; sh.show_backface_culling = True
        sh.background_type = 'VIEWPORT'; sh.background_color = (0.216, 0.216, 0.216)

        def shoot(name, d):
            d = mathutils.Vector(d).normalized()
            cam.location = mathutils.Vector((0, 0, target_z)) + d * 60
            cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
            cam.data.ortho_scale = scale
            cam.data.clip_end = 200
            sc.render.filepath = f'{self.prev}/{self.aid}__{name}.png'
            bpy.ops.render.render(write_still=True)
        a = math.radians(55)
        shoot('oblique55', (0, math.cos(a), math.sin(a)))
        shoot('front', (0, 1, 0))
        shoot('side', (side_sign, 0, 0))
        keep = {}
        for im in bpy.data.images:
            if im.name.startswith(f'T_{self.aid}_') and im.filepath:
                keep[im.name] = bpy.path.abspath(im.filepath)
                im.filepath = '//' + os.path.basename(im.filepath)
        bf = f'{self.src}/{self.aid}.blend'
        bpy.data.libraries.write(bf, {sc}, path_remap='RELATIVE_ALL', fake_user=True)
        for n, p in keep.items():   # 当前会话里恢复绝对路径，免得贴图丢失
            bpy.data.images[n].filepath = p
        return glb, os.path.getsize(glb) / 1048576


KIT_LOADED = True
