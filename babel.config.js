module.exports = {
  // babel-preset-expo also adds the react-native-worklets plugin that Reanimated 4 needs.
  presets: ['babel-preset-expo'],
  plugins: [
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        path: '.env',
      },
    ],
  ],
};
