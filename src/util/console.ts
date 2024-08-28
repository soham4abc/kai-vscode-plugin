/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export interface RhamtChannel {
    print(text: string)
    clear()
}

class RhamtChannelImpl implements RhamtChannel {
    private readonly channel: vscode.OutputChannel = vscode.window.createOutputChannel('MTA');
    print(text: string) {
        this.channel.append(text);
        this.channel.show();
    }
    clear() {
        this.channel.clear();
    }
}

export const rhamtChannel = new RhamtChannelImpl();

class ProviderChannelImpl implements RhamtChannel {
    private readonly channel: vscode.OutputChannel = vscode.window.createOutputChannel('Provider');
    print(text: string) {
        this.channel.append(text);
        this.channel.show();
    }
    clear() {
        this.channel.clear();
    }
}

export const providerChannel = new ProviderChannelImpl();