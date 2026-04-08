const { spawnSync } = require("child_process");
const path = require("path");

const isWindows = process.platform === "win32";
const checkScript = path.join(__dirname, "check-android-tooling.js");

console.log("Running Android tooling checks...");
const checkResult = spawnSync(process.execPath, [checkScript], {
  stdio: "inherit",
  shell: false,
  env: process.env,
});

if (checkResult.status !== 0) {
  console.log("");
  console.log("Android tooling checks failed.");
  console.log("Fallback options:");
  console.log("  - Run this on a host machine with Android Studio SDK: npm run android");
  console.log("  - Build in cloud: npm run android:eas");
  process.exit(checkResult.status || 1);
}

console.log("Tooling checks passed. Starting Expo Android run...");
const expoResult = spawnSync("npx", ["expo", "run:android"], {
  stdio: "inherit",
  shell: isWindows,
  env: process.env,
});

process.exit(expoResult.status || 0);