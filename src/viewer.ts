import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { CesiumIonAuthPlugin } from "3d-tiles-renderer/plugins";
import { buildColliderGeometry, optimizeForExport, dracoCompressGLB } from "./collider.ts";

export type ModelFormat = "gltf" | "3dtiles";

// 3D Tiles 场景原点(WGS84 度 / 米)
export interface TilesOrigin {
    lon: number;
    lat: number;
    height: number;
}

// three.js 视图器:加载模型,生成和导出碰撞体
export class Viewer {
    readonly scene = new THREE.Scene();
    readonly camera: THREE.PerspectiveCamera;
    readonly renderer: THREE.WebGLRenderer;
    readonly controls: OrbitControls;

    // 当前加载的模型根节点(glb/gltf scene 或 3D Tiles group)
    currentModel: THREE.Object3D | null = null;

    private readonly loader: GLTFLoader;
    private readonly grid: THREE.GridHelper;

    // 3D Tiles 加载器,仅 tileset 模式存在
    private tiles: TilesRenderer | null = null;

    // 当前生成或导入的碰撞体线框
    private collider: THREE.Mesh | null = null;

    // tileset 加载事件可能重复触发,取景只做一次
    private tilesFramed = false;

    constructor(canvas: HTMLCanvasElement) {
        this.scene.background = new THREE.Color(0x1a1d22);

        this.camera = new THREE.PerspectiveCamera(
            50,
            window.innerWidth / window.innerHeight,
            0.01,
            10000
        );
        this.camera.position.set(4, 3, 6);

        this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // GLTFLoader 挂上压缩解码器,支持 Draco / KTX2(basis) / Meshopt 压缩的输入模型
        const draco = new DRACOLoader().setDecoderPath("/libs/draco/gltf/");
        const ktx2 = new KTX2Loader().setTranscoderPath("/libs/basis/").detectSupport(this.renderer);
        this.loader = new GLTFLoader()
            .setDRACOLoader(draco)
            .setKTX2Loader(ktx2)
            .setMeshoptDecoder(MeshoptDecoder);

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;

        // 灯光
        const hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 1.0);
        this.scene.add(hemi);
        const dir = new THREE.DirectionalLight(0xffffff, 1.2);
        dir.position.set(5, 10, 7);
        this.scene.add(dir);

        // 地面网格参考
        this.grid = new THREE.GridHelper(20, 20, 0x444a52, 0x2a2e35);
        this.scene.add(this.grid);

        // 坐标轴
        const axesHelper = new THREE.AxesHelper(20);
        this.scene.add(axesHelper);

        window.addEventListener("resize", this.onResize);
        this.animate();
    }

    // 加载模型:url 可为远程地址或 ObjectURL
    async loadModel(url: string, format: ModelFormat): Promise<THREE.Object3D> {
        if (format === "3dtiles") return this.loadTileset(url);
        const gltf = await this.loader.loadAsync(url);
        this.setModel(gltf.scene);
        this.frameModel(gltf.scene);
        return gltf.scene;
    }

    // 加载普通 3D Tiles tileset(URL)
    private loadTileset(url: string): Promise<THREE.Object3D> {
        return this.setupTiles(new TilesRenderer(url));
    }

    // 加载 Cesium Ion 资产,并按指定经纬高重定位场景原点
    loadIonTileset(
        ionToken: string,
        assetId: string,
        origin: TilesOrigin
    ): Promise<THREE.Object3D> {
        const tiles = new TilesRenderer();
        tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: ionToken, assetId }));
        return this.setupTiles(tiles, origin);
    }

    // 通用 tileset 装配:挂相机/缓存/解码器,首帧加载完成后取景
    private setupTiles(tiles: TilesRenderer, origin?: TilesOrigin): Promise<THREE.Object3D> {
        tiles.setCamera(this.camera);
        tiles.setResolutionFromRenderer(this.camera, this.renderer);
        tiles.errorTarget = 4;
        tiles.lruCache.maxSize = 8000;
        tiles.lruCache.maxBytesSize = 2 * 1024 ** 3; // 2 GB

        tiles.manager.addHandler(/\.(gltf|glb)$/g, this.loader);

        this.disposeTiles();
        this.tiles = tiles;
        this.tilesFramed = false;
        this.setModel(tiles.group);

        return new Promise((resolve) => {
            tiles.addEventListener("load-tileset", () => {
                // load-tileset 会重复触发(嵌套 tileset),取景只做一次
                if (this.tilesFramed) return;
                this.tilesFramed = true;
                this.frameTiles(tiles, origin);
                resolve(tiles.group);
            });
        });
    }

    // 替换当前模型
    private setModel(model: THREE.Object3D): void {
        if (this.currentModel) {
            this.scene.remove(this.currentModel);
            // 3D Tiles 的 group 由 disposeTiles 释放,普通模型走 disposeObject
            if (this.currentModel !== this.tiles?.group) {
                this.disposeObject(this.currentModel);
            }
        }
        this.currentModel = model;
        this.scene.add(model);
        // 新模型加载 → 旧碰撞体作废
        this.disposeCollider();
    }

    // 生成碰撞体:合并当前模型所有 mesh 为 trimesh 线框
    generateCollider(): boolean {
        if (!this.currentModel) return false;
        const merged = buildColliderGeometry(this.currentModel);
        if (!merged) return false;
        this.setColliderGeometry(merged);
        return true;
    }

    // 导入已有碰撞体 glb,替换当前碰撞体
    async importCollider(url: string): Promise<boolean> {
        const gltf = await this.loader.loadAsync(url);
        const merged = buildColliderGeometry(gltf.scene);
        if (!merged) return false;
        this.setColliderGeometry(merged);
        return true;
    }

    // 用给定几何替换当前碰撞体,以蓝色半透明线框显示
    private setColliderGeometry(geom: THREE.BufferGeometry): void {
        this.disposeCollider();
        const mat = new THREE.MeshBasicMaterial({
            color: 0x4a90d9,
            wireframe: true,
            transparent: true,
            opacity: 0.6,
            depthTest: true,
            side: THREE.DoubleSide,
        });
        this.collider = new THREE.Mesh(geom, mat);
        this.scene.add(this.collider);
    }

    // 是否已有碰撞体
    hasCollider(): boolean {
        return this.collider !== null;
    }

    // 清除当前碰撞体
    clearCollider(): void {
        this.disposeCollider();
    }

    // 切换碰撞体显示/隐藏
    setColliderVisible(visible: boolean): void {
        if (this.collider) this.collider.visible = visible;
    }

    // 当前是否加载的是 3D Tiles
    isTileset(): boolean {
        return this.tiles !== null;
    }

    // 读取 tileset 的 errorTarget(SSE 目标;越小 LOD 越精细)
    getErrorTarget(): number {
        return this.tiles ? this.tiles.errorTarget : 0;
    }

    // 设置 tileset 的 errorTarget
    setErrorTarget(value: number): void {
        if (this.tiles) this.tiles.errorTarget = value;
    }

    // 读取缓存瓦片数量上限
    getCacheMaxSize(): number {
        return this.tiles ? this.tiles.lruCache.maxSize : 0;
    }

    // 设置缓存瓦片数量上限
    setCacheMaxSize(value: number): void {
        if (this.tiles) this.tiles.lruCache.maxSize = value;
    }

    // 读取缓存字节上限(GB)
    getCacheMaxBytesGB(): number {
        return this.tiles ? this.tiles.lruCache.maxBytesSize / 1024 ** 3 : 0;
    }

    // 设置缓存字节上限(GB)
    setCacheMaxBytesGB(gb: number): void {
        if (this.tiles) this.tiles.lruCache.maxBytesSize = gb * 1024 ** 3;
    }

    // 导出碰撞体为 glb,可选 Draco 压缩和 Z-up 转换
    async exportColliderGLB(draco = true, zUp = true): Promise<ArrayBuffer> {
        if (!this.collider) throw new Error("No collider generated yet");
        const exporter = new GLTFExporter();
        const exportGeom = optimizeForExport(this.collider.geometry);
        // Y-up → Z-up:绕 X 轴 +90°,(x,y,z)→(x,-z,y)
        if (zUp) exportGeom.rotateX(Math.PI / 2);
        const exportMesh = new THREE.Mesh(exportGeom, new THREE.MeshStandardMaterial());
        const result = (await exporter.parseAsync(exportMesh, { binary: true })) as ArrayBuffer;
        exportGeom.dispose();
        return draco ? dracoCompressGLB(result) : result;
    }

    private disposeCollider(): void {
        if (!this.collider) return;
        this.scene.remove(this.collider);
        this.collider.geometry.dispose();
        (this.collider.material as THREE.Material).dispose();
        this.collider = null;
    }

    // 相机自动对准模型
    private frameModel(model: THREE.Object3D): void {
        const box = new THREE.Box3().setFromObject(model);
        if (box.isEmpty()) return;

        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;

        const dist = maxDim * 2.2;
        this.camera.position.copy(center).add(new THREE.Vector3(dist, dist * 0.7, dist));
        this.camera.near = maxDim / 100;
        this.camera.far = maxDim * 100;
        this.camera.updateProjectionMatrix();

        this.controls.target.copy(center);
        this.controls.update();
    }

    // 用 ENU 标架的逆把 tileset 拉回世界原点并转成 Y-up
    private frameTiles(tiles: TilesRenderer, origin?: TilesOrigin): void {
        const sphere = new THREE.Sphere();
        if (!tiles.getBoundingSphere(sphere) || sphere.radius <= 0) return;
        const radius = sphere.radius;

        // ENU 标架原点:用户指定经纬高,或回退到包围球中心反算
        const carto = { lat: 0, lon: 0, height: 0 };
        if (origin) {
            carto.lat = THREE.MathUtils.degToRad(origin.lat);
            carto.lon = THREE.MathUtils.degToRad(origin.lon);
            carto.height = origin.height;
        } else {
            tiles.ellipsoid.getPositionToCartographic(sphere.center.clone(), carto);
        }
        const enu = new THREE.Matrix4();
        tiles.ellipsoid.getEastNorthUpFrame(carto.lat, carto.lon, carto.height, enu);

        const enuInverse = enu.clone().invert();
        const zUpToYUp = new THREE.Matrix4().makeRotationX(-Math.PI / 2); // ENU 是 Z-up,转成 Y-up
        const finalMatrix = zUpToYUp.multiply(enuInverse);

        tiles.group.matrix.copy(finalMatrix);
        tiles.group.matrixAutoUpdate = false;
        tiles.group.updateMatrixWorld(true);

        if (origin) {
            // Google 全球瓦片:包围球是地球尺度,不能据此取景。
            // 重定位后指定原点已在世界原点,按"站在地面附近俯瞰地标"的米级尺度取景。
            this.frameOriginGround();
        } else {
            this.camera.position.set(radius * 2, radius * 1.5, radius * 2);
            this.camera.near = radius / 100;
            this.camera.far = radius * 100;
            this.camera.updateProjectionMatrix();
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        }
    }

    // Ion 全球瓦片取景:相机置于原点上方约 400m 处斜俯瞰
    private frameOriginGround(): void {
        const dist = 400;
        this.camera.position.set(dist, dist * 0.8, dist);
        this.camera.near = 1;
        this.camera.far = 200000;
        this.camera.updateProjectionMatrix();
        this.controls.target.set(0, 0, 0);
        this.controls.update();
    }

    private disposeTiles(): void {
        if (!this.tiles) return;
        this.tiles.dispose();
        this.tiles = null;
    }

    private disposeObject(obj: THREE.Object3D): void {
        obj.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry) mesh.geometry.dispose();
            const mat = mesh.material;
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else if (mat) (mat as THREE.Material).dispose();
        });
    }

    private onResize = (): void => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    };

    private animate = (): void => {
        requestAnimationFrame(this.animate);
        this.controls.update();
        if (this.tiles) {
            try {
                this.tiles.update();
            } catch (e) {
                console.error("3D Tiles 更新异常:", e);
                // 发生致命异常时可以考虑停止更新，防止控制台刷屏
            }
        }
        this.renderer.render(this.scene, this.camera);
    };
}
