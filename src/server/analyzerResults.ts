/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ModelService } from '../model/modelService';
import { IClassification, IHint, IIssue, IIssueType, IQuickFix, RhamtConfiguration } from './analyzerModel';
import * as vscode from 'vscode';

export interface AnalysisResultsSummary {
    skippedReports?: boolean;
    executedTimestamp?: string;
    executionDuration?: string;
    outputLocation?: string;
    executable?: string;
    quickfixes?: any;
    hintCount?: number,
    classificationCount?: number;
    quickfixCount?: number;
    executedTimestampRaw?: string,
    active?: boolean,
    activatedExplicity?: boolean
}

export class AnalysisResultsUtil {

    static openReport(report: string): void {
    }
}

export class AnalyzerResults {

    reports: Map<string, string> = new Map<string, string>();
    config: RhamtConfiguration;
    jsonResults: any;
    private _model: AnalyzerResults.Model;
     
   
    constructor(jsonResults: any, config: RhamtConfiguration) {
        
        this.jsonResults = jsonResults;
        this.config = config;
    }

    init(): Promise<void> {
        this._model = {
            hints: [],
            classifications: [],
            issueByFile: new Map<string, IHint[]>() 
        };
        console.log(`Rulesets: ${this.jsonResults}`);
       // const rulesets = this.jsonResults[0]['rulesets'];
       const rulesets = this.jsonResults;
        const outputChannel1 = vscode.window.createOutputChannel("Analyzer Result");
            outputChannel1.show(true);
        rulesets.forEach(ruleset => {
            const violations = ruleset.violations;
            if (violations) {
                Object.keys(violations).forEach(violationKey => {
                    const violation = violations[violationKey];
                    const incidents = violation.incidents;                    
                    if (incidents) {
                        incidents.forEach(incident => {
                            const fileUri = vscode.Uri.parse(incident.uri as string);
                            try {
                                outputChannel1.appendLine(incident.violation);
                                outputChannel1.appendLine (`Hint: ${JSON.stringify(incident.variables, null, 2)}`);
                                const hint = {
                                    type: IIssueType.Hint,
                                    id: ModelService.generateUniqueId(),
                                    quickfixes: [],
                                   //then set as file : 
                                    file: fileUri.fsPath,
                                    severity: '',
                                    ruleId: violationKey,
                                    violationDiscription: violation.description, 
                                    ruleSetDiscription: ruleset.description,
                                    rulesetName: ruleset.name,
                                    effort: '',
                                    title: '',
                                    links: [],
                                    report: '',
                                    lineNumber: incident.lineNumber || 1,
                                    column: 0,
                                    length: 0,
                                    sourceSnippet: incident.codeSnip ? incident.codeSnip : '',
                                    category: violation.category,
                                    hint: incident.message,
                                    configuration: this.config,
                                    dom: incident,
                                    complete: false,
                                    origin: '',
                                    variables: incident.variables ? incident.variables: '',
                                };
                                
                                outputChannel1.appendLine (`Hint: ${JSON.stringify(hint.variables, null, 2)}`);
                                this.model.hints.push(hint);
                                const existingHintsForFile = this._model.issueByFile.get(fileUri.fsPath);
                                if (existingHintsForFile) {
                                    existingHintsForFile.push(hint);
                                } else {
                                    this._model.issueByFile.set(fileUri.fsPath, [hint]);
                                    outputChannel1.appendLine (`ISSUEfILE Making new entry # ${this._model.issueByFile.size}`);
                                    outputChannel1.appendLine (`ISSUEfILE Making new entry for ${fileUri.fsPath}`);
                                }
                            } catch (e) {
                                console.log('error creating incident');
                                console.log(e);
                            } 
                        });
                    }
                });
            }
        }); 
        outputChannel1.appendLine (`ISSUEBYFILE: ${JSON.stringify(this._model.issueByFile, null, 2)}`);      
        return Promise.resolve();
    }

    get model(): AnalyzerResults.Model | null {
        return this._model;
    }
    
    deleteIssue(issue: IIssue): void {
    }

    markIssueAsComplete(issue: IIssue, complete: boolean): void {
    }

    markQuickfixApplied(quickfix: IQuickFix, applied: boolean): void {
        if (applied) {
        }
        else {
        }
    }
}

export namespace AnalyzerResults {
    
    export interface Model {
        hints: IHint[];
        classifications: IClassification[];
        issueByFile: Map<string, IHint[]>; 
        
    }
}

