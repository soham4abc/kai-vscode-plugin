import { FileProcess, RequestManagerInterface, Task, FileAction } from './types';

export class GlobalRequestsManager implements RequestManagerInterface {
  private fileMap: Map<string, FileProcess>;
  private processQueue: Array<Task>;

  constructor() {
    this.fileMap = new Map();
    this.processQueue = [];
  }

  handleRequest(file: string, action: FileAction) {
    try {
      const fileProcess = this.fileMap.get(file);

      if (action === "Stop") {
        this.stopProcess(file);
      } else {
        if (fileProcess && (fileProcess.state === 'in progress' || fileProcess.state === 'waiting')) {
          throw new Error(`Process already running or waiting on file ${file}`);
        }
        this.addProcess(file, action);
      }
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message);
      } else {
        console.error('An unknown error occurred');
      }
    }
  }

  private stopProcess(file: string) {
    const fileProcess = this.fileMap.get(file);
    if (fileProcess) {
      fileProcess.controller.abort();
      fileProcess.state = 'none';
      fileProcess.process = 'none';
      this.fileMap.set(file, fileProcess);
      this.printFileProcess(file);
      this.dequeue(file);
      console.log(`Process on file ${file} stopped`);
    }
  }

  private addProcess(file: string, action: FileAction) {
    const controller = new AbortController();
    const hash = this.generateHash();
    const fileProcess = this.fileMap.get(file) || new FileProcess("none", controller, hash, "none");
    fileProcess.state = "waiting";
    fileProcess.controller = controller;
    fileProcess.hash = hash;
    fileProcess.process = action;
    this.fileMap.set(file, fileProcess);
    this.printFileProcess(file);
    this.enqueue({ file, action });
  }

  private generateHash(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  private enqueue(task: Task) {
    this.processQueue.push(task);
  }

  // dequeue the task that is completed. It can be at any position in the queue
  dequeue(file: string) {
    // todo: see if there is any other effective mechanism to do this without recreating the queue
    this.processQueue = this.processQueue.filter(task => task.file !== file);
  }

  getProcessQueue() {
    return this.processQueue;
  }

  getFileMap() {
    return this.fileMap;
  }

  printFileProcess(file: string) {
    const fileProcess = this.fileMap.get(file);
    if (fileProcess) {
      console.log(`'${file}' => FileProcess {
        state: '${fileProcess.state}',
        controller: [object AbortController],
        hash: '${fileProcess.hash}',
        process: '${fileProcess.process}'
      }`);
    }
  }
}
