#pragma once

#include "FileAdapter.hpp"

#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <vector>

namespace NitroAmplitude {

class PosixFileAdapter : public FileAdapter {
public:
  bool ensureDirectory(const std::string& directory) override {
    if (directory.empty()) {
      return false;
    }
    std::string partial;
    partial.reserve(directory.size());
    size_t index = 0;
    while (index <= directory.size()) {
      const size_t next = directory.find('/', index);
      const size_t end = next == std::string::npos ? directory.size() : next;
      partial.append(directory, index, end - index);
      if (!partial.empty() && mkdir(partial.c_str(), kDirectoryMode) != 0 && errno != EEXIST) {
        return false;
      }
      if (next == std::string::npos) {
        break;
      }
      partial += '/';
      index = next + 1;
    }
    return true;
  }

  std::vector<std::string> listFiles(const std::string& directory) override {
    std::vector<std::string> names;
    DIR* dir = opendir(directory.c_str());
    if (dir == nullptr) {
      return names;
    }
    while (const dirent* entry = readdir(dir)) {
      if (std::strcmp(entry->d_name, ".") == 0 || std::strcmp(entry->d_name, "..") == 0) {
        continue;
      }
      names.emplace_back(entry->d_name);
    }
    closedir(dir);
    std::sort(names.begin(), names.end());
    return names;
  }

  std::optional<std::string> readFile(const std::string& path) override {
    const int fd = open(path.c_str(), O_RDONLY);
    if (fd < 0) {
      return std::nullopt;
    }
    std::string content;
    char buffer[4096];
    ssize_t chunk;
    while ((chunk = read(fd, buffer, sizeof(buffer))) > 0) {
      content.append(buffer, static_cast<size_t>(chunk));
    }
    const bool failed = chunk < 0;
    close(fd);
    if (failed) {
      return std::nullopt;
    }
    return content;
  }

  std::optional<std::string> readRange(
      const std::string& path,
      uint64_t offset,
      uint64_t length) override {
    if (length == 0) {
      return std::string();
    }
    const int fd = open(path.c_str(), O_RDONLY);
    if (fd < 0) {
      return std::nullopt;
    }
    std::string content;
    content.resize(static_cast<size_t>(length));
    size_t total = 0;
    while (total < content.size()) {
      const ssize_t chunk = pread(
          fd,
          content.data() + total,
          content.size() - total,
          static_cast<off_t>(offset + total));
      if (chunk <= 0) {
        break;
      }
      total += static_cast<size_t>(chunk);
    }
    close(fd);
    if (total == 0) {
      return std::nullopt;
    }
    content.resize(total);
    return content;
  }

  bool appendFile(const std::string& path, const std::string& data) override {
    const int fd = open(path.c_str(), O_WRONLY | O_APPEND | O_CREAT, kFileMode);
    if (fd < 0) {
      return false;
    }
    const bool ok = WriteAll(fd, data);
    close(fd);
    return ok;
  }

  bool writeFile(const std::string& path, const std::string& data) override {
    std::string temporaryPath = path + ".tmp.XXXXXX";
    std::vector<char> temporaryPathBuffer(temporaryPath.begin(), temporaryPath.end());
    temporaryPathBuffer.push_back('\0');
    const int fd = mkstemp(temporaryPathBuffer.data());
    if (fd < 0) {
      return false;
    }
    bool ok = WriteAll(fd, data);
    if (ok && fsync(fd) != 0) {
      ok = false;
    }
    if (close(fd) != 0) {
      ok = false;
    }
    if (!ok || rename(temporaryPathBuffer.data(), path.c_str()) != 0) {
      unlink(temporaryPathBuffer.data());
      return false;
    }
    return true;
  }

  bool removeFile(const std::string& path) override {
    if (unlink(path.c_str()) == 0) {
      return true;
    }
    return errno == ENOENT;
  }

private:
  static constexpr mode_t kDirectoryMode = 0700;
  static constexpr mode_t kFileMode = 0600;

  static bool WriteAll(int fd, const std::string& data) {
    size_t written = 0;
    while (written < data.size()) {
      const ssize_t chunk = write(fd, data.data() + written, data.size() - written);
      if (chunk < 0) {
        if (errno == EINTR) {
          continue;
        }
        return false;
      }
      if (chunk == 0) {
        return false;
      }
      written += static_cast<size_t>(chunk);
    }
    return true;
  }
};

} // namespace NitroAmplitude
