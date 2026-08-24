#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace NitroAmplitude {

class FileAdapter {
public:
  virtual ~FileAdapter() = default;

  virtual bool ensureDirectory(const std::string& directory) = 0;
  virtual std::vector<std::string> listFiles(const std::string& directory) = 0;
  virtual std::optional<std::string> readFile(const std::string& path) = 0;
  virtual std::optional<std::string> readRange(
      const std::string& path,
      uint64_t offset,
      uint64_t length) = 0;
  virtual bool appendFile(const std::string& path, const std::string& data) = 0;
  virtual bool writeFile(const std::string& path, const std::string& data) = 0;
  virtual bool removeFile(const std::string& path) = 0;
};

} // namespace NitroAmplitude
