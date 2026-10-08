#include <open3d/Open3D.h>

#include <algorithm>
#include <Eigen/Eigenvalues>
#include <cctype>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

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

// Measure spacing locally so sparse regions do not inherit a dense region's
// tolerance. Duplicate points are removed before this.
std::vector<double> estimateSpacing(
    const open3d::geometry::PointCloud& cloud,
    const open3d::geometry::KDTreeFlann& tree)
{
    std::vector<double> spacing;
    spacing.reserve(cloud.points_.size());
    std::vector<int> indices;
    std::vector<double> distance2;
    for (const auto& point : cloud.points_)
    {
        tree.SearchKNN(point, 9, indices, distance2);
        std::vector<double> neighbors;
        for (double d2 : distance2)
        {
            if (d2 > 0.0 && std::isfinite(d2)) neighbors.push_back(d2);
        }
        if (neighbors.empty())
        {
            throw std::runtime_error("Cannot estimate point spacing.");
        }
        spacing.push_back(std::sqrt(neighbors[neighbors.size() / 2]));
    }
    return spacing;
}

std::shared_ptr<open3d::geometry::PointCloud> removeIsolatedPoints(
    const open3d::geometry::PointCloud& cloud)
{
    open3d::geometry::KDTreeFlann tree(cloud);
    const auto spacing = estimateSpacing(cloud, tree);
    std::vector<size_t> keep;
    std::vector<int> indices;
    std::vector<double> distance2;
    std::vector<double> neighborSpacing;
    for (size_t i = 0; i < cloud.points_.size(); ++i)
    {
        tree.SearchKNN(cloud.points_[i], 9, indices, distance2);
        neighborSpacing.clear();
        for (size_t j = 1; j < indices.size(); ++j)
        {
            neighborSpacing.push_back(spacing[indices[j]]);
        }
        const auto mid = neighborSpacing.begin() + neighborSpacing.size() / 2;
        std::nth_element(neighborSpacing.begin(), mid, neighborSpacing.end());
        // Compare against nearby spacing rather than a scene-wide mean: a
        // legitimately sparse surface should survive beside a dense surface.
        if (distance2[1] <= 16.0 * (*mid) * (*mid)) keep.push_back(i);
    }
    return cloud.SelectByIndex(keep);
}

// Distance is the primary constraint. Density only tightens that constraint
// for weakly supported vertices; it never deletes a fixed fraction of a scene.
class SurfaceSupport
{
public:
    SurfaceSupport(const open3d::geometry::PointCloud& cloud,
                   const std::vector<double>& densities)
        : tree_(cloud), spacing_(estimateSpacing(cloud, tree_))
    {
        if (densities.empty()) throw std::runtime_error("Missing Poisson densities.");
        auto sorted = densities;
        const auto index = static_cast<size_t>((sorted.size() - 1) * 0.01);
        std::nth_element(sorted.begin(), sorted.begin() + index, sorted.end());
        low_density_ = sorted[index];
    }

    bool contains(const Eigen::Vector3d& point, double density)
    {
        if (!point.allFinite() || !std::isfinite(density)) return false;
        if (tree_.SearchKNN(point, 1, indices_, distance2_) != 1) return false;
        const double spacing = spacing_[indices_[0]];
        const double factor = density < low_density_ ? 0.75 : 1.0;
        return distance2_[0] <= factor * factor * spacing * spacing;
    }

private:
    open3d::geometry::KDTreeFlann tree_;
    std::vector<double> spacing_;
    std::vector<int> indices_;
    std::vector<double> distance2_;
    double low_density_;
};

void trimUnsupportedSurface(open3d::geometry::TriangleMesh& mesh,
                            const open3d::geometry::PointCloud& cloud,
                            const std::vector<double>& densities)
{
    if (densities.size() != mesh.vertices_.size())
    {
        throw std::runtime_error("Poisson density count does not match vertices.");
    }
    SurfaceSupport support(cloud, densities);
    std::vector<bool> supported;
    supported.reserve(mesh.vertices_.size());
    for (size_t i = 0; i < mesh.vertices_.size(); ++i)
    {
        supported.push_back(support.contains(mesh.vertices_[i], densities[i]));
    }
    std::vector<bool> remove(mesh.triangles_.size(), false);
    size_t removed = 0;
    for (size_t i = 0; i < mesh.triangles_.size(); ++i)
    {
        const auto& face = mesh.triangles_[i];
        const auto a = face[0], b = face[1], c = face[2];
        const auto& p = mesh.vertices_[a];
        const auto& q = mesh.vertices_[b];
        const auto& r = mesh.vertices_[c];
        // Vertices alone do not detect large triangles bridging empty space.
        // Check face interiors and edges before changing mesh indices.
        const bool keep = supported[a] && supported[b] && supported[c] &&
            support.contains((p + q + r) / 3.0,
                             (densities[a] + densities[b] + densities[c]) / 3.0) &&
            support.contains((p + q) / 2.0, (densities[a] + densities[b]) / 2.0) &&
            support.contains((q + r) / 2.0, (densities[b] + densities[c]) / 2.0) &&
            support.contains((r + p) / 2.0, (densities[c] + densities[a]) / 2.0);
        if (!keep)
        {
            remove[i] = true;
            ++removed;
        }
    }
    mesh.RemoveTrianglesByMask(remove);
    mesh.RemoveUnreferencedVertices();
    std::cout << "Unsupported triangles removed: " << removed << std::endl;
}

void estimateOrientedNormals(open3d::geometry::PointCloud& cloud)
{
    std::cout << "Estimating normals..." << std::endl;
    const auto covariance = std::get<1>(cloud.ComputeMeanAndCovariance());
    Eigen::SelfAdjointEigenSolver<Eigen::Matrix3d> eigen(covariance);
    if (eigen.info() != Eigen::Success || eigen.eigenvalues()[2] <= 0.0 ||
        eigen.eigenvalues()[1] <= eigen.eigenvalues()[2] * 1e-12)
    {
        throw std::runtime_error("Point cloud needs a surface, not a line or single point.");
    }
    // Tangent-plane orientation uses 3D Delaunay triangulation, which fails
    // for exactly coplanar points. Such clouds have a single known normal.
    if (eigen.eigenvalues()[0] <= eigen.eigenvalues()[2] * 1e-12)
    {
        cloud.normals_.assign(cloud.points_.size(), eigen.eigenvectors().col(0));
        std::cout << "Orienting normals (planar surface)..." << std::endl;
        return;
    }
    cloud.EstimateNormals(open3d::geometry::KDTreeSearchParamKNN(30));
    cloud.NormalizeNormals();
    std::cout << "Orienting normals..." << std::endl;
    cloud.OrientNormalsConsistentTangentPlane(30);
}

}  // namespace

// Clean points -> normals -> PoissonRecon(depth) -> optional support trimming.
int run(int argc, char** argv)
{
    if (argc < 3)
    {
        std::cout
            << "Usage:\n"
            << "3dgs_collider.exe input.ply output.(ply|glb|obj|stl) [depth] [--trim-unsupported]\n"
            << "  input must be .ply\n"
            << "  depth default = 9; support trimming is OFF unless --trim-unsupported is set\n";
        return 0;
    }

    std::string inputPath = argv[1];
    std::string outputPath = argv[2];
    int depth = 9;
    bool depthProvided = false;
    bool trimUnsupported = false;
    for (int i = 3; i < argc; ++i)
    {
        const std::string argument = argv[i];
        if (argument == "--trim-unsupported")
        {
            trimUnsupported = true;
            continue;
        }
        if (depthProvided || argument.rfind("--", 0) == 0)
        {
            throw std::runtime_error("Unknown argument: " + argument);
        }
        size_t consumed = 0;
        depth = std::stoi(argument, &consumed);
        if (consumed != argument.size())
        {
            throw std::runtime_error("depth must be an integer in [6, 10].");
        }
        depthProvided = true;
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

    std::cout << "Cleaning point cloud..." << std::endl;
    cloud->RemoveNonFinitePoints();
    cloud->RemoveDuplicatedPoints();
    if (cloud->points_.size() < 32)
    {
        throw std::runtime_error("At least 32 distinct finite points are required.");
    }
    if (trimUnsupported)
    {
        // Isolated noise must not become support for invented geometry.
        cloud = removeIsolatedPoints(*cloud);
        if (cloud->points_.size() < 32)
        {
            throw std::runtime_error("Too few points remain after outlier removal.");
        }
    }
    std::cout << "Clean points: " << cloud->points_.size() << std::endl;
    estimateOrientedNormals(*cloud);

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
    const auto& densities = std::get<1>(poissonResult);

    std::cout
        << "Poisson mesh:"
        << "\nVertices: "
        << mesh->vertices_.size()
        << "\nTriangles: "
        << mesh->triangles_.size()
        << std::endl;

    if (trimUnsupported)
    {
        std::cout << "Trimming unsupported surface..." << std::endl;
        trimUnsupportedSurface(*mesh, *cloud, densities);
    }
    mesh->RemoveDuplicatedVertices();
    mesh->RemoveDuplicatedTriangles();
    mesh->RemoveDegenerateTriangles();
    mesh->RemoveUnreferencedVertices();
    if (mesh->triangles_.empty())
    {
        throw std::runtime_error("No surface remains; check point cloud quality or increase depth.");
    }
    mesh->ComputeVertexNormals();
    std::cout << "Output mesh: " << mesh->vertices_.size() << " vertices, "
              << mesh->triangles_.size() << " triangles" << std::endl;

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

int main(int argc, char** argv)
{
    try
    {
        return run(argc, argv);
    }
    catch (const std::exception& error)
    {
        std::cerr << "Collider generation failed: " << error.what() << std::endl;
        return 1;
    }
}
