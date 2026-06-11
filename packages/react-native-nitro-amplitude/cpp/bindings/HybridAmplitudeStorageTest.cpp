#include "../../nitrogen/generated/shared/c++/HybridAmplitudeStorageSpec.hpp"
#include "../../nitrogen/generated/shared/c++/HybridAmplitudeContextSpec.hpp"
#include "../../nitrogen/generated/shared/c++/HybridAmplitudeWorkerSpec.hpp"
#include "../../cpp/bindings/HybridAmplitudeContext.hpp"
#include "../../cpp/bindings/HybridAmplitudeStorage.hpp"
#include "../../cpp/bindings/HybridAmplitudeWorker.hpp"

#include <cassert>
#include <chrono>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <thread>

using margelo::nitro::NitroAmplitude::HybridAmplitudeContext;
using margelo::nitro::NitroAmplitude::HybridAmplitudeStorage;
using margelo::nitro::NitroAmplitude::HybridAmplitudeWorker;

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

void testContextFallbacks() {
  auto context = std::make_shared<HybridAmplitudeContext>();

  context->prefetch();
  assert(context->getApplicationContextJson("{}") == "{}");
  assert(context->getLegacySessionDataJson("default") == "{}");
  assert(context->getLegacyEventsJson("default", "events").empty());

  context->removeLegacyEvent("default", "events", 1);

  bool invalidEventIdThrown = false;
  try {
    context->removeLegacyEvent("default", "events", std::numeric_limits<double>::quiet_NaN());
  } catch (const std::runtime_error&) {
    invalidEventIdThrown = true;
  }
  assert(!invalidEventIdThrown);
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

  for (int i = 0; i < 50 && !receivedUnavailable; ++i) {
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }

  assert(receivedUnavailable);
  assert(worker->queueSize() == 0);
  removeListener();
}

int main() {
  testStorage();
  testContextFallbacks();
  testWorkerFallbacks();

  std::cout << "HybridAmplitudeStorage tests passed" << std::endl;
  std::cout << "HybridAmplitudeContext tests passed" << std::endl;
  std::cout << "HybridAmplitudeWorker tests passed" << std::endl;
  return 0;
}
