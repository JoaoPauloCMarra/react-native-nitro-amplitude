package com.nitroamplitude

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors

object AndroidAmplitudeAdapter {
  private var appContext: Context? = null
  private val executor = Executors.newSingleThreadExecutor()
  private var cachedContextJson: String = "{}"

  @JvmStatic
  fun setContext(context: Context) {
    appContext = context.applicationContext
  }

  @JvmStatic
  fun getContext(): Context {
    return appContext ?: throw IllegalStateException("NitroAmplitude context not initialized")
  }

  private fun prefs(): SharedPreferences {
    return getContext().getSharedPreferences("NitroAmplitude", Context.MODE_PRIVATE)
  }

  @JvmStatic
  fun prefetchContext() {
    executor.execute { cachedContextJson = buildApplicationContextJson("{}") }
  }

  @JvmStatic
  fun getApplicationContextJson(optionsJson: String): String {
    return buildApplicationContextJson(optionsJson)
  }

  private fun buildApplicationContextJson(optionsJson: String): String {
    val context = getContext()
    val options = try {
      JSONObject(optionsJson)
    } catch (_: Exception) {
      JSONObject()
    }

    val locale = context.resources.configuration.locales[0]
    val json = JSONObject()
    json.put("version", context.packageManager.getPackageInfo(context.packageName, 0).versionName)
    json.put("platform", "Android")
    json.put("language", locale.language)
    json.put("country", locale.country)
    json.put("osName", "android")
    json.put("osVersion", Build.VERSION.RELEASE)
    json.put("deviceManufacturer", Build.MANUFACTURER)
    json.put("deviceModel", Build.MODEL)
    json.put("deviceBrand", Build.BRAND)
    if (options.optBoolean("carrier", false)) {
      json.put("carrier", "")
    }
    if (options.optBoolean("idfv", false)) {
      json.put("idfv", "")
    }
    if (options.optBoolean("adid", false)) {
      json.put("adid", "")
    }
    if (options.optBoolean("appSetId", false)) {
      json.put("appSetId", "")
    }
    return json.toString()
  }

  @JvmStatic
  fun getLegacySessionDataJson(instanceName: String): String = "{}"

  @JvmStatic
  fun getLegacyEventsJson(instanceName: String, eventKind: String): Array<String> = emptyArray()

  @JvmStatic
  fun removeLegacyEvent(instanceName: String, eventKind: String, eventId: Long) {}

  @JvmStatic
  fun setDisk(key: String, value: String) {
    prefs().edit().putString(key, value).apply()
  }

  @JvmStatic
  fun getDisk(key: String): String? = prefs().getString(key, null)

  @JvmStatic
  fun deleteDisk(key: String) {
    prefs().edit().remove(key).apply()
  }

  @JvmStatic
  fun hasDisk(key: String): Boolean = prefs().contains(key)

  @JvmStatic
  fun getAllDiskKeys(): Array<String> = prefs().all.keys.toTypedArray()

  @JvmStatic
  fun performHttpRequest(
    url: String,
    method: String,
    headersJson: String,
    body: String,
    timeoutMillis: Int,
  ): Array<String> {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = timeoutMillis
      readTimeout = timeoutMillis
      doInput = true
      val headers = try {
        JSONObject(headersJson)
      } catch (_: Exception) {
        JSONObject()
      }
      val keys = headers.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        setRequestProperty(key, headers.optString(key))
      }
      if (body.isNotEmpty()) {
        doOutput = true
        outputStream.use { stream -> stream.write(body.toByteArray()) }
      }
    }

    return try {
      val status = connection.responseCode
      val stream = if (status >= 400) connection.errorStream else connection.inputStream
      val responseBody = stream?.let {
        BufferedReader(InputStreamReader(it)).use { reader -> reader.readText() }
      } ?: ""
      arrayOf(status.toString(), responseBody, "")
    } catch (error: Exception) {
      arrayOf("0", "", error.message ?: "HTTP request failed")
    } finally {
      connection.disconnect()
    }
  }
}
