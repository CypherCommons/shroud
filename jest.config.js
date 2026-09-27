module.exports = {
  testEnvironment: '<rootDir>/tests/custom-environment.js',
  reporters: ['default', ['<rootDir>/tests/custom-reporter.js', {}]],
  preset: 'jest-expo',
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
  },
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native(-.*)?|@react-native(-community)?|expo(-.*)?|@expo(nent)?/.*)|@rneui|@react-navigation|@lodev09)',
  ],
  setupFiles: ['./tests/setup.js'],
  watchPathIgnorePatterns: ['<rootDir>/node_modules'],
};
