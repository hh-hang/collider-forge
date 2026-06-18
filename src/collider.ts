import * as THREE from "three";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

// 补全必要属性:position 必须存在,缺 normal / uv 则补
function ensureAttributesMinimal(geom: THREE.BufferGeometry): THREE.BufferGeometry | null {
    if (!geom.attributes.position) return null;
    if (!geom.attributes.normal) geom.computeVertexNormals();
    if (!geom.attributes.uv) {
        const count = geom.attributes.position.count;
        geom.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    return geom;
}

type AttrMeta = {
    itemSize: number;
    arrayCtor: new (len: number) => THREE.TypedArray;
    normalized: boolean;
};

// 统一几何属性格式,确保可以被 mergeGeometries 合并
function unifyAttributes(collected: THREE.BufferGeometry[]): THREE.BufferGeometry[] {
    const required = new Set(["position", "normal", "uv"]);
    const attrMap = new Map<string, AttrMeta>();
    const conflict = new Set<string>();

    // 清除非必要属性
    for (const g of collected)
        for (const name of Object.keys(g.attributes))
            if (!required.has(name)) g.deleteAttribute(name);

    // 统计属性元信息,标记冲突
    for (const g of collected) {
        for (const name of Object.keys(g.attributes)) {
            const attr = g.attributes[name] as THREE.BufferAttribute;
            const ctor = (attr.array as THREE.TypedArray).constructor as AttrMeta["arrayCtor"];
            const existing = attrMap.get(name);
            if (!existing) {
                attrMap.set(name, { itemSize: attr.itemSize, arrayCtor: ctor, normalized: attr.normalized });
            } else if (
                existing.itemSize !== attr.itemSize ||
                existing.arrayCtor !== ctor ||
                existing.normalized !== attr.normalized
            ) {
                conflict.add(name);
            }
        }
    }

    // 移除冲突属性
    for (const name of conflict) {
        for (const g of collected) if (g.attributes[name]) g.deleteAttribute(name);
        attrMap.delete(name);
    }

    // 补齐缺失属性
    for (const [name, meta] of attrMap) {
        for (const g of collected) {
            if (!g.attributes[name]) {
                const count = g.attributes.position.count;
                g.setAttribute(
                    name,
                    new THREE.BufferAttribute(new meta.arrayCtor(count * meta.itemSize), meta.itemSize, meta.normalized)
                );
            }
        }
    }
    return collected;
}

// 收集根节点下所有 mesh 几何,合并成世界坐标系下的单个 trimesh
export function buildColliderGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
    const collected: THREE.BufferGeometry[] = [];

    root.updateMatrixWorld(true);
    root.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        try {
            let geom = mesh.geometry.clone();
            geom.applyMatrix4(mesh.matrixWorld);
            if (geom.index) geom = geom.toNonIndexed();
            const safe = ensureAttributesMinimal(geom);
            if (safe) collected.push(safe);
        } catch (e) {
            console.warn("处理网格时出错:", mesh, e);
        }
    });

    if (!collected.length) return null;
    const unified = unifyAttributes(collected);
    const merged = BufferGeometryUtils.mergeGeometries(unified, false);
    return merged || null;
}

// 导出前无损优化:只保留 position,顶点去重并重建索引
export function optimizeForExport(geom: THREE.BufferGeometry): THREE.BufferGeometry {
    const out = geom.clone();
    for (const name of Object.keys(out.attributes)) {
        if (name !== "position") out.deleteAttribute(name);
    }
    out.deleteAttribute("uv");
    const indexed = BufferGeometryUtils.mergeVertices(out);
    out.dispose();
    return indexed;
}

// 对未压缩 glb 做 Draco 压缩,返回压缩后的 glb
export async function dracoCompressGLB(glb: ArrayBuffer): Promise<ArrayBuffer> {
    // 动态导入,按需加载
    const { WebIO } = await import("@gltf-transform/core");
    const { KHRDracoMeshCompression } = await import("@gltf-transform/extensions");
    const { draco } = await import("@gltf-transform/functions");
    const draco3d = (await import("draco3dgltf")).default;

    // wasm 已复制到 public/libs/draco3dgltf/,这里把 locateFile 指过去
    const locateFile = (path: string): string => {
        if (path.endsWith(".wasm")) return `/libs/draco3dgltf/${path}`;
        return path;
    };

    const io = new WebIO().registerExtensions([KHRDracoMeshCompression]).registerDependencies({
        "draco3d.encoder": await draco3d.createEncoderModule({ locateFile }),
        "draco3d.decoder": await draco3d.createDecoderModule({ locateFile }),
    });

    const doc = await io.readBinary(new Uint8Array(glb));
    await doc.transform(draco());
    const out = await io.writeBinary(doc);
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}
