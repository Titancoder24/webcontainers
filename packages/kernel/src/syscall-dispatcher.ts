import { SyscallType } from '@aspect/shared';
import type { VFS } from '@aspect/vfs';

export interface ProcessManagerRef {
  spawn(cmd: string, args: string[], options: { cwd: string; env: Record<string, string> }): Promise<{ pid: number }>;
  kill(pid: number, signal: number): void;
  getCwd(pid: number): string;
  chdir(pid: number, dir: string): void;
  exit(pid: number, code: number): void;
}

export interface NetworkManagerRef {
  listen(port: number, pid: number, handler: MessagePort): void;
  connect(port: number): MessagePort | null;
  close(port: number): void;
}

export interface SyscallResult {
  data?: Record<string, unknown>;
  binaryData?: Uint8Array;
  error?: { code: string; message: string; errno: number };
}

export class SyscallDispatcher {
  private vfs: VFS;
  private processManager: ProcessManagerRef | null = null;
  private networkManager: NetworkManagerRef | null = null;

  constructor(vfs: VFS) {
    this.vfs = vfs;
  }

  setProcessManager(pm: ProcessManagerRef): void {
    this.processManager = pm;
  }

  setNetworkManager(nm: NetworkManagerRef): void {
    this.networkManager = nm;
  }

  handleSyscall(
    type: SyscallType,
    payload: Record<string, unknown>,
    binaryData?: Uint8Array | null,
    pid?: number
  ): SyscallResult {
    try {
      switch (type) {
        case SyscallType.FS_READFILE:
          return this.fsReadFile(payload);
        case SyscallType.FS_WRITEFILE:
          return this.fsWriteFile(payload, binaryData);
        case SyscallType.FS_STAT:
          return this.fsStat(payload);
        case SyscallType.FS_LSTAT:
          return this.fsLstat(payload);
        case SyscallType.FS_READDIR:
          return this.fsReaddir(payload);
        case SyscallType.FS_MKDIR:
          return this.fsMkdir(payload);
        case SyscallType.FS_RMDIR:
          return this.fsRmdir(payload);
        case SyscallType.FS_UNLINK:
          return this.fsUnlink(payload);
        case SyscallType.FS_RENAME:
          return this.fsRename(payload);
        case SyscallType.FS_SYMLINK:
          return this.fsSymlink(payload);
        case SyscallType.FS_READLINK:
          return this.fsReadlink(payload);
        case SyscallType.FS_CHMOD:
          return this.fsChmod(payload);
        case SyscallType.FS_ACCESS:
          return this.fsAccess(payload);
        case SyscallType.FS_EXISTS:
          return this.fsExists(payload);
        case SyscallType.FS_REALPATH:
          return this.fsRealpath(payload);
        case SyscallType.FS_MKDTEMP:
          return this.fsMkdtemp(payload);
        case SyscallType.FS_APPENDFILE:
          return this.fsAppendFile(payload, binaryData);
        case SyscallType.FS_COPYFILE:
          return this.fsCopyFile(payload);
        case SyscallType.FS_UTIMES:
          return this.fsUtimes(payload);
        case SyscallType.FS_WATCH:
          return { data: { ok: true } };
        case SyscallType.PROCESS_SPAWN:
          return { data: { error: 'async_required' } };
        case SyscallType.PROCESS_KILL:
          if (this.processManager) {
            this.processManager.kill(payload.pid as number, payload.signal as number);
          }
          return { data: { ok: true } };
        case SyscallType.PROCESS_CWD:
          if (this.processManager) {
            return { data: { cwd: this.processManager.getCwd(pid ?? 0) } };
          }
          return { data: { cwd: '/home/project' } };
        case SyscallType.PROCESS_CHDIR:
          if (this.processManager) {
            this.processManager.chdir(pid ?? 0, payload.dir as string);
          }
          return { data: { ok: true } };
        case SyscallType.PROCESS_EXIT:
          if (this.processManager) {
            this.processManager.exit(pid ?? 0, payload.code as number);
          }
          return { data: { ok: true } };
        case SyscallType.NET_LISTEN:
          return { data: { ok: true } };
        case SyscallType.NET_CONNECT:
          return { data: { ok: true } };
        case SyscallType.NET_CLOSE:
          return { data: { ok: true } };
        default:
          return { error: { code: 'ENOSYS', message: `Unknown syscall: ${type}`, errno: -38 } };
      }
    } catch (e: any) {
      return {
        error: {
          code: e.code ?? 'UNKNOWN',
          message: e.message,
          errno: e.errno ?? -1,
        },
      };
    }
  }

  private fsReadFile(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    const encoding = payload.encoding as string | undefined;
    const result = this.vfs.readFile(path, encoding);
    if (typeof result === 'string') {
      return { data: { content: result } };
    }
    return { data: {}, binaryData: result };
  }

  private fsWriteFile(payload: Record<string, unknown>, binaryData?: Uint8Array | null): SyscallResult {
    const path = payload.path as string;
    const flag = payload.flag as string | undefined;
    const mode = payload.mode as number | undefined;
    const data = binaryData ?? (payload.content as string) ?? '';
    this.vfs.writeFile(path, data, { flag, mode });
    return { data: { ok: true } };
  }

  private fsStat(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    const s = this.vfs.stat(path);
    return {
      data: {
        dev: s.dev, ino: s.ino, mode: s.mode, nlink: s.nlink,
        uid: s.uid, gid: s.gid, rdev: s.rdev, size: s.size,
        blksize: s.blksize, blocks: s.blocks,
        atimeMs: s.atimeMs, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, birthtimeMs: s.birthtimeMs,
        isFile: s.isFile(), isDirectory: s.isDirectory(), isSymbolicLink: s.isSymbolicLink(),
      },
    };
  }

  private fsLstat(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    const s = this.vfs.lstat(path);
    return {
      data: {
        dev: s.dev, ino: s.ino, mode: s.mode, nlink: s.nlink,
        uid: s.uid, gid: s.gid, rdev: s.rdev, size: s.size,
        blksize: s.blksize, blocks: s.blocks,
        atimeMs: s.atimeMs, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, birthtimeMs: s.birthtimeMs,
        isFile: s.isFile(), isDirectory: s.isDirectory(), isSymbolicLink: s.isSymbolicLink(),
      },
    };
  }

  private fsReaddir(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    const withFileTypes = payload.withFileTypes as boolean | undefined;
    const result = this.vfs.readdir(path, { withFileTypes });
    if (withFileTypes) {
      const entries = (result as any[]).map(d => ({
        name: d.name,
        isFile: d.isFile(),
        isDirectory: d.isDirectory(),
        isSymbolicLink: d.isSymbolicLink(),
      }));
      return { data: { entries } };
    }
    return { data: { entries: result } };
  }

  private fsMkdir(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    const recursive = payload.recursive as boolean | undefined;
    const mode = payload.mode as number | undefined;
    this.vfs.mkdir(path, { recursive, mode });
    return { data: { ok: true } };
  }

  private fsRmdir(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    this.vfs.rmdir(path);
    return { data: { ok: true } };
  }

  private fsUnlink(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    this.vfs.unlink(path);
    return { data: { ok: true } };
  }

  private fsRename(payload: Record<string, unknown>): SyscallResult {
    const oldPath = payload.oldPath as string;
    const newPath = payload.newPath as string;
    this.vfs.rename(oldPath, newPath);
    return { data: { ok: true } };
  }

  private fsSymlink(payload: Record<string, unknown>): SyscallResult {
    const target = payload.target as string;
    const linkPath = payload.linkPath as string;
    this.vfs.symlink(target, linkPath);
    return { data: { ok: true } };
  }

  private fsReadlink(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    const target = this.vfs.readlink(path);
    return { data: { target } };
  }

  private fsChmod(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    const mode = payload.mode as number;
    this.vfs.chmod(path, mode);
    return { data: { ok: true } };
  }

  private fsAccess(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    const mode = payload.mode as number | undefined;
    this.vfs.access(path, mode);
    return { data: { ok: true } };
  }

  private fsExists(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    return { data: { exists: this.vfs.exists(path) } };
  }

  private fsRealpath(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    return { data: { resolvedPath: this.vfs.realpath(path) } };
  }

  private fsMkdtemp(payload: Record<string, unknown>): SyscallResult {
    const prefix = payload.prefix as string;
    return { data: { path: this.vfs.mkdtemp(prefix) } };
  }

  private fsAppendFile(payload: Record<string, unknown>, binaryData?: Uint8Array | null): SyscallResult {
    const path = payload.path as string;
    const data = binaryData ?? (payload.content as string) ?? '';
    this.vfs.appendFile(path, data);
    return { data: { ok: true } };
  }

  private fsCopyFile(payload: Record<string, unknown>): SyscallResult {
    const src = payload.src as string;
    const dest = payload.dest as string;
    this.vfs.copyFile(src, dest);
    return { data: { ok: true } };
  }

  private fsUtimes(payload: Record<string, unknown>): SyscallResult {
    const path = payload.path as string;
    const atime = payload.atime as number;
    const mtime = payload.mtime as number;
    this.vfs.utimes(path, atime, mtime);
    return { data: { ok: true } };
  }
}
