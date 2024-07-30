import { ExtensionContext, commands, window, workspace, Uri, TextEditor, TextDocumentContentProvider, EventEmitter } from 'vscode';
import * as vscode from 'vscode';
import { IHint } from '../server/analyzerModel';
import { rhamtEvents } from '../events';
import { ModelService } from '../model/modelService';
import { FileNode } from '../tree/fileNode';
import * as os from 'os';
import * as path from 'path';
import { MyTaskProvider, Requests, incrementTaskCounter, addRequest } from './taskprovider';

interface FileState {
    inProgress: boolean;
    taskExecution?: vscode.TaskExecution;
    tempFileUri?: Uri;
    originalFilePath?: string;
}

export class KaiFixDetails {
    onEditorClosed = new rhamtEvents.TypedEvent<void>();
    public context: ExtensionContext;
    private kaiScheme = 'kaifixtext';
    private fileStateMap: Map<string, FileState> = new Map();
    private taskProvider: MyTaskProvider;
    private openedDiffEditors: Map<string, TextEditor> = new Map();
    public static readonly viewType = 'myWebView';
    private myWebviewView?: vscode.WebviewView;
    private myWebViewProvider: MyWebViewProvider;
    private outputChannel: vscode.OutputChannel;
    private _fileNodes: Map<string, FileNode> = new Map();

    constructor(context: ExtensionContext, modelService: ModelService, fileNodeMap?: Map<string, FileNode>) {
        this.context = context;
        this.outputChannel = window.createOutputChannel("KaiFix Output");
        this.taskProvider = new MyTaskProvider(this.outputChannel, this);
        this.myWebViewProvider = new MyWebViewProvider(this);
        this.registerContentProvider();
        this._fileNodes = fileNodeMap || new Map<string, FileNode>();

        const watcher = workspace.createFileSystemWatcher('**/*', false, false, false);
        watcher.onDidChange(uri => {
            console.log(`File changed: ${uri.fsPath}`);
            window.showInformationMessage(`File changed: ${uri.fsPath}`);
            const fileNode = this._fileNodes.get(uri.fsPath);
            if (fileNode) {
                fileNode.setInProgress(true, "analyzing");
                commands.executeCommand('rhamt.Stop', fileNode).then(() => {
                    // add code to stop
                });
            }
        });
        context.subscriptions.push(watcher);

        context.subscriptions.push(commands.registerCommand('rhamt.Stop', async item => {
            const fileNode = item as FileNode;
            this.stopFileProcess(fileNode.file);
        }));

        context.subscriptions.push(
            window.registerWebviewViewProvider(
                MyWebViewProvider.viewType,
                this.myWebViewProvider
            )
        );

        context.subscriptions.push(commands.registerCommand('rhamt.acceptChanges', this.acceptChangesCommandHandler.bind(this)));
        context.subscriptions.push(commands.registerCommand('rhamt.rejectChanges', this.rejectChangesCommandHandler.bind(this)));

        this.context.subscriptions.push(commands.registerCommand('rhamt.Kai-Fix-Files', async item => {
            const fileNode = item as FileNode;
            const filePath = fileNode.file;

            if (this.fileStateMap.get(filePath)?.inProgress) {
                window.showInformationMessage(`Process already running for file: ${filePath}`);
                return;
            }

            const issueByFileMap = fileNode.getConfig()._results.model.issueByFile;
            const issueByFile = issueByFileMap.get(fileNode.file);
            const fs = require('fs').promises;
            this.outputChannel.show(true);
            const workspaceFolder = workspace.workspaceFolders[0].name;
            this.outputChannel.appendLine("Generating the fix: ");
            this.outputChannel.appendLine(`Appname Name: ${workspaceFolder}.`);
            this.outputChannel.appendLine(`Incidents: ${JSON.stringify(this.formatHintsToIncidents(issueByFile), null, 2)}`);
            const content = await fs.readFile(filePath, { encoding: 'utf8' });

            const incidents = issueByFile ? this.formatHintsToIncidents(issueByFile) : [];

            const postData = {
                file_name: filePath.replace(workspace.workspaceFolders[0].uri.path + "/", ""),
                file_contents: content,
                application_name: workspaceFolder,
                incidents: incidents,
                include_llm_results: "True"
            };

            const request: Requests = {
                id: incrementTaskCounter(),
                name: `KaiFixTask-${fileNode.file}`,
                type: 'kai',
                file: filePath,
                data: postData
            };

            addRequest(request);
            this.taskProvider.processQueue();
        }));
    }

    private updateFileState(filePath: string, state: Partial<FileState>) {
        const currentState = this.fileStateMap.get(filePath) || { inProgress: false };
        this.fileStateMap.set(filePath, { ...currentState, ...state });
    }

    private stopFileProcess(filePath: string) {
        const state = this.fileStateMap.get(filePath);
        if (state && state.taskExecution) {
            this.taskProvider.cancelTask(state.taskExecution.task.definition.id);
            this.updateFileState(filePath, { inProgress: false, taskExecution: undefined });
            window.showInformationMessage(`Process stopped for file: ${filePath}`);
        } else {
            window.showInformationMessage(`No process running for file: ${filePath}`);
        }
    }

    public handleTaskResult(filePath: string, result: any) {
        if (this.outputChannel) {
            this.outputChannel.appendLine(`Result received for file ${filePath}: ${JSON.stringify(result)}`);
        }
        this.updateFileState(filePath, { inProgress: false, taskExecution: undefined });

        if (result.error) {
            window.showErrorMessage(result.error);
            return;
        }

        const responseText = result.result;
        console.log(responseText);

        const updatedFile = this.extractUpdatedFile(responseText);
        const virtualDocumentUri = Uri.parse(`${this.kaiScheme}:${filePath}`);

        const total_Reasoning = this.extractTotalReasoning(responseText);
        if (this.outputChannel) {
            this.outputChannel.appendLine(`---- Total Reasoning: ---- \n ${total_Reasoning}\n`);
        }

        const used_prompts = this.extractUsedPrompts(responseText);
        if (this.outputChannel) {
            this.outputChannel.appendLine(`---- Used Prompts: ---- \n${used_prompts}\n`);
        }

        const model_id = this.extractModelID(responseText);
        if (this.outputChannel) {
            this.outputChannel.appendLine(`---- Model Id: ---- \n${model_id}\n`);
        }

        const additional_information = this.extractAdditionalInformation(responseText);
        if (this.outputChannel) {
            this.outputChannel.appendLine(`---- Additional Information: ---- \n${additional_information}\n`);
        }

        const llm_results = this.extractLlmResults(responseText);
        if (this.outputChannel) {
            this.outputChannel.appendLine(`---- LLM Result: ---- \n${llm_results}\n`);
        }

        if (this.outputChannel) {
            this.outputChannel.appendLine(`---- Updated File: ---- \n${updatedFile}`);
        }

        const tempFileName = 'Kai-fix-All-' + this.getFileName(filePath);
        if (this.outputChannel) {
            this.outputChannel.appendLine(`Temp Filename: ${tempFileName}.`);
        }

        this.writeToTempFile(updatedFile, tempFileName).then((tempFileUri) => {
            this.updateFileState(filePath, { tempFileUri, originalFilePath: filePath });

            commands.executeCommand('vscode.diff', virtualDocumentUri, tempFileUri, `Current ⟷ KaiFix`, {
                preview: false, // Disable preview mode
            }).then(() => {
                const editor = window.activeTextEditor;
                if (editor) {
                    this.openedDiffEditors.set(filePath, editor);
                    this.watchDiffEditorClose();
                    this.myWebViewProvider.updateWebview(true);
                }
            }, error => {
                if (this.outputChannel) {
                    this.outputChannel.appendLine(`Error opening diff view: ${error}`);
                }
                window.showErrorMessage(`Error opening diff view: ${error}`);
            });
        }, error => {
            if (this.outputChannel) {
                this.outputChannel.appendLine(`Error writing to temp file: ${error}`);
            }
            window.showErrorMessage(`Error writing to temp file: ${error}`);
        });
    }

    public updateFileNodes(fileNodeMap: Map<string, FileNode>): void {
        this._fileNodes = fileNodeMap;
    }

    public setWebviewView(webviewView: vscode.WebviewView): void {
        this.myWebviewView = webviewView;
        this.myWebviewView?.show(false);
    }

    public getContext(): ExtensionContext {
        return this.context;
    }

    private watchDiffEditorClose(): void {
        this.context.subscriptions.push(window.onDidChangeActiveTextEditor(this.handleActiveEditorChange.bind(this)));
        this.context.subscriptions.push(window.onDidChangeWindowState(windowState => {
            if (windowState.focused) {
                this.handleActiveEditorChange(window.activeTextEditor);
            }
        }));

        this.context.subscriptions.push(workspace.onDidCloseTextDocument(document => {
            const closedPath = document.uri.fsPath;
            if (this.openedDiffEditors.has(closedPath)) {
                this.openedDiffEditors.delete(closedPath);
            }
        }));
    }

    private handleActiveEditorChange(editor?: TextEditor): void {
        if (!editor) {
            return;
        }

        const activeDocumentUri = editor.document.uri;
        const filePath = activeDocumentUri.fsPath;
        if (this.openedDiffEditors.has(filePath)) {
            // The editor is one of the tracked diff editors.
        }

        const isDiffFocused = this.openedDiffEditors.has(filePath);
        this.myWebViewProvider.updateWebview(isDiffFocused);
    }

    private async saveSpecificFile(tempFileUri: Uri): Promise<boolean> {
        const editor = window.visibleTextEditors.find(editor => editor.document.uri.toString() === tempFileUri.toString());
        if (editor) {
            await commands.executeCommand('workbench.action.files.save');
            return true;
        }
        return false;
    }

    private async applyChangesAndDeleteTempFile(originalFileUri: Uri, tempFileUri: Uri): Promise<void> {
        try {
            const saved = await this.saveSpecificFile(tempFileUri);
            if (saved) {
                window.showInformationMessage('Temp file saved.');
            } else {
                window.showInformationMessage('Temp file was not open in an editor, or it was not dirty.');
            }
            const tempFileContent = await workspace.fs.readFile(tempFileUri);
            await workspace.fs.writeFile(originalFileUri, tempFileContent);
            await workspace.fs.delete(tempFileUri);
            await this.closeEditor(this.openedDiffEditors.get(originalFileUri.fsPath));
            window.showInformationMessage('Changes applied successfully.');
        } catch (error) {
            console.error('Failed to apply changes or delete temporary file:', error);
            window.showErrorMessage('Failed to apply changes to the original file.');
        }
    }

    private async writeToTempFile(content: string, kaifixFilename: string): Promise<Uri> {
        const tempFilePath = path.join(os.tmpdir(), kaifixFilename);
        const tempFileUri = Uri.file(tempFilePath);
        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(content);
        await workspace.fs.writeFile(tempFileUri, uint8Array);
        return tempFileUri;
    }

    private extractUpdatedFile(jsonResponse: string): string {
        try {
            const responseObj = JSON.parse(jsonResponse);
            if ('updated_file' in responseObj) {
                const updatedFileContent = responseObj.updated_file;
                return updatedFileContent || 'No content available in updated_file.';
            } else {
                window.showInformationMessage('The "updated_file" property does not exist in the response object.');
                return 'The "updated_file" property does not exist in the response object.';
            }
        } catch (error) {
            window.showInformationMessage('Failed to parse jsonResponse:', error);
            return 'An error occurred while parsing the JSON response.';
        }
    }

    private extractTotalReasoning(jsonResponse: string): string {
        try {
            const responseObj = JSON.parse(jsonResponse);
            if ('total_reasoning' in responseObj) {
                const total_reasoningContent = responseObj.total_reasoning;
                return total_reasoningContent || 'No content available in total_reasoning.';
            } else {
                window.showInformationMessage('The "total_reasoning" property does not exist in the response object.');
                return 'The "total_reasoning" property does not exist in the response object.';
            }
        } catch (error) {
            window.showInformationMessage('Failed to parse jsonResponse:', error);
            return 'An error occurred while parsing the JSON response.';
        }
    }

    private extractUsedPrompts(jsonResponse: string): string {
        try {
            const responseObj = JSON.parse(jsonResponse);
            if ('used_prompts' in responseObj) {
                const used_promptsContent = responseObj.used_prompts;
                return used_promptsContent || 'No content available in used_prompts.';
            } else {
                window.showInformationMessage('The "used_prompts" property does not exist in the response object.');
                return 'The "used_prompts" property does not exist in the response object.';
            }
        } catch (error) {
            window.showInformationMessage('Failed to parse jsonResponse:', error);
            return 'An error occurred while parsing the JSON response.';
        }
    }

    private extractModelID(jsonResponse: string): string {
        try {
            const responseObj = JSON.parse(jsonResponse);
            if ('model_id' in responseObj) {
                const model_idContent = responseObj.model_id;
                return model_idContent || 'No content available in model_id.';
            } else {
                window.showInformationMessage('The "model_id" property does not exist in the response object.');
                return 'The "model_id" property does not exist in the response object.';
            }
        } catch (error) {
            window.showInformationMessage('Failed to parse jsonResponse:', error);
            return 'An error occurred while parsing the JSON response.';
        }
    }

    private extractAdditionalInformation(jsonResponse: string): string {
        try {
            const responseObj = JSON.parse(jsonResponse);
            if ('additional_information' in responseObj) {
                const additional_informationContent = responseObj.additional_information;
                return additional_informationContent || 'No content available in additional_information.';
            } else {
                window.showInformationMessage('The "additional_information" property does not exist in the response object.');
                return 'The "additional_information" property does not exist in the response object.';
            }
        } catch (error) {
            window.showInformationMessage('Failed to parse jsonResponse:', error);
            return 'An error occurred while parsing the JSON response.';
        }
    }

    private extractLlmResults(jsonResponse: string): string {
        try {
            const responseObj = JSON.parse(jsonResponse);
            if ('llm_results' in responseObj) {
                const llm_resultsContent = responseObj.llm_results;
                return llm_resultsContent || 'No content available in llm_results.';
            } else {
                window.showInformationMessage('The "llm_results" property does not exist in the response object.');
                return 'The "llm_results" property does not exist in the response object.';
            }
        } catch (error) {
            window.showInformationMessage('Failed to parse jsonResponse:', error);
            return 'An error occurred while parsing the JSON response.';
        }
    }

    private getFileName(filePath: string): string {
        const segments = filePath.split('/');
        const fileName = segments.pop();
        return fileName || '';
    }

    private registerContentProvider() {
        const provider = new (class implements TextDocumentContentProvider {
            onDidChangeEmitter = new EventEmitter<Uri>();
            onDidChange = this.onDidChangeEmitter.event;
            provideTextDocumentContent(uri: Uri): Thenable<string> {
                const filePath = uri.path;
                const fileUri = Uri.file(filePath);
                return workspace.fs.readFile(fileUri).then(buffer => {
                    return buffer.toString();
                });
            }
        })();
        this.context.subscriptions.push(workspace.registerTextDocumentContentProvider(this.kaiScheme, provider));
    }

    private async closeEditor(editor?: TextEditor): Promise<void> {
        if (editor) {
            await commands.executeCommand('workbench.action.closeActiveEditor');
        }
    }

    private resetState(): void {
        this.openedDiffEditors.clear();
    }

    public async acceptChangesCommandHandler(): Promise<void> {
        if (!this.openedDiffEditors || this.openedDiffEditors.size === 0) {
            window.showErrorMessage("No diff editor is currently open.");
            return;
        }

        const activeEditor = window.activeTextEditor;
        if (!activeEditor) {
            window.showErrorMessage("No active editor found.");
            return;
        }

        const activeEditorPath = activeEditor.document.uri.fsPath;
        console.log(`Active editor path: ${activeEditorPath}`);

        const fileState = Array.from(this.fileStateMap.values()).find(state =>
            state.tempFileUri?.fsPath === activeEditorPath
        );

        if (!fileState || !fileState.tempFileUri || !fileState.originalFilePath) {
            console.log(`No matching fileState found for: ${activeEditorPath}`);
            window.showErrorMessage("No changes to apply.");
            return;
        }

        console.log(`Applying changes for file: ${fileState.originalFilePath}`);
        const originalFileUri = Uri.file(fileState.originalFilePath);
        await this.applyChangesAndDeleteTempFile(originalFileUri, fileState.tempFileUri);
        this.resetState();
        this.myWebViewProvider.updateWebview(false);
    }

    public async rejectChangesCommandHandler(): Promise<void> {
        const activeEditor = window.activeTextEditor;
        if (!activeEditor) {
            window.showErrorMessage("No active editor found.");
            return;
        }

        const activeEditorPath = activeEditor.document.uri.fsPath;
        console.log(`Active editor path for reject: ${activeEditorPath}`);

        const fileState = Array.from(this.fileStateMap.values()).find(state =>
            state.tempFileUri?.fsPath === activeEditorPath
        );

        if (!fileState || !fileState.tempFileUri) {
            window.showErrorMessage("No changes to reject.");
            return;
        }

        console.log(`Rejecting changes for file: ${fileState.originalFilePath}`);

        await this.closeEditor(this.openedDiffEditors.get(activeEditorPath));
        await workspace.fs.delete(fileState.tempFileUri);
        this.resetState();
    }

    public async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'acceptChanges':
                await this.acceptChangesCommandHandler();
                break;
            case 'rejectChanges':
                await this.rejectChangesCommandHandler();
                break;
        }
    }

    private formatHintsToIncidents(hints: IHint[]) {
        return hints.map(hint => ({
            violation_name: hint.ruleId,
            ruleset_name: hint.rulesetName,
            incident_variables: {
                file: hint.variables['file'] || '',
                kind: hint.variables['kind'] || '',
                name: hint.variables['name'] || '',
                package: hint.variables['package'] || '',
            },
            line_number: hint.lineNumber,
            analysis_message: hint.hint,
        }));
    }
}

export class MyWebViewProvider implements vscode.WebviewViewProvider {
    private nonce: string;
    private _view?: vscode.WebviewView;

    constructor(private readonly kaiFixDetails: KaiFixDetails) {
        this.kaiFixDetails = kaiFixDetails;
        this.nonce = getNonce();
    }

    public static readonly viewType = 'myWebView';

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;
        this._view.webview.options = { enableScripts: true };
        this._view.webview.html = this.getDefaultHtmlForWebview();

        this._view.webview.onDidReceiveMessage(async (message) => {
            await this.kaiFixDetails.handleMessage(message);
        }, undefined, this.kaiFixDetails.context.subscriptions);
    }

    public updateWebview(diffFocused: boolean): void {
        if (this._view) {
            this._view.webview.html = diffFocused
                ? this.getHtmlForWebview()
                : this.getDefaultHtmlForWebview();
        }
    }

    private getHtmlForWebview(): string {
        return `
        <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${this.nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kai Fix Actions</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            padding: 10px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        .explanation {
            margin-bottom: 20px;
            text-align: center;
        }
        .button {
            padding: 9px 18px;
            margin: 6px 0;
            border: none;
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
            outline: none;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 55%;
            box-sizing: border-box;
        }
        #acceptButton {
            background-color: #4CAF50; /* Green */
            color: white;
        }
        #acceptButton::before {
            content: '✔️';
            margin-right: 10px;
        }
        #rejectButton {
            background-color: #f44336; /* Red */
            color: white;
        }
        #rejectButton::before {
            content: '❌';
            margin-right: 10px;
        }
        #acceptButton:hover, #rejectButton:hover {
            opacity: 0.85;
        }
        #acceptButton:active, #rejectButton:active {
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            transform: translateY(2px);
        }
    </style>
</head>
<body>
    <div class="explanation">
        Clicking 'Accept' will save the proposed changes and replace the original file with these changes.
    </div>
    <button id="acceptButton" class="button">Accept Changes</button>
    <button id="rejectButton" class="button">Reject Changes</button>
    <script nonce="${this.nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('acceptButton').addEventListener('click', () => {
        vscode.postMessage({ command: 'acceptChanges' });
    });
    document.getElementById('rejectButton').addEventListener('click', () => {
        vscode.postMessage({ command: 'rejectChanges' });
    });
    </script>
</body>
</html>
        `;
    }

    private getDefaultHtmlForWebview(): string {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${this.nonce}';">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body, html {
                    height: 70%;
                    margin: 0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    text-align: center;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                }
                .message {
                    font-size: 12px;
                }
            </style>
        </head>
        <body>
            <div class="message">No action required at this time</div>
        </body>
        </html>
    `;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 16; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
