import { createServer, type Server, type ServerResponse } from 'node:http';

export interface MockSseServer {
  origin: string;
  connectionCount: () => number;
  close: () => Promise<void>;
}

let serverPromise: Promise<MockSseServer> | null = null;

export function ensureMockSseServer(): Promise<MockSseServer> {
  serverPromise ??= startServer();
  return serverPromise;
}

export async function closeMockSseServer(): Promise<void> {
  const current = serverPromise;
  serverPromise = null;
  if (current) await (await current).close();
}

async function startServer(): Promise<MockSseServer> {
  let connections = 0;
  const clients = new Set<ServerResponse>();
  const server: Server = createServer((request, response) => {
    if (!request.url?.startsWith('/api/v1/events')) {
      response.writeHead(404).end();
      return;
    }
    connections += 1;
    clients.add(response);
    response.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
    response.write('retry: 60000\n');
    response.write('event: connected\n');
    response.write('data: {"client_id":"e2e-native-client"}\n\n');
    response.write('event: heartbeat\n');
    response.write('data: {"timestamp":"2026-08-26T16:00:00.000Z"}\n\n');
    response.on('close', () => clients.delete(response));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  server.unref();
  const address = server.address();
  if (address == null || typeof address === 'string') {
    throw new Error('Mock SSE server did not bind to a TCP port');
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    connectionCount: () => connections,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      for (const client of clients) client.end();
      server.closeIdleConnections();
    }),
  };
}
