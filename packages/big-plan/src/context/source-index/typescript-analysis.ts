import type tsModule from 'typescript';

import { ts } from './typescript-module.js';

export interface AnalyzedImport {
  readonly specifier: string;
  readonly kind: 'import' | 'export' | 'dynamic-import' | 'require';
  /** Imported binding names; '*' for a namespace, 'default' for the default. */
  readonly names: readonly string[];
  readonly line: number;
  /** Local binding names introduced by this import, for call resolution. */
  readonly localNames: readonly string[];
}

export interface AnalyzedExport {
  readonly name: string;
  readonly localName?: string;
  readonly kind: 'named' | 'default' | 're-export' | 'namespace';
  readonly fromSpecifier?: string;
  readonly line: number;
}

export interface AnalyzedDeclaration {
  readonly name: string;
  readonly kind:
    | 'function'
    | 'class'
    | 'interface'
    | 'type'
    | 'enum'
    | 'variable'
    | 'namespace';
  readonly exported: boolean;
  readonly line: number;
  readonly endLine: number;
}

export interface AnalyzedCall {
  readonly callerName?: string;
  readonly calleeName: string;
  readonly line: number;
}

export interface ModuleAnalysis {
  readonly imports: readonly AnalyzedImport[];
  readonly exports: readonly AnalyzedExport[];
  readonly declarations: readonly AnalyzedDeclaration[];
  readonly calls: readonly AnalyzedCall[];
}

/**
 * Deterministic single-file structural analysis: imports, exports, top-level
 * declarations, and syntactically resolvable call relationships.
 */
export function analyzeModule(
  fileName: string,
  content: string,
): ModuleAnalysis {
  const source = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  );
  const imports: AnalyzedImport[] = [];
  const exports: AnalyzedExport[] = [];
  const declarations: AnalyzedDeclaration[] = [];
  const calls: AnalyzedCall[] = [];
  const line = (node: tsModule.Node): number =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const endLine = (node: tsModule.Node): number =>
    source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;

  for (const statement of source.statements) {
    collectImport(statement, imports, exports, line);
    collectDeclaration(statement, declarations, exports, line, endLine);
  }

  const enclosing: string[] = [];
  const visit = (node: tsModule.Node): void => {
    const name = enclosingName(node);
    if (name !== undefined) enclosing.push(name);
    if (ts.isCallExpression(node)) collectCall(node, imports, calls, line);
    ts.forEachChild(node, visit);
    if (name !== undefined) enclosing.pop();
  };
  const collectCall = (
    node: tsModule.CallExpression,
    moduleImports: AnalyzedImport[],
    moduleCalls: AnalyzedCall[],
    lineOf: (node: tsModule.Node) => number,
  ): void => {
    const argument = node.arguments[0];
    if (
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      argument !== undefined &&
      ts.isStringLiteralLike(argument)
    ) {
      moduleImports.push({
        specifier: argument.text,
        kind: 'dynamic-import',
        names: [],
        localNames: [],
        line: lineOf(node),
      });
      return;
    }
    if (
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      argument !== undefined &&
      ts.isStringLiteralLike(argument)
    ) {
      moduleImports.push({
        specifier: argument.text,
        kind: 'require',
        names: [],
        localNames: [],
        line: lineOf(node),
      });
      return;
    }
    const calleeName = simpleCalleeName(node.expression);
    if (calleeName === undefined) return;
    const caller = enclosing[enclosing.length - 1];
    moduleCalls.push({
      ...(caller === undefined ? {} : { callerName: caller }),
      calleeName,
      line: lineOf(node),
    });
  };
  visit(source);

  return { imports, exports, declarations, calls };
}

function collectImport(
  statement: tsModule.Statement,
  imports: AnalyzedImport[],
  exports: AnalyzedExport[],
  line: (node: tsModule.Node) => number,
): void {
  if (
    ts.isImportDeclaration(statement) &&
    ts.isStringLiteralLike(statement.moduleSpecifier)
  ) {
    const names: string[] = [];
    const localNames: string[] = [];
    const clause = statement.importClause;
    if (clause?.name !== undefined) {
      names.push('default');
      localNames.push(clause.name.text);
    }
    if (clause?.namedBindings !== undefined) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        names.push('*');
        localNames.push(clause.namedBindings.name.text);
      } else {
        for (const element of clause.namedBindings.elements) {
          names.push((element.propertyName ?? element.name).text);
          localNames.push(element.name.text);
        }
      }
    }
    imports.push({
      specifier: statement.moduleSpecifier.text,
      kind: 'import',
      names,
      localNames,
      line: line(statement),
    });
    return;
  }
  if (ts.isExportDeclaration(statement)) {
    const specifier =
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
    const elements =
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements
        : undefined;
    if (specifier !== undefined) {
      imports.push({
        specifier,
        kind: 'export',
        names: elements?.map(
          (element) => (element.propertyName ?? element.name).text,
        ) ?? ['*'],
        localNames: [],
        line: line(statement),
      });
    }
    for (const element of elements ?? []) {
      exports.push({
        name: element.name.text,
        ...(element.propertyName === undefined
          ? {}
          : { localName: element.propertyName.text }),
        kind: specifier === undefined ? 'named' : 're-export',
        ...(specifier === undefined ? {} : { fromSpecifier: specifier }),
        line: line(element),
      });
    }
    if (elements === undefined && specifier !== undefined) {
      exports.push({
        name: '*',
        kind: 'namespace',
        fromSpecifier: specifier,
        line: line(statement),
      });
    }
    return;
  }
  if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
    exports.push({ name: 'default', kind: 'default', line: line(statement) });
  }
}

function collectDeclaration(
  statement: tsModule.Statement,
  declarations: AnalyzedDeclaration[],
  exports: AnalyzedExport[],
  line: (node: tsModule.Node) => number,
  endLine: (node: tsModule.Node) => number,
): void {
  const exported = hasExportModifier(statement);
  const isDefault = hasDefaultModifier(statement);
  const record = (
    name: string,
    kind: AnalyzedDeclaration['kind'],
    node: tsModule.Node,
  ): void => {
    declarations.push({
      name,
      kind,
      exported,
      line: line(node),
      endLine: endLine(node),
    });
    if (exported) {
      exports.push({
        name: isDefault ? 'default' : name,
        ...(isDefault ? { localName: name } : {}),
        kind: isDefault ? 'default' : 'named',
        line: line(node),
      });
    }
  };
  if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
    record(statement.name.text, 'function', statement);
  } else if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
    record(statement.name.text, 'class', statement);
  } else if (ts.isInterfaceDeclaration(statement)) {
    record(statement.name.text, 'interface', statement);
  } else if (ts.isTypeAliasDeclaration(statement)) {
    record(statement.name.text, 'type', statement);
  } else if (ts.isEnumDeclaration(statement)) {
    record(statement.name.text, 'enum', statement);
  } else if (
    ts.isModuleDeclaration(statement) &&
    ts.isIdentifier(statement.name)
  ) {
    record(statement.name.text, 'namespace', statement);
  } else if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        record(declaration.name.text, 'variable', declaration);
      }
    }
  }
}

function enclosingName(node: tsModule.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
    return node.name.text;
  }
  if (
    (ts.isMethodDeclaration(node) || ts.isGetAccessor(node)) &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text;
  }
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }
  return undefined;
}

function simpleCalleeName(expression: tsModule.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    ts.isIdentifier(expression.name)
  ) {
    return `${expression.expression.text}.${expression.name.text}`;
  }
  return undefined;
}

function hasExportModifier(statement: tsModule.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function hasDefaultModifier(statement: tsModule.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
    )
  );
}

function scriptKind(fileName: string): tsModule.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (
    fileName.endsWith('.js') ||
    fileName.endsWith('.mjs') ||
    fileName.endsWith('.cjs')
  ) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}
