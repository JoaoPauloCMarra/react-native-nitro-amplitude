#pragma once

#include "JsonlSegmentStore.hpp"

#include <exception>
#include <functional>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

namespace NitroAmplitude {

struct LegacyDiskMigrationResult {
  std::vector<std::string> handledKeys;
  bool complete = true;
};

inline LegacyDiskMigrationResult migrateLegacyDiskEntries(
    JsonlSegmentStore& store,
    const std::vector<std::pair<std::string, std::string>>& entries) {
  LegacyDiskMigrationResult result;
  result.handledKeys.reserve(entries.size());
  for (const auto& entry : entries) {
    try {
      store.migrateLegacyEntries({entry});
    } catch (const SegmentStoreRejectedRecord&) {
    } catch (const std::exception&) {
      result.complete = false;
      break;
    }
    result.handledKeys.push_back(entry.first);
  }
  return result;
}

struct LegacyDiskSource {
  std::function<std::vector<std::pair<std::string, std::string>>()> entries;
  std::function<void(const std::vector<std::string>&)> remove;
  std::function<void()> clear;
};

class LegacyDiskMigrator {
public:
  explicit LegacyDiskMigrator(LegacyDiskSource source) : source_(std::move(source)) {}

  void ensureMigrated(JsonlSegmentStore& store) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (migrated_) {
      return;
    }
    try {
      const auto entries = source_.entries();
      if (!entries.empty()) {
        const LegacyDiskMigrationResult result = migrateLegacyDiskEntries(store, entries);
        if (!result.complete) {
          if (!result.handledKeys.empty()) {
            source_.remove(result.handledKeys);
          }
          return;
        }
        source_.clear();
      }
      migrated_ = true;
    } catch (const std::exception&) {
    }
  }

  void forget(const std::string& key) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (migrated_) {
      return;
    }
    try {
      source_.remove({key});
    } catch (const std::exception&) {
    }
  }

private:
  LegacyDiskSource source_;
  std::mutex mutex_;
  bool migrated_ = false;
};

} // namespace NitroAmplitude
