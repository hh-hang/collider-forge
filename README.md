# collider-forge

简体中文 | [English](README_En.md)

一个用于加载 glTF 与 3D Tiles、生成碰撞网格并导出 collider `.glb` 的可视化工具。

![collider-forge 示例界面](./public/imgs/demo.jpg)

## 功能

- 加载本地 `.glb` / `.gltf` 模型。
- 加载远程 glTF / GLB URL。
- 通过 URL 加载 3D Tiles tileset。
- 通过 Cesium Ion 加载 Google 3D Tiles。
- 从模型几何生成合并后的 trimesh 碰撞体。
- 导入已有 collider `.glb`。
- 导出 collider `.glb`，可选 Draco 压缩。
- 导出时可选择 Cesium 常用的 Z-up，或 glTF / three.js 常用的 Y-up。

## 开发

```bash
npm install
npm run dev
```

打开浏览器访问 http://localhost:5174

## 第三方运行时文件

本仓库在 `public/libs` 下包含若干第三方 JavaScript 和 WebAssembly 运行时文件，用于模型解码、纹理转码和 Draco 导出。

详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 致谢

[three.js](https://github.com/mrdoob/three.js)

[3d-tiles-renderer](https://github.com/NASA-AMMOS/3D-Tiles-Renderer-ThreeJS)

[draco](https://github.com/google/draco)
