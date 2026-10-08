# 3dgs-collider

[简体中文](README.md) | English

Windows native tool: convert a **3DGS / point-cloud `.ply`** into a collision mesh with Open3D Poisson reconstruction.

## Product rules

- **Input:** `.ply` only (convert `.sog` / `.splat` yourself first, e.g. with `splat-transform`)
- **Parameters:** **`depth`** (Poisson octree depth, default `9`; often `8` or `9`) and optional **support trimming** (off by default)
- **Default pipeline:** remove duplicate / non-finite points → estimate normals → Poisson → export (no downsampling / decimation)
- **With trimming enabled:** also remove isolated points and trim unsupported surfaces after reconstruction

## Boundary artifact handling

Poisson extrapolates into unsampled regions. **Trim unsupported surfaces** is an optional checkbox, unchecked by default. Check it before clicking **Generate** to apply trimming. In the CLI, pass `--trim-unsupported` to enable it.

When enabled, the tool checks reconstructed vertices, triangle centers, and edge midpoints against the input cloud, removing unsupported faces and bridges across empty space. The support radius uses the upper median distance to each point's nearest 8 distinct neighbors. At vertices in the lowest 1% of Poisson densities, this radius shrinks to 0.75 times the local spacing. Low density alone never forces removal of a fixed percentage of faces.

With trimming enabled, an isolated point is removed only when its nearest-neighbor distance exceeds 4 times its neighbors' typical spacing, preserving legitimate sparse regions alongside dense ones. At least 32 distinct finite points are required. Exactly planar clouds use a shared plane normal.

Only when trimming is enabled, the web viewer excludes decoded splats with opacity below `0.05`. When disabled, all finite centers are retained. The CLI reads XYZ point clouds and does not interpret 3DGS opacity or covariance properties.

Trimmed colliders may have open boundaries: missing data is not filled automatically. Dense erroneous splat clusters can still survive, and very sparse or thin real structures may develop gaps. Validate on the actual scene. Additional neighborhood queries increase generation time.

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
build\Release\3dgs_collider.exe input.ply output.glb [depth] [--trim-unsupported]
```

Example:

```bat
build\Release\3dgs_collider.exe scene.ply collision.glb 8
```

To enable optional support trimming:

```bat
build\Release\3dgs_collider.exe scene.ply collision.glb 8 --trim-unsupported
```

Output format follows the file extension (`.ply` / `.glb` / `.obj` / `.stl`, whatever Open3D can write).

`depth` must be in `6`–`10`.

## Use with collider-forge

In collider-forge `npm run dev`, the UI calls:

```text
POST /api/3dgs-collider?depth=9&trimUnsupported=false
```

which runs `build\Release\3dgs_collider.exe` under this folder. Omitting `trimUnsupported` defaults to `false`; set it to `true` to enable trimming. After loading a model, set depth in the **Gaussian Splat / Point Cloud** panel, optionally check **Trim unsupported surfaces**, then click **Generate**.
