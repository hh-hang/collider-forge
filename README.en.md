# collider-forge

[简体中文](README.md) | English

Visual tool for loading glTF and 3D Tiles, generating collision meshes, and exporting collider `.glb` files.

![collider-forge demo](./public/imgs/demo.jpg)

## Features

- Load local `.glb` / `.gltf` models.
- Load remote glTF / GLB URLs.
- Load 3D Tiles tilesets from URL.
- Load Google 3D Tiles through Cesium Ion.
- Generate a merged trimesh collider from visible model geometry.
- Import an existing collider `.glb`.
- Export collider `.glb` with optional Draco compression.
- Choose export up axis for Cesium-style Z-up or glTF / three.js Y-up workflows.

## Development

```bash
npm install
npm run dev
```

Open http://localhost:5174 in your browser.

## Third-Party Runtime Files

This repository includes several third-party JavaScript and WebAssembly runtime files under `public/libs` for model decoding, texture transcoding, and Draco export support.

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for details.

## Credits

[three.js](https://github.com/mrdoob/three.js)

[3d-tiles-renderer](https://github.com/NASA-AMMOS/3D-Tiles-Renderer-ThreeJS)

[draco](https://github.com/google/draco)
