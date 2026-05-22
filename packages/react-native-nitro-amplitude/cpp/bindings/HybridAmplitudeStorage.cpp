#include "HybridAmplitudeStorage.hpp"

#ifndef NITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER
#if __APPLE__
#include "../../ios/IOSAmplitudeAdapterCpp.hpp"
#elif __ANDROID__
#include "../../android/src/main/cpp/AndroidAmplitudeAdapterCpp.hpp"
#include <fbjni/fbjni.h>
#endif
#endif

#include <stdexcept>

namespace margelo::nitro::NitroAmplitude {

namespace {
constexpr auto kBatchMissingSentinel = "__nitro_amplitude_batch_missing__::v1";

std::shared_ptr<::NitroAmplitude::NativeAmplitudeAdapter> createPlatformAdapter() {
#ifndef NITRO_AMPLITUDE_DISABLE_PLATFORM_ADAPTER
#if __APPLE__
  return std::make_shared<::NitroAmplitude::IOSAmplitudeAdapterCpp>();
#elif __ANDROID__
  auto context = ::NitroAmplitude::AndroidAmplitudeAdapterJava::getContext();
  return std::make_shared<::NitroAmplitude::AndroidAmplitudeAdapterCpp>(context);
#else
  return nullptr;
#endif
#else
  return nullptr;
#endif
}
} // namespace

HybridAmplitudeStorage::HybridAmplitudeStorage()
    : HybridObject(TAG), HybridAmplitudeStorageSpec() {
  adapter_ = createPlatformAdapter();
}

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

std::vector<std::string> HybridAmplitudeStorage::getBatch(
    const std::vector<std::string>& keys,
    bool persist) {
  std::vector<std::string> values;
  values.reserve(keys.size());
  for (const auto& key : keys) {
    const auto value = get(key, persist);
    values.push_back(value.value_or(kBatchMissingSentinel));
  }
  return values;
}

void HybridAmplitudeStorage::removeBatch(
    const std::vector<std::string>& keys,
    bool persist) {
  for (const auto& key : keys) {
    remove(key, persist);
  }
}

} // namespace margelo::nitro::NitroAmplitude
