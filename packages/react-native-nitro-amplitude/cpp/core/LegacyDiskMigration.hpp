#pragma once

#include "JsonlSegmentStore.hpp"
#include "StorageAdapter.hpp"

#include <exception>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
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
    if (migrated_ || !armed_) {
      return;
    }
    armed_ = false;
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

  void rearmAfterWrite() {
    std::lock_guard<std::mutex> lock(mutex_);
    armed_ = true;
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
  bool armed_ = true;
};

class MigratingStorage : public StorageAdapter {
public:
  using StoreProvider = std::function<std::shared_ptr<JsonlSegmentStore>()>;

  MigratingStorage(StoreProvider provider, LegacyDiskSource source)
      : provider_(std::move(provider)), migrator_(std::move(source)) {}

  void setDisk(const std::string& key, const std::string& value) override {
    const auto store = migratedStore();
    if (store == nullptr) {
      throw std::runtime_error("NitroAmplitude: disk_adapter_unavailable");
    }
    store->setDisk(key, value);
    migrator_.rearmAfterWrite();
  }

  std::optional<std::string> getDisk(const std::string& key) override {
    const auto store = migratedStore();
    return store == nullptr ? std::nullopt : store->getDisk(key);
  }

  void deleteDisk(const std::string& key) override {
    const auto store = migratedStore();
    if (store != nullptr) {
      store->deleteDisk(key);
      migrator_.forget(key);
    }
  }

  bool hasDisk(const std::string& key) override {
    const auto store = migratedStore();
    return store != nullptr && store->hasDisk(key);
  }

  std::vector<std::string> getAllDiskKeys() override {
    const auto store = migratedStore();
    return store == nullptr ? std::vector<std::string>{} : store->getAllDiskKeys();
  }

private:
  std::shared_ptr<JsonlSegmentStore> migratedStore() {
    auto store = provider_();
    if (store != nullptr) {
      migrator_.ensureMigrated(*store);
    }
    return store;
  }

  StoreProvider provider_;
  LegacyDiskMigrator migrator_;
};

} // namespace NitroAmplitude
