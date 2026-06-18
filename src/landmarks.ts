// 3D Tiles 场景原点的默认位置

export interface Landmark {
    name: string;
    lon: number;
    lat: number;
    height: number;
}

export const DEFAULT_ORIGIN: Landmark = {
    name: "Statue of Liberty",
    lon: -74.0445,
    lat: 40.6892,
    height: 10,
};
