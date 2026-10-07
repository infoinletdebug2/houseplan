/**
 * Reanimated 4 does its work through `react-native-worklets`, and this plugin
 * is what turns a `useAnimatedStyle` body into a worklet. Without it every
 * animation in the app silently runs on the JS thread — or, more often, throws
 * a "Reanimated is not configured" error at the first frame.
 *
 * It must stay LAST in the plugin list.
 */
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
