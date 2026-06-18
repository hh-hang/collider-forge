import { Viewer, type ModelFormat } from "./viewer.ts";
import { DEFAULT_ORIGIN } from "./landmarks.ts";

// Google 实景 3D Tiles 在 Cesium Ion 上的 asset id
const GOOGLE_TILES_ASSET_ID = "2275207";
// Ion token 在 localStorage 的键
const ION_TOKEN_KEY = "collider-forge.ion-token";

const canvas = document.getElementById("viewport") as HTMLCanvasElement;
const overlay = document.getElementById("overlay") as HTMLDivElement;
const urlInput = document.getElementById("url-input") as HTMLInputElement;
const formatSelect = document.getElementById("format-select") as HTMLSelectElement;
const btnLoadUrl = document.getElementById("btn-load-url") as HTMLButtonElement;
const btnPickFile = document.getElementById("btn-pick-file") as HTMLButtonElement;
const modelFileInput = document.getElementById("model-file") as HTMLInputElement;
const btnGenerate = document.getElementById("btn-generate") as HTMLButtonElement;
const btnExport = document.getElementById("btn-export") as HTMLButtonElement;
const btnImport = document.getElementById("btn-import") as HTMLButtonElement;
const btnClear = document.getElementById("btn-clear") as HTMLButtonElement;
const colliderFileInput = document.getElementById("collider-file") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const groupTiles = document.getElementById("group-tiles") as HTMLDivElement;
const errorTargetInput = document.getElementById("error-target") as HTMLInputElement;
const errorTargetValue = document.getElementById("error-target-value") as HTMLSpanElement;
const cacheMaxSizeInput = document.getElementById("cache-max-size") as HTMLInputElement;
const cacheMaxBytesInput = document.getElementById("cache-max-bytes") as HTMLInputElement;
const dracoExportInput = document.getElementById("draco-export") as HTMLInputElement;
const rowShowCollider = document.getElementById("row-show-collider") as HTMLLabelElement;
const showColliderInput = document.getElementById("show-collider") as HTMLInputElement;
const exportOverlay = document.getElementById("export-overlay") as HTMLDivElement;
const btnExportConfirm = document.getElementById("btn-export-confirm") as HTMLButtonElement;
const btnExportCancel = document.getElementById("btn-export-cancel") as HTMLButtonElement;
const upZInput = document.getElementById("up-z") as HTMLInputElement;
const urlRow = document.getElementById("url-row") as HTMLDivElement;
const ionPanel = document.getElementById("ion-panel") as HTMLDivElement;
const ionTokenInput = document.getElementById("ion-token") as HTMLInputElement;
const originLonInput = document.getElementById("origin-lon") as HTMLInputElement;
const originLatInput = document.getElementById("origin-lat") as HTMLInputElement;
const originHeightInput = document.getElementById("origin-height") as HTMLInputElement;
const btnLoadIon = document.getElementById("btn-load-ion") as HTMLButtonElement;

const viewer = new Viewer(canvas);

function setStatus(msg: string): void {
    statusEl.textContent = msg;
}

// 原始模型加载成功后隐藏导入面板,启用生成碰撞体
function onModelLoaded(name: string): void {
    overlay.classList.add("hidden");
    btnGenerate.disabled = false;

    // 3D Tiles 参数组仅 tileset 时显示
    if (viewer.isTileset()) {
        groupTiles.classList.remove("hidden");
        const et = viewer.getErrorTarget();
        errorTargetInput.value = String(et);
        errorTargetValue.textContent = String(et);
        cacheMaxSizeInput.value = String(viewer.getCacheMaxSize());
        cacheMaxBytesInput.value = String(viewer.getCacheMaxBytesGB());
    } else {
        groupTiles.classList.add("hidden");
    }

    setStatus(`Loaded: ${name}`);
}

// 碰撞体就绪后启用导出/清除和显示开关
function onColliderReady(): void {
    btnExport.disabled = false;
    btnClear.disabled = false;
    rowShowCollider.classList.remove("hidden");
    showColliderInput.checked = true;
    viewer.setColliderVisible(true);
}

// 碰撞体清除后禁用导出/清除,隐藏显示开关
function onColliderCleared(): void {
    btnExport.disabled = true;
    btnClear.disabled = true;
    rowShowCollider.classList.add("hidden");
}

function currentFormat(): ModelFormat {
    return formatSelect.value as ModelFormat;
}

// http(s) 地址走 Vite dev 代理,其它地址原样返回
function maybeProxy(url: string): string {
    if (!/^https?:\/\//i.test(url)) return url;
    return `/proxy/${url}`;
}

async function loadFromUrl(url: string): Promise<void> {
    if (!url) return;
    setStatus("Loading…");
    try {
        await viewer.loadModel(maybeProxy(url), currentFormat());
        onModelLoaded(url);
    } catch (err) {
        setStatus(`Load failed: ${(err as Error).message}`);
    }
}

async function loadFromFile(file: File): Promise<void> {
    if (!/\.(glb|gltf)$/i.test(file.name)) {
        setStatus("Local files support glb / gltf only. Use URL or Ion for 3D Tiles.");
        return;
    }

    // 拖入的本地文件按 glb/gltf 处理(3D Tiles 是多文件目录,需走 URL)
    const objectUrl = URL.createObjectURL(file);
    setStatus("Loading…");
    try {
        await viewer.loadModel(objectUrl, "gltf");
        onModelLoaded(file.name);
    } catch (err) {
        setStatus(`Load failed: ${(err as Error).message}`);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

// 切换格式:Ion 显示专用区,其它显示 URL 行并更新提示
formatSelect.addEventListener("change", () => {
    const isIon = formatSelect.value === "ion";
    ionPanel.classList.toggle("hidden", !isIon);
    urlRow.classList.toggle("hidden", isIon);
    if (!isIon) {
        urlInput.placeholder =
            formatSelect.value === "3dtiles"
                ? "https://example.com/tileset.json"
                : "https://example.com/model.glb";
    }
});

// ==================== URL 加载 ====================
btnLoadUrl.addEventListener("click", () => loadFromUrl(urlInput.value.trim()));
urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadFromUrl(urlInput.value.trim());
});

// ==================== Cesium Ion 加载 ====================
// 原点默认填入自由女神像坐标
originLonInput.value = String(DEFAULT_ORIGIN.lon);
originLatInput.value = String(DEFAULT_ORIGIN.lat);
originHeightInput.value = String(DEFAULT_ORIGIN.height);

// token 持久化:启动回填,输入时保存
ionTokenInput.value = localStorage.getItem(ION_TOKEN_KEY) ?? "";
ionTokenInput.addEventListener("change", () => {
    localStorage.setItem(ION_TOKEN_KEY, ionTokenInput.value.trim());
});

btnLoadIon.addEventListener("click", async () => {
    const token = ionTokenInput.value.trim();
    if (!token) {
        setStatus("Please enter a Cesium Ion access token");
        return;
    }
    const lon = Number(originLonInput.value);
    const lat = Number(originLatInput.value);
    const height = Number(originHeightInput.value);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(height)) {
        setStatus("Origin lon/lat/alt must be valid numbers");
        return;
    }
    localStorage.setItem(ION_TOKEN_KEY, token);
    setStatus("Loading Google 3D Tiles…");
    try {
        await viewer.loadIonTileset(token, GOOGLE_TILES_ASSET_ID, { lon, lat, height });
        onModelLoaded("Google 3D Tiles");
    } catch (err) {
        setStatus(`Load failed: ${(err as Error).message}`);
    }
});

// ==================== 本地文件加载 ====================
btnPickFile.addEventListener("click", () => modelFileInput.click());
modelFileInput.addEventListener("change", () => {
    const file = modelFileInput.files?.[0];
    modelFileInput.value = ""; // 允许重复选同一文件
    if (file) loadFromFile(file);
});

// ==================== 拖拽加载 ====================
window.addEventListener("dragover", (e) => {
    e.preventDefault();
    overlay.classList.add("dragover");
});
window.addEventListener("dragleave", (e) => {
    if (e.relatedTarget === null) overlay.classList.remove("dragover");
});
window.addEventListener("drop", (e) => {
    e.preventDefault();
    overlay.classList.remove("dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFromFile(file);
});

// ==================== 3D Tiles 参数 ====================
errorTargetInput.addEventListener("input", () => {
    const v = Number(errorTargetInput.value);
    errorTargetValue.textContent = String(v);
    viewer.setErrorTarget(v);
});

// 缓存瓦片数上限
cacheMaxSizeInput.addEventListener("change", () => {
    const v = Number(cacheMaxSizeInput.value);
    if (!Number.isFinite(v) || v <= 0) {
        cacheMaxSizeInput.value = String(viewer.getCacheMaxSize());
        return;
    }
    viewer.setCacheMaxSize(v);
    setStatus(`Cache tiles = ${v}`);
});

// 缓存字节上限(GB)
cacheMaxBytesInput.addEventListener("change", () => {
    const v = Number(cacheMaxBytesInput.value);
    if (!Number.isFinite(v) || v <= 0) {
        cacheMaxBytesInput.value = String(viewer.getCacheMaxBytesGB());
        return;
    }
    viewer.setCacheMaxBytesGB(v);
    setStatus(`Cache limit = ${v} GB`);
});

// ==================== 碰撞体操作 ====================
// 生成碰撞体:合并全精度 trimesh,线框显示
btnGenerate.addEventListener("click", () => {
    setStatus("Generating collider…");
    // 让状态文字先渲染再做(合并可能较重)
    requestAnimationFrame(() => {
        const ok = viewer.generateCollider();
        if (ok) {
            onColliderReady();
            setStatus("Collider generated (wireframe)");
        } else {
            setStatus("Generation failed: no usable geometry in scene");
        }
    });
});

// 导入碰撞体:选本地 glb,替换为当前碰撞体
btnImport.addEventListener("click", () => colliderFileInput.click());
colliderFileInput.addEventListener("change", async () => {
    const file = colliderFileInput.files?.[0];
    colliderFileInput.value = ""; // 允许重复选同一文件
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setStatus("Importing collider…");
    try {
        const ok = await viewer.importCollider(objectUrl);
        if (ok) {
            onColliderReady();
            setStatus(`Collider imported: ${file.name}`);
        } else {
            setStatus("Import failed: no usable geometry in file");
        }
    } catch (err) {
        setStatus(`Import failed: ${(err as Error).message}`);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
});

// 清除碰撞体(原始模型保留)
btnClear.addEventListener("click", () => {
    viewer.clearCollider();
    onColliderCleared();
    setStatus("Collider cleared");
});

// 显示/隐藏碰撞体
showColliderInput.addEventListener("change", () => {
    viewer.setColliderVisible(showColliderInput.checked);
});

// ==================== 导出弹窗 ====================
// 点击打开弹窗
function openExportDialog(): void {
    if (!viewer.hasCollider()) return;
    exportOverlay.classList.remove("hidden");
}

function closeExportDialog(): void {
    exportOverlay.classList.add("hidden");
}

btnExport.addEventListener("click", openExportDialog);
btnExportCancel.addEventListener("click", closeExportDialog);
// 点击遮罩空白处关闭
exportOverlay.addEventListener("click", (e) => {
    if (e.target === exportOverlay) closeExportDialog();
});

btnExportConfirm.addEventListener("click", async () => {
    if (!viewer.hasCollider()) return;
    const draco = dracoExportInput.checked;
    const zUp = upZInput.checked;
    closeExportDialog();
    setStatus(draco ? "Exporting (Draco)…" : "Exporting…");
    try {
        const buffer = await viewer.exportColliderGLB(draco, zUp);
        const blob = new Blob([buffer], { type: "model/gltf-binary" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "collider.glb";
        a.click();
        URL.revokeObjectURL(url);
        setStatus("Exported collider.glb");
    } catch (err) {
        setStatus(`Export failed: ${(err as Error).message}`);
    }
});

setStatus("Waiting for a model…");
