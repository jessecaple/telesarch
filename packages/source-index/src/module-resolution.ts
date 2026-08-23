import { realpathSync } from 'node:fs';
import { isAbsolute, join as joinPath, relative, sep } from 'node:path';

import type tsModule from 'typescript';

import { ts } from './typescript-module.js';

export type ResolvedModule =
  | { readonly kind: 'repository'; readonly path: string }
  | { readonly kind: 'external'; readonly packageName: string }
  | { readonly kind: 'unresolved' };

export interface ModuleResolver {
  resolve(fromAbsolutePath: string, specifier: string): ResolvedModule;
}

/**
 * Resolves import specifiers with the repository's real compiler options, so
 * workspace packages, export conditions, and path mappings resolve the way
 * the repository's own build resolves them.
 */
export function createModuleResolver(rootDirectory: string): ModuleResolver {
  const options = repositoryCompilerOptions(rootDirectory);
  const cache = ts.createModuleResolutionCache(
    rootDirectory,
    (fileName) => fileName,
    options,
  );
  const realPaths = new Map<string, string>();
  const realPath = (path: string): string => {
    const cached = realPaths.get(path);
    if (cached !== undefined) return cached;
    let resolved = path;
    try {
      resolved = realpathSync(path);
    } catch {
      resolved = path;
    }
    realPaths.set(path, resolved);
    return resolved;
  };
  return {
    resolve(fromAbsolutePath, specifier): ResolvedModule {
      const resolution = ts.resolveModuleName(
        specifier,
        fromAbsolutePath,
        options,
        ts.sys,
        cache,
      ).resolvedModule;
      if (resolution === undefined) {
        return isBareSpecifier(specifier)
          ? { kind: 'external', packageName: packageNameOf(specifier) }
          : { kind: 'unresolved' };
      }
      const resolvedPath = realPath(resolution.resolvedFileName);
      const relativePath = relative(rootDirectory, resolvedPath);
      if (
        !relativePath.startsWith('..') &&
        !isAbsolute(relativePath) &&
        !relativePath.split(sep).includes('node_modules')
      ) {
        return { kind: 'repository', path: relativePath.replaceAll(sep, '/') };
      }
      return {
        kind: 'external',
        packageName:
          resolution.packageId?.name ??
          (isBareSpecifier(specifier) ? packageNameOf(specifier) : specifier),
      };
    },
  };
}

function repositoryCompilerOptions(
  rootDirectory: string,
): tsModule.CompilerOptions {
  const defaults: tsModule.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowJs: true,
    resolveJsonModule: true,
  };
  for (const name of ['tsconfig.base.json', 'tsconfig.json']) {
    const path = joinPath(rootDirectory, name);
    if (!ts.sys.fileExists(path)) continue;
    const configuration = ts.readConfigFile(path, ts.sys.readFile);
    const raw = (
      configuration.config as
        | { compilerOptions?: Record<string, unknown> }
        | undefined
    )?.compilerOptions;
    if (raw === undefined) continue;
    const converted = ts.convertCompilerOptionsFromJson(
      raw,
      rootDirectory,
      path,
    );
    return { ...defaults, ...converted.options };
  }
  return defaults;
}

function isBareSpecifier(specifier: string): boolean {
  return (
    !specifier.startsWith('.') &&
    !specifier.startsWith('/') &&
    !specifier.startsWith('#')
  );
}

function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@') && segments.length > 1
    ? `${segments[0]}/${segments[1]}`
    : (segments[0] ?? specifier);
}
