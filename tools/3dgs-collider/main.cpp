#include <open3d/Open3D.h>

#include <algorithm>
#include <cctype>
#include <iostream>
#include <string>

namespace {

bool endsWithIgnoreCase(const std::string& value, const std::string& suffix)
{
    if (suffix.size() > value.size())
    {
        return false;
    }
    for (size_t i = 0; i < suffix.size(); ++i)
    {
        const char a = static_cast<char>(
            std::tolower(static_cast<unsigned char>(
                value[value.size() - suffix.size() + i])));
        const char b = static_cast<char>(
            std::tolower(static_cast<unsigned char>(suffix[i])));
        if (a != b)
        {
            return false;
        }
    }
    return true;
}

}  // namespace

// CloudCompare-aligned path:
//   normals -> PoissonRecon(depth) -> mesh
// Product: input must be .ply; only tunable param is poisson depth.
int main(int argc, char** argv)
{
    if (argc < 3)
    {
        std::cout
            << "Usage:\n"
            << "3dgs_collider.exe input.ply output.(ply|glb|obj|stl) [depth]\n"
            << "  input must be .ply\n"
            << "  depth default = 9 (typical CloudCompare: 8 or 9)\n";
        return 0;
    }

    std::string inputPath = argv[1];
    std::string outputPath = argv[2];
    int depth = 9;
    if (argc >= 4)
    {
        depth = std::stoi(argv[3]);
    }

    if (!endsWithIgnoreCase(inputPath, ".ply"))
    {
        std::cerr << "Only .ply input is supported.\n";
        return -1;
    }

    if (depth < 6 || depth > 10)
    {
        std::cerr << "depth must be in [6, 10].\n";
        return -1;
    }

    auto cloud =
        open3d::io::CreatePointCloudFromFile(inputPath);

    if (!cloud || cloud->IsEmpty())
    {
        std::cerr << "Failed to read point cloud.\n";
        return -1;
    }

    std::cout
        << "Input points: "
        << cloud->points_.size()
        << std::endl;

    std::cout << "Estimating normals..." << std::endl;
    cloud->EstimateNormals(
        open3d::geometry::KDTreeSearchParamKNN(30)
    );
    cloud->NormalizeNormals();

    std::cout << "Orienting normals..." << std::endl;
    cloud->OrientNormalsConsistentTangentPlane(30);

    std::cout
        << "Running Poisson reconstruction (depth="
        << depth
        << ")..."
        << std::endl;

    auto poissonResult =
        open3d::geometry::TriangleMesh::
        CreateFromPointCloudPoisson(
            *cloud,
            depth,
            0.0f,
            1.1f,
            false,
            -1
        );

    auto mesh = std::get<0>(poissonResult);
    auto densities = std::get<1>(poissonResult);
    (void)densities;

    std::cout
        << "Poisson mesh:"
        << "\nVertices: "
        << mesh->vertices_.size()
        << "\nTriangles: "
        << mesh->triangles_.size()
        << std::endl;

    mesh->RemoveDuplicatedVertices();
    mesh->RemoveDuplicatedTriangles();
    mesh->RemoveDegenerateTriangles();
    mesh->RemoveUnreferencedVertices();
    mesh->ComputeVertexNormals();

    bool success =
        open3d::io::WriteTriangleMesh(outputPath, *mesh, true);

    if (!success)
    {
        std::cerr << "Failed to write mesh.\n";
        return -1;
    }

    std::cout << "Finished: " << outputPath << std::endl;
    return 0;
}
