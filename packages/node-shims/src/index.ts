/**
 * Node.js built-in module shims for WebContainers.
 * Exports a builtinModules map and all individual modules.
 */

import * as fs from './fs.js';
import * as path from './path.js';
import * as buffer from './buffer.js';
import * as events from './events.js';
import * as stream from './stream.js';
import * as os from './os.js';
import * as crypto from './crypto.js';
import * as util from './util.js';
import * as url from './url.js';
import * as assert from './assert.js';
import * as querystring from './querystring.js';
import * as string_decoder from './string_decoder.js';
import * as timers from './timers.js';
import * as consoleModule from './console.js';
import * as http from './http.js';
import * as net from './net.js';
import * as child_process from './child_process.js';
import * as zlib from './zlib.js';
import * as tty from './tty.js';
import * as readline from './readline.js';
import * as moduleShim from './module.js';

export const builtinModules: Record<string, unknown> = {
  fs,
  path,
  buffer,
  events,
  stream,
  os,
  crypto,
  util,
  url,
  assert,
  querystring,
  string_decoder,
  timers,
  console: consoleModule,
  http,
  net,
  child_process,
  zlib,
  tty,
  readline,
  module: moduleShim,
};

export {
  fs,
  path,
  buffer,
  events,
  stream,
  os,
  crypto,
  util,
  url,
  assert,
  querystring,
  string_decoder,
  timers,
  consoleModule as console,
  http,
  net,
  child_process,
  zlib,
  tty,
  readline,
  moduleShim as module,
};

/**
 * Install builtin modules on globalThis so that the module loader can find them.
 */
export function installBuiltins(): void {
  const g = globalThis as unknown as { __builtinModules?: Record<string, unknown> };
  g.__builtinModules = builtinModules;
}
