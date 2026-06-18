# Third-Party Notices

This project includes third-party runtime files required for decoding, transcoding, and exporting 3D assets in the browser.

Package dependencies installed through npm are listed in `package.json` and `package-lock.json`. This notice focuses on third-party files distributed directly in `public/libs`.

## Google Draco

Source: https://github.com/google/draco  
License: Apache License 2.0

Files:

- `public/libs/draco/gltf/draco_decoder.js`
- `public/libs/draco/gltf/draco_decoder.wasm`
- `public/libs/draco/gltf/draco_encoder.js`
- `public/libs/draco/gltf/draco_wasm_wrapper.js`

These files are used by three.js `DRACOLoader` for Draco-compressed glTF assets.

## Basis Universal

Source: https://github.com/BinomialLLC/basis_universal  
License: Apache License 2.0

Files:

- `public/libs/basis/basis_transcoder.js`
- `public/libs/basis/basis_transcoder.wasm`
- `public/libs/basis/README.md`

These files are used by three.js `KTX2Loader` for Basis Universal / KTX2 texture transcoding.

## draco3dgltf

Source: https://github.com/google/draco  
npm package: https://www.npmjs.com/package/draco3dgltf  
License: Apache License 2.0

Files:

- `public/libs/draco3dgltf/draco_decoder_gltf.wasm`
- `public/libs/draco3dgltf/draco_encoder.wasm`

These files are used for Draco compression during collider `.glb` export.
