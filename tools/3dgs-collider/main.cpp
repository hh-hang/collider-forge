#include <open3d/Open3D.h>

#include <algorithm>
#include <Eigen/Eigenvalues>
#include <cctype>
#include <cstdint>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

constexpr float kPoissonScale = 1.1f;

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

// Density only tightens the distance constraint in weakly supported regions.
class SurfaceSupport
{
    struct SupportBand
    {
        SupportBand(const open3d::geometry::PointCloud& cloud,
                    std::vector<double> pointSpacing)
            : tree(cloud), spacing(std::move(pointSpacing)),
              maxSpacing(*std::max_element(spacing.begin(), spacing.end())) {}

        open3d::geometry::KDTreeFlann tree;
        std::vector<double> spacing;
        double maxSpacing;
    };

public:
    SurfaceSupport(const open3d::geometry::PointCloud& cloud,
                   const std::vector<double>& densities,
                   double minimumSpacing)
    {
        open3d::geometry::KDTreeFlann sourceTree(cloud);
        auto spacing = estimateSpacing(cloud, sourceTree);
        // Do not demand accuracy below the finest Poisson cell.
        std::vector<open3d::geometry::PointCloud> bandClouds;
        std::vector<std::vector<double>> bandSpacing;
        for (size_t i = 0; i < spacing.size(); ++i)
        {
            const double s = (std::max)(spacing[i], minimumSpacing);
            const auto band = static_cast<size_t>(std::ilogb(s / minimumSpacing));
            if (band >= bandClouds.size())
            {
                bandClouds.resize(band + 1);
                bandSpacing.resize(band + 1);
            }
            bandClouds[band].points_.push_back(cloud.points_[i]);
            bandSpacing[band].push_back(s);
        }
        for (size_t i = 0; i < bandClouds.size(); ++i)
        {
            if (!bandSpacing[i].empty())
                bands_.push_back(std::make_unique<SupportBand>(
                    bandClouds[i], std::move(bandSpacing[i])));
        }
        if (densities.empty()) throw std::runtime_error("Missing Poisson densities.");
        auto sorted = densities;
        const auto index = static_cast<size_t>((sorted.size() - 1) * 0.01);
        std::nth_element(sorted.begin(), sorted.begin() + index, sorted.end());
        low_density_ = sorted[index];
    }

    bool contains(const Eigen::Vector3d& point, double density)
    {
        if (!point.allFinite() || !std::isfinite(density)) return false;
        const double factor = density < low_density_ ? 1.0 : 1.5;
        const double factor2 = factor * factor;
        // Accept the union of local support regions. A dense nearest point
        // must not hide valid support from slightly farther, coarser points.
        for (auto it = bands_.rbegin(); it != bands_.rend(); ++it)
        {
            auto& band = **it;
            if (band.tree.SearchKNN(point, 1, indices_, distance2_) != 1) continue;
            const double s = band.spacing[indices_[0]];
            if (distance2_[0] <= factor2 * s * s) return true;
            const double radius = factor * band.maxSpacing;
            if (distance2_[0] > radius * radius) continue;
            band.tree.SearchRadius(point, radius, indices_, distance2_);
            for (size_t i = 0; i < indices_.size(); ++i)
            {
                const double candidateSpacing = band.spacing[indices_[i]];
                if (distance2_[i] <= factor2 * candidateSpacing * candidateSpacing) return true;
            }
        }
        return false;
    }

private:
    std::vector<std::unique_ptr<SupportBand>> bands_;
    std::vector<int> indices_;
    std::vector<double> distance2_;
    double low_density_;
};

void trimUnsupportedSurface(open3d::geometry::TriangleMesh& mesh,
                            const open3d::geometry::PointCloud& cloud,
                            const std::vector<double>& densities,
                            double minimumSpacing)
{
    if (densities.size() != mesh.vertices_.size())
        throw std::runtime_error("Poisson density count does not match vertices.");
    SurfaceSupport support(cloud, densities, minimumSpacing);
    std::vector<bool> supported;
    supported.reserve(mesh.vertices_.size());
    for (size_t i = 0; i < mesh.vertices_.size(); ++i)
        supported.push_back(support.contains(mesh.vertices_[i], densities[i]));
    std::vector<bool> remove(mesh.triangles_.size(), false);
    for (size_t i = 0; i < mesh.triangles_.size(); ++i)
    {
        const auto& face = mesh.triangles_[i];
        const auto a = face[0], b = face[1], c = face[2];
        const auto& p = mesh.vertices_[a];
        const auto& q = mesh.vertices_[b];
        const auto& r = mesh.vertices_[c];
        // Face and edge checks reject large triangles bridging empty space.
        const bool keep = supported[a] && supported[b] && supported[c] &&
            support.contains((p + q + r) / 3.0,
                             (densities[a] + densities[b] + densities[c]) / 3.0) &&
            support.contains((p + q) / 2.0, (densities[a] + densities[b]) / 2.0) &&
            support.contains((q + r) / 2.0, (densities[b] + densities[c]) / 2.0) &&
            support.contains((r + p) / 2.0, (densities[c] + densities[a]) / 2.0);
        remove[i] = !keep;
    }
    const auto removed = std::count(remove.begin(), remove.end(), true);
    mesh.RemoveTrianglesByMask(remove);
    mesh.RemoveUnreferencedVertices();
    std::cout << "Unsupported triangles removed: " << removed << std::endl;
}

void removeSmallComponents(open3d::geometry::TriangleMesh& mesh,
                           size_t minimumTriangles)
{
    if (mesh.triangles_.empty()) return;
    const auto clusters = mesh.ClusterConnectedTriangles();
    const auto& labels = std::get<0>(clusters);
    const auto& counts = std::get<1>(clusters);
    // Remove whole edge-connected components below the triangle-count limit.
    // A component exactly at the threshold survives; zero disables removal.
    std::vector<bool> remove(mesh.triangles_.size(), false);
    size_t removedComponents = 0, removedTriangles = 0;
    for (size_t i = 0; i < counts.size(); ++i)
    {
        if (counts[i] < minimumTriangles)
        {
            ++removedComponents;
            removedTriangles += counts[i];
        }
    }
    for (size_t i = 0; i < labels.size(); ++i)
        remove[i] = counts[labels[i]] < minimumTriangles;
    mesh.RemoveTrianglesByMask(remove);
    mesh.RemoveUnreferencedVertices();
    std::cout << "Small components removed: " << removedComponents << " / "
              << counts.size() << " (" << removedTriangles << " triangles; component triangles < "
              << minimumTriangles << ")" << std::endl;
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

struct CachedReconstruction
{
    std::shared_ptr<open3d::geometry::PointCloud> cloud;
    std::shared_ptr<open3d::geometry::TriangleMesh> mesh;
    std::vector<double> densities;
    int depth;
};

void saveReconstruction(const std::string& directory,
                        const CachedReconstruction& reconstruction)
{
    const std::filesystem::path root(directory);
    std::filesystem::create_directories(root);
    if (!open3d::io::WritePointCloud((root / "cloud.ply").string(), *reconstruction.cloud) ||
        !open3d::io::WriteTriangleMesh((root / "mesh.ply").string(), *reconstruction.mesh))
        throw std::runtime_error("Failed to cache reconstruction geometry.");
    std::ofstream data(root / "support.bin", std::ios::binary);
    const uint64_t count = reconstruction.densities.size();
    const int32_t depth = reconstruction.depth;
    data.write("CFPC0001", 8);
    data.write(reinterpret_cast<const char*>(&depth), sizeof(depth));
    data.write(reinterpret_cast<const char*>(&count), sizeof(count));
    data.write(reinterpret_cast<const char*>(reconstruction.densities.data()),
               static_cast<std::streamsize>(count * sizeof(double)));
    if (!data) throw std::runtime_error("Failed to cache support data.");
}

CachedReconstruction loadReconstruction(const std::string& directory)
{
    const std::filesystem::path root(directory);
    CachedReconstruction result;
    result.cloud = open3d::io::CreatePointCloudFromFile((root / "cloud.ply").string());
    result.mesh = open3d::io::CreateMeshFromFile((root / "mesh.ply").string());
    if (!result.cloud || result.cloud->points_.size() < 32 ||
        !result.mesh || result.mesh->triangles_.empty())
        throw std::runtime_error("Cached reconstruction is missing or invalid.");
    std::ifstream data(root / "support.bin", std::ios::binary);
    char magic[8];
    int32_t depth = 0;
    uint64_t count = 0;
    data.read(magic, 8);
    data.read(reinterpret_cast<char*>(&depth), sizeof(depth));
    data.read(reinterpret_cast<char*>(&count), sizeof(count));
    if (!data || std::string(magic, 8) != "CFPC0001" || depth < 6 || depth > 10 ||
        count != result.mesh->vertices_.size())
        throw std::runtime_error("Cached support data does not match the mesh.");
    result.depth = depth;
    result.densities.resize(static_cast<size_t>(count));
    data.read(reinterpret_cast<char*>(result.densities.data()),
              static_cast<std::streamsize>(count * sizeof(double)));
    if (!data) throw std::runtime_error("Cached support data is truncated.");
    return result;
}

}  // namespace

// Clean points -> normals -> Poisson -> optional support / component removal.
int run(int argc, char** argv)
{
    const bool postprocess = argc > 1 && std::string(argv[1]) == "--postprocess-cache";
    if (argc < 3 || (postprocess && argc < 4))
    {
        std::cout
            << "Usage:\n"
            << "3dgs_collider.exe input.ply output.(ply|glb|obj|stl) [depth] [--trim-unsupported] [--remove-small-components] [--min-component-triangles 100]\n"
            << "  add --cache-dir <directory> to save the original reconstruction\n"
            << "3dgs_collider.exe --postprocess-cache <directory> output.glb [--trim-unsupported] [--remove-small-components] [--min-component-triangles 100]\n"
            << "  input must be .ply\n"
            << "  depth default = 9; support trimming and component removal are OFF by default\n";
        return 0;
    }

    std::string inputPath = postprocess ? "" : argv[1];
    std::string outputPath = argv[postprocess ? 3 : 2];
    std::string cacheDirectory = postprocess ? argv[2] : "";
    int depth = 9;
    bool depthProvided = false;
    bool trimUnsupported = false;
    bool cleanSmallComponents = false;
    bool componentThresholdProvided = false;
    int minimumComponentTriangles = 100;
    for (int i = postprocess ? 4 : 3; i < argc; ++i)
    {
        const std::string argument = argv[i];
        if (argument == "--cache-dir" && !postprocess)
        {
            if (++i >= argc) throw std::runtime_error("Missing cache directory.");
            cacheDirectory = argv[i];
            if (cacheDirectory.empty()) throw std::runtime_error("Empty cache directory.");
            continue;
        }
        if (argument == "--trim-unsupported")
        {
            trimUnsupported = true;
            continue;
        }
        if (argument == "--remove-small-components")
        {
            cleanSmallComponents = true;
            continue;
        }
        if (argument == "--min-component-triangles")
        {
            if (++i >= argc) throw std::runtime_error("Missing component triangle count.");
            const std::string value = argv[i];
            size_t consumed = 0;
            const auto count = std::stoll(value, &consumed);
            if (consumed != value.size() || count < 0 || count > (std::numeric_limits<int>::max)())
                throw std::runtime_error("Component triangle count must be an integer in [0, 2147483647].");
            minimumComponentTriangles = static_cast<int>(count);
            componentThresholdProvided = true;
            continue;
        }
        if (postprocess || depthProvided || argument.rfind("--", 0) == 0)
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

    if (componentThresholdProvided && !cleanSmallComponents)
        throw std::runtime_error("--min-component-triangles requires --remove-small-components.");
    if (!postprocess && !endsWithIgnoreCase(inputPath, ".ply"))
    {
        std::cerr << "Only .ply input is supported.\n";
        return -1;
    }

    if (depth < 6 || depth > 10)
    {
        std::cerr << "depth must be in [6, 10].\n";
        return -1;
    }

    CachedReconstruction reconstruction;
    if (postprocess)
    {
        std::cout << "Loading cached reconstruction..." << std::endl;
        reconstruction = loadReconstruction(cacheDirectory);
        depth = reconstruction.depth;
    }
    else
    {
        auto cloud = open3d::io::CreatePointCloudFromFile(inputPath);

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
                kPoissonScale,
                false,
                -1
            );

        reconstruction = { cloud, std::get<0>(poissonResult), std::move(std::get<1>(poissonResult)), depth };
        if (!cacheDirectory.empty())
        {
            std::cout << "Caching original reconstruction..." << std::endl;
            saveReconstruction(cacheDirectory, reconstruction);
        }
    }
    auto mesh = reconstruction.mesh;
    const auto& densities = reconstruction.densities;

    std::cout
        << "Reconstructed mesh:"
        << "\nVertices: "
        << mesh->vertices_.size()
        << "\nTriangles: "
        << mesh->triangles_.size()
        << std::endl;

    if (trimUnsupported)
    {
        std::cout << "Trimming unsupported surface..." << std::endl;
        // Filtering affects support only; all variants use the same Poisson mesh.
        auto supportCloud = removeIsolatedPoints(*reconstruction.cloud);
        if (supportCloud->points_.size() < 32)
            throw std::runtime_error("Too few points remain for support trimming.");
        // Preserve the original reconstruction cube's resolution even when
        // isolated points are excluded from the support cloud.
        const double cubeSize = (reconstruction.cloud->GetMaxBound() - reconstruction.cloud->GetMinBound()).maxCoeff() * kPoissonScale;
        trimUnsupportedSurface(*mesh, *supportCloud, densities,
                               cubeSize / static_cast<double>(1 << depth));
    }
    mesh->RemoveDuplicatedVertices();
    mesh->RemoveDuplicatedTriangles();
    mesh->RemoveDegenerateTriangles();
    mesh->RemoveUnreferencedVertices();
    if (cleanSmallComponents)
    {
        std::cout << "Removing small components..." << std::endl;
        removeSmallComponents(*mesh, minimumComponentTriangles);
        if (mesh->triangles_.empty())
            throw std::runtime_error("No surface remains after component filtering; lower --min-component-triangles or disable --remove-small-components.");
    }
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
