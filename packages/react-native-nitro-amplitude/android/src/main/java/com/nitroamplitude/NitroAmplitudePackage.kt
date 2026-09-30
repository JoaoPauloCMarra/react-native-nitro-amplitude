package com.nitroamplitude

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.margelo.nitro.com.nitroamplitude.NitroAmplitudeOnLoad

class NitroAmplitudePackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider { emptyMap() }

  companion object {
    init {
      System.loadLibrary("NitroAmplitude")
    }
  }
}

@Deprecated("The package initializer sets the Android context. Apps do not need to call this.")
fun initializeNitroAmplitude(context: ReactApplicationContext) {
  AndroidAmplitudeAdapter.setContext(context)
  NitroAmplitudeOnLoad.initializeNative()
}
