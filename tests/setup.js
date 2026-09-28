/* global jest */

import mockClipboard from '@react-native-clipboard/clipboard/jest/clipboard-mock.js';

const consoleWarnOrig = console.warn;
console.warn = (...args) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].startsWith('WARNING: Sending to a future segwit version address can lead to loss of funds') ||
      args[0].startsWith('only compressed public keys are good'))
  ) {
    return;
  }
  consoleWarnOrig.apply(consoleWarnOrig, args);
};

const consoleLogOrig = console.log;
console.debug = console.log = (...args) => {
  if (
    typeof args[0] === 'string' &&
    (args[0].startsWith('updating exchange rate') ||
      args[0].startsWith('Created new currency formatter for') ||
      args[0].startsWith('begin connection') ||
      args[0].startsWith('TLS Connected to') ||
      args[0].startsWith('connected to'))
  ) {
    return;
  }
  consoleLogOrig.apply(consoleLogOrig, args);
};

global.net = require('net'); // needed by Electrum client. For RN it is proviced in shim.js
global.tls = require('tls'); // needed by Electrum client. For RN it is proviced in shim.js
global.fetch = require('node-fetch');

jest.mock('@react-native-clipboard/clipboard', () => mockClipboard);

jest.mock('react-native-secure-key-store', () => {
  return {};
});

jest.mock(
  'react-native-launch-arguments',
  () => ({
    LaunchArguments: { value: () => ({}) },
  }),
  { virtual: true },
);

jest.mock(
  '@react-native-community/push-notification-ios',
  () => {
    return {};
  },
  { virtual: true },
);

jest.mock('react-native-permissions', () => require('react-native-permissions/mock'));

jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));

jest.mock('react-native-device-info', () => {
  return {
    getUniqueId: jest.fn().mockReturnValue('uniqueId'),
    getSystemName: jest.fn(),
    getDeviceType: jest.fn().mockReturnValue(false),
    hasGmsSync: jest.fn().mockReturnValue(true),
    hasHmsSync: jest.fn().mockReturnValue(false),
    isTablet: jest.fn().mockReturnValue(false),
    getVersion: jest.fn().mockReturnValue('0.0.1'),
    getBuildNumber: jest.fn().mockReturnValue('1'),
    getPowerState: jest.fn().mockResolvedValue({ lowPowerMode: false }),
  };
});

jest.mock('react-native-default-preference', () => {
  let mockPreferences = {};
  let currentSuiteName = 'default';

  const getSuite = name => {
    if (!mockPreferences[name]) {
      mockPreferences[name] = {};
    }
    return mockPreferences[name];
  };

  return {
    setName: jest.fn(name => {
      currentSuiteName = name;
      if (!mockPreferences[name]) {
        mockPreferences[name] = {};
      }
      return Promise.resolve();
    }),

    getName: jest.fn(() => {
      return Promise.resolve(currentSuiteName);
    }),

    get: jest.fn(key => {
      const suite = getSuite(currentSuiteName);
      return Promise.resolve(Object.prototype.hasOwnProperty.call(suite, key) ? suite[key] : null);
    }),

    set: jest.fn((key, value) => {
      const suite = getSuite(currentSuiteName);
      suite[key] = value;
      return Promise.resolve();
    }),

    clear: jest.fn(key => {
      const suite = getSuite(currentSuiteName);
      delete suite[key];
      return Promise.resolve();
    }),

    getMultiple: jest.fn(keys => {
      const suite = getSuite(currentSuiteName);
      const values = keys.map(key => (Object.prototype.hasOwnProperty.call(suite, key) ? suite[key] : null));
      return Promise.resolve(values);
    }),

    setMultiple: jest.fn(keyValuePairs => {
      const suite = getSuite(currentSuiteName);
      Object.entries(keyValuePairs).forEach(([key, value]) => {
        suite[key] = value;
      });
      return Promise.resolve();
    }),

    clearMultiple: jest.fn(keys => {
      const suite = getSuite(currentSuiteName);
      keys.forEach(key => delete suite[key]);
      return Promise.resolve();
    }),

    getAll: jest.fn(() => {
      const suite = getSuite(currentSuiteName);
      return Promise.resolve({ ...suite });
    }),

    clearAll: jest.fn(() => {
      mockPreferences[currentSuiteName] = {};
      return Promise.resolve();
    }),

    reset: jest.fn(() => {
      mockPreferences = {};
      currentSuiteName = 'default'; // Reset the current suite name
      return Promise.resolve();
    }),
  };
});

jest.mock('react-native-fs', () => {
  return {
    mkdir: jest.fn(),
    moveFile: jest.fn(),
    copyFile: jest.fn(),
    pathForBundle: jest.fn(),
    pathForGroup: jest.fn(),
    getFSInfo: jest.fn(),
    getAllExternalFilesDirs: jest.fn(),
    unlink: jest.fn(),
    exists: jest.fn(),
    stopDownload: jest.fn(),
    resumeDownload: jest.fn(),
    isResumable: jest.fn(),
    stopUpload: jest.fn(),
    completeHandlerIOS: jest.fn(),
    readDir: jest.fn(),
    readDirAssets: jest.fn(),
    existsAssets: jest.fn(),
    readdir: jest.fn(),
    setReadable: jest.fn(),
    stat: jest.fn(),
    readFile: jest.fn(),
    read: jest.fn(),
    readFileAssets: jest.fn(),
    hash: jest.fn(),
    copyFileAssets: jest.fn(),
    copyFileAssetsIOS: jest.fn(),
    copyAssetsVideoIOS: jest.fn(),
    writeFile: jest.fn(),
    appendFile: jest.fn(),
    write: jest.fn(),
    downloadFile: jest.fn(),
    uploadFiles: jest.fn(),
    touch: jest.fn(),
    MainBundlePath: jest.fn(),
    CachesDirectoryPath: jest.fn(),
    DocumentDirectoryPath: jest.fn(),
    ExternalDirectoryPath: jest.fn(),
    ExternalStorageDirectoryPath: jest.fn(),
    TemporaryDirectoryPath: jest.fn(),
    LibraryDirectoryPath: jest.fn(),
    PicturesDirectoryPath: jest.fn(),
  };
});

jest.mock('@react-native-documents/picker', () => ({}));

jest.mock('react-native-haptic-feedback', () => ({}));

const realmInstanceMock = {
  create: function () {},
  delete: function () {},
  close: function () {},
  write: function (transactionFn) {
    if (typeof transactionFn === 'function') {
      // to test if something is not right in Realm transactional database write
      transactionFn();
    }
  },
  objectForPrimaryKey: function () {
    return {};
  },
  objects: function () {
    const wallets = {
      filtered: function () {
        return [];
      },
    };
    return wallets;
  },
};
jest.mock('realm', () => {
  return {
    UpdateMode: { Modified: 1 },
    open: jest.fn(() => realmInstanceMock),
  };
});

// Stands in for the unlinked native module. Children render only while presented, so a test that
// finds sheet content has also proved present() ran.
jest.mock('@lodev09/react-native-true-sheet', () => {
  const React = require('react');
  const { View } = require('react-native');

  class TrueSheet extends React.Component {
    state = { visible: false };
    dismiss = jest.fn(() => new Promise(resolve => this.setState({ visible: false }, resolve)));
    present = jest.fn(() => new Promise(resolve => this.setState({ visible: true }, resolve)));
    resize = jest.fn(() => Promise.resolve());

    render() {
      return this.state.visible ? React.createElement(View, this.props) : null;
    }
  }

  return { TrueSheet };
});

jest.mock('react-native-camera-kit-no-google', () => ({
  detectQRCodeInImage: jest.fn(base64 => {
    if (base64 === 'invalid-image') {
      return Promise.reject(new Error('Invalid image data'));
    }
    return Promise.resolve('mocked-qr-code');
  }),
}));

jest.mock('react-native-haptic-feedback', () => {
  return {
    trigger: jest.fn(),
  };
});

jest.mock('../modules/analytics', () => {
  const ret = jest.fn();
  ret.ENUM = { CREATED_WALLET: '' };
  return ret;
});

jest.mock('react-native-share', () => {
  return {
    open: jest.fn(),
  };
});

const mockKeychain = {
  SECURITY_LEVEL_ANY: 'MOCK_SECURITY_LEVEL_ANY',
  SECURITY_LEVEL_SECURE_SOFTWARE: 'MOCK_SECURITY_LEVEL_SECURE_SOFTWARE',
  SECURITY_LEVEL_SECURE_HARDWARE: 'MOCK_SECURITY_LEVEL_SECURE_HARDWARE',
  setGenericPassword: jest.fn().mockResolvedValue(),
  getGenericPassword: jest.fn().mockResolvedValue(),
  resetGenericPassword: jest.fn().mockResolvedValue(),
};
jest.mock('react-native-keychain', () => mockKeychain);

// Per-file mocks in tests/unit/{torManager,socks5Fetch,socksSocket}.test.ts override this with
// scripted socket behavior - this is only the fallback for any other test that instantiates a
// socket without its own mock, so it must be a real (if inert) socket shape, not an unrelated double.
jest.mock('react-native-tcp-socket', () => {
  const { EventEmitter } = require('events');
  class FakeTcpSocket extends EventEmitter {
    write = jest.fn();
    end = jest.fn();
    destroy = jest.fn();
    setTimeout = jest.fn();
    setEncoding = jest.fn();
    setKeepAlive = jest.fn();
    setNoDelay = jest.fn();
    connect = jest.fn(function (_options, callback) {
      if (callback) setImmediate(callback);
      return this;
    });
  }
  return {
    __esModule: true,
    default: {
      Socket: FakeTcpSocket,
      createConnection: jest.fn((_options, callback) => {
        const socket = new FakeTcpSocket();
        if (callback) setImmediate(callback);
        return socket;
      }),
    },
  };
});

global.alert = () => {};
