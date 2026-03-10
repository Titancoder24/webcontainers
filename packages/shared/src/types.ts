export enum SyscallType {
  FS_READ = 1,
  FS_WRITE = 2,
  FS_STAT = 3,
  FS_READDIR = 4,
  FS_MKDIR = 5,
  FS_UNLINK = 6,
  FS_RENAME = 7,
  FS_SYMLINK = 8,
  FS_READLINK = 9,
  FS_CHMOD = 10,
  FS_OPEN = 11,
  FS_CLOSE = 12,
  FS_WATCH = 13,
  FS_EXISTS = 14,
  FS_REALPATH = 15,
  FS_MKDTEMP = 16,
  FS_RMDIR = 17,
  FS_WRITEFILE = 18,
  FS_READFILE = 19,
  FS_APPENDFILE = 20,
  FS_COPYFILE = 21,
  FS_ACCESS = 22,
  FS_LSTAT = 23,
  FS_UTIMES = 24,
  PROCESS_SPAWN = 50,
  PROCESS_KILL = 51,
  PROCESS_CWD = 52,
  PROCESS_CHDIR = 53,
  PROCESS_EXIT = 54,
  NET_LISTEN = 70,
  NET_CONNECT = 71,
  NET_CLOSE = 72,
}

export interface Inode {
  id: number;
  type: 'file' | 'directory' | 'symlink';
  data: Uint8Array | null;
  children: Map<string, number>;
  target: string | null;
  mode: number;
  size: number;
  mtimeMs: number;
  atimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  uid: number;
  gid: number;
  nlink: number;
}

export interface ProcessEntry {
  pid: number;
  ppid: number;
  cmd: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  state: 'running' | 'stopped' | 'exited' | 'zombie';
  exitCode: number | null;
  worker: Worker | null;
  childPids: number[];
  stdoutPort: MessagePort | null;
  stderrPort: MessagePort | null;
  stdinPort: MessagePort | null;
  syscallBuffer: SharedArrayBuffer | null;
}

export interface FileDescriptor {
  fd: number;
  inodeId: number;
  position: number;
  flags: number;
}

export interface PortEntry {
  port: number;
  pid: number;
  handler: MessagePort;
}

export type FileSystemTree = {
  [name: string]: FileNode | DirectoryNode;
};

export interface FileNode {
  file: { contents: string | Uint8Array };
}

export interface DirectoryNode {
  directory: FileSystemTree;
}

export interface VFSStats {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  size: number;
  blksize: number;
  blocks: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  birthtime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
}

export interface Dirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface FSError extends Error {
  code: string;
  errno: number;
  syscall: string;
  path?: string;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: 'pipe' | 'inherit';
  stdout?: 'pipe' | 'inherit';
  stderr?: 'pipe' | 'inherit';
}

export interface BootOptions {
  workdirName?: string;
  coep?: 'require-corp' | 'credentialless';
}
