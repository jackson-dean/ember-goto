import { existsSync } from 'fs';
import * as path from 'path';

// TODO: go to related files from within the test file
// TODO: add utils and helper support
const SUPPORTED_FILE_TYPES = {
    componentTemplate: 'componentTemplate',
    componentJavascript: 'componentJavascript',
    componentScss: 'componentScss',
    componentIntegrationTest: 'componentIntegrationTest',
    route: 'route',
    routeTemplate: 'routeTemplate',
    routeAcceptanceTest: 'routeAcceptanceTest',
    controller: 'controller',
    acceptanceTest: 'accceptanceTest',
    util: 'util',
    unitTest: 'unitTest',
};

interface PathItem {
    relativePath: string;
    absolutePath: string;
}

class RelatedFile {
    label: string;
    description: string;
    pathItem: PathItem;

    constructor(label: string, pathItem: PathItem) {
        this.label = label;
        this.description = pathItem.relativePath;
        this.pathItem = pathItem;
    }

    getAbsolutePath() {
        return this.pathItem.absolutePath;
    }
}

class PathBuilder {
    workspaceRoot: string;
    relativePath: string;
    subDirectory: string;
    entityName: string;
    sep: string;
    exists: Function;
    relativePathRoot: string;

    constructor(workspaceRoot: string, relativePath: string, subDirectory: string, entityName: string, sep: string = path.sep, exists: Function = existsSync) {
        this.workspaceRoot = workspaceRoot;
        this.relativePath = relativePath;
        this.subDirectory = subDirectory;
        this.entityName = entityName;
        this.exists = exists;
        this.sep = sep;
        this.relativePathRoot = this.getRelativePathRoot();
    }

    public buildJavascriptPath (type: string): PathItem {
        return this.checkPaths((_subDir: string) => `${this.relativePathRoot}${_subDir}${this.sep}${type}s${this.sep}${this.entityName}.js`);
    }

    public buildRouteTemplatePath (): PathItem {
        return this.checkPaths((_subDir: string) => `${this.relativePathRoot}${_subDir}${this.sep}templates${this.sep}${this.sep}${this.entityName}.hbs`);
    }

    public buildComponentTemplatePath (): PathItem {
        return this.checkPaths((_subDir: string) => `${this.relativePathRoot}${_subDir}${this.sep}templates${this.sep}components${this.sep}${this.entityName}.hbs`);
    }

    public buildTestPath (type: string): PathItem {
       return this.checkPaths((_subDir: string) => `${this.relativePathRoot}tests${this.sep}${type}${this.sep}${type === 'integration' ? 'components' : ''}${this.sep}${this.entityName}-test.js`);
    }

    private getRelativePathRoot(): string {
        return this.relativePath.split(this.subDirectory).shift() || '';
    }

    private checkPaths(buildPath: Function): PathItem {
        if (this.subDirectory === 'tests') {
            const relativeAddonPath = buildPath('addon');
            const absoluteAddonPath = `${this.workspaceRoot}${relativeAddonPath}`;
            if (this.exists(absoluteAddonPath)) {
                return {
                    relativePath: relativeAddonPath,
                    absolutePath: absoluteAddonPath,
                };
            }
            const relativeAppPath = buildPath('app');
            const absoluteAppPath = `${this.workspaceRoot}${relativeAppPath}`;
            if (this.exists(absoluteAppPath)) {
                return {
                    relativePath: relativeAppPath,
                    absolutePath: absoluteAppPath,
                };
            }
        }

        const relativePath = buildPath(this.subDirectory);
        const absolutePath = `${this.workspaceRoot}${relativePath}`;
        if (this.exists(absolutePath)) {
            return {
                relativePath: relativePath,
                absolutePath: absolutePath,
            };

        }

        return {
            relativePath: 'not found',
            absolutePath: '',
        };
    }
}

function getFileTypeFromPath(currentPath: string): string {
    if (/tests\/.*integration\/components/.test(currentPath)) {
        return SUPPORTED_FILE_TYPES.componentIntegrationTest;
    }
    if (/tests\/acceptance/.test(currentPath)) {
        return SUPPORTED_FILE_TYPES.routeAcceptanceTest;
    }
    if (/\/components\/.*\.hbs/.test(currentPath)) {
        return SUPPORTED_FILE_TYPES.componentTemplate;
    }
    if (/\/components\/.*\.js/.test(currentPath)) {
        if (/-test.js/.test(currentPath)) {
            return SUPPORTED_FILE_TYPES.componentIntegrationTest;
        }
        return SUPPORTED_FILE_TYPES.componentJavascript;
    }
    if (/\/routes\/.*\.js/.test(currentPath)) {
        return SUPPORTED_FILE_TYPES.route;
    }
    if (/\/templates\/(?!components).*\.hbs/.test(currentPath)) {
        return SUPPORTED_FILE_TYPES.routeTemplate;
    }
    if (/\/controllers\/.*\.js/.test(currentPath)) {
        return SUPPORTED_FILE_TYPES.controller;
    }
    return '';
}

/**
 * Parse the subdirectory for an entity. Can be one of the following:
 * 'addon', 'app', 'tests'
 */
function getEntitySubdirectory(filePath: string): string {
    const subDirMatch: Array<string>|null = filePath.match(/\/(addon|app|tests)\//);
    return (subDirMatch && subDirMatch[1]) || '';
}

function getEntityName(type: string, filePath: string): string {
    let normalizedType: string;

    if (type.includes('component')) {
        normalizedType = 'components';
    } else if (type === 'routeTemplate') {
        normalizedType = 'templates';
    } else if (type === 'routeAcceptanceTest') {
        normalizedType = 'acceptance';
    } else {
        normalizedType = `${type}s`;
    }

    const regex = new RegExp(`${normalizedType}\/(.*)`);
    const matches = filePath.match(regex);

    if (matches && matches[1]) {
        // strip the extension
        return (matches[1].split('.').shift() || '').replace(/-test$/, '');
    }

    return '';
}

export default function findRelatedFilesForCurrentPath(workspaceRoot: string, relativePath: string): Array<RelatedFile>|null {
    const currentFileType: string = getFileTypeFromPath(relativePath);
    const subDirectory = getEntitySubdirectory(relativePath);
    const entityName = getEntityName(currentFileType, relativePath);
    const pathBuilder = new PathBuilder(workspaceRoot, relativePath, subDirectory, entityName, path.sep, existsSync);

    if (currentFileType === SUPPORTED_FILE_TYPES.componentTemplate) {
        return [
            new RelatedFile('JavaScript: ', pathBuilder.buildJavascriptPath('component')),
            new RelatedFile('Integration test: ', pathBuilder.buildTestPath('integration')),
        ];
    } else if (currentFileType === SUPPORTED_FILE_TYPES.componentJavascript) {
        return [
            new RelatedFile('Template: ', pathBuilder.buildComponentTemplatePath()),
            new RelatedFile('Integration test: ', pathBuilder.buildTestPath('integration')),
        ];
    } else if (currentFileType === SUPPORTED_FILE_TYPES.route) {
        return [
            new RelatedFile('Template: ', pathBuilder.buildRouteTemplatePath()),
            new RelatedFile('Controller: ', pathBuilder.buildJavascriptPath('controller')),
            new RelatedFile('Acceptance Test: ', pathBuilder.buildTestPath('acceptance')),
        ];
    } else if (currentFileType === SUPPORTED_FILE_TYPES.routeTemplate) {
        return [
            new RelatedFile('Route: ', pathBuilder.buildJavascriptPath('route')),
            new RelatedFile('Controller: ', pathBuilder.buildJavascriptPath('controller')),
            new RelatedFile('Acceptance Test: ', pathBuilder.buildTestPath('acceptance')),
        ];
    } else if (currentFileType === SUPPORTED_FILE_TYPES.controller) {
        return [
            new RelatedFile('Template: ', pathBuilder.buildRouteTemplatePath()),
            new RelatedFile('Route: ', pathBuilder.buildJavascriptPath('route')),
            new RelatedFile('Acceptance Test: ', pathBuilder.buildTestPath('acceptance')),
        ];
    } else if (currentFileType === SUPPORTED_FILE_TYPES.componentIntegrationTest) {
        return [
            new RelatedFile('Template: ', pathBuilder.buildComponentTemplatePath()),
            new RelatedFile('JavaScript: ', pathBuilder.buildJavascriptPath('component')),
        ];
    } else if (currentFileType === SUPPORTED_FILE_TYPES.routeAcceptanceTest) {
        return [
            new RelatedFile('Route: ', pathBuilder.buildJavascriptPath('route')),
            new RelatedFile('Controller: ', pathBuilder.buildJavascriptPath('controller')),
            new RelatedFile('Template: ', pathBuilder.buildRouteTemplatePath()),
        ];
    }

    return null;
}