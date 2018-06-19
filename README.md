# Ember Go To

Simple extension for jumping to files in an Ember app with nonconventional
directory structure

## Features

Right click over any import path string, or component invocation inside a template,
and select "Ember: Go To File" to jump to the file for that module.

Default keybinding: `cmd+g cmd+t`

## Extension Settings

IMPORTANT! If you want to resolve modules in unconventional locations, you need to
specify where this extension should search for them:

Note that you can jump to files in the node_modules directory.

Example config:
```
	"ember-goto.searchSources": [
		"engine-lib",
		"core/engines",
		"extended/engines",
		"extended/lib",
		"core/lib",
		"lib",
		"node_modules/@namespace"
	]
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
you can right click in any editor and there should be a new option, "Ember: Go To File"

Don't forget to set the config options for the folders that should be considered for resolving modules.
