package com.nitroamplitude

import android.os.Build
import android.os.LocaleList
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.util.Locale

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24], manifest = Config.NONE)
class AndroidAmplitudeAdapterMinSdkTest {
  @Before
  fun setUp() {
    AndroidAmplitudeAdapter.setContext(RuntimeEnvironment.getApplication())
  }

  @Test
  fun contextJsonIsBuiltOnTheMinimumSupportedSdk() {
    assertEquals(24, Build.VERSION.SDK_INT)
    val json = JSONObject(AndroidAmplitudeAdapter.getApplicationContextJson("{\"min-sdk\":true}"))
    assertEquals("Android", json.getString("platform"))
    assertEquals("android", json.getString("osName"))
    assertEquals(Build.VERSION.RELEASE ?: "", json.getString("osVersion"))
    for (field in arrayOf("version", "language", "country", "deviceManufacturer", "deviceModel", "deviceBrand")) {
      assertTrue(field, json.get(field) is String)
    }
  }

  @Test
  fun emptyLocaleListFallsBackOnTheMinimumSupportedSdk() {
    val resources = RuntimeEnvironment.getApplication().resources
    val configuration = resources.configuration
    configuration.setLocales(LocaleList.getEmptyLocaleList())
    @Suppress("DEPRECATION")
    resources.updateConfiguration(configuration, resources.displayMetrics)
    val json = JSONObject(AndroidAmplitudeAdapter.getApplicationContextJson("{\"min-sdk-empty-locales\":true}"))
    val expected = if (resources.configuration.locales.isEmpty) {
      Locale.getDefault()
    } else {
      resources.configuration.locales[0]
    }
    assertEquals(expected.language, json.getString("language"))
    assertEquals(expected.country, json.getString("country"))
  }

  @Test
  fun storageDirectoryAndLegacyPreferencesWorkOnTheMinimumSupportedSdk() {
    assertTrue(AndroidAmplitudeAdapter.getStorageDirectory().endsWith("/nitro-amplitude"))
    AndroidAmplitudeAdapter.clearLegacyDisk()
    assertEquals(0, AndroidAmplitudeAdapter.getLegacyDiskEntries().size)
  }
}
