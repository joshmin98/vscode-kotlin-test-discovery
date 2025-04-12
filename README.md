
# A fork of Kotlin IDE for Visual Studio Code
> This is a test fork that I've been working on to try and get better test integration with VSCode for Kotlin. In it's current state this fork allows for test class methods to be shown in the VSCode test explorer UI, and for you to run specific tests from the UI. All of the processing/logic is held within the extension, which I don't think is ideal. It would be better if some functionality (e.g. test recognition) would be offloaded to the LSP itself.

[![Version](https://raster.shields.io/visual-studio-marketplace/v/fwcd.kotlin)](https://marketplace.visualstudio.com/items?itemName=fwcd.kotlin)
[![Build](https://raster.shields.io/github/actions/workflow/status/fwcd/vscode-kotlin/build.yml?branch=main)](https://github.com/fwcd/vscode-kotlin/actions/workflows/build.yml)
[![Downloads](https://raster.shields.io/visual-studio-marketplace/d/fwcd.kotlin)](https://marketplace.visualstudio.com/items?itemName=fwcd.kotlin)
[![Installs](https://raster.shields.io/visual-studio-marketplace/i/fwcd.kotlin)](https://marketplace.visualstudio.com/items?itemName=fwcd.kotlin)
[![Chat](https://raster.shields.io/badge/chat-on%20discord-7289da)](https://discord.gg/cNtppzN)

Smart code completion, linting, debugging, formatting and more for Kotlin in VSCode using the [Kotlin language server](https://github.com/fwcd/kotlin-language-server) and the [Kotlin debug adapter](https://github.com/fwcd/kotlin-debug-adapter).

To use, make sure that JDK 11+ is installed and open a Kotlin file **inside a Gradle or Maven project**. Support for Kotlin source files with a standalone compiler (`kotlinc`) is experimental. The language server will then automatically launch in the background.

## Features
* Code completion
* Linting
* Semantic highlighting
* Debugging
* Go-to-definition
* Signature help
* Hover
* Formatting
* Document symbols
* Find references

## Usage

### Debugging
* Setup:
    * Open the `launch.json` file in your project and invoke code completion to create a new launch configuration (or select `Add Configuration...` in the debug tab)
* Launch:
    * Build your project (before every launch)
	* Click the `Run` button in the `Debug` tab or press `F5`
