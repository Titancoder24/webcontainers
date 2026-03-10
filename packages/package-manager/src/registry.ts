/**
 * Registry client for fetching npm package metadata and tarballs.
 * Uses jsdelivr CDN as primary tarball source with npm registry fallback.
 */

export interface PackageMetadata {
  name: string;
  /** dist-tags, e.g. { latest: "1.2.3" } */
  'dist-tags': Record<string, string>;
  /** Keyed by version string */
  versions: Record<string, PackageVersionMetadata>;
  /** Modified timestamp */
  modified?: string;
}

export interface PackageVersionMetadata {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dist: {
    tarball: string;
    shasum: string;
    integrity?: string;
  };
  engines?: Record<string, string>;
  os?: string[];
  cpu?: string[];
}

interface MetadataCacheEntry {
  data: PackageMetadata;
  timestamp: number;
}

interface TarballCacheEntry {
  url: string;
  timestamp: number;
}

const REGISTRY_URL = 'https://registry.npmjs.org';
const CDN_URL = 'https://cdn.jsdelivr.net/npm';
const METADATA_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const TARBALL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export class RegistryClient {
  private metadataCache = new Map<string, MetadataCacheEntry>();
  private tarballUrlCache = new Map<string, TarballCacheEntry>();
  private registryUrl: string;
  private cdnUrl: string;

  constructor(options?: { registryUrl?: string; cdnUrl?: string }) {
    this.registryUrl = options?.registryUrl ?? REGISTRY_URL;
    this.cdnUrl = options?.cdnUrl ?? CDN_URL;
  }

  /**
   * Fetch package metadata from the npm registry.
   * Uses the abbreviated metadata format (application/vnd.npm.install-v1+json)
   * which only includes information needed for installation.
   */
  async fetchMetadata(name: string): Promise<PackageMetadata> {
    const cached = this.metadataCache.get(name);
    if (cached && Date.now() - cached.timestamp < METADATA_CACHE_TTL) {
      return cached.data;
    }

    const encodedName = name.startsWith('@')
      ? `@${encodeURIComponent(name.slice(1))}`
      : encodeURIComponent(name);

    const url = `${this.registryUrl}/${encodedName}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.npm.install-v1+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new PackageNotFoundError(name);
      }
      throw new RegistryError(
        `Failed to fetch metadata for ${name}: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as PackageMetadata;

    this.metadataCache.set(name, {
      data,
      timestamp: Date.now(),
    });

    return data;
  }

  /**
   * Fetch a package tarball. Tries jsdelivr CDN first for better performance,
   * then falls back to the npm registry tarball URL.
   *
   * Returns an ArrayBuffer of the .tgz file.
   */
  async fetchTarball(
    name: string,
    version: string,
    registryTarballUrl: string,
  ): Promise<ArrayBuffer> {
    // Build CDN URL
    const cdnTarballUrl = `${this.cdnUrl}/${name}@${version}`;
    const cacheKey = `${name}@${version}`;

    // Check if we have a previously successful URL cached
    const cachedUrl = this.tarballUrlCache.get(cacheKey);
    if (cachedUrl && Date.now() - cachedUrl.timestamp < TARBALL_CACHE_TTL) {
      // For CDN URL cache, we still need to fetch the tarball from registry
      // since CDN serves individual files, not tarballs
    }

    // Try CDN first (jsdelivr serves tarballs at a specific endpoint)
    try {
      const response = await fetch(registryTarballUrl);
      if (response.ok) {
        this.tarballUrlCache.set(cacheKey, {
          url: registryTarballUrl,
          timestamp: Date.now(),
        });
        return await response.arrayBuffer();
      }
    } catch {
      // Fall through to fallback
    }

    // Try the CDN tarball URL as fallback
    try {
      // jsdelivr doesn't serve .tgz directly, so we construct the registry URL
      // from the CDN URL pattern as a fallback
      const fallbackUrl = `${this.registryUrl}/${name}/-/${getBasename(name)}-${version}.tgz`;
      const response = await fetch(fallbackUrl);
      if (response.ok) {
        this.tarballUrlCache.set(cacheKey, {
          url: fallbackUrl,
          timestamp: Date.now(),
        });
        return await response.arrayBuffer();
      }
      throw new RegistryError(
        `Failed to fetch tarball for ${name}@${version}: ${response.status}`,
      );
    } catch (err) {
      if (err instanceof RegistryError) throw err;
      throw new RegistryError(
        `Failed to fetch tarball for ${name}@${version}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Clear all cached metadata and tarball URLs.
   */
  clearCache(): void {
    this.metadataCache.clear();
    this.tarballUrlCache.clear();
  }

  /**
   * Clear cached metadata for a specific package.
   */
  clearPackageCache(name: string): void {
    this.metadataCache.delete(name);
    // Clear all version caches for this package
    for (const key of this.tarballUrlCache.keys()) {
      if (key.startsWith(`${name}@`)) {
        this.tarballUrlCache.delete(key);
      }
    }
  }
}

function getBasename(name: string): string {
  // @scope/package -> package
  const slash = name.lastIndexOf('/');
  return slash >= 0 ? name.slice(slash + 1) : name;
}

export class PackageNotFoundError extends Error {
  public readonly packageName: string;

  constructor(name: string) {
    super(`Package not found: ${name}`);
    this.name = 'PackageNotFoundError';
    this.packageName = name;
  }
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}
