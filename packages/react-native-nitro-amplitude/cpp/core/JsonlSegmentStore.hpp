#pragma once

#include "FileAdapter.hpp"
#include "StorageAdapter.hpp"

#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace NitroAmplitude {

class JsonlSegmentStore : public StorageAdapter {
public:
  static constexpr uint64_t kDefaultMaxSegmentBytes = 1024 * 1024;

  JsonlSegmentStore(
      std::shared_ptr<FileAdapter> fileAdapter,
      std::string directory,
      uint64_t maxSegmentBytes = kDefaultMaxSegmentBytes);

  void setDisk(const std::string& key, const std::string& value) override;
  std::optional<std::string> getDisk(const std::string& key) override;
  void deleteDisk(const std::string& key) override;
  bool hasDisk(const std::string& key) override;
  std::vector<std::string> getAllDiskKeys() override;

  size_t migrateLegacyEntries(
      const std::vector<std::pair<std::string, std::string>>& entries);

private:
  struct Entry {
    uint32_t segment;
    uint64_t offset;
    uint32_t length;
  };

  void Load();
  void SetLocked(const std::string& key, const std::string& value);
  void RotateIfNeeded(uint64_t lineLength);
  void CompactSegment(uint32_t segment);
  std::string SegmentPath(uint32_t segment) const;

  std::shared_ptr<FileAdapter> fileAdapter_;
  std::string directory_;
  uint64_t maxSegmentBytes_;
  std::mutex mutex_;
  std::unordered_map<std::string, Entry> index_;
  std::unordered_map<uint32_t, uint64_t> segmentBytes_;
  std::unordered_map<uint32_t, uint64_t> segmentDeadBytes_;
  uint32_t activeSegment_ = 0;
};

} // namespace NitroAmplitude
