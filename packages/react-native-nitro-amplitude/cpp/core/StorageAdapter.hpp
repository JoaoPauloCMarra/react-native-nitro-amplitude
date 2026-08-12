#pragma once

#include <optional>
#include <string>
#include <vector>

namespace NitroAmplitude {

class StorageAdapter {
public:
  virtual ~StorageAdapter() = default;

  virtual void setDisk(const std::string& key, const std::string& value) = 0;
  virtual std::optional<std::string> getDisk(const std::string& key) = 0;
  virtual void deleteDisk(const std::string& key) = 0;
  virtual bool hasDisk(const std::string& key) = 0;
  virtual std::vector<std::string> getAllDiskKeys() = 0;
};

} // namespace NitroAmplitude
