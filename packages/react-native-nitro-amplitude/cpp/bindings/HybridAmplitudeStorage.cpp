#include "HybridAmplitudeStorage.hpp"

#include "../core/PlatformAdapterFactory.hpp"

#include <stdexcept>
#include <variant>

namespace margelo::nitro::NitroAmplitude {

HybridAmplitudeStorage::HybridAmplitudeStorage()
    : HybridObject(TAG), HybridAmplitudeStorageSpec() {
  adapter_ = ::NitroAmplitude::getSharedPlatformAdapters().storage;
}

HybridAmplitudeStorage::HybridAmplitudeStorage(
    std::shared_ptr<::NitroAmplitude::StorageAdapter> adapter)
    : HybridObject(TAG), HybridAmplitudeStorageSpec(), adapter_(std::move(adapter)) {}

void HybridAmplitudeStorage::set(
    const std::string& key,
    const std::string& value,
    bool persist) {
  if (persist) {
    if (!adapter_) {
      throw std::runtime_error("NitroAmplitude: Disk adapter unavailable");
    }
    adapter_->setDisk(key, value);
    return;
  }
  std::lock_guard<std::mutex> lock(memoryMutex_);
  memoryStore_[key] = value;
}

std::optional<std::string> HybridAmplitudeStorage::get(
    const std::string& key,
    bool persist) {
  if (persist) {
    if (!adapter_) {
      return std::nullopt;
    }
    return adapter_->getDisk(key);
  }
  std::lock_guard<std::mutex> lock(memoryMutex_);
  auto it = memoryStore_.find(key);
  if (it == memoryStore_.end()) {
    return std::nullopt;
  }
  return it->second;
}

void HybridAmplitudeStorage::remove(const std::string& key, bool persist) {
  if (persist) {
    if (adapter_) {
      adapter_->deleteDisk(key);
    }
    return;
  }
  std::lock_guard<std::mutex> lock(memoryMutex_);
  memoryStore_.erase(key);
}

void HybridAmplitudeStorage::clear(bool persist) {
  if (persist) {
    if (!adapter_) {
      return;
    }
    for (const auto& key : adapter_->getAllDiskKeys()) {
      adapter_->deleteDisk(key);
    }
    return;
  }
  std::lock_guard<std::mutex> lock(memoryMutex_);
  memoryStore_.clear();
}

bool HybridAmplitudeStorage::has(const std::string& key, bool persist) {
  if (persist) {
    return adapter_ ? adapter_->hasDisk(key) : false;
  }
  std::lock_guard<std::mutex> lock(memoryMutex_);
  return memoryStore_.find(key) != memoryStore_.end();
}

std::vector<std::string> HybridAmplitudeStorage::getAllKeys(bool persist) {
  if (persist) {
    return adapter_ ? adapter_->getAllDiskKeys() : std::vector<std::string>{};
  }
  std::lock_guard<std::mutex> lock(memoryMutex_);
  std::vector<std::string> keys;
  keys.reserve(memoryStore_.size());
  for (const auto& entry : memoryStore_) {
    keys.push_back(entry.first);
  }
  return keys;
}

std::vector<std::string> HybridAmplitudeStorage::getKeysByPrefix(
    const std::string& prefix,
    bool persist) {
  const auto keys = getAllKeys(persist);
  std::vector<std::string> filtered;
  for (const auto& key : keys) {
    if (key.rfind(prefix, 0) == 0) {
      filtered.push_back(key);
    }
  }
  return filtered;
}

void HybridAmplitudeStorage::setBatch(
    const std::vector<std::string>& keys,
    const std::vector<std::string>& values,
    bool persist) {
  if (keys.size() != values.size()) {
    throw std::runtime_error("NitroAmplitude: setBatch key/value length mismatch");
  }
  for (size_t i = 0; i < keys.size(); ++i) {
    set(keys[i], values[i], persist);
  }
}

std::vector<std::variant<nitro::NullType, std::string>> HybridAmplitudeStorage::getBatch(
    const std::vector<std::string>& keys,
    bool persist) {
  std::vector<std::variant<nitro::NullType, std::string>> values;
  values.reserve(keys.size());
  for (const auto& key : keys) {
    const auto value = get(key, persist);
    values.push_back(value ? std::variant<nitro::NullType, std::string>(std::in_place_index<1>, *value)
                           : std::variant<nitro::NullType, std::string>(std::in_place_index<0>, nitro::null));
  }
  return values;
}

size_t HybridAmplitudeStorage::getExternalMemorySize() noexcept {
  std::lock_guard<std::mutex> lock(memoryMutex_);
  size_t total = 0;
  for (const auto& entry : memoryStore_) {
    total += entry.first.size() + entry.second.size();
  }
  return total;
}

void HybridAmplitudeStorage::removeBatch(
    const std::vector<std::string>& keys,
    bool persist) {
  for (const auto& key : keys) {
    remove(key, persist);
  }
}

} // namespace margelo::nitro::NitroAmplitude
