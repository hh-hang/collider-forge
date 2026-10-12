# 3dgs-collider

简体中文 | [English](README_En.md)

Windows 本机工具：把 **3DGS / 点云 `.ply`** 经 Open3D Poisson 重建为碰撞网格。

## 产品约定

- **输入**：仅支持 `.ply`（`.sog` / `.splat` 等请先自行转换，例如用 `splat-transform`）
- **可调参数**：**`depth`**（Poisson 八叉树深度，默认 `9`；常用 `8` 或 `9`）、可选的 **支撑裁剪** 和 **小连通块清理**（均默认关闭）
- **默认流程**：清理重复 / 非有限点 → 估法线 → Poisson → 导出（不做降采样 / 面数简化）
- 至少需要 32 个不同的有限坐标点；完全共面的输入使用统一平面法线。

## 生成与后处理预览

网页先点击 **Generate** 生成未经支撑裁剪或碎块筛选的原始 Poisson 碰撞体。成功后出现 **Post-processing** 控件：两个开关和 **Min triangles** 的修改会自动更新预览，只对已生成的网格做后处理，不再估法线或运行 Poisson。

每次处理从同一份原始网格开始，先支撑裁剪，再清理独立碎块，不会在已裁剪网格上反复删除。取消两个选项直接恢复浏览器保存的原始结果；处理过的组合由服务端缓存，最多保留 8 个组合。失败时保留上一份有效预览，快速切换以最新选择为准。状态栏显示当前 / 原始三角形数量，导出采用当前预览。

后处理仅适用于本次生成的 3DGS 碰撞体；导入的碰撞体不含支撑数据，仍支持显示、深度遮挡和导出。修改 Poisson depth 或模型需要重新 **Generate**。重新生成、清除碰撞体、替换模型或关闭页面会释放旧缓存；服务重启后需要重新生成。

## 点云支撑裁剪

**Trim unsupported surfaces** 默认关闭，原始碰撞体生成后切换即可预览。CLI 使用 `--trim-unsupported`。后处理中从支撑点云排除孤立噪声点：最近邻距离超过周围邻点典型间距的 4 倍才排除，避免使用全局密度阈值。该筛除只影响支撑判断，不改变原始 Poisson 重建。

局部间距 `s` 是最近 8 个非重复邻点距离的上中位数，间距下限 `h = 1.1 × 原始重建点云最长跨度 / 2^depth`。普通位置的支撑半径为 `1.5 × max(s, h)`，Poisson 密度最低 1% 的位置为 `max(s, h)`。按间距分层查询邻近输入点，只要有点的支撑范围覆盖被检查位置，就算有支撑，避免最近密集点簇导致误删。

检查三角形的三个顶点、中心和三条边中点，所有位置都有支撑才保留，避免大三角形跨越无采样区域。裁剪只删除面，不执行补洞；稀疏或薄的真实结构仍可能出现缺口，密集的错误点簇仍可能被保留，需要检查实际场景。

网页从解码结果中提取所有坐标有效的高斯中心作为输入。CLI 读取普通 XYZ 点云，不解析 3DGS 的透明度 / 协方差属性。

## 独立碎片清理

Poisson 重建可能生成多个互不连接的网格块。**Remove small components** 是独立开关，默认关闭，不需要开启支撑裁剪。原始碰撞体生成后切换即可预览。**Min triangles** 默认 `100`，接受 `0` 到 `2147483647` 的整数，数值越大删除越多，`0` 不删除任何块；未勾选时隐藏该输入框。

在可选支撑裁剪和基础网格清理完成后，通过共享边划分三角形连通块，统计每块的三角形数量。删除数量严格小于门槛的整块及其未引用顶点；恰好等于门槛的块保留。例如门槛 `100` 时，99 个三角形的块删除，100 个三角形的块保留。若所有块都低于门槛，生成会报错并提示降低门槛或关闭清理。

CLI 示例：`3dgs_collider.exe input.ply collision.glb 9 --remove-small-components --min-component-triangles 100`。仅使用 `--remove-small-components` 时也默认采用 `100`，数量参数必须与清理开关一起使用。

此选项无法判断独立块是否是真实物体，三角形少但面积大的物体也可能被删除；可以降低门槛。三角形数量受重建深度和网格细分影响，调整 `depth` 后可能需要重新调整门槛。与主体通过三角形边相连的伪网格不属于独立连通块，无法用此选项清除。只有共点而不共边的面按不同块处理。连通分析额外增加内存和生成耗时。

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
build\Release\3dgs_collider.exe 输入.ply 输出.glb [depth] [--trim-unsupported] [--remove-small-components] [--min-component-triangles 100]
```

示例：

```bat
build\Release\3dgs_collider.exe scene.ply collision.glb 8
```

可选开启独立碎片清理：

```bat
build\Release\3dgs_collider.exe scene.ply collision.glb 8 --remove-small-components --min-component-triangles 100
```

输出扩展名决定格式，支持 `.ply` / `.glb` / `.obj` / `.stl` 等 Open3D 可写格式。

`depth` 范围：`6`–`10`。

## 与 collider-forge 联调

开发模式下，`collider-forge` 的 `npm run dev` 会通过：

```text
POST /api/3dgs-collider?depth=9
```

返回原始 GLB，并通过 `X-Collider-Cache-Id` 返回缓存 ID。服务调用 `build\Release\3dgs_collider.exe input.ply base.glb 9 --cache-dir <临时目录>`，保存原始网格、点云和密度数据。

```text
POST /api/3dgs-collider/postprocess?cacheId=<ID>&trimUnsupported=true&removeSmallComponents=true&minComponentTriangles=100
DELETE /api/3dgs-collider/cache?cacheId=<ID>
```

后处理调用 `3dgs_collider.exe --postprocess-cache <目录> preview.glb [--trim-unsupported] [--remove-small-components] [--min-component-triangles 100]`，返回预览 GLB；参数默认关闭，数量默认 `100`。`X-Collider-Cache-Hit` 表示是否复用处理结果。DELETE 释放缓存，任务仍在使用时会等任务结束后清理目录。
