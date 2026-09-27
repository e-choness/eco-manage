"""IFC (BIM) to OBJ for the model converter (P5-02).

IfcOpenShell tessellates every building element in world coordinates (metres); spaces and
openings are left out. IFC is Z-up and glTF is Y-up, so (x, y, z) becomes (x, z, -y). Each
material becomes an OBJ material with its diffuse colour. assimp then turns the OBJ into GLB.

Usage: python3 ifc2obj.py in.ifc out.obj
"""

import multiprocessing
import os
import sys

import ifcopenshell
import ifcopenshell.geom


def colour(material):
    d = getattr(material, "diffuse", None)
    if d is None:
        return (0.8, 0.8, 0.8)
    if hasattr(d, "r"):  # IfcOpenShell 0.8 colour object
        return (d.r(), d.g(), d.b())
    return tuple(d)[:3]


def main(src, dst):
    model = ifcopenshell.open(src)
    settings = ifcopenshell.geom.settings()
    try:
        settings.set("use-world-coords", True)
    except Exception:  # IfcOpenShell 0.7
        settings.set(settings.USE_WORLD_COORDS, True)
    skip = model.by_type("IfcSpace") + model.by_type("IfcOpeningElement")
    iterator = ifcopenshell.geom.iterator(settings, model, max(1, multiprocessing.cpu_count() // 2), exclude=skip)
    if not iterator.initialize():
        sys.exit("no geometry")

    mtl = os.path.splitext(dst)[0] + ".mtl"
    materials = {}
    base = 1
    with open(dst, "w") as out:
        out.write(f"mtllib {os.path.basename(mtl)}\n")
        while True:
            shape = iterator.get()
            geometry = shape.geometry
            verts = geometry.verts
            faces = geometry.faces
            ids = geometry.material_ids
            names = []
            for m in geometry.materials:
                name = "m%d" % (len(materials) + 1) if m.name not in materials else materials[m.name][0]
                materials.setdefault(m.name, (name, colour(m)))
                names.append(materials[m.name][0])
            for i in range(0, len(verts), 3):
                x, y, z = verts[i], verts[i + 1], verts[i + 2]
                out.write(f"v {x:.4f} {z:.4f} {-y:.4f}\n")
            current = None
            for f in range(0, len(faces), 3):
                mid = ids[f // 3] if f // 3 < len(ids) else -1
                name = names[mid] if 0 <= mid < len(names) else "default"
                if name != current:
                    out.write(f"usemtl {name}\n")
                    current = name
                a, b, c = faces[f] + base, faces[f + 1] + base, faces[f + 2] + base
                out.write(f"f {a} {b} {c}\n")
            base += len(verts) // 3
            if not iterator.next():
                break

    if base == 1:
        sys.exit("no geometry")
    with open(mtl, "w") as out:
        out.write("newmtl default\nKd 0.8 0.8 0.8\n")
        for name, (r, g, b) in materials.values():
            out.write(f"newmtl {name}\nKd {r:.3f} {g:.3f} {b:.3f}\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
