/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ExtensionContext, commands, window} from 'vscode';
import { IHint } from '../server/analyzerModel';
import { rhamtEvents } from '../events';
import { ModelService } from '../model/modelService';
import { FileNode } from '../tree/fileNode';
import { GlobalRequestsManager } from './globalRequestsManager';
import { ProcessController } from './processController';
import * as vscode from 'vscode';
import fetch from 'node-fetch';
import * as os from 'os';
import * as path from 'path';
//import { ConfigurationNode } from '../tree/configurationNode';

export class KaiFixDetails { 
    onEditorClosed = new rhamtEvents.TypedEvent<void>();
    public context: ExtensionContext;
    private globalRequestsManager: GlobalRequestsManager;
    private processController: ProcessController;
    private kaiScheme = 'kaifixtext';
    private tempFileUri: vscode.Uri | undefined;
    private openedDiffEditor: vscode.TextEditor | undefined;
    private issueFilePath: string | undefined;
    public static readonly viewType = 'myWebView';
    private activeDiffUri: vscode.Uri | undefined;
    private myWebviewView?: vscode.WebviewView;
    private myWebViewProvider: MyWebViewProvider;
    private outputChannel: vscode.OutputChannel;
    private _fileNodes: Map<string, FileNode> = new Map();

    constructor(context: ExtensionContext, modelService: ModelService, fileNodeMap ?:  Map<string, FileNode> ) {
        this.context = context;
        this.globalRequestsManager = new GlobalRequestsManager();
        this.processController = new ProcessController(this.globalRequestsManager, 4, 4);
        this.myWebViewProvider = new MyWebViewProvider(this);
        this.registerContentProvider();
        this._fileNodes = fileNodeMap || new Map<string, FileNode>();
      
        vscode.window.showInformationMessage(`this is process controller: ${this.processController.processQueue.length}`);
        const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
        watcher.onDidChange(uri => {
            console.log(`File changed: ${uri.fsPath}`);
            vscode.window.showInformationMessage(`File changed: ${uri.fsPath}`);
            if (this._fileNodes.size == 0 ){
                vscode.window.showInformationMessage(`fileNodes Size =  ${this._fileNodes.size}`);
            }
            vscode.window.showInformationMessage(`fileNodes map size =  ${this._fileNodes.size}`);
            const fileNode = this._fileNodes.get(uri.fsPath); 
            const fileMap = this.globalRequestsManager.getFileMap();
            if (fileMap.get(uri.fsPath) === undefined) {
                vscode.window.showInformationMessage(`No entry exists in Map, so adding...+ ${fileNode.file}`);
                this.globalRequestsManager.handleRequest(uri.fsPath, "Kantra");
                fileNode.setInProgress(true, "analyzing");
                //Run analyzer-lsp and add this request to the global map
            } else {
                vscode.window.showInformationMessage(`Process is already running, cancelling in-progress activity and rerunning analyzer. Global Manager size: ${this.globalRequestsManager.getFileMap().size}`);
                if (fileNode) {
                    vscode.commands.executeCommand('rhamt.Stop', fileNode).then(() => {
                        vscode.window.showInformationMessage(`After removing, size should be: ${this.globalRequestsManager.getFileMap().size}`);
                        this.globalRequestsManager.handleRequest(uri.fsPath, "Kantra");
                    });
                }
            }
        });
        context.subscriptions.push(watcher);
       
        this.context.subscriptions.push(vscode.commands.registerCommand('rhamt.Stop', async item => {
            if (item instanceof FileNode) {
                const filePath = item.file;
                this.globalRequestsManager.handleRequest(filePath, "Stop");
                vscode.window.showInformationMessage(`Process stopped. Size of global manager: ${this.globalRequestsManager.getFileMap().size}`);
                item.setInProgress(false);
            } else {
                vscode.window.showErrorMessage('Invalid item passed to rhamt.Stop command');
            }
        }));


        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                MyWebViewProvider.viewType, 
                this.myWebViewProvider
            )
        );
         // Register command handlers
        context.subscriptions.push(commands.registerCommand('rhamt.acceptChanges', this.acceptChangesCommandHandler.bind(this)));
        context.subscriptions.push(commands.registerCommand('rhamt.rejectChanges', this.rejectChangesCommandHandler.bind(this)));

        this.context.subscriptions.push(commands.registerCommand('rhamt.Kai-Fix-Files', async item => {
            const fileNode = item as FileNode;
             this.issueFilePath = fileNode.file;
             vscode.window.showInformationMessage(` FilePath of FILENODE: ${this.issueFilePath}`);
            const issueByFileMap = fileNode.getConfig()._results.model.issueByFile;
            //vscode.window.showInformationMessage(`TOTAL Issues: ${issueByFileMap.size}`);
            const issueByFile = issueByFileMap.get(fileNode.file);
            
            // if (issueByFile && issueByFile.length > 0) {
            //     let issuesList = issueByFile.map(hint => hint.ruleId || 'Unnamed issue').join('\n');
            //     vscode.window.showInformationMessage(`Issues BY FILE (${issueByFile.length}):\n${issuesList}`);
            // } else {
            //     vscode.window.showInformationMessage('No issues for this file.');
            // }


            const fs = require('fs').promises;
            this.outputChannel = vscode.window.createOutputChannel("Kai-Fix All");
            this.outputChannel.show(true);
            let workspaceFolder = vscode.workspace.workspaceFolders[0].name;
            this.outputChannel.appendLine("Generating the fix: ");
            this.outputChannel.appendLine(`Appname Name: ${workspaceFolder}.`);
            this.outputChannel.appendLine(`Incidents: ${JSON.stringify(this.formatHintsToIncidents(issueByFile), null, 2)}`);
            const content = await fs.readFile(this.issueFilePath, { encoding: 'utf8' });
            
            let incidents;
            if (issueByFile) {
                 incidents = this.formatHintsToIncidents(issueByFile);
            } else {
                incidents = [];
            }

            const postData = {
                file_name: this.issueFilePath.replace(vscode.workspace.workspaceFolders[0].uri.path + "/", ""),
                file_contents: content,
                application_name: workspaceFolder,
                incidents: incidents,
                include_llm_results: true,
            };

            const url = 'http://0.0.0.0:8080/get_incident_solutions_for_file';
            const headers = {
                'Content-Type': 'application/json',
            };
            fileNode.setInProgress(true, "fixing");
            this.globalRequestsManager.handleRequest(this.issueFilePath, "Kantra");
      
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(postData),
                });
                

            
            fileNode.setInProgress(false);
            fileNode.refresh();


                if (!response.ok) {
                    vscode.window.showInformationMessage(` Error: ${response.toString}.`);
                    vscode.window.showInformationMessage(` response: ${await response.text()}.`);
                    throw new Error(`HTTP error! status: ${response.status}`);  
                }

            const responseText = await response.json(); 
            console.log(responseText);
           
            const updatedFile = this.extractUpdatedFile(responseText);
            const virtualDocumentUri = vscode.Uri.parse(`${this.kaiScheme}:${this.issueFilePath}`);
       
            
            const total_Reasoning = this.extractTotalReasoning(responseText);
            this.outputChannel.appendLine(`---- Total Reasoning: ---- \n ${total_Reasoning}\n`);
            

            const used_prompts = this.extractUsedPrompts(responseText);
            this.outputChannel.appendLine(`---- Used Prompts: ---- \n${used_prompts}\n`);

            const model_id = this.extractModelID(responseText);
            this.outputChannel.appendLine(`---- Model Id: ---- \n${model_id}\n`);

            const additional_information = this.extractAdditionalInformation(responseText);
            this.outputChannel.appendLine(`---- Additional Infomation: ---- \n${additional_information}\n`);

            const llm_results = this.extractLlmResults(responseText);
            this.outputChannel.appendLine(`---- LLM Result: ---- \n${llm_results}\n`);

            this.outputChannel.appendLine(`---- Updated File: ---- \n${updatedFile}`);

            const tampFileName = 'Kai-fix-All-'+this.getFileName(this.issueFilePath);
            this.outputChannel.appendLine(`Temp Filename: ${tampFileName}.`);
            // Generate a unique temp file path
            this.tempFileUri = await this.writeToTempFile(updatedFile,tampFileName);

            await vscode.commands.executeCommand('vscode.diff', virtualDocumentUri, this.tempFileUri, `Current ⟷ KaiFix`, {
                preview: true,
            }).then(() => {
                this.myWebViewProvider.updateWebview(true);
                this.openedDiffEditor = vscode.window.activeTextEditor;
                this.activeDiffUri = virtualDocumentUri; 
            });
            
            this.watchDiffEditorClose();

            } catch (error) {
                console.error('Error making POST request:', error);
                vscode.window.showErrorMessage(`Failed to perform the operation. ${error}`);
            }
        }));


    }
    public updateFileNodes(fileNodeMap: Map<string, FileNode>): void {
        this._fileNodes = fileNodeMap;
        //vscode.window.showInformationMessage(`Updated list of filesNodes in KAIFIX: ${this._fileNodes.size}`);
    }
    public setWebviewView(webviewView: vscode.WebviewView): void {
        this.myWebviewView = webviewView;
        this.myWebviewView?.show(false);
    }
    public getContext(): ExtensionContext {
        return this.context;
    }

    // private initStatusBarItems(): void {
    //     this.acceptChangesStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
    //     this.acceptChangesStatusBarItem.command = "rhamt.acceptChanges";
    //     this.acceptChangesStatusBarItem.text = `$(check) Accept Changes`;
    //     this.acceptChangesStatusBarItem.tooltip = "Accept Changes";
    //     this.rejectChangesStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);
    //     this.rejectChangesStatusBarItem.command = "rhamt.rejectChanges";
    //     this.rejectChangesStatusBarItem.text = `$(x) Reject Changes`;
    //     this.rejectChangesStatusBarItem.tooltip = "Reject Changes";

    //     this.context.subscriptions.push(this.acceptChangesStatusBarItem, this.rejectChangesStatusBarItem);
    // }

    private watchDiffEditorClose(): void {
        //vscode.window.showInformationMessage(`watchDiffEditorClose`);
        this.context.subscriptions.push(window.onDidChangeActiveTextEditor(this.handleActiveEditorChange.bind(this)));
        this.context.subscriptions.push(vscode.window.onDidChangeWindowState(windowState => {
            if (windowState.focused) {
                this.handleActiveEditorChange(vscode.window.activeTextEditor);
            }
        }));
    }
    private handleActiveEditorChange(editor?: vscode.TextEditor): void {
        let diffFocused = false;

        if (editor) {
            const activeDocumentUri = editor.document.uri;
            if (this.activeDiffUri && (activeDocumentUri.toString() === this.activeDiffUri.toString() || activeDocumentUri.toString() === this.tempFileUri?.toString())) {
                diffFocused = true;
            }
        }
        // this.acceptChangesStatusBarItem[diffFocused ? 'show' : 'hide']();
        // this.rejectChangesStatusBarItem[diffFocused ? 'show' : 'hide']();
        this.myWebViewProvider.updateWebview(diffFocused);
    }
    private async saveSpecificFile(tempFileUri: vscode.Uri): Promise<boolean> {
        
        const editor = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === tempFileUri.toString());
        if (editor) {
            //await vscode.window.showTextDocument(editor.document, { preview: false, preserveFocus: true });
            await vscode.commands.executeCommand('workbench.action.files.save');
            return true; 
        }  
        return false; 
    }
    private async applyChangesAndDeleteTempFile(originalFileUri: vscode.Uri, tempFileUri: vscode.Uri): Promise<void> {
        try {

            const saved = await this.saveSpecificFile(tempFileUri);
                if (saved) {
                   // vscode.window.showInformationMessage('Temp file saved.');
                } else {
                    vscode.window.showInformationMessage('Temp file was not open in an editor, or it was not dirty.');
                }
                const tempFileContent = await vscode.workspace.fs.readFile(tempFileUri);

                await vscode.workspace.fs.writeFile(originalFileUri, tempFileContent);
    
                await vscode.workspace.fs.delete(tempFileUri);
                
                await this.closeEditor(this.openedDiffEditor);
            
            vscode.window.showInformationMessage('Changes applied successfully.');
        } catch (error) {
            console.error('Failed to apply changes or delete temporary file:', error);
            vscode.window.showErrorMessage('Failed to apply changes to the original file.');
        }
    }
    private async writeToTempFile(content: string, kaifixFilename: string): Promise<vscode.Uri> {
        // Generate a unique temp file path
        const tempFilePath = path.join(os.tmpdir(), kaifixFilename);
        const tempFileUri = vscode.Uri.file(tempFilePath);

        // Convert the string content to a Uint8Array
        const encoder = new TextEncoder(); // TextEncoder is globally available
        const uint8Array = encoder.encode(content);

        // Write the content to the temp file
        await vscode.workspace.fs.writeFile(tempFileUri, uint8Array);

        return tempFileUri;
    }
    private extractUpdatedFile(jsonResponse: string): string {
        try {
            const responseObj = JSON.parse(jsonResponse);
    
            if ('updated_file' in responseObj) {
                const updatedFileContent = responseObj.updated_file;
                return updatedFileContent || 'No content available in updated_file.';
            } else {
                vscode.window.showInformationMessage('The "updated_file" property does not exist in the response object.');
                return 'The "updated_file" property does not exist in the response object.';
            }
        } catch (error) {
            vscode.window.showInformationMessage('Failed to parse jsonResponse:', error);
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
                vscode.window.showInformationMessage('The "total_reasoning" property does not exist in the response object.');
                return 'The "total_reasoning" property does not exist in the response object.';
            }
        } catch (error) {
            vscode.window.showInformationMessage('Failed to parse jsonResponse:', error);
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
                vscode.window.showInformationMessage('The "used_prompts" property does not exist in the response object.');
                return 'The "used_prompts" property does not exist in the response object.';
            }
        } catch (error) {
            vscode.window.showInformationMessage('Failed to parse jsonResponse:', error);
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
                vscode.window.showInformationMessage('The "model_id" property does not exist in the response object.');
                return 'The "model_id" property does not exist in the response object.';
            }
        } catch (error) {
            vscode.window.showInformationMessage('Failed to parse jsonResponse:', error);
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
                vscode.window.showInformationMessage('The "additional_information" property does not exist in the response object.');
                return 'The "additional_information" property does not exist in the response object.';
            }
        } catch (error) {
            vscode.window.showInformationMessage('Failed to parse jsonResponse:', error);
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
                vscode.window.showInformationMessage('The "llm_results" property does not exist in the response object.');
                return 'The "llm_results" property does not exist in the response object.';
            }
        } catch (error) {
            vscode.window.showInformationMessage('Failed to parse jsonResponse:', error);
            return 'An error occurred while parsing the JSON response.';
        }
    }
    private getFileName(filePath: string): string {
        const segments = filePath.split('/');
        const fileName = segments.pop();
        return fileName || '';
    }

    private registerContentProvider() {
        const provider = new (class implements vscode.TextDocumentContentProvider {
            onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
            onDidChange = this.onDidChangeEmitter.event;
            // provideTextDocumentContent(uri: vscode.Uri): vscode.ProviderResult<string> {
            //     const content = decodeURIComponent(uri.path);
            //     return content;
            // }
            provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
                const filePath = uri.path; 
                const fileUri = vscode.Uri.file(filePath);
                return vscode.workspace.fs.readFile(fileUri).then(buffer => {
                    return buffer.toString();
                });
            }
        })();
            // Register the provider with Visual Studio Code
            this.context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(this.kaiScheme, provider));
    }

    // private displayFormattedLLMOutput(data: string) {
    //     // Parse the JSON to get the llm_output field
    //     const parsedData = JSON.parse(data);
    //     const llmOutput = parsedData.llm_output;  
    //     // Replace the markdown-like headings and newlines with a formatted version for plain text
    //     const formattedOutput = llmOutput
    //         .replace(/## /g, '== ') // Convert markdown headings to plain text
    //         .replace(/\\n/g, '\n') // Convert escaped newlines to actual newlines
    //         .replace(/^.*```.*$/gm, ''); // Remove entire lines containing code block ticks
    //     // Create a new output channel or use an existing one
    //     return formattedOutput;
    // }

    // private getUpdatedFileSection(data: string): string {
    //     // Match the "Updated File" section and capture everything after the title
    //     const updatedFileRegex = /== Updated File\s*\n([\s\S]*?)(?=\n==|$)/;
    //     const matches = data.match(updatedFileRegex);
        
    //     // Return the captured group, which is the content after "Updated File", if found
    //     return matches && matches[1].trim() || '';
    // }
        
    private async closeEditor(editor: vscode.TextEditor): Promise<void> {
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }

    private resetState(): void {
        this.openedDiffEditor = undefined;
        this.tempFileUri = undefined;
        this.issueFilePath = undefined;
        this.activeDiffUri = undefined;
        this.outputChannel.dispose();

    }

    public async rejectChangesCommandHandler(): Promise<void> {
        if (this.tempFileUri) {
            await vscode.workspace.fs.delete(this.tempFileUri);
            await this.closeEditor(this.openedDiffEditor);
            this.resetState();
        }
    }

    public async acceptChangesCommandHandler(): Promise<void> {
        if (!this.tempFileUri || !this.issueFilePath) {
            vscode.window.showErrorMessage("No changes to apply.");
            return;
        }
        await this.applyChangesAndDeleteTempFile(vscode.Uri.file(this.issueFilePath), this.tempFileUri);
        this.resetState();
    }

    public async handleMessage(message: any): Promise<void>  {
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
        ruleset_name: hint.rulesetName,
        ruleset_description: hint.ruleSetDiscription || 'No Discription', 
        violation_name: hint.ruleId,     
        violation_description: hint.violationDiscription || 'No Discription',
        uri : hint.file || '',
        message: hint.hint || 'No message', 
        // incident_variables: {
        //     file: hint.variables['file'] || '',
        //     kind: hint.variables['kind'] || '',
        //     name: hint.variables['name'] || '',
        //     package: hint.variables['package'] || '',
        // },
        // line_number: hint.lineNumber,
        // analysis_message: hint.hint,
        }));
    }
    

}

export class MyWebViewProvider implements vscode.WebviewViewProvider {
   // Hold a reference to the main class
    private nonce: string; // A unique, random nonce for each instance
    private _view?: vscode.WebviewView;

    constructor(private readonly kaiFixDetails: KaiFixDetails) {
        this.kaiFixDetails = kaiFixDetails;
        this.nonce = getNonce(); // Generate a nonce when the provider is constructed
    }
    public static readonly viewType = 'myWebView';
    
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;
        this._view.webview.options = { enableScripts: true };
        this._view.webview.html = this.getDefaultHtmlForWebview(); // Default content

        // Listen for messages from the webview
        this._view.webview.onDidReceiveMessage(async (message) => {
            await this.kaiFixDetails.handleMessage(message);
        }, undefined, this.kaiFixDetails.context.subscriptions);
    }

    public updateWebview(diffFocused: boolean): void {
        if (this._view) {
            this._view.webview.html = diffFocused
                ? this.getHtmlForWebview() // Content when diff is focused
                : this.getDefaultHtmlForWebview(); // Default content
        }
    }


    private getHtmlForWebview(): string {
        return  `
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
        /* Hover effects */
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
        // Define the HTML content to display when no diff editor is focused
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
