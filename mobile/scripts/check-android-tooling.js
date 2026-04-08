const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const isWindows = process.platform === "win32";
const homeDir = process.env.HOME || process.env.USERPROFILE || "";
const defaultAndroidHome = isWindows
  ? path.join(homeDir, "AppData", "Local", "Android", "Sdk")
  : path.join(homeDir, "android-sdk");

const androidHome = process.env.ANDROID_HOME || defaultAndroidHome;
const androidSdkRoot = process.env.ANDROID_SDK_ROOT || androidHome;

function resolveBinary(relativePath, fallbackName) {
  const fullPath = path.join(androidHome, relativePath);
  if (fs.existsSync(fullPath)) {
    return fullPath;
  }
  return fallbackName;
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: isWindows });
  return result.status === 0;
}

const adbPath = resolveBinary(
  path.join("platform-tools", isWindows ? "adb.exe" : "adb"),
  "adb"
);
const sdkmanagerPath = resolveBinary(
  path.join(
    "cmdline-tools",
    "latest",
    "bin",
    isWindows ? "sdkmanager.bat" : "sdkmanager"
  ),
  isWindows ? "sdkmanager.bat" : "sdkmanager"
);

process.env.ANDROID_HOME = androidHome;
process.env.ANDROID_SDK_ROOT = androidSdkRoot;

console.log(`ANDROID_HOME=${androidHome}`);
console.log(`ANDROID_SDK_ROOT=${androidSdkRoot}`);

if (!fs.existsSync(path.join(androidHome, "platform-tools")) && adbPath !== "adb") {
  console.error(`adb directory not found under ${path.join(androidHome, "platform-tools")}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(androidHome, "cmdline-tools", "latest", "bin")) && !sdkmanagerPath.includes("sdkmanager")) {
  console.error(
    `sdkmanager directory not found under ${path.join(androidHome, "cmdline-tools", "latest", "bin")}`
  );
  process.exit(1);
}

console.log("Checking adb...");
if (!runCommand(adbPath, ["version"])) {
  console.error("adb failed. Install Android platform-tools or ensure adb is on PATH.");
  process.exit(2);
}

console.log("Checking sdkmanager...");
if (!runCommand(sdkmanagerPath, ["--version"])) {
  console.error("sdkmanager failed. Install Android command-line tools and Java, or ensure sdkmanager is on PATH.");
  process.exit(3);
}

console.log("Android tooling looks good.");