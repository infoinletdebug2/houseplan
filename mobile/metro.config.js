// Metro config: Expo's defaults, minus folders that are not app code.
// The browser harness writes Chrome profiles and web exports inside this
// folder; watching them made Metro rebuild (and phones re-download) the
// bundle again and again.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// [\\/] matches both separators: on Windows Metro sees backslash paths.
config.resolver.blockList = [
  /[\\/]harness[\\/]\.chrome[^\\/]*[\\/].*/,
  /[\\/]harness[\\/]shots[^\\/]*[\\/].*/,
  /[\\/]dist-[^\\/]*[\\/].*/,
];

module.exports = config;
