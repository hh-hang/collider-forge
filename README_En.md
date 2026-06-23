# collider-forge

[简体中文](README.md) | English

Visual tool for loading glTF and 3D Tiles, generating collision meshes, and exporting collider `.glb` files.

![collider-forge demo](./public/imgs/demo.jpg)

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5174 in your browser.

## Features

- Load local `.glb` / `.gltf` models.
- Load remote glTF / GLB URLs.
- Load 3D Tiles tilesets from URL.
- Load Google 3D Tiles through Cesium Ion.
- Generate a merged trimesh collider from visible model geometry.
- Import an existing collider `.glb`.
- Export collider `.glb` with optional Draco compression.
- Choose export up axis for Cesium-style Z-up or glTF / three.js Y-up workflows.

## Credits

[three.js](https://github.com/mrdoob/three.js)

[3d-tiles-renderer](https://github.com/NASA-AMMOS/3D-Tiles-Renderer-ThreeJS)

[draco](https://github.com/google/draco)

> License notices for the third-party runtime files under `public/libs` are documented in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
