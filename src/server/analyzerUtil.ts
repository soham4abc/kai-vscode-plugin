/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { RhamtProcessController } from './rhamtProcessController';
import { ModelService } from '../model/modelService';
import { rhamtChannel } from '../util/console';
import * as fs from 'fs-extra';
import { DataProvider } from '../tree/dataProvider';
import { ProcessRunner } from './processRunner';
import { AnalyzerProcessController } from './analyzerProcessController';
import { RhamtConfiguration, WINDOW } from './analyzerModel';
import * as path from 'path';
import { AnalyzerResults } from './analyzerResults';
import { AnalyzerProgressMonitor } from './analyzerProgressMonitor';
const START_TIMEOUT = 60000;

export class AnalyzerUtil {

    static activeProcessController: AnalyzerProcessController;

    static async analyze(dataProvider: DataProvider, config: RhamtConfiguration, modelService: ModelService, onStarted: () => void, onComplete: () => void): Promise<RhamtProcessController> {
        let cli = undefined;
        try {
            const configCli = config.options['cli'] as string;
            if (configCli) {
                cli = configCli.trim();
            }
            else {
                const analyzerPath = vscode.workspace.getConfiguration('cli.executable').get<string>('path');
                if (analyzerPath) {
                    console.log(`preference cli.executable.path found - ${analyzerPath}`);
                    cli = analyzerPath;
                }
            }
        } catch (e) {
            return Promise.reject(e);
        }

        if (!cli) {
            return Promise.reject('Cannot find analyzer executable path.');
        }

        config.rhamtExecutable = cli;

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            cancellable: true
        }, async (progress: any, token: vscode.CancellationToken) => {
            return new Promise<any>(async resolve => {
                const executable = config.rhamtExecutable;
                console.log(`Using executable - ${executable}`);
                let params = [];
                try {
                    progress.report({ message: 'Verifying configuration' });
                    params = await AnalyzerUtil.buildAnalyzerParams(
                        path.join(dataProvider.context.extensionPath, "lib"), config);
                }
                catch (e) {
                    vscode.window.showErrorMessage(`Error: ${e}`);
                    AnalyzerUtil.updateRunEnablement(true, dataProvider, config);
                    return Promise.reject(e);
                }
                rhamtChannel.clear();
                rhamtChannel.print(`${executable} ${params.join(' ')}`);
                config.cancelled = false;
                const monitor = new AnalyzerProgressMonitor(onComplete);
                const log = (data: string) => {
                    rhamtChannel.print(data);
                    rhamtChannel.print('\n');
                    monitor.handleMessage(data);
                };
                progress.report({ message: 'Starting analysis...' });
                let cancelled = false;
                let resolved = false;
                let processController: AnalyzerProcessController;
                const onShutdown = () => {
                    AnalyzerUtil.updateRunEnablement(true, dataProvider, config);
                    if (!resolved) {
                        resolved = true;
                        resolve(undefined);
                    }
                };
                // create log file for analysis
                let outputStream: NodeJS.WritableStream;
                try {
                    outputStream = fs.createWriteStream(path.join(config.options['output'], 'analysis.log'));
                } catch(e) {
                    console.log("failed creating a log file for analysis");
                }
                try {
                    processController = AnalyzerUtil.activeProcessController = await ProcessRunner.run(config.rhamtExecutable, params, START_TIMEOUT, {
                        cwd: config.options['output'],
                        env: Object.assign(
                            {},
                            process.env,
                        )
                    }, outputStream, log, onShutdown).then(cp => {
                        onStarted();
                        return new AnalyzerProcessController(config.rhamtExecutable, cp, onShutdown);
                    });
                    if (cancelled) {
                        console.log('cli was cancelled during startup.');
                        processController.shutdown();
                        return;
                    }
                } catch (e) {
                    console.log('Error executing analysis');
                    console.log(e);
                    onShutdown();
                }
                token.onCancellationRequested(() => {
                    cancelled = true;
                    config.cancelled = true;
                    AnalyzerUtil.updateRunEnablement(true, dataProvider, config);
                    if (AnalyzerUtil.activeProcessController) {
                        AnalyzerUtil.activeProcessController.shutdown();
                    }
                    if (!resolved) {
                        resolved = true;
                        resolve(undefined);
                    }
                });
                progress.report({ message: 'Analysis in Progress' });
            });
        });
    }

    static updateRunEnablement(enabled: boolean, dataProvider: DataProvider, config: RhamtConfiguration | null): void {
        if (config != null) {
            const node = dataProvider.findConfigurationNode(config.id);
            if (node) {
                node.setBusyAnalyzing(!enabled);
            }
        }
        vscode.commands.executeCommand('setContext', 'cli-enabled', enabled);
        vscode.commands.executeCommand('setContext', 'delete-enabled', enabled);
    }

    // private static buildParams(config: RhamtConfiguration): Promise<any[]> {
    //     const params = [];
    //     const options = config.options;
    //     params.push('analyze');
    //     params.push('--input');
    //     const input = options['input'];
    //     if (!input || input.length === 0) {
    //         return Promise.reject('input is missing from configuration');
    //     }
    //     for (let anInput of input) {
    //         if (!fs.existsSync(anInput)) {
    //             return Promise.reject(`input does not exist: ${anInput}`);
    //         }
    //     }
    //     input.forEach(entry => {
    //         params.push(`${entry}`);
    //     });
    //     params.push('--output');
    //     const output = config.options['output'];
    //     if (!output || output === '') {
    //         return Promise.reject('output is missing from configuration');
    //     }
    //     params.push(`${output}`);

    //     params.push('--mode');
    //     const mode = config.options['mode'];
    //     if (!mode || mode === '') {
    //         return Promise.reject('mode is missing from configuration');
    //     }
    //     params.push(`${mode}`);

    //     if (options['skip-static-report']) {
    //         params.push('--skip-static-report');
    //     }

    //     if (options['overwrite']) {
    //         params.push('--overwrite');
    //     }

    //     if (options['enable-default-rulesets']) {
    //         params.push('--enable-default-rulesets=true');
    //     } else{
    //         params.push('--enable-default-rulesets=false');
    //     }

    //     if (options['json-output']) {
    //         params.push('--json-output');
    //     }

    //     if (options['analyze-known-libraries']) {
    //         params.push('--analyze-known-libraries');
    //     }

    //     let target = options['target'];
    //     if (!target) {
    //         target = [];
    //     }
    //     if (target.length === 0) {
    //         target.push('eap7');
    //     }
    //     target.forEach((i: any) => {
    //         params.push('--target');
    //         params.push(i);
    //     });

    //     // source
    //     let source = options['source'];
    //     if (!source) {
    //         source = [];
    //     }
    //     source.forEach((i: any) => {
    //         params.push('--source');
    //         params.push(i);
    //     });

    //     // rules
    //     let rules = options['rules'];
    //     if (rules && rules.length > 0) {
    //         rules.forEach(entry => {
    //             params.push('--rules');
    //             params.push(`${entry}`);
    //         });
    //     }

    //     console.log("Options: ")
    //     for (const key in config.options) {
    //         if (config.options.hasOwnProperty(key)) {
    //             console.log(`${key}: ${config.options[key]}`);
    //         }
    //     }
    //     console.log("Params: " + params)
    //     return Promise.resolve(params);
    // }

    private static buildAnalyzerParams(libPath: string, config: RhamtConfiguration): Promise<any[]> {
        const params = [];
        const options = config.options;

        const input = options['input'];
        if (!input || input.length === 0) {
            return Promise.reject('input is missing from configuration');
        }
        for (let anInput of input) {
            if (!fs.existsSync(anInput)) {
                return Promise.reject(`input does not exist: ${anInput}`);
            }
        }

        const output = config.options['output'];
        if (!output || output === '') {
            return Promise.reject('output is missing from configuration');
        }
        params.push("--verbose");
        params.push("20");
        params.push('--output-file');
        params.push(`${output}/output.yaml`);
        params.push('--dep-output-file');
        params.push(`${output}/dep-output.yaml`);
        params.push(`--provider-settings`);
        params.push(`${output}/provider_settings.json`);

        const mode = config.options['mode'];
        if (!mode || mode === '') {
            return Promise.reject('mode is missing from configuration');
        }
        params.push('--analysis-mode');
        params.push(`${mode}`);

        if (options['enable-default-rulesets']) {
            params.push('--rules');
            params.push(path.join(libPath, 'rulesets'))
        }

        if (!options['analyze-known-libraries']) {
            params.push('--dep-label-selector="(!konveyor.io/dep-source=open-source)"');
        }

        params.push(...this.buildLabelSelectorOption(options['source'] || [], options['target'] || []))

        // rules
        let rules = options['rules'];
        if (rules && rules.length > 0) {
            rules.forEach(entry => {
                params.push('--rules');
                params.push(`${entry}`);
            });
        }

        console.log("Options: ")
        for (const key in config.options) {
            if (config.options.hasOwnProperty(key)) {
                console.log(`${key}: ${config.options[key]}`);
            }
        }
        console.log("Params: " + params)
        return Promise.resolve(params);
    }

    public static async loadAnalyzerResults(config: RhamtConfiguration, clearSummary: boolean = true): Promise<any> {
        return new Promise<void>(async (resolve, reject) => {
            let results = null;
            try {
                if (clearSummary) {
                    let tries = 0;
                    const output = config.options['output'];
                    const location = path.resolve(output, ...config.static());

                    const done = () => {
                        const exists = fs.existsSync(location);
                        if (exists) {
                            console.log('output exist: ' + location);
                            return true;
                        }
                        else if (++tries > 8) {
                            console.log('output was not found after long delay!');
                            return true;
                        }
                        console.log('output does not exist - ' + location);
                        return false;
                    };

                    const poll = resolve => {
                        if (done()) resolve();
                        else setTimeout(_ => poll(resolve), config.delay);
                    }

                    await new Promise(poll);

                }
                results = await AnalyzerUtil.readAnalyzerResults(config);
            }
            catch (e) {
                console.log(`Error reading analyzer results.`);
                console.log(e);
                return reject(`Error reading analyzer results.`);
            }
            try {
                const analyzerResults = new AnalyzerResults(results, config);
                await analyzerResults.init();
                config.results = analyzerResults;
                if (clearSummary) {
                    config.summary = {
                        skippedReports: false,
                        outputLocation: config.options['output'],
                        executedTimestamp: '',
                        executable: config.rhamtExecutable,
                        executedTimestampRaw: '',
                        active: true
                    };
                    config.summary.quickfixes = [];
                    config.summary.hintCount = config.results.model.hints.length;
                    config.summary.classificationCount = 0;
                }
                return resolve();
            }
            catch (e) {
                console.log('Error processing analyzer results');
                return reject(`Error processing analyzer results.`);
            }
        });
    }

    public static async readAnalyzerResults(config: RhamtConfiguration): Promise<any> {
        return new Promise<void>((resolve, reject) => {
            try {
                let location = config.options['output'];
                if (!location) {
                    return reject(`Error loading analyzer results. Cannot resolve configuraiton output location.`);
                }
                location = path.resolve(location, ...config.static());
                fs.exists(location, async exists => {
                    if (exists) {
                        try {
                            fs.readFile(location, 'utf8', async (err, data: string) => {
                                if (err) {
                                    return reject(err);
                                }
                                try {
                                    const dataJson = JSON.parse(data.replace(WINDOW, ''));
                                    return resolve(dataJson);
                                }
                                catch (e) {
                                    console.log('Error parsing JSON');
                                    console.log(e);
                                    return reject(e);
                                }
                            });
                        } catch (e) {
                            return reject(`Error loading analyzer results for configuration at ${location} - ${e}`);
                        }
                    }
                    else {
                        return reject(`Output location does not exist - ${location}`);
                    }
                });
            }
            catch (e) {
                return Promise.reject(`Error loading analzyer results from (${config.getResultsLocation()}): ${e}`);
            }
        });
    }

    private static buildLabelSelectorOption(sources: string[], targets: string[]): string[] {
        if (!sources && !targets) {
            return [];
        }
        const options = ["--label-selector"]
        const sourceLabels: string[] = sources.map(item => `konveyor.io/source=${item}`)
        const targetLabels: string[] = targets.map(item => `konveyor.io/target=${item}`)
        const sourceExpr: string = sourceLabels.length > 0 ? `(${sourceLabels.join('||')})`: '';
        const targetExpr: string = targetLabels.length > 0 ? `(${targetLabels.join('||')})`: '';
        if (targetExpr !== '') {
            if (sourceExpr !== '') {
                return [...options, `${targetExpr} && ${sourceExpr}`];
            } else {
                return [...options, `${targetExpr} && konveyor.io/source`];
            }
        }
        if (sourceExpr !== '') {
            return [...options, sourceExpr];
        }
        return [];
    }

    public static generateStaticReport(libPath: string, config: RhamtConfiguration): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            const outputPath = config.options['output'];
            const inputName = config.options['input'] ? path.basename(config.options['input'][0]) : config.name;
            let analysisOutput = '';
            let depOutput = '';
            if (fs.existsSync(path.resolve(outputPath, 'output.yaml'))) {
                analysisOutput = path.resolve(outputPath, 'output.yaml');
            }
            if (fs.existsSync(path.resolve(outputPath, 'dep-output.yaml'))) {
                depOutput = path.resolve(outputPath, 'dep-output.yaml');
            }
            if (analysisOutput === '') {
                reject(`analysis output not found at path ${path.resolve(outputPath, 'output.yaml')}`);
            }
            const options = ['--analysis-output-list', analysisOutput];
            if (depOutput !== '') {
                options.push('--deps-output-list');
                options.push(depOutput);
            }
            options.push('--application-name-list');
            options.push(inputName);
            options.push('--output-path');
            options.push(path.join(outputPath, 'static-report', 'output.js'));
            console.log(options);
            try {
                fs.copySync(path.join(libPath, 'static-report'), path.join(outputPath, 'static-report'), {recursive: true});
                await ProcessRunner.run(path.join(libPath, 'static-report-generator'), options, 60000, 
                    {}, null, (msg: string) => console.log(msg), () => {})
                resolve();
            } catch (e) {
                reject(`failed to generate static report - ${e}`);
            }
        });
    } 
}
