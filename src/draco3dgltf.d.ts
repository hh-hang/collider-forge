declare module "draco3dgltf" {
    const draco3dgltf: {
        createEncoderModule(opts?: object): Promise<unknown>;
        createDecoderModule(opts?: object): Promise<unknown>;
    };
    export default draco3dgltf;
}
