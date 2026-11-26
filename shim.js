/* global __DEV__, localStorage */
if (typeof Buffer === 'undefined') global.Buffer = require('buffer').Buffer;
if (typeof __dirname === 'undefined') global.__dirname = '/';
if (typeof __filename === 'undefined') global.__filename = '';
if (typeof process === 'undefined') {
  global.process = {};
}

process.browser = false;
process.version = '0.0.0';

// Minimalistic process.nextTick implementation
process.nextTick = function (callback, ...args) {
  if (typeof callback !== 'function') {
    throw new TypeError('callback must be a function');
  }

  // Use setImmediate if available (better than setTimeout), otherwise fallback to setTimeout
  if (typeof setImmediate !== 'undefined') {
    setImmediate(() => callback(...args));
  } else {
    setTimeout(() => callback(...args), 0);
  }
};

// global.location = global.location || { port: 80 }
const isDev = typeof __DEV__ === 'boolean' && __DEV__;
if (typeof localStorage !== 'undefined') {
  localStorage.debug = isDev ? '*' : '';
}

// React Native has no WebCrypto. marmot-ts (chat) needs `crypto.subtle`, so install a @noble-backed
// one only when it's missing. Lazy: the noble curve/cipher modules load on first use, not at start-up.
if (typeof global.crypto === 'undefined') global.crypto = {};
if (!global.crypto.subtle) {
  Object.defineProperty(global.crypto, 'subtle', {
    configurable: true,
    enumerable: true,
    get() {
      const subtle = require('./helpers/chat/nobleSubtle').nobleSubtle;
      Object.defineProperty(global.crypto, 'subtle', { value: subtle, configurable: true, writable: true });
      return subtle;
    },
  });
}

// If using the crypto shim, uncomment the following line to ensure
// crypto is loaded first, so it can populate global.crypto
require('crypto');
