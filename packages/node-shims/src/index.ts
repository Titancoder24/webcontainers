export * as path from './path.js';
export * as fs from './fs.js';
export { Buffer } from './buffer.js';
export { EventEmitter } from './events.js';
export * as stream from './stream.js';
export * as os from './os.js';
export * as crypto from './crypto.js';
export * as util from './util.js';
export * as url from './url.js';
export * as assert from './assert.js';
export * as querystring from './querystring.js';
export * as string_decoder from './string_decoder.js';
export * as timers from './timers.js';
export { Console } from './console.js';
export * as http from './http.js';
export * as net from './net.js';
export * as child_process from './child_process.js';
export * as zlib from './zlib.js';
export * as tty from './tty.js';
export * as readline from './readline.js';
export { createRequire, registerBuiltin, clearModuleCache } from './module.js';

export const builtinModules: Record<string, () => any> = {
  fs: () => import('./fs.js'),
  path: () => import('./path.js'),
  buffer: () => import('./buffer.js'),
  events: () => import('./events.js'),
  stream: () => import('./stream.js'),
  os: () => import('./os.js'),
  crypto: () => import('./crypto.js'),
  util: () => import('./util.js'),
  url: () => import('./url.js'),
  assert: () => import('./assert.js'),
  querystring: () => import('./querystring.js'),
  string_decoder: () => import('./string_decoder.js'),
  timers: () => import('./timers.js'),
  console: () => import('./console.js'),
  http: () => import('./http.js'),
  net: () => import('./net.js'),
  child_process: () => import('./child_process.js'),
  zlib: () => import('./zlib.js'),
  tty: () => import('./tty.js'),
  readline: () => import('./readline.js'),
  module: () => import('./module.js'),
};
