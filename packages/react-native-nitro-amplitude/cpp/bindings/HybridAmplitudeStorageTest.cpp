#include "../../nitrogen/generated/shared/c++/HybridAmplitudeStorageSpec.hpp"
#include "../../nitrogen/generated/shared/c++/HybridAmplitudeContextSpec.hpp"
#include "../../nitrogen/generated/shared/c++/HybridAmplitudeWorkerSpec.hpp"
#include "../../cpp/bindings/HybridAmplitudeContext.hpp"
#include "../../cpp/bindings/HybridAmplitudeStorage.hpp"
#include "../../cpp/bindings/HybridAmplitudeWorker.hpp"
#include "../../cpp/core/ContextAdapter.hpp"
#include "../../cpp/core/FileAdapter.hpp"
#include "../../cpp/core/HttpAdapter.hpp"
#include "../../cpp/core/JsonlSegmentStore.hpp"
#include "../../cpp/core/StorageAdapter.hpp"

#include <cassert>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <iostream>
#include <limits>
#include <map>
#include <mutex>
#include <stdexcept>
#include <string>
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
  bool failWrites = false;
  bool failReads = false;

  bool ensureDirectory(const std::string&) override {
    return true;
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

  std::optional<std::string> readFile(const std::string& path) override {
    if (failReads) {
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
    files[path] += data;
    return true;
  }

  bool writeFile(const std::string& path, const std::string& data) override {
    if (failWrites) {
      return false;
    }
    files[path] = data;
    return true;
  }

  bool removeFile(const std::string& path) override {
    return files.erase(path) > 0;
  }
};

class FakeHttpAdapter : public HttpAdapter {
public:
  std::mutex gateMutex;
  std::condition_variable gateCv;
  bool gateOpen = true;
  int requestCount = 0;

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
    if (requestCount.fetch_add(1) == 0) {
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

static bool waitUntil(const std::function<bool()>& predicate, int attempts = 200) {
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

  files->failWrites = true;
  store.deleteDisk("remove");

  assert(store.hasDisk("remove"));
  assert(store.getDisk("remove").value_or("") == "remove-value");
  assert(store.getDisk("keep").value_or("") == "keep-value");

  JsonlSegmentStore afterFailedDelete(files, "compact-failure", 4096);
  assert(afterFailedDelete.hasDisk("remove"));
  assert(afterFailedDelete.getDisk("remove").value_or("") == "remove-value");

  files->failWrites = false;
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
  bool receivedUnavailable = false;

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

  assert(waitUntil([&]() { return receivedUnavailable; }));
  assert(worker->queueSize() == 0);
  assert(worker->inFlightCount() == 0);
  assert(worker->pendingBodyBytes() == 0);
  removeListener();
}

void testWorkerAdapterContract() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);

  bool okReceived = false;
  bool errorReceived = false;
  bool statusReceived = false;
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

  std::string thrownError = "unset";
  bool recovered = false;
  auto removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double statusCode, const std::string&, const std::string& error) {
        if (requestId == "throws") {
          thrownError = error;
        } else if (requestId == "after") {
          recovered = statusCode == 200 && error.empty();
        }
      });

  worker->enqueue("throws", "https://example.com", "GET", {}, "", 1000);
  worker->enqueue("after", "https://example.com", "GET", {}, "after", 1000);

  assert(waitUntil([&]() { return thrownError != "unset" && recovered; }));
  assert(thrownError == "native_http_exception");
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
  worker->enqueue("same-queued", "https://example.com", "GET", {}, "first", 1000);
  worker->enqueue("same-queued", "https://example.com", "GET", {}, "second", 1000);
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

  worker->enqueue("same-in-flight", "https://example.com", "GET", {}, "first", 1000);
  worker->enqueue("blocker", "https://example.com", "GET", {}, "blocker", 1000);
  assert(waitUntil([&]() { return worker->inFlightCount() == 2; }));
  worker->enqueue("same-in-flight", "https://example.com", "GET", {}, "second", 1000);
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

  worker->enqueue("same-late", "https://example.com", "GET", {}, "first", 1000);
  assert(waitUntil([&]() {
    std::lock_guard<std::mutex> lock(resultMutex);
    return successBodies.size() == 1;
  }));
  worker->cancel("same-late");
  worker->enqueue("same-late", "https://example.com", "GET", {}, "second", 1000);
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

  std::string cancelledError = "unset";
  std::string afterError = "unset";
  auto removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double, const std::string&, const std::string& error) {
        if (requestId == "cancelled") {
          cancelledError = error;
        } else if (requestId == "after") {
          afterError = error;
        }
      });

  adapter->openGate();

  assert(waitUntil([&]() { return cancelledError == "cancelled"; }));
  assert(waitUntil([&]() { return afterError == ""; }));
  assert(adapter->requestCount == 3);
  assert(waitUntil([&]() { return worker->inFlightCount() == 0 && worker->queueSize() == 0; }));
  removeListener();
}

void testWorkerLateCancelDoesNotAffectLaterRequests() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);

  bool firstDone = false;
  std::string firstError = "unset";
  auto removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double statusCode, const std::string&, const std::string& error) {
        if (requestId == "late-first") {
          firstDone = statusCode == 200;
          firstError = error;
        }
      });

  worker->enqueue("late-first", "https://example.com", "GET", {}, "", 1000);
  assert(waitUntil([&]() { return firstDone; }));

  worker->cancel("late-first");
  worker->cancel("never-enqueued");

  bool secondDone = false;
  std::string secondError = "unset";
  removeListener();
  removeListener = worker->addOnComplete(
      [&](const std::string& requestId, double statusCode, const std::string&, const std::string& error) {
        if (requestId == "late-second") {
          secondDone = statusCode == 200;
          secondError = error;
        }
      });

  worker->enqueue("late-second", "https://example.com", "GET", {}, "", 1000);
  assert(waitUntil([&]() { return secondDone; }));
  assert(firstError.empty());
  assert(secondError.empty());
  assert(adapter->requestCount == 2);
  assert(worker->inFlightCount() == 0);
  assert(worker->queueSize() == 0);
  removeListener();
}

void testWorkerListenerReentrancy() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  bool outerFired = false;
  bool innerFired = false;

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
  assert(waitUntil([&]() { return outerFired; }));
  worker->enqueue("reentrant-2", "https://example.com", "GET", {}, "", 1000);
  assert(waitUntil([&]() { return innerFired; }));
  removeOuter();
}

void testWorkerQueueSizeMetrics() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  adapter->closeGate();

  worker->enqueue("metric-1", "https://example.com", "GET", {{"x", "1"}}, "body-bytes", 1000);
  worker->enqueue("metric-2", "https://example.com", "GET", {}, "other-bytes", 1000);
  worker->enqueue("metric-3", "https://example.com", "GET", {}, "third-bytes", 1000);
  assert(waitUntil([&]() { return worker->inFlightCount() == 2 && worker->queueSize() == 1; }));
  assert(worker->pendingBodyBytes() > 0);
  assert(worker->getExternalMemorySize() == worker->pendingBodyBytes());

  adapter->openGate();
  assert(waitUntil([&]() { return worker->pendingBodyBytes() == 0 && worker->inFlightCount() == 0; }));
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

  std::cout << "HybridAmplitudeStorage tests passed" << std::endl;
  std::cout << "HybridAmplitudeContext tests passed" << std::endl;
  std::cout << "HybridAmplitudeWorker tests passed" << std::endl;
  return 0;
}
