import { chmod, mkdir, unlink } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';

import {
  serveStdio,
  StdioServerTransport,
} from '@modelcontextprotocol/server/stdio';

import {
  createStorybookAgentMcp,
  type StorybookAgentMcpBackend,
} from './storybook-agent-mcp.js';

export class StorybookAgentMcpServer {
  private server: Server | undefined;
  private handles: Array<{ close(): Promise<void> }> = [];
  private socketPath: string | undefined;

  constructor(private readonly backend: StorybookAgentMcpBackend) {}

  async start(socketPath: string): Promise<string> {
    if (this.server !== undefined) {
      throw new Error('The Storybook agent MCP server is already running.');
    }
    await mkdir(dirname(socketPath), { recursive: true });
    await removeSocket(socketPath);
    const server = createServer((socket) => this.serve(socket));
    try {
      await listen(server, socketPath);
      await chmod(socketPath, 0o600);
    } catch (error) {
      await removeSocket(socketPath);
      throw error;
    }
    this.server = server;
    this.socketPath = socketPath;
    return socketPath;
  }

  async startAuthenticatedLoopback(
    token: string,
  ): Promise<{ readonly host: '127.0.0.1'; readonly port: number }> {
    if (this.server !== undefined || token.length < 32) {
      throw new Error('The Storybook agent MCP server cannot start.');
    }
    const server = createServer((socket) =>
      authenticate(socket, token, () => this.serve(socket)),
    );
    await listenTcp(server);
    const address = server.address();
    if (address === null || typeof address === 'string') {
      await close(server);
      throw new Error('The Storybook MCP loopback address is unavailable.');
    }
    this.server = server;
    return { host: '127.0.0.1', port: address.port };
  }

  async stop(): Promise<void> {
    const server = this.server;
    const handles = this.handles;
    const socketPath = this.socketPath;
    this.server = undefined;
    this.handles = [];
    this.socketPath = undefined;
    await Promise.all([
      ...handles.map((handle) => handle.close()),
      server === undefined ? Promise.resolve() : close(server),
    ]);
    if (socketPath !== undefined) await removeSocket(socketPath);
  }

  private serve(socket: Socket): void {
    const handle = serveStdio(() => createStorybookAgentMcp(this.backend), {
      transport: new StdioServerTransport(socket, socket),
    });
    this.handles.push(handle);
    socket.once('close', () => {
      this.handles = this.handles.filter((item) => item !== handle);
    });
  }
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function listenTcp(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function authenticate(socket: Socket, token: string, accepted: () => void) {
  let buffered = Buffer.alloc(0);
  const receive = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    const boundary = buffered.indexOf(10);
    if (boundary < 0 && buffered.length <= token.length + 1) return;
    socket.off('data', receive);
    if (boundary < 0 || buffered.subarray(0, boundary).toString() !== token) {
      socket.destroy();
      return;
    }
    const remainder = buffered.subarray(boundary + 1);
    if (remainder.length > 0) socket.unshift(remainder);
    accepted();
  };
  socket.on('data', receive);
}

async function removeSocket(socketPath: string): Promise<void> {
  try {
    await unlink(socketPath);
  } catch (error) {
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw error;
    }
  }
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
