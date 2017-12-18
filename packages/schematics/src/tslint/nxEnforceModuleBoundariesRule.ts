import * as path from 'path';
import * as Lint from 'tslint';
import { IOptions } from 'tslint';
import * as ts from 'typescript';
import { readFileSync } from 'fs';

export class Rule extends Lint.Rules.AbstractRule {
  constructor(options: IOptions, private path?: string, private npmScope?: string, private appNames?: string[]) {
    super(options);
    if (!path) {
      this.path = require('app-root-path').path;
      const cliConfig = this.readCliConfig(this.path);
      this.npmScope = cliConfig.project.npmScope;
      this.appNames = cliConfig.apps.map(a => a.name);
    }
  }

  public apply(sourceFile: ts.SourceFile): Lint.RuleFailure[] {
    return this.applyWithWalker(
      new EnforceModuleBoundariesWalker(sourceFile, this.getOptions(), this.path, this.npmScope, this.appNames)
    );
  }

  private readCliConfig(projectPath: string): any {
    return JSON.parse(readFileSync(`${projectPath}/.angular-cli.json`, 'UTF-8'));
  }
}

class EnforceModuleBoundariesWalker extends Lint.RuleWalker {
  constructor(
    sourceFile: ts.SourceFile,
    options: IOptions,
    private projectPath: string,
    private npmScope: string,
    private appNames: string[]
  ) {
    super(sourceFile, options);
  }

  public visitImportDeclaration(node: ts.ImportDeclaration) {
    const imp = node.moduleSpecifier.getText().substring(1, node.moduleSpecifier.getText().length - 1);
    const allow: string[] = Array.isArray(this.getOptions()[0].allow)
      ? this.getOptions()[0].allow.map(a => `${a}`)
      : [];
    const lazyLoad: string[] = Array.isArray(this.getOptions()[0].lazyLoad)
      ? this.getOptions()[0].lazyLoad.map(a => `${a}`)
      : [];

    // whitelisted import => return
    if (allow.indexOf(imp) > -1) {
      super.visitImportDeclaration(node);
      return;
    }

    const lazyLoaded = lazyLoad.filter(a => imp.startsWith(`@${this.npmScope}/${a}`))[0];
    if (lazyLoaded) {
      this.addFailureAt(node.getStart(), node.getWidth(), 'import of lazy-loaded libraries are forbidden');
      return;
    }

    if (this.isRelative(imp) && this.isRelativeImportIntoAnotherProject(imp)) {
      this.addFailureAt(node.getStart(), node.getWidth(), 'relative imports of libraries are forbidden');
      return;
    }

    const app = this.appNames.filter(a => imp.startsWith(`@${this.npmScope}/${a}`))[0];
    if (app && imp !== `@${this.npmScope}/${app}`) {
      this.addFailureAt(node.getStart(), node.getWidth(), 'deep imports into libraries are forbidden');
      return;
    }

    super.visitImportDeclaration(node);
  }

  private isRelativeImportIntoAnotherProject(imp: string): boolean {
    const sourceFile = this.getSourceFile().fileName.substring(this.projectPath.length);
    const targetFile = path.resolve(path.dirname(sourceFile), imp);
    if (this.workspacePath(sourceFile) && this.workspacePath(targetFile)) {
      if (this.parseProject(sourceFile) !== this.parseProject(targetFile)) {
        return true;
      }
    }
    return false;
  }

  private workspacePath(s: string): boolean {
    return s.startsWith('/apps/') || s.startsWith('/libs/');
  }

  private parseProject(s: string): string {
    const rest = s.substring(6);
    const r = rest.split(path.sep);
    return r[0];
  }

  private isRelative(s: string): boolean {
    return s.startsWith('.');
  }
}
