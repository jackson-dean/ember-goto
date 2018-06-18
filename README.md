# Ember Go To

Simple extension for jumping to files in an Ember app with nonconventional
directory structure

## Features

Right click over any import path, or component invocation inside a template,
and select "Ember: Go To File" to jump to the file for that module.

Default keybinding: `cmd+g cmd+t`

## Extension Settings

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
utility by running the following in a terminal:
```
git clone https://github.com/jackson-dean/ember-goto.git && cd ember-goto && code --install-extension ember-goto-0.0.1.vsix
```
