package com.nitroamplitude

import android.content.Context
import android.os.LocaleList
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class AndroidAmplitudeAdapterTest {
  private class RecordedRequest(
    val method: String,
    val path: String,
    val headers: Map<String, String>,
    val body: ByteArray,
  )

  private class StubServer(
    private val respond: (RecordedRequest, OutputStream) -> Unit,
  ) : Closeable {
    private val serverSocket = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
    private val openSockets = CopyOnWriteArrayList<Socket>()
    val requests = CopyOnWriteArrayList<RecordedRequest>()
    private val acceptThread = Thread {
      while (!serverSocket.isClosed) {
        val socket = try {
          serverSocket.accept()
        } catch (_: Exception) {
          break
        }
        openSockets.add(socket)
        Thread {
          try {
            val request = readRequest(socket.getInputStream())
            if (request != null) {
              requests.add(request)
              respond(request, socket.getOutputStream())
              socket.getOutputStream().flush()
            }
          } catch (_: Exception) {
          }
        }.apply { isDaemon = true }.start()
      }
    }.apply { isDaemon = true }

    init {
      acceptThread.start()
    }

    fun url(path: String): String = "http://127.0.0.1:${serverSocket.localPort}$path"

    private fun readLine(input: InputStream): String? {
      val line = ByteArrayOutputStream()
      while (true) {
        val next = input.read()
        if (next < 0) {
          return if (line.size() == 0) null else line.toString("UTF-8")
        }
        if (next == '\n'.code) {
          return line.toString("UTF-8").trimEnd('\r')
        }
        line.write(next)
      }
    }

    private fun readRequest(input: InputStream): RecordedRequest? {
      val requestLine = readLine(input) ?: return null
      val parts = requestLine.split(" ")
      val headers = LinkedHashMap<String, String>()
      while (true) {
        val line = readLine(input) ?: break
        if (line.isEmpty()) {
          break
        }
        val separator = line.indexOf(':')
        headers[line.substring(0, separator).trim().lowercase(Locale.ROOT)] =
          line.substring(separator + 1).trim()
      }
      val length = headers["content-length"]?.toInt() ?: 0
      val body = ByteArray(length)
      var offset = 0
      while (offset < length) {
        val read = input.read(body, offset, length - offset)
        if (read < 0) {
          break
        }
        offset += read
      }
      return RecordedRequest(parts[0], parts.getOrElse(1) { "" }, headers, body)
    }

    override fun close() {
      serverSocket.close()
      for (socket in openSockets) {
        try {
          socket.close()
        } catch (_: Exception) {
        }
      }
    }
  }

  private fun writeResponse(output: OutputStream, status: Int, body: ByteArray) {
    val head = "HTTP/1.1 $status Status\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n"
    output.write(head.toByteArray(Charsets.US_ASCII))
    output.write(body)
  }

  private fun context(): Context = RuntimeEnvironment.getApplication()

  private fun setStaticField(name: String, value: Any?) {
    val field = AndroidAmplitudeAdapter::class.java.getDeclaredField(name)
    field.isAccessible = true
    field.set(null, value)
  }

  private fun getStaticField(name: String): Any? {
    val field = AndroidAmplitudeAdapter::class.java.getDeclaredField(name)
    field.isAccessible = true
    return field.get(null)
  }

  @Suppress("UNCHECKED_CAST")
  private fun clearCachedContexts() {
    val cache = getStaticField("cachedContexts") as MutableMap<String, String>
    synchronized(cache) { cache.clear() }
  }

  private fun drainPrefetchExecutor() {
    val executor = getStaticField("executor") as ExecutorService
    executor.submit { }.get(30, TimeUnit.SECONDS)
  }

  private fun legacyPrefs() = context().getSharedPreferences("NitroAmplitude", Context.MODE_PRIVATE)

  @Before
  fun setUp() {
    AndroidAmplitudeAdapter.setContext(context())
    clearCachedContexts()
    legacyPrefs().edit().clear().commit()
  }

  @After
  fun tearDown() {
    AndroidAmplitudeAdapter.setContext(context())
    clearCachedContexts()
  }

  @Test
  fun successfulPostForwardsMethodHeadersAndBody() {
    StubServer { _, output -> writeResponse(output, 200, "{\"code\":200}".toByteArray()) }.use { server ->
      val payload = "{\"events\":[\"é\"]}".toByteArray(Charsets.UTF_8)
      val result = AndroidAmplitudeAdapter.performHttpRequest(
        server.url("/2/httpapi"),
        "POST",
        arrayOf("Content-Type", "X-Custom"),
        arrayOf("application/json"),
        payload,
        5000,
      )
      assertArrayEquals(arrayOf("200", "{\"code\":200}", ""), result)
      val request = server.requests.single()
      assertEquals("POST", request.method)
      assertEquals("/2/httpapi", request.path)
      assertEquals("application/json", request.headers["content-type"])
      assertEquals("", request.headers["x-custom"])
      assertArrayEquals(payload, request.body)
    }
  }

  @Test
  fun errorStatusesReturnStatusAndErrorBodyWithoutNativeError() {
    StubServer { request, output ->
      val status = request.path.substringAfterLast('/').toInt()
      val body = if (status == 204) ByteArray(0) else "{\"code\":$status}".toByteArray()
      writeResponse(output, status, body)
    }.use { server ->
      for (status in intArrayOf(204, 400, 401, 404, 413, 429, 500, 502, 503)) {
        val result = AndroidAmplitudeAdapter.performHttpRequest(
          server.url("/status/$status"), "POST", emptyArray(), emptyArray(), "{}".toByteArray(), 5000,
        )
        assertEquals(status.toString(), result[0])
        assertEquals(if (status == 204) "" else "{\"code\":$status}", result[1])
        assertEquals("", result[2])
      }
    }
  }

  @Test
  fun oversizedResponseBodyIsTruncatedAndKeepsItsStatus() {
    val cap = 4 * 1024 * 1024
    StubServer { request, output ->
      val size = request.path.substringAfterLast('/').toInt()
      val status = if (request.path.startsWith("/error/")) 500 else 200
      writeResponse(output, status, ByteArray(size) { 'x'.code.toByte() })
    }.use { server ->
      val exact = AndroidAmplitudeAdapter.performHttpRequest(
        server.url("/ok/$cap"), "POST", emptyArray(), emptyArray(), "{}".toByteArray(), 30000,
      )
      assertEquals("200", exact[0])
      assertEquals(cap, exact[1].length)
      assertEquals("", exact[2])

      val oversized = AndroidAmplitudeAdapter.performHttpRequest(
        server.url("/ok/${cap + 300000}"), "POST", emptyArray(), emptyArray(), "{}".toByteArray(), 30000,
      )
      assertEquals("200", oversized[0])
      assertEquals(cap, oversized[1].length)
      assertEquals("", oversized[2])

      val oversizedError = AndroidAmplitudeAdapter.performHttpRequest(
        server.url("/error/${cap + 300000}"), "POST", emptyArray(), emptyArray(), "{}".toByteArray(), 30000,
      )
      assertEquals("500", oversizedError[0])
      assertEquals(cap, oversizedError[1].length)
      assertEquals("", oversizedError[2])
    }
  }

  private fun assertTransportFailure(exception: String?, result: Array<String>) {
    assertEquals("0", result[0])
    assertEquals("", result[1])
    assertTrue(result[2], result[2].startsWith("network_error|"))
    if (exception != null) {
      assertEquals(exception, result[2].split("|")[1])
    }
  }

  @Test
  fun formatsUnknownHostException() {
    assertEquals(
      "network_error|java.net.UnknownHostException|Unable to resolve host \"api.lab.amplitude.com\"",
      AndroidAmplitudeAdapter.formatTransportError(
        java.net.UnknownHostException("Unable to resolve host \"api.lab.amplitude.com\""),
      ),
    )
  }

  @Test
  fun formatsSslHandshakeException() {
    assertEquals(
      "network_error|javax.net.ssl.SSLHandshakeException|Trust anchor for certification path not found.",
      AndroidAmplitudeAdapter.formatTransportError(
        javax.net.ssl.SSLHandshakeException("Trust anchor for certification path not found."),
      ),
    )
  }

  @Test
  fun formatsConnectExceptionAndMissingMessage() {
    assertEquals(
      "network_error|java.net.ConnectException|failed to connect to /[ip] (port 443)",
      AndroidAmplitudeAdapter.formatTransportError(
        java.net.ConnectException("failed to connect to /10.0.0.1 (port 443)"),
      ),
    )
    val full = AndroidAmplitudeAdapter.formatTransportError(
      java.net.ConnectException(
        "failed to connect to api.lab.amplitude.com/93.184.216.34 (port 443) from /10.0.2.15 (port 51234) after 10000ms: isConnected failed: ECONNREFUSED (Connection refused)",
      ),
    )
    assertEquals(
      "network_error|java.net.ConnectException|failed to connect to api.lab.amplitude.com/[ip] (port 443) after 10000ms: isConnected failed: ECONNREFUSED (Connection refused)",
      full,
    )
    assertFalse(full, full.contains("10.0.2.15"))
    assertFalse(full, full.contains("51234"))
    assertTrue(full, full.contains("ECONNREFUSED"))
    val unreachable = AndroidAmplitudeAdapter.formatTransportError(
      java.net.ConnectException("failed to connect to /fe80::1%wlan0 (port 443) from /2001:db8::7 (port 4000): connect failed: ENETUNREACH (Network is unreachable)"),
    )
    assertEquals(
      "network_error|java.net.ConnectException|failed to connect to /[ip] (port 443): connect failed: ENETUNREACH (Network is unreachable)",
      unreachable,
    )
    assertEquals(
      "network_error|java.net.ConnectException|",
      AndroidAmplitudeAdapter.formatTransportError(java.net.ConnectException()),
    )
  }

  @Test
  fun transportErrorDetailIsSanitized() {
    val injected = AndroidAmplitudeAdapter.formatTransportError(
      java.io.IOException("a|b\nc\r\nd"),
    )
    assertEquals("network_error|java.io.IOException|a b c d", injected)

    val words = "ab ".repeat(200)
    val capped = AndroidAmplitudeAdapter.formatTransportError(
      java.io.IOException(words),
    )
    assertEquals(words.take(200), capped.removePrefix("network_error|java.io.IOException|"))

    val longRun = AndroidAmplitudeAdapter.formatTransportError(
      java.io.IOException("x".repeat(500)),
    )
    assertEquals("network_error|java.io.IOException|[redacted]", longRun)

    val surrogate = AndroidAmplitudeAdapter.formatTransportError(
      java.io.IOException("ab ".repeat(66) + "c" + "\uD83D\uDE00" + " tail"),
    )
    val surrogateDetail = surrogate.removePrefix("network_error|java.io.IOException|")
    assertEquals(199, surrogateDetail.length)
    assertFalse(surrogateDetail, surrogateDetail.last().isHighSurrogate())

    val withQuery = AndroidAmplitudeAdapter.formatTransportError(
      java.io.IOException("failed https://api.lab.amplitude.com/v1/vardata?user_id=u1&device=d1 after 10s"),
    )
    assertFalse(withQuery, withQuery.contains("?"))
    assertFalse(withQuery, withQuery.contains("user_id"))

    val withKey = AndroidAmplitudeAdapter.formatTransportError(
      java.lang.IllegalArgumentException("Unexpected char 0x0a at 3 in Authorization value: Api-Key client-secret-123"),
    )
    assertFalse(withKey, withKey.contains("client-secret-123"))
    assertFalse(withKey, withKey.contains("Api-Key"))
  }

  @Test
  fun transportErrorDetailRedactionParity() {
    val cases = listOf(
      "https://user:pw@amplitude.test/p failed" to "https://amplitude.test/p failed",
      "Authorization: Api-Key abc" to "[redacted]",
      "bad Cookie: a=b" to "bad [redacted]",
      "set Password 123 now" to "set [redacted]",
      "NSURLSession load failed" to "NSURLSession load failed",
      "header value: top-secret-thing" to "header value: [redacted]",
      "key abcdefghijklmnopqrstuvwxyzABCDEF0123456789 end" to "key [redacted] end",
      "Error: x at 10:30 and 10:30:15" to "Error: x at 10:30 and 10:30:15",
      "peer 192.168.1.20 and ::1 and 2001:db8:0:0:0:0:0:1 and fe80::1%en0" to "peer [ip] and [ip] and [ip] and [ip]",
      "std::string failed" to "std::string failed",
    )
    for ((input, expected) in cases) {
      assertEquals(
        input,
        "network_error|java.io.IOException|$expected",
        AndroidAmplitudeAdapter.formatTransportError(java.io.IOException(input)),
      )
    }
  }

  @Test
  fun invalidUtf8ResponseBodyDoesNotThrow() {
    StubServer { _, output ->
      writeResponse(output, 200, byteArrayOf(0xff.toByte(), 0xfe.toByte(), 'o'.code.toByte(), 'k'.code.toByte()))
    }.use { server ->
      val result = AndroidAmplitudeAdapter.performHttpRequest(
        server.url("/binary"), "POST", emptyArray(), emptyArray(), "{}".toByteArray(), 5000,
      )
      assertEquals("200", result[0])
      assertTrue(result[1].endsWith("ok"))
      assertEquals("", result[2])
    }
  }

  @Test
  fun unresponsiveServerReturnsTimeout() {
    val release = CountDownLatch(1)
    StubServer { _, _ -> release.await(60, TimeUnit.SECONDS) }.use { server ->
      val result = AndroidAmplitudeAdapter.performHttpRequest(
        server.url("/slow"), "POST", emptyArray(), emptyArray(), "{}".toByteArray(), 300,
      )
      release.countDown()
      assertArrayEquals(arrayOf("0", "", "timeout"), result)
    }
  }

  @Test
  fun closedPortReturnsNetworkError() {
    val socket = ServerSocket(0, 1, InetAddress.getLoopbackAddress())
    val port = socket.localPort
    socket.close()
    val result = AndroidAmplitudeAdapter.performHttpRequest(
      "http://127.0.0.1:$port/closed", "POST", emptyArray(), emptyArray(), "{}".toByteArray(), 5000,
    )
    assertTransportFailure("java.net.ConnectException", result)
  }

  @Test
  fun droppedConnectionReturnsNetworkError() {
    StubServer { _, output -> output.close() }.use { server ->
      val result = AndroidAmplitudeAdapter.performHttpRequest(
        server.url("/drop"), "POST", emptyArray(), emptyArray(), "{}".toByteArray(), 5000,
      )
      assertTransportFailure(null, result)
    }
  }

  @Test
  fun invalidRequestsMapToStableErrors() {
    StubServer { _, output -> writeResponse(output, 200, ByteArray(0)) }.use { server ->
      for (url in arrayOf("", "not a url", "amplitude.com/2/httpapi", "unknown://host/path")) {
        val result = AndroidAmplitudeAdapter.performHttpRequest(
          url, "POST", emptyArray(), emptyArray(), "{}".toByteArray(), 5000,
        )
        assertArrayEquals(arrayOf("0", "", "invalid_url"), result)
      }
      for (method in arrayOf("", "PO ST", "PATCH", "X-CUSTOM", "post")) {
        val result = AndroidAmplitudeAdapter.performHttpRequest(
          server.url("/method"), method, emptyArray(), emptyArray(), "{}".toByteArray(), 5000,
        )
        assertTransportFailure("java.net.ProtocolException", result)
      }
      val invalidHeader = AndroidAmplitudeAdapter.performHttpRequest(
        server.url("/header"), "POST", arrayOf("Bad Header\n"), arrayOf("value"), "{}".toByteArray(), 5000,
      )
      assertTransportFailure("java.lang.IllegalArgumentException", invalidHeader)
      assertTrue(server.requests.isEmpty())
    }
  }

  @Test
  fun getAndHeadNeverSendABody() {
    StubServer { _, output -> writeResponse(output, 200, "ok".toByteArray()) }.use { server ->
      val get = AndroidAmplitudeAdapter.performHttpRequest(
        server.url("/get"), "GET", emptyArray(), emptyArray(), "ignored".toByteArray(), 5000,
      )
      assertArrayEquals(arrayOf("200", "ok", ""), get)
      val head = AndroidAmplitudeAdapter.performHttpRequest(
        server.url("/head"), "HEAD", emptyArray(), emptyArray(), "ignored".toByteArray(), 5000,
      )
      assertEquals("200", head[0])
      assertEquals("", head[2])
      val emptyPost = AndroidAmplitudeAdapter.performHttpRequest(
        server.url("/empty"), "POST", emptyArray(), emptyArray(), ByteArray(0), 5000,
      )
      assertEquals("200", emptyPost[0])
      assertEquals(listOf("GET", "HEAD", "POST"), server.requests.map { it.method })
      assertTrue(server.requests.all { it.body.isEmpty() })
    }
  }

  @Test
  fun outOfRangeTimeoutsAreClampedInsteadOfThrowing() {
    StubServer { _, output -> writeResponse(output, 200, ByteArray(0)) }.use { server ->
      for (timeout in intArrayOf(Int.MIN_VALUE, -1, 0, Int.MAX_VALUE)) {
        val result = AndroidAmplitudeAdapter.performHttpRequest(
          server.url("/timeout"), "POST", emptyArray(), emptyArray(), "{}".toByteArray(), timeout,
        )
        assertEquals(3, result.size)
        assertTrue(result[2] in setOf("", "timeout", "network_error"))
      }
    }
  }

  @Test
  fun applicationContextJsonHasEveryFieldAndIsCachedPerOptionSet() {
    val json = JSONObject(AndroidAmplitudeAdapter.getApplicationContextJson("{}"))
    assertEquals("Android", json.getString("platform"))
    assertEquals("android", json.getString("osName"))
    for (field in arrayOf(
      "version", "language", "country", "osVersion", "deviceManufacturer", "deviceModel", "deviceBrand",
    )) {
      assertTrue(field, json.has(field))
      assertTrue(field, json.get(field) is String)
    }
    val first = AndroidAmplitudeAdapter.getApplicationContextJson("{\"b\":1,\"a\":true}")
    val second = AndroidAmplitudeAdapter.getApplicationContextJson("{\"a\":true,\"b\":1}")
    assertTrue(first === second)
    assertEquals(
      AndroidAmplitudeAdapter.getApplicationContextJson("{}"),
      AndroidAmplitudeAdapter.getApplicationContextJson("not json"),
    )
    for (index in 0 until 40) {
      AndroidAmplitudeAdapter.getApplicationContextJson("{\"option$index\":true}")
    }
    @Suppress("UNCHECKED_CAST")
    val cache = getStaticField("cachedContexts") as Map<String, String>
    assertTrue(synchronized(cache) { cache.size } <= 8)
  }

  @Test
  fun emptyLocaleListFallsBackToTheDefaultLocale() {
    val resources = context().resources
    val configuration = resources.configuration
    val previous = configuration.locales
    configuration.setLocales(LocaleList.getEmptyLocaleList())
    @Suppress("DEPRECATION")
    resources.updateConfiguration(configuration, resources.displayMetrics)
    try {
      val json = JSONObject(AndroidAmplitudeAdapter.getApplicationContextJson("{\"empty-locales\":true}"))
      if (resources.configuration.locales.isEmpty) {
        assertEquals(Locale.getDefault().language, json.getString("language"))
        assertEquals(Locale.getDefault().country, json.getString("country"))
      } else {
        assertEquals(resources.configuration.locales[0].language, json.getString("language"))
      }
    } finally {
      configuration.setLocales(previous)
      @Suppress("DEPRECATION")
      resources.updateConfiguration(configuration, resources.displayMetrics)
    }
  }

  @Test
  fun callsBeforeInitializationFailWithoutCrashingBackgroundThreads() {
    setStaticField("appContext", null)
    val uncaught = AtomicReference<Throwable?>(null)
    val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { _, error -> uncaught.set(error) }
    try {
      AndroidAmplitudeAdapter.prefetchContext()
      drainPrefetchExecutor()
      assertNull(uncaught.get())

      for (call in listOf<() -> Unit>(
        { AndroidAmplitudeAdapter.getApplicationContextJson("{}") },
        { AndroidAmplitudeAdapter.getStorageDirectory() },
        { AndroidAmplitudeAdapter.getLegacyDiskEntries() },
        { AndroidAmplitudeAdapter.removeLegacyDiskEntries(arrayOf("a")) },
        { AndroidAmplitudeAdapter.clearLegacyDisk() },
      )) {
        try {
          call()
          fail("expected IllegalStateException")
        } catch (error: IllegalStateException) {
          assertEquals("NitroAmplitude: context not initialized", error.message)
        }
      }
    } finally {
      Thread.setDefaultUncaughtExceptionHandler(previousHandler)
    }

    AndroidAmplitudeAdapter.setContext(context())
    AndroidAmplitudeAdapter.prefetchContext()
    drainPrefetchExecutor()
    assertEquals("Android", JSONObject(AndroidAmplitudeAdapter.getApplicationContextJson("{}")).getString("platform"))
  }

  @Test
  fun storageDirectoryLivesUnderTheApplicationFilesDirectory() {
    val directory = AndroidAmplitudeAdapter.getStorageDirectory()
    assertEquals(context().filesDir.absolutePath + "/nitro-amplitude", directory)
  }

  @Test
  fun legacyPreferencesAreListedRemovedPerKeyAndCleared() {
    legacyPrefs().edit()
      .putString("legacy-a", "1")
      .putString("legacy-b", "2")
      .putString("legacy-c", "")
      .putInt("legacy-number", 7)
      .putStringSet("legacy-set", setOf("x"))
      .commit()

    val flattened = AndroidAmplitudeAdapter.getLegacyDiskEntries()
    assertEquals(6, flattened.size)
    val entries = flattened.toList().chunked(2).associate { it[0] to it[1] }
    assertEquals(mapOf("legacy-a" to "1", "legacy-b" to "2", "legacy-c" to ""), entries)

    AndroidAmplitudeAdapter.removeLegacyDiskEntries(arrayOf("legacy-a", "missing"))
    assertFalse(legacyPrefs().contains("legacy-a"))
    assertTrue(legacyPrefs().contains("legacy-b"))
    assertEquals(4, AndroidAmplitudeAdapter.getLegacyDiskEntries().size)
    AndroidAmplitudeAdapter.removeLegacyDiskEntries(emptyArray())
    assertEquals(4, AndroidAmplitudeAdapter.getLegacyDiskEntries().size)

    AndroidAmplitudeAdapter.clearLegacyDisk()
    assertEquals(0, AndroidAmplitudeAdapter.getLegacyDiskEntries().size)
    assertTrue(legacyPrefs().all.isEmpty())
  }
}
