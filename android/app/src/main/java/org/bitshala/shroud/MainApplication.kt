package org.bitshala.shroud

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.content.res.Configuration
import com.bugsnag.android.Bugsnag
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.modules.i18nmanager.I18nUtil
import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

    private lateinit var sharedPref: SharedPreferences

    override val reactHost: ReactHost by lazy {
        ExpoReactHostFactory.getDefaultReactHost(
            context = applicationContext,
            packageList =
                PackageList(this).packages.apply {
                    // Packages that cannot be autolinked yet can be added manually here
                    add(RustJsiBridgePackage())
                }
        )
    }

    override fun onCreate() {
        super.onCreate()
        sharedPref = getSharedPreferences("group.org.bitshala.shroud", Context.MODE_PRIVATE)

        val sharedI18nUtilInstance = I18nUtil.instance
        sharedI18nUtilInstance.allowRTL(applicationContext, false)
        sharedI18nUtilInstance.forceRTL(applicationContext, false)

        DefaultNewArchitectureEntryPoint.releaseLevel = try {
            ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
        } catch (e: IllegalArgumentException) {
            ReleaseLevel.STABLE
        }
        loadReactNative(this)
        ApplicationLifecycleDispatcher.onApplicationCreate(this)

        initializeBugsnag()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
    }

    private fun initializeBugsnag() {
        val isDoNotTrackEnabled = sharedPref.getString("donottrack", "0")
        if (isDoNotTrackEnabled != "1") {
            Bugsnag.start(this)
        }
    }
}
