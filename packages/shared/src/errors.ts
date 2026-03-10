import { ERROR_CODES } from './constants.js';
import type { FSError } from './types.js';

export function createFSError(
  code: string,
  syscall: string,
  path?: string,
  message?: string
): FSError {
  const errno = ERROR_CODES[code] ?? -1;
  const msg = message ?? `${code}: ${getErrorMessage(code)}, ${syscall} '${path ?? ''}'`;
  const err = new Error(msg) as FSError;
  err.code = code;
  err.errno = errno;
  err.syscall = syscall;
  if (path) err.path = path;
  return err;
}

function getErrorMessage(code: string): string {
  switch (code) {
    case 'ENOENT': return 'no such file or directory';
    case 'EEXIST': return 'file already exists';
    case 'ENOTDIR': return 'not a directory';
    case 'EISDIR': return 'illegal operation on a directory';
    case 'EACCES': return 'permission denied';
    case 'ENOTEMPTY': return 'directory not empty';
    case 'EPERM': return 'operation not permitted';
    case 'EBADF': return 'bad file descriptor';
    case 'EMFILE': return 'too many open files';
    case 'ENFILE': return 'file table overflow';
    default: return 'unknown error';
  }
}
