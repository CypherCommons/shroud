// Where the native projects name the update channel a build asks for: the expo-channel-name
// request header. EAS Build sets it per build profile only for EAS Update URLs, so
// scripts/ota/set-build-channel.mjs sets it for ours, and fingerprint.config.js blanks it before
// hashing so that every profile's build gets the same runtime version.

const CHANNEL_HEADERS = {
  'android/app/src/main/AndroidManifest.xml': /(&quot;expo-channel-name&quot;:&quot;)[^&]*(&quot;)/g,
  'ios/Shroud/Supporting/Expo.plist': /(<key>expo-channel-name<\/key>\s*<string>)[^<]*(<\/string>)/g,
};

/** Puts `channel` in a native config file's contents. `count` is how many places named one. */
function setChannelHeader(filePath, contents, channel) {
  let count = 0;
  const result = contents.replace(CHANNEL_HEADERS[filePath], (_, before, after) => {
    count += 1;
    return `${before}${channel}${after}`;
  });
  return { contents: result, count };
}

module.exports = { CHANNEL_HEADERS, setChannelHeader };
