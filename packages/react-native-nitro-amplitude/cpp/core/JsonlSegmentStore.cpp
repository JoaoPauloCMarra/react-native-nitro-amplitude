#include "JsonlSegmentStore.hpp"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <stdexcept>

namespace NitroAmplitude {

namespace {

constexpr char kSegmentPrefix[] = "segment-";
constexpr char kSegmentSuffix[] = ".jsonl";

void EscapeInto(const std::string& value, std::string& out) {
  out.reserve(out.size() + value.size());
  for (const char c : value) {
    switch (c) {
      case '\\':
        out += "\\\\";
        break;
      case '\t':
        out += "\\t";
        break;
      case '\n':
        out += "\\n";
        break;
      case '\r':
        out += "\\r";
        break;
      default:
        out += c;
    }
  }
}

bool UnescapeInto(const std::string& value, std::string& out) {
  out.clear();
  out.reserve(value.size());
  for (size_t i = 0; i < value.size(); ++i) {
    const char c = value[i];
    if (c != '\\') {
      out += c;
      continue;
    }
    if (i + 1 >= value.size()) {
      return false;
    }
    switch (value[i + 1]) {
      case '\\':
        out += '\\';
        break;
      case 't':
        out += '\t';
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      default:
        return false;
    }
    ++i;
  }
  return true;
}

std::optional<uint32_t> ParseSegmentId(const std::string& name) {
  const size_t prefixLength = std::strlen(kSegmentPrefix);
  const size_t suffixLength = std::strlen(kSegmentSuffix);
  if (name.size() <= prefixLength + suffixLength ||
      name.rfind(kSegmentPrefix, 0) != 0 ||
      name.compare(name.size() - suffixLength, suffixLength, kSegmentSuffix) != 0) {
    return std::nullopt;
  }
  const std::string digits = name.substr(prefixLength, name.size() - suffixLength - prefixLength);
  if (digits.empty() || digits.size() > 10 ||
      digits.find_first_not_of("0123456789") != std::string::npos) {
    return std::nullopt;
  }
  return static_cast<uint32_t>(std::stoul(digits));
}

size_t CompletePrefixLength(const std::string& content) {
  const size_t lastNewline = content.rfind('\n');
  if (lastNewline == std::string::npos) {
    return 0;
  }
  return lastNewline + 1;
}

} // namespace

JsonlSegmentStore::JsonlSegmentStore(
    std::shared_ptr<FileAdapter> fileAdapter,
    std::string directory,
    uint64_t maxSegmentBytes)
    : fileAdapter_(std::move(fileAdapter)),
      directory_(std::move(directory)),
      maxSegmentBytes_(maxSegmentBytes == 0 ? kDefaultMaxSegmentBytes : maxSegmentBytes) {
  Load();
}

void JsonlSegmentStore::Load() {
  fileAdapter_->ensureDirectory(directory_);
  std::vector<uint32_t> segmentIds;
  for (const auto& name : fileAdapter_->listFiles(directory_)) {
    const auto id = ParseSegmentId(name);
    if (id.has_value()) {
      segmentIds.push_back(id.value());
    }
  }
  std::sort(segmentIds.begin(), segmentIds.end());
  for (const uint32_t id : segmentIds) {
    const std::string path = SegmentPath(id);
    const auto content = fileAdapter_->readFile(path);
    if (!content.has_value()) {
      continue;
    }
    const size_t completeBytes = CompletePrefixLength(content.value());
    size_t offset = 0;
    while (offset < completeBytes) {
      const size_t newline = content.value().find('\n', offset);
      const size_t length = newline - offset + 1;
      const size_t tab = content.value().find('\t', offset);
      std::string key;
      std::string value;
      if (tab != std::string::npos && tab < newline &&
          UnescapeInto(content.value().substr(offset, tab - offset), key) &&
          UnescapeInto(content.value().substr(tab + 1, newline - tab - 1), value)) {
        index_[key] = Entry{id, static_cast<uint64_t>(offset), static_cast<uint32_t>(length)};
      }
      offset = newline + 1;
    }
    if (completeBytes < content.value().size()) {
      fileAdapter_->writeFile(path, content.value().substr(0, completeBytes));
    }
    segmentBytes_[id] = completeBytes;
    if (id > activeSegment_) {
      activeSegment_ = id;
    }
  }
  std::unordered_map<uint32_t, uint64_t> liveBytes;
  for (const auto& entry : index_) {
    liveBytes[entry.second.segment] += entry.second.length;
  }
  for (const auto& segment : segmentBytes_) {
    const auto live = liveBytes.find(segment.first);
    const uint64_t liveValue = live == liveBytes.end() ? 0 : live->second;
    segmentDeadBytes_[segment.first] =
        segment.second >= liveValue ? segment.second - liveValue : 0;
  }
}

std::string JsonlSegmentStore::SegmentPath(uint32_t segment) const {
  char name[32];
  std::snprintf(name, sizeof(name), "segment-%08u.jsonl", segment);
  return directory_ + "/" + name;
}

void JsonlSegmentStore::SetLocked(const std::string& key, const std::string& value) {
  std::string line;
  EscapeInto(key, line);
  line += '\t';
  EscapeInto(value, line);
  line += '\n';

  const auto existing = index_.find(key);
  if (existing != index_.end()) {
    const uint32_t previousSegment = existing->second.segment;
    segmentDeadBytes_[previousSegment] += existing->second.length;
    index_.erase(existing);
    if (previousSegment != activeSegment_) {
      CompactSegment(previousSegment);
    }
  }

  RotateIfNeeded(line.size());

  if (!fileAdapter_->appendFile(SegmentPath(activeSegment_), line)) {
    throw std::runtime_error("NitroAmplitude: segment storage append failed");
  }
  const uint64_t offset = segmentBytes_[activeSegment_];
  index_[key] = Entry{activeSegment_, offset, static_cast<uint32_t>(line.size())};
  segmentBytes_[activeSegment_] = offset + line.size();
}

void JsonlSegmentStore::RotateIfNeeded(uint64_t lineLength) {
  const uint64_t bytes = segmentBytes_[activeSegment_];
  if (bytes == 0 || bytes + lineLength <= maxSegmentBytes_) {
    return;
  }
  if (segmentDeadBytes_[activeSegment_] > 0) {
    CompactSegment(activeSegment_);
    if (segmentBytes_[activeSegment_] + lineLength <= maxSegmentBytes_) {
      return;
    }
  }
  activeSegment_ += 1;
  segmentBytes_[activeSegment_] = 0;
  segmentDeadBytes_[activeSegment_] = 0;
}

bool JsonlSegmentStore::CompactSegment(uint32_t segment) {
  std::vector<std::pair<std::string, Entry>> live;
  for (const auto& entry : index_) {
    if (entry.second.segment == segment) {
      live.emplace_back(entry.first, entry.second);
    }
  }
  const std::string path = SegmentPath(segment);
  if (live.empty()) {
    if (!fileAdapter_->removeFile(path)) {
      return false;
    }
    segmentBytes_[segment] = 0;
    segmentDeadBytes_[segment] = 0;
    return true;
  }
  std::sort(live.begin(), live.end(), [](const auto& left, const auto& right) {
    return left.second.offset < right.second.offset;
  });
  std::string rebuilt;
  std::vector<std::string> unreadable;
  std::vector<std::pair<std::string, Entry>> compacted;
  compacted.reserve(live.size());
  for (const auto& entry : live) {
    const auto line =
        fileAdapter_->readRange(path, entry.second.offset, entry.second.length);
    if (!line.has_value() || line->size() != entry.second.length) {
      unreadable.push_back(entry.first);
      continue;
    }
    Entry compactedEntry = entry.second;
    compactedEntry.offset = rebuilt.size();
    rebuilt += line.value();
    compacted.emplace_back(entry.first, compactedEntry);
  }
  if (!fileAdapter_->writeFile(path, rebuilt)) {
    return false;
  }
  for (const auto& entry : compacted) {
    index_[entry.first] = entry.second;
  }
  for (const auto& key : unreadable) {
    index_.erase(key);
  }
  segmentBytes_[segment] = rebuilt.size();
  segmentDeadBytes_[segment] = 0;
  return true;
}

void JsonlSegmentStore::setDisk(const std::string& key, const std::string& value) {
  std::lock_guard<std::mutex> lock(mutex_);
  SetLocked(key, value);
}

std::optional<std::string> JsonlSegmentStore::getDisk(const std::string& key) {
  std::lock_guard<std::mutex> lock(mutex_);
  const auto it = index_.find(key);
  if (it == index_.end()) {
    return std::nullopt;
  }
  const auto line = fileAdapter_->readRange(SegmentPath(it->second.segment), it->second.offset, it->second.length);
  if (!line.has_value()) {
    return std::nullopt;
  }
  const size_t newline = line.value().find('\n');
  const size_t tab = line.value().find('\t');
  if (newline == std::string::npos || tab == std::string::npos || tab > newline) {
    return std::nullopt;
  }
  std::string value;
  if (!UnescapeInto(line.value().substr(tab + 1, newline - tab - 1), value)) {
    return std::nullopt;
  }
  return value;
}

void JsonlSegmentStore::deleteDisk(const std::string& key) {
  std::lock_guard<std::mutex> lock(mutex_);
  const auto it = index_.find(key);
  if (it == index_.end()) {
    return;
  }
  const Entry deletedEntry = it->second;
  const uint32_t segment = it->second.segment;
  index_.erase(it);
  if (!CompactSegment(segment)) {
    index_[key] = deletedEntry;
  }
}

bool JsonlSegmentStore::hasDisk(const std::string& key) {
  std::lock_guard<std::mutex> lock(mutex_);
  return index_.find(key) != index_.end();
}

std::vector<std::string> JsonlSegmentStore::getAllDiskKeys() {
  std::lock_guard<std::mutex> lock(mutex_);
  std::vector<std::string> keys;
  keys.reserve(index_.size());
  for (const auto& entry : index_) {
    keys.push_back(entry.first);
  }
  return keys;
}

size_t JsonlSegmentStore::migrateLegacyEntries(
    const std::vector<std::pair<std::string, std::string>>& entries) {
  std::lock_guard<std::mutex> lock(mutex_);
  size_t imported = 0;
  for (const auto& entry : entries) {
    if (index_.find(entry.first) != index_.end()) {
      continue;
    }
    SetLocked(entry.first, entry.second);
    ++imported;
  }
  return imported;
}

} // namespace NitroAmplitude
