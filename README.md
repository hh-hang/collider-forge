# collider-forge

语言: [中文](./README.md) | [English](./README.en.md)

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

Vite 开发服务器默认运行在 `5174` 端口。

## 模型加载说明

本地文件加载主要面向 `.glb` / `.gltf` 资产。如果 `.gltf` 依赖外部 `.bin` 或贴图文件，单文件选择可能无法完整加载。

3D Tiles 通常是服务或 URL 形态，请使用 URL 加载或 Cesium Ion 加载，不要使用本地文件选择。

## 第三方运行时文件

本仓库在 `public/libs` 下包含若干第三方 JavaScript 和 WebAssembly 运行时文件，用于模型解码、纹理转码和 Draco 导出。

详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
