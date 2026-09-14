cmake_minimum_required(VERSION 3.24)

project(3dgs_collider LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Open3D REQUIRED)

function(copy_open3d_runtime target_name)
    if (WIN32)
        add_custom_command(TARGET ${target_name} POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "$<TARGET_FILE:Open3D::Open3D>"
                "$<TARGET_FILE_DIR:${target_name}>"
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${Open3D_DIR}/../bin/tbb12.dll"
                "$<TARGET_FILE_DIR:${target_name}>"
            COMMAND ${CMAKE_COMMAND} -E copy_directory
                "${Open3D_DIR}/../bin/resources"
                "$<TARGET_FILE_DIR:${target_name}>/resources"
            COMMENT "Copy Open3D runtime deps next to ${target_name}"
        )
    endif()
endfunction()

add_executable(3dgs_collider main.cpp)
target_link_libraries(3dgs_collider PRIVATE Open3D::Open3D)
copy_open3d_runtime(3dgs_collider)

add_executable(mesh_convert mesh_convert.cpp)
target_link_libraries(mesh_convert PRIVATE Open3D::Open3D)
copy_open3d_runtime(mesh_convert)
