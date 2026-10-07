# Native libraries

Analytics flush still builds JSON in JavaScript. Native code owns HTTP, gzip,
and the on-disk event/experiment queue.

## Kept

| Library                     | Where                                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| zlib gzip                   | `cpp/core/Gzip.cpp`, `HybridAmplitudeWorker` | Amplitude HTTP V2 accepts `Content-Encoding: gzip`. Bodies ≥ 1 KiB to `*.amplitude.com` are compressed on the worker thread.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| JSONL segments + tombstones | `JsonlSegmentStore`                          | Deletes append a tombstone instead of rewriting the segment. Compaction runs when a segment is more than 50% dead. Compaction keeps a tombstone while any lower segment still holds data, so a deleted key cannot reappear after relaunch, and it aborts without changes when a live row cannot be read. A delete throws `storage_error` when its tombstone cannot be written. Segment files are named `segment-<id>.jsonl` with a decimal id from 0 to 4294967295; a file with a larger id is ignored. Opening the store removes leftover `segment-<id>.jsonl.tmp.*` files from an interrupted compaction and removes empty segment files. A write that fails while the segment file is open (disk full, quota) is rolled back: the segment keeps its last complete record and its id. A segment that cannot be opened for writing is retired and the next id is used. If the storage directory is removed while the app runs, the next write re-creates it and reloads the index from disk. The key `\x7fDEL` is reserved for tombstones; a write with that key throws `storage_error`. |

## Limits and durability

- **Storage durability.** A record is written with one `write` call and is not
  followed by `fsync`. A process kill (crash, low-memory kill, force stop) is
  safe: a complete record is kept and a half-written record is removed when
  storage opens. A power loss or kernel crash can drop the most recent records.
  Compaction writes a temporary file, calls `fsync`, and renames it.
- **Storage size.** For a fixed set of keys the files on disk stay below about
  twice the live data plus two segments (2 MiB at the default segment size),
  and the number of segment files stays below the number of live keys plus two.
  A segment that holds only tombstones is merged into the active segment.
  Storage reads every segment once when it opens, on the JavaScript thread.
  Data size grows with the number of distinct keys; each deleted key that was
  never written again keeps one tombstone (key length plus 6 bytes) while an
  older segment still holds data.
- **Storage errors.** A write, remove, or key listing throws `storage_error`
  while the storage directory cannot be listed or created. Reads return "not
  found" in that state. Storage loads again on the next call after the
  directory becomes available.
- **Record size.** One record (escaped key plus value) is limited to
  4294967295 bytes. A larger record throws `storage_error`.
- **Upload queue.** The HTTP worker holds requests in memory only. It accepts
  at most 100 queued requests and 64 MiB of queued request bodies and headers.
  A request is always accepted when the queue is empty. A request over either
  limit throws `queue_full`. Pending uploads are not stored by native code: a
  request that did not complete before the process stopped is sent again by
  JavaScript after restart, because the event stays in storage until the
  server accepts it.
- **HTTP methods.** The worker changes the method to upper case before it
  sends the request. A method that is empty or is not an HTTP token (for
  example it contains a space or a non-ASCII byte) completes with
  `network_error` on both platforms. `GET` and `HEAD` requests are sent
  without a body. iOS sends any method token. Android uses
  `HttpURLConnection`, which sends `GET`, `HEAD`, `POST`, `PUT`, `DELETE`,
  `OPTIONS`, and `TRACE`; `PATCH` and custom methods are not supported on
  Android and complete with `network_error`.
- **Error detail.** A `network_error` carries platform detail after the code,
  separated by `|`: `network_error|nsurl:<code>|<domain>|<description>` on iOS
  and `network_error|<exception class>|<message>` on Android. Free text drops
  `|` and line breaks, URL query strings, and credential-like values, and is
  capped at 200 characters. `timeout` and `cancelled` stay bare. JavaScript
  parses the string into `AmplitudeError.nativeCode` and `details`.
- **HTTP responses.** A response body is read up to 4 MiB. A longer body is
  cut at 4 MiB and the request still completes with its HTTP status code and
  no error.
- **Gzip.** A request body larger than 2 GiB is sent without compression.

## Evaluated and not shipped

| Library      | Decision                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------- |
| yyjson       | Rejected for event encode. Payload shape is owned by `@amplitude/analytics-core` in JavaScript. |
| SQLite queue | Rejected for this pass. Tombstones give durable deletes without a second store format.          |
| libcurl      | Rejected. Platform HTTP adapters already run off the JS thread.                                 |

Custom `serverUrl` hosts are not gzipped so local and mock transports keep
plain JSON. An existing `Content-Encoding` header is left untouched.
