import ts from 'typescript';
import path from 'node:path';
import type { AnalyzeParams } from '../core/model.js';

export function loadProject(params: AnalyzeParams): { program: ts.Program; file: ts.SourceFile } {
  const fileName = path.resolve(params.file);
  const config = params.tsconfig
    ? path.resolve(params.tsconfig)
    : ts.findConfigFile(path.dirname(fileName), ts.sys.fileExists, 'tsconfig.json');
  let options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.Preserve,
    allowJs: true, noEmit: true,
  };
  let rootNames = [fileName];
  let projectReferences: readonly ts.ProjectReference[] | undefined;
  if (config) {
    const read = ts.readConfigFile(config, ts.sys.readFile);
    if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(config));
    // The explicitly requested source is added below, including new unsaved files.
    // An otherwise empty include set is not an error for this analysis request.
    const configErrors = parsed.errors.filter(error => error.code !== 18003);
    if (configErrors.length) {
      throw new Error(configErrors.map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'));
    }
    options = { ...parsed.options, noEmit: true, disableSourceOfProjectReferenceRedirect: false };
    rootNames = [...new Set([...parsed.fileNames, fileName])];
    projectReferences = parsed.projectReferences;
  }
  const host: ts.CompilerHost & { useSourceOfProjectReferenceRedirect?: () => boolean } = ts.createCompilerHost(options, true);
  // Use the compiler's source-redirect hook (also used by its watch hosts) so a
  // referenced cursor file is not replaced by declaration output before overlaying.
  host.useSourceOfProjectReferenceRedirect = () => true;
  if (params.sourceText !== undefined) {
    const originalRead = host.readFile.bind(host);
    const originalExists = host.fileExists.bind(host);
    host.readFile = name => path.resolve(name) === fileName ? params.sourceText : originalRead(name);
    host.fileExists = name => path.resolve(name) === fileName || originalExists(name);
  }
  const program = ts.createProgram({ rootNames, options, host, projectReferences });
  const file = program.getSourceFile(fileName);
  if (!file) throw new Error(`Cannot read source file: ${fileName}`);
  const errors = program.getSyntacticDiagnostics(file);
  if (errors.length) throw new Error(`Cannot analyze malformed source: ${errors.map(e =>
    ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n')}`);
  return { program, file };
}
