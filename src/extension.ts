"use strict";
import * as vscode from "vscode";
import { existsSync, readFileSync } from "fs";
import * as path from "path";
import findRelatedFilesForCurrentPath from "./utils/find-related-files-for-current-path";
import { createSourceFile, ScriptTarget } from "typescript";
import { buildPaths } from 'ember-module-path-builder';

// this is naive regex for variable name. let's see how much mileage it gets
const COMPONENT_TEMPLATE_MODULE_REGEX = new RegExp(
  `^${path.sep}?templates${path.sep}components${path.sep}`
);
const invalidVarCharacterRegex = /[^[$a-zA-Z0-9-_]/;
const sep = path.sep;

export function activate(context: vscode.ExtensionContext) {
  let emberGoToRelatedFile = vscode.commands.registerCommand(
    "extension.findRelatedFiles",
    () => {
      const { activeTextEditor } = vscode.window;
      if (activeTextEditor) {
        const workspaceRoot = normalizeTrailingSlash(vscode.workspace.rootPath);
        const relativePath = vscode.workspace.asRelativePath(
          activeTextEditor.document.fileName
        );
        const relatedFiles = findRelatedFilesForCurrentPath(
          workspaceRoot,
          relativePath
        );

        if (!relatedFiles) {
          vscode.window.showWarningMessage("Sorry, no related files found");
          return;
        }

        vscode.window.showQuickPick(relatedFiles).then(selectedItem => {
          if (!selectedItem) {
            return;
          }
          const absolutePath = selectedItem.getAbsolutePath();
          vscode.workspace.openTextDocument(absolutePath).then(textDocument => {
            const visibleEditor = vscode.window.visibleTextEditors.find(
              visibleEditor => {
                return visibleEditor.document.uri.path === absolutePath;
              }
            );
            const columnBeside = -2;
            const viewColumn =
              (visibleEditor && visibleEditor.viewColumn) || columnBeside;
            vscode.window.showTextDocument(textDocument, viewColumn);
          });
        });
      }
    }
  );

  class EmberDefinitionProvider implements vscode.DefinitionProvider {
    public provideDefinition(
      document: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken
    ): Thenable<vscode.Location[]> | Thenable<null> {
      const currentFileName = document.fileName;
      const currentFileExtension = path.extname(currentFileName);
      const textLineUnderCursor = document.lineAt(position.line).text;
      const currentColumnPosition = position.character;
      const currentFileFullText = document.getText();
      let {
        projectRoot,
        extraAddonSources,
        addonNameAliases,
        appNamespace,
      } = vscode.workspace.getConfiguration("ember-goto");

      if (!projectRoot) {
        projectRoot = vscode.workspace.rootPath;
      }

      let jsconfig;

      try {
        jsconfig = JSON.parse(readFileSync(path.join(projectRoot, 'jsconfig.json'), 'utf8'));
      } catch(e) {
        // show some message?
        console.log(e);
      }

      let symbolUnderCursor = '';
      let baseModuleName = '';
      let absolutePathCandidates: string[] = [];

      // if its a javascript file, we need to parse the import statements to extract the path to the module
      if (currentFileExtension === ".js") {
        const ast = createSourceFile(
          currentFileName,
          currentFileFullText,
          ScriptTarget.Latest
        );
        symbolUnderCursor = getModuleNameUnderCursor(
          currentFileName,
          textLineUnderCursor,
          currentColumnPosition
        );
        ast.statements.find((statement: any) => {
          if (statement.importClause && statement.importClause.namedBindings) {
            return statement.importClause.namedBindings.elements.find(
              (element: any) => {
                if (element.name && element.name.text === symbolUnderCursor) {
                  baseModuleName = statement.moduleSpecifier.text;
                  return true;
                }
              }
            );
          } else if (
            statement.importClause &&
            statement.importClause.name &&
            statement.importClause.name.text === symbolUnderCursor
          ) {
            baseModuleName = statement.moduleSpecifier.text;
            return true;
          }
        });

        const baseModuleNameSegments = baseModuleName.split(path.sep);
        let addonNamespace = '';
        if (baseModuleName.startsWith('.')) {
          // if it is a relative path, just the let the editor try to figure it out
          return Promise.resolve(null);
        } else {
          addonNamespace = addonNameAliases[baseModuleNameSegments[0]] || baseModuleNameSegments[0];
        }

        if (jsconfig && jsconfig.compilerOptions && jsconfig.compilerOptions.paths) {
          if (jsconfig.compilerOptions.paths[`${addonNamespace}/*`]) {
            // don't conflict with jsconfig settings
            return Promise.resolve(null);
          }
        }

        baseModuleName = path.join(...baseModuleNameSegments.slice(1));
        absolutePathCandidates = buildPaths(projectRoot, appNamespace, addonNamespace, baseModuleName, extraAddonSources);
      } else if (currentFileExtension === '.hbs') {
        // this means "Go to definition" was invoked in a template, so we must
        // be searching for either a component or a helper file
        const componentNameUnderCursor = getComponentNameUnderCursor(
          textLineUnderCursor,
          currentColumnPosition
        );
        let addonNamespace = getComponentNameSpace(componentNameUnderCursor, currentFileName) || appNamespace;
        addonNamespace = addonNameAliases[addonNamespace] || addonNamespace;
        baseModuleName = convertComponentNameToModuleName(
          componentNameUnderCursor,
          currentFileName
        );
        absolutePathCandidates = buildPaths(projectRoot, appNamespace, addonNamespace, baseModuleName, extraAddonSources);
        // It could be a template helper invocation, so we build helper paths as well
        const templateHelperModuleName = baseModuleName.replace(COMPONENT_TEMPLATE_MODULE_REGEX, `helpers${path.sep}`);
        const templateHelperPaths = buildPaths(projectRoot, appNamespace, addonNamespace, templateHelperModuleName, extraAddonSources);
        absolutePathCandidates = absolutePathCandidates.concat(templateHelperPaths);
      }

      const existingFiles = absolutePathCandidates.filter(existsSync);

      if (!existingFiles.length) {
        return Promise.resolve(null);
      }

      const locations: vscode.Location[] = [];
      for (let i = 0; i < existingFiles.length; i++) {
        const file = vscode.Uri.file(existingFiles[i]);
        // try to find symbol position in the target file
          return vscode.workspace.openTextDocument(file).then(doc => {
            const lineCount = doc.lineCount;
            for (let i = 0; i < lineCount; i++) {
              const currentLine = doc.lineAt(i).text;
              const regex = new RegExp(`export.*${symbolUnderCursor}(\\s|[(])+`);
              if (regex.test(currentLine)) {
                const pos = new vscode.Position(i, 0);
                const location = new vscode.Location(file, pos);
                locations.push(location);
              }
            }

            // if we could not find any named export, look for export default
            // TODO: find a way to do this without looping twice. We should
            // ideally determine whether the symbol is a default export or a
            // named export at the time of parsing the symbol
            if (!locations.length) {
                for (let i = 0; i < lineCount; i++) {
                    const currentLine = doc.lineAt(i).text;
                    const regex = new RegExp('export default');
                    if (regex.test(currentLine)) {
                        const pos = new vscode.Position(i, 0);
                        const location = new vscode.Location(file, pos);
                        locations.push(location);
                    }
                }
            }

            // if we couldn't find the symbol or a default export, just set the
            // position to first line
            if (!locations.length) {
                const pos = new vscode.Position(i, 0);
                const location = new vscode.Location(file, pos);
                locations.push(location);
            }

            return locations;
        });
      }

      return Promise.resolve(null);
    }
  }
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      { scheme: "file" },
      new EmberDefinitionProvider()
    )
  );

  context.subscriptions.push(emberGoToRelatedFile);
}

function normalizeTrailingSlash(rootPath: string = ""): string {
  if (rootPath.charAt(rootPath.length - 1) === sep) {
    return rootPath;
  }

  return `${rootPath}${sep}`;
}

function getModuleNameUnderCursor(
  fileName: string,
  textLine: string,
  cursorPosition: number
): string {
  let result = "";
  if (path.extname(fileName) === ".hbs") {
    const componentNameUnderCursor = getComponentNameUnderCursor(
      textLine,
      cursorPosition
    );
    result = convertComponentNameToModuleName(
      componentNameUnderCursor,
      fileName
    );
  }

  if (path.extname(fileName) === ".js") {
    return convertImportStringToModuleName(textLine, cursorPosition);
  }

  return result;
}

function convertImportStringToModuleName(
  currentLine: string,
  cursorIdx: number
): string {
  const textAfterCursor = currentLine.substring(cursorIdx);
  const textBeforeCursor = currentLine.substring(0, cursorIdx);
  const endOfFileNameIdx = textAfterCursor.search(invalidVarCharacterRegex);
  const reversedSegment = textBeforeCursor
    .split("")
    .reverse()
    .join("");
  const startOfFileNameIdx = reversedSegment.search(invalidVarCharacterRegex);
  const fileNameStart = reversedSegment
    .substring(0, startOfFileNameIdx)
    .split("")
    .reverse()
    .join("");
  const fileNameEnd = textAfterCursor.substring(0, endOfFileNameIdx);

  return fileNameStart.concat(fileNameEnd);
}

function getComponentNameUnderCursor(
  currentLine: string,
  cursorIdx: number
): string {
  const textAfterCursor = currentLine.substring(cursorIdx);
  const textBeforeCursor = currentLine.substring(0, cursorIdx);
  const whiteSpaceDelimiterIdx = textAfterCursor.search(/\s+/);
  const endOfComponentNameIdx =
    whiteSpaceDelimiterIdx !== -1
      ? whiteSpaceDelimiterIdx
      : textAfterCursor.length;
  const reversedSegment = textBeforeCursor
    .split("")
    .reverse()
    .join("");
  const startOfComponentNameIdx = reversedSegment.search(/[#{(]/);
  const fileNameStart = reversedSegment
    .substring(0, startOfComponentNameIdx)
    .split("")
    .reverse()
    .join("");
  const fileNameEnd = textAfterCursor.substring(0, endOfComponentNameIdx);

  // NOTE: the replace handles the case were the cursor was on a closing curly "tag"
  return fileNameStart.concat(fileNameEnd).replace(/^\/|}+$/g, "");
}

function convertComponentNameToModuleName(
  componentName: string,
  currentFileName: string
): string {
  // strip namespace if it exists
  const cleanComponentName = componentName.replace(/^.*::/, "");
  return `templates${sep}components${sep}${cleanComponentName}`;
}

function getComponentNameSpace(
  componentName: string,
  fileName: string
): string {
  const hasNameSpace = componentName.includes("::");

  if (hasNameSpace) {
    return componentName.split("::")[0];
  }

  const fileNameParts = fileName.split(path.sep);
  for (let i = fileNameParts.length - 1; i > 0; i--) {
    if (/addon/.test(fileNameParts[i])) {
      return fileNameParts[i - 1];
    }
  }

  return "";
}
// this method is called when your extension is deactivated
export function deactivate() {}
