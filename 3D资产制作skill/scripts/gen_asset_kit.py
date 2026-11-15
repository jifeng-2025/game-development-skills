"""生成模型（混元等）的 Blender 加工工具。在 Blender 里通过 MCP execute_blender_code 分步调用，
每次只调一个函数，看打印结果和 look 截图后再走下一步。

    ASSET_ROOT = '/path/to/project'
    exec(open('<skill>/scripts/gen_asset_kit.py').read())
    g = GenAsset('enemy-xxx', 'v001')            # 新建独立 Scene「A003_enemy-xxx_v001」
    g.import_raw()                               # 导入 assets/source/<id>/<ver>/raw.glb，应用 glTF 旋转，改名 <id>_body
    g.normalize(height=1.6, face='+Y')           # 缩放到身高，原点脚底中心，最低点 z=0；之后再按需 face_flip()
    g.clean(merge=0.001, min_island=50)          # 合并重点、删小碎块，打印连通块
    g.delete_faces(lambda c, col: c.z > 1.4 and c.x < -0.07)      # 按位置/贴图颜色删面（飘带、烟雾等）
    g.assign_material('glow', '#8C6A2B', lambda c, col: ..., emit=0.6)  # 按位置/颜色把面分到新材质
    g.save_texture_raw()                         # 原贴图存成 tex_raw_basecolor.png，再在外部跑 flatten_texture.py
    g.use_texture('T_<id>_body_basecolor.png')   # 换成色块化贴图（只保留 baseColor，金属 0 粗糙 1）
    g.decimate(target_tris=3900)                 # 减面 + 30° 平滑 + 再删碎块
    g.boolean_cut(cutter_obj_name)               # 布尔切（用 FLOAT 求解器）
    g.outline(0.015)                             # 外壳描边：法线外推 + 翻面，三角面不翻倍
    g.export()                                   # 导出 GLB（无扩展）+ 3 张预览 + 写独立 .blend
颜色判断函数参数：c = 面中心（Blender 坐标），col = 该面 UV 采样的 baseColor (r,g,b) 线性 0~1。
约定：Blender Z 向上，正面朝 +Y → glTF 正面朝 -Z。
"""
import bpy, bmesh, math, mathutils, os
import numpy as np

ROOT = globals().get('ASSET_ROOT') or os.environ.get('ASSET_ROOT')
assert ROOT, '先设置 ASSET_ROOT'
OUTLINE_HEX = globals().get('OUTLINE_HEX', '#0A0A0A')


def srgb(h):
    c = [int(h.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


def _bsdf(m):
    return [n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'][0]


def _safe_bsdf(b):
    """避免导出 KHR_materials_specular / emissive_strength 等扩展。"""
    b.inputs['Specular IOR Level'].default_value = 0.5
    b.inputs['IOR'].default_value = 1.5
    b.inputs['Metallic'].default_value = 0.0
    b.inputs['Roughness'].default_value = 1.0
    if b.inputs['Emission Strength'].default_value > 1.0:
        b.inputs['Emission Strength'].default_value = 1.0


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


class GenAsset:
    def __init__(self, aid, ver='v001'):
        self.aid, self.ver = aid, ver
        self.src = f'{ROOT}/assets/source/{aid}/{ver}'
        self.exp = f'{ROOT}/assets/exports/{aid}/{ver}'
        self.prev = f'{ROOT}/assets/previews/{aid}/{ver}'
        for d in (self.src, self.exp, self.prev):
            os.makedirs(d, exist_ok=True)
        self.sc = _new_scene(f'A003_{aid}_{ver}')
        self.body = None

    # ---------- 导入与规整 ----------
    def import_raw(self, path=None):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path or f'{self.src}/raw.glb')
        new = [o for o in bpy.data.objects if o not in before]
        o = [x for x in new if x.type == 'MESH'][0]
        o.data.transform(o.matrix_world)            # glTF 导入带 90° 旋转，烘进网格
        o.matrix_world = mathutils.Matrix.Identity(4)
        o.rotation_mode = 'XYZ'
        for x in new:
            if x is not o:
                bpy.data.objects.remove(x)
        o.name = o.data.name = f'{self.aid}_body'
        o.data.materials[0].name = f'M_{self.aid}_body'
        self.body = o
        return self.info()

    def normalize(self, height, feet_band=0.05):
        me = self.body.data
        zs = [v.co.z for v in me.vertices]
        me.transform(mathutils.Matrix.Scale(height / (max(zs) - min(zs)), 4))
        vs = [v.co for v in me.vertices]
        zmin = min(v.z for v in vs)
        feet = [v for v in vs if v.z < zmin + feet_band * height / 1.6]
        cx = sum(v.x for v in feet) / len(feet); cy = sum(v.y for v in feet) / len(feet)
        me.transform(mathutils.Matrix.Translation((-cx, -cy, -zmin)))
        me.update()
        return self.info()

    def face_flip(self):
        """混元输出正面朝 -Y；按约定需要正面朝 +Y，所以绕 Z 转 180°。截图确认后再调用。"""
        for o in self._objs():
            o.data.transform(mathutils.Matrix.Rotation(math.pi, 4, 'Z')); o.data.update()
        return self.info()

    def clean(self, merge=0.001, min_island=50):
        bm = bmesh.new(); bm.from_mesh(self.body.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
        sizes, rm = self._islands(bm, min_island)
        bmesh.ops.delete(bm, geom=rm, context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(self.body.data); bm.free()
        print('islands', sorted(sizes, reverse=True)[:8], 'removed faces', len(rm))
        return self.info()

    @staticmethod
    def _islands(bm, min_island):
        bm.faces.ensure_lookup_table(); seen = set(); sizes = []; rm = []
        for f in bm.faces:
            if f.index in seen:
                continue
            st = [f]; isl = []; seen.add(f.index)
            while st:
                c = st.pop(); isl.append(c)
                for e in c.edges:
                    for g in e.link_faces:
                        if g.index not in seen:
                            seen.add(g.index); st.append(g)
            sizes.append(len(isl))
            if len(isl) < min_island:
                rm += isl
        return sizes, rm

    # ---------- 按位置 / 颜色选面 ----------
    def _face_colors(self):
        me = self.body.data
        img = [n.image for n in me.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE'][0]
        W, H = img.size
        px = np.empty(W * H * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(H, W, 4)
        n = len(me.polygons)
        uv = np.empty(len(me.loops) * 2, dtype=np.float32); me.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
        ls = np.empty(n, dtype=np.int32); me.polygons.foreach_get('loop_start', ls)
        fu = (uv[ls] + uv[ls + 1] + uv[ls + 2]) / 3
        return px[np.clip((fu[:, 1] % 1 * H).astype(int), 0, H - 1), np.clip((fu[:, 0] % 1 * W).astype(int), 0, W - 1), :3]

    def select(self, pred):
        cols = self._face_colors()
        return [p.index for p in self.body.data.polygons if pred(p.center, cols[p.index])]

    def delete_faces(self, pred):
        idx = set(self.select(pred))
        bm = bmesh.new(); bm.from_mesh(self.body.data); bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in idx], context='FACES')
        bm.to_mesh(self.body.data); bm.free()
        print('deleted', len(idx))
        return self.clean(merge=0.0, min_island=50)

    def assign_material(self, part, hex_color, pred, emit=0.0):
        me = self.body.data
        m = bpy.data.materials.new(f'M_{self.aid}_{part}'); m.use_nodes = True
        b = _bsdf(m); col = srgb(hex_color)
        b.inputs['Base Color'].default_value = col
        if emit:
            b.inputs['Emission Color'].default_value = col; b.inputs['Emission Strength'].default_value = min(emit, 1.0)
        _safe_bsdf(b); m.use_backface_culling = True; m.diffuse_color = col
        me.materials.append(m); mi = len(me.materials) - 1
        idx = self.select(pred)
        for i in idx:
            me.polygons[i].material_index = mi
        print(part, 'faces', len(idx))
        return len(idx)

    # ---------- 贴图 ----------
    def save_texture_raw(self):
        img = [n.image for n in self.body.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE'][0]
        p = f'{self.src}/tex_raw_basecolor.png'
        img.filepath_raw = p; img.file_format = 'PNG'; img.save()
        print('saved', p, img.size[:]); return p

    def use_texture(self, filename, part='body'):
        m = bpy.data.materials[f'M_{self.aid}_{part}']
        t = [n for n in m.node_tree.nodes if n.type == 'TEX_IMAGE'][0]
        old = t.image
        im = bpy.data.images.load(f'{self.src}/{filename}', check_existing=False)
        im.name = t.name = f'T_{self.aid}_{part}_basecolor'
        t.image = im
        b = _bsdf(m); _safe_bsdf(b)
        for l in list(m.node_tree.links):          # 只留 baseColor：断开法线/金属/粗糙贴图
            if l.to_node == b and l.to_socket.name != 'Base Color':
                m.node_tree.links.remove(l)
        m.use_backface_culling = True
        if old and old.users == 0:
            bpy.data.images.remove(old)

    # ---------- 网格 ----------
    def decimate(self, target_tris, smooth_deg=30):
        o = self.body; me = o.data
        tris = self.tris(o)
        mod = o.modifiers.new('Decimate', 'DECIMATE'); mod.decimate_type = 'COLLAPSE'
        mod.ratio = min(1.0, target_tris / tris); mod.use_collapse_triangulate = True
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='Decimate')
        self.clean(merge=0.0, min_island=50)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_deg))
        zmin = min(v.co.z for v in me.vertices)           # 减面会让最低点略低于 0，重新贴地
        me.transform(mathutils.Matrix.Translation((0, 0, -zmin))); me.update()
        print('tris', tris, '->', self.tris(o), 'floor fix', round(zmin, 4))

    def boolean_cut(self, cutter_name):
        """EXACT 求解器在生成网格上会静默失败（不报错但没切掉），统一用 FLOAT。调用后检查区域内残留面数。"""
        o = self.body; c = bpy.data.objects[cutter_name]
        m = o.modifiers.new('Cut', 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.object = c; m.solver = 'FLOAT'
        bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier='Cut')
        c.hide_set(True); c.hide_render = True
        print('tris after cut', self.tris(o))

    def outline(self, thick, src=None, name=None):
        """外壳描边：复制网格 → 顶点沿法线外推 thick → 翻转面 → 纯黑无光材质 + 背面剔除。
        比 Solidify 省一半三角面（不留内层）。外壳最低点压回 z=0。"""
        s = bpy.data.objects[src] if src else self.body
        name = name or (s.name.replace('_body', '') + '_outline')
        me = s.data.copy(); me.name = name
        ob = bpy.data.objects.new(name, me); self.sc.collection.objects.link(ob)
        bm = bmesh.new(); bm.from_mesh(me); bm.normal_update()
        for v in bm.verts:
            v.co += v.normal * thick
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        for v in bm.verts:
            if v.co.z < 0:
                v.co.z = 0.0
        bm.to_mesh(me); bm.free()
        me.materials.clear()
        mname = f'M_{name}'
        m = bpy.data.materials.get(mname) or bpy.data.materials.new(mname); m.use_nodes = True
        b = _bsdf(m); b.inputs['Base Color'].default_value = srgb(OUTLINE_HEX); _safe_bsdf(b)
        m.use_backface_culling = True; m.diffuse_color = (0.003, 0.003, 0.003, 1)
        me.materials.append(m)
        for p in me.polygons:
            p.material_index = 0
        while me.uv_layers:
            me.uv_layers.remove(me.uv_layers[0])
        return ob

    # ---------- 检查 ----------
    def _objs(self):
        return [o for o in self.sc.objects if o.type == 'MESH' and o.name.startswith(self.aid) and not o.hide_render]

    @staticmethod
    def tris(o):
        return sum(len(p.vertices) - 2 for p in o.data.polygons)

    def info(self):
        out = {}
        for o in self._objs():
            vs = [v.co for v in o.data.vertices]
            out[o.name] = dict(tris=self.tris(o), x=(round(min(v.x for v in vs), 3), round(max(v.x for v in vs), 3)),
                               y=(round(min(v.y for v in vs), 3), round(max(v.y for v in vs), 3)),
                               z=(round(min(v.z for v in vs), 3), round(max(v.z for v in vs), 3)),
                               mats=[m.name for m in o.data.materials])
        print(out); return out

    # ---------- 导出 ----------
    def export(self, target_z, scale, names=None):
        names = names or [o.name for o in self._objs()]
        for o in self.sc.objects:
            o.select_set(o.name in names)
        glb = f'{self.exp}/{self.aid}.glb'
        bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, use_active_scene=True,
                                  export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
                                  export_animations=False, export_skins=False, export_morph=False, export_extras=False)
        cam = bpy.data.objects.get('A003_cam') or bpy.data.objects.new('A003_cam', bpy.data.cameras.new('A003_cam'))
        if cam.name not in self.sc.collection.objects:
            self.sc.collection.objects.link(cam)
        cam.data.type = 'ORTHO'; self.sc.camera = cam
        r = self.sc.render; r.engine = 'BLENDER_WORKBENCH'; r.resolution_x = r.resolution_y = 1024
        sh = self.sc.display.shading
        sh.light = 'FLAT'; sh.color_type = 'TEXTURE'; sh.show_backface_culling = True
        sh.background_type = 'VIEWPORT'; sh.background_color = (0.216, 0.216, 0.216)
        a = math.radians(55)
        for nm, d in (('oblique55', (0, math.cos(a), math.sin(a))), ('front', (0, 1, 0)), ('side', (-1, 0, 0))):
            d = mathutils.Vector(d).normalized()
            cam.location = mathutils.Vector((0, 0, target_z)) + d * 60
            cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
            cam.data.ortho_scale = scale; cam.data.clip_end = 200
            r.filepath = f'{self.prev}/{self.aid}__{nm}.png'
            bpy.ops.render.render(write_still=True)
        keep = {}
        for im in bpy.data.images:
            if im.name.startswith(f'T_{self.aid}_') and im.filepath:
                keep[im.name] = bpy.path.abspath(im.filepath)
                im.filepath = '//' + os.path.basename(im.filepath)
        bpy.data.libraries.write(f'{self.src}/{self.aid}.blend', {self.sc}, path_remap='RELATIVE_ALL', fake_user=True)
        for n, p in keep.items():                 # 恢复当前会话的绝对路径，不然贴图会丢
            bpy.data.images[n].filepath = p
        print(glb, round(os.path.getsize(glb) / 1048576, 3), 'MB')
        return glb
