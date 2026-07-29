plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

val defaultServerUrl = providers.gradleProperty("REMOTE_SERVER_URL")
    .orElse(providers.environmentVariable("REMOTE_SERVER_URL"))
    .orElse("ws://10.0.2.2:8787/ws")
    .get()
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")

android {
    namespace = "com.remotecontrol.agent"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.remotecontrol.agent"
        minSdk = 30
        targetSdk = 35
        versionCode = 6
        versionName = "0.6.0"
        buildConfigField("String", "DEFAULT_SERVER_URL", "\"$defaultServerUrl\"")
    }
    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
