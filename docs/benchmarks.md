# Benchmarks

The release benchmark is an isolated local transport sanity check. It loads
only `react-native-nitro-amplitude`'s built CommonJS entry in a fresh Node
process, replaces Nitro and network effects with deterministic dry-run
adapters, warms the path twice, and reports eight measured samples with mean,
p50, p95, minimum, and maximum timings.

Run it from this repository:

```sh
bun run benchmark
```

This does not measure Amplitude's native SDK, provider network latency, or
server response time. Those require a device and controlled test service, so
the result must not be compared with native benchmarks from another package.
The command prints a `BENCHMARK_RESULT` record containing the package name,
version, runtime, platform, and benchmark scope.
