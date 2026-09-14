#include <open3d/Open3D.h>
#include <iostream>
#include <string>

int main(int argc, char** argv)
{
    if (argc < 3)
    {
        std::cout << "Usage: mesh_convert.exe input_mesh output.(glb|gltf|obj|ply|stl)\n";
        return 0;
    }

    std::string inPath = argv[1];
    std::string outPath = argv[2];

    open3d::geometry::TriangleMesh mesh;
    if (!open3d::io::ReadTriangleMesh(inPath, mesh) || mesh.IsEmpty())
    {
        std::cerr << "Failed to read mesh: " << inPath << "\n";
        return -1;
    }

    std::cout
        << "Loaded vertices=" << mesh.vertices_.size()
        << " triangles=" << mesh.triangles_.size()
        << std::endl;

    if (!mesh.HasVertexNormals())
    {
        mesh.ComputeVertexNormals();
    }

    // WriteTriangleMesh picks writer by extension (.glb/.gltf/.obj/.ply/.stl)
    bool ok = open3d::io::WriteTriangleMesh(outPath, mesh, true);
    if (!ok)
    {
        std::cerr << "Failed to write: " << outPath << "\n";
        return -1;
    }

    std::cout << "Wrote " << outPath << std::endl;
    return 0;
}
