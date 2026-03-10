/**
 * OS info shim for browser environment.
 */

export const EOL = '\n';

export function platform(): string {
  return 'linux';
}

export function arch(): string {
  return 'x64';
}

export function cpus(): { model: string; speed: number; times: { user: number; nice: number; sys: number; idle: number; irq: number } }[] {
  const numCpus = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  const result = [];
  for (let i = 0; i < numCpus; i++) {
    result.push({
      model: 'WebContainer Virtual CPU',
      speed: 2400,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    });
  }
  return result;
}

export function totalmem(): number {
  return 536870912; // 512 MB
}

export function freemem(): number {
  return 268435456; // 256 MB
}

export function homedir(): string {
  return '/home/project';
}

export function tmpdir(): string {
  return '/tmp';
}

export function hostname(): string {
  return 'webcontainer';
}

export function type(): string {
  return 'Linux';
}

export function release(): string {
  return '5.15.0';
}

export function endianness(): 'BE' | 'LE' {
  return 'LE';
}

export function uptime(): number {
  return typeof performance !== 'undefined' ? Math.floor(performance.now() / 1000) : 0;
}

export function loadavg(): [number, number, number] {
  return [0, 0, 0];
}

export function networkInterfaces(): Record<string, { address: string; netmask: string; family: string; mac: string; internal: boolean; cidr: string }[]> {
  return {
    lo: [
      {
        address: '127.0.0.1',
        netmask: '255.0.0.0',
        family: 'IPv4',
        mac: '00:00:00:00:00:00',
        internal: true,
        cidr: '127.0.0.1/8',
      },
    ],
  };
}

export function userInfo(): { uid: number; gid: number; username: string; homedir: string; shell: string } {
  return {
    uid: 1000,
    gid: 1000,
    username: 'project',
    homedir: '/home/project',
    shell: '/bin/sh',
  };
}

export default {
  EOL,
  platform,
  arch,
  cpus,
  totalmem,
  freemem,
  homedir,
  tmpdir,
  hostname,
  type,
  release,
  endianness,
  uptime,
  loadavg,
  networkInterfaces,
  userInfo,
};
