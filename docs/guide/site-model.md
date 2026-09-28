# The site model

Home draws the site in 3D: the building, the solar array on its roof, each device where it
actually is, and the switchboard (the hub) that the flows run through. **Settings → Site model**
sets it up. Owners and installers edit it; managers can view it.

![Settings: the site model](/screenshots/site-model.png){.shot}

There are two ways to get a building: **generate** it, or **upload** a 3D file. Either way, you then
place the devices on it.

## Generate the building

No file needed. Describe the building and the model is built from simple shapes:

- **Outline:** a rectangle from width × depth, or the building's real outline from
  **OpenStreetMap**. EcoManage looks for a building at the site's location (the one containing it,
  else the nearest within 60 m) and uses its outline and, when it's recorded, its number of storeys.
  Only the location is sent to OpenStreetMap's Overpass service. An outline from OpenStreetMap is
  credited "© OpenStreetMap contributors" wherever it's shown.
- **Storeys** (1–30) and their height (2–6 m). Each storey gets a band of windows on the walls that
  face south.
- **Roof array:** the number of panel rows (0–60) and their tilt (0–45°). Panels are laid out on
  the roof in rows from the north edge, only where they fit inside the outline.

A top-down plan beside the form shows the outline and the panels; it is drawn by the same code as
the 3D view, so they always agree.

**Place the devices around the building** (on by default) puts the switchboard in front, the
battery and grid connection to the west, the EV chargers and heat pump to the east, and solar on
the roof. You can still move each one afterwards.

## Upload a 3D file

One file, up to 30 MB:

| Format | Notes |
| ------ | ----- |
| **glTF / GLB** | A `.gltf` must have everything inside it (no separate `.bin` or texture files); a `.glb` always does. Checked with the Khronos glTF validator |
| **OBJ** | Geometry and materials |
| **FBX** | Converted with assimp |
| **IFC** | Building models from BIM tools; spaces and openings are left out |

SketchUp files aren't accepted: export from SketchUp as glTF, OBJ or FBX instead.

The file is converted in an isolated sandbox that has no access to the network or to your data,
then:

- **Units:** a model more than 2 km across is read as centimetres (or millimetres); one that's
  still too big, or smaller than 5 cm, is refused.
- **Centred** with its base on the ground, and **simplified** to under 200,000 triangles.
- **Textures** at most 2048 px, compressed for the web, and a thumbnail drawn for the list.

The list shows each upload with its status (queued, processing, ready, rejected with the reason,
or failed), its size and triangle count. **Use this model** makes the next version of the site
model draw it; the devices' positions carry over. You can go back to the generated building at any
time. An upload in use can't be deleted.

## Place the devices

Choose a device (a source, a load or the hub), click **Move**, then click where it is on the model.
Its label floats just above. You can also type the coordinates, so placing works from the keyboard
and without 3D.

**Save** creates the next version of the model, which Home then draws. Earlier versions are kept.
