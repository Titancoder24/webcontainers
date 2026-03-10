/**
 * Minimal semver implementation for resolving npm package versions.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const SEMVER_RE =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.+-]+))?(?:\+[a-zA-Z0-9.+-]+)?$/;

/**
 * Parse a semver version string into its components.
 */
export function parse(version: string): SemVer | null {
  const m = SEMVER_RE.exec(version.trim());
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prerelease: m[4] ? m[4].split('.') : [],
  };
}

/**
 * Compare two semver versions. Returns -1, 0, or 1.
 */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) {
    throw new Error(`Invalid semver: ${!pa ? a : b}`);
  }
  return compareParsed(pa, pb);
}

function compareParsed(pa: SemVer, pb: SemVer): -1 | 0 | 1 {
  // Compare major.minor.patch
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] > pb[key]) return 1;
    if (pa[key] < pb[key]) return -1;
  }

  // A version without prerelease has higher precedence than one with prerelease
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;

  // Compare prerelease identifiers
  const len = Math.min(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    if (ai === bi) continue;

    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);

    if (aNum && bNum) {
      const diff = parseInt(ai, 10) - parseInt(bi, 10);
      if (diff > 0) return 1;
      if (diff < 0) return -1;
    } else if (aNum) {
      // Numeric identifiers always have lower precedence than string
      return -1;
    } else if (bNum) {
      return 1;
    } else {
      if (ai > bi) return 1;
      if (ai < bi) return -1;
    }
  }

  // The one with more prerelease fields has higher precedence
  if (pa.prerelease.length > pb.prerelease.length) return 1;
  if (pa.prerelease.length < pb.prerelease.length) return -1;

  return 0;
}

/**
 * Check if a version satisfies a single comparator (not a full range).
 */
function satisfiesComparator(parsed: SemVer, comparator: string): boolean {
  comparator = comparator.trim();
  if (!comparator || comparator === '*' || comparator === 'x' || comparator === 'X') {
    return true;
  }

  // Handle >=, <=, >, <, = prefixes
  if (comparator.startsWith('>=')) {
    return compareToRange(parsed, comparator.slice(2)) >= 0;
  }
  if (comparator.startsWith('<=')) {
    return compareToRange(parsed, comparator.slice(2)) <= 0;
  }
  if (comparator.startsWith('>')) {
    return compareToRange(parsed, comparator.slice(1)) > 0;
  }
  if (comparator.startsWith('<')) {
    return compareToRange(parsed, comparator.slice(1)) < 0;
  }
  if (comparator.startsWith('=')) {
    return compareToRange(parsed, comparator.slice(1)) === 0;
  }

  // Tilde range: ~1.2.3 allows >=1.2.3 <1.3.0
  if (comparator.startsWith('~')) {
    return satisfiesTilde(parsed, comparator.slice(1));
  }

  // Caret range: ^1.2.3 allows >=1.2.3 <2.0.0
  if (comparator.startsWith('^')) {
    return satisfiesCaret(parsed, comparator.slice(1));
  }

  // Hyphen range: 1.2.3 - 2.3.4
  if (comparator.includes(' - ')) {
    const [low, high] = comparator.split(' - ', 2);
    return compareToRange(parsed, low.trim()) >= 0 && compareToRange(parsed, high.trim()) <= 0;
  }

  // X-ranges: 1.x, 1.2.x, 1.*, etc.
  if (/[xX*]/.test(comparator)) {
    return satisfiesXRange(parsed, comparator);
  }

  // Partial version: "1" means >=1.0.0 <2.0.0, "1.2" means >=1.2.0 <1.3.0
  const parts = comparator.split('.');
  if (parts.length === 1) {
    const major = parseInt(parts[0], 10);
    if (!isNaN(major)) {
      return parsed.major === major;
    }
  }
  if (parts.length === 2) {
    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);
    if (!isNaN(major) && !isNaN(minor)) {
      return parsed.major === major && parsed.minor === minor;
    }
  }

  // Exact match
  return compareToRange(parsed, comparator) === 0;
}

function compareToRange(parsed: SemVer, rangeVersion: string): -1 | 0 | 1 {
  rangeVersion = rangeVersion.trim();
  const rv = parse(rangeVersion);
  if (rv) {
    return compareParsed(parsed, rv);
  }
  // Try partial versions
  const parts = rangeVersion.split('.').map((p) => parseInt(p, 10));
  if (parts.length >= 1 && !isNaN(parts[0])) {
    if (parsed.major !== parts[0]) return parsed.major > parts[0] ? 1 : -1;
    if (parts.length >= 2 && !isNaN(parts[1])) {
      if (parsed.minor !== parts[1]) return parsed.minor > parts[1] ? 1 : -1;
      if (parts.length >= 3 && !isNaN(parts[2])) {
        if (parsed.patch !== parts[2]) return parsed.patch > parts[2] ? 1 : -1;
      }
    }
  }
  return 0;
}

function satisfiesTilde(parsed: SemVer, rangeStr: string): boolean {
  rangeStr = rangeStr.trim();
  const parts = rangeStr.split('.').map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts.length > 1 ? parts[1] : NaN;
  const patch = parts.length > 2 ? parts[2] : NaN;

  if (parsed.major !== major) return false;

  if (!isNaN(minor)) {
    if (parsed.minor !== minor) return false;
    if (!isNaN(patch)) {
      return parsed.patch >= patch;
    }
    return true;
  }

  // ~1 means >=1.0.0 <2.0.0
  return true;
}

function satisfiesCaret(parsed: SemVer, rangeStr: string): boolean {
  rangeStr = rangeStr.trim();
  const rv = parse(rangeStr) ?? parsePartial(rangeStr);
  if (!rv) return false;

  // For caret, the leftmost non-zero digit must not change
  if (rv.major !== 0) {
    // ^1.2.3 := >=1.2.3 <2.0.0
    return (
      parsed.major === rv.major &&
      compareParsed(parsed, rv) >= 0
    );
  }
  if (rv.minor !== 0) {
    // ^0.2.3 := >=0.2.3 <0.3.0
    return (
      parsed.major === 0 &&
      parsed.minor === rv.minor &&
      compareParsed(parsed, rv) >= 0
    );
  }
  // ^0.0.3 := >=0.0.3 <0.0.4
  return (
    parsed.major === 0 &&
    parsed.minor === 0 &&
    parsed.patch === rv.patch &&
    compareParsed(parsed, rv) >= 0
  );
}

function parsePartial(s: string): SemVer | null {
  const parts = s.trim().split('.');
  const major = parseInt(parts[0], 10);
  if (isNaN(major)) return null;
  const minor = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  const patch = parts.length > 2 ? parseInt(parts[2], 10) : 0;
  return { major, minor: isNaN(minor) ? 0 : minor, patch: isNaN(patch) ? 0 : patch, prerelease: [] };
}

function satisfiesXRange(parsed: SemVer, range: string): boolean {
  const parts = range.trim().split('.');
  const isWild = (p: string) => p === 'x' || p === 'X' || p === '*';

  if (parts.length === 0 || isWild(parts[0])) return true;
  const major = parseInt(parts[0], 10);
  if (parsed.major !== major) return false;

  if (parts.length < 2 || isWild(parts[1])) return true;
  const minor = parseInt(parts[1], 10);
  if (parsed.minor !== minor) return false;

  if (parts.length < 3 || isWild(parts[2])) return true;
  const patch = parseInt(parts[2], 10);
  return parsed.patch === patch;
}

/**
 * Test if a version satisfies a semver range expression.
 * Supports ^, ~, >=, <=, >, <, =, x-ranges, hyphen ranges, || for unions,
 * and space-separated intersection.
 */
export function satisfies(version: string, range: string): boolean {
  const parsed = parse(version);
  if (!parsed) return false;

  range = range.trim();

  // || splits into alternative range sets (union)
  const orSets = range.split('||');
  return orSets.some((orSet) => {
    // Within an OR set, space-separated comparators are intersected
    // But we need to handle hyphen ranges first (they contain spaces)
    const trimmed = orSet.trim();

    // Check for hyphen range
    if (trimmed.includes(' - ')) {
      return satisfiesComparator(parsed, trimmed);
    }

    // Split on whitespace for intersection
    const comparators = trimmed.split(/\s+/).filter(Boolean);

    // Merge consecutive comparators that form compound ranges like ">= 1.0.0 < 2.0.0"
    return comparators.every((comp) => satisfiesComparator(parsed, comp));
  });
}

/**
 * Given an array of version strings and a range, return the highest version
 * that satisfies the range, or null if none match.
 */
export function maxSatisfying(versions: string[], range: string): string | null {
  let best: string | null = null;
  let bestParsed: SemVer | null = null;

  for (const v of versions) {
    if (!satisfies(v, range)) continue;

    const p = parse(v);
    if (!p) continue;

    if (!bestParsed || compareParsed(p, bestParsed) > 0) {
      best = v;
      bestParsed = p;
    }
  }

  return best;
}
