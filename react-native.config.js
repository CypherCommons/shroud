module.exports = {
  dependencies: {
    '@lodev09/react-native-true-sheet': {
      platforms: {
        android: {
          // The fork's Gradle namespace differs from its Kotlin package.
          packageImportPath: 'import com.lodev09.truesheet.TrueSheetPackage;',
        },
      },
    },
  },
  project: {
    ios: {},
    android: {},
  },
  assets: ['./assets/fonts'],
};
