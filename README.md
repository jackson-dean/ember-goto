# Ember Go To

This is a WIP. Expect issues and please report them.

Makes 'Go to Definition' work for ember applications. Supports in-repo addons
and engines. Relies on namespaced, absolute import paths. Also provides a
"Related Files" feature which displays related files based on the current
file, which is available via the context menu and a command in the command
palette.

## Features

Right click over any import path string, or component invocation inside a template,
and select "Go to Definition". Or use the default keybinding, "f12".

Right click in any file and select "Related Files" or do the same from the
command palette to reveal a list of related files.

## Extension Settings

If you want to resolve modules in unconventional locations, you need to
specify where this extension should search for them. By default it will try
to resolve modules from **lib** and **node_modules**. The config should
provide additional sources under the config key
`ember-goto.extraAddonSources`.

Example config for non-conventional directories:
```
	"ember-goto.searchSources": [
		"engines",
		"node_modules/@namespace"
	]
```

Additonal settings:

If the repo contains multiple ember apps, you can provide those directories
with the config "ember-goto.appHosts":
```
	"ember-goto.appHosts": [
		"host1",
		"host2"
	]
```

If modules are imported using the application namespace, you must provide the
name of the application via the config "ember-goto.appNamespace". This is the
same as the name key found in the package.json for your ember app:
```
	"ember-goto.appNamespace": [
		"your-app-name"
	]
```

Additionally, if your project has addons with names different from the directory
name on the file system, that can be configured with "ember-goto.addonNameAliases":
```
	"ember-goto.addNameAliases": {
		"name-on-disk": "name-in-package.json"
	}
```

## Install

Not published in the marketplace yet, but it can be easily installed by
downloading the .vsix file from this repo and using the `code` command line
utility.

First, you need to make sure the `code` executable is in your path. Vscode has a
command to easily do this.

Step 1: Press `cmd+shift+p` to open the Command Palette
Step 2: Search for the command "Shell Command: Install 'code' command to PATH" and execute it
Step 3: Run the following in a terminal:
```
git clone https://github.com/jackson-dean/ember-goto.git && cd ember-goto && code --install-extension ember-goto-0.0.1.vsix
```

After installation you can reload or start a new instance of vscode. To confirm the plugin is loaded,
you can right click in any editor and there should be a new option, "Related Files", and a new command
in the command palette of the same name. 
