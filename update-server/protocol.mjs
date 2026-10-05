// Names and formats shared by the update server and the scripts that publish to it
// (scripts/ota/). Ships in the server image, so it stays dependency-free.

export const CHANNEL = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const RUNTIME_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Assets are stored and served as <sha256 hex><extension>.
export const ASSET_NAME = /^[0-9a-f]{64}(\.[a-z0-9]{1,10})?$/;
export const PLATFORMS = ['ios', 'android'];

const CONTENT_TYPES = {
  '.bundle': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** The content type for a file extension with its dot, such as `.png`. */
export function contentTypeFor(extension) {
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}
