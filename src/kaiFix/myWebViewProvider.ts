
import * as vscode from 'vscode';

export class MyWebViewProvider implements vscode.WebviewViewProvider {
    // Hold a reference to the main class
     private nonce: string; // A unique, random nonce for each instance
     private _view?: vscode.WebviewView;
 
     constructor(private readonly kaiFix: IKaiFix) {
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
             await this.kaiFix.handleMessage(message);
         }, undefined, this.kaiFix.context.subscriptions);
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

 export interface IKaiFix {
    handleMessage(message: any): Promise<void>;
    // Define any other common methods here
    context: vscode.ExtensionContext;
}