import * as http from 'http';

interface MockContent {
  body: string | Buffer;
  contentType: string;
  headers?: Record<string, string>;
  statusCode?: number;
}

export class ቀላልWebServer {
  private server: http.Server | null = null;
  private routes: Map<string, MockContent> = new Map();
  private port: number | null = null;

  constructor() {
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const routeKey = `${req.method?.toUpperCase() || 'GET'}${req.url || '/'}`;
    const mock = this.routes.get(req.url || '/') || this.routes.get(routeKey);

    if (mock) {
      const headers = {
        'Content-Type': mock.contentType,
        ...(mock.headers || {}),
      };
      // Handle Range requests for more advanced tests later
      // For now, simple GET
      res.writeHead(mock.statusCode || 200, headers);
      res.end(mock.body);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }

  public setContent(
    urlPath: string,
    body: string | Buffer,
    contentType: string,
    method: string = 'GET',
    headers?: Record<string, string>,
    statusCode: number = 200
  ): void {
    const routeKey = `${method.toUpperCase()}${urlPath}`;
    this.routes.set(routeKey, { body, contentType, headers, statusCode });
    // For simplicity, also set for just the path if method is GET (common case)
    if (method.toUpperCase() === 'GET') {
      this.routes.set(urlPath, { body, contentType, headers, statusCode });
    }
  }

  public start(port: number = 0): Promise<void> {
    // port = 0 means random available port
    return new Promise((resolve, reject) => {
      if (this.server?.listening) {
        resolve();
        return;
      }
      this.server?.listen(port, () => {
        const address = this.server?.address();
        if (address && typeof address !== 'string') {
          this.port = address.port;
          console.log(`Mock server started on port ${this.port}`);
        }
        resolve();
      });
      this.server?.on('error', (err) => {
        console.error('Mock server error:', err);
        reject(err);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server && this.server.listening) {
        this.server.close((err) => {
          if (err) {
            console.error('Error stopping mock server:', err);
            reject(err);
            return;
          }
          this.port = null;
          console.log('Mock server stopped.');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  public getPort(): number | null {
    return this.port;
  }

  public getBaseUrl(): string | null {
    if (!this.port) return null;
    return `http://localhost:${this.port}`;
  }

  public clearRoutes(): void {
    this.routes.clear();
  }
}
