#include "../../nitrogen/generated/shared/c++/HybridAmplitudeStorageSpec.hpp"
#include "../../nitrogen/generated/shared/c++/HybridAmplitudeContextSpec.hpp"
#include "../../nitrogen/generated/shared/c++/HybridAmplitudeWorkerSpec.hpp"
#include "../../cpp/bindings/HybridAmplitudeContext.hpp"
#include "../../cpp/bindings/HybridAmplitudeStorage.hpp"
#include "../../cpp/bindings/HybridAmplitudeWorker.hpp"
#include "../../cpp/core/ContextAdapter.hpp"
#include "../../cpp/core/HttpAdapter.hpp"
#include "../../cpp/core/StorageAdapter.hpp"

#include <cassert>
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
using NitroAmplitude::HttpAdapter;
using NitroAmplitude::HttpResult;
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

static bool waitUntil(const std::function<bool()>& predicate, int attempts = 200) {
  for (int i = 0; i < attempts; ++i) {
    if (predicate()) {
      return true;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  return predicate();
}

static bool waitForCompletion(
    HybridAmplitudeWorker& worker,
    const std::string& requestId,
    std::string& resultError,
    int attempts = 200) {
  bool received = false;
  auto removeListener = worker.addOnComplete(
      [&](const std::string& id, double, const std::string&, const std::string& error) {
        if (id == requestId) {
          received = true;
          resultError = error;
        }
      });
  const bool completed = waitUntil([&]() { return received; }, attempts);
  removeListener();
  return completed;
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

  const auto batch = storage->getBatch({"alpha", "beta", "missing"}, false);
  assert(batch.size() == 3);
  assert(batch[0] == "1");
  assert(batch[1] == "2");
  assert(batch[2] == "__nitro_amplitude_batch_missing__::v1");

  bool mismatchThrown = false;
  try {
    storage->setBatch({"a", "b"}, {"1"}, false);
  } catch (const std::runtime_error&) {
    mismatchThrown = true;
  }
  assert(mismatchThrown);

  storage->removeBatch({"alpha", "beta", "prefix:one", "prefix:two"}, false);
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

void testContextFallbacks() {
  auto context = std::make_shared<HybridAmplitudeContext>();
  context->prefetch();
  assert(context->getApplicationContextJson("{}") == "{}");
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

void testWorkerBoundedConcurrency() {
  auto adapter = std::make_shared<FakeHttpAdapter>();
  auto worker = std::make_shared<HybridAmplitudeWorker>(adapter);
  adapter->closeGate();

  for (int i = 0; i < 102; ++i) {
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
  testContextFallbacks();
  testContextAdapterContract();
  testWorkerFallbacks();
  testWorkerAdapterContract();
  testWorkerBoundedConcurrency();
  testWorkerCancellationOfQueuedRequest();
  testWorkerListenerReentrancy();
  testWorkerQueueSizeMetrics();

  std::cout << "HybridAmplitudeStorage tests passed" << std::endl;
  std::cout << "HybridAmplitudeContext tests passed" << std::endl;
  std::cout << "HybridAmplitudeWorker tests passed" << std::endl;
  return 0;
}
