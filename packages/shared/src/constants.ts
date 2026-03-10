export const SAB_SIZE = 1024 * 1024;
export const SAB_STATUS_OFFSET = 0;
export const SAB_SYSCALL_TYPE_OFFSET = 4;
export const SAB_REQUEST_LENGTH_OFFSET = 8;
export const SAB_RESPONSE_LENGTH_OFFSET = 12;
export const SAB_ERROR_CODE_OFFSET = 16;
export const SAB_PAYLOAD_OFFSET = 64;

export const STATUS_IDLE = 0;
export const STATUS_REQUEST = 1;
export const STATUS_RESPONSE = 2;
export const STATUS_ERROR = 3;

export const WORKER_POOL_SIZE = 6;
export const MAX_PIDS = 1024;
export const MAX_FDS = 256;
export const ROOT_INODE_ID = 0;

export const DEFAULT_FILE_MODE = 0o644;
export const DEFAULT_DIR_MODE = 0o755;
export const DEFAULT_SYMLINK_MODE = 0o777;

export const ERROR_CODES: Record<string, number> = {
  EPERM: -1,
  ENOENT: -2,
  EBADF: -9,
  EACCES: -13,
  EEXIST: -17,
  ENOTDIR: -20,
  EISDIR: -21,
  ENFILE: -23,
  EMFILE: -24,
  ENOTEMPTY: -39,
};
