/**
 * URL shim re-exporting globalThis.URL/URLSearchParams plus legacy url.parse/format.
 */

const _URL = globalThis.URL;
const _URLSearchParams = globalThis.URLSearchParams;

export { _URL as URL, _URLSearchParams as URLSearchParams };

export interface UrlObject {
  protocol?: string | null;
  slashes?: boolean | null;
  auth?: string | null;
  host?: string | null;
  port?: string | null;
  hostname?: string | null;
  hash?: string | null;
  search?: string | null;
  query?: string | Record<string, string | string[]> | null;
  pathname?: string | null;
  path?: string | null;
  href?: string;
}

/**
 * Legacy url.parse() implementation.
 */
export function parse(urlString: string, parseQueryString?: boolean, slashesDenoteHost?: boolean): UrlObject {
  const result: UrlObject = {
    protocol: null,
    slashes: null,
    auth: null,
    host: null,
    port: null,
    hostname: null,
    hash: null,
    search: null,
    query: null,
    pathname: null,
    path: null,
    href: urlString,
  };

  let rest = urlString.trim();

  // Extract hash
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) {
    result.hash = rest.slice(hashIdx);
    rest = rest.slice(0, hashIdx);
  }

  // Extract protocol
  const protoMatch = rest.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:)/);
  if (protoMatch) {
    result.protocol = protoMatch[1].toLowerCase();
    rest = rest.slice(protoMatch[1].length);
  }

  // Check for slashes
  if (rest.startsWith('//') || (slashesDenoteHost && result.protocol)) {
    result.slashes = true;
    rest = rest.replace(/^\/\//, '');

    // Extract auth and host
    const slashIdx = rest.indexOf('/');
    const hostPart = slashIdx !== -1 ? rest.slice(0, slashIdx) : rest;
    rest = slashIdx !== -1 ? rest.slice(slashIdx) : '';

    // Check for auth
    const atIdx = hostPart.lastIndexOf('@');
    if (atIdx !== -1) {
      result.auth = decodeURIComponent(hostPart.slice(0, atIdx));
      const hostOnly = hostPart.slice(atIdx + 1);
      _parseHost(hostOnly, result);
    } else {
      _parseHost(hostPart, result);
    }
  }

  // Extract search/query
  const searchIdx = rest.indexOf('?');
  if (searchIdx !== -1) {
    result.search = rest.slice(searchIdx);
    const queryStr = rest.slice(searchIdx + 1);
    if (parseQueryString) {
      result.query = _parseQueryString(queryStr);
    } else {
      result.query = queryStr;
    }
    rest = rest.slice(0, searchIdx);
  }

  // Pathname
  if (rest.length > 0) {
    result.pathname = rest;
  } else if (result.slashes) {
    result.pathname = '/';
  }

  result.path = (result.pathname || '') + (result.search || '');
  result.href = formatUrl(result);

  return result;
}

function _parseHost(hostStr: string, result: UrlObject): void {
  const portMatch = hostStr.match(/:(\d+)$/);
  if (portMatch) {
    result.port = portMatch[1];
    result.hostname = hostStr.slice(0, -portMatch[0].length);
  } else {
    result.hostname = hostStr;
  }
  result.host = hostStr;
}

function _parseQueryString(qs: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  if (!qs) return result;

  const pairs = qs.split('&');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    let key: string, value: string;
    if (eqIdx !== -1) {
      key = decodeURIComponent(pair.slice(0, eqIdx));
      value = decodeURIComponent(pair.slice(eqIdx + 1));
    } else {
      key = decodeURIComponent(pair);
      value = '';
    }

    if (key in result) {
      const existing = result[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[key] = [existing, value];
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Legacy url.format() implementation.
 */
export function formatUrl(urlObj: UrlObject): string {
  let result = '';

  if (urlObj.protocol) {
    result += urlObj.protocol;
  }

  if (urlObj.slashes) {
    result += '//';
  }

  if (urlObj.auth) {
    result += encodeURIComponent(urlObj.auth) + '@';
  }

  if (urlObj.hostname) {
    result += urlObj.hostname;
  }

  if (urlObj.port) {
    result += ':' + urlObj.port;
  }

  if (urlObj.pathname) {
    result += urlObj.pathname;
  }

  if (urlObj.search) {
    result += urlObj.search;
  } else if (urlObj.query) {
    if (typeof urlObj.query === 'string') {
      result += '?' + urlObj.query;
    } else {
      const parts: string[] = [];
      for (const [key, val] of Object.entries(urlObj.query)) {
        if (Array.isArray(val)) {
          for (const v of val) {
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
          }
        } else {
          parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(val));
        }
      }
      if (parts.length > 0) {
        result += '?' + parts.join('&');
      }
    }
  }

  if (urlObj.hash) {
    result += urlObj.hash;
  }

  return result;
}

export function resolve(from: string, to: string): string {
  return new _URL(to, from).href;
}

export { formatUrl as format };

export default {
  URL: _URL,
  URLSearchParams: _URLSearchParams,
  parse,
  format: formatUrl,
  resolve,
};
