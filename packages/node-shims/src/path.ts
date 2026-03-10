/**
 * POSIX path implementation for browser environment.
 */

export const sep = '/';
export const delimiter = ':';

export function isAbsolute(p: string): boolean {
  return p.length > 0 && p.charCodeAt(0) === 47; // '/'
}

export function normalize(p: string): string {
  if (p.length === 0) return '.';

  const isAbs = isAbsolute(p);
  const trailingSlash = p.charCodeAt(p.length - 1) === 47;

  const segments = p.split('/');
  const result: string[] = [];

  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop();
      } else if (!isAbs) {
        result.push('..');
      }
    } else {
      result.push(segment);
    }
  }

  let out = result.join('/');
  if (isAbs) {
    out = '/' + out;
  }
  if (!out) {
    out = isAbs ? '/' : '.';
  }
  if (trailingSlash && out[out.length - 1] !== '/') {
    out += '/';
  }

  return out;
}

export function join(...paths: string[]): string {
  if (paths.length === 0) return '.';
  let joined = '';
  for (const p of paths) {
    if (typeof p !== 'string') {
      throw new TypeError('Path must be a string');
    }
    if (p.length > 0) {
      if (joined.length === 0) {
        joined = p;
      } else {
        joined += '/' + p;
      }
    }
  }
  if (joined.length === 0) return '.';
  return normalize(joined);
}

export function resolve(...paths: string[]): string {
  let resolvedPath = '';
  let resolvedAbsolute = false;

  for (let i = paths.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    const p = i >= 0 ? paths[i] : '/';
    if (typeof p !== 'string') {
      throw new TypeError('Path must be a string');
    }
    if (p.length === 0) continue;
    resolvedPath = p + '/' + resolvedPath;
    resolvedAbsolute = p.charCodeAt(0) === 47;
  }

  resolvedPath = normalize(resolvedPath);

  if (resolvedAbsolute) {
    return resolvedPath.length > 0 ? resolvedPath : '/';
  }
  return resolvedPath.length > 0 ? resolvedPath : '.';
}

export function dirname(p: string): string {
  if (p.length === 0) return '.';

  const hasRoot = p.charCodeAt(0) === 47;
  let end = -1;
  let matchedSlash = true;

  for (let i = p.length - 1; i >= 1; i--) {
    if (p.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }

  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) return '//';
  return p.slice(0, end);
}

export function basename(p: string, ext?: string): string {
  let start = 0;
  let end = -1;
  let matchedSlash = true;

  for (let i = p.length - 1; i >= 0; i--) {
    if (p.charCodeAt(i) === 47) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else {
      if (matchedSlash) {
        matchedSlash = false;
        end = i + 1;
      }
    }
  }

  if (end === -1) return '';
  const base = p.slice(start, end);

  if (ext !== undefined && base.endsWith(ext)) {
    return base.slice(0, base.length - ext.length);
  }
  return base;
}

export function extname(p: string): string {
  let startDot = -1;
  let startPart = 0;
  let end = -1;
  let matchedSlash = true;
  let preDotState = 0;

  for (let i = p.length - 1; i >= 0; i--) {
    const code = p.charCodeAt(i);
    if (code === 47) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46) {
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    preDotState === 0 ||
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return '';
  }

  return p.slice(startDot, end);
}

export function relative(from: string, to: string): string {
  if (from === to) return '';

  from = resolve(from);
  to = resolve(to);

  if (from === to) return '';

  const fromParts = from.split('/').filter(Boolean);
  const toParts = to.split('/').filter(Boolean);

  const length = Math.min(fromParts.length, toParts.length);
  let samePartsLength = length;

  for (let i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  const outputParts: string[] = [];

  for (let i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  for (let i = samePartsLength; i < toParts.length; i++) {
    outputParts.push(toParts[i]);
  }

  return outputParts.join('/');
}

export interface ParsedPath {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
}

export function parse(p: string): ParsedPath {
  const root = isAbsolute(p) ? '/' : '';
  const base = basename(p);
  const ext = extname(p);
  const name = base.slice(0, base.length - ext.length);
  const dir = dirname(p);

  return { root, dir, base, ext, name };
}

export function format(pathObject: Partial<ParsedPath>): string {
  const dir = pathObject.dir || pathObject.root || '';
  const base =
    pathObject.base || (pathObject.name || '') + (pathObject.ext || '');

  if (!dir) return base;
  if (dir === pathObject.root) return dir + base;
  return dir + '/' + base;
}

export const posix = {
  sep,
  delimiter,
  isAbsolute,
  normalize,
  join,
  resolve,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
};

export default {
  sep,
  delimiter,
  isAbsolute,
  normalize,
  join,
  resolve,
  dirname,
  basename,
  extname,
  relative,
  parse,
  format,
  posix,
};
