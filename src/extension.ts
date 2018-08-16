'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { existsSync } from 'fs';
import * as path from 'path';
import findRelatedFilesForCurrentPath from './utils/find-related-files-for-current-path';
import { createSourceFile, ScriptTarget } from 'typescript';

// this is naive regex for variable name. let's see how much mileage it gets
const invalidVarCharacterRegex = /[^[$a-zA-Z0-9-_]/;
const sep = path.sep;

export function activate(context: vscode.ExtensionContext) {
    let emberGoToRelatedFile = vscode.commands.registerCommand('extension.findRelatedFiles', () => {
        const { activeTextEditor } = vscode.window;
        if (activeTextEditor) {
            const workspaceRoot = normalizeTrailingSlash(vscode.workspace.rootPath);
            const relativePath = vscode.workspace.asRelativePath(activeTextEditor.document.fileName);
            const relatedFiles = findRelatedFilesForCurrentPath(workspaceRoot, relativePath);

            if (!relatedFiles) {
                vscode.window.showWarningMessage('Sorry, no related files found');
                return;
            }

            vscode.window.showQuickPick(relatedFiles).then(selectedItem => {
                if (!selectedItem) {
                    return;
                }
                const absolutePath = selectedItem.getAbsolutePath();
                vscode.workspace.openTextDocument(absolutePath).then(textDocument => {
                    const visibleEditor = vscode.window.visibleTextEditors.find(visibleEditor => {
                        return visibleEditor.document.uri.path === absolutePath;
                    });
                    const columnBeside = -2;
                    const viewColumn = (visibleEditor && visibleEditor.viewColumn) || columnBeside;
                    vscode.window.showTextDocument(textDocument, viewColumn);
                });
            });
        }
    });

    class EmberDefinitionProvider implements vscode.DefinitionProvider {
        public provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.Location[]>|Thenable<null> {
            // TODO: clean this up. it is a mess.
            const ast = createSourceFile(document.fileName, document.getText(), ScriptTarget.Latest);
            const symbolUnderCursor = getModuleNameUnderCursor(document.fileName, document.lineAt(position.line).text, position.character);
            let astBaseModuleName = symbolUnderCursor;

            // if its a javascript file, we need to parse the import statements to extract the path to the module
            if (path.extname(document.fileName) === '.js') {
                ast.statements.find((statement: any)  => {
                    if (statement.importClause && statement.importClause.namedBindings) {
                        return statement.importClause.namedBindings.elements.find((element: any) => {
                            if (element.name && element.name.text === symbolUnderCursor) {
                                astBaseModuleName = statement.moduleSpecifier.text;
                                return true;
                            }
                        });
                    } else if (statement.importClause && statement.importClause.name && statement.importClause.name.text === symbolUnderCursor) {
                        astBaseModuleName = statement.moduleSpecifier.text;
                        return true;
                    }
                });
            }

            // TODO: do better regex with path separators for this
            if (/templates/.test(astBaseModuleName)) {
                astBaseModuleName = `${astBaseModuleName}.hbs`;
            } else {
                astBaseModuleName = `${astBaseModuleName}.js`;
            }

            const { projectRoot, extraAddonSources, addonNameAliases, appNamespace, appHosts = [] } = vscode.workspace.getConfiguration("ember-goto");
            const workspaceRoot = normalizeTrailingSlash(projectRoot || vscode.workspace.rootPath);
            const currentFileName = document.fileName;
            const currentFileNamespace = (currentFileName.split(new RegExp(`${sep}addon${sep}|${sep}app${sep}`)).shift() || '').split(sep).pop();
            const addonNamespace = transformNamespaceAlias(astBaseModuleName, addonNameAliases);
            const baseModuleName = astBaseModuleName.split(sep).slice(1).join(sep);
            let moduleCandidates = [baseModuleName];

            // A template file could mean a re-export or possibly a template helper,
            // so we add those possibilities to the file candidates to check for existence
            if (path.extname(baseModuleName) === '.hbs') {
                const convertedToJsModule = baseModuleName.replace('.hbs', '.js');
                const helperCandidate = convertedToJsModule.replace(`templates${sep}components${sep}`, `helpers${sep}`);
                const componentReExportCandidate = convertedToJsModule.replace(`templates${sep}components${sep}`, `components${sep}`);
                moduleCandidates = moduleCandidates.concat([convertedToJsModule, helperCandidate, componentReExportCandidate]);
            }

            let absolutePathCandidates: Array<string> = [];

            // The namespace could be the namespace for the application, so we
            // take that into account by adding a candidate that might exist
            // directly in the app folder if the parsed namespace matches the
            // app namespace from the config
            // TODO: also try looking up in current in repo addon if the namespace is empty
            if (!addonNamespace || addonNamespace === appNamespace) {
                absolutePathCandidates.push(`${workspaceRoot}app${sep}${baseModuleName}`);
            }

            // If there are multiple app hosts, we should take that into account as well
            absolutePathCandidates = absolutePathCandidates.concat(appHosts.map((host = '') => {
                return `${workspaceRoot}${host}${sep}app${sep}${baseModuleName}`;
            }));

            // construct all permutations of the possible existing file locations
            moduleCandidates.forEach(moduleCandidate => {
                extraAddonSources.forEach((addonSource = '') => {
                    if (addonNamespace) {
                        absolutePathCandidates.push(`${workspaceRoot}${addonSource}${sep}${addonNamespace}${sep}addon${sep}${moduleCandidate}`);
                        absolutePathCandidates.push(`${workspaceRoot}${addonSource}${sep}${addonNamespace}${sep}addon-test-support${sep}${moduleCandidate}`);
                        absolutePathCandidates.push(`${workspaceRoot}${addonSource}${sep}${addonNamespace}${sep}app${sep}${moduleCandidate}`);
                    } else {
                        // if we couldn't parse a namespace, it could mean there wasn't one, so let's just try the namespace for the current file
                        absolutePathCandidates.push(`${workspaceRoot}${addonSource}${sep}${currentFileNamespace}${sep}app${sep}${moduleCandidate}`);
                    }
                });
            });

            // filter down to files that actually exist on the file system
            // TODO: do this asynchronously
            const existingFiles = absolutePathCandidates.filter(existsSync);

            if (!existingFiles.length) {
                return Promise.resolve(null);
            }

            const locations: vscode.Location[] = [];
            existingFiles.forEach(existingFile => {
                const file = vscode.Uri.file(existingFile);
                const pos = new vscode.Position(0, 0);
                const location = new vscode.Location(file, pos);
                locations.push(location);
            });

            return Promise.resolve(locations);
        }
    }
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(
        { scheme: 'file' },
        new EmberDefinitionProvider()
    ));

    context.subscriptions.push(emberGoToRelatedFile);
}

function normalizeTrailingSlash(rootPath: string = ''): string {
    if (rootPath.charAt(rootPath.length - 1) === sep) {
        return rootPath;
    }

    return `${rootPath}${sep}`;
}

function transformNamespaceAlias(componentName: string, addonNameAliases: any) {
    const segments = componentName.split(sep);
    const namespace = segments[0];
    const namespaceAlias = addonNameAliases[namespace];

    if (namespaceAlias) {
        return namespaceAlias;
    }

    return namespace;
}

function getModuleNameUnderCursor(fileName: string, textLine: string, cursorPosition: number): string {
    let result = '';
    if (path.extname(fileName) === '.hbs') {
        const componentNameUnderCursor = getComponentNameUnderCursor(textLine, cursorPosition);
        result = convertComponentNameToModuleName(componentNameUnderCursor, fileName);
    }

    if (path.extname(fileName) === '.js') {
        return convertImportStringToModuleName(textLine, cursorPosition);
    }

    return result;
}

function convertImportStringToModuleName(currentLine: string, cursorIdx: number): string {
    const textAfterCursor = currentLine.substring(cursorIdx);
    const textBeforeCursor = currentLine.substring(0, cursorIdx);
    const endOfFileNameIdx = textAfterCursor.search(invalidVarCharacterRegex);
    const reversedSegment = textBeforeCursor.split('').reverse().join('');
    const startOfFileNameIdx = reversedSegment.search(invalidVarCharacterRegex);
    const fileNameStart = reversedSegment.substring(0, startOfFileNameIdx).split('').reverse().join('');
    const fileNameEnd = textAfterCursor.substring(0, endOfFileNameIdx);

    return fileNameStart.concat(fileNameEnd);
}

function getComponentNameUnderCursor(currentLine: string, cursorIdx: number): string {
    const textAfterCursor = currentLine.substring(cursorIdx);
    const textBeforeCursor = currentLine.substring(0, cursorIdx);
    const whiteSpaceDelimiterIdx = textAfterCursor.search(/\s+/);
    const endOfComponentNameIdx = whiteSpaceDelimiterIdx !== -1 ? whiteSpaceDelimiterIdx : textAfterCursor.length;
    const reversedSegment = textBeforeCursor.split('').reverse().join('');
    const startOfComponentNameIdx = reversedSegment.search(/[#{(]/);
    const fileNameStart = reversedSegment.substring(0, startOfComponentNameIdx).split('').reverse().join('');
    const fileNameEnd = textAfterCursor.substring(0, endOfComponentNameIdx);

    // NOTE: the replace handles the case were the cursor was on a closing curly "tag"
    return fileNameStart.concat(fileNameEnd).replace(/^\/|}+$/g, '');
}

function convertComponentNameToModuleName(componentName: string, currentFileName: string): string {
    const namespace = getComponentNameSpace(componentName, currentFileName);
    // strip namespace if it exists
    const cleanComponentName = componentName.replace(/^.*::/, '');
    // NOTE: should this also consider js only components?
    return `${namespace}${sep}templates${sep}components${sep}${cleanComponentName}`;
}

function getComponentNameSpace(componentName: string, fileName: string): string {
    const hasNameSpace = componentName.includes('::');

    if (hasNameSpace) {
        return componentName.split('::')[0];
    }

    const fileNameParts = fileName.split(path.sep);
    for (let i = fileNameParts.length - 1; i > 0; i--) {
        if (/addon/.test(fileNameParts[i])) {
            return fileNameParts[i - 1];
        }
    }

    return '';
}
// this method is called when your extension is deactivated
export function deactivate() {
}