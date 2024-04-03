// import { ExtensionContext, commands, window} from 'vscode';
// import { rhamtEvents } from '../events';
// import { ModelService } from '../model/modelService';
// import * as vscode from 'vscode';
// import { FileNode } from '../tree/fileNode';
// import { IHint } from '../server/analyzerModel';
// import * as os from 'os';
// import * as path from 'path';

 
// export class KaiFixAll { 
//     onEditorClosed = new rhamtEvents.TypedEvent<void>();
//     public context: ExtensionContext;
//     private kaiScheme = 'kaifixtext';
//     private tempFileUri: vscode.Uri | undefined;
//     private openedDiffEditor: vscode.TextEditor | undefined;
//     private issueFilePath: string | undefined;
//     private activeDiffUri: vscode.Uri | undefined;
  
   


//     constructor(context: ExtensionContext, modelService: ModelService) {
//         this.context = context;
//         this.registerContentProvider();
    
      
//         this.context.subscriptions.push(commands.registerCommand('rhamt.Kai-Fix-Files', async item => {
//             const fileNode = item as FileNode;
//              this.issueFilePath = fileNode.file;
//             const issueByFileMap = fileNode.getConfig()._results.model.issueByFile;
//             vscode.window.showInformationMessage(`TOTAL Issues: ${issueByFileMap.size}`);
//             const issueByFile = issueByFileMap.get(fileNode.file);
            
//             if (issueByFile && issueByFile.length > 0) {
//                 let issuesList = issueByFile.map(hint => hint.ruleId || 'Unnamed issue').join('\n');
//                 vscode.window.showInformationMessage(`Issues BY FILE (${issueByFile.length}):\n${issuesList}`);
//             } else {
//                 vscode.window.showInformationMessage('No issues for this file.');
//             }


//             const fs = require('fs').promises;
//             const outputChannel = vscode.window.createOutputChannel("Kai-Fix Result");
//             outputChannel.show(true);
//             let workspaceFolder = vscode.workspace.workspaceFolders[0].name;
//             outputChannel.appendLine("Generating the fix: ");
//             outputChannel.appendLine(`Appname Name: ${workspaceFolder}.`);
//             outputChannel.appendLine(`Incidents: ${JSON.stringify(this.formatHintsToIncidents(issueByFile), null, 2)}`);
//             const content = await fs.readFile(this.issueFilePath, { encoding: 'utf8' });
            
//             let incidents;
//             if (issueByFile) {
//                  incidents = this.formatHintsToIncidents(issueByFile);
//             } else {
//                 incidents = [];
//             }

//             const postData = {
//                 file_name: this.issueFilePath,
//                 file_contents: content,
//                 application_name: workspaceFolder,
//                 incidents: incidents,
//                 include_llm_results: "True"
//             };

           

//             const url = 'http://0.0.0.0:8080/get_incident_solutions_for_file';
//             const headers = {
//                 'Content-Type': 'application/json',
//             };
//             const statusBarMessage = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
//             let currentFrame = 0;
//             const frames = ['$(sync~spin) Generating Fix..', '$(sync~spin) Generating Fix..', '$(sync~spin) Generating Fix..'];
        
//             // Start spinner
//             statusBarMessage.text = frames[0];
//             statusBarMessage.show();
//             const spinner = setInterval(() => {
//                 statusBarMessage.text = frames[currentFrame];
//                 currentFrame = (currentFrame + 1) % frames.length;
//             }, 500); // Change spinner frame every 500ms
           
//             try {
//                 const response = await fetch(url, {
//                     method: 'POST',
//                     headers: headers,
//                     body: JSON.stringify(postData),
//                 });
                
//                 clearInterval(spinner);
//                 statusBarMessage.hide();

//                 if (!response.ok) {
//                     vscode.window.showInformationMessage(` Error: ${response.toString}.`);
//                     vscode.window.showInformationMessage(` response: ${await response.text()}.`);
//                     throw new Error(`HTTP error! status: ${response.status}`);  
//                 }
//                 vscode.window.showInformationMessage(`Yay! Kyma ${response.status}.`);
//                 const responseText = await response.text(); // Get the raw response text
//                 console.log(responseText);
//                 outputChannel.appendLine(`Response: ${responseText}`);

               
//             const updatedFile = this.extractUpdatedFile(responseText);
//             const virtualDocumentUri = vscode.Uri.parse(`${this.kaiScheme}:${this.issueFilePath}`);
//             outputChannel.appendLine(`Updated File: ${updatedFile}`);
            
//             const tampFileName = 'Kai-fix-All-'+this.getFileName(this.issueFilePath);
//             outputChannel.appendLine(`Tamp Filename: ${tampFileName}.`);
//             // Generate a unique temp file path
//             this.tempFileUri = await this.writeToTempFile(updatedFile,tampFileName);

//             await vscode.commands.executeCommand('vscode.diff', virtualDocumentUri, this.tempFileUri, `Current ⟷ KaiFix`, {
//                 preview: true,
//             }).then(() => {
//                 this.openedDiffEditor = vscode.window.activeTextEditor;
//             });
            
//             this.watchDiffEditorClose();

//             } catch (error) {
//                 console.error('Error making POST request:', error);
//                 vscode.window.showErrorMessage(`Failed to perform the operation. ${error}`);
//             }
//         }));

        
//     }
//     private watchDiffEditorClose(): void {
//         vscode.window.showInformationMessage(`watchDiffEditorClose`);
//         this.context.subscriptions.push(window.onDidChangeActiveTextEditor(this.handleActiveEditorChange.bind(this)));
//         this.context.subscriptions.push(vscode.window.onDidChangeWindowState(windowState => {
//             if (windowState.focused) {
//                 this.handleActiveEditorChange(vscode.window.activeTextEditor);
//             }
//         }));
//     }
    
//     private handleActiveEditorChange(editor?: vscode.TextEditor): void {
//         let diffFocused = false;

//         if (editor) {
//             const activeDocumentUri = editor.document.uri;
//             if (this.activeDiffUri && (activeDocumentUri.toString() === this.activeDiffUri.toString() || activeDocumentUri.toString() === this.tempFileUri?.toString())) {
//                 diffFocused = true;
//             }
//         }
//         this.myWebViewProvider.updateWebview(diffFocused);
//     }
//     private formatHintsToIncidents(hints: IHint[]) {
//         return hints.map(hint => ({
//           violation_name: hint.ruleId,
//           ruleset_name: hint.rulesetName,
//           incident_variables: {
//             file: hint.variables['file'] || '',
//             kind: hint.variables['kind'] || '',
//             name: hint.variables['name'] || '',
//             package: hint.variables['package'] || '',
//           },
//           line_number: hint.lineNumber,
//           analysis_message: hint.hint,
//         }));
//       }
       
// private getFileName(filePath: string): string {
//     const segments = filePath.split('/');
//     const fileName = segments.pop();
//     return fileName || '';
// }
// private registerContentProvider() {
//     const provider = new (class implements vscode.TextDocumentContentProvider {
//         onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
//         onDidChange = this.onDidChangeEmitter.event;
//         // provideTextDocumentContent(uri: vscode.Uri): vscode.ProviderResult<string> {
//         //     const content = decodeURIComponent(uri.path);
//         //     return content;
//         // }
//         provideTextDocumentContent(uri: vscode.Uri): Thenable<string> {
//             const filePath = uri.path; 
//             const fileUri = vscode.Uri.file(filePath);
//             return vscode.workspace.fs.readFile(fileUri).then(buffer => {
//                 return buffer.toString();
//             });
//         }
//     })();
//         // Register the provider with Visual Studio Code
//         this.context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(this.kaiScheme, provider));
// }
// private extractUpdatedFile(jsonResponse: string): string {
//     try {
//         const responseObj = JSON.parse(jsonResponse);

//         if ('updated_file' in responseObj) {
//             const updatedFileContent = responseObj.updated_file;
//             return updatedFileContent || 'No content available in updated_file.';
//         } else {
//             vscode.window.showInformationMessage('The "updated_file" property does not exist in the response object.');
//             return 'The "updated_file" property does not exist in the response object.';
//         }
//     } catch (error) {
//         vscode.window.showInformationMessage('Failed to parse jsonResponse:', error);
//         return 'An error occurred while parsing the JSON response.';
//     }
// }
// private async writeToTempFile(content: string, kaifixFilename: string): Promise<vscode.Uri> {
//     // Generate a unique temp file path
//     const tempFilePath = path.join(os.tmpdir(), kaifixFilename);
//     const tempFileUri = vscode.Uri.file(tempFilePath);

//     // Convert the string content to a Uint8Array
//     const encoder = new TextEncoder(); // TextEncoder is globally available
//     const uint8Array = encoder.encode(content);

//     // Write the content to the temp file
//     await vscode.workspace.fs.writeFile(tempFileUri, uint8Array);

//     return tempFileUri;
// }
    

// }
