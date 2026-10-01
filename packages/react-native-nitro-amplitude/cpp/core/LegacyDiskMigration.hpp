#pragma once

#include "JsonlSegmentStore.hpp"

#include <exception>
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

} // namespace NitroAmplitude
