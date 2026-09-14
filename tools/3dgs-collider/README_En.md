# 3dgs-collider

[简体中文](README.md) | English

Windows native tool: convert a **3DGS / point-cloud `.ply`** into a collision mesh with Open3D Poisson reconstruction.

## Product rules

- **Input:** `.ply` only (convert `.sog` / `.splat` yourself first, e.g. with `splat-transform`)
- **Tunable parameter:** **`depth` only** (Poisson octree depth, default `9`; CloudCompare often uses `8` or `9`)
- **Pipeline aligned with CloudCompare:** estimate normals → Poisson → export (no downsample / outlier removal / decimation)

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
build\Release\3dgs_collider.exe input.ply output.glb [depth]
```

Example:

```bat
build\Release\3dgs_collider.exe scene.ply collision.glb 8
```

Output format follows the file extension (`.ply` / `.glb` / `.obj` / `.stl`, whatever Open3D can write).

`depth` must be in `6`–`10`.

## Use with collider-forge

In collider-forge `npm run dev`, the UI calls:

```text
POST /api/3dgs-collider?depth=9
```

which runs `build\Release\3dgs_collider.exe` under this folder. Use the **3DGS PLY** panel to pick a file and set depth.
