'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { existsSync } from 'fs';

const fileNameRegex = /^[a-zA-Z0-9-_./]+$/;
const stringTerminatorRegex = /['"]/;
const pathSeparator = '/';

// TODO: investigate if we can allow a regex in config to specify how to inject the segments?
const injectPathSegments = [
    'addon',
    'app',
    'addon-test-support'
];

const fileExtensions = [
    'hbs',
    'js',
];

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Congratulations, your extension "ember-goto" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('extension.emberGoTo', () => {
        // The code you place here will be executed every time your command is executed

        const { activeTextEditor } = vscode.window;
        if (activeTextEditor) {
            const { line: currentCursorLineNumber, character: currentCursorColumnNumber } = activeTextEditor.selection.active;
            const lineOfTextAtCursor = activeTextEditor.document.lineAt(currentCursorLineNumber).text;
            const currentFileName = activeTextEditor.document.fileName;
            let existingFiles: Object[] = [];
            let moduleNamesUnderCursor: string[] = [];

            if (isHbsFile(currentFileName)) {
                const componentNameUnderCursor = getComponentNameUnderCursor(lineOfTextAtCursor, currentCursorColumnNumber);
                moduleNamesUnderCursor = convertComponentNameToModulePair(componentNameUnderCursor, currentFileName);
            }

            if (isJavascriptFile(currentFileName)) {
                moduleNamesUnderCursor = [getModuleNameUnderCursor(lineOfTextAtCursor, currentCursorColumnNumber)];
            }

            existingFiles = moduleNamesUnderCursor.reduce((result: Array<Object>, moduleNameUnderCursor: string) => {
                if (isValidModuleName(moduleNameUnderCursor) && isResolvableModule(moduleNameUnderCursor)) {
                    const { searchSources, projectRoot } = vscode.workspace.getConfiguration("ember-goto");
                    const workspaceRootPath = projectRoot || vscode.workspace.rootPath || '';

                    const baseFileNameCandidates = injectPathSegments.map(segment => {
                        const [namespace, ...rest] = moduleNameUnderCursor.split(pathSeparator);
                        // NOTE: We remove test-support so we can properly inject the real location which is "addon-test-support"
                        const cleanRest = rest.join(pathSeparator).replace('test-support', '');
                        return `${namespace}${pathSeparator}${segment}${pathSeparator}${cleanRest}`;
                    });

                    const foundFiles = searchSources.reduce((outerResult: Array<Object>, currentSearchDirectory: string) => {

                        const allEixistingFilesUnderSearchDir = baseFileNameCandidates.reduce((innerResult: Array<Object>, currentBaseFileName: string) => {

                            const existingFiles = fileExtensions.reduce((inner: Array<Object>, currentExtension: string) => {
                                const [cleanWorkspaceRoot, cleanSearchDir, cleanBaseFileName] = [workspaceRootPath, currentSearchDirectory, currentBaseFileName].map(cleanPathSegment);
                                // TODO: remove handleNonConventionalNaming wrapper once "s-base" is gone
                                // Make this a config item which maps the "on disk" directory name to the ember namespace
                                const fileCandidate = `${cleanWorkspaceRoot}/${cleanSearchDir}/${handleNonConventionalNaming(cleanBaseFileName)}.${currentExtension}`;
                                return existsSync(fileCandidate) ? [...inner, {
                                    [`${currentExtension === 'hbs' ? 'HBS' : 'JS'}: ${cleanSearchDir}/${currentBaseFileName}`]: fileCandidate,
                                }] : inner;
                            }, []);

                            return [...innerResult, ...existingFiles];
                        }, []);

                        return [...outerResult, ...allEixistingFilesUnderSearchDir];
                    }, []);
                    return [...result, ...foundFiles];
                }
                return result;
            }, []);

            if (existingFiles.length === 0) {
                vscode.window.showErrorMessage('Could not locate module');
                return;
            }

            // for the case where only one file exists, we just open it immediately
            // in the current editor
            if (existingFiles.length === 1) {
                const fileKey = Object.keys(existingFiles[0])[0];
                vscode.workspace.openTextDocument(existingFiles[0][fileKey] || '').then(textDocument => {
                    vscode.window.showTextDocument(textDocument);
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

                const realFileName: string = fileToOpen[pickedFile] || '';

                vscode.workspace.openTextDocument(realFileName).then(textDocument => {
                    vscode.window.showTextDocument(textDocument);
                });
            });

        }
    });

    context.subscriptions.push(disposable);
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

function isResolvableModule(fileName: string): boolean {
    return fileName.indexOf('.') !== 0;
}

function isValidModuleName(fileName: string): boolean {
    return fileNameRegex.test(fileName);
}

function cleanPathSegment(segment: string): string {
    return segment.replace(/\/$/, '');
}

function getModuleNameUnderCursor(currentLine: string, cursorIdx: number): string {
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
    // FIXME: cache the search so we don't do it twice
    const endOfComponentNameIdx = textAfterCursor.search(/\s+/) !== -1 ? textAfterCursor.search(/\s+/) : textAfterCursor.length;
    const reversedSegment = textBeforeCursor.split('').reverse().join('');
    const startOfComponentNameIdx = reversedSegment.search(/[#{]/);
    const fileNameStart = reversedSegment.substring(0, startOfComponentNameIdx).split('').reverse().join('');
    const fileNameEnd = textAfterCursor.substring(0, endOfComponentNameIdx);

    // NOTE: the replace handles the case were the cursor was on a closing curly "tag"
    return fileNameStart.concat(fileNameEnd).replace(/^\/|}+$/g, '');;
}

// A component might be hbs+js, js only, or hbs only
function convertComponentNameToModulePair(componentName: string, currentFileName: string): Array<string> {
    // component invocations can be namespaced with "::""
    const hasNameSpace = componentName.includes('::');
    if (hasNameSpace) {
        const normalizedComponentName = componentName.replace(/::/, pathSeparator);
        const [namespace, ...rest] = normalizedComponentName.split(pathSeparator);

        return [
            `${namespace}${pathSeparator}templates${pathSeparator}components${pathSeparator}${rest.join(pathSeparator)}`,
            `${namespace}${pathSeparator}components${pathSeparator}${rest.join(pathSeparator)}`,
        ]
    } else {
        const currentFileNameParts = currentFileName.split(pathSeparator);
        const componentNameParts = componentName.split(pathSeparator);
        let namespace = '';

        for (let i = currentFileNameParts.length - 1; i > 0; i--) {
            if (/addon/.test(currentFileNameParts[i])) {
                namespace = currentFileNameParts[i - 1];
                break;
            }
        }

        // FIXME: this is very similar to the return in the hasNameSpace branch.
        return [
            `${namespace}${pathSeparator}templates${pathSeparator}components${pathSeparator}${componentNameParts.join(pathSeparator)}`,
            `${namespace}${pathSeparator}components${pathSeparator}${componentNameParts.join(pathSeparator)}`,
        ]
    }
}

function handleNonConventionalNaming(componentName: string) {
    if (componentName.indexOf('shared') === 0) {
        return componentName.replace(/^shared/, 's-base');
    }

    return componentName;
}

// this method is called when your extension is deactivated
export function deactivate() {
}