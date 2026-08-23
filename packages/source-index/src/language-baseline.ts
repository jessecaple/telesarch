export type SourceFileKind =
  | 'source'
  | 'manifest'
  | 'configuration'
  | 'documentation'
  | 'asset'
  | 'other';

export type SourceFileCategory =
  | 'test'
  | 'story'
  | 'migration'
  | 'schema'
  | 'route';

export interface BaselineClassification {
  readonly language?: string;
  readonly kind: SourceFileKind;
  readonly category?: SourceFileCategory;
}

const languagesByExtension: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'css',
  html: 'html',
  md: 'markdown',
  sql: 'sql',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  sh: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
};

const manifestNames = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'cargo.toml',
  'cargo.lock',
  'go.mod',
  'go.sum',
  'pyproject.toml',
  'requirements.txt',
  'gemfile',
]);

const assetExtensions = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'ico',
  'webp',
  'woff',
  'woff2',
  'ttf',
  'mp3',
  'wav',
  'mp4',
]);

const documentationExtensions = new Set(['md', 'txt', 'rst', 'adoc']);

/** Deterministic language, kind, and artifact category for one path. */
export function classifyPath(path: string): BaselineClassification {
  const name = fileName(path).toLowerCase();
  const extension = fileExtension(name);
  const language = languagesByExtension[extension];
  return {
    ...(language === undefined ? {} : { language }),
    kind: fileKind(path, name, extension, language),
    ...categoryOf(path, name, language),
  };
}

/** Whether deep TypeScript and JavaScript analysis applies to this path. */
export function supportsDeepAnalysis(path: string): boolean {
  const language = languagesByExtension[fileExtension(fileName(path))];
  return language === 'typescript' || language === 'javascript';
}

function fileKind(
  path: string,
  name: string,
  extension: string,
  language: string | undefined,
): SourceFileKind {
  if (manifestNames.has(name)) return 'manifest';
  if (isConfiguration(path, name)) return 'configuration';
  if (documentationExtensions.has(extension)) return 'documentation';
  if (assetExtensions.has(extension)) return 'asset';
  if (language !== undefined) return 'source';
  return 'other';
}

function isConfiguration(path: string, name: string): boolean {
  return (
    /^tsconfig(\..+)?\.json$/.test(name) ||
    /\.config\.(ts|js|mjs|cjs|mts|json)$/.test(name) ||
    name.startsWith('.prettierrc') ||
    name.startsWith('.eslintrc') ||
    name === 'nx.json' ||
    name === '.editorconfig' ||
    name === '.gitignore' ||
    name === '.gitattributes' ||
    name === '.npmrc' ||
    path.startsWith('.github/') ||
    path.startsWith('.vscode/')
  );
}

function categoryOf(
  path: string,
  name: string,
  language: string | undefined,
): { readonly category?: SourceFileCategory } {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return { category: 'test' };
  if (/\.stories\.[cm]?[jt]sx?$/.test(name)) return { category: 'story' };
  if (/\.schema\.(json|[cm]?[jt]s)$/.test(name)) return { category: 'schema' };
  if (
    language !== undefined &&
    language !== 'markdown' &&
    /(^|\/)migrations\//.test(path)
  ) {
    return { category: 'migration' };
  }
  return {};
}

function fileName(path: string): string {
  const separator = path.lastIndexOf('/');
  return separator === -1 ? path : path.slice(separator + 1);
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1);
}
