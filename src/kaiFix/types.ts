export type FileAction = "Kai" | "Kantra" | "Stop" | "None";

export interface Task {
  file: string;
  action: FileAction;
}

export interface RequestManagerInterface {
  handleRequest(file: string, action: FileAction): void;
  getProcessQueue(): Task[];
  getFileMap(): Map<string, FileProcess>;
  dequeue(file: string): void;
  printFileProcess(file: string): void;
}

export class FileProcess {
  state: string;
  controller: AbortController;
  hash: string;
  process: string;

  constructor(state: string, controller: AbortController, hash: string, process: string) {
    this.state = state;
    this.controller = controller;
    this.hash = hash;
    this.process = process;
  }
}
