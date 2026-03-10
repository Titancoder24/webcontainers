export interface ParsedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  httpVersion: string;
  body: Uint8Array | null;
}

export interface SerializedResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

export function parseRequest(request: Request): ParsedRequest {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};

  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  return {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    httpVersion: '1.1',
    body: null,
  };
}

export async function parseRequestWithBody(request: Request): Promise<ParsedRequest> {
  const parsed = parseRequest(request);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try {
      const buffer = await request.arrayBuffer();
      if (buffer.byteLength > 0) {
        parsed.body = new Uint8Array(buffer);
      }
    } catch {
      // Body may not be available
    }
  }

  return parsed;
}

export function serializeResponse(response: SerializedResponse): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createResponseFromChunks(
  statusCode: number,
  headers: Record<string, string>,
  chunks: Uint8Array[]
): Response {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
  }

  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    responseHeaders.set(key, value);
  }

  return new Response(body, {
    status: statusCode,
    headers: responseHeaders,
  });
}
