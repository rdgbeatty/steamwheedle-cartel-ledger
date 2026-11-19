import { Readable } from 'node:stream';

// Exercise the real HTTP request listener without requiring sandbox socket permissions.
export function localTransport(server, origin = 'http://127.0.0.1:4174') {
  return async (input, options = {}) => {
    const url = new URL(input, origin);
    const headers = { host: url.host };
    for (const [name, value] of new Headers(options.headers)) headers[name.toLowerCase()] = value;
    const request = Readable.from(options.body === undefined ? [] : [Buffer.from(options.body)]);
    Object.assign(request, { method: options.method ?? 'GET', url: url.pathname + url.search, headers });
    return new Promise((resolve, reject) => {
      let status, responseHeaders;
      const response = {
        socket: { localPort: Number(new URL(origin).port) },
        writeHead(code, values) { status = code; responseHeaders = values; },
        end(body) { resolve(new Response(body, { status, headers: responseHeaders })); },
      };
      Promise.resolve(server.listeners('request')[0](request, response)).catch(reject);
    });
  };
}
