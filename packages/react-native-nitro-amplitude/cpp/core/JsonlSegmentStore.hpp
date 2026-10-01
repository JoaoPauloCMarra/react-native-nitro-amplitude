#pragma once

#include "FileAdapter.hpp"
#include "StorageAdapter.hpp"

#include <cstdint>
#include <limits>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

namespace NitroAmplitude {

class SegmentStoreRejectedRecord : public std::runtime_error {
public:
  using std::runtime_error::runtime_error;
};

class JsonlSegmentStore : public StorageAdapter {
public:
  static constexpr uint64_t kDefaultMaxSegmentBytes = 1024 * 1024;
  static constexpr uint64_t kDefaultMaxRecordBytes = std::numeric_limits<uint32_t>::max();

  JsonlSegmentStore(
      std::shared_ptr<FileAdapter> fileAdapter,
      std::string directory,
      uint64_t maxSegmentBytes = kDefaultMaxSegmentBytes,
      uint64_t maxRecordBytes = kDefaultMaxRecordBytes);

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

  enum class AppendResult { Appended, Unavailable, Failed };

  bool Load();
  bool EnsureReadyLocked();
  std::optional<std::set<uint32_t>> ListedSegments();
  bool HasMissingSegment(const std::set<uint32_t>& listed) const;
  AppendResult AppendLineLocked(const std::string& line);
  bool RestoreActiveSegment(uint32_t segmentBeforeRotation);
  void SetLocked(const std::string& key, const std::string& value);
  void AbandonActiveSegmentAfterAppendFailure();
  void RotateIfNeeded(uint64_t lineLength);
  bool CompactSegment(uint32_t segment);
  bool MoveTombstonesToActiveSegment(uint32_t segment, const std::string& tombstones);
  void ReclaimSegmentsWithoutLiveRecords();
  void MaybeCompact(uint32_t segment);
  bool AppendTombstoneLocked(const std::string& key);
  std::string SegmentPath(uint32_t segment) const;

  std::shared_ptr<FileAdapter> fileAdapter_;
  std::string directory_;
  uint64_t maxSegmentBytes_;
  uint64_t maxRecordBytes_;
  std::mutex mutex_;
  std::unordered_map<std::string, Entry> index_;
  std::unordered_map<uint32_t, uint64_t> segmentBytes_;
  std::unordered_map<uint32_t, uint64_t> segmentDeadBytes_;
  std::set<uint32_t> unreadableSegments_;
  std::set<uint32_t> partiallyReadSegments_;
  uint32_t activeSegment_ = 0;
  bool appendsDisabled_ = false;
  bool loaded_ = false;
};

} // namespace NitroAmplitude
