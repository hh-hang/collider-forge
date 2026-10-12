# 3dgs-collider

[简体中文](README.md) | English

Windows native tool: convert a **3DGS / point-cloud `.ply`** into a collision mesh with Open3D Poisson reconstruction.

## Product rules

- **Input:** `.ply` only (convert `.sog` / `.splat` yourself first, e.g. with `splat-transform`)
- **Parameters:** **`depth`** (Poisson octree depth, default `9`; often `8` or `9`), optional **support trimming** and **small component removal** (both off by default)
- **Default pipeline:** remove duplicate / non-finite points → estimate normals → Poisson → export (no downsampling / decimation)
- At least 32 distinct finite points are required. Exactly planar clouds use a shared plane normal.

## Generation and live post-processing

Click **Generate** to reconstruct the original Poisson collider without support trimming or component filtering. The **Post-processing** controls appear after success. Toggling either option or changing **Min triangles** updates the preview from the generated mesh without estimating normals or running Poisson again.

Every edit starts from the same original mesh, applies support trimming first and component removal second, and never accumulates destructive edits. Disable both options to restore the browser's original result. The server caches up to 8 processed combinations. Failed edits retain the previous valid preview; rapid edits apply only the latest selection. The status bar compares current and original triangle counts; exports use the current preview.

Post-processing is available for newly generated 3DGS colliders. Imported colliders lack support data but still support display, depth occlusion and export. Changing Poisson depth or the model requires **Generate** again. Rebuilding, clearing, replacing the model or closing the page releases the old cache. After restarting the server, generate again.

## Point-cloud support trimming

**Trim unsupported surfaces** is off by default; toggle it after generating the original collider to update the preview. Use `--trim-unsupported` in the CLI. During post-processing, isolated points are excluded from support only when their nearest-neighbor distance exceeds 4 times their neighbors' typical spacing, avoiding a scene-wide density threshold. This changes support checks, not the original Poisson reconstruction.

Local spacing `s` is the upper median distance to the nearest 8 distinct neighbors. The spacing floor is `h = 1.1 × longest original reconstruction cloud extent / 2^depth`. Support radius is normally `1.5 × max(s, h)`, or `max(s, h)` in the lowest 1% of Poisson densities. Queries use spacing bands: any nearby input point covering a checked position supplies support, avoiding false rejection by the nearest dense cluster.

Each triangle's three vertices, center and three edge midpoints must be supported, rejecting large faces bridging unsampled regions. Trimming only removes faces and performs no hole repair. Sparse or thin real structures may develop gaps, and dense erroneous clusters may survive; validate on the actual scene.

The web viewer extracts all decoded Gaussian centers with finite coordinates as input. The CLI reads XYZ point clouds and does not interpret 3DGS opacity or covariance properties.

## Disconnected fragment removal

Poisson reconstruction can produce disconnected mesh pieces. **Remove small components** is independent and off by default; it does not require support trimming. Toggle it after generating the original collider to update the preview. **Min triangles** defaults to `100` and accepts integers from `0` through `2147483647`. Higher values remove more pieces; `0` removes none. The input is hidden when cleanup is unchecked.

After optional support trimming and basic mesh cleanup, triangles are clustered by shared edges and each cluster's triangles are counted. Whole components with fewer triangles than the threshold are deleted, along with unreferenced vertices. Components exactly at the threshold remain: at `100`, a 99-triangle component is removed and a 100-triangle component is retained. If all components fall below the threshold, generation fails with a message to lower the threshold or disable cleanup.

CLI example: `3dgs_collider.exe input.ply collision.glb 9 --remove-small-components --min-component-triangles 100`. Using only `--remove-small-components` also defaults to `100`. The count parameter requires the cleanup flag.

This rule cannot tell whether a component is a real object; even a large object with few triangles may be deleted. Lower the threshold to retain it. Triangle counts depend on reconstruction depth and mesh subdivision, so changing `depth` may require retuning the threshold. Artifacts connected to the main surface through triangle edges cannot be removed by this option. Faces sharing only vertices, not edges, are treated as separate components. Connectivity analysis adds memory use and generation time.

## Ready to run

This folder already ships a prebuilt Release (no build step required for normal use):

- `build/Release/3dgs_collider.exe`
- Runtime DLLs beside it: `Open3D.dll`, `tbb12.dll`, etc.

`collider-forge` in dev mode calls that exe. Override with env `THREEDGS_COLLIDER_EXE` if needed.

## Dependencies (only if you rebuild)

- Visual Studio 2022 (Desktop development with C++)
- CMake
- Open3D Windows **open3d-devel** prebuilt package (e.g. extract to `D:\Open3D`)

## Rebuild (optional)

Rebuild only when you change `main.cpp`, switch Open3D versions, or do not have a usable `build/Release`:

```bat
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 -DOpen3D_ROOT=D:\Open3D
cmake --build build --config Release --target 3dgs_collider
```

After a successful build, CMake POST_BUILD copies `Open3D.dll`, `tbb12.dll`, and related runtime files next to the exe again.

## CLI

```bat
build\Release\3dgs_collider.exe input.ply output.glb [depth] [--trim-unsupported] [--remove-small-components] [--min-component-triangles 100]
```

Example:

```bat
build\Release\3dgs_collider.exe scene.ply collision.glb 8
```

To enable optional disconnected fragment removal:

```bat
build\Release\3dgs_collider.exe scene.ply collision.glb 8 --remove-small-components --min-component-triangles 100
```

Output format follows the file extension (`.ply` / `.glb` / `.obj` / `.stl`, whatever Open3D can write).

`depth` must be in `6`–`10`.

## Use with collider-forge

In collider-forge `npm run dev`, the UI calls:

```text
POST /api/3dgs-collider?depth=9
```

This returns the original GLB with its cache ID in `X-Collider-Cache-Id`. The server runs `build\Release\3dgs_collider.exe input.ply base.glb 9 --cache-dir <temporary directory>` to save the original mesh, cloud and densities.

```text
POST /api/3dgs-collider/postprocess?cacheId=<ID>&trimUnsupported=true&removeSmallComponents=true&minComponentTriangles=100
DELETE /api/3dgs-collider/cache?cacheId=<ID>
```

Post-processing runs `3dgs_collider.exe --postprocess-cache <directory> preview.glb [--trim-unsupported] [--remove-small-components] [--min-component-triangles 100]` and returns a preview GLB. Options default to off and the count defaults to `100`. `X-Collider-Cache-Hit` indicates reuse of a processed result. DELETE releases a cache; directory cleanup waits for any active users to finish.
