const appJson = require('./app.json');

module.exports = ({ config }) => {
  const baseExpo = appJson.expo || {};

  // EAS Update and EAS Build should use hosted updates/runtime pinning.
  // Local Expo Go sessions should use Metro directly and skip runtime/update URL
  // to avoid "Something went wrong" runtime mismatches.
  const isEasContext = Boolean(process.env.EAS_BUILD || process.env.EAS_UPDATE);

  const expo = {
    ...baseExpo,
  };

  if (!isEasContext) {
    delete expo.runtimeVersion;
    delete expo.updates;
  }

  return {
    ...config,
    ...appJson,
    expo,
  };
};
