import { Disposable, ExtensionContext, Range, TestController, TestItem, TestMessage, TestRunProfileKind, TestRunRequest, Uri, commands, tests, window, workspace } from "vscode";
import * as path from "path";
import { LOG } from "./util/logger";
import { promises } from "fs";
import { CancellationToken } from "vscode-languageclient";
import { fsExists } from "./util/fsUtils";

export class KotlinTestDiscovery {
    private readonly testController: TestController;
    private readonly testItems = new Map<string, TestItem>();
    private readonly fileToTestItemsMap = new Map<string, TestItem[]>();
    private disposables: Disposable[] = [];

    constructor(context: ExtensionContext) {
        this.testController = tests.createTestController("kotlinTestController", "Kotlin Tests");
        this.disposables.push(this.testController);

        this.testController.createRunProfile(
            "Run",
            TestRunProfileKind.Run,
            (request, token) => this.runHandler(request, token),
            true
        );

        this.testController.createRunProfile(
            "Debug",
            TestRunProfileKind.Debug,
            (request, token) => this.runHandler(request, token),
            true
        );

        this.setupWatchers();

        const refreshCommand = commands.registerCommand("kotlin.tests.refresh", () => this.discoverAllTests());
        context.subscriptions.push(refreshCommand);
        this.disposables.push(refreshCommand);

        this.testController.resolveHandler = async (item: TestItem) => {
            if (!item) {
                await this.discoverAllTests();
            } else {
                await this.resolveTestsInFile(item.uri)
            }
        };

        LOG.info("Kotlin Test Discovery initialized");
    }

    public dispose(): void {
        this.disposables.forEach(disposable => disposable.dispose());
        this.testController.dispose();
    }

    private setupWatchers(): void {
        const watcher = workspace.createFileSystemWatcher("**/*.{kt,kts}");

        watcher.onDidChange(uri => this.resolveTestsInFile(uri));
        watcher.onDidCreate(uri => this.resolveTestsInFile(uri));
        watcher.onDidDelete(uri => this.resolveTestsInFile(uri));
    
        this.disposables.push(watcher);
    }
    
    private async discoverAllTests(): Promise<void> {
        LOG.info("Discovering tests in workspace...")
        this.testController.items.forEach(item => this.testController.items.delete(item.id));
        this.testItems.clear();
        this.fileToTestItemsMap.clear();

        if (!workspace.workspaceFolders) return;

        workspace.workspaceFolders.forEach(async folder => {
            const testFiles = await this.findKotlinTestFiles(folder.uri.fsPath);
            testFiles.forEach(async file => {
                await this.resolveTestsInFile(Uri.file(file))
            })
        })
    }

    private async findKotlinTestFiles(dir: string): Promise<string[]> {
        try {
            const testFiles: string[] = []
            const files = await promises.readdir(dir, { withFileTypes: true })

            files.forEach(async file => {
                const fullPath = path.join(dir, file.name);

                if (file.isDirectory() && file.name.startsWith(".") && !file.name.startsWith("build")) {
                    // Recursive call for subdirectories 
                    const nestedFiles = await this.findKotlinTestFiles(fullPath);
                    testFiles.push(...nestedFiles);
                } else if (file.isFile() && (file.name.endsWith('.kt') || file.name.endsWith('.kts') && (file.name.includes('Test') || file.name.includes('Tests')))) {
                    // "Heuristic" check. Consider files with "Test" in their name to be candidates to search for. There's probably a better way of doing this...
                    const content = await promises.readFile(fullPath, "utf-8");

                    // Check contents for test annotations/imports
                    if (content.includes("@Test") || content.includes("import org.junit") || content.includes("import kotlin.test") || content.includes("import io.kotest")) {
                        testFiles.push(fullPath);
                    }
                }
            })

            return testFiles;
        } catch (err) {
            LOG.error(`Error finding Kotlin test files: ${err}`);
            return [];
        }
    }

    private async resolveTestsInFile(uri?: Uri): Promise<void> {
        if (!uri) return;

        const filePath = uri.fsPath;
        if (!filePath.endsWith(".kt") && !filePath.endsWith(".kts")) return;

        try {
            this.removeTestsForFile(uri);
            
            const content = await promises.readFile(filePath, "utf-8");

            const fileItem = this.getOrCreateFileTestItem(uri);

            const classRegex = /class\s+(\w+)(?:\s*:\s*\w+(?:<[^>]*>)?)?\s*{/g;
            const methodRegex = /@Test[^]*?(?:fun|suspend fun)\s+(\w+)\s*\([^)]*\)/g

            // Check class declarations
            let classMatch;
            while ((classMatch = classRegex.exec(content)) !== null) {
                const className = classMatch[1]

                if (className.includes("Test")) {
                    // Find test class
                    const classItem = this.createTestItem(`${fileItem.id}.${className}`, className, uri, undefined)
                    fileItem.children.add(classItem)

                    // Find test methods in class
                    let methodMatch;
                    let classContent = content.substring(classMatch.index);
                    const openBraces = classContent.indexOf("{")
                    if (openBraces !== -1) {
                        let braceCount = 1;
                        let endPos = openBraces + 1;

                        while (braceCount > 0 && endPos < classContent.length) {
                            if (classContent[endPos] === "{") braceCount++;
                            else if (classContent[endPos] === "}") braceCount--;
                            endPos++;
                        }

                        classContent = classContent.substring(0, endPos);
                    }

                    while ((methodMatch = methodRegex.exec(classContent)) !== null) {
                        const methodName = methodMatch[1];
                        const methodItem = this.createTestItem(`${classItem.id}.${methodName}`, methodName, uri, undefined)
                        classItem.children.add(methodItem);
                    }
                }
            }

            // TODO: Check for top-level test methods

        } catch (err) {
            LOG.error(`Error parsing tests in file: ${filePath}: ${err}`)
        }
    }

    private removeTestsForFile(uri: Uri) {
        const filePath = uri.fsPath;
        const fileItems = this.fileToTestItemsMap.get(filePath);
        if (!fileItems) return;

        fileItems.forEach(item => {
            this.testController.items.delete(item.id);
            this.testItems.delete(item.id);
        })
        this.fileToTestItemsMap.delete(filePath);
    }

    private getOrCreateFileTestItem(uri: Uri): TestItem {
        const filePath = uri.fsPath;
        const fileName = path.basename(filePath);
        const fileId = `kotlin-test:${filePath}`;

        let fileItem = this.testItems.get(fileId);
        if (!fileItem) {
            fileItem = this.createTestItem(fileId, fileName, uri, undefined);
            this.fileToTestItemsMap.set(filePath, [fileItem])
        }

        return fileItem;
    }

    private createTestItem(id: string, label: string, uri?: Uri, range?: Range): TestItem {
        const item = this.testController.createTestItem(id, label, uri);
        // TODO: Get range so that this is updated
        item.range = range;
        this.testItems.set(id, item);
        return item;
    }

    private async runHandler(
        request: TestRunRequest,
        token: CancellationToken,
        isDebug: boolean = false
    ): Promise<void> {
        const run = this.testController.createTestRun(request);
        const queue: TestItem[] = [];

        if (request.include) {
            request.include.forEach(test => queue.push(test));
        } else {
            this.testController.items.forEach(test => queue.push(test));
        }

        while (queue.length > 0 && !token.isCancellationRequested) {
            const test = queue.shift()!;

            if (request.exclude?.some(excludedTest => this.isAncestorOf(excludedTest, test))) {
                continue;
            }

            if (test.children.size > 0) {
                test.children.forEach(child => queue.push(child));
                continue;
            }

            try {
                run.started(test);

                if (!workspace.workspaceFolders) {
                    throw new Error("No workspace folder found!");
                }

                const workspaceRoot = workspace.workspaceFolders[0].uri.fsPath;
                const hasGradleFile = await fsExists(path.join(workspaceRoot, "build.gradle")) || await fsExists(path.join(workspaceRoot, "build.gradle.kts"))

                const [testClass, testMethod] = test.id.split("#");

                const terminal = window.createTerminal("Kotlin Test");
                terminal.show();

                if (hasGradleFile) {
                    terminal.sendText(`./gradlew test --tests ${testClass}${testMethod ? `.${testMethod}` : ''}`)
                } else {
                    // TODO: Support Maven and other build systems
                    throw new Error("Error running tests: Only Gradle workspaces are supported for now!")
                }

                // TODO: Parse test outputs to give a real indicative result of test passing. For now, defaulting all tests to show passing in UI.
                run.passed(test);
            } catch (err) {
                run.failed(test, new TestMessage(`Test execution failed: ${err}`))
            }
        }

        run.end();
    }

    private isAncestorOf(ancestor: TestItem, descendant: TestItem): boolean {
        let curr = descendant;
        while (curr.parent) {
            if (curr.parent.id === ancestor.id) {
                return true;
            }
            curr = curr.parent;
        }
        return false;
    }
}