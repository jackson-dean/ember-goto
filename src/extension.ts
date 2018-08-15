'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { existsSync } from 'fs';
import * as path from 'path';
import findRelatedFilesForCurrentPath from './utils/find-related-files-for-current-path';

const sep = path.sep;

const stringTerminatorRegex = /['"]/;

export function activate(context: vscode.ExtensionContext) {
    let emberGoToRelatedFile = vscode.commands.registerCommand('extension.emberGoToRelatedFile', () => {
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

    let emberGoToFileUnderCursor = vscode.commands.registerCommand('editor.action.goToDeclaration', () => {
        // TODO: figure out how to handle relative paths
        const { activeTextEditor } = vscode.window;
        if (activeTextEditor) {
            const { projectRoot, extraAddonSources, addonNameAliases, appNamespace, appHosts = [] } = vscode.workspace.getConfiguration("ember-goto");
            const workspaceRoot = normalizeTrailingSlash(projectRoot || vscode.workspace.rootPath);
            const { line, character } = activeTextEditor.selection.active;
            const lineOfTextAtCursor = activeTextEditor.document.lineAt(line).text;
            const currentFileName = activeTextEditor.document.fileName;
            const currentFileNamespace = (currentFileName.split(new RegExp(`${sep}addon${sep}|${sep}app${sep}`)).shift() || '').split(sep).pop();
            const namespacedModuleName = getModuleNameUnderCursor(currentFileName, lineOfTextAtCursor, character);
            const addonNamespace = transformNamespaceAlias(namespacedModuleName, addonNameAliases);
            const baseModuleName = namespacedModuleName.split(sep).slice(1).join(sep);

            let moduleCandidates = [baseModuleName];

            // A template file could mean a re-export or possibly a template helper,
            // so we add those possibilities to the file candidates to check for existence
            if (isTemplateFile(baseModuleName)) {
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
            const existingFiles = absolutePathCandidates.filter(existsSync);

            // show a warning if no file was found
            if (!existingFiles.length) {
                vscode.window.showWarningMessage(`Could not locatate ${addonNamespace || currentFileNamespace}${sep}${baseModuleName} - Maybe it has a missing or incorrect a namespace.`);
            }

            // if only one file exists, jump there immediately
            if (existingFiles.length === 1) {
                const uri = existingFiles[0];
                vscode.workspace.openTextDocument(uri).then(textDocument => {
                    const visibleEditor = vscode.window.visibleTextEditors.find(visibleEditor => {
                        return visibleEditor.document.uri.path === uri;
                    });
                    const columnBeside = -2;
                    const viewColumn = (visibleEditor && visibleEditor.viewColumn) || columnBeside;
                    vscode.window.showTextDocument(textDocument, viewColumn);
                    vscode.window.showTextDocument(textDocument, vscode.ViewColumn.Active);
                });
                return;
            }

            const quickPickItems = existingFiles.map(detail => {
                return {
                    description: detail.replace(workspaceRoot, ''),
                    label: `${isJavascriptFile(detail) ? 'JavaScript' : 'Template'}: `,
                    getUri() {
                        return detail;
                    }
                };
            });

            // for multiple results, just show a list and let the user choose
            vscode.window.showQuickPick(quickPickItems).then(selection => {
                if (!selection) {
                    return;
                }
                const uri = selection.getUri();
                vscode.workspace.openTextDocument(uri).then(textDocument => {
                    const visibleEditor = vscode.window.visibleTextEditors.find(visibleEditor => {
                        return visibleEditor.document.uri.path === uri;
                    });
                    const columnBeside = -2;
                    const viewColumn = (visibleEditor && visibleEditor.viewColumn) || columnBeside;
                    vscode.window.showTextDocument(textDocument, viewColumn);
                });
            });
        }
    });

    context.subscriptions.push(emberGoToFileUnderCursor, emberGoToRelatedFile);
}

function normalizeTrailingSlash(rootPath: string = ''): string {
    if (rootPath.charAt(rootPath.length - 1) === sep) {
        return rootPath;
    }

    return `${rootPath}${sep}`;
}


function isJavascriptFile(fileName: string): boolean {
    return path.extname(fileName) === '.js';
}

function isTemplateFile(fileName: string): boolean {
    return path.extname(fileName) === '.hbs';
}

function getModuleNameUnderCursor(fileName: string, textLine: string, cursorPosition: number): string {
    let result = '';
    if (isTemplateFile(fileName)) {
        const componentNameUnderCursor = getComponentNameUnderCursor(textLine, cursorPosition);
        result = convertComponentNameToModuleName(componentNameUnderCursor, fileName).concat('.hbs');
    }

    if (isJavascriptFile(fileName)) {
        const moduleName = convertImportStringToModuleName(textLine, cursorPosition);
        const isTemplateImport = moduleName.includes(`${sep}templates${sep}`);
        result = isTemplateImport ? moduleName.concat('.hbs') : moduleName.concat('.js');
    }

    return result;
}

function convertImportStringToModuleName(currentLine: string, cursorIdx: number): string {
    const textAfterCursor = currentLine.substring(cursorIdx);
    const textBeforeCursor = currentLine.substring(0, cursorIdx);
    const endOfFileNameIdx = textAfterCursor.search(stringTerminatorRegex);
    const reversedSegment = textBeforeCursor.split('').reverse().join('');
    const startOfFileNameIdx = reversedSegment.search(stringTerminatorRegex);
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

function transformNamespaceAlias(componentName: string, addonNameAliases: any) {
    const segments = componentName.split(sep);
    const namespace = segments[0];
    const namespaceAlias = addonNameAliases[namespace];

    if (namespaceAlias) {
        return namespaceAlias;
    }

    return namespace;
}

// this method is called when your extension is deactivated
export function deactivate() {
}