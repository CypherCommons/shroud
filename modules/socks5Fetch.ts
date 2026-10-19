import { Buffer } from 'buffer';
import TcpSocket from 'react-native-tcp-socket';
import { getSocks5ConnectReplyLength } from './socks5ConnectReply';

const DEFAULT_SOCKS_HOST = '127.0.0.1';
const DEFAULT_SOCKS_PORT = 9050;
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_CONNECT_TIMEOUT = 10000;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

// Caller-supplied header keys/values are interpolated directly into the raw request below -
// stripping CR/LF here closes off header/request injection via a header value containing them.
const sanitizeHeaderField = (value: string): string => value.replace(/[\r\n]/g, '');

interface Socks5FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  connectTimeout?: number;
  socksHost?: string;
  socksPort?: number;
}

interface Socks5Response {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  json: () => Promise<any>;
  text: () => Promise<string>;
}

function parseUrl(url: string): { host: string; port: number; path: string } {
  if (url.startsWith('https://')) {
    throw new Error(
      'HTTPS URLs are not supported by socks5Fetch; use http:// (onion services are reached over plain HTTP through the Tor tunnel)',
    );
  }
  const match = url.match(/^http:\/\/([^/:]+)(?::(\d+))?(\/.*)?$/);
  if (!match) {
    throw new Error(`Invalid URL: ${url}`);
  }
  const host = match[1];
  const port = match[2] ? parseInt(match[2], 10) : 80;
  const path = match[3] || '/';
  return { host, port, path };
}

interface ChunkedDecoder {
  /** Takes the body's next bytes; true once the terminal zero-size chunk is in. */
  push: (bytes: Buffer) => boolean;
  body: () => Buffer;
}

// Decodes a chunked body as it arrives, looking at each byte once however the packets split it:
// re-decoding the whole body on every packet was quadratic in its size, on the JS thread. A
// short or malformed chunk never completes (a truncated read must not look like success), so the
// socket closing rejects it. Works on raw bytes throughout - chunk sizes are byte counts, and
// indexing a UTF-8 string instead would misalign on any multi-byte character in the body.
function createChunkedDecoder(): ChunkedDecoder {
  const parts: Buffer[] = [];
  let length = 0;
  let sizeLine: Buffer = Buffer.alloc(0); // a size line split across packets
  let owed = 0; // bytes of the current chunk still to come
  let crlfOwed = 0; // the CRLF after a chunk's data, skipped unchecked
  let state: 'size' | 'done' | 'stuck' = 'size';

  return {
    push(bytes: Buffer): boolean {
      let rest = bytes;
      while (rest.length > 0 && state === 'size') {
        if (owed > 0) {
          const taken = Math.min(owed, rest.length);
          parts.push(rest.subarray(0, taken));
          length += taken;
          owed -= taken;
          rest = rest.subarray(taken);
          if (owed === 0) crlfOwed = 2;
          continue;
        }
        if (crlfOwed > 0) {
          const skipped = Math.min(crlfOwed, rest.length);
          crlfOwed -= skipped;
          rest = rest.subarray(skipped);
          continue;
        }

        const line = sizeLine.length ? Buffer.concat([sizeLine, rest]) : rest;
        const lineEnd = line.indexOf('\r\n');
        if (lineEnd === -1) {
          sizeLine = line;
          // no real size line runs this long: don't keep buffering one
          if (sizeLine.length > 1024) state = 'stuck';
          break;
        }

        const sizeText = line.subarray(0, lineEnd).toString('ascii').trim();
        const size = parseInt(sizeText, 16);
        sizeLine = Buffer.alloc(0);
        rest = line.subarray(lineEnd + 2);
        if (!sizeText || isNaN(size) || size < 0) state = 'stuck';
        else if (size === 0) state = 'done';
        else owed = size;
      }
      return state === 'done';
    },
    body: () => Buffer.concat(parts, length),
  };
}

/**
 * Make an HTTP request through a SOCKS5 proxy (e.g., Orbot).
 * This enables connecting to .onion addresses via Tor.
 */
export function socks5Fetch(url: string, options: Socks5FetchOptions = {}): Promise<Socks5Response> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT,
    connectTimeout = DEFAULT_CONNECT_TIMEOUT,
    socksHost = DEFAULT_SOCKS_HOST,
    socksPort = DEFAULT_SOCKS_PORT,
  } = options;

  const { host, port, path } = parseUrl(url);

  return new Promise((resolve, reject) => {
    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (fn: () => void) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      fn();
    };

    timer = setTimeout(() => {
      finish(() => {
        try {
          client.destroy();
        } catch {}
        reject(new Error(`SOCKS5 connect timeout after ${connectTimeout}ms`));
      });
    }, connectTimeout);

    const client = TcpSocket.createConnection({ host: socksHost, port: socksPort }, () => {
      // Phase 1: SOCKS5 greeting - version 5, 1 auth method, no auth
      client.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    let phase: 'greeting' | 'connect' | 'http' = 'greeting';
    let pending: Buffer = Buffer.alloc(0);

    // The response so far: the header bytes until their terminator, then the body as the packets that
    // carried it, joined once at the end. Appending every packet to one growing Buffer copied the whole
    // response again each time, quadratic in its size, on the JS thread.
    let headerBytes: Buffer = Buffer.alloc(0);
    let receivedBytes = 0;
    const bodyParts: Buffer[] = [];
    let bodyLength = 0;
    let chunkedBody: ChunkedDecoder | null = null;
    let headerEnd = -1;
    let status = 0;
    let statusText = '';
    const responseHeaders: Record<string, string> = {};
    let expectedBodyLength: number | null = null;
    let isChunked = false;

    // Parses the status line + headers once the header terminator has arrived. Returns false
    // while more bytes are still needed.
    const parseHeadersIfNeeded = (): boolean => {
      if (headerEnd !== -1) return true;
      const idx = headerBytes.indexOf('\r\n\r\n');
      if (idx === -1) return false;
      headerEnd = idx;

      const headerPart = headerBytes.subarray(0, headerEnd).toString('utf-8');
      const statusLine = headerPart.split('\r\n')[0];
      const statusMatch = statusLine.match(/HTTP\/[\d.]+\s+(\d+)\s*(.*)/);
      status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      statusText = statusMatch ? statusMatch[2] : '';

      const headerLines = headerPart.split('\r\n').slice(1);
      for (const line of headerLines) {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim().toLowerCase();
          const value = line.substring(colonIndex + 1).trim();
          responseHeaders[key] = value;
        }
      }

      isChunked = responseHeaders['transfer-encoding']?.includes('chunked') ?? false;
      if (isChunked) chunkedBody = createChunkedDecoder();
      const contentLengthHeader = responseHeaders['content-length'];
      expectedBodyLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;
      return true;
    };

    const buildResponse = (bodyText: string): Socks5Response => ({
      ok: status >= 200 && status < 300,
      status,
      statusText,
      headers: responseHeaders,
      json: async () => JSON.parse(bodyText),
      text: async () => bodyText,
    });

    // Takes the body's next bytes, and resolves as soon as the body is verifiably complete
    // (Content-Length reached, or the chunked terminator seen). With no length info at all, only the
    // 'close' handler can finish it.
    const receiveBody = (bytes: Buffer) => {
      if (chunkedBody) {
        if (chunkedBody.push(bytes)) {
          const decoded = chunkedBody.body();
          finish(() => resolve(buildResponse(decoded.toString('utf-8'))));
        }
        return;
      }

      if (bytes.length > 0) {
        bodyParts.push(bytes);
        bodyLength += bytes.length;
      }
      if (expectedBodyLength !== null && !(bodyLength < expectedBodyLength)) {
        const declared = expectedBodyLength;
        finish(() => resolve(buildResponse(Buffer.concat(bodyParts, bodyLength).subarray(0, declared).toString('utf-8'))));
      }
    };

    client.on('data', (data: string | Buffer) => {
      if (resolved) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      pending = pending.length ? Buffer.from(Buffer.concat([pending, buf])) : buf;

      while (pending.length > 0) {
        if (phase === 'greeting') {
          if (pending.length < 2) return;

          // Verify SOCKS5 server accepted no-auth
          if (pending[0] !== 0x05 || pending[1] !== 0x00) {
            finish(() => {
              client.destroy();
              reject(new Error('SOCKS5 authentication negotiation failed'));
            });
            return;
          }
          pending = pending.subarray(2);

          // Phase 2: Send CONNECT request with domain name
          phase = 'connect';
          const domainBuf = Buffer.from(host, 'ascii');
          const req = Buffer.alloc(7 + domainBuf.length);
          req[0] = 0x05; // SOCKS version
          req[1] = 0x01; // CONNECT command
          req[2] = 0x00; // Reserved
          req[3] = 0x03; // Address type: domain name
          req[4] = domainBuf.length; // Domain length
          domainBuf.copy(req, 5);
          req.writeUInt16BE(port, 5 + domainBuf.length); // Port
          client.write(req);
        } else if (phase === 'connect') {
          const replyLength = getSocks5ConnectReplyLength(pending);
          if (replyLength === null) return;

          if (replyLength < 0 || pending[0] !== 0x05 || pending[1] !== 0x00) {
            const errorCode = pending.length >= 2 ? pending[1] : -1;
            finish(() => {
              client.destroy();
              reject(new Error(`SOCKS5 CONNECT failed (code: ${errorCode})`));
            });
            return;
          }
          pending = pending.subarray(replyLength);

          // Phase 3: Tunnel established - swap to full request timeout and send HTTP request
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            finish(() => {
              try {
                client.destroy();
              } catch {}
              reject(new Error(`SOCKS5 request timeout after ${timeout}ms`));
            });
          }, timeout);
          phase = 'http';
          const requestHeaders: Record<string, string> = {
            Host: host,
            Connection: 'close',
            Accept: 'application/json',
            ...headers,
          };

          let httpRequest = `${method} ${path} HTTP/1.1\r\n`;
          for (const [key, value] of Object.entries(requestHeaders)) {
            httpRequest += `${sanitizeHeaderField(key)}: ${sanitizeHeaderField(value)}\r\n`;
          }
          if (body) {
            httpRequest += `Content-Length: ${Buffer.byteLength(body)}\r\n`;
          }
          httpRequest += '\r\n';
          if (body) {
            httpRequest += body;
          }

          client.write(Buffer.from(httpRequest));
        } else if (phase === 'http') {
          const segment = pending;
          pending = Buffer.alloc(0);

          receivedBytes += segment.length;
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            finish(() => {
              client.destroy();
              reject(new Error(`SOCKS5 response exceeded ${MAX_RESPONSE_BYTES} byte limit`));
            });
            return;
          }

          if (headerEnd !== -1) {
            receiveBody(segment);
          } else {
            headerBytes = headerBytes.length ? Buffer.concat([headerBytes, segment]) : segment;
            // the body's first bytes can arrive in the same packet as the end of the headers
            if (parseHeadersIfNeeded()) receiveBody(headerBytes.subarray(headerEnd + 4));
          }
        }
      }
    });

    // Fallback for when 'data' never saw a complete body: a genuine HTTP/1.0-style
    // connection-closed-delimited response (no Content-Length, not chunked) is only
    // complete once the socket closes. If we *do* have a Content-Length or were mid-chunk,
    // closing early means the read was truncated - resolving anyway would hand truncated
    // data to the caller as if it were a full response.
    client.on('close', () => {
      finish(() => {
        try {
          if (!parseHeadersIfNeeded()) {
            reject(new Error('Invalid HTTP response: no header terminator'));
            return;
          }
          if (expectedBodyLength !== null || isChunked) {
            reject(new Error('SOCKS5 response ended before the declared body length was received'));
            return;
          }
          resolve(buildResponse(Buffer.concat(bodyParts, bodyLength).toString('utf-8')));
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
    });

    client.on('error', (error: Error) => {
      finish(() => {
        reject(new Error(`SOCKS5 connection error: ${error.message}`));
      });
    });
  });
}
