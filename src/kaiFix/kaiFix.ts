/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ExtensionContext, commands } from 'vscode';
import { IHint, IssueContainer } from '../server/analyzerModel';
import { rhamtEvents } from '../events';
import { ModelService } from '../model/modelService';
import * as vscode from 'vscode';
import fetch from 'node-fetch';
import * as os from 'os';
import * as path from 'path';

export class KaiFixDetails { 
    onEditorClosed = new rhamtEvents.TypedEvent<void>();
    private context: ExtensionContext;
    // define a unique scheme for your content provider 
    private kaiScheme = 'kaifixtext';
    private tempFileUri: vscode.Uri | undefined;
    private openedDiffEditor: vscode.TextEditor | undefined;
    private issueFilePath: string | undefined;
    private promptShown = false ; 
    constructor(context: ExtensionContext, modelService: ModelService) {
        this.context = context;
        this.registerContentProvider();
        this.context.subscriptions.push(commands.registerCommand('rhamt.kai', async item => {
            const issue = (item as IssueContainer).getIssue();
            const hint = issue as IHint;
            this.issueFilePath = issue.file;
            const fs = require('fs').promises;
           
            const outputChannel = vscode.window.createOutputChannel("Kai-Fix Result");
            outputChannel.show(true);
            let workspaceFolder = vscode.workspace.workspaceFolders[0].name;
            
          
            outputChannel.appendLine("Generating the fix: ");
            outputChannel.appendLine(`Appname Name: ${workspaceFolder}.`);
            outputChannel.appendLine(`Ruleset Name: ${hint.rulesetName}.`);
            outputChannel.appendLine(`Ruleset ID: ${hint.ruleId}.`);
            outputChannel.appendLine(`Variables: ${JSON.stringify(hint.variables, null, 2)}`);
            // outputChannel.appendLine(`file: ${hint.variables['file'] || ''}.`);
            // outputChannel.appendLine(`kind: ${hint.variables['kind'] || ''}.`);
            const content = await fs.readFile(this.issueFilePath, { encoding: 'utf8' });
            //outputChannel.appendLine(`File Content : ${content}.`);


            
                const postData = {
                application_name: workspaceFolder,
                violation_name: hint.ruleId,
                ruleset_name: hint.rulesetName,
                incident_snip: hint.sourceSnippet, 
                incident_variables: {
                    file: hint.variables['file'] || '',
                    kind: hint.variables['kind'] || '',
                    name: hint.variables['name'] || '',
                    package: hint.variables['package'] || '',
                },
                file_name: hint.file,
                file_contents: content,
                line_number: hint.lineNumber,
                analysis_message: hint.hint,
            };

            const url = 'http://0.0.0.0:8080/get_incident_solution';
            const headers = {
                'Content-Type': 'application/json',
            };
            const statusBarMessage = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
            let currentFrame = 0;
            const frames = ['$(sync~spin) Generating Fix..', '$(sync~spin) Generating Fix..', '$(sync~spin) Generating Fix..'];
        
            // Start spinner
            statusBarMessage.text = frames[0];
            statusBarMessage.show();
            const spinner = setInterval(() => {
                statusBarMessage.text = frames[currentFrame];
                currentFrame = (currentFrame + 1) % frames.length;
            }, 500); // Change spinner frame every 500ms
           
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(postData),
                });
                
                clearInterval(spinner);
                statusBarMessage.hide();

                if (!response.ok) {
                    vscode.window.showInformationMessage(` Error: ${response.toString}.`);
                    vscode.window.showInformationMessage(` response: ${await response.text()}.`);
                    throw new Error(`HTTP error! status: ${response.status}`);  
                }
                vscode.window.showInformationMessage(`Yay! Kyma ${response.status}.`);
                const responseText = await response.text(); // Get the raw response text
                console.log(responseText);

                // fs.appendFile(logFilePath, responseText, (err) => {
                //     if (err) throw err;
                //     console.log('postData has been appended to the log file.')
                //     })

                // fs.appendFile(logFilePath, "----------------------------------------------", (err) => {
                //     if (err) throw err;
                //     console.log('postData has been appended to the log file.');
                //     });
                const formattedOutput = this.displayFormattedLLMOutput(responseText);
                outputChannel.appendLine(formattedOutput);
                const updatedFile = this.getUpdatedFileSection(formattedOutput);
                // Create a virtual document URI using the custom scheme
                //const encodedText = encodeURIComponent(responseText);
               const virtualDocumentUri = vscode.Uri.parse(`${this.kaiScheme}:${this.issueFilePath}`);
               
            
            const tampFileName = 'Kai-fix'+hint.lineNumber+hint.ruleId+this.getFileName(this.issueFilePath);
            outputChannel.appendLine(`Tamp Filename: ${tampFileName}.`);
            // Generate a unique temp file path
            this.tempFileUri = await this.writeToTempFile(updatedFile,tampFileName);

            await vscode.commands.executeCommand('vscode.diff', virtualDocumentUri, this.tempFileUri, ` Current ⟷ KaiFix`, {
                preview: true
            })
            this.openedDiffEditor = vscode.window.activeTextEditor;
            // Start watching for the diff editor to close
            this.watchDiffEditorClose(this.issueFilePath);


            } catch (error) {
                console.error('Error making POST request:', error);
                vscode.window.showErrorMessage(`Failed to perform the operation. ${error}`);
            }
        }));

    }

    private watchDiffEditorClose(originalFilePath: string): void {        
        this.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async editor => {
            if (this.openedDiffEditor && (!editor || editor.document.uri.toString() !== this.openedDiffEditor.document.uri.toString())) {
                if (this.shouldShowPrompt(editor)) {
                    this.promptShown = true; 
                const action = await vscode.window.showInformationMessage(
                    'Do you want to apply the changes?',
                    { modal: true },
                    'Apply',
                    'Reject'
                );
    
                if (action === 'Apply') {
                    await this.applyChangesAndDeleteTempFile(vscode.Uri.file(this.issueFilePath), this.tempFileUri,this.openedDiffEditor);
                    this.promptShown = false;
                } else if (action === 'Reject') {
                    await vscode.workspace.fs.delete(this.tempFileUri);
                    await this.closeEditor(this.openedDiffEditor);
                    this.promptShown = false;
                }
                // Reset the openedDiffEditor reference
                this.openedDiffEditor = undefined;
                this.tempFileUri = undefined;
                this.issueFilePath = undefined;
                
            }
        }
        }));
    }
    private async applyChangesAndDeleteTempFile(originalFileUri: vscode.Uri, tempFileUri: vscode.Uri, openedDiffEditor:vscode.TextEditor): Promise<void> {
        try {
            // Read the content from the temp file
            const tempFileContent = await vscode.workspace.fs.readFile(tempFileUri);
    
            // Write the content to the original file, effectively replacing it
            await vscode.workspace.fs.writeFile(originalFileUri, tempFileContent);
            
            await this.closeEditor(this.openedDiffEditor);

            // Delete the temporary file
            await vscode.workspace.fs.delete(tempFileUri);
    
            vscode.window.showInformationMessage('Changes applied successfully.');
        } catch (error) {
            console.error('Failed to apply changes or delete temporary file:', error);
            vscode.window.showErrorMessage('Failed to apply changes to the original file.');
        }
    }
    // Function to write content to a temp file and return its URI
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

private displayFormattedLLMOutput(data: string) {
    // Parse the JSON to get the llm_output field
    const parsedData = JSON.parse(data);
    const llmOutput = parsedData.llm_output;  
    // Replace the markdown-like headings and newlines with a formatted version for plain text
    const formattedOutput = llmOutput
        .replace(/## /g, '== ') // Convert markdown headings to plain text
        .replace(/\\n/g, '\n') // Convert escaped newlines to actual newlines
        .replace(/^.*```.*$/gm, ''); // Remove entire lines containing code block ticks
      // Create a new output channel or use an existing one
      return formattedOutput;
}

    private getUpdatedFileSection(data: string): string {
        // Match the "Updated File" section and capture everything after the title
        const updatedFileRegex = /== Updated File\s*\n([\s\S]*?)(?=\n==|$)/;
        const matches = data.match(updatedFileRegex);
    
        // Return the captured group, which is the content after "Updated File", if found
        return matches && matches[1].trim() || '';
    }
    
 private async closeEditor(editor: vscode.TextEditor): Promise<void> {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
}

private shouldShowPrompt(editor: vscode.TextEditor | undefined): boolean {
    if (this.promptShown) {
        return false;
    }
    return true;
}
}