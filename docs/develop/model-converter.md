# 3D model converter

`apps/modelconv` turns an uploaded 3D file into one web-ready GLB and a thumbnail. Files from
outside are the riskiest input EcoManage takes, so the converter runs apart from everything else.

## The sandbox

It's its own image (Debian, for the glibc builds of assimp, IfcOpenShell and KTX-Software, on
amd64 and arm64) and its own container:

- no database, Redis, storage or internet: its only network is an internal one shared with the
  worker;
- a read-only file system, with scratch space in `/tmp` only;
- a non-root user, no capabilities, `no-new-privileges`;
- limited memory, CPU and processes;
- each conversion in its own worker thread with capped memory and a real time limit
  (`CONVERT_TIMEOUT_MS`), so a file that crashes a library only fails itself.

## The API

```text
POST /convert   header x-format: glb | gltf | obj | fbx | ifc; body: the file (≤ 30 MB)
  200 { glb, thumbnail (base64), stats }
  422 { reason }        the file is refused, with why
  500 { error }         something went wrong; the worker retries
GET  /health
```

## The pipeline

`src/pipeline.ts`:

1. **Import.**
   - OBJ and FBX → GLB with assimp.
   - IFC → OBJ with IfcOpenShell (`ifc2obj.py`: world coordinates, spaces and openings left out,
     Z-up turned Y-up), then assimp.
   - glTF and GLB: the container is checked, then the Khronos glTF validator; its errors are the
     reason for a refusal.
2. **Units.** A model over 2 km across is read as centimetres, or millimetres; still over 2 km, or
   under 5 cm, is refused.
3. **Clean up** with glTF-Transform: dedup, prune, weld, and centre with the base at y = 0.
4. **Simplify** with meshoptimizer in passes until under 200,000 triangles, allowing a little more
   error each pass; refused if still over.
5. **Textures** to KTX2 with toktx (ETC1S; UASTC for normal maps), at most 2048 px and in multiples
   of 4. Meshes are Draco-compressed.
6. **Thumbnail:** a 480 × 320 PNG drawn in software (flat shading, material colours).

The worker stores the result under a new random `models/<hex>/` prefix; see
[Worker](./worker.md#_3d-uploads).

## Tests

In the dev image the glTF tests run with the rest (the ones needing assimp, IfcOpenShell or toktx
are skipped there). All of them run in the converter's own read-only image; see
[Testing](./testing.md#_3d-model-converter). They build their inputs in code (boxes, a
320,000-triangle terrain, an OBJ, an ASCII FBX made by assimp, a hand-written IFC4 wall) and check
units, centring, simplifying, KTX2 sizes, Draco, the thumbnail, isolation and every refusal.
