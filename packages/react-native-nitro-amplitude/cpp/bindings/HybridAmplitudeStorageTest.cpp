#include "../../nitrogen/generated/shared/c++/HybridAmplitudeStorageSpec.hpp"
#include "../../cpp/bindings/HybridAmplitudeStorage.hpp"

#include <cassert>
#include <iostream>

using margelo::nitro::NitroAmplitude::HybridAmplitudeStorage;

int main() {
  auto storage = std::make_shared<HybridAmplitudeStorage>();

  storage->set("alpha", "1", false);
  storage->set("beta", "2", false);

  assert(storage->has("alpha", false));
  assert(storage->get("alpha", false).value_or("") == "1");
  assert(storage->getBatch({"alpha", "beta", "missing"}, false).size() == 3);

  storage->removeBatch({"alpha", "beta"}, false);
  assert(!storage->has("alpha", false));
  assert(storage->getAllKeys(false).empty());

  std::cout << "HybridAmplitudeStorage tests passed" << std::endl;
  return 0;
}
