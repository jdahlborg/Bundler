import {
  path,
  colors,
  fs,
  Sha256,
  ImportMap,
  resolveWithImportMap,
} from "./deps.ts";

import {
  getDependencies,
  resolve as resolveDependencyPath,
} from "./dependencies.ts";
import { isURL } from "./_helpers.ts";

const { exists, existsSync, writeJson, ensureFile } = fs;
const { green } = colors;

/**
 * API for rust cache_dir
 */
function cachedir(): string {
  const env = Deno.env;
  const os = Deno.build.os;

  const deno = env.get("DENO_DIR");

  if (deno) return path.resolve(deno);

  let home: string | undefined;
  let cachedir: string;
  const POSIX_HOME = "HOME";

  switch (os) {
    case "linux": {
      const xdg = env.get("XDG_CACHE_HOME");
      home = xdg ?? env.get(POSIX_HOME);
      cachedir = xdg ? "deno" : path.join(".cache", "deno");
      break;
    }
    case "darwin":
      home = env.get(POSIX_HOME);
      cachedir = path.join("Library", "Caches", "deno");
      break;

    case "windows":
      home = env.get("LOCALAPPDATA");
      home = home ?? env.get("USERPROFILE");
      cachedir = "deno";
      break;
  }

  cachedir = home ? cachedir : ".deno";
  if (!home) return cachedir;
  return path.resolve(path.join(home, cachedir));
}

/**
 * creates path to cache file of a path
 * @param url 
 */
function createCacheModulePathForURL(url: string) {
  const fileUrl = new URL(url);
  const hash = new Sha256().update(fileUrl.pathname).hex();
  return path.join(
    cachedir(),
    "deps",
    fileUrl.protocol.replace(":", ""),
    fileUrl.hostname,
    hash,
  );
}

/**
 * resolves path to cache file of a path. Returns null if path is not cached
 * @param path 
 */
export function resolve(url: string): string {
  if (!isURL(url)) return url;
  return createCacheModulePathForURL(url);
}

/**
 * API for deno cache
 * Fetches path files recusively and caches them to deno cache dir.
 */
export async function cache(
  specifier: string,
  { importMap = { imports: {} }, reload = false }: {
    importMap?: ImportMap;
    reload?: boolean | string;
  } = {},
) {
  if (!isURL(specifier)) return;

  const fragments = typeof reload === "string" ? reload.split(",") : null;
  function needsReload(specifier: string) {
    return fragments ? fragments.includes(specifier) : reload;
  }

  const queue = [specifier];
  while (queue.length) {
    const specifier = queue.pop()!;
    const resolvedSpecifier = resolveWithImportMap(specifier, importMap);
    const cachedFilePath = createCacheModulePathForURL(resolvedSpecifier);

    let source: string;
    if (needsReload(resolvedSpecifier) || !await exists(cachedFilePath)) {
      console.log(green("Download"), resolvedSpecifier);
      const response = await fetch(resolvedSpecifier, { redirect: "follow" });
      source = await response.text();
      const headers: { [key: string]: string } = {};
      for (const [key, value] of response.headers) headers[key] = value;
      const metaFilePath = `${cachedFilePath}.metadata.json`;
      await ensureFile(cachedFilePath);
      await Deno.writeTextFile(cachedFilePath, source);
      await writeJson(
        metaFilePath,
        { url: resolvedSpecifier, headers },
        { spaces: "  " },
      );
    } else {
      source = await Deno.readTextFile(cachedFilePath);
    }

    const dependencyMap = await getDependencies(source);

    queue.push(
      ...dependencyMap.map((dependency) =>
        resolveDependencyPath(specifier, dependency)
      ),
    );
  }
}
