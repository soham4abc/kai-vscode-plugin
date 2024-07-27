/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as cp from 'child_process';

export class ProcessRunner {
    static run(executable: string, args: any[], startTimeout: number, options: cp.SpawnOptions,
        outputStream: NodeJS.WritableStream, log: (msg: string) => void, onShutdown: () => void): Promise<cp.ChildProcess> {
        return new Promise<cp.ChildProcess>((resolve, reject) => {
            let started = false;
            let killed = false;

            const process = cp.spawn(executable, args, options);
            process.on('error', e => {
                console.log(e);
                log(`error executing process ${executable}`);
                if (e && e.message) {
                    log(`${e.name} - ${e.message}\n`);
                    process.kill();
                    killed = true;
                }
                onShutdown();
            });
            process.on('close', e => {
                console.log(`cli process closed, exit code ${e}`);
                killed = true;
                onShutdown();
            });
            const outputListener = (data: string | Buffer) => {
                const line = data.toString().trim();
                log(line);
                if (!started) {
                    started = true;
                    resolve(process);
                }
            };
            process.stdout.addListener('data', outputListener);
            process.stderr.addListener('data', outputListener);
            if (outputStream) {
                process.stdout.pipe(outputStream);
                process.stderr.pipe(outputStream);
            }
            setTimeout(() => {
                if (!started && !killed) {
                    process.kill();
                    reject(`process ${executable} startup time exceeded ${startTimeout}ms. killing...`);
                } else {
                    resolve(process);
                }
            }, startTimeout);
        });
    }
}