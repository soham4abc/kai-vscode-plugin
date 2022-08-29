/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ExtensionContext, workspace, extensions, window, ProgressLocation } from 'vscode';
import * as path from 'path';
import * as fse from 'fs-extra';
import * as child_process from 'child_process';
import { RhamtConfiguration } from './model/model';
import { RhamtInstaller } from './util/rhamt-installer';
import { ModelService } from './model/modelService';
import { promptForFAQs } from './util/faq';
import * as cliResolver from './util/cli-resolver';

const RHAMT_VERSION_REGEX = /^version /;

const findJava = require('find-java-home');

const IGNORE_RHAMT_DOWNLOAD = 'ignoreRhamtDownload';

export namespace Utils {

    export let PRODUCT_THEME: string;
    export let CLI_SCRIPT: string;
    export let CLI_VERSION: string;
    export let CLI_FOLDER: string;
    export let DOWNLOAD_CLI_LOCATION: string;

    export let EXTENSION_PUBLISHER: string;
    export let EXTENSION_NAME: string;

    export async function loadPackageInfo(context: ExtensionContext): Promise<void> {
        const { publisher, name, cliDownloadLocation, cliScript, cliFolder, productTheme } = await fse.readJSON(context.asAbsolutePath('./package.json'));
        EXTENSION_PUBLISHER = publisher;
        EXTENSION_NAME = name;
        DOWNLOAD_CLI_LOCATION = cliDownloadLocation;
        CLI_SCRIPT = cliScript;
        CLI_FOLDER = cliFolder;
        PRODUCT_THEME = productTheme;
    }

    export async function initConfiguration(config: RhamtConfiguration, modelService: ModelService): Promise<void> {

        await window.withProgress({
            location: ProgressLocation.Notification,
            cancellable: false
        }, async (progress: any) => {

            progress.report({message: 'Verifying JAVA_HOME'});
            let javaHome: string;
            let rhamtCli: string;

            try {
                javaHome = await findJavaHome();
            }
            catch (error) {
                promptForFAQs('Unable to resolve Java Home');
                progress.report({message: 'Unable to verify JAVA_HOME'});
                return Promise.reject(error);
            }

            progress.report({message: 'Verifying cli'});

            try {
                rhamtCli = await resolveCli(modelService, config, javaHome);
            }
            catch (e) {
                console.log(e);
                promptForFAQs('Unable to determine cli version', {outDir: modelService.outDir});
                return Promise.reject(e);
            }
            config.rhamtExecutable = rhamtCli;
            config.options['jvm'] = javaHome;
            return config;
        });
    }

    export async function resolveCli(modelService: ModelService, config: RhamtConfiguration, javaHome: string): Promise<string> {
        let rhamtCli = '';
        try {
            rhamtCli = await cliResolver.findRhamtCli(modelService.outDir, config);
            console.log(`Using CLI - ${rhamtCli}`);
        }
        catch (error) {
            // promptForFAQs('Unable to find cli executable', {outDir: modelService.outDir});
            return Promise.reject({error, notified: true});
        }
        try {
            console.log(`verifying cli --version`);
            const version = await findRhamtVersion(rhamtCli, javaHome);
            console.log(`Using version - ${version}`);
        }
        catch (error) {
            promptForFAQs('Unable to determine cli version: \n' + error.message, {outDir: modelService.outDir});
            return Promise.reject(error);
        }
        return rhamtCli;
    }

    export function findJavaHome(): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            findJava((err: string, home: string) => {
                if (err) {
                    const javaHome = workspace.getConfiguration('java').get<string>('home');
                    if (javaHome) {
                        resolve(javaHome);
                    }
                    else {
                        reject(err);
                    }
                } else {
                    resolve(home);
                }
            });
        });
    }

    export function findRhamtVersion(rhamtCli: string, javaHome: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const env = {JAVA_HOME : javaHome};
            const execOptions: child_process.ExecOptions = {
                env: Object.assign({}, process.env, env)
            };
            child_process.exec(
                `"${rhamtCli}" --version`, execOptions, (error: Error, _stdout: string, _stderr: string): void => {
                    if (error) {
                        console.log(`error while executing --version`);
                        console.log(error);
                        return reject(error);
                    } else {
                        return resolve(parseVersion(_stdout));
                    }
                });
        });
    }

    function parseVersion(raw: string): string {
        return raw.replace(RHAMT_VERSION_REGEX, '');
    }

    export function getExtensionId(): string {
        return `${EXTENSION_PUBLISHER}.${EXTENSION_NAME}`;
    }

    export function getPathToExtensionRoot(...args: string[]): string {
        return path.join(extensions.getExtension(getExtensionId())!.extensionPath, ...args);
    }

    export async function checkCli(dataOut: string, context: ExtensionContext, autoDownload?: boolean): Promise<any> {
        await cliResolver.findRhamtCli(dataOut).catch(() => {
            if (autoDownload) {
                Utils.downloadCli(dataOut);
            }
            else if (!context.workspaceState.get(IGNORE_RHAMT_DOWNLOAD)) {
                Utils.showDownloadCliOption(dataOut, context);
            }
        });
    }

    export async function showDownloadCliOption(dataOut: string, context: ExtensionContext): Promise<any> {
        const MSG = 'Unable to find CLI';
        const OPTION_DOWNLOAD = 'Download';
        const OPTION_DISMISS = `Don't Show Again`;
        const choice = await window.showInformationMessage(MSG, OPTION_DOWNLOAD, OPTION_DISMISS);
        if (choice === OPTION_DOWNLOAD) {
            Utils.downloadCli(dataOut);
        }
        else if (choice === OPTION_DISMISS) {
            context.workspaceState.update(IGNORE_RHAMT_DOWNLOAD, true);
        }
    }

    export async function downloadCli(dataOut: string): Promise<any> {
        const handler = { log: msg => console.log(`cli download message: ${msg}`) };
        const out = dataOut; // path.resolve(dataOut, 'cli');
        RhamtInstaller.installCli(Utils.DOWNLOAD_CLI_LOCATION, out, handler).then(async () => {
            window.showInformationMessage('Download Complete');
            const home = cliResolver.findRhamtCliDownload(dataOut);
            const cli = cliResolver.getDownloadExecutableName(home);
            if (fse.existsSync(cli)) {
                await fse.chmod(cli, '0764');
            }
            workspace.getConfiguration().update('cli.executable.path', cli);
        }).catch(e => {
            console.log(e);
            const error = e.value.e;
            if (error && error.cancelled) {
                window.showInformationMessage(`cli download cancelled.`);
            }
            else {
                window.showErrorMessage(`Error downloading cli: ${e}`);
            }
        });
    }
}
