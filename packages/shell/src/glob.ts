/**
 * Basic glob expansion for the shell.
 *
 * Supports:
 * - `*`  – matches any sequence of characters except `/`
 * - `?`  – matches exactly one character except `/`
 * - `**` – matches zero or more directory levels (globstar)
 *
 * Uses the VFS readdir callback to discover actual files.
 */

/**
 * Callback that lists immediate children of a directory.
 * Returns an array of `{ name, isDirectory }` entries.
 */
export interface ReaddirEntry {
  name: string;
  isDirectory: boolean;
}

export type ReaddirFn = (dir: string) => ReaddirEntry[];

/**
 * Convert a glob pattern to a RegExp that matches a single path segment.
 * Does NOT handle `**` – that is handled at the directory-walk level.
 */
function segmentToRegExp(segment: string): RegExp {
  let re = '^';
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === '*') {
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else if ('[{()+^$.|\\'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re);
}

/**
 * Join path segments, handling leading `/`.
 */
function joinPath(base: string, child: string): string {
  if (base === '/') return '/' + child;
  return base + '/' + child;
}

/**
 * Expand a glob pattern against real filesystem entries.
 *
 * @param pattern - The glob pattern (e.g. `src/*.ts`, `**\/*.json`)
 * @param cwd     - The current working directory (absolute path)
 * @param readdir - Function to list directory contents
 * @returns An array of matching file paths (relative to cwd if pattern is relative)
 */
export function expandGlob(
  pattern: string,
  cwd: string,
  readdir: ReaddirFn,
): string[] {
  // If pattern has no glob meta-characters, return it unchanged
  if (!hasGlobChars(pattern)) {
    return [pattern];
  }

  const isAbsolute = pattern.startsWith('/');
  const baseDir = isAbsolute ? '/' : cwd;
  const segments = pattern.split('/').filter((s) => s.length > 0);

  const results: string[] = [];
  matchSegments(baseDir, segments, 0, readdir, results);

  if (results.length === 0) {
    // Bash behavior: if nothing matches, return the pattern literally
    return [pattern];
  }

  // Sort results for deterministic output
  results.sort();

  // If pattern was relative, strip the cwd prefix
  if (!isAbsolute) {
    const prefix = cwd === '/' ? '/' : cwd + '/';
    return results.map((r) => (r.startsWith(prefix) ? r.slice(prefix.length) : r));
  }

  return results;
}

/**
 * Check if a string contains any glob meta-characters.
 */
export function hasGlobChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '*' || ch === '?' || ch === '[') return true;
    // Skip escaped characters
    if (ch === '\\' && i + 1 < s.length) {
      i++;
    }
  }
  return false;
}

/**
 * Recursively match path segments against directory entries.
 */
function matchSegments(
  currentDir: string,
  segments: string[],
  segIdx: number,
  readdir: ReaddirFn,
  results: string[],
): void {
  if (segIdx >= segments.length) {
    // All segments matched – this path is a result
    results.push(currentDir);
    return;
  }

  const segment = segments[segIdx];

  // Handle globstar (`**`)
  if (segment === '**') {
    // `**` matches zero or more directory levels.
    // First try matching zero levels (skip the `**` segment)
    matchSegments(currentDir, segments, segIdx + 1, readdir, results);

    // Then recurse into every subdirectory
    let entries: ReaddirEntry[];
    try {
      entries = readdir(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;
      const childPath = joinPath(currentDir, entry.name);

      if (entry.isDirectory) {
        // Continue matching `**` from this subdirectory
        matchSegments(childPath, segments, segIdx, readdir, results);
      } else {
        // Non-directory: try matching the rest of the pattern
        matchSegments(childPath, segments, segIdx + 1, readdir, results);
      }
    }
    return;
  }

  // Normal segment (may contain * or ?)
  const re = segmentToRegExp(segment);

  let entries: ReaddirEntry[];
  try {
    entries = readdir(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;

    // Skip hidden files unless the pattern explicitly starts with '.'
    if (entry.name.startsWith('.') && !segment.startsWith('.')) continue;

    if (!re.test(entry.name)) continue;

    const childPath = joinPath(currentDir, entry.name);
    const isLastSegment = segIdx === segments.length - 1;

    if (isLastSegment) {
      results.push(childPath);
    } else {
      // More segments to match – child must be a directory
      if (entry.isDirectory) {
        matchSegments(childPath, segments, segIdx + 1, readdir, results);
      }
    }
  }
}
