package com.nitroamplitude

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.MalformedURLException
import java.net.SocketTimeoutException
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

object AndroidAmplitudeAdapter {
  private const val DEFAULT_OPTIONS_JSON = "{}"
  private const val MAX_CACHED_CONTEXTS = 8
  private const val MAX_HTTP_TIMEOUT_MILLIS = 300000
  private const val MAX_RESPONSE_BODY_BYTES = 4 * 1024 * 1024
  private const val LEGACY_DISK_PREFS = "NitroAmplitude"
  private const val STORAGE_DIRECTORY = "nitro-amplitude"

  private var appContext: Context? = null
  private val executor = Executors.newSingleThreadExecutor()
  private val httpTimeoutExecutor: ScheduledExecutorService =
    ScheduledThreadPoolExecutor(
      1,
      Executors.defaultThreadFactory().let { defaultFactory ->
        java.util.concurrent.ThreadFactory { runnable ->
          defaultFactory.newThread(runnable).apply {
            name = "NitroAmplitudeHttpTimeout"
            isDaemon = true
          }
        }
      },
    ).apply {
      removeOnCancelPolicy = true
      executeExistingDelayedTasksAfterShutdownPolicy = false
      continueExistingPeriodicTasksAfterShutdownPolicy = false
    }
  private val cachedContexts = object : LinkedHashMap<String, String>(16, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>): Boolean {
      return size > MAX_CACHED_CONTEXTS
    }
  }

  @JvmStatic
  fun setContext(context: Context) {
    appContext = context.applicationContext
  }

  @JvmStatic
  fun getContext(): Context {
    return appContext ?: throw IllegalStateException("NitroAmplitude: context not initialized")
  }

  private fun legacyPrefs(): SharedPreferences {
    return getContext().getSharedPreferences(LEGACY_DISK_PREFS, Context.MODE_PRIVATE)
  }

  @JvmStatic
  fun prefetchContext() {
    executor.execute {
      try {
        getApplicationContextJson(DEFAULT_OPTIONS_JSON)
      } catch (_: Exception) {
      }
    }
  }

  @JvmStatic
  fun getApplicationContextJson(optionsJson: String): String {
    val canonicalOptions = canonicalOptions(optionsJson)
    synchronized(cachedContexts) {
      cachedContexts[canonicalOptions]?.let { return it }
    }
    val json = buildApplicationContextJson()
    synchronized(cachedContexts) {
      cachedContexts[canonicalOptions] = json
    }
    return json
  }

  private fun canonicalOptions(optionsJson: String): String {
    val options = try {
      JSONObject(optionsJson)
    } catch (_: Exception) {
      return DEFAULT_OPTIONS_JSON
    }
    val sortedKeys = options.keys().asSequence().toList().sorted()
    return sortedKeys.joinToString("&") { key -> "$key=${options.optString(key)}" }
  }

  private fun buildApplicationContextJson(): String {
    val context = getContext()
    val locales = context.resources.configuration.locales
    val locale = if (locales.isEmpty) Locale.getDefault() else locales[0]
    val json = JSONObject()
    json.put("version", context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "")
    json.put("platform", "Android")
    json.put("language", locale.language ?: "")
    json.put("country", locale.country ?: "")
    json.put("osName", "android")
    json.put("osVersion", Build.VERSION.RELEASE ?: "")
    json.put("deviceManufacturer", Build.MANUFACTURER ?: "")
    json.put("deviceModel", Build.MODEL ?: "")
    json.put("deviceBrand", Build.BRAND ?: "")
    return json.toString()
  }

  @JvmStatic
  fun getStorageDirectory(): String {
    return File(getContext().filesDir, STORAGE_DIRECTORY).absolutePath
  }

  @JvmStatic
  fun getLegacyDiskEntries(): Array<String> {
    val entries = legacyPrefs().all
    val flattened = ArrayList<String>(entries.size * 2)
    for ((key, value) in entries) {
      if (value is String) {
        flattened.add(key)
        flattened.add(value)
      }
    }
    return flattened.toTypedArray()
  }

  @JvmStatic
  fun removeLegacyDiskEntries(keys: Array<String>) {
    val editor = legacyPrefs().edit()
    for (key in keys) {
      editor.remove(key)
    }
    editor.commit()
  }

  @JvmStatic
  fun clearLegacyDisk() {
    legacyPrefs().edit().clear().apply()
  }

  private fun readBoundedBody(stream: InputStream): String {
    val buffer = ByteArrayOutputStream()
    val chunk = ByteArray(8192)
    var remaining = MAX_RESPONSE_BODY_BYTES
    while (remaining > 0) {
      val read = stream.read(chunk, 0, minOf(chunk.size, remaining))
      if (read < 0) {
        break
      }
      buffer.write(chunk, 0, read)
      remaining -= read
    }
    return String(buffer.toByteArray(), Charsets.UTF_8)
  }

  @JvmStatic
  fun performHttpRequest(
    url: String,
    method: String,
    headerNames: Array<String>,
    headerValues: Array<String>,
    body: ByteArray,
    timeoutMillis: Int,
  ): Array<String> {
    val boundedTimeoutMillis = timeoutMillis.coerceIn(1, MAX_HTTP_TIMEOUT_MILLIS)
    val sendsBody = body.isNotEmpty() && method != "GET" && method != "HEAD"
    val connection = try {
      (URL(url).openConnection() as HttpURLConnection).apply {
        requestMethod = method
        connectTimeout = boundedTimeoutMillis
        readTimeout = boundedTimeoutMillis
        doInput = true
        for ((index, name) in headerNames.withIndex()) {
          setRequestProperty(name, headerValues.getOrElse(index) { "" })
        }
        if (sendsBody) {
          doOutput = true
        }
      }
    } catch (error: MalformedURLException) {
      return arrayOf("0", "", "invalid_url")
    } catch (error: Exception) {
      return arrayOf("0", "", "network_error")
    }

    val timedOut = AtomicBoolean(false)
    val timeoutTask = httpTimeoutExecutor.schedule({
      timedOut.set(true)
      connection.disconnect()
    }, boundedTimeoutMillis.toLong(), TimeUnit.MILLISECONDS)

    return try {
      if (sendsBody) {
        connection.outputStream.use { stream -> stream.write(body) }
      }
      val status = connection.responseCode
      val stream = if (status >= 400) connection.errorStream else connection.inputStream
      val responseBody = stream?.use { readBoundedBody(it) } ?: ""
      arrayOf(status.toString(), responseBody, "")
    } catch (error: SocketTimeoutException) {
      arrayOf("0", "", "timeout")
    } catch (error: Exception) {
      arrayOf("0", "", if (timedOut.get()) "timeout" else "network_error")
    } finally {
      timeoutTask.cancel(false)
      connection.disconnect()
    }
  }
}
