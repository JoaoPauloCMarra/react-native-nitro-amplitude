#include "../../nitrogen/generated/shared/c++/HybridAmplitudeStorageSpec.hpp"
#include "../../nitrogen/generated/shared/c++/HybridAmplitudeContextSpec.hpp"
#include "../../nitrogen/generated/shared/c++/HybridAmplitudeWorkerSpec.hpp"
#include "../../cpp/bindings/HybridAmplitudeContext.hpp"
#include "../../cpp/bindings/HybridAmplitudeStorage.hpp"
#include "../../cpp/bindings/HybridAmplitudeWorker.hpp"
#include "../../cpp/core/ContextAdapter.hpp"
#include "../../cpp/core/FileAdapter.hpp"
#include "../../cpp/core/HttpAdapter.hpp"
#include "../../cpp/core/Gzip.hpp"
#include "../../cpp/core/JsonlSegmentStore.hpp"
#include "../../cpp/core/LegacyDiskMigration.hpp"
#include "../../cpp/core/PosixFileAdapter.hpp"
#include "../../cpp/core/StorageAdapter.hpp"

#include <dirent.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>
#include <zlib.h>

#include <algorithm>
#include <cassert>
#include <cctype>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <iostream>
#include <limits>
#include <map>
#include <new>
#include <optional>
#include <set>
#include <mutex>
#include <stdexcept>
#include <string>
#include <system_error>
#include <thread>
#include <unordered_map>
#include <vector>

using margelo::nitro::NitroAmplitude::HybridAmplitudeContext;
using margelo::nitro::NitroAmplitude::HybridAmplitudeStorage;
using margelo::nitro::NitroAmplitude::HybridAmplitudeWorker;
using NitroAmplitude::ContextAdapter;
using NitroAmplitude::FileAdapter;
using NitroAmplitude::HttpAdapter;
using NitroAmplitude::HttpResult;
using NitroAmplitude::JsonlSegmentStore;
using NitroAmplitude::StorageAdapter;

class FakeContextAdapter : public ContextAdapter {
public:
  int prefetchCount = 0;
  std::string lastOptions;

  void prefetchContext() override {
    ++prefetchCount;
    getApplicationContextJson("{}");
  }

  std::string getApplicationContextJson(const std::string& optionsJson) override {
    lastOptions = optionsJson;
    return "{\"platform\":\"fake\"}";
  }
};

class FakeStorageAdapter : public StorageAdapter {
public:
  std::map<std::string, std::string> values;

  void setDisk(const std::string& key, const std::string& value) override {
    values[key] = value;
  }

  std::optional<std::string> getDisk(const std::string& key) override {
    auto it = values.find(key);
    if (it == values.end()) {
      return std::nullopt;
    }
    return it->second;
  }

  void deleteDisk(const std::string& key) override {
    values.erase(key);
  }

  bool hasDisk(const std::string& key) override {
    return values.find(key) != values.end();
  }

  std::vector<std::string> getAllDiskKeys() override {
    std::vector<std::string> keys;
    for (const auto& entry : values) {
      keys.push_back(entry.first);
    }
    return keys;
  }
};

class FakeFileAdapter : public FileAdapter {
public:
  std::map<std::string, std::string> files;
  bool failAppends = false;
  bool partialAppends = false;
  bool failWrites = false;
  bool failNextWrite = false;
  bool failReads = false;
  bool failTruncates = false;
  bool failListing = false;
  bool failEnsureDirectory = false;
  size_t truncateAttempts = 0;
  std::set<std::string> unreadablePaths;
  size_t writeAttempts = 0;

  bool ensureDirectory(const std::string&) override {
    return !failEnsureDirectory;
  }

  std::vector<std::string> listFiles(const std::string& directory) override {
    std::vector<std::string> names;
    const std::string prefix = directory + "/";
    for (const auto& entry : files) {
      if (entry.first.rfind(prefix, 0) == 0) {
        names.push_back(entry.first.substr(prefix.size()));
      }
    }
    return names;
  }

  std::optional<std::vector<std::string>> readDirectory(const std::string& directory) override {
    if (failListing) {
      return std::nullopt;
    }
    return listFiles(directory);
  }

  std::optional<std::string> readFile(const std::string& path) override {
    if (failReads || unreadablePaths.count(path) > 0) {
      return std::nullopt;
    }
    const auto it = files.find(path);
    if (it == files.end()) {
      return std::nullopt;
    }
    return it->second;
  }

  std::optional<std::string> readRange(
      const std::string& path,
      uint64_t offset,
      uint64_t length) override {
    if (failReads) {
      return std::nullopt;
    }
    const auto it = files.find(path);
    if (it == files.end() || offset > it->second.size()) {
      return std::nullopt;
    }
    const uint64_t available = it->second.size() - offset;
    return it->second.substr(
        static_cast<size_t>(offset),
        static_cast<size_t>(std::min<uint64_t>(available, length)));
  }

  bool appendFile(const std::string& path, const std::string& data) override {
    if (failAppends) {
      return false;
    }
    if (partialAppends) {
      files[path] += data.substr(0, data.size() / 2);
      partialAppends = false;
      return false;
    }
    files[path] += data;
    return true;
  }

  bool writeFile(const std::string& path, const std::string& data) override {
    ++writeAttempts;
    if (failWrites || failNextWrite) {
      failNextWrite = false;
      return false;
    }
    files[path] = data;
    return true;
  }

  bool truncateFile(const std::string& path, uint64_t length) override {
    ++truncateAttempts;
    const auto it = files.find(path);
    if (failTruncates || it == files.end() || it->second.size() < length) {
      return false;
    }
    it->second.resize(static_cast<size_t>(length));
    return true;
  }

  bool removeFile(const std::string& path) override {
    files.erase(path);
    return true;
  }
};

class FakeHttpAdapter : public HttpAdapter {
public:
  std::mutex gateMutex;
  std::condition_variable gateCv;
  bool gateOpen = true;
  std::atomic<int> requestCount = 0;

  HttpResult performHttpRequest(
      const std::string& url,
      const std::string& method,
      const std::unordered_map<std::string, std::string>& headers,
      const std::string& body,
      int timeoutMillis) override {
    {
      std::unique_lock<std::mutex> lock(gateMutex);
      gateCv.wait(lock, [this]() { return gateOpen; });
      ++requestCount;
    }
    if (url.find("error://") == 0) {
      return HttpResult{.error = "network_error"};
    }
    if (url.find("status://") == 0) {
      return HttpResult{.statusCode = 418, .body = "teapot"};
    }
    return HttpResult{.statusCode = 200, .body = body};
  }

  void openGate() {
    {
      std::lock_guard<std::mutex> lock(gateMutex);
      gateOpen = true;
    }
    gateCv.notify_all();
  }

  void closeGate() {
    std::lock_guard<std::mutex> lock(gateMutex);
    gateOpen = false;
  }
};

class ThrowingOnceHttpAdapter : public HttpAdapter {
public:
  std::atomic<int> requestCount = 0;

  HttpResult performHttpRequest(
      const std::string&,
      const std::string&,
      const std::unordered_map<std::string, std::string>&,
      const std::string& body,
      int) override {
    requestCount.fetch_add(1);
    if (body.empty()) {
      throw std::runtime_error("jni_failure");
    }
    return HttpResult{.statusCode = 200, .body = body};
  }
};

class SameIdHttpAdapter : public HttpAdapter {
public:
  std::mutex mutex;
  std::condition_variable condition;
  bool firstOpen = false;
  bool blockerOpen = false;
  std::vector<std::string> requestBodies;

  HttpResult performHttpRequest(
      const std::string&,
      const std::string&,
      const std::unordered_map<std::string, std::string>&,
      const std::string& body,
      int) override {
    std::unique_lock<std::mutex> lock(mutex);
    if (body == "first") {
      condition.wait(lock, [this]() { return firstOpen; });
    } else if (body == "blocker") {
      condition.wait(lock, [this]() { return blockerOpen; });
    }
    requestBodies.push_back(body);
    return HttpResult{.statusCode = 200, .body = body};
  }

  void openFirst() {
    {
      std::lock_guard<std::mutex> lock(mutex);
      firstOpen = true;
    }
    condition.notify_all();
  }

  void openBlocker() {
    {
      std::lock_guard<std::mutex> lock(mutex);
      blockerOpen = true;
    }
    condition.notify_all();
  }
};

class SharedText {
public:
  explicit SharedText(std::string initial) : value_(std::move(initial)) {}

  void set(const std::string& value) {
    std::lock_guard<std::mutex> lock(mutex_);
    value_ = value;
  }

  std::string get() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return value_;
  }

private:
  mutable std::mutex mutex_;
  std::string value_;
};

static bool waitUntil(const std::function<bool()>& predicate, int attempts = 6000) {
  for (int i = 0; i < attempts; ++i) {
    if (predicate()) {
      return true;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  return predicate();
}

void testStorage() {
  auto storage = std::make_shared<HybridAmplitudeStorage>();

  storage->set("alpha", "1", false);
  storage->set("beta", "2", false);
  storage->set("prefix:one", "3", false);
  storage->set("prefix:two", "4", false);

  assert(storage->has("alpha", false));
  assert(storage->get("alpha", false).value_or("") == "1");
  assert(storage->get("missing", false) == std::nullopt);

  const auto prefixedKeys = storage->getKeysByPrefix("prefix:", false);
  assert(prefixedKeys.size() == 2);

  storage->setBatch({"batch-a", "batch-b"}, {"5", "6"}, false);
  assert(storage->getBatch({"batch-a", "batch-b"}, false) ==
         std::vector<std::string>({"5", "6"}));
  assert(storage->getBatch({"batch-missing"}, false) ==
         std::vector<std::string>({"__nitro_amplitude_batch_missing__::v1"}));

  bool batchLengthThrown = false;
  try {
    storage->setBatch({"batch-a"}, {}, false);
  } catch (const std::runtime_error&) {
    batchLengthThrown = true;
  }
  assert(batchLengthThrown);

  storage->removeBatch(
      {"alpha", "beta", "prefix:one", "prefix:two", "batch-a", "batch-b"},
      false);
  assert(!storage->has("alpha", false));
  assert(storage->getAllKeys(false).empty());

  bool diskAdapterThrown = false;
  try {
    storage->set("disk", "value", true);
  } catch (const std::runtime_error&) {
    diskAdapterThrown = true;
  }
  assert(diskAdapterThrown);
  assert(!storage->has("disk", true));
}

void testStorageAdapterContract() {
  auto adapter = std::make_shared<FakeStorageAdapter>();
  auto storage = std::make_shared<HybridAmplitudeStorage>(adapter);

  storage->set("disk-key", "disk-value", true);
  assert(storage->get("disk-key", true).value_or("") == "disk-value");
  assert(storage->has("disk-key", true));
  const auto keys = storage->getAllKeys(true);
  assert(keys.size() == 1 && keys[0] == "disk-key");
  assert(storage->get("disk-missing", true) == std::nullopt);

  storage->remove("disk-key", true);
  assert(!storage->has("disk-key", true));
  assert(storage->getAllKeys(true).empty());

  storage->set("a", "1", false);
  storage->set("b", "2", false);
  storage->clear(false);
  assert(storage->getAllKeys(false).empty());
}

void testSegmentStoreRotation() {
  auto files = std::make_shared<FakeFileAdapter>();
  constexpr uint64_t cap = 96;

  {
    JsonlSegmentStore store(files, "rot", cap);
    for (int i = 0; i < 24; ++i) {
      const std::string value(24, static_cast<char>('a' + (i % 26)));
      store.setDisk("key-" + std::to_string(i), value);
    }
    assert(files->listFiles("rot").size() > 1);
    for (int i = 0; i < 24; ++i) {
      const std::string value(24, static_cast<char>('a' + (i % 26)));
      assert(store.hasDisk("key-" + std::to_string(i)));
      assert(store.getDisk("key-" + std::to_string(i)).value_or("") == value);
    }
    assert(store.getAllDiskKeys().size() == 24);
  }

  JsonlSegmentStore reloaded(files, "rot", cap);
  assert(reloaded.getAllDiskKeys().size() == 24);
  assert(reloaded.getDisk("key-7").value_or("") == std::string(24, 'h'));
  assert(reloaded.getDisk("key-11").value_or("") == std::string(24, 'l'));
}

void testSegmentStoreCompactsSupersededRecords() {
  auto files = std::make_shared<FakeFileAdapter>();
  constexpr uint64_t cap = 1400;

  JsonlSegmentStore store(files, "compact", cap);
  for (int i = 0; i < 25; ++i) {
    store.setDisk("key-" + std::to_string(i), std::string(24, 'v'));
  }
  const size_t initialSegments = files->listFiles("compact").size();
  assert(initialSegments == 1);

  for (int i = 0; i < 200; ++i) {
    store.setDisk("hot", std::string(40, 'x'));
  }
  assert(store.getDisk("hot").value_or("") == std::string(40, 'x'));
  assert(store.getDisk("key-3").value_or("") == std::string(24, 'v'));

  const auto names = files->listFiles("compact");
  assert(names.size() <= 8);
  uint64_t totalBytes = 0;
  for (const auto& name : names) {
    const auto content = files->readFile("compact/" + name);
    assert(content.has_value());
    assert(content->size() <= cap);
    totalBytes += content->size();
  }
  assert(totalBytes <= 8 * cap);

  JsonlSegmentStore reloaded(files, "compact", cap);
  assert(reloaded.getDisk("hot").value_or("") == std::string(40, 'x'));
  assert(reloaded.getAllDiskKeys().size() == 26);
}

void testSegmentStoreCompactionWriteFailurePreservesData() {
  auto files = std::make_shared<FakeFileAdapter>();
  JsonlSegmentStore store(files, "compact-failure", 4096);
  store.setDisk("keep", "keep-value");
  store.setDisk("remove", "remove-value");

  files->failAppends = true;
  bool deleteThrew = false;
  try {
    store.deleteDisk("remove");
  } catch (const std::runtime_error& error) {
    deleteThrew =
        std::string(error.what()) == "NitroAmplitude: segment storage append failed";
  }
  assert(deleteThrew);

  assert(store.hasDisk("remove"));
  assert(store.getDisk("remove").value_or("") == "remove-value");
  assert(store.getDisk("keep").value_or("") == "keep-value");

  JsonlSegmentStore afterFailedDelete(files, "compact-failure", 4096);
  assert(afterFailedDelete.hasDisk("remove"));
  assert(afterFailedDelete.getDisk("remove").value_or("") == "remove-value");

  files->failAppends = false;
  store.deleteDisk("remove");

  assert(!store.hasDisk("remove"));
  JsonlSegmentStore afterDelete(files, "compact-failure", 4096);
  assert(!afterDelete.hasDisk("remove"));
  assert(afterDelete.getDisk("keep").value_or("") == "keep-value");
}

void testSegmentStoreTruncatedTailRecovery() {
  auto files = std::make_shared<FakeFileAdapter>();
  {
    JsonlSegmentStore store(files, "trunc", 4096);
    store.setDisk("one", "111");
    store.setDisk("two", "222");
  }
  const auto names = files->listFiles("trunc");
  assert(names.size() == 1);
  files->files["trunc/" + names[0]] += "three\t33";

  {
    JsonlSegmentStore recovered(files, "trunc", 4096);
    assert(recovered.getDisk("one").value_or("") == "111");
    assert(recovered.getDisk("two").value_or("") == "222");
    assert(!recovered.hasDisk("three"));
  }

  const auto content = files->readFile("trunc/" + names[0]);
  assert(content.has_value());
  assert(!content->empty() && content->back() == '\n');
  assert(content->find("three") == std::string::npos);

  JsonlSegmentStore afterTruncation(files, "trunc", 4096);
  afterTruncation.setDisk("four", "444");
  JsonlSegmentStore reloaded(files, "trunc", 4096);
  assert(reloaded.getDisk("four").value_or("") == "444");
  assert(reloaded.getDisk("two").value_or("") == "222");
  assert(!reloaded.hasDisk("three"));
}

void testSegmentStoreIndexConsistency() {
  auto files = std::make_shared<FakeFileAdapter>();
  auto store = std::make_shared<JsonlSegmentStore>(files, "idx", 4096);
  auto storage = std::make_shared<HybridAmplitudeStorage>(store);

  storage->set("events", "[1,2,3]", true);
  storage->set("events", "[1,2,3,4]", true);
  storage->set("device", "abc", true);
  storage->set("prefix:a", "1", true);
  storage->set("prefix:b", "2", true);

  assert(storage->get("events", true).value_or("") == "[1,2,3,4]");
  assert(storage->has("device", true));
  assert(storage->getAllKeys(true).size() == 4);
  assert(storage->getKeysByPrefix("prefix:", true).size() == 2);

  storage->remove("events", true);
  assert(!storage->has("events", true));

  auto reloadedStore = std::make_shared<JsonlSegmentStore>(files, "idx", 4096);
  auto reloaded = std::make_shared<HybridAmplitudeStorage>(reloadedStore);
  assert(!reloaded->has("events", true));
  assert(reloaded->get("device", true).value_or("") == "abc");
  assert(reloaded->get("events", true) == std::nullopt);
  assert(reloaded->getKeysByPrefix("prefix:", true).size() == 2);

  reloaded->clear(true);
  assert(reloaded->getAllKeys(true).empty());
  JsonlSegmentStore afterClear(files, "idx", 4096);
  assert(afterClear.getAllDiskKeys().empty());
  assert(files->listFiles("idx").empty());
}

void testSegmentStoreEscapingRoundTrip() {
  auto files = std::make_shared<FakeFileAdapter>();
  {
    JsonlSegmentStore store(files, "esc", 4096);
    store.setDisk("key\twith\ttabs", "line1\nline2\ttab\\slash\r");
    assert(store.getDisk("key\twith\ttabs").value_or("") == "line1\nline2\ttab\\slash\r");
  }
  JsonlSegmentStore reloaded(files, "esc", 4096);
  assert(reloaded.hasDisk("key\twith\ttabs"));
  assert(reloaded.getDisk("key\twith\ttabs").value_or("") == "line1\nline2\ttab\\slash\r");
}

void testSegmentStoreMigration() {
  auto files = std::make_shared<FakeFileAdapter>();
  JsonlSegmentStore store(files, "mig", 4096);
  store.setDisk("kept", "new-value");

  const std::vector<std::pair<std::string, std::string>> legacy = {
      {"kept", "old-value"},
      {"legacy-events", "[9]"},
      {"legacy-device", "device-1"},
  };
  assert(store.migrateLegacyEntries(legacy) == 2);
  assert(store.getDisk("kept").value_or("") == "new-value");
  assert(store.getDisk("legacy-events").value_or("") == "[9]");
  assert(store.getDisk("legacy-device").value_or("") == "device-1");
  assert(store.getAllDiskKeys().size() == 3);

  assert(store.migrateLegacyEntries(legacy) == 0);
  assert(store.getDisk("kept").value_or("") == "new-value");

  JsonlSegmentStore reloaded(files, "mig", 4096);
  assert(reloaded.getDisk("kept").value_or("") == "new-value");
  assert(reloaded.getDisk("legacy-device").value_or("") == "device-1");
  assert(reloaded.getAllDiskKeys().size() == 3);
}

void testSegmentStoreWriteFailure() {
  auto files = std::make_shared<FakeFileAdapter>();
  JsonlSegmentStore store(files, "err", 4096);
  store.setDisk("ok", "1");

  files->failAppends = true;
  bool thrown = false;
  try {
    store.setDisk("bad", "2");
  } catch (const std::runtime_error&) {
    thrown = true;
  }
  assert(thrown);

  files->failAppends = false;
  assert(store.getDisk("ok").value_or("") == "1");
  assert(!store.hasDisk("bad"));
  store.setDisk("good", "3");
  assert(store.hasDisk("good"));
}

void testSegmentStoreRotatedOverwriteFailurePreservesValue() {
  auto files = std::make_shared<FakeFileAdapter>();
  JsonlSegmentStore store(files, "rotated-overwrite", 64);
  store.setDisk("target", "old");
  store.setDisk("keep", "also-old");
  store.setDisk("rotate", std::string(64, 'x'));
  assert(files->listFiles("rotated-overwrite").size() >= 2);

  files->failAppends = true;
  bool thrown = false;
  try {
    store.setDisk("target", "new");
  } catch (const std::runtime_error&) {
    thrown = true;
  }
  assert(thrown);
  assert(store.getDisk("target").value_or("") == "old");
  assert(store.getDisk("keep").value_or("") == "also-old");

  JsonlSegmentStore reloaded(files, "rotated-overwrite", 64);
  assert(reloaded.getDisk("target").value_or("") == "old");
  assert(reloaded.getDisk("keep").value_or("") == "also-old");
}

void testSegmentStoreLastLiveOverwriteFailurePreservesValue() {
  auto files = std::make_shared<FakeFileAdapter>();
  JsonlSegmentStore store(files, "last-live-overwrite", 32);
  store.setDisk("target", "old");
  store.setDisk("rotate", std::string(32, 'x'));
  assert(files->listFiles("last-live-overwrite").size() >= 2);

  files->failAppends = true;
  bool thrown = false;
  try {
    store.setDisk("target", "new");
  } catch (const std::runtime_error&) {
    thrown = true;
  }
  assert(thrown);
  assert(store.getDisk("target").value_or("") == "old");

  JsonlSegmentStore reloaded(files, "last-live-overwrite", 32);
  assert(reloaded.getDisk("target").value_or("") == "old");
}

void testSegmentStoreTornOverwriteAppendRecovery() {
  auto files = std::make_shared<FakeFileAdapter>();
  JsonlSegmentStore store(files, "torn-overwrite", 4096);
  store.setDisk("target", "old");

  files->partialAppends = true;
  bool thrown = false;
  try {
    store.setDisk("target", "new");
  } catch (const std::runtime_error&) {
    thrown = true;
  }
  assert(thrown);
  assert(store.getDisk("target").value_or("") == "old");

  store.setDisk("after-failure", "works");
  assert(store.getDisk("target").value_or("") == "old");
  assert(store.getDisk("after-failure").value_or("") == "works");

  JsonlSegmentStore reloaded(files, "torn-overwrite", 4096);
  assert(reloaded.getDisk("target").value_or("") == "old");
  assert(reloaded.getDisk("after-failure").value_or("") == "works");
}

void testSegmentStoreFailedTornTailTrimRetiresSegment() {
  auto files = std::make_shared<FakeFileAdapter>();
  JsonlSegmentStore store(files, "failed-tail-trim", 4096);
  store.setDisk("target", "old");
  files->files["failed-tail-trim/segment-00000000.jsonl"] += "target\tne";

  // Loading recovers the complete prefix, but the damaged tail cannot be
  // trimmed once. Future records must use a fresh segment rather than append
  // at the prefix offset inside the physical file.
  files->failNextWrite = true;
  JsonlSegmentStore recovered(files, "failed-tail-trim", 4096);
  assert(!files->failNextWrite);
  assert(recovered.getDisk("target").value_or("") == "old");
  recovered.setDisk("fresh", "value");
  assert(files->files.count("failed-tail-trim/segment-00000001.jsonl") == 1);
  assert(recovered.getDisk("target").value_or("") == "old");
  assert(recovered.getDisk("fresh").value_or("") == "value");

  JsonlSegmentStore reloaded(files, "failed-tail-trim", 4096);
  assert(reloaded.getDisk("target").value_or("") == "old");
  assert(reloaded.getDisk("fresh").value_or("") == "value");
}

void testSegmentStoreOverwriteCompactionFailurePreservesValues() {
  auto files = std::make_shared<FakeFileAdapter>();
  JsonlSegmentStore store(files, "overwrite-compact-failure", 12);
  store.setDisk("aa", "11");
  store.setDisk("bb", "22");
  store.setDisk("rotate", std::string(20, 'x'));
  assert(files->listFiles("overwrite-compact-failure").size() >= 2);

  files->failWrites = true;
  store.setDisk("aa", "33");
  assert(files->writeAttempts == 1);
  assert(store.getDisk("aa").value_or("") == "33");
  assert(store.getDisk("bb").value_or("") == "22");

  JsonlSegmentStore reloaded(files, "overwrite-compact-failure", 12);
  assert(reloaded.getDisk("aa").value_or("") == "33");
  assert(reloaded.getDisk("bb").value_or("") == "22");
}

void testContextFallbacks() {
  auto context = std::make_shared<HybridAmplitudeContext>();
  context->prefetch();
  assert(context->getApplicationContextJson("{}") == "{}");
  assert(context->getLegacySessionDataJson("default") == "{}");
  assert(context->getLegacyEventsJson("default", "events").empty());
  context->removeLegacyEvent("default", "events", 1);

  bool invalidEventIdThrown = false;
  try {
    context->removeLegacyEvent("default", "events", 1.5);
  } catch (const std::runtime_error&) {
    invalidEventIdThrown = true;
  }
  assert(invalidEventIdThrown);
}

void testContextAdapterContract() {
  auto adapter = std::make_shared<FakeContextAdapter>();
  auto context = std::make_shared<HybridAmplitudeContext>(adapter);

  context->prefetch();
  assert(adapter->prefetchCount == 1);
  assert(context->getApplicationContextJson("{}") == "{\"platform\":\"fake\"}");
  assert(adapter->lastOptions == "{}");
}

void testWorkerFallbacks() {
  auto worker = std::make_shared<HybridAmplitudeWorker>();
  std::atomic<bool> receivedUnavailable = false;

  auto removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double statusCode, const std::string& body, const std::string& error) {
        if (requestId == "req-1" && statusCode == 0 && body.empty() && error == "Native adapter unavailable") {
          receivedUnavailable = true;
        }
      });

  bool invalidRequestThrown = false;
  try {
    worker->enqueue("", "https://example.com", "GET", {}, "", 1000);
  } catch (const std::runtime_error&) {
    invalidRequestThrown = true;
  }
  assert(invalidRequestThrown);

  worker->enqueue("req-1", "https://example.com", "GET", {{"content-type", "application/json"}}, "", std::numeric_limits<double>::infinity());

  assert(waitUntil([&]() { return receivedUnavailable.load(); }));
  assert(worker->queueSize() == 0);
  assert(worker->inFlightCount() == 0);
  assert(worker->pendingBodyBytes() == 0);
  removeListener();
}

void testWorkerAdapterContract() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);

  std::atomic<bool> okReceived = false;
  std::atomic<bool> errorReceived = false;
  std::atomic<bool> statusReceived = false;
  auto removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double statusCode, const std::string& body, const std::string& error) {
        if (requestId == "ok") {
          okReceived = statusCode == 200 && body == "payload" && error.empty();
        } else if (requestId == "error") {
          errorReceived = statusCode == 0 && error == "network_error";
        } else if (requestId == "status") {
          statusReceived = statusCode == 418 && body == "teapot";
        }
      });

  worker->enqueue("ok", "https://example.com", "POST", {}, "payload", 1000);
  worker->enqueue("error", "error://example.com", "GET", {}, "", 1000);
  worker->enqueue("status", "status://example.com", "GET", {}, "", 1000);

  assert(waitUntil([&]() { return okReceived && errorReceived && statusReceived; }));
  assert(adapter->requestCount == 3);
  assert(worker->inFlightCount() == 0);
  assert(worker->queueSize() == 0);
  removeListener();
}

void testWorkerAdapterException() {
  auto adapter = std::make_shared<ThrowingOnceHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);

  SharedText thrownError("unset");
  std::atomic<bool> recovered = false;
  auto removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double statusCode, const std::string&, const std::string& error) {
        if (requestId == "throws") {
          thrownError.set(error);
        } else if (requestId == "after") {
          recovered = statusCode == 200 && error.empty();
        }
      });

  worker->enqueue("throws", "https://example.com", "GET", {}, "", 1000);
  worker->enqueue("after", "https://example.com", "POST", {}, "after", 1000);

  assert(waitUntil([&]() { return thrownError.get() != "unset" && recovered; }));
  assert(thrownError.get() == "native_http_exception");
  assert(worker->inFlightCount() == 0);
  assert(worker->queueSize() == 0);
  assert(worker->pendingBodyBytes() == 0);
  removeListener();
}

void testWorkerSameIdQueuedCancellation() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  adapter->closeGate();

  std::vector<std::string> successBodies;
  std::string cancelledError = "unset";
  std::mutex resultMutex;
  auto removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double statusCode, const std::string& body, const std::string& error) {
        if (requestId != "same-queued") {
          return;
        }
        std::lock_guard<std::mutex> lock(resultMutex);
        if (statusCode == 200) {
          successBodies.push_back(body);
        } else {
          cancelledError = error;
        }
      });

  worker->enqueue("blocker-1", "https://example.com", "GET", {}, "", 1000);
  worker->enqueue("blocker-2", "https://example.com", "GET", {}, "", 1000);
  assert(waitUntil([&]() { return worker->inFlightCount() == 2; }));
  worker->enqueue("same-queued", "https://example.com", "POST", {}, "first", 1000);
  worker->enqueue("same-queued", "https://example.com", "POST", {}, "second", 1000);
  assert(waitUntil([&]() { return worker->queueSize() == 2; }));
  worker->cancel("same-queued");

  adapter->openGate();
  assert(waitUntil([&]() {
    std::lock_guard<std::mutex> lock(resultMutex);
    return cancelledError != "unset" && successBodies.size() == 1;
  }));
  {
    std::lock_guard<std::mutex> lock(resultMutex);
    assert(cancelledError == "cancelled");
    assert(successBodies[0] == "first");
  }
  removeListener();
}

void testWorkerSameIdInFlightCancellation() {
  auto adapter = std::make_shared<SameIdHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);

  std::vector<std::string> successBodies;
  std::string cancelledError = "unset";
  std::mutex resultMutex;
  auto removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double statusCode, const std::string& body, const std::string& error) {
        if (requestId != "same-in-flight") {
          return;
        }
        std::lock_guard<std::mutex> lock(resultMutex);
        if (statusCode == 200) {
          successBodies.push_back(body);
        } else {
          cancelledError = error;
        }
      });

  worker->enqueue("same-in-flight", "https://example.com", "POST", {}, "first", 1000);
  worker->enqueue("blocker", "https://example.com", "POST", {}, "blocker", 1000);
  assert(waitUntil([&]() { return worker->inFlightCount() == 2; }));
  worker->enqueue("same-in-flight", "https://example.com", "POST", {}, "second", 1000);
  assert(waitUntil([&]() { return worker->queueSize() == 1; }));
  worker->cancel("same-in-flight");

  adapter->openFirst();
  assert(waitUntil([&]() {
    std::lock_guard<std::mutex> lock(resultMutex);
    return successBodies.size() == 1;
  }));
  adapter->openBlocker();
  assert(waitUntil([&]() {
    std::lock_guard<std::mutex> lock(resultMutex);
    return cancelledError != "unset";
  }));
  {
    std::lock_guard<std::mutex> lock(resultMutex);
    assert(successBodies[0] == "first");
    assert(cancelledError == "cancelled");
  }
  removeListener();
}

void testWorkerSameIdLateCancelAndReuse() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);

  std::vector<std::string> successBodies;
  std::mutex resultMutex;
  auto removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double statusCode, const std::string& body, const std::string&) {
        if (requestId == "same-late" && statusCode == 200) {
          std::lock_guard<std::mutex> lock(resultMutex);
          successBodies.push_back(body);
        }
      });

  worker->enqueue("same-late", "https://example.com", "POST", {}, "first", 1000);
  assert(waitUntil([&]() {
    std::lock_guard<std::mutex> lock(resultMutex);
    return successBodies.size() == 1;
  }));
  worker->cancel("same-late");
  worker->enqueue("same-late", "https://example.com", "POST", {}, "second", 1000);
  assert(waitUntil([&]() {
    std::lock_guard<std::mutex> lock(resultMutex);
    return successBodies.size() == 2;
  }));
  {
    std::lock_guard<std::mutex> lock(resultMutex);
    assert(successBodies[0] == "first");
    assert(successBodies[1] == "second");
  }
  removeListener();
}

void testWorkerBoundedConcurrency() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  adapter->closeGate();

  for (int i = 0; i < 2; ++i) {
    worker->enqueue("slow-" + std::to_string(i), "https://example.com", "GET", {}, "", 1000);
  }
  assert(waitUntil([&]() { return worker->inFlightCount() == 2 && worker->queueSize() == 0; }));

  for (int i = 2; i < 102; ++i) {
    worker->enqueue("slow-" + std::to_string(i), "https://example.com", "GET", {}, "", 1000);
  }

  assert(waitUntil([&]() { return worker->inFlightCount() == 2 && worker->queueSize() == 100; }));

  bool queueFullThrown = false;
  try {
    worker->enqueue("overflow", "https://example.com", "GET", {}, "", 1000);
  } catch (const std::runtime_error&) {
    queueFullThrown = true;
  }
  assert(queueFullThrown);

  adapter->openGate();
  assert(waitUntil([&]() { return worker->inFlightCount() == 0 && worker->queueSize() == 0; }));
  assert(adapter->requestCount == 102);
}

void testWorkerCancellationOfQueuedRequest() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  adapter->closeGate();

  worker->enqueue("blocker-1", "https://example.com", "GET", {}, "", 1000);
  worker->enqueue("blocker-2", "https://example.com", "GET", {}, "", 1000);
  worker->enqueue("cancelled", "https://example.com", "GET", {}, "", 1000);
  worker->cancel("cancelled");
  worker->enqueue("after", "https://example.com", "GET", {}, "", 1000);

  assert(waitUntil([&]() { return worker->queueSize() == 2; }));

  SharedText cancelledError("unset");
  SharedText afterError("unset");
  auto removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double, const std::string&, const std::string& error) {
        if (requestId == "cancelled") {
          cancelledError.set(error);
        } else if (requestId == "after") {
          afterError.set(error);
        }
      });

  adapter->openGate();

  assert(waitUntil([&]() { return cancelledError.get() == "cancelled"; }));
  assert(waitUntil([&]() { return afterError.get() == ""; }));
  assert(adapter->requestCount == 3);
  assert(waitUntil([&]() { return worker->inFlightCount() == 0 && worker->queueSize() == 0; }));
  removeListener();
}

void testWorkerLateCancelDoesNotAffectLaterRequests() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);

  std::atomic<bool> firstDone = false;
  SharedText firstError("unset");
  auto removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double statusCode, const std::string&, const std::string& error) {
        if (requestId == "late-first") {
          firstError.set(error);
          firstDone = statusCode == 200;
        }
      });

  worker->enqueue("late-first", "https://example.com", "GET", {}, "", 1000);
  assert(waitUntil([&]() { return firstDone.load(); }));

  worker->cancel("late-first");
  worker->cancel("never-enqueued");

  std::atomic<bool> secondDone = false;
  SharedText secondError("unset");
  removeListener();
  removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double statusCode, const std::string&, const std::string& error) {
        if (requestId == "late-second") {
          secondError.set(error);
          secondDone = statusCode == 200;
        }
      });

  worker->enqueue("late-second", "https://example.com", "GET", {}, "", 1000);
  assert(waitUntil([&]() { return secondDone.load(); }));
  assert(firstError.get().empty());
  assert(secondError.get().empty());
  assert(adapter->requestCount == 2);
  assert(worker->inFlightCount() == 0);
  assert(worker->queueSize() == 0);
  removeListener();
}

void testWorkerListenerReentrancy() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  std::atomic<bool> outerFired = false;
  std::atomic<bool> innerFired = false;

  auto removeOuter = worker->addOnComplete(
      [&](const std::string& requestId, double, const std::string&, const std::string&) {
        if (requestId == "reentrant-1") {
          outerFired = true;
          worker->addOnComplete(
              [&](const std::string& innerRequestId, double, const std::string&, const std::string&) {
                if (innerRequestId == "reentrant-2") {
                  innerFired = true;
                }
              });
        }
      });

  worker->enqueue("reentrant-1", "https://example.com", "GET", {}, "", 1000);
  assert(waitUntil([&]() { return outerFired.load(); }));
  worker->enqueue("reentrant-2", "https://example.com", "GET", {}, "", 1000);
  assert(waitUntil([&]() { return innerFired.load(); }));
  removeOuter();
}

void testWorkerQueueSizeMetrics() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  adapter->closeGate();

  worker->enqueue("metric-1", "https://example.com", "GET", {{"x", "1"}}, "body-bytes", 1000);
  worker->enqueue("metric-2", "https://example.com", "POST", {}, "other-bytes", 1000);
  worker->enqueue("metric-3", "https://example.com", "POST", {}, "third-bytes", 1000);
  assert(waitUntil([&]() { return worker->inFlightCount() == 2 && worker->queueSize() == 1; }));
  assert(worker->pendingBodyBytes() > 0);
  assert(worker->getExternalMemorySize() == worker->pendingBodyBytes());

  adapter->openGate();
  assert(waitUntil([&]() { return worker->pendingBodyBytes() == 0 && worker->inFlightCount() == 0; }));
}

void testGzipAmplitudePayloads() {
  const std::string large(2048, 'a');
  assert(!::NitroAmplitude::shouldGzipAmplitudeRequest(
      "https://example.com",
      "POST",
      {},
      large));
  assert(!::NitroAmplitude::shouldGzipAmplitudeRequest(
      "https://api2.amplitude.com/2/httpapi",
      "GET",
      {},
      large));
  assert(!::NitroAmplitude::shouldGzipAmplitudeRequest(
      "https://api2.amplitude.com/2/httpapi",
      "POST",
      {},
      "tiny"));
  assert(::NitroAmplitude::shouldGzipAmplitudeRequest(
      "https://api2.amplitude.com/2/httpapi",
      "POST",
      {},
      large));
  std::unordered_map<std::string, std::string> encoded{{"Content-Encoding", "br"}};
  assert(!::NitroAmplitude::shouldGzipAmplitudeRequest(
      "https://api2.amplitude.com/2/httpapi",
      "POST",
      encoded,
      large));
  const auto compressed = ::NitroAmplitude::gzipCompress(large);
  assert(compressed.has_value());
  assert(compressed->size() < large.size());
}

void testGzipAmplitudeAuthorityValidation() {
  const std::string large(1024, 'a');
  const auto shouldGzip = [&large](const std::string& url) {
    return ::NitroAmplitude::shouldGzipAmplitudeRequest(url, "POST", {}, large);
  };

  assert(shouldGzip("https://api2.amplitude.com/2/httpapi"));
  assert(shouldGzip("https://api.eu.amplitude.com/2/httpapi"));
  assert(shouldGzip("https://api2.amplitude.com:443/2/httpapi"));
  assert(shouldGzip("HTTPS://API2.AMPLITUDE.COM/2/HTTPAPI"));

  assert(!shouldGzip("https://api.my-amplitude.com/2/httpapi"));
  assert(!shouldGzip("https://custom.test/amplitude.com"));
  assert(!shouldGzip("https://api2.amplitude.com.evil.test/2/httpapi"));
  assert(!shouldGzip("https://api2.amplitude.com@evil.test/2/httpapi"));
  assert(!shouldGzip("https://evil.test@api2.amplitude.com/2/httpapi"));
  assert(!shouldGzip("https:///2/httpapi"));
  assert(!shouldGzip("https://api2.amplitude.com:bad/2/httpapi"));
  assert(!shouldGzip("https://api2.amplitude.com:65536/2/httpapi"));
  assert(!shouldGzip("api2.amplitude.com/2/httpapi"));

  assert(!::NitroAmplitude::shouldGzipAmplitudeRequest(
      "https://api2.amplitude.com/2/httpapi", "POST", {}, std::string(1023, 'a')));
  assert(::NitroAmplitude::shouldGzipAmplitudeRequest(
      "https://api2.amplitude.com/2/httpapi", "pOsT", {}, large));
  assert(::NitroAmplitude::shouldGzipAmplitudeRequest(
      "https://api2.amplitude.com/2/httpapi", "PUT", {}, large));
  assert(!::NitroAmplitude::shouldGzipAmplitudeRequest(
      "https://api2.amplitude.com/2/httpapi", "PATCH", {}, large));
}

void testSegmentStoreTombstoneReload() {
  auto files = std::make_shared<FakeFileAdapter>();
  {
    JsonlSegmentStore store(files, "tombstone", 4096);
    store.setDisk("keep", "keep-value");
    store.setDisk("remove", "remove-value");
    store.deleteDisk("remove");
    assert(!store.hasDisk("remove"));
  }
  JsonlSegmentStore reloaded(files, "tombstone", 4096);
  assert(!reloaded.hasDisk("remove"));
  assert(reloaded.getDisk("keep").value_or("") == "keep-value");
}

void testSegmentStoreCrossSegmentTombstoneSurvivesCompaction() {
  auto files = std::make_shared<FakeFileAdapter>();
  {
    JsonlSegmentStore store(files, "tombstone-cross", 64);
    store.setDisk("A", "a");
    store.setDisk("B", std::string(30, 'b'));
    store.setDisk("C", std::string(30, 'c'));
    store.deleteDisk("A");
    assert(!store.hasDisk("A"));
    store.setDisk("D", std::string(30, 'd'));
    assert(!store.hasDisk("A"));
  }
  JsonlSegmentStore reloaded(files, "tombstone-cross", 64);
  assert(!reloaded.hasDisk("A"));
  assert(!reloaded.getDisk("A").has_value());
  assert(reloaded.getDisk("B").value_or("") == std::string(30, 'b'));
  assert(reloaded.getDisk("C").value_or("") == std::string(30, 'c'));
  assert(reloaded.getDisk("D").value_or("") == std::string(30, 'd'));
}

void testSegmentStoreUnreadableSegmentStaysConservative() {
  auto files = std::make_shared<FakeFileAdapter>();
  const std::string dir = "unreadable-segment";
  const std::string firstSegment = dir + "/segment-00000000.jsonl";
  {
    JsonlSegmentStore store(files, dir, 64);
    store.setDisk("A", "a");
    store.setDisk("B", std::string(30, 'b'));
    store.setDisk("C", std::string(30, 'c'));
    store.deleteDisk("A");
  }
  files->unreadablePaths.insert(firstSegment);
  {
    JsonlSegmentStore store(files, dir, 64);
    store.setDisk("D", std::string(30, 'd'));
  }
  files->unreadablePaths.clear();
  {
    JsonlSegmentStore reloaded(files, dir, 64);
    assert(!reloaded.hasDisk("A"));
    assert(reloaded.getDisk("D").value_or("") == std::string(30, 'd'));
  }

  auto staleFiles = std::make_shared<FakeFileAdapter>();
  const std::string staleDir = "unreadable-active";
  {
    JsonlSegmentStore store(staleFiles, staleDir, 64);
    store.setDisk("G", "g");
    store.setDisk("F", std::string(56, 'f'));
    store.setDisk("E", "old");
    store.setDisk("F", "x");
  }
  staleFiles->unreadablePaths.insert(staleDir + "/segment-00000001.jsonl");
  {
    JsonlSegmentStore store(staleFiles, staleDir, 64);
    store.setDisk("E", "new");
  }
  staleFiles->unreadablePaths.clear();
  JsonlSegmentStore reloaded(staleFiles, staleDir, 64);
  assert(reloaded.getDisk("E").value_or("") == "new");
  assert(reloaded.getDisk("F").value_or("") == "x");
  assert(reloaded.getDisk("G").value_or("") == "g");
}

void testSegmentStoreCompactionDropsTombstonesWithoutLowerSegments() {
  auto files = std::make_shared<FakeFileAdapter>();
  const std::string firstSegment = "tombstone-drop/segment-00000000.jsonl";
  {
    JsonlSegmentStore store(files, "tombstone-drop", 64);
    store.setDisk("A", "a");
    store.setDisk("B", std::string(30, 'b'));
    store.deleteDisk("A");
    store.setDisk("C", std::string(30, 'c'));
    assert(files->files[firstSegment] == "B\t" + std::string(30, 'b') + "\n");
  }
  JsonlSegmentStore reloaded(files, "tombstone-drop", 64);
  assert(!reloaded.hasDisk("A"));
  assert(reloaded.getDisk("B").value_or("") == std::string(30, 'b'));
  assert(reloaded.getDisk("C").value_or("") == std::string(30, 'c'));
}

void testSegmentStoreCompactionReadFailurePreservesLiveKeys() {
  auto files = std::make_shared<FakeFileAdapter>();
  {
    JsonlSegmentStore store(files, "compact-read-failure", 64);
    store.setDisk("A", "keep-me");
    store.setDisk("B", std::string(40, 'b'));
    store.setDisk("C", std::string(40, 'c'));
    files->failReads = true;
    store.setDisk("B", "x");
    files->failReads = false;
    assert(store.hasDisk("A"));
    assert(store.getDisk("A").value_or("") == "keep-me");
    assert(store.getDisk("B").value_or("") == "x");
    store.setDisk("A", "moved");
    assert(files->files.count("compact-read-failure/segment-00000000.jsonl") == 0);
    assert(store.getDisk("A").value_or("") == "moved");
  }
  JsonlSegmentStore reloaded(files, "compact-read-failure", 64);
  assert(reloaded.getDisk("A").value_or("") == "moved");
  assert(reloaded.getDisk("B").value_or("") == "x");
  assert(reloaded.getDisk("C").value_or("") == std::string(40, 'c'));
}

static const char* const kAppendFailed = "NitroAmplitude: segment storage append failed";
static const char* const kAppendUnavailable = "NitroAmplitude: segment storage append unavailable";
static const char* const kStorageUnavailable = "NitroAmplitude: segment storage unavailable";
static const char* const kMaxSegmentName = "segment-4294967295.jsonl";

template <typename Fn>
static bool throwsRuntimeError(Fn&& fn, const std::string& expected) {
  try {
    fn();
  } catch (const std::runtime_error& error) {
    return expected == error.what();
  }
  return false;
}

static std::vector<std::string> sortedKeys(StorageAdapter& storage) {
  auto keys = storage.getAllDiskKeys();
  std::sort(keys.begin(), keys.end());
  return keys;
}

static std::string pseudoRandomBytes(size_t length, uint32_t seed) {
  std::string bytes;
  bytes.reserve(length);
  uint32_t state = seed;
  for (size_t i = 0; i < length; ++i) {
    state ^= state << 13;
    state ^= state >> 17;
    state ^= state << 5;
    bytes.push_back(static_cast<char>(state & 0xff));
  }
  return bytes;
}

static std::optional<std::string> gunzip(const std::string& input) {
  z_stream stream{};
  if (inflateInit2(&stream, 15 + 16) != Z_OK) {
    return std::nullopt;
  }
  stream.next_in = reinterpret_cast<Bytef*>(const_cast<char*>(input.data()));
  stream.avail_in = static_cast<uInt>(input.size());
  std::string output;
  std::vector<char> buffer(65536);
  int rc = Z_OK;
  while (rc == Z_OK) {
    stream.next_out = reinterpret_cast<Bytef*>(buffer.data());
    stream.avail_out = static_cast<uInt>(buffer.size());
    rc = inflate(&stream, Z_NO_FLUSH);
    output.append(buffer.data(), buffer.size() - stream.avail_out);
  }
  inflateEnd(&stream);
  if (rc != Z_STREAM_END) {
    return std::nullopt;
  }
  return output;
}

static void removeTree(const std::string& path) {
  chmod(path.c_str(), 0700);
  DIR* dir = opendir(path.c_str());
  if (dir != nullptr) {
    while (const dirent* entry = readdir(dir)) {
      const std::string name = entry->d_name;
      if (name == "." || name == "..") {
        continue;
      }
      const std::string child = path + "/" + name;
      struct stat info {};
      if (lstat(child.c_str(), &info) == 0 && S_ISDIR(info.st_mode)) {
        removeTree(child);
      } else {
        chmod(child.c_str(), 0600);
        unlink(child.c_str());
      }
    }
    closedir(dir);
  }
  rmdir(path.c_str());
}

struct TempDir {
  std::string path;

  TempDir() {
    const char* base = std::getenv("TMPDIR");
    std::string pattern = (base != nullptr && *base != '\0') ? base : "/tmp";
    while (pattern.size() > 1 && pattern.back() == '/') {
      pattern.pop_back();
    }
    pattern += "/nitro-amplitude-test-XXXXXX";
    std::vector<char> buffer(pattern.begin(), pattern.end());
    buffer.push_back('\0');
    const char* created = mkdtemp(buffer.data());
    assert(created != nullptr);
    path = created;
  }

  ~TempDir() {
    removeTree(path);
  }
};

class FileSizeLimit {
public:
  explicit FileSizeLimit(rlim_t bytes) {
    previousHandler_ = std::signal(SIGXFSZ, SIG_IGN);
    const int readResult = getrlimit(RLIMIT_FSIZE, &previous_);
    assert(readResult == 0);
    rlimit next = previous_;
    next.rlim_cur = bytes;
    const int writeResult = setrlimit(RLIMIT_FSIZE, &next);
    assert(writeResult == 0);
  }

  ~FileSizeLimit() {
    setrlimit(RLIMIT_FSIZE, &previous_);
    std::signal(SIGXFSZ, previousHandler_);
  }

private:
  rlimit previous_{};
  void (*previousHandler_)(int) = SIG_DFL;
};

static uint64_t fileSize(const std::string& path) {
  struct stat info {};
  const int result = stat(path.c_str(), &info);
  assert(result == 0);
  return static_cast<uint64_t>(info.st_size);
}

static void writeRaw(const std::string& path, const std::string& data) {
  std::ofstream stream(path, std::ios::binary | std::ios::trunc);
  stream.write(data.data(), static_cast<std::streamsize>(data.size()));
  stream.close();
  assert(stream.good());
}

static std::string readRaw(const std::string& path) {
  NitroAmplitude::PosixFileAdapter files;
  const auto content = files.readFile(path);
  assert(content.has_value());
  return content.value();
}

static size_t countNamesContaining(const std::string& directory, const std::string& needle) {
  NitroAmplitude::PosixFileAdapter files;
  size_t count = 0;
  for (const auto& name : files.listFiles(directory)) {
    if (name.find(needle) != std::string::npos) {
      ++count;
    }
  }
  return count;
}

static uint64_t directoryBytes(const std::string& directory) {
  NitroAmplitude::PosixFileAdapter files;
  uint64_t total = 0;
  for (const auto& name : files.listFiles(directory)) {
    total += fileSize(directory + "/" + name);
  }
  return total;
}

static bool everySegmentEndsOnRecordBoundary(const std::string& directory) {
  NitroAmplitude::PosixFileAdapter files;
  for (const auto& name : files.listFiles(directory)) {
    const std::string content = readRaw(directory + "/" + name);
    if (!content.empty() && content.back() != '\n') {
      return false;
    }
  }
  return true;
}

class UnstableDirectoryFileAdapter : public FakeFileAdapter {
public:
  bool directoryMissing = false;
  bool canCreateDirectory = true;
  bool failDataAppends = false;
  bool tearDataAppends = false;
  bool failRemoves = false;
  size_t ensureAttempts = 0;

  bool ensureDirectory(const std::string&) override {
    ++ensureAttempts;
    if (directoryMissing && canCreateDirectory) {
      directoryMissing = false;
    }
    return !directoryMissing;
  }

  std::vector<std::string> listFiles(const std::string& directory) override {
    if (directoryMissing) {
      return {};
    }
    return FakeFileAdapter::listFiles(directory);
  }

  std::optional<std::vector<std::string>> readDirectory(const std::string& directory) override {
    if (directoryMissing) {
      return std::nullopt;
    }
    return FakeFileAdapter::readDirectory(directory);
  }

  std::optional<std::string> readFile(const std::string& path) override {
    if (directoryMissing) {
      return std::nullopt;
    }
    return FakeFileAdapter::readFile(path);
  }

  std::optional<std::string> readRange(
      const std::string& path,
      uint64_t offset,
      uint64_t length) override {
    if (directoryMissing) {
      return std::nullopt;
    }
    return FakeFileAdapter::readRange(path, offset, length);
  }

  bool appendFile(const std::string& path, const std::string& data) override {
    if (directoryMissing) {
      return false;
    }
    if (!data.empty() && failDataAppends) {
      if (tearDataAppends) {
        files[path] += data.substr(0, data.size() / 2);
      } else {
        files[path];
      }
      return false;
    }
    return FakeFileAdapter::appendFile(path, data);
  }

  bool writeFile(const std::string& path, const std::string& data) override {
    if (directoryMissing) {
      return false;
    }
    return FakeFileAdapter::writeFile(path, data);
  }

  bool removeFile(const std::string& path) override {
    if (failRemoves) {
      return false;
    }
    return FakeFileAdapter::removeFile(path);
  }

  void loseDirectory() {
    files.clear();
    directoryMissing = true;
  }
};

class FailingRemoveFileAdapter : public FakeFileAdapter {
public:
  bool failRemoves = false;
  bool throwOnAppend = false;
  bool throwOnRead = false;
  size_t readsBeforeFailure = std::numeric_limits<size_t>::max();

  std::optional<std::string> readFile(const std::string& path) override {
    if (readsBeforeFailure == 0) {
      return std::nullopt;
    }
    --readsBeforeFailure;
    return FakeFileAdapter::readFile(path);
  }

  std::optional<std::string> readRange(
      const std::string& path,
      uint64_t offset,
      uint64_t length) override {
    if (throwOnRead) {
      throw std::bad_alloc();
    }
    return FakeFileAdapter::readRange(path, offset, length);
  }

  bool appendFile(const std::string& path, const std::string& data) override {
    if (throwOnAppend) {
      throw std::bad_alloc();
    }
    return FakeFileAdapter::appendFile(path, data);
  }

  bool removeFile(const std::string& path) override {
    if (failRemoves) {
      return false;
    }
    return FakeFileAdapter::removeFile(path);
  }
};

class ThrowingStorageAdapter : public StorageAdapter {
public:
  void setDisk(const std::string&, const std::string&) override {
    throw std::runtime_error("Disk set failed: database or disk is full");
  }

  std::optional<std::string> getDisk(const std::string&) override {
    throw std::runtime_error("Disk get failed");
  }

  void deleteDisk(const std::string&) override {
    throw std::runtime_error("Disk remove failed: database or disk is full");
  }

  bool hasDisk(const std::string&) override {
    throw std::runtime_error("Disk has failed");
  }

  std::vector<std::string> getAllDiskKeys() override {
    throw std::runtime_error("Disk keys failed");
  }
};

class PartiallyFailingStorageAdapter : public FakeStorageAdapter {
public:
  std::string failingKey;

  void setDisk(const std::string& key, const std::string& value) override {
    if (key == failingKey) {
      throw std::runtime_error("Disk set failed: database or disk is full");
    }
    FakeStorageAdapter::setDisk(key, value);
  }

  void deleteDisk(const std::string& key) override {
    if (key == failingKey) {
      throw std::runtime_error("Disk remove failed: database or disk is full");
    }
    FakeStorageAdapter::deleteDisk(key);
  }
};

class ThrowingContextAdapter : public ContextAdapter {
public:
  void prefetchContext() override {
    throw std::runtime_error("context prefetch failed");
  }

  std::string getApplicationContextJson(const std::string&) override {
    throw std::runtime_error("context read failed");
  }
};

struct RecordedRequest {
  std::string method;
  std::unordered_map<std::string, std::string> headers;
  std::string body;
  int timeoutMillis = 0;
};

class ScriptedHttpAdapter : public HttpAdapter {
public:
  HttpResult performHttpRequest(
      const std::string& url,
      const std::string& method,
      const std::unordered_map<std::string, std::string>& headers,
      const std::string& body,
      int timeoutMillis) override {
    {
      std::unique_lock<std::mutex> lock(mutex_);
      ++entered_;
      requests_[url] = RecordedRequest{method, headers, body, timeoutMillis};
      ++requestCounts_[url];
      condition_.notify_all();
      condition_.wait(lock, [this]() { return gateOpen_; });
    }
    const size_t status = url.find("/status/");
    if (status != std::string::npos) {
      const std::string code = url.substr(status + 8);
      return HttpResult{.statusCode = std::stoi(code), .body = "body-" + code};
    }
    const size_t error = url.find("/error/");
    if (error != std::string::npos) {
      return HttpResult{.error = url.substr(error + 7)};
    }
    if (url.find("/throw-int") != std::string::npos) {
      throw 42;
    }
    if (url.find("/throw-bad-alloc") != std::string::npos) {
      throw std::bad_alloc();
    }
    if (url.find("/throw") != std::string::npos) {
      throw std::runtime_error("jni_failure");
    }
    return HttpResult{.statusCode = 200, .body = ""};
  }

  void setGate(bool open) {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      gateOpen_ = open;
    }
    condition_.notify_all();
  }

  bool waitForEntered(size_t count) {
    std::unique_lock<std::mutex> lock(mutex_);
    return condition_.wait_for(
        lock, std::chrono::seconds(60), [&]() { return entered_ >= count; });
  }

  size_t requestCount(const std::string& url) {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto it = requestCounts_.find(url);
    return it == requestCounts_.end() ? 0 : it->second;
  }

  RecordedRequest request(const std::string& url) {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto it = requests_.find(url);
    assert(it != requests_.end());
    return it->second;
  }

private:
  std::mutex mutex_;
  std::condition_variable condition_;
  bool gateOpen_ = true;
  size_t entered_ = 0;
  std::map<std::string, RecordedRequest> requests_;
  std::map<std::string, size_t> requestCounts_;
};

struct Completion {
  std::string requestId;
  double statusCode = 0;
  std::string body;
  std::string error;
};

class CompletionLog {
public:
  std::function<void(const std::string&, double, const std::string&, const std::string&)> listener() {
    return [this](const std::string& requestId, double statusCode, const std::string& body, const std::string& error) {
      {
        std::lock_guard<std::mutex> lock(mutex_);
        entries_.push_back(Completion{requestId, statusCode, body, error});
      }
      condition_.notify_all();
    };
  }

  bool waitForCount(size_t count) {
    std::unique_lock<std::mutex> lock(mutex_);
    return condition_.wait_for(
        lock, std::chrono::seconds(60), [&]() { return entries_.size() >= count; });
  }

  std::vector<Completion> entries() {
    std::lock_guard<std::mutex> lock(mutex_);
    return entries_;
  }

  Completion only(const std::string& requestId) {
    std::lock_guard<std::mutex> lock(mutex_);
    Completion found;
    size_t matches = 0;
    for (const auto& entry : entries_) {
      if (entry.requestId == requestId) {
        found = entry;
        ++matches;
      }
    }
    assert(matches == 1);
    return found;
  }

private:
  std::mutex mutex_;
  std::condition_variable condition_;
  std::vector<Completion> entries_;
};

void testPosixFileAdapterContract() {
  TempDir temp;
  NitroAmplitude::PosixFileAdapter files;

  assert(!files.ensureDirectory(""));
  const std::string nested = temp.path + "/a/b/c";
  assert(files.ensureDirectory(nested));
  assert(files.ensureDirectory(nested));
  assert(files.ensureDirectory(nested + "/"));
  assert(files.listFiles(nested).empty());
  assert(files.listFiles(temp.path + "/missing").empty());
  assert(!files.readDirectory(temp.path + "/missing").has_value());
  assert(files.readDirectory(nested).value_or(std::vector<std::string>({"x"})).empty());

  const std::string regular = temp.path + "/regular";
  assert(files.writeFile(regular, "payload"));
  assert(!files.ensureDirectory(regular + "/child"));
  assert(!files.appendFile(regular + "/child/file", "x"));
  assert(!files.writeFile(regular + "/child/file", "x"));
  assert(!files.appendFile(temp.path + "/missing/file", "x"));
  assert(!files.writeFile(temp.path + "/missing/file", "x"));

  assert(files.readFile(regular).value_or("") == "payload");
  assert(!files.readFile(temp.path + "/missing").has_value());
  assert(!files.readFile(nested).has_value());

  assert(files.readRange(regular, 0, 0).value_or("x").empty());
  assert(files.readRange(regular, 3, 2).value_or("") == "lo");
  assert(files.readRange(regular, 3, 100).value_or("") == "load");
  assert(!files.readRange(regular, 7, 4).has_value());
  assert(!files.readRange(regular, 1000, 4).has_value());
  assert(!files.readRange(temp.path + "/missing", 0, 4).has_value());
  const uint64_t maxUint64 = std::numeric_limits<uint64_t>::max();
  assert(!files.readRange(regular, maxUint64, 4).has_value());
  assert(!files.readRange(regular, uint64_t{1} << 63, 4).has_value());
  assert(!files.readRange(regular, 0, maxUint64).has_value());
  assert(!files.readRange(regular, (uint64_t{1} << 63) - 2, 4).has_value());

  assert(!files.truncateFile(temp.path + "/missing", 0));
  assert(!files.truncateFile(regular, 100));
  assert(!files.truncateFile(regular, 8));
  assert(files.readFile(regular).value_or("") == "payload");
  assert(files.truncateFile(regular, 7));
  assert(files.truncateFile(regular, 3));
  assert(files.readFile(regular).value_or("") == "pay");
  assert(files.truncateFile(regular, 0));
  assert(files.readFile(regular).value_or("x").empty());
  assert(files.writeFile(regular, "payload"));

  assert(files.writeFile(regular, "replaced"));
  assert(files.readFile(regular).value_or("") == "replaced");
  assert(files.writeFile(regular, ""));
  assert(files.readFile(regular).value_or("x").empty());
  assert(files.appendFile(regular, std::string("a\0b", 3)));
  assert(files.appendFile(regular, "\xff\xfe"));
  assert(files.readFile(regular).value_or("") == std::string("a\0b\xff\xfe", 5));
  assert(countNamesContaining(temp.path, ".tmp.") == 0);

  assert(files.removeFile(regular));
  assert(files.removeFile(regular));
  assert(!files.removeFile(nested));

  const auto names = files.listFiles(temp.path);
  assert(names == std::vector<std::string>({"a"}));
}

void testPosixDiskFullKeepsCommittedRecords() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  const std::string segment0 = dir + "/segment-00000000.jsonl";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  {
    JsonlSegmentStore store(files, dir);
    store.setDisk("a", "1");
    store.setDisk("b", "2");
    const uint64_t committed = fileSize(segment0);
    assert(committed == 8);

    {
      FileSizeLimit limit(committed + 3);
      assert(throwsRuntimeError([&]() { store.setDisk("c", std::string(64, '3')); }, kAppendFailed));
    }
    assert(fileSize(segment0) == committed);
    assert(!store.hasDisk("c"));

    {
      FileSizeLimit limit(committed);
      for (int attempt = 0; attempt < 25; ++attempt) {
        assert(throwsRuntimeError([&]() { store.setDisk("d", std::string(32, '4')); }, kAppendFailed));
        assert(throwsRuntimeError([&]() { store.setDisk("a", "changed-value"); }, kAppendFailed));
        assert(throwsRuntimeError(
            [&]() { store.migrateLegacyEntries({{"legacy", "legacy-value"}}); }, kAppendFailed));
        assert(fileSize(segment0) == committed);
      }
      assert(store.getDisk("a").value_or("") == "1");
      assert(store.getDisk("b").value_or("") == "2");
    }
    assert(store.hasDisk("a"));
    assert(!store.hasDisk("d"));
    assert(files->listFiles(dir) == std::vector<std::string>({"segment-00000000.jsonl"}));
    assert(readRaw(segment0) == "a\t1\nb\t2\n");

    store.setDisk("e", "5");
    assert(store.getDisk("e").value_or("") == "5");
    assert(store.getDisk("a").value_or("") == "1");
    assert(files->listFiles(dir) == std::vector<std::string>({"segment-00000000.jsonl"}));
    assert(readRaw(segment0) == "a\t1\nb\t2\ne\t5\n");
  }

  {
    JsonlSegmentStore reloaded(files, dir);
    assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "b", "e"}));
    assert(reloaded.getDisk("a").value_or("") == "1");
    assert(reloaded.getDisk("b").value_or("") == "2");
    assert(reloaded.getDisk("e").value_or("") == "5");
  }
  assert(readRaw(segment0) == "a\t1\nb\t2\ne\t5\n");
  assert(files->listFiles(dir) == std::vector<std::string>({"segment-00000000.jsonl"}));
}

void testPosixDiskFullDeleteKeepsRecord() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  const std::string segment0 = dir + "/segment-00000000.jsonl";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  {
    JsonlSegmentStore store(files, dir);
    store.setDisk("a", "");
    const uint64_t committed = fileSize(segment0);
    assert(committed == 3);
    {
      FileSizeLimit limit(committed);
      for (int attempt = 0; attempt < 25; ++attempt) {
        assert(throwsRuntimeError([&]() { store.deleteDisk("a"); }, kAppendFailed));
        assert(fileSize(segment0) == committed);
        assert(store.hasDisk("a"));
      }
    }
    assert(files->listFiles(dir) == std::vector<std::string>({"segment-00000000.jsonl"}));
    assert(store.getDisk("a").value_or("x").empty());
  }
  {
    JsonlSegmentStore reloaded(files, dir);
    assert(reloaded.hasDisk("a"));
    reloaded.deleteDisk("a");
    assert(!reloaded.hasDisk("a"));
  }
  JsonlSegmentStore afterDelete(files, dir);
  assert(afterDelete.getAllDiskKeys().empty());
}

void testPosixDiskFullDuringRotationDoesNotBurnSegmentIds() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  const std::vector<std::string> oneSegment = {"segment-00000000.jsonl"};
  {
    JsonlSegmentStore store(files, dir, 16);
    store.setDisk("a", "1");
    {
      FileSizeLimit limit(1);
      for (int attempt = 0; attempt < 25; ++attempt) {
        assert(throwsRuntimeError(
            [&]() { store.setDisk("big", std::string(20, 'x')); }, kAppendFailed));
        assert(files->listFiles(dir) == oneSegment);
      }
    }
    store.setDisk("big", std::string(20, 'x'));
    assert(files->listFiles(dir) ==
           std::vector<std::string>({"segment-00000000.jsonl", "segment-00000001.jsonl"}));
  }
  JsonlSegmentStore reloaded(files, dir, 16);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "big"}));
}

void testPosixLoadReclaimsEmptySegments() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  assert(files->ensureDirectory(dir));
  writeRaw(dir + "/segment-00000000.jsonl", "a\t1\n");
  writeRaw(dir + "/segment-00000001.jsonl", "");
  writeRaw(dir + "/segment-00000002.jsonl", "d");
  writeRaw(dir + "/segment-00000003.jsonl", "");
  {
    JsonlSegmentStore store(files, dir);
    assert(sortedKeys(store) == std::vector<std::string>({"a"}));
    assert(files->listFiles(dir) == std::vector<std::string>({"segment-00000000.jsonl"}));
    store.setDisk("b", "2");
  }
  assert(readRaw(dir + "/segment-00000000.jsonl") == "a\t1\nb\t2\n");
  assert(files->listFiles(dir) == std::vector<std::string>({"segment-00000000.jsonl"}));
}

void testPosixReopenWhileDiskIsFull() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  const std::string segment0 = dir + "/segment-00000000.jsonl";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  {
    JsonlSegmentStore store(files, dir);
    store.setDisk("a", "1");
    store.setDisk("b", "2");
  }
  assert(files->appendFile(segment0, "c\t33"));

  {
    FileSizeLimit limit(1);
    JsonlSegmentStore store(files, dir);
    assert(sortedKeys(store) == std::vector<std::string>({"a", "b"}));
    assert(store.getDisk("a").value_or("") == "1");
    for (int attempt = 0; attempt < 10; ++attempt) {
      assert(throwsRuntimeError([&]() { store.setDisk("d", "4"); }, kAppendFailed));
    }
    assert(!store.hasDisk("d"));
  }
  assert(files->listFiles(dir) == std::vector<std::string>({"segment-00000000.jsonl"}));

  {
    JsonlSegmentStore store(files, dir);
    assert(sortedKeys(store) == std::vector<std::string>({"a", "b"}));
    store.setDisk("d", "4");
  }
  JsonlSegmentStore reloaded(files, dir);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "b", "d"}));
  assert(reloaded.getDisk("d").value_or("") == "4");
  assert(readRaw(segment0) == "a\t1\nb\t2\nd\t4\n");
  assert(files->listFiles(dir) == std::vector<std::string>({"segment-00000000.jsonl"}));
}

void testPosixMigrationUnderDiskFullRetriesWithoutDuplicates() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  const std::vector<std::pair<std::string, std::string>> legacy = {
      {"legacy-a", "1"},
      {"legacy-b", "2"},
      {"legacy-c", "3"},
  };
  {
    JsonlSegmentStore store(files, dir);
    {
      FileSizeLimit limit(1);
      assert(throwsRuntimeError([&]() { store.migrateLegacyEntries(legacy); }, kAppendFailed));
    }
    assert(store.getAllDiskKeys().empty());
    assert(files->listFiles(dir).empty());
  }
  {
    JsonlSegmentStore store(files, dir);
    assert(store.getAllDiskKeys().empty());
    assert(store.migrateLegacyEntries(legacy) == 3);
    assert(store.migrateLegacyEntries(legacy) == 0);
  }
  JsonlSegmentStore reloaded(files, dir);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"legacy-a", "legacy-b", "legacy-c"}));
  assert(reloaded.getDisk("legacy-b").value_or("") == "2");
}

void testLegacyDiskMigrationResumesWithoutResurrectingKeys() {
  auto files = std::make_shared<UnstableDirectoryFileAdapter>();
  JsonlSegmentStore store(files, "legacy-resume", 4096);
  store.setDisk("newer", "from-app");
  std::map<std::string, std::string> legacy = {
      {"legacy-a", "1"},
      {"legacy-b", "2"},
      {"legacy-c", "3"},
      {"newer", "from-legacy"},
  };
  const auto pending = [&legacy]() {
    return std::vector<std::pair<std::string, std::string>>(legacy.begin(), legacy.end());
  };
  const auto forget = [&legacy](const std::vector<std::string>& keys) {
    for (const auto& key : keys) {
      legacy.erase(key);
    }
  };

  files->failDataAppends = true;
  const auto blocked = NitroAmplitude::migrateLegacyDiskEntries(store, pending());
  assert(!blocked.complete);
  assert(blocked.handledKeys.empty());
  assert(legacy.size() == 4);

  files->failDataAppends = false;
  const auto first = NitroAmplitude::migrateLegacyDiskEntries(
      store, {{"legacy-a", "1"}});
  assert(first.complete);
  forget(first.handledKeys);
  store.deleteDisk("legacy-a");

  files->failDataAppends = true;
  const auto partial = NitroAmplitude::migrateLegacyDiskEntries(store, pending());
  assert(!partial.complete);
  assert(partial.handledKeys.empty());
  files->failDataAppends = false;

  const auto resumed = NitroAmplitude::migrateLegacyDiskEntries(store, pending());
  assert(resumed.complete);
  assert(resumed.handledKeys == std::vector<std::string>({"legacy-b", "legacy-c", "newer"}));
  forget(resumed.handledKeys);
  assert(legacy.empty());
  assert(!store.hasDisk("legacy-a"));
  assert(store.getDisk("legacy-b").value_or("") == "2");
  assert(store.getDisk("legacy-c").value_or("") == "3");
  assert(store.getDisk("newer").value_or("") == "from-app");

  const auto again = NitroAmplitude::migrateLegacyDiskEntries(store, pending());
  assert(again.complete && again.handledKeys.empty());
  JsonlSegmentStore reloaded(files, "legacy-resume", 4096);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"legacy-b", "legacy-c", "newer"}));

  const auto reserved = NitroAmplitude::migrateLegacyDiskEntries(
      reloaded, {{"ok", "1"}, {std::string("\x7f") + "DEL", "legacy-b"}, {"never", "2"}});
  assert(reserved.complete);
  assert(reserved.handledKeys.size() == 3);
  assert(reloaded.hasDisk("legacy-b"));
  assert(reloaded.getDisk("never").value_or("") == "2");
  assert(sortedKeys(reloaded).size() == 5);
}

void testSegmentStoreMigrationInterruptedMidway() {
  auto files = std::make_shared<FakeFileAdapter>();
  const std::vector<std::pair<std::string, std::string>> legacy = {
      {"legacy-a", "1"},
      {"legacy-b", "2"},
  };
  JsonlSegmentStore store(files, "mig-interrupted", 4096);
  store.setDisk("legacy-a", "already-new");
  files->failAppends = true;
  assert(throwsRuntimeError([&]() { store.migrateLegacyEntries(legacy); }, kAppendFailed));
  files->failAppends = false;
  assert(!store.hasDisk("legacy-b"));
  assert(store.migrateLegacyEntries(legacy) == 1);

  JsonlSegmentStore reloaded(files, "mig-interrupted", 4096);
  assert(reloaded.getDisk("legacy-a").value_or("") == "already-new");
  assert(reloaded.getDisk("legacy-b").value_or("") == "2");
  assert(reloaded.getAllDiskKeys().size() == 2);
}

void testPosixPermissionDenied() {
  if (geteuid() == 0) {
    std::cout << "testPosixPermissionDenied skipped: running as root" << std::endl;
    return;
  }
  TempDir temp;
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();

  const std::string readOnlyDir = temp.path + "/read-only-dir";
  {
    JsonlSegmentStore store(files, readOnlyDir, 32);
    store.setDisk("a", "1");
    assert(chmod(readOnlyDir.c_str(), 0500) == 0);
    assert(throwsRuntimeError([&]() { store.setDisk("big", std::string(40, 'x')); }, kAppendFailed));
    assert(store.getDisk("a").value_or("") == "1");
    assert(!store.hasDisk("big"));
    assert(chmod(readOnlyDir.c_str(), 0700) == 0);
    store.setDisk("big", std::string(40, 'x'));
  }
  {
    JsonlSegmentStore reloaded(files, readOnlyDir, 32);
    assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "big"}));
  }

  const std::string dir = temp.path + "/read-only-file";
  const std::string segment0 = dir + "/segment-00000000.jsonl";
  {
    JsonlSegmentStore store(files, dir);
    store.setDisk("a", "1");
    assert(chmod(segment0.c_str(), 0400) == 0);
    assert(throwsRuntimeError([&]() { store.setDisk("b", "2"); }, kAppendFailed));
    assert(store.getDisk("a").value_or("") == "1");
    store.setDisk("c", "3");
    assert(store.getDisk("c").value_or("") == "3");
  }

  assert(chmod(segment0.c_str(), 0000) == 0);
  {
    JsonlSegmentStore store(files, dir);
    assert(sortedKeys(store) == std::vector<std::string>({"c"}));
    assert(!store.getDisk("a").has_value());
    store.setDisk("d", "4");
  }
  assert(chmod(segment0.c_str(), 0600) == 0);
  JsonlSegmentStore reloaded(files, dir);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "c", "d"}));
  assert(reloaded.getDisk("a").value_or("") == "1");
  assert(reloaded.getDisk("d").value_or("") == "4");
}

void testPosixDirectoryRemovedWhileRunning() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  {
    JsonlSegmentStore store(files, dir);
    store.setDisk("a", "1");
    store.setDisk("gone", "2");
    removeTree(dir);
    store.setDisk("b", "2");
    assert(!store.hasDisk("a"));
    assert(!store.getDisk("a").has_value());
    assert(store.getDisk("b").value_or("") == "2");
    assert(sortedKeys(store) == std::vector<std::string>({"b"}));
    store.deleteDisk("gone");

    removeTree(dir);
    assert(!store.getDisk("b").has_value());
    assert(!store.hasDisk("b"));
    assert(store.getAllDiskKeys().empty());
    store.deleteDisk("b");
    store.setDisk("c", "3");
    assert(sortedKeys(store) == std::vector<std::string>({"c"}));

    removeTree(dir);
    store.deleteDisk("c");
    assert(store.getAllDiskKeys().empty());
    removeTree(dir);
    store.setDisk("c", "3");
  }
  JsonlSegmentStore reloaded(files, dir);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"c"}));
  assert(files->listFiles(dir) == std::vector<std::string>({"segment-00000000.jsonl"}));

  const std::string blocked = temp.path + "/not-a-directory";
  writeRaw(blocked, "x");
  JsonlSegmentStore blockedStore(files, blocked);
  assert(throwsRuntimeError([&]() { blockedStore.getAllDiskKeys(); }, kStorageUnavailable));
  assert(throwsRuntimeError([&]() { blockedStore.setDisk("a", "1"); }, kAppendFailed));
  assert(throwsRuntimeError([&]() { blockedStore.deleteDisk("a"); }, kAppendFailed));
  assert(!blockedStore.hasDisk("a"));
  assert(!blockedStore.getDisk("a").has_value());
  assert(readRaw(blocked) == "x");
}

void testPosixCrashRestartAtEveryByteOfLastRecord() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  const std::string segment0 = dir + "/segment-00000000.jsonl";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  std::string committed;
  std::string full;
  {
    JsonlSegmentStore store(files, dir);
    store.setDisk("k0", "v0");
    store.setDisk("k1", "old");
    store.setDisk("k2", "v2");
    store.setDisk("k1", "line1\nline2\ttab\\slash");
    store.deleteDisk("k2");
    store.setDisk("k3", "v3");
    committed = readRaw(segment0);
    store.setDisk("k4", "last\nrecord");
    full = readRaw(segment0);
  }
  assert(full.size() > committed.size());
  const std::vector<std::string> committedKeys = {"k0", "k1", "k3"};

  for (size_t length = committed.size(); length < full.size(); ++length) {
    writeRaw(segment0, full.substr(0, length));
    {
      JsonlSegmentStore recovered(files, dir);
      assert(sortedKeys(recovered) == committedKeys);
      assert(recovered.getDisk("k0").value_or("") == "v0");
      assert(recovered.getDisk("k1").value_or("") == "line1\nline2\ttab\\slash");
      assert(recovered.getDisk("k3").value_or("") == "v3");
      assert(!recovered.hasDisk("k2"));
      assert(!recovered.hasDisk("k4"));
    }
    assert(readRaw(segment0) == committed);
    {
      JsonlSegmentStore retried(files, dir);
      retried.setDisk("k4", "last\nrecord");
    }
    assert(readRaw(segment0) == full);
    assert(files->listFiles(dir).size() == 1);
  }

  JsonlSegmentStore complete(files, dir);
  assert(sortedKeys(complete) == std::vector<std::string>({"k0", "k1", "k3", "k4"}));
  assert(complete.getDisk("k4").value_or("") == "last\nrecord");
}

void testPosixCorruptRecordsAreIsolated() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  const std::string segment0 = dir + "/segment-00000000.jsonl";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  assert(files->ensureDirectory(dir));
  const std::string corrupt =
      std::string("a\t1\n") +
      "garbage-without-tab\n" +
      "bad\\qkey\tvalue\n" +
      "trailing\\\tvalue\n" +
      "b\tbad\\qvalue\n" +
      "\n" +
      "\t\n" +
      std::string("nul\0key\tnul\0value\n", 18) +
      "utf8\t\xff\xfe\xc3\x28\n" +
      "c\t3\n" +
      "half\twritten";
  writeRaw(segment0, corrupt);

  {
    JsonlSegmentStore store(files, dir, 256);
    assert(sortedKeys(store) ==
           std::vector<std::string>({"", "a", "c", std::string("nul\0key", 7), "utf8"}));
    assert(store.getDisk("a").value_or("") == "1");
    assert(store.getDisk("c").value_or("") == "3");
    assert(store.getDisk("").value_or("x").empty());
    assert(store.getDisk(std::string("nul\0key", 7)).value_or("") == std::string("nul\0value", 9));
    assert(store.getDisk("utf8").value_or("") == "\xff\xfe\xc3\x28");
    assert(!store.hasDisk("b"));
    assert(!store.hasDisk("half"));
    for (int i = 0; i < 40; ++i) {
      store.setDisk("a", "rewritten-" + std::to_string(i));
      store.setDisk("c", "rewritten-" + std::to_string(i));
    }
  }
  JsonlSegmentStore reloaded(files, dir, 256);
  assert(reloaded.getDisk("a").value_or("") == "rewritten-39");
  assert(reloaded.getDisk("c").value_or("") == "rewritten-39");
  assert(reloaded.getDisk("utf8").value_or("") == "\xff\xfe\xc3\x28");
  assert(reloaded.getAllDiskKeys().size() == 5);
  assert(everySegmentEndsOnRecordBoundary(dir));
  assert(directoryBytes(dir) < 2048);
}

void testPosixSegmentChangedUnderneathReturnsMissing() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  const std::string segment0 = dir + "/segment-00000000.jsonl";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  JsonlSegmentStore store(files, dir);
  store.setDisk("k", "ab");
  assert(readRaw(segment0) == "k\tab\n");

  writeRaw(segment0, "k\t\\q\n");
  assert(!store.getDisk("k").has_value());
  writeRaw(segment0, "k\ta");
  assert(!store.getDisk("k").has_value());
  writeRaw(segment0, "kXab\n");
  assert(!store.getDisk("k").has_value());
  writeRaw(segment0, "");
  assert(!store.getDisk("k").has_value());
  writeRaw(segment0, "k\tab\n");
  assert(store.getDisk("k").value_or("") == "ab");
}

void testPosixEmptyAndForeignFilesAreIgnored() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  assert(files->ensureDirectory(dir));
  writeRaw(dir + "/segment-00000000.jsonl", "");
  writeRaw(dir + "/segment-abc.jsonl", "x\ty\n");
  writeRaw(dir + "/segment-.jsonl", "x\ty\n");
  writeRaw(dir + "/segment-12345678901.jsonl", "x\ty\n");
  writeRaw(dir + "/segment-00000003.json", "x\ty\n");
  writeRaw(dir + "/notes.txt", "x\ty\n");
  {
    JsonlSegmentStore store(files, dir);
    assert(store.getAllDiskKeys().empty());
    store.setDisk("a", "1");
  }
  assert(readRaw(dir + "/segment-00000000.jsonl") == "a\t1\n");
  assert(readRaw(dir + "/notes.txt") == "x\ty\n");
  JsonlSegmentStore reloaded(files, dir);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"a"}));
}

void testPosixInterruptedCompactionLeavesNoTemporaryFiles() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  {
    JsonlSegmentStore store(files, dir);
    store.setDisk("a", "1");
  }
  writeRaw(dir + "/segment-00000000.jsonl.tmp.Ab12Cd", "a\t1\nstale");
  writeRaw(dir + "/segment-00000007.jsonl.tmp.Zz99Yy", "");
  {
    JsonlSegmentStore store(files, dir);
    assert(sortedKeys(store) == std::vector<std::string>({"a"}));
    store.setDisk("b", "2");
  }
  assert(countNamesContaining(dir, ".tmp.") == 0);
  assert(files->listFiles(dir) == std::vector<std::string>({"segment-00000000.jsonl"}));
  JsonlSegmentStore reloaded(files, dir);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "b"}));
}

void testPosixHugeAndBinaryValuesRoundTrip() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  const std::string huge = pseudoRandomBytes(3 * 1024 * 1024, 0x9e3779b9u);
  const std::string binaryKey = std::string("key\0\xff\xfe\t\n\r\\", 10);
  std::string everyByte;
  for (int i = 0; i < 256; ++i) {
    everyByte.push_back(static_cast<char>(i));
  }
  {
    JsonlSegmentStore store(files, dir);
    store.setDisk("small-before", "1");
    store.setDisk("huge", huge);
    store.setDisk(binaryKey, everyByte);
    store.setDisk("empty", "");
    store.setDisk("small-after", "2");
    assert(store.getDisk("huge").value_or("") == huge);
    assert(store.getDisk(binaryKey).value_or("") == everyByte);
    assert(files->listFiles(dir).size() == 3);
  }
  {
    JsonlSegmentStore reloaded(files, dir);
    assert(reloaded.getAllDiskKeys().size() == 5);
    assert(reloaded.getDisk("huge").value_or("") == huge);
    assert(reloaded.getDisk(binaryKey).value_or("") == everyByte);
    assert(reloaded.getDisk("empty").value_or("x").empty());
    assert(reloaded.getDisk("small-before").value_or("") == "1");
    assert(reloaded.getDisk("small-after").value_or("") == "2");
    reloaded.setDisk("huge", "shrunk");
    reloaded.deleteDisk(binaryKey);
  }
  JsonlSegmentStore shrunk(files, dir);
  assert(shrunk.getDisk("huge").value_or("") == "shrunk");
  assert(!shrunk.hasDisk(binaryKey));
  assert(directoryBytes(dir) < 4096);
}

void testPosixRepeatedOverwritesStayBounded() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  constexpr uint64_t cap = 64 * 1024;
  {
    JsonlSegmentStore store(files, dir, cap);
    for (int i = 0; i < 16; ++i) {
      store.setDisk("identity-" + std::to_string(i), std::string(512, 'i'));
    }
    for (int i = 0; i < 4000; ++i) {
      store.setDisk("events", std::string(2048, static_cast<char>('a' + (i % 26))));
      if (i % 7 == 0) {
        store.setDisk("cursor", std::to_string(i));
      }
      if (i % 11 == 0) {
        store.setDisk("scratch", std::string(700, 's'));
        store.deleteDisk("scratch");
      }
    }
    assert(directoryBytes(dir) <= 3 * cap);
    assert(files->listFiles(dir).size() <= 3);
  }
  JsonlSegmentStore reloaded(files, dir, cap);
  assert(reloaded.getAllDiskKeys().size() == 18);
  assert(reloaded.getDisk("events").value_or("") == std::string(2048, static_cast<char>('a' + (3999 % 26))));
  assert(reloaded.getDisk("cursor").value_or("") == "3997");
  assert(reloaded.getDisk("identity-15").value_or("") == std::string(512, 'i'));
  assert(!reloaded.hasDisk("scratch"));
  assert(directoryBytes(dir) <= 3 * cap);
  assert(countNamesContaining(dir, ".tmp.") == 0);
}

void testPosixBoundedKeySetKeepsDiskBounded() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  constexpr uint64_t cap = 16 * 1024;
  constexpr uint64_t largestRecord = 3100;
  constexpr int keyCount = 48;
  std::map<std::string, std::string> expected;
  size_t worstFiles = 0;
  {
    JsonlSegmentStore store(files, dir, cap);
    uint32_t state = 0x2545f491u;
    const auto next = [&state]() {
      state ^= state << 13;
      state ^= state >> 17;
      state ^= state << 5;
      return state;
    };
    for (int operation = 0; operation < 30000; ++operation) {
      const std::string key = "key-" + std::to_string(next() % keyCount);
      if (next() % 100 < 15) {
        store.deleteDisk(key);
        expected.erase(key);
      } else {
        const std::string value(next() % 3000, static_cast<char>('a' + (next() % 26)));
        store.setDisk(key, value);
        expected[key] = value;
      }
      if (operation % 250 == 0) {
        uint64_t liveBytes = 0;
        for (const auto& entry : expected) {
          liveBytes += entry.first.size() + entry.second.size() + 2;
        }
        const uint64_t bytes = directoryBytes(dir);
        const size_t fileCount = files->listFiles(dir).size();
        worstFiles = std::max(worstFiles, fileCount);
        assert(bytes <= 2 * liveBytes + 2 * cap + largestRecord);
      }
    }
  }
  assert(worstFiles <= keyCount + 2);
  JsonlSegmentStore reloaded(files, dir, cap);
  assert(reloaded.getAllDiskKeys().size() == expected.size());
  for (const auto& entry : expected) {
    assert(reloaded.getDisk(entry.first).value_or("\x01") == entry.second);
  }
  assert(countNamesContaining(dir, ".tmp.") == 0);
}

void testPosixConcurrentCallers() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  constexpr int threadCount = 8;
  constexpr int iterations = 150;
  {
    auto store = std::make_shared<JsonlSegmentStore>(files, dir, 4096);
    auto storage = std::make_shared<HybridAmplitudeStorage>(store);
    std::vector<std::thread> threads;
    std::atomic<int> failures = 0;
    for (int t = 0; t < threadCount; ++t) {
      threads.emplace_back([&, t]() {
        const std::string own = "own-" + std::to_string(t);
        const std::string scratch = "scratch-" + std::to_string(t);
        for (int i = 0; i < iterations; ++i) {
          try {
            storage->set(own, std::to_string(i), true);
            storage->set("shared", own, true);
            storage->set(scratch, std::string(64, 'x'), true);
            if (storage->get(own, true).value_or("") != std::to_string(i)) {
              ++failures;
            }
            if (!storage->has("shared", true)) {
              ++failures;
            }
            storage->remove(scratch, true);
            storage->getKeysByPrefix("own-", true);
            storage->set(own, std::to_string(i), false);
            storage->getExternalMemorySize();
          } catch (const std::exception&) {
            ++failures;
          }
        }
      });
    }
    for (auto& thread : threads) {
      thread.join();
    }
    assert(failures == 0);
    assert(storage->getAllKeys(true).size() == threadCount + 1);
    assert(storage->getAllKeys(false).size() == threadCount);
  }
  JsonlSegmentStore reloaded(files, dir, 4096);
  assert(reloaded.getAllDiskKeys().size() == threadCount + 1);
  for (int t = 0; t < threadCount; ++t) {
    assert(reloaded.getDisk("own-" + std::to_string(t)).value_or("") == std::to_string(iterations - 1));
    assert(!reloaded.hasDisk("scratch-" + std::to_string(t)));
  }
  assert(reloaded.getDisk("shared").value_or("").rfind("own-", 0) == 0);
  assert(everySegmentEndsOnRecordBoundary(dir));
}

void testSegmentStoreFailedAppendLeavesStoreUnchanged() {
  auto files = std::make_shared<UnstableDirectoryFileAdapter>();
  const std::string segment0 = "unchanged/segment-00000000.jsonl";
  JsonlSegmentStore store(files, "unchanged", 32);
  store.setDisk("a", "1");
  store.setDisk("b", "2");
  const auto before = files->files;

  files->failDataAppends = true;
  for (int attempt = 0; attempt < 50; ++attempt) {
    files->tearDataAppends = attempt % 2 == 0;
    assert(throwsRuntimeError([&]() { store.setDisk("c", "3"); }, kAppendFailed));
    assert(throwsRuntimeError([&]() { store.setDisk("a", "changed"); }, kAppendFailed));
    assert(throwsRuntimeError([&]() { store.deleteDisk("b"); }, kAppendFailed));
    assert(throwsRuntimeError(
        [&]() { store.setDisk("rotates", std::string(40, 'r')); }, kAppendFailed));
    assert(throwsRuntimeError(
        [&]() { store.migrateLegacyEntries({{"legacy", "value"}}); }, kAppendFailed));
    assert(files->files == before);
  }
  assert(files->truncateAttempts > 0);
  assert(sortedKeys(store) == std::vector<std::string>({"a", "b"}));
  assert(store.getDisk("a").value_or("") == "1");

  files->failDataAppends = false;
  store.setDisk("c", "3");
  assert(files->files.size() == 1);
  assert(files->files[segment0] == "a\t1\nb\t2\nc\t3\n");
  store.setDisk("rotates", std::string(40, 'r'));
  assert(files->files.count("unchanged/segment-00000001.jsonl") == 1);
  assert(files->files.size() == 2);

  JsonlSegmentStore reloaded(files, "unchanged", 32);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "b", "c", "rotates"}));
}

void testSegmentStoreFailedRestoreRetiresSegment() {
  auto files = std::make_shared<UnstableDirectoryFileAdapter>();
  const std::string segment0 = "retire/segment-00000000.jsonl";
  {
    JsonlSegmentStore store(files, "retire", 4096);
    store.setDisk("a", "1");
    files->failDataAppends = true;
    files->tearDataAppends = true;
    files->failTruncates = true;
    assert(throwsRuntimeError([&]() { store.setDisk("b", "22222222"); }, kAppendFailed));
    assert(files->files[segment0] != "a\t1\n");
    files->failDataAppends = false;
    files->failTruncates = false;
    store.setDisk("b", "2");
    assert(files->files["retire/segment-00000001.jsonl"] == "b\t2\n");
    assert(store.getDisk("a").value_or("") == "1");
  }
  JsonlSegmentStore reloaded(files, "retire", 4096);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "b"}));
  assert(files->files[segment0] == "a\t1\n");

  auto fresh = std::make_shared<UnstableDirectoryFileAdapter>();
  {
    JsonlSegmentStore store(fresh, "retire-fresh", 4096);
    fresh->failDataAppends = true;
    fresh->tearDataAppends = true;
    fresh->failRemoves = true;
    assert(throwsRuntimeError([&]() { store.setDisk("a", "11111111"); }, kAppendFailed));
    fresh->failDataAppends = false;
    store.setDisk("a", "1");
    assert(fresh->files["retire-fresh/segment-00000001.jsonl"] == "a\t1\n");
    assert(fresh->files.count("retire-fresh/segment-00000000.jsonl") == 1);
  }
  fresh->failRemoves = false;
  {
    JsonlSegmentStore reloadedFresh(fresh, "retire-fresh", 4096);
    assert(sortedKeys(reloadedFresh) == std::vector<std::string>({"a"}));
    assert(fresh->files.count("retire-fresh/segment-00000000.jsonl") == 0);
  }

  auto atMax = std::make_shared<UnstableDirectoryFileAdapter>();
  const std::string maxSegment = std::string("retire-max/") + kMaxSegmentName;
  atMax->files[maxSegment] = "a\t1\n";
  JsonlSegmentStore maxStore(atMax, "retire-max", 4096);
  atMax->failDataAppends = true;
  atMax->tearDataAppends = true;
  assert(throwsRuntimeError([&]() { maxStore.setDisk("b", "2"); }, kAppendFailed));
  assert(atMax->files[maxSegment] == "a\t1\n");
  atMax->failDataAppends = false;
  maxStore.setDisk("b", "2");
  assert(atMax->files[maxSegment] == "a\t1\nb\t2\n");
}

void testSegmentStoreRecoversFromDirectoryLoss() {
  auto files = std::make_shared<UnstableDirectoryFileAdapter>();
  JsonlSegmentStore store(files, "lost", 4096);
  store.setDisk("a", "1");
  store.setDisk("b", "2");

  files->loseDirectory();
  files->canCreateDirectory = false;
  assert(throwsRuntimeError([&]() { store.setDisk("c", "3"); }, kAppendFailed));
  assert(throwsRuntimeError([&]() { store.setDisk("c", "3"); }, kAppendFailed));
  assert(!store.getDisk("a").has_value());
  assert(files->files.empty());

  files->canCreateDirectory = true;
  store.setDisk("c", "3");
  assert(sortedKeys(store) == std::vector<std::string>({"c"}));
  assert(!store.hasDisk("a"));
  assert(!store.getDisk("b").has_value());
  assert(files->files["lost/segment-00000000.jsonl"] == "c\t3\n");

  files->loseDirectory();
  assert(!store.getDisk("c").has_value());
  assert(!store.hasDisk("c"));
  store.deleteDisk("c");
  store.setDisk("d", "4");
  files->loseDirectory();
  store.deleteDisk("d");
  assert(store.getAllDiskKeys().empty());

  JsonlSegmentStore reloaded(files, "lost", 4096);
  assert(reloaded.getAllDiskKeys().empty());
}

void testSegmentStoreReloadAfterLossHonoursUnreadableMaxSegment() {
  auto files = std::make_shared<FakeFileAdapter>();
  const std::string maxSegment = std::string("lost-max/") + kMaxSegmentName;
  JsonlSegmentStore store(files, "lost-max", 4096);
  store.setDisk("a", "1");

  files->files.clear();
  files->files[maxSegment] = "b\t2\n";
  files->unreadablePaths.insert(maxSegment);
  files->failAppends = true;
  assert(throwsRuntimeError([&]() { store.setDisk("c", "3"); }, kAppendUnavailable));
  files->failAppends = false;
  assert(throwsRuntimeError([&]() { store.setDisk("c", "3"); }, kAppendUnavailable));
  assert(!store.hasDisk("a"));
  assert(files->files[maxSegment] == "b\t2\n");
}

void testPosixRollbackOnShortenedSegmentRetiresIt() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  const std::string segment0 = dir + "/segment-00000000.jsonl";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  {
    JsonlSegmentStore store(files, dir);
    store.setDisk("a", "1");
    store.setDisk("b", "2");
    assert(unlink(segment0.c_str()) == 0);
    {
      FileSizeLimit limit(3);
      assert(throwsRuntimeError([&]() { store.setDisk("c", "3"); }, kAppendFailed));
    }
    assert(readRaw(segment0) == "c\t3");
    store.setDisk("d", "4");
    assert(readRaw(segment0) == "c\t3");
    assert(readRaw(dir + "/segment-00000001.jsonl") == "d\t4\n");
    assert(store.getDisk("d").value_or("") == "4");
    assert(!store.hasDisk("c"));
  }
  JsonlSegmentStore reloaded(files, dir);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"d"}));
  assert(reloaded.getDisk("d").value_or("") == "4");
}

void testSegmentStoreKeepsIndexWhenDirectoryCheckFails() {
  auto files = std::make_shared<FakeFileAdapter>();
  auto store = std::make_shared<JsonlSegmentStore>(files, "mkdir", 4096);
  auto storage = std::make_shared<HybridAmplitudeStorage>(store);
  storage->set("a", "1", true);
  storage->set("b", "2", true);
  const auto before = files->files;

  files->failEnsureDirectory = true;
  files->failAppends = true;
  for (int attempt = 0; attempt < 3; ++attempt) {
    assert(throwsRuntimeError([&]() { storage->set("c", "3", true); }, kAppendFailed));
    assert(throwsRuntimeError([&]() { storage->remove("a", true); }, kAppendFailed));
    assert(throwsRuntimeError([&]() { storage->clear(true); }, kAppendFailed));
    assert(storage->has("a", true));
    assert(storage->get("a", true).value_or("") == "1");
    assert(storage->getAllKeys(true).size() == 2);
  }
  assert(files->files == before);

  files->failAppends = false;
  storage->set("c", "3", true);
  assert(storage->getAllKeys(true).size() == 3);
  files->failEnsureDirectory = false;
  storage->remove("a", true);
  assert(!storage->has("a", true));

  JsonlSegmentStore reloaded(files, "mkdir", 4096);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"b", "c"}));
}

void testSegmentStoreIsReadyWhenListingSucceeds() {
  auto files = std::make_shared<FakeFileAdapter>();
  files->files["listed/segment-00000000.jsonl"] = "a\t1\n";
  files->failEnsureDirectory = true;
  {
    JsonlSegmentStore store(files, "listed", 4096);
    assert(sortedKeys(store) == std::vector<std::string>({"a"}));
    store.setDisk("b", "2");
    store.deleteDisk("a");
  }
  JsonlSegmentStore reloaded(files, "listed", 4096);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"b"}));
}

class RestrictedPosixFileAdapter : public NitroAmplitude::PosixFileAdapter {
public:
  int makeDirectoryError = 0;
  size_t entriesBeforeReadError = std::numeric_limits<size_t>::max();

protected:
  int makeDirectory(const char* path, mode_t mode) override {
    if (makeDirectoryError != 0) {
      errno = makeDirectoryError;
      return -1;
    }
    return NitroAmplitude::PosixFileAdapter::makeDirectory(path, mode);
  }

  const dirent* nextEntry(DIR* dir) override {
    if (entriesRead_ >= entriesBeforeReadError) {
      entriesRead_ = 0;
      errno = EIO;
      return nullptr;
    }
    const dirent* entry = NitroAmplitude::PosixFileAdapter::nextEntry(dir);
    if (entry != nullptr) {
      ++entriesRead_;
    } else {
      entriesRead_ = 0;
    }
    return entry;
  }

private:
  size_t entriesRead_ = 0;
};

void testPosixEnsureDirectoryToleratesAncestorErrors() {
  TempDir temp;
  const std::string dir = temp.path + "/a/b/store";
  auto files = std::make_shared<RestrictedPosixFileAdapter>();
  assert(files->ensureDirectory(dir));
  for (const int error : {EPERM, EACCES, EROFS, EEXIST, EISDIR}) {
    files->makeDirectoryError = error;
    assert(files->ensureDirectory(dir));
    assert(files->ensureDirectory(dir + "/"));
    assert(!files->ensureDirectory(temp.path + "/a/b/absent"));
  }
  writeRaw(temp.path + "/a/file", "x");
  assert(!files->ensureDirectory(temp.path + "/a/file"));
  files->makeDirectoryError = 0;
  assert(!files->ensureDirectory(temp.path + "/a/file"));
  assert(!files->ensureDirectory(temp.path + "/a/file/child"));

  files->makeDirectoryError = EPERM;
  {
    JsonlSegmentStore store(files, dir);
    store.setDisk("a", "1");
  }
  JsonlSegmentStore reloaded(files, dir);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"a"}));
  JsonlSegmentStore absent(files, temp.path + "/a/b/absent");
  assert(throwsRuntimeError([&]() { absent.setDisk("a", "1"); }, kAppendFailed));
  assert(throwsRuntimeError([&]() { absent.getAllDiskKeys(); }, kStorageUnavailable));
  files->makeDirectoryError = 0;
  absent.setDisk("a", "1");
  assert(sortedKeys(absent) == std::vector<std::string>({"a"}));
}

void testPosixPartialDirectoryListingIsAnError() {
  TempDir temp;
  const std::string dir = temp.path + "/store";
  auto files = std::make_shared<RestrictedPosixFileAdapter>();
  {
    JsonlSegmentStore store(files, dir, 16);
    store.setDisk("a", "1");
    store.setDisk("big", std::string(20, 'x'));
    store.setDisk("c", "3");
    assert(files->listFiles(dir).size() >= 2);

    files->entriesBeforeReadError = 2;
    assert(!files->readDirectory(dir).has_value());
    assert(files->listFiles(dir).empty());
    files->entriesBeforeReadError = 3;
    assert(!files->readDirectory(dir).has_value());
    files->entriesBeforeReadError = std::numeric_limits<size_t>::max();
    assert(files->readDirectory(dir).has_value());
    assert(store.getDisk("a").value_or("") == "1");
  }
  files->entriesBeforeReadError = 3;
  JsonlSegmentStore blind(files, dir, 16);
  assert(!blind.hasDisk("a"));
  assert(throwsRuntimeError([&]() { blind.setDisk("d", "4"); }, kAppendFailed));
  files->entriesBeforeReadError = std::numeric_limits<size_t>::max();
  assert(sortedKeys(blind) == std::vector<std::string>({"a", "big", "c"}));
}

void testSegmentStoreOpenFailuresRetireAtMostOneSegment() {
  auto files = std::make_shared<FakeFileAdapter>();
  {
    JsonlSegmentStore store(files, "open-fail", 4096);
    store.setDisk("a", "1");
    files->failAppends = true;
    for (int attempt = 0; attempt < 50; ++attempt) {
      files->failListing = attempt % 2 == 0;
      assert(throwsRuntimeError([&]() { store.setDisk("b", "2"); }, kAppendFailed));
      assert(throwsRuntimeError([&]() { store.deleteDisk("a"); }, kAppendFailed));
    }
    files->failAppends = false;
    files->failListing = false;
    store.setDisk("b", "2");
    assert(files->files.size() == 2);
    assert(files->files["open-fail/segment-00000001.jsonl"] == "b\t2\n");
  }

  auto empty = std::make_shared<FakeFileAdapter>();
  JsonlSegmentStore emptyStore(empty, "open-fail-empty", 4096);
  empty->failAppends = true;
  for (int attempt = 0; attempt < 50; ++attempt) {
    empty->failListing = attempt % 2 == 0;
    assert(throwsRuntimeError([&]() { emptyStore.setDisk("a", "1"); }, kAppendFailed));
  }
  empty->failAppends = false;
  empty->failListing = false;
  emptyStore.setDisk("a", "1");
  assert(empty->files.size() == 1);
  assert(empty->files["open-fail-empty/segment-00000000.jsonl"] == "a\t1\n");
}

void testPosixUnwritableSegmentRetiresOneId() {
  if (geteuid() == 0) {
    std::cout << "testPosixUnwritableSegmentRetiresOneId skipped: running as root" << std::endl;
    return;
  }
  TempDir temp;
  const std::string dir = temp.path + "/store";
  const std::string segment0 = dir + "/segment-00000000.jsonl";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  {
    JsonlSegmentStore store(files, dir);
    store.setDisk("a", "1");
    assert(chmod(segment0.c_str(), 0400) == 0);
    assert(chmod(dir.c_str(), 0500) == 0);
    for (int attempt = 0; attempt < 20; ++attempt) {
      assert(throwsRuntimeError([&]() { store.setDisk("b", "2"); }, kAppendFailed));
    }
    assert(store.getDisk("a").value_or("") == "1");
    assert(chmod(dir.c_str(), 0700) == 0);
    store.setDisk("b", "2");
    assert(files->listFiles(dir) ==
           std::vector<std::string>({"segment-00000000.jsonl", "segment-00000001.jsonl"}));
  }
  assert(chmod(segment0.c_str(), 0600) == 0);
  JsonlSegmentStore reloaded(files, dir);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "b"}));
}

void testSegmentStoreKeepsIndexWhenListingFails() {
  auto files = std::make_shared<FakeFileAdapter>();
  const std::string segment0 = "listing/segment-00000000.jsonl";
  {
    JsonlSegmentStore store(files, "listing", 4096);
    store.setDisk("a", "1");
    files->failAppends = true;
    files->failListing = true;
    files->failReads = true;
    for (int attempt = 0; attempt < 5; ++attempt) {
      assert(throwsRuntimeError([&]() { store.setDisk("b", "2"); }, kAppendFailed));
      assert(!store.getDisk("a").has_value());
      assert(store.hasDisk("a"));
    }
    files->failAppends = false;
    files->failListing = false;
    files->failReads = false;
    assert(store.getDisk("a").value_or("") == "1");
    store.setDisk("b", "2");
    assert(files->files[segment0] == "a\t1\n");
  }
  {
    JsonlSegmentStore reloaded(files, "listing", 4096);
    assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "b"}));
  }

  files->failListing = true;
  JsonlSegmentStore blind(files, "listing", 4096);
  const auto before = files->files;
  assert(throwsRuntimeError([&]() { blind.getAllDiskKeys(); }, kStorageUnavailable));
  assert(throwsRuntimeError([&]() { blind.deleteDisk("a"); }, kAppendFailed));
  assert(!blind.hasDisk("a"));
  assert(throwsRuntimeError([&]() { blind.setDisk("c", "3"); }, kAppendFailed));
  assert(files->files == before);
  files->failListing = false;
  assert(sortedKeys(blind) == std::vector<std::string>({"a", "b"}));
  blind.setDisk("c", "3");
  JsonlSegmentStore finalStore(files, "listing", 4096);
  assert(sortedKeys(finalStore) == std::vector<std::string>({"a", "b", "c"}));
}

void testSegmentStoreLoadKeepsSegmentsItCannotRemove() {
  auto files = std::make_shared<FailingRemoveFileAdapter>();
  files->files["keep/segment-00000000.jsonl"] = "a\t1\n";
  files->files["keep/segment-00000001.jsonl"] = "";
  files->files["keep/segment-00000002.jsonl"] = "torn";
  files->failRemoves = true;
  {
    JsonlSegmentStore store(files, "keep", 4096);
    assert(sortedKeys(store) == std::vector<std::string>({"a"}));
    store.setDisk("b", "2");
    assert(files->files["keep/segment-00000002.jsonl"] == "torn");
    assert(files->files["keep/segment-00000003.jsonl"] == "b\t2\n");
  }
  files->failRemoves = false;
  JsonlSegmentStore reloaded(files, "keep", 4096);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "b"}));
  assert(files->files.count("keep/segment-00000001.jsonl") == 0);
  assert(files->files.count("keep/segment-00000002.jsonl") == 0);

  auto emptyOnly = std::make_shared<FailingRemoveFileAdapter>();
  emptyOnly->files["empty/segment-00000004.jsonl"] = "";
  emptyOnly->failRemoves = true;
  JsonlSegmentStore emptyStore(emptyOnly, "empty", 4096);
  emptyStore.setDisk("a", "1");
  assert(emptyOnly->files["empty/segment-00000004.jsonl"] == "a\t1\n");
}

void testSegmentStoreLoadsWhenDirectoryBecomesAvailable() {
  auto files = std::make_shared<UnstableDirectoryFileAdapter>();
  files->files["locked/segment-00000000.jsonl"] = "a\t1\nb\t2\n";
  files->directoryMissing = true;
  files->canCreateDirectory = false;

  JsonlSegmentStore store(files, "locked", 4096);
  auto storage = std::make_shared<HybridAmplitudeStorage>(
      std::shared_ptr<StorageAdapter>(std::shared_ptr<StorageAdapter>(), &store));
  assert(throwsRuntimeError([&]() { store.getAllDiskKeys(); }, kStorageUnavailable));
  assert(throwsRuntimeError([&]() { storage->clear(true); }, kStorageUnavailable));
  assert(throwsRuntimeError([&]() { storage->getKeysByPrefix("", true); }, kStorageUnavailable));
  assert(!store.hasDisk("a"));
  assert(!store.getDisk("a").has_value());
  assert(throwsRuntimeError([&]() { store.deleteDisk("a"); }, kAppendFailed));
  assert(throwsRuntimeError([&]() { storage->remove("a", true); }, kAppendFailed));
  assert(throwsRuntimeError([&]() { store.setDisk("c", "3"); }, kAppendFailed));
  assert(throwsRuntimeError(
      [&]() { store.migrateLegacyEntries({{"legacy", "value"}}); }, kAppendFailed));
  assert(files->files["locked/segment-00000000.jsonl"] == "a\t1\nb\t2\n");
  assert(files->ensureAttempts >= 6);

  files->canCreateDirectory = true;
  assert(store.getDisk("a").value_or("") == "1");
  assert(sortedKeys(store) == std::vector<std::string>({"a", "b"}));
  store.setDisk("c", "3");
  assert(files->files["locked/segment-00000000.jsonl"] == "a\t1\nb\t2\nc\t3\n");
  const size_t attemptsWhenReady = files->ensureAttempts;
  store.hasDisk("a");
  store.getDisk("b");
  store.setDisk("d", "4");
  assert(files->ensureAttempts == attemptsWhenReady);
}

void testSegmentStoreRecordSizeLimit() {
  auto files = std::make_shared<FakeFileAdapter>();
  {
    JsonlSegmentStore store(files, "limit", 4096, 64);
    store.setDisk("fits", std::string(64 - 6, 'f'));
    const auto before = files->files;
    const std::string tooLarge = "NitroAmplitude: segment storage record too large";
    assert(throwsRuntimeError([&]() { store.setDisk("over", std::string(64 - 5, 'o')); }, tooLarge));
    assert(throwsRuntimeError([&]() { store.setDisk("fits", std::string(4096, 'o')); }, tooLarge));
    assert(throwsRuntimeError([&]() { store.setDisk(std::string(128, 'k'), ""); }, tooLarge));
    assert(throwsRuntimeError(
        [&]() { store.migrateLegacyEntries({{"legacy", std::string(128, 'l')}}); }, tooLarge));
    assert(files->files == before);
    assert(store.getDisk("fits").value_or("").size() == 58);
    assert(!store.hasDisk("over"));
  }
  {
    JsonlSegmentStore unlimited(files, "limit", 4096);
    unlimited.setDisk("large", std::string(200, 'x'));
    unlimited.setDisk(std::string(62, 'k'), "");
  }
  {
    JsonlSegmentStore limited(files, "limit", 4096, 64);
    assert(limited.hasDisk("fits"));
    assert(!limited.hasDisk("large"));
    assert(!limited.getDisk("large").has_value());
    assert(limited.hasDisk(std::string(62, 'k')));
    assert(throwsRuntimeError([&]() { limited.deleteDisk(std::string(62, 'k')); }, kAppendFailed));
    assert(limited.hasDisk(std::string(62, 'k')));
  }

  JsonlSegmentStore defaulted(files, "limit", 0, 0);
  assert(defaulted.getDisk("large").value_or("").size() == 200);
}

void testSegmentStoreRejectsReservedKey() {
  auto files = std::make_shared<FakeFileAdapter>();
  const std::string reserved = "\x7f" "DEL";
  const std::string reservedError = "NitroAmplitude: segment storage key reserved";
  {
    JsonlSegmentStore store(files, "reserved", 4096);
    store.setDisk("victim", "keep");
    const auto before = files->files;
    assert(throwsRuntimeError([&]() { store.setDisk(reserved, "victim"); }, reservedError));
    assert(throwsRuntimeError(
        [&]() { store.migrateLegacyEntries({{reserved, "victim"}}); }, reservedError));
    assert(files->files == before);
    assert(!store.hasDisk(reserved));
    assert(!store.getDisk(reserved).has_value());
    store.deleteDisk(reserved);
    store.setDisk(reserved + "x", "allowed");
    store.setDisk("value", reserved);
  }
  JsonlSegmentStore reloaded(files, "reserved", 4096);
  assert(reloaded.getDisk("victim").value_or("") == "keep");
  assert(reloaded.getDisk(reserved + "x").value_or("") == "allowed");
  assert(reloaded.getDisk("value").value_or("") == reserved);
}

void testSegmentStoreReclaimsTombstoneOnlySegments() {
  auto files = std::make_shared<FakeFileAdapter>();
  const std::string tombstoneX = std::string("\x7f") + "DEL\tx\n";
  const std::string tombstoneY = std::string("\x7f") + "DEL\ty\n";
  files->files["stuck/segment-00000000.jsonl"] = "x\told\na\t1\ny\told\n";
  files->files["stuck/segment-00000001.jsonl"] = tombstoneX;
  files->files["stuck/segment-00000002.jsonl"] = tombstoneY + tombstoneX + tombstoneY;
  files->files["stuck/segment-00000003.jsonl"] = "stale\t1\nstale\t2\n";
  files->files["stuck/segment-00000004.jsonl"] = "stale\t3\nb\t2\n";
  {
    JsonlSegmentStore store(files, "stuck", 4096);
    assert(sortedKeys(store) == std::vector<std::string>({"a", "b", "stale"}));
    assert(files->files.size() == 2);
    assert(files->files.count("stuck/segment-00000000.jsonl") == 1);
    assert(files->files["stuck/segment-00000004.jsonl"] ==
           "stale\t3\nb\t2\n" + tombstoneX + tombstoneY + tombstoneX);
    assert(store.getDisk("b").value_or("") == "2");
    assert(store.getDisk("stale").value_or("") == "3");
  }
  const auto afterFirstLoad = files->files;
  {
    JsonlSegmentStore reloaded(files, "stuck", 4096);
    assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "b", "stale"}));
    assert(!reloaded.hasDisk("x"));
    assert(!reloaded.hasDisk("y"));
    assert(files->files == afterFirstLoad);
  }

  auto blocked = std::make_shared<FakeFileAdapter>();
  blocked->files["stuck-blocked/segment-00000000.jsonl"] = "x\told\na\t1\n";
  blocked->files["stuck-blocked/segment-00000001.jsonl"] = tombstoneX;
  blocked->files["stuck-blocked/segment-00000002.jsonl"] = "b\t2\n";
  blocked->failWrites = true;
  {
    JsonlSegmentStore store(blocked, "stuck-blocked", 4096);
    assert(sortedKeys(store) == std::vector<std::string>({"a", "b"}));
    assert(blocked->files.size() == 3);
  }
  blocked->failWrites = false;
  JsonlSegmentStore recovered(blocked, "stuck-blocked", 4096);
  assert(!recovered.hasDisk("x"));
  assert(blocked->files.size() == 2);

  auto unremovable = std::make_shared<FailingRemoveFileAdapter>();
  unremovable->files["stuck-remove/segment-00000000.jsonl"] = "x\told\na\t1\n";
  unremovable->files["stuck-remove/segment-00000001.jsonl"] = tombstoneX;
  unremovable->files["stuck-remove/segment-00000002.jsonl"] = "b\t2\n";
  unremovable->failRemoves = true;
  {
    JsonlSegmentStore store(unremovable, "stuck-remove", 4096);
    assert(sortedKeys(store) == std::vector<std::string>({"a", "b"}));
    assert(unremovable->files.size() == 3);
    assert(unremovable->files["stuck-remove/segment-00000002.jsonl"] == "b\t2\n" + tombstoneX);
    store.setDisk("c", "3");
    assert(store.getDisk("c").value_or("") == "3");
    assert(store.getDisk("b").value_or("") == "2");
  }
  unremovable->failRemoves = false;
  {
    JsonlSegmentStore store(unremovable, "stuck-remove", 4096);
    assert(sortedKeys(store) == std::vector<std::string>({"a", "b", "c"}));
    assert(unremovable->files.size() == 2);
  }

  auto unreadableActive = std::make_shared<FailingRemoveFileAdapter>();
  unreadableActive->files["stuck-read/segment-00000000.jsonl"] = "x\told\na\t1\n";
  unreadableActive->files["stuck-read/segment-00000001.jsonl"] = tombstoneX;
  unreadableActive->files["stuck-read/segment-00000002.jsonl"] = "b\t2\n";
  unreadableActive->readsBeforeFailure = 4;
  {
    JsonlSegmentStore store(unreadableActive, "stuck-read", 4096);
    unreadableActive->readsBeforeFailure = std::numeric_limits<size_t>::max();
    assert(sortedKeys(store) == std::vector<std::string>({"a", "b"}));
    assert(unreadableActive->files.size() == 3);
    assert(unreadableActive->files["stuck-read/segment-00000002.jsonl"] == "b\t2\n");
    assert(unreadableActive->files["stuck-read/segment-00000001.jsonl"] == tombstoneX);
  }
  JsonlSegmentStore readable(unreadableActive, "stuck-read", 4096);
  assert(!readable.hasDisk("x"));
  assert(unreadableActive->files.size() == 2);

  auto live = std::make_shared<FailingRemoveFileAdapter>();
  {
    JsonlSegmentStore store(live, "stuck-live", 24);
    store.setDisk("keep", "k");
    store.setDisk("gone", std::string(10, 'g'));
    store.setDisk("fill", std::string(16, 'f'));
    store.deleteDisk("gone");
    store.deleteDisk("fill");
    store.setDisk("next", std::string(16, 'n'));
    assert(live->files.size() <= 3);
    assert(!store.hasDisk("gone"));
  }
  JsonlSegmentStore liveReloaded(live, "stuck-live", 24);
  assert(sortedKeys(liveReloaded) == std::vector<std::string>({"keep", "next"}));
}

void testPosixTombstoneNeverMovesAcrossUnreadableSegment() {
  if (geteuid() == 0) {
    std::cout << "testPosixTombstoneNeverMovesAcrossUnreadableSegment skipped: running as root" << std::endl;
    return;
  }
  TempDir temp;
  const std::string dir = temp.path + "/store";
  auto files = std::make_shared<NitroAmplitude::PosixFileAdapter>();
  assert(files->ensureDirectory(dir));
  const std::string tombstone = std::string("\x7f") + "DEL\tJ\n";
  const std::string segment2 = dir + "/segment-00000002.jsonl";
  writeRaw(dir + "/segment-00000000.jsonl", "J\t1\nkeep\tk\n");
  writeRaw(dir + "/segment-00000001.jsonl", tombstone);
  writeRaw(segment2, "J\t2\n");
  writeRaw(dir + "/segment-00000003.jsonl", "other\tx\n");

  assert(chmod(segment2.c_str(), 0000) == 0);
  {
    JsonlSegmentStore store(files, dir);
    assert(!store.hasDisk("J"));
    assert(store.getDisk("other").value_or("") == "x");
    store.setDisk("written-while-hidden", "1");
  }
  assert(readRaw(dir + "/segment-00000001.jsonl") == tombstone);
  assert(chmod(segment2.c_str(), 0600) == 0);

  JsonlSegmentStore reloaded(files, dir);
  assert(reloaded.getDisk("J").value_or("") == "2");
  assert(reloaded.getDisk("other").value_or("") == "x");
  assert(reloaded.getDisk("written-while-hidden").value_or("") == "1");
  assert(reloaded.getDisk("keep").value_or("") == "k");
}

void testSegmentStoreTombstoneStaysBelowPartiallyReadSegments() {
  const std::string tombstone = std::string("\x7f") + "DEL\tJ\n";
  const std::string large(100, 'x');

  auto skipped = std::make_shared<FakeFileAdapter>();
  skipped->files["skipped/segment-00000000.jsonl"] = "J\t1\nkeep\tk\n";
  skipped->files["skipped/segment-00000001.jsonl"] = tombstone;
  skipped->files["skipped/segment-00000002.jsonl"] = "J\t" + large + "\nb\t2\n";
  skipped->files["skipped/segment-00000003.jsonl"] = "o\tx\n";
  {
    JsonlSegmentStore limited(skipped, "skipped", 4096, 64);
    assert(!limited.hasDisk("J"));
    assert(skipped->files["skipped/segment-00000001.jsonl"] == tombstone);
    assert(skipped->files["skipped/segment-00000003.jsonl"] == "o\tx\n");
  }
  JsonlSegmentStore unlimited(skipped, "skipped", 4096);
  assert(unlimited.getDisk("J").value_or("") == large);

  auto retired = std::make_shared<UnstableDirectoryFileAdapter>();
  retired->files["retired/segment-00000000.jsonl"] = "J\t1\nkeep\tk\n";
  retired->files["retired/segment-00000001.jsonl"] = "gone\tg\n" + tombstone;
  retired->files["retired/segment-00000002.jsonl"] = "o\tx\n";
  {
    JsonlSegmentStore store(retired, "retired", 4096);
    retired->failDataAppends = true;
    retired->tearDataAppends = true;
    retired->failTruncates = true;
    assert(throwsRuntimeError([&]() { store.setDisk("J", "2"); }, kAppendFailed));
    retired->failDataAppends = false;
    retired->failTruncates = false;
    store.deleteDisk("gone");
    assert(retired->files["retired/segment-00000001.jsonl"] == tombstone);
  }
  JsonlSegmentStore reloaded(retired, "retired", 4096);
  assert(!reloaded.hasDisk("J"));
  assert(!reloaded.hasDisk("gone"));
  assert(reloaded.getDisk("keep").value_or("") == "k");
}

static std::map<std::string, std::string> replaySegments(
    const std::map<std::string, std::string>& files,
    const std::string& directory,
    const std::set<std::string>& hidden) {
  std::map<std::string, std::string> state;
  const std::string tombstoneKey = std::string("\x7f") + "DEL";
  for (const auto& file : files) {
    if (file.first.rfind(directory + "/segment-", 0) != 0 || hidden.count(file.first) > 0) {
      continue;
    }
    const std::string& content = file.second;
    size_t offset = 0;
    while (true) {
      const size_t newline = content.find('\n', offset);
      if (newline == std::string::npos) {
        break;
      }
      const std::string line = content.substr(offset, newline - offset);
      const size_t tab = line.find('\t');
      if (tab != std::string::npos) {
        const std::string key = line.substr(0, tab);
        const std::string value = line.substr(tab + 1);
        if (key == tombstoneKey) {
          state.erase(value);
        } else {
          state[key] = value;
        }
      }
      offset = newline + 1;
    }
  }
  return state;
}

static std::map<std::string, std::string> visibleState(JsonlSegmentStore& store) {
  std::map<std::string, std::string> state;
  for (const auto& key : store.getAllDiskKeys()) {
    const auto value = store.getDisk(key);
    assert(value.has_value());
    state[key] = value.value();
  }
  return state;
}

void testSegmentStoreReplayMatchesReferenceUnderUnreadableSegments() {
  for (uint32_t seed = 1; seed <= 24; ++seed) {
    auto files = std::make_shared<FakeFileAdapter>();
    const std::string dir = "differential-" + std::to_string(seed);
    uint32_t state = seed * 2654435761u + 1u;
    const auto next = [&state]() {
      state ^= state << 13;
      state ^= state >> 17;
      state ^= state << 5;
      return state;
    };
    for (int launch = 0; launch < 30; ++launch) {
      files->unreadablePaths.clear();
      const auto beforeLoad = files->files;
      for (const auto& file : beforeLoad) {
        if (launch % 3 != 0 && next() % 100 < 20) {
          files->unreadablePaths.insert(file.first);
        }
      }
      const std::set<std::string> hidden = files->unreadablePaths;

      JsonlSegmentStore store(files, dir, 48 + (seed % 5) * 16);
      auto expectedVisible = replaySegments(beforeLoad, dir, hidden);
      assert(visibleState(store) == expectedVisible);
      auto expectedFull = replaySegments(beforeLoad, dir, {});
      assert(replaySegments(files->files, dir, {}) == expectedFull);

      const int operations = 10 + static_cast<int>(next() % 50);
      for (int operation = 0; operation < operations; ++operation) {
        const std::string key = "k" + std::to_string(next() % 9);
        if (next() % 100 < 35) {
          const bool wasVisible = expectedVisible.count(key) > 0;
          store.deleteDisk(key);
          expectedVisible.erase(key);
          if (wasVisible) {
            expectedFull.erase(key);
          }
        } else {
          const std::string value(next() % 24, static_cast<char>('a' + (next() % 26)));
          store.setDisk(key, value);
          expectedVisible[key] = value;
          expectedFull[key] = value;
        }
        assert(replaySegments(files->files, dir, {}) == expectedFull);
        assert(replaySegments(files->files, dir, hidden) == expectedVisible);
      }
      assert(visibleState(store) == expectedVisible);
    }
    files->unreadablePaths.clear();
    const auto finalFiles = files->files;
    JsonlSegmentStore finalStore(files, dir, 64);
    assert(visibleState(finalStore) == replaySegments(finalFiles, dir, {}));
  }
}

void testSegmentStoreRejectsSegmentIdsAboveUint32() {
  auto files = std::make_shared<FakeFileAdapter>();
  files->files["overflow/segment-4294967296.jsonl"] = "ghost\tboo\n";
  files->files["overflow/segment-9999999999.jsonl"] = "ghost2\tboo\n";
  {
    JsonlSegmentStore store(files, "overflow", 4096);
    assert(store.getAllDiskKeys().empty());
    store.setDisk("a", "1");
  }
  assert(files->files.count("overflow/segment-00000000.jsonl") == 1);
  assert(files->files["overflow/segment-00000000.jsonl"] == "a\t1\n");
  assert(files->files["overflow/segment-4294967296.jsonl"] == "ghost\tboo\n");
  JsonlSegmentStore reloaded(files, "overflow", 4096);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"a"}));
}

void testSegmentStoreRemovesStaleTemporaryFiles() {
  auto files = std::make_shared<FakeFileAdapter>();
  files->files["stale/segment-00000000.jsonl"] = "a\t1\n";
  files->files["stale/segment-00000000.jsonl.tmp.Ab12Cd"] = "a\t1\npartial";
  files->files["stale/unrelated.tmp.file"] = "keep";
  JsonlSegmentStore store(files, "stale", 4096);
  assert(sortedKeys(store) == std::vector<std::string>({"a"}));
  assert(files->files.count("stale/segment-00000000.jsonl.tmp.Ab12Cd") == 0);
  assert(files->files.count("stale/unrelated.tmp.file") == 1);
  assert(files->files["stale/segment-00000000.jsonl"] == "a\t1\n");
}

void testSegmentStoreMaxSegmentIdDisablesAppends() {
  const std::string maxName = kMaxSegmentName;

  auto rotation = std::make_shared<FakeFileAdapter>();
  rotation->files["rotation/" + maxName] = "a\t1\n";
  {
    JsonlSegmentStore store(rotation, "rotation", 8);
    assert(store.getDisk("a").value_or("") == "1");
    assert(throwsRuntimeError([&]() { store.setDisk("b", "22222222"); }, kAppendUnavailable));
    assert(throwsRuntimeError([&]() { store.setDisk("c", "3"); }, kAppendUnavailable));
    assert(throwsRuntimeError([&]() { store.deleteDisk("a"); }, kAppendFailed));
    assert(store.getDisk("a").value_or("") == "1");
    assert(store.migrateLegacyEntries({{"a", "legacy"}}) == 0);
    assert(throwsRuntimeError(
        [&]() { store.migrateLegacyEntries({{"new", "legacy"}}); }, kAppendUnavailable));
  }
  assert(rotation->files["rotation/" + maxName] == "a\t1\n");

  auto tombstoneRotation = std::make_shared<FakeFileAdapter>();
  tombstoneRotation->files["tombstone/" + maxName] = "a\t1\n";
  {
    JsonlSegmentStore store(tombstoneRotation, "tombstone", 8);
    assert(throwsRuntimeError([&]() { store.deleteDisk("a"); }, kAppendFailed));
    assert(store.hasDisk("a"));
  }

  auto appendFailure = std::make_shared<FakeFileAdapter>();
  appendFailure->files["append/" + maxName] = "a\t1\n";
  {
    JsonlSegmentStore store(appendFailure, "append", 4096);
    store.setDisk("b", "2");
    appendFailure->failAppends = true;
    assert(throwsRuntimeError([&]() { store.setDisk("c", "3"); }, kAppendFailed));
    appendFailure->failAppends = false;
    assert(throwsRuntimeError([&]() { store.setDisk("c", "3"); }, kAppendUnavailable));
    assert(store.getDisk("b").value_or("") == "2");
  }
  {
    JsonlSegmentStore store(appendFailure, "append", 4096);
    appendFailure->failAppends = true;
    assert(throwsRuntimeError([&]() { store.deleteDisk("a"); }, kAppendFailed));
    appendFailure->failAppends = false;
    assert(throwsRuntimeError([&]() { store.deleteDisk("a"); }, kAppendFailed));
    assert(store.getDisk("a").value_or("") == "1");
  }

  auto unreadable = std::make_shared<FakeFileAdapter>();
  unreadable->files["unreadable/segment-00000000.jsonl"] = "a\t1\n";
  unreadable->files["unreadable/" + maxName] = "b\t2\n";
  unreadable->unreadablePaths.insert("unreadable/" + maxName);
  {
    JsonlSegmentStore store(unreadable, "unreadable", 4096);
    assert(store.getDisk("a").value_or("") == "1");
    assert(throwsRuntimeError([&]() { store.setDisk("c", "3"); }, kAppendUnavailable));
  }
  unreadable->unreadablePaths.clear();
  {
    JsonlSegmentStore store(unreadable, "unreadable", 4096);
    assert(store.getDisk("b").value_or("") == "2");
    store.setDisk("c", "3");
    assert(store.getDisk("c").value_or("") == "3");
  }

  auto tornTail = std::make_shared<FakeFileAdapter>();
  tornTail->files["torn/" + maxName] = "a\t1\nb\t2";
  tornTail->failNextWrite = true;
  {
    JsonlSegmentStore store(tornTail, "torn", 4096);
    assert(store.getDisk("a").value_or("") == "1");
    assert(!store.hasDisk("b"));
    assert(throwsRuntimeError([&]() { store.setDisk("c", "3"); }, kAppendUnavailable));
  }
  assert(tornTail->files["torn/" + maxName] == "a\t1\nb\t2");
  {
    JsonlSegmentStore store(tornTail, "torn", 4096);
    store.setDisk("c", "3");
  }
  assert(tornTail->files["torn/" + maxName] == "a\t1\nc\t3\n");
}

void testSegmentStoreRemoveFailureKeepsDeletionDurable() {
  auto files = std::make_shared<FailingRemoveFileAdapter>();
  {
    JsonlSegmentStore store(files, "remove-failure", 16);
    store.setDisk("A", "old");
    store.setDisk("B", std::string(16, 'b'));
    assert(files->files.size() == 2);
    files->failRemoves = true;
    store.deleteDisk("A");
    assert(!store.hasDisk("A"));
    assert(files->files.count("remove-failure/segment-00000000.jsonl") == 1);
    store.deleteDisk("missing");
  }
  {
    JsonlSegmentStore reloaded(files, "remove-failure", 16);
    assert(!reloaded.hasDisk("A"));
    assert(reloaded.getDisk("B").value_or("") == std::string(16, 'b'));
  }
  files->failRemoves = false;
  JsonlSegmentStore afterRecovery(files, "remove-failure", 16);
  assert(!afterRecovery.hasDisk("A"));
  assert(afterRecovery.getAllDiskKeys().size() == 1);
}

void testSegmentStoreCompactionSkipsSegmentChangedUnderneath() {
  auto files = std::make_shared<FakeFileAdapter>();
  const std::string segment0 = "changed/segment-00000000.jsonl";
  {
    JsonlSegmentStore store(files, "changed", 16);
    store.setDisk("A", "o");
    store.setDisk("C", "cccc");
    store.setDisk("B", std::string(16, 'b'));
    assert(files->files[segment0] == "A\to\nC\tcccc\n");
    files->files[segment0] = "X\t1\nA\to\nC\tcccc\n";
    store.setDisk("C", "new");
    assert(files->files[segment0] == "X\t1\nA\to\nC\tcccc\n");
    assert(store.getDisk("C").value_or("") == "new");
    assert(store.getDisk("B").value_or("") == std::string(16, 'b'));
  }
  JsonlSegmentStore reloaded(files, "changed", 16);
  assert(reloaded.getDisk("A").value_or("") == "o");
  assert(reloaded.getDisk("C").value_or("") == "new");
  assert(reloaded.getDisk("X").value_or("") == "1");
}

void testSegmentStoreReadFailureAndAllocatorFailure() {
  auto files = std::make_shared<FailingRemoveFileAdapter>();
  auto store = std::make_shared<JsonlSegmentStore>(files, "read-failure", 4096);
  auto storage = std::make_shared<HybridAmplitudeStorage>(store);
  storage->set("a", "1", true);

  files->failReads = true;
  assert(storage->has("a", true));
  assert(!storage->get("a", true).has_value());
  assert(storage->getBatch({"a"}, true) ==
         std::vector<std::string>({"__nitro_amplitude_batch_missing__::v1"}));
  files->failReads = false;
  assert(storage->get("a", true).value_or("") == "1");

  files->throwOnRead = true;
  bool readThrew = false;
  try {
    storage->get("a", true);
  } catch (const std::bad_alloc&) {
    readThrew = true;
  }
  assert(readThrew);
  files->throwOnRead = false;

  files->throwOnAppend = true;
  bool appendThrew = false;
  try {
    storage->set("b", "2", true);
  } catch (const std::bad_alloc&) {
    appendThrew = true;
  }
  assert(appendThrew);
  bool removeThrew = false;
  try {
    storage->remove("a", true);
  } catch (const std::bad_alloc&) {
    removeThrew = true;
  }
  assert(removeThrew);
  files->throwOnAppend = false;

  assert(!storage->has("b", true));
  assert(storage->get("a", true).value_or("") == "1");
  storage->set("b", "2", true);
  JsonlSegmentStore reloaded(files, "read-failure", 4096);
  assert(sortedKeys(reloaded) == std::vector<std::string>({"a", "b"}));
}

void testStorageErrorContract() {
  auto failing = std::make_shared<HybridAmplitudeStorage>(std::make_shared<ThrowingStorageAdapter>());
  const std::string setError = "Disk set failed: database or disk is full";
  const std::string removeError = "Disk remove failed: database or disk is full";
  assert(throwsRuntimeError([&]() { failing->set("k", "v", true); }, setError));
  assert(throwsRuntimeError([&]() { failing->setBatch({"k"}, {"v"}, true); }, setError));
  assert(throwsRuntimeError([&]() { failing->get("k", true); }, "Disk get failed"));
  assert(throwsRuntimeError([&]() { failing->getBatch({"k"}, true); }, "Disk get failed"));
  assert(throwsRuntimeError([&]() { failing->remove("k", true); }, removeError));
  assert(throwsRuntimeError([&]() { failing->removeBatch({"k"}, true); }, removeError));
  assert(throwsRuntimeError([&]() { failing->has("k", true); }, "Disk has failed"));
  assert(throwsRuntimeError([&]() { failing->getAllKeys(true); }, "Disk keys failed"));
  assert(throwsRuntimeError([&]() { failing->getKeysByPrefix("k", true); }, "Disk keys failed"));
  assert(throwsRuntimeError([&]() { failing->clear(true); }, "Disk keys failed"));
  assert(throwsRuntimeError(
      [&]() { failing->setBatch({"a", "b"}, {"1"}, true); },
      "NitroAmplitude: setBatch key/value length mismatch"));
  failing->setBatch({}, {}, true);
  failing->removeBatch({}, true);
  assert(failing->getBatch({}, true).empty());

  failing->set("memory", "value", false);
  assert(failing->get("memory", false).value_or("") == "value");
  assert(failing->getExternalMemorySize() == 11);

  auto partialAdapter = std::make_shared<PartiallyFailingStorageAdapter>();
  auto partial = std::make_shared<HybridAmplitudeStorage>(partialAdapter);
  partialAdapter->failingKey = "b";
  assert(throwsRuntimeError(
      [&]() { partial->setBatch({"a", "b", "c"}, {"1", "2", "3"}, true); }, setError));
  assert(partial->getAllKeys(true) == std::vector<std::string>({"a"}));
  partialAdapter->values["b"] = "2";
  partialAdapter->values["c"] = "3";
  assert(throwsRuntimeError([&]() { partial->clear(true); }, removeError));
  assert(partial->has("b", true));
  assert(throwsRuntimeError([&]() { partial->removeBatch({"c", "b"}, true); }, removeError));
  assert(!partial->has("c", true));
  assert(partial->has("b", true));

  auto segmentFiles = std::make_shared<FakeFileAdapter>();
  auto segmentStorage = std::make_shared<HybridAmplitudeStorage>(
      std::make_shared<JsonlSegmentStore>(segmentFiles, "contract", 4096));
  segmentStorage->set("k", "v", true);
  segmentFiles->failAppends = true;
  assert(throwsRuntimeError([&]() { segmentStorage->set("k", "new", true); }, kAppendFailed));
  assert(throwsRuntimeError([&]() { segmentStorage->remove("k", true); }, kAppendFailed));
  assert(throwsRuntimeError([&]() { segmentStorage->clear(true); }, kAppendFailed));
  assert(segmentStorage->get("k", true).value_or("") == "v");

  auto noAdapter = std::make_shared<HybridAmplitudeStorage>();
  assert(throwsRuntimeError(
      [&]() { noAdapter->set("k", "v", true); }, "NitroAmplitude: disk_adapter_unavailable"));
  assert(!noAdapter->get("k", true).has_value());
  assert(!noAdapter->has("k", true));
  assert(noAdapter->getAllKeys(true).empty());
  assert(noAdapter->getKeysByPrefix("", true).empty());
  noAdapter->remove("k", true);
  noAdapter->removeBatch({"k"}, true);
  noAdapter->clear(true);
  assert(noAdapter->getBatch({"k"}, true) ==
         std::vector<std::string>({"__nitro_amplitude_batch_missing__::v1"}));
}

void testStorageHostileInput() {
  auto storage = std::make_shared<HybridAmplitudeStorage>();
  assert(storage->getExternalMemorySize() == 0);
  const std::string nulKey = std::string("a\0b", 3);
  const std::string invalidUtf8 = "\xff\xfe\xc3\x28\xed\xa0\x80";
  storage->set("", "", false);
  storage->set(nulKey, invalidUtf8, false);
  storage->set("a", "shadow", false);
  assert(storage->has("", false));
  assert(storage->get("", false).value_or("x").empty());
  assert(storage->get(nulKey, false).value_or("") == invalidUtf8);
  assert(storage->get("a", false).value_or("") == "shadow");
  assert(storage->getKeysByPrefix("", false).size() == 3);
  assert(storage->getKeysByPrefix(std::string("a\0", 2), false) == std::vector<std::string>({nulKey}));
  assert(storage->getExternalMemorySize() == nulKey.size() + invalidUtf8.size() + 1 + 6);

  const std::string large(8 * 1024 * 1024, 'x');
  storage->set("large", large, false);
  assert(storage->get("large", false).value_or("").size() == large.size());
  assert(storage->getExternalMemorySize() >= large.size());
  storage->clear(false);
  assert(storage->getExternalMemorySize() == 0);
  storage->remove("missing", false);
  assert(storage->getBatch({}, false).empty());
}

void testContextErrorContract() {
  auto context = std::make_shared<HybridAmplitudeContext>(std::make_shared<ThrowingContextAdapter>());
  assert(throwsRuntimeError([&]() { context->prefetch(); }, "context prefetch failed"));
  assert(throwsRuntimeError(
      [&]() { context->getApplicationContextJson("{}"); }, "context read failed"));

  auto adapter = std::make_shared<FakeContextAdapter>();
  auto recording = std::make_shared<HybridAmplitudeContext>(adapter);
  const std::string hostile = std::string("{\"a\":\"\0\xff\"", 9);
  assert(recording->getApplicationContextJson(hostile) == "{\"platform\":\"fake\"}");
  assert(adapter->lastOptions == hostile);
  recording->getApplicationContextJson("");
  assert(adapter->lastOptions.empty());
}

void testContextEventIdNumericBoundaries() {
  auto context = std::make_shared<HybridAmplitudeContext>();
  const std::string invalid = "NitroAmplitude: Invalid eventId";
  const double two63 = std::ldexp(1.0, 63);
  const std::vector<double> rejected = {
      std::numeric_limits<double>::quiet_NaN(),
      std::numeric_limits<double>::infinity(),
      -std::numeric_limits<double>::infinity(),
      0.5,
      -1.5,
      std::numeric_limits<double>::denorm_min(),
      4294967296.5,
      two63,
      std::nextafter(-two63, -std::numeric_limits<double>::infinity()),
      1e300,
      -1e300,
      std::numeric_limits<double>::max(),
  };
  for (const double value : rejected) {
    assert(throwsRuntimeError(
        [&]() { context->removeLegacyEvent("default", "events", value); }, invalid));
  }
  const std::vector<double> accepted = {
      0.0,
      -0.0,
      -1.0,
      2147483647.0,
      2147483648.0,
      4294967296.0,
      1700000000000.0,
      9007199254740992.0,
      std::nextafter(two63, 0.0),
      -two63,
  };
  for (const double value : accepted) {
    context->removeLegacyEvent("", std::string("\0\xff", 2), value);
  }
}

void testGzipInputBoundaries() {
  assert(!::NitroAmplitude::gzipCompress("").has_value());
  assert(!::NitroAmplitude::gzipCompress("a").has_value());
  assert(!::NitroAmplitude::gzipCompress(pseudoRandomBytes(1024, 7)).has_value());
  assert(!::NitroAmplitude::gzipCompress(pseudoRandomBytes(256 * 1024, 11)).has_value());

  std::string json;
  while (json.size() < 8 * 1024 * 1024) {
    json += "{\"event_type\":\"screen_view\",\"insert_id\":\"";
    json += std::to_string(json.size());
    json += "\",\"event_properties\":{\"name\":\"\xc3\xa9\\u0000\"}},";
  }
  const auto compressed = ::NitroAmplitude::gzipCompress(json);
  assert(compressed.has_value());
  assert(compressed->size() < json.size() / 4);
  assert(static_cast<unsigned char>((*compressed)[0]) == 0x1f);
  assert(static_cast<unsigned char>((*compressed)[1]) == 0x8b);
  assert(gunzip(*compressed).value_or("") == json);

  const std::string bounded(4096, 'a');
  assert(::NitroAmplitude::gzipCompressBounded(bounded, 4096).has_value());
  assert(!::NitroAmplitude::gzipCompressBounded(bounded, 4095).has_value());
  assert(!::NitroAmplitude::gzipCompressBounded(bounded, 0).has_value());
  assert(!::NitroAmplitude::gzipCompressBounded("", 4096).has_value());
  assert(::NitroAmplitude::gzipCompressBounded(bounded, std::numeric_limits<size_t>::max()).has_value());

  std::string binary = std::string(4096, '\0') + std::string(4096, '\xff');
  const auto binaryCompressed = ::NitroAmplitude::gzipCompress(binary);
  assert(binaryCompressed.has_value());
  assert(gunzip(*binaryCompressed).value_or("") == binary);
}

void testGzipAuthorityEdgeCases() {
  const std::string large(1024, 'a');
  const auto shouldGzip = [&large](const std::string& url) {
    return ::NitroAmplitude::shouldGzipAmplitudeRequest(url, "POST", {}, large);
  };

  assert(shouldGzip("https://amplitude.com"));
  assert(shouldGzip("http://amplitude.com?x=1"));
  assert(shouldGzip("https://amplitude.com#fragment"));
  assert(shouldGzip("https://api2.amplitude.com:1/2/httpapi"));
  assert(shouldGzip("https://api2.amplitude.com:65535/2/httpapi"));
  assert(shouldGzip("https://a-b.amplitude.com/2/httpapi"));

  assert(!shouldGzip(""));
  assert(!shouldGzip("://amplitude.com"));
  assert(!shouldGzip("ftp://amplitude.com/2/httpapi"));
  assert(!shouldGzip("https://"));
  assert(!shouldGzip("https://:443/2/httpapi"));
  assert(!shouldGzip("https://amplitude.com:/2/httpapi"));
  assert(!shouldGzip("https://amplitude.com:0/2/httpapi"));
  assert(!shouldGzip("https://amplitude.com:00000/2/httpapi"));
  assert(!shouldGzip("https://amplitude.com:443:443/2/httpapi"));
  assert(!shouldGzip("https://amplitude.com:99999999999999999999/2/httpapi"));
  assert(!shouldGzip("https://amplitude.com:-1/2/httpapi"));
  assert(!shouldGzip("https://xamplitude.com/2/httpapi"));
  assert(!shouldGzip("https://.amplitude.com/2/httpapi"));
  assert(!shouldGzip("https://api..amplitude.com/2/httpapi"));
  assert(!shouldGzip("https://amplitude.com./2/httpapi"));
  assert(!shouldGzip("https://-api.amplitude.com/2/httpapi"));
  assert(!shouldGzip("https://api-.amplitude.com/2/httpapi"));
  assert(!shouldGzip("https://api_2.amplitude.com/2/httpapi"));
  assert(!shouldGzip("https://api\xc3\xa9.amplitude.com/2/httpapi"));
  assert(!shouldGzip(std::string("https://api\0.amplitude.com/2/httpapi", 36)));
  assert(!shouldGzip("https://[::1]/2/httpapi"));
  assert(!shouldGzip("https://" + std::string(64, 'a') + ".amplitude.com/2/httpapi"));
  assert(shouldGzip("https://" + std::string(63, 'a') + ".amplitude.com/2/httpapi"));
  std::string longHost;
  while (longHost.size() < 250) {
    longHost += "abcdefgh.";
  }
  assert(!shouldGzip("https://" + longHost + "amplitude.com/2/httpapi"));

  const std::string url = "https://api2.amplitude.com/2/httpapi";
  assert(::NitroAmplitude::shouldGzipAmplitudeRequest(url, "POST", {{"content-encoding", ""}}, large));
  assert(!::NitroAmplitude::shouldGzipAmplitudeRequest(url, "POST", {{"CONTENT-ENCODING", "identity"}}, large));
  assert(!::NitroAmplitude::shouldGzipAmplitudeRequest(url, "", {}, large));
  assert(!::NitroAmplitude::shouldGzipAmplitudeRequest(url, "POST", {}, ""));
}

void testWorkerForwardsHttpOutcomesVerbatim() {
  auto adapter = std::make_shared<ScriptedHttpAdapter>();
  CompletionLog log;
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  auto removeThrowing = worker->addOnComplete(
      [](const std::string&, double, const std::string&, const std::string&) {
        throw std::runtime_error("listener failure");
      });
  auto removeListener = worker->addOnComplete(log.listener());

  const std::vector<std::string> statuses = {"204", "400", "401", "408", "413", "429", "500", "502", "503", "504"};
  for (const auto& status : statuses) {
    worker->enqueue("status-" + status, "https://collector.test/status/" + status, "POST", {}, "{}", 1000);
  }
  const std::vector<std::string> errors = {"timeout", "network_error", "cancelled", "invalid_http_response", "invalid_url"};
  for (const auto& error : errors) {
    worker->enqueue("error-" + error, "https://collector.test/error/" + error, "POST", {}, "{}", 1000);
  }
  worker->enqueue("throw-std", "https://collector.test/throw", "POST", {}, "{}", 1000);
  worker->enqueue("throw-int", "https://collector.test/throw-int", "POST", {}, "{}", 1000);
  worker->enqueue("throw-bad-alloc", "https://collector.test/throw-bad-alloc", "POST", {}, "{}", 1000);
  worker->enqueue("ok-after-failures", "https://collector.test/ok", "POST", {}, "{}", 1000);

  const size_t expected = statuses.size() + errors.size() + 4;
  assert(log.waitForCount(expected));
  for (const auto& status : statuses) {
    const Completion completion = log.only("status-" + status);
    assert(completion.statusCode == std::stod(status));
    assert(completion.body == "body-" + status);
    assert(completion.error.empty());
  }
  for (const auto& error : errors) {
    const Completion completion = log.only("error-" + error);
    assert(completion.statusCode == 0);
    assert(completion.body.empty());
    assert(completion.error == error);
  }
  for (const std::string id : {"throw-std", "throw-int", "throw-bad-alloc"}) {
    const Completion completion = log.only(id);
    assert(completion.statusCode == 0);
    assert(completion.body.empty());
    assert(completion.error == "native_http_exception");
  }
  const Completion ok = log.only("ok-after-failures");
  assert(ok.statusCode == 200 && ok.error.empty());
  assert(log.entries().size() == expected);
  assert(worker->queueSize() == 0);
  assert(worker->pendingBodyBytes() == 0);
  removeListener();
  removeThrowing();
  removeListener();
}

void testWorkerTimeoutNumericBoundaries() {
  auto adapter = std::make_shared<ScriptedHttpAdapter>();
  CompletionLog log;
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  auto removeListener = worker->addOnComplete(log.listener());

  const std::vector<std::pair<double, int>> cases = {
      {std::numeric_limits<double>::quiet_NaN(), 10000},
      {std::numeric_limits<double>::infinity(), 10000},
      {-std::numeric_limits<double>::infinity(), 10000},
      {-5.0, 10000},
      {-0.5, 10000},
      {0.0, 10000},
      {-0.0, 10000},
      {std::numeric_limits<double>::denorm_min(), 1},
      {0.0001, 1},
      {1.0, 1},
      {1.5, 2},
      {299999.2, 300000},
      {300000.0, 300000},
      {300000.5, 300000},
      {2147483647.0, 300000},
      {2147483648.0, 300000},
      {4294967296.0, 300000},
      {1700000000000.0, 300000},
      {1e300, 300000},
      {std::numeric_limits<double>::max(), 300000},
  };
  for (size_t i = 0; i < cases.size(); ++i) {
    worker->enqueue(
        "timeout-" + std::to_string(i),
        "https://collector.test/timeout/" + std::to_string(i),
        "GET",
        {},
        "",
        cases[i].first);
  }
  assert(log.waitForCount(cases.size()));
  for (size_t i = 0; i < cases.size(); ++i) {
    const auto request = adapter->request("https://collector.test/timeout/" + std::to_string(i));
    assert(request.timeoutMillis == cases[i].second);
  }

  assert(throwsRuntimeError(
      [&]() { worker->enqueue("", "https://collector.test/ok", "GET", {}, "", 1000); },
      "NitroAmplitude: Invalid HTTP request"));
  assert(throwsRuntimeError(
      [&]() { worker->enqueue("id", "", "GET", {}, "", 1000); },
      "NitroAmplitude: Invalid HTTP request"));
  assert(log.entries().size() == cases.size());
  removeListener();
}

void testWorkerGzipsAmplitudeBodies() {
  auto adapter = std::make_shared<ScriptedHttpAdapter>();
  CompletionLog log;
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  auto removeListener = worker->addOnComplete(log.listener());

  std::string json;
  while (json.size() < 64 * 1024) {
    json += "{\"event_type\":\"screen_view\",\"user_id\":\"user-1\"},";
  }
  const std::string random = pseudoRandomBytes(4096, 99);
  const std::string binary = std::string("\0\xff\xfe\xc3\x28", 5) + std::string(2048, '\0');
  const std::unordered_map<std::string, std::string> headers = {{"Content-Type", "application/json"}};

  worker->enqueue("gzip", "https://api2.amplitude.com/2/httpapi", "POST", headers, json, 1000);
  worker->enqueue("random", "https://api.eu.amplitude.com/2/httpapi", "POST", headers, random, 1000);
  worker->enqueue("custom", "https://collector.test/2/httpapi", "POST", headers, json, 1000);
  worker->enqueue(
      "encoded",
      "https://api2.amplitude.com/batch",
      "POST",
      {{"content-encoding", "identity"}},
      json,
      1000);
  worker->enqueue("binary", "https://collector.test/binary", "POST", {}, binary, 1000);
  assert(log.waitForCount(5));

  const auto gzip = adapter->request("https://api2.amplitude.com/2/httpapi");
  assert(gzip.headers.at("Content-Encoding") == "gzip");
  assert(gzip.headers.at("Content-Type") == "application/json");
  assert(gzip.body.size() < json.size());
  assert(gunzip(gzip.body).value_or("") == json);

  const auto incompressible = adapter->request("https://api.eu.amplitude.com/2/httpapi");
  assert(incompressible.headers.count("Content-Encoding") == 0);
  assert(incompressible.body == random);

  const auto custom = adapter->request("https://collector.test/2/httpapi");
  assert(custom.headers.count("Content-Encoding") == 0);
  assert(custom.body == json);

  const auto encoded = adapter->request("https://api2.amplitude.com/batch");
  assert(encoded.headers.size() == 1);
  assert(encoded.headers.at("content-encoding") == "identity");
  assert(encoded.body == json);

  assert(adapter->request("https://collector.test/binary").body == binary);
  assert(worker->pendingBodyBytes() == 0);
  removeListener();
}

void testWorkerTeardownDuringInFlightRequests() {
  auto adapter = std::make_shared<ScriptedHttpAdapter>();
  CompletionLog log;
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  auto removeListener = worker->addOnComplete(log.listener());
  adapter->setGate(false);

  worker->enqueue("in-flight-0", "https://collector.test/a", "POST", {}, "a", 1000);
  worker->enqueue("in-flight-1", "https://collector.test/b", "POST", {}, "b", 1000);
  assert(adapter->waitForEntered(2));
  constexpr size_t queued = 20;
  for (size_t i = 0; i < queued; ++i) {
    worker->enqueue(
        "queued-" + std::to_string(i),
        "https://collector.test/q" + std::to_string(i),
        "POST",
        {{"x", "y"}},
        std::string(128, 'q'),
        1000);
  }
  assert(worker->queueSize() == queued);

  std::thread destroyer([&worker]() { worker.reset(); });
  adapter->setGate(true);
  destroyer.join();

  const auto entries = log.entries();
  assert(entries.size() == queued + 2);
  assert(log.only("in-flight-0").statusCode == 200);
  assert(log.only("in-flight-1").statusCode == 200);
  for (size_t i = 0; i < queued; ++i) {
    const Completion completion = log.only("queued-" + std::to_string(i));
    const bool delivered = completion.statusCode == 200 && completion.error.empty();
    const bool cancelled = completion.statusCode == 0 && completion.error == "cancelled";
    assert(delivered || cancelled);
  }
  removeListener();
}

void testWorkerUnsubscribeAfterDestroyIsSafe() {
  auto adapter = std::make_shared<ScriptedHttpAdapter>();
  CompletionLog log;
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  auto removeFirst = worker->addOnComplete(log.listener());
  auto removeSecond = worker->addOnComplete(log.listener());
  worker->enqueue("before-destroy", "https://collector.test/ok", "GET", {}, "", 1000);
  assert(log.waitForCount(2));
  removeFirst();
  worker.reset();
  removeFirst();
  removeSecond();
  removeSecond();
  assert(log.entries().size() == 2);
}

void testWorkerConcurrentEnqueueFromManyThreads() {
  auto adapter = std::make_shared<ScriptedHttpAdapter>();
  CompletionLog log;
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  auto removeListener = worker->addOnComplete(log.listener());

  constexpr int threadCount = 12;
  constexpr int perThread = 60;
  std::atomic<size_t> accepted = 0;
  std::atomic<size_t> rejected = 0;
  std::atomic<size_t> unexpected = 0;
  std::atomic<bool> stopObservers = false;
  std::vector<std::thread> threads;
  for (int t = 0; t < threadCount; ++t) {
    threads.emplace_back([&, t]() {
      for (int i = 0; i < perThread; ++i) {
        const std::string id = "t" + std::to_string(t) + "-" + std::to_string(i);
        try {
          worker->enqueue(id, "https://collector.test/" + id, "POST", {{"h", "v"}}, id, 1000);
          ++accepted;
        } catch (const std::runtime_error& error) {
          if (std::string(error.what()) == "NitroAmplitude: queue_full") {
            ++rejected;
          } else {
            ++unexpected;
          }
        }
      }
    });
  }
  std::vector<std::thread> observers;
  for (int t = 0; t < 3; ++t) {
    observers.emplace_back([&]() {
      while (!stopObservers.load()) {
        auto remove = worker->addOnComplete(
            [](const std::string&, double, const std::string&, const std::string&) {});
        if (worker->queueSize() > 100 || worker->inFlightCount() > 2) {
          ++unexpected;
        }
        worker->pendingBodyBytes();
        worker->getExternalMemorySize();
        worker->cancel("never-enqueued");
        remove();
        std::this_thread::yield();
      }
    });
  }
  for (auto& thread : threads) {
    thread.join();
  }
  assert(log.waitForCount(accepted.load()));
  stopObservers = true;
  for (auto& thread : observers) {
    thread.join();
  }

  assert(unexpected == 0);
  assert(accepted + rejected == static_cast<size_t>(threadCount * perThread));
  assert(accepted > 0);
  worker.reset();
  const auto entries = log.entries();
  assert(entries.size() == accepted.load());
  std::set<std::string> seen;
  for (const auto& entry : entries) {
    assert(seen.insert(entry.requestId).second);
    assert(entry.statusCode == 200 && entry.error.empty());
  }
  removeListener();
}

void testWorkerListenerReentrancyDoesNotDeadlock() {
  auto adapter = std::make_shared<ScriptedHttpAdapter>();
  CompletionLog log;
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  HybridAmplitudeWorker* rawWorker = worker.get();
  std::atomic<int> reentrantCalls = 0;
  auto removeSelf = std::make_shared<std::function<void()>>();

  *removeSelf = worker->addOnComplete(
      [&, rawWorker, removeSelf](const std::string& requestId, double, const std::string&, const std::string&) {
        ++reentrantCalls;
        if (requestId != "first") {
          return;
        }
        rawWorker->enqueue("second", "https://collector.test/second", "GET", {}, "", 1000);
        rawWorker->enqueue("third", "https://collector.test/third", "GET", {}, "", 1000);
        rawWorker->cancel("third");
        rawWorker->cancel("first");
        rawWorker->queueSize();
        rawWorker->inFlightCount();
        (*removeSelf)();
        (*removeSelf)();
      });
  auto removeListener = worker->addOnComplete(log.listener());

  worker->enqueue("first", "https://collector.test/first", "GET", {}, "", 1000);
  assert(log.waitForCount(3));
  assert(log.only("first").statusCode == 200);
  assert(log.only("second").statusCode == 200);
  const Completion third = log.only("third");
  assert((third.statusCode == 200 && third.error.empty()) || third.error == "cancelled");
  worker.reset();
  assert(reentrantCalls >= 1 && reentrantCalls <= 3);
  *removeSelf = nullptr;
  removeListener();
}

void testWorkerThreadStartFailureIsRecoverable() {
  auto adapter = std::make_shared<ScriptedHttpAdapter>();
  for (int failAt = 0; failAt < 2; ++failAt) {
    int started = 0;
    bool threw = false;
    try {
      HybridAmplitudeWorker worker(adapter, [&](std::function<void()> body) {
        if (started == failAt) {
          throw std::system_error(
              std::make_error_code(std::errc::resource_unavailable_try_again), "thread");
        }
        ++started;
        return std::thread(std::move(body));
      });
    } catch (const std::system_error&) {
      threw = true;
    }
    assert(threw);
    assert(started == failAt);
  }

  CompletionLog log;
  int started = 0;
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter, [&](std::function<void()> body) {
    ++started;
    return std::thread(std::move(body));
  });
  auto removeListener = worker->addOnComplete(log.listener());
  worker->enqueue("after-failure", "https://collector.test/ok", "GET", {}, "", 1000);
  assert(log.waitForCount(1));
  assert(log.only("after-failure").statusCode == 200);
  assert(started == 2);
  worker.reset();
  removeListener();
}

void testWorkerQueueByteBound() {
  auto adapter = std::make_shared<ScriptedHttpAdapter>();
  CompletionLog log;
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  auto removeListener = worker->addOnComplete(log.listener());
  adapter->setGate(false);

  constexpr size_t megabyte = 1024 * 1024;
  const std::string huge(72 * megabyte, 'h');
  worker->enqueue("in-flight-0", "https://collector.test/a", "POST", {}, "a", 1000);
  assert(adapter->waitForEntered(1));
  worker->enqueue("in-flight-1", "https://collector.test/b", "POST", {}, "b", 1000);
  assert(adapter->waitForEntered(2));

  worker->enqueue("first-queued", "https://collector.test/q0", "POST", {}, huge, 1000);
  assert(worker->queueSize() == 1);
  assert(throwsRuntimeError(
      [&]() { worker->enqueue("over", "https://collector.test/over", "POST", {}, "x", 1000); },
      "NitroAmplitude: queue_full"));
  assert(worker->queueSize() == 1);
  assert(worker->pendingBodyBytes() == static_cast<double>(huge.size()));

  adapter->setGate(true);
  assert(log.waitForCount(3));
  adapter->setGate(false);
  const std::string chunk(8 * megabyte, 'c');
  worker->enqueue("in-flight-2", "https://collector.test/c", "POST", {}, "c", 1000);
  assert(adapter->waitForEntered(4));
  worker->enqueue("in-flight-3", "https://collector.test/d", "POST", {}, "d", 1000);
  assert(adapter->waitForEntered(5));
  for (int i = 0; i < 8; ++i) {
    worker->enqueue("chunk-" + std::to_string(i), "https://collector.test/chunk", "POST", {}, chunk, 1000);
  }
  assert(worker->pendingBodyBytes() == static_cast<double>(64 * megabyte));
  assert(throwsRuntimeError(
      [&]() { worker->enqueue("over", "https://collector.test/over", "POST", {{"h", "v"}}, "", 1000); },
      "NitroAmplitude: queue_full"));
  assert(worker->queueSize() == 8);

  adapter->setGate(true);
  assert(log.waitForCount(13));
  worker->enqueue("after", "https://collector.test/after", "POST", {}, "x", 1000);
  assert(log.waitForCount(14));
  assert(adapter->requestCount("https://collector.test/over") == 0);
  worker.reset();
  removeListener();
}

void testWorkerNormalizesMethodsForBothPlatforms() {
  auto adapter = std::make_shared<ScriptedHttpAdapter>();
  CompletionLog log;
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  auto removeListener = worker->addOnComplete(log.listener());

  const std::vector<std::string> rejected = {"", "PO ST", "POST ", " POST", "PO\tST", "POST\r\nX: y", "\xff\xfe", "P\xc3\x96ST", std::string("PO\0ST", 5)};
  for (size_t i = 0; i < rejected.size(); ++i) {
    const std::string id = "rejected-" + std::to_string(i);
    worker->enqueue(id, "https://collector.test/" + id, rejected[i], {}, "body", 1000);
  }
  const std::vector<std::string> accepted = {
      "GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS", "TRACE", "PATCH", "CONNECT",
      "get", "Head", "post", "pAtCh", "x-custom_1"};
  for (const auto& method : accepted) {
    worker->enqueue("accepted-" + method, "https://collector.test/accepted-" + method, method, {}, "body", 1000);
  }
  assert(log.waitForCount(rejected.size() + accepted.size()));

  for (size_t i = 0; i < rejected.size(); ++i) {
    const std::string id = "rejected-" + std::to_string(i);
    const Completion completion = log.only(id);
    assert(completion.statusCode == 0);
    assert(completion.body.empty());
    assert(completion.error == "network_error");
    assert(adapter->requestCount("https://collector.test/" + id) == 0);
  }
  for (const auto& method : accepted) {
    const Completion completion = log.only("accepted-" + method);
    assert(completion.statusCode == 200 && completion.error.empty());
    const auto request = adapter->request("https://collector.test/accepted-" + method);
    std::string upper = method;
    std::transform(upper.begin(), upper.end(), upper.begin(), [](unsigned char character) {
      return static_cast<char>(std::toupper(character));
    });
    assert(request.method == upper);
    const bool carriesBody = upper != "GET" && upper != "HEAD";
    assert(request.body == (carriesBody ? "body" : ""));
  }
  assert(worker->inFlightCount() == 0);
  removeListener();
}

void testWorkerQueueCapWithLargeBodies() {
  auto adapter = std::make_shared<ScriptedHttpAdapter>();
  CompletionLog log;
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  auto removeListener = worker->addOnComplete(log.listener());
  adapter->setGate(false);

  const std::string body(256 * 1024, 'e');
  worker->enqueue("in-flight-0", "https://collector.test/a", "POST", {}, body, 1000);
  worker->enqueue("in-flight-1", "https://collector.test/b", "POST", {}, body, 1000);
  assert(adapter->waitForEntered(2));
  for (int i = 0; i < 100; ++i) {
    worker->enqueue("queued-" + std::to_string(i), "https://collector.test/q", "POST", {{"k", "v"}}, body, 1000);
  }
  assert(worker->queueSize() == 100);
  assert(worker->inFlightCount() == 2);
  assert(worker->pendingBodyBytes() == 100.0 * static_cast<double>(body.size() + 2));
  assert(worker->getExternalMemorySize() == 100 * (body.size() + 2));
  for (int i = 0; i < 5; ++i) {
    assert(throwsRuntimeError(
        [&]() { worker->enqueue("overflow", "https://collector.test/q", "POST", {}, body, 1000); },
        "NitroAmplitude: queue_full"));
  }
  assert(worker->queueSize() == 100);
  assert(worker->pendingBodyBytes() == 100.0 * static_cast<double>(body.size() + 2));

  adapter->setGate(true);
  assert(log.waitForCount(102));
  worker.reset();
  assert(log.entries().size() == 102);
  removeListener();
}

int main() {
  testStorage();
  testStorageAdapterContract();
  testSegmentStoreRotation();
  testSegmentStoreCompactsSupersededRecords();
  testSegmentStoreCompactionWriteFailurePreservesData();
  testSegmentStoreTruncatedTailRecovery();
  testSegmentStoreIndexConsistency();
  testSegmentStoreEscapingRoundTrip();
  testSegmentStoreMigration();
  testSegmentStoreWriteFailure();
  testSegmentStoreRotatedOverwriteFailurePreservesValue();
  testSegmentStoreLastLiveOverwriteFailurePreservesValue();
  testSegmentStoreTornOverwriteAppendRecovery();
  testSegmentStoreFailedTornTailTrimRetiresSegment();
  testSegmentStoreOverwriteCompactionFailurePreservesValues();
  testSegmentStoreTombstoneReload();
  testSegmentStoreCrossSegmentTombstoneSurvivesCompaction();
  testSegmentStoreCompactionReadFailurePreservesLiveKeys();
  testSegmentStoreCompactionDropsTombstonesWithoutLowerSegments();
  testSegmentStoreUnreadableSegmentStaysConservative();
  testGzipAmplitudePayloads();
  testGzipAmplitudeAuthorityValidation();
  testContextFallbacks();
  testContextAdapterContract();
  testWorkerFallbacks();
  testWorkerAdapterContract();
  testWorkerAdapterException();
  testWorkerSameIdQueuedCancellation();
  testWorkerSameIdInFlightCancellation();
  testWorkerSameIdLateCancelAndReuse();
  testWorkerBoundedConcurrency();
  testWorkerCancellationOfQueuedRequest();
  testWorkerLateCancelDoesNotAffectLaterRequests();
  testWorkerListenerReentrancy();
  testWorkerQueueSizeMetrics();
  testPosixFileAdapterContract();
  testPosixDiskFullKeepsCommittedRecords();
  testPosixDiskFullDeleteKeepsRecord();
  testPosixDiskFullDuringRotationDoesNotBurnSegmentIds();
  testPosixLoadReclaimsEmptySegments();
  testPosixReopenWhileDiskIsFull();
  testPosixMigrationUnderDiskFullRetriesWithoutDuplicates();
  testLegacyDiskMigrationResumesWithoutResurrectingKeys();
  testSegmentStoreMigrationInterruptedMidway();
  testPosixPermissionDenied();
  testPosixDirectoryRemovedWhileRunning();
  testPosixCrashRestartAtEveryByteOfLastRecord();
  testPosixCorruptRecordsAreIsolated();
  testPosixSegmentChangedUnderneathReturnsMissing();
  testPosixEmptyAndForeignFilesAreIgnored();
  testPosixInterruptedCompactionLeavesNoTemporaryFiles();
  testPosixHugeAndBinaryValuesRoundTrip();
  testPosixRepeatedOverwritesStayBounded();
  testPosixBoundedKeySetKeepsDiskBounded();
  testPosixConcurrentCallers();
  testSegmentStoreFailedAppendLeavesStoreUnchanged();
  testSegmentStoreFailedRestoreRetiresSegment();
  testSegmentStoreRecoversFromDirectoryLoss();
  testSegmentStoreReloadAfterLossHonoursUnreadableMaxSegment();
  testPosixRollbackOnShortenedSegmentRetiresIt();
  testSegmentStoreKeepsIndexWhenDirectoryCheckFails();
  testSegmentStoreIsReadyWhenListingSucceeds();
  testPosixEnsureDirectoryToleratesAncestorErrors();
  testPosixPartialDirectoryListingIsAnError();
  testSegmentStoreOpenFailuresRetireAtMostOneSegment();
  testPosixUnwritableSegmentRetiresOneId();
  testSegmentStoreKeepsIndexWhenListingFails();
  testSegmentStoreLoadKeepsSegmentsItCannotRemove();
  testSegmentStoreLoadsWhenDirectoryBecomesAvailable();
  testSegmentStoreRecordSizeLimit();
  testSegmentStoreRejectsReservedKey();
  testSegmentStoreReclaimsTombstoneOnlySegments();
  testPosixTombstoneNeverMovesAcrossUnreadableSegment();
  testSegmentStoreTombstoneStaysBelowPartiallyReadSegments();
  testSegmentStoreReplayMatchesReferenceUnderUnreadableSegments();
  testSegmentStoreRejectsSegmentIdsAboveUint32();
  testSegmentStoreRemovesStaleTemporaryFiles();
  testSegmentStoreMaxSegmentIdDisablesAppends();
  testSegmentStoreRemoveFailureKeepsDeletionDurable();
  testSegmentStoreCompactionSkipsSegmentChangedUnderneath();
  testSegmentStoreReadFailureAndAllocatorFailure();
  testStorageErrorContract();
  testStorageHostileInput();
  testContextErrorContract();
  testContextEventIdNumericBoundaries();
  testGzipInputBoundaries();
  testGzipAuthorityEdgeCases();
  testWorkerForwardsHttpOutcomesVerbatim();
  testWorkerTimeoutNumericBoundaries();
  testWorkerGzipsAmplitudeBodies();
  testWorkerTeardownDuringInFlightRequests();
  testWorkerUnsubscribeAfterDestroyIsSafe();
  testWorkerConcurrentEnqueueFromManyThreads();
  testWorkerListenerReentrancyDoesNotDeadlock();
  testWorkerThreadStartFailureIsRecoverable();
  testWorkerQueueByteBound();
  testWorkerNormalizesMethodsForBothPlatforms();
  testWorkerQueueCapWithLargeBodies();

  std::cout << "HybridAmplitudeStorage tests passed" << std::endl;
  std::cout << "HybridAmplitudeContext tests passed" << std::endl;
  std::cout << "HybridAmplitudeWorker tests passed" << std::endl;
  return 0;
}
