'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { existsSync } from 'fs';
import * as path from 'path';
import findRelatedFilesForCurrentPath from './utils/find-related-files-for-current-path';

const fileNameRegex = /^[a-zA-Z0-9-_./]+$/;
const stringTerminatorRegex = /['"]/;

// TODO: investigate if we can allow a regex in config to specify how to inject the segments?
const injectPathSegments = [
    'addon',
    'addon-test-support'
];

export function activate(context: vscode.ExtensionContext) {
    let emberGoToRelatedFile = vscode.commands.registerCommand('extension.emberGoToRelatedFile', () => {
        const { activeTextEditor } = vscode.window;
        if (activeTextEditor) {
            const workspaceRoot = vscode.workspace.rootPath || '';
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
        const { activeTextEditor } = vscode.window;
        if (activeTextEditor) {
            const { line: currentCursorLineNumber, character: currentCursorColumnNumber } = activeTextEditor.selection.active;
            const lineOfTextAtCursor = activeTextEditor.document.lineAt(currentCursorLineNumber).text;
            const currentFileName = activeTextEditor.document.fileName;
            let existingFiles: Object[] = [];
            const maybeModuleName = transformNamespaceAlias(getModuleNameUnderCursor(currentFileName, lineOfTextAtCursor, currentCursorColumnNumber));

            if (isValidModuleName(maybeModuleName) && isNamespacedModule(maybeModuleName)) {
                const { searchSources, projectRoot } = vscode.workspace.getConfiguration("ember-goto");
                const workspaceRootPath = projectRoot || vscode.workspace.rootPath || '';
                const baseFileNameCandidates = getBaseFileNameCandidates(injectPathSegments, maybeModuleName);

                existingFiles = searchSources.reduce((existingFiles: Array<Object>, currentSearchDirectory: string) => {

                    const allEixistingFilesUnderSearchDir = baseFileNameCandidates.reduce((existingUnderSearchSrc: Array<Object>, currentBaseFileName: string) => {
                        const [cleanWorkspaceRoot, cleanSearchDir, cleanBaseFileName] = [workspaceRootPath, currentSearchDirectory, currentBaseFileName].map(cleanPathSegment);
                        const existingFileCandidate = `${cleanWorkspaceRoot}/${cleanSearchDir}/${cleanBaseFileName}`;

                        if (existsSync(existingFileCandidate)) {
                            return [...existingUnderSearchSrc, {
                                [`${cleanSearchDir}/${currentBaseFileName}`]: existingFileCandidate
                            }];
                        } else if (isHbsFile(existingFileCandidate)) {
                            const reexportPath = existingFileCandidate.replace('/templates/', path.sep).replace('.hbs', '.js');
                            // if a template file doesn't exist, it could be a case of re-exporting a template from js
                            if (existsSync(reexportPath)) {
                                return [...existingUnderSearchSrc, {
                                    [`${cleanSearchDir}/${currentBaseFileName}`]: reexportPath
                                }];
                            // or it could be a template helper!
                            } else {
                                const helperPath = existingFileCandidate.replace('/templates/components/', '/helpers/').replace('.hbs', '.js');
                                if (existsSync(helperPath)) {
                                    return [...existingUnderSearchSrc, {
                                        [`${cleanSearchDir}/${currentBaseFileName}`]: helperPath
                                    }];
                                }
                            }
                        }
                        return existingUnderSearchSrc;
                    }, []);

                    return [...existingFiles, ...allEixistingFilesUnderSearchDir];
                }, []);
            }

            if (existingFiles.length === 0) {
                vscode.window.showErrorMessage(`Could not locate module: ${maybeModuleName}`);
                return;
            }

            // for the case where only one file exists, we just open it immediately
            // in the current editor
            if (existingFiles.length === 1) {
                const fileKey = Object.keys(existingFiles[0])[0];
                const file = existingFiles[0];
                const displayName: string = (<any>file)[fileKey];

                vscode.workspace.openTextDocument(displayName).then(textDocument => {
                    vscode.window.showTextDocument(textDocument, vscode.ViewColumn.Active);
                });
                return;
            }

            const quickPickItems: Array<string> = existingFiles.map(existingFile => {
                return Object.keys(existingFile)[0];
            });

            vscode.window.showQuickPick(quickPickItems).then((pickedFile = '') => {
                if (!pickedFile) {
                    return;
                }
                // FIXME: existingFiles should be a map of quickfix formatted strings to real filenames.
                // not an array.
                const fileToOpen: Object = existingFiles.find((existingFile: any) => {
                    return existingFile[pickedFile];
                }) || {};

                const realFileName: string = (<any>fileToOpen)[pickedFile] || '';

                vscode.workspace.openTextDocument(realFileName).then(textDocument => {
                    // -1 means open in active editor window
                    vscode.window.showTextDocument(textDocument, -1);
                });
            });

        }
    });

    context.subscriptions.push(emberGoToFileUnderCursor, emberGoToRelatedFile);
}

function getFileExtension(fileName: string): string {
    const extStartIdx = fileName.lastIndexOf('.') + 1;
    return fileName.substring(extStartIdx);
}

function isJavascriptFile(fileName: string): boolean {
    return getFileExtension(fileName) === 'js';
}

function isHbsFile(fileName: string): boolean {
    return getFileExtension(fileName) === 'hbs';
}

function isNamespacedModule(fileName: string): boolean {
    return fileName.indexOf('.') !== 0;
}

function isValidModuleName(moduleName: string): boolean {
    return fileNameRegex.test(moduleName);
}

function cleanPathSegment(segment: string): string {
    return segment.replace(/\/$/, '');
}

function getModuleNameUnderCursor(fileName: string, textLine: string, cursorPosition: number): string {
    if (isHbsFile(fileName)) {
        const componentNameUnderCursor = getComponentNameUnderCursor(textLine, cursorPosition);
        return convertComponentNameToModuleName(componentNameUnderCursor, fileName).concat('.hbs');
    }

    if (isJavascriptFile(fileName)) {
        const moduleName = convertImportStringToModuleName(textLine, cursorPosition);
        const isTemplateImport = moduleName.includes('/templates/');
        return isTemplateImport ? moduleName.concat('.hbs') : moduleName.concat('.js');
    }

    return '';
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
    return `${namespace}${path.sep}templates${path.sep}components${path.sep}${cleanComponentName}`;
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

function getBaseFileNameCandidates(injectPathSegments: Array<string>, moduleName: string): Array<string> {
    return injectPathSegments.map(segment => {
        const [namespace, ...rest] = moduleName.split(path.sep);
        // NOTE: We remove test-support so we can properly inject the real location which is "addon-test-support"
        const cleanRest = rest.join(path.sep).replace('test-support', '');
        return `${namespace}${path.sep}${segment}${path.sep}${cleanRest}`;
    });
}

function transformNamespaceAlias(componentName: string) {
    if (componentName.indexOf('shared') === 0) {
        return componentName.replace(/^shared/, 's-base');
    }

    return componentName;
}

// this method is called when your extension is deactivated
export function deactivate() {
}