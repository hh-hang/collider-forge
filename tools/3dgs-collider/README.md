# 3dgs-collider

简体中文 | [English](README_En.md)

Windows 本机工具：把 **3DGS / 点云 `.ply`** 经 Open3D Poisson 重建为碰撞网格。

## 产品约定

- **输入**：仅支持 `.ply`（`.sog` / `.splat` 等请先自行转换，例如用 `splat-transform`）
- **可调参数**：仅 **`depth`**（Poisson 八叉树深度，默认 `9`；常用 `8` 或 `9`）
- **流程对齐 CloudCompare**：估法线 → Poisson → 导出（不做降采样 / 去离群 / 面数简化）

## 开箱即用

本目录已附带预编译结果（无需先编译）：

- `build/Release/3dgs_collider.exe`
- 同目录运行库：`Open3D.dll`、`tbb12.dll` 等

`collider-forge` 开发模式会直接调用上述 exe。也可用环境变量 `THREEDGS_COLLIDER_EXE` 指向别的可执行文件。

## 依赖（仅在需要重新编译时）

- Visual Studio 2022（「使用 C++ 的桌面开发」）
- CMake
- Open3D Windows **open3d-devel** 预编译包（例如解压到 `D:\Open3D`）

## 重新编译（可选）

只有改了 `main.cpp`、换了 Open3D 版本，或本机没有可用的 `build/Release` 时才需要：

```bat
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 -DOpen3D_ROOT=D:\Open3D
cmake --build build --config Release --target 3dgs_collider
```

编译成功后，CMake POST_BUILD 会再次把 `Open3D.dll`、`tbb12.dll` 等拷到 exe 同目录（覆盖/补齐运行库）。

## 命令行

```bat
build\Release\3dgs_collider.exe 输入.ply 输出.glb [depth]
```

示例：

```bat
build\Release\3dgs_collider.exe scene.ply collision.glb 8
```

输出扩展名决定格式，支持 `.ply` / `.glb` / `.obj` / `.stl` 等 Open3D 可写格式。

`depth` 范围：`6`–`10`。

## 与 collider-forge 联调

开发模式下，`collider-forge` 的 `npm run dev` 会通过：

```text
POST /api/3dgs-collider?depth=9
```

调用本目录下的 `build\Release\3dgs_collider.exe`。右侧面板 **3DGS PLY** 中选文件并调节 depth 即可生成碰撞体。
