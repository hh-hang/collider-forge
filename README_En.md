# collider-forge

[简体中文](README.md) | English

Visual tool for loading glTF, 3D Tiles, and Gaussian Splat / point-cloud assets, generating collision meshes, and exporting collider `.glb` files.

![collider-forge demo](./public/imgs/demo.jpg)

## Getting Started

The current prebuilt version supports Windows x64 only.

1. Download and extract [collider-forge v0.1.0](https://github.com/hh-hang/collider-forge/archive/refs/tags/v0.1.0.zip).
2. Run the following commands in the extracted project directory:

   ```bash
   npm install
   npm run dev
   ```

3. Open http://localhost:5174 in your browser.

## Features

- Load local `.glb` / `.gltf` models.
- Load remote glTF / GLB URLs.
- Load 3D Tiles tilesets from URL.
- Load Google 3D Tiles through Cesium Ion.
- Generate a merged trimesh collider from visible model geometry.
- Preview local or remote `.ply`, `.spz`, `.splat`, `.ksplat`, and bundled `.sog` files with Spark.
- Extract decoded point positions from Spark and reconstruct colliders with an adjustable Poisson depth.
- Import an existing collider `.glb`.
- Export collider `.glb` with optional Draco compression.
- Choose export up axis for Cesium-style Z-up or glTF / three.js Y-up workflows.

> Only single-file bundled `.sog` assets are currently supported. Unbundled SOG datasets made up of `meta.json` and multiple WebP files are not yet supported.

## Credits

[three.js](https://github.com/mrdoob/three.js)

[3d-tiles-renderer](https://github.com/NASA-AMMOS/3D-Tiles-Renderer-ThreeJS)

[Spark](https://github.com/sparkjsdev/spark)

[Open3D](https://github.com/isl-org/Open3D)

[draco](https://github.com/google/draco)

> License notices for the third-party runtime files under `public/libs` are documented in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
