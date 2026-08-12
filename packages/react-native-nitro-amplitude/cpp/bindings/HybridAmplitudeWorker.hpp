#pragma once

#include "HybridAmplitudeWorkerSpec.hpp"
#include "../core/HttpAdapter.hpp"
#include <atomic>
#include <condition_variable>
#include <functional>
#include <memory>
#include <mutex>
#include <queue>
#include <string>
#include <unordered_map>
#include <thread>
#include <unordered_set>
#include <vector>

namespace margelo::nitro::NitroAmplitude {

struct WorkerRequest {
  std::string requestId;
  std::string url;
  std::string method;
  std::unordered_map<std::string, std::string> headers;
  std::string body;
  int timeoutMillis = 10000;
};

class HybridAmplitudeWorker : public HybridAmplitudeWorkerSpec {
public:
  HybridAmplitudeWorker();
  explicit HybridAmplitudeWorker(std::shared_ptr<::NitroAmplitude::HttpAdapter> adapter);
  ~HybridAmplitudeWorker() override;

  void enqueue(
      const std::string& requestId,
      const std::string& url,
      const std::string& method,
      const std::unordered_map<std::string, std::string>& headers,
      const std::string& body,
      double timeoutMillis) override;
  void cancel(const std::string& requestId) override;
  std::function<void()> addOnComplete(
      const std::function<void(
          const std::string&,
          double,
          const std::string&,
          const std::string&)>& callback) override;
  double queueSize() override;
  double inFlightCount() override;
  double pendingBodyBytes() override;
  size_t getExternalMemorySize() noexcept override;

private:
  void workerLoop();
  void notifyComplete(
      const std::string& requestId,
      double statusCode,
      const std::string& body,
      const std::string& error);

  std::shared_ptr<::NitroAmplitude::HttpAdapter> adapter_;
  std::vector<std::thread> workerThreads_;
  std::mutex queueMutex_;
  std::condition_variable queueCv_;
  std::queue<WorkerRequest> queue_;
  std::unordered_set<std::string> cancelledRequests_;
  std::atomic<bool> running_{true};
  std::atomic<size_t> queueSize_{0};
  std::atomic<size_t> inFlightCount_{0};
  std::atomic<size_t> pendingBodyBytes_{0};

  std::mutex listenersMutex_;
  struct Listener {
    size_t id;
    std::function<void(const std::string&, double, const std::string&, const std::string&)> callback;
  };
  std::vector<Listener> listeners_;
  size_t nextListenerId_ = 0;
};

} // namespace margelo::nitro::NitroAmplitude
