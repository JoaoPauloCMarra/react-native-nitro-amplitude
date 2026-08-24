cmake_minimum_required(VERSION 3.18.0)

project(NitroAmplitude)

set(CMAKE_VERBOSE_MAKEFILE ON)
set(CMAKE_CXX_STANDARD 20)

file(GLOB SOURCES
  "../cpp/bindings/*.cpp"
  "../cpp/core/*.cpp"
  "./src/main/cpp/*.cpp"
)
list(FILTER SOURCES EXCLUDE REGEX ".*/[^/]*Test\\.cpp$")

add_library(
  NitroAmplitude
  SHARED
  ${SOURCES}
)

target_include_directories(
  NitroAmplitude
  PRIVATE
  "../cpp/core"
  "../cpp/bindings"
  "./src/main/cpp"
)

include("../nitrogen/generated/android/NitroAmplitude+autolinking.cmake")

target_link_libraries(
  NitroAmplitude
  android
  log
)
