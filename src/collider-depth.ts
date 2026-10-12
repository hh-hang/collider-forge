import * as THREE from "three";

// Share the collider geometry, but rasterize filled faces into depth only.
export function createColliderDepthMesh(geometry: THREE.BufferGeometry) {
    const material = new THREE.MeshBasicMaterial({
        colorWrite: false,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "ColliderDepth";
    mesh.renderOrder = -1000;
    mesh.raycast = () => {};
    return mesh;
}

// Draw splat color first, then replace its depth with the collider surface.
// Writing collider depth before Spark would cut splats out of the color image.
export function renderWithColliderDepth(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    splat: THREE.Object3D | null,
    spark: THREE.Object3D,
    colliderDepth: THREE.Object3D | null
): void {
    if (!splat || !colliderDepth?.visible) {
        renderer.render(scene, camera);
        return;
    }

    const base = new Set([splat, spark]);
    const objects = scene.children.map((object) => ({ object, visible: object.visible }));
    const autoClear = renderer.autoClear;
    const background = scene.background;
    try {
        for (const { object } of objects) {
            if (!base.has(object)) object.visible = false;
        }
        renderer.render(scene, camera);

        for (const { object, visible } of objects) {
            object.visible = base.has(object) ? false : visible;
        }
        renderer.autoClear = false;
        // A Three.js Color background forces a color clear even with autoClear
        // disabled. Keep the splat image intact during the second pass.
        scene.background = null;
        renderer.clear(false, true, false);
        renderer.render(scene, camera);
    } finally {
        scene.background = background;
        renderer.autoClear = autoClear;
        for (const { object, visible } of objects) object.visible = visible;
    }
}
