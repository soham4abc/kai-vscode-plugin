import { RequestManagerInterface, Task } from './types';

export class ProcessController {
  private requestsManager: RequestManagerInterface;
  private maxKaiWorkers: number;
  private maxKantraWorkers: number;
  private activeKaiTasks: Set<string>;
  private activeKantraTasks: Set<string>;

  constructor(requestsManager: RequestManagerInterface, maxKaiWorkers: number, maxKantraWorkers: number) {
    this.requestsManager = requestsManager;
    this.maxKaiWorkers = maxKaiWorkers;
    this.maxKantraWorkers = maxKantraWorkers;
    this.activeKaiTasks = new Set();
    this.activeKantraTasks = new Set();
    this.pollQueue();
  }

  private async pollQueue() {
    while (true) {
      await this.processQueue();
      await this.sleep(1000); // todo: may be there is a better mechanism to poll
    }
  }

  async processQueue() {
    const queue = this.requestsManager.getProcessQueue();
    console.log("Current queue ------------:", queue);
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) continue;

      const fileProcess = this.requestsManager.getFileMap().get(task.file);
      if (!fileProcess || fileProcess.state === 'in progress') continue;

      if (task.action === "Kai" && this.activeKaiTasks.size < this.maxKaiWorkers) {
        this.activeKaiTasks.add(task.file);
        this.startTask(task);
      } else if (task.action === "Kantra" && this.activeKantraTasks.size < this.maxKantraWorkers) {
        this.activeKantraTasks.add(task.file);
        this.startTask(task);
      } else {
        // Requeue the task if unable to process due to worker limits
        queue.unshift(task);
        break;
      }
    }
  }

  private async startTask(task: Task) {
    const fileProcess = this.requestsManager.getFileMap().get(task.file);
    if (fileProcess) {
      fileProcess.state = 'in progress';
      this.requestsManager.getFileMap().set(task.file, fileProcess);
      this.requestsManager.printFileProcess(task.file);
      console.log(`Starting ${task.action} on file ${task.file}`);

      try {
        await this.fileOperation(task.file, task.action, fileProcess.controller);
        fileProcess.state = 'completed';
        fileProcess.process = 'none';
        console.log(`Finished ${task.action} on file ${task.file}`);
      } catch (error) {
        console.error(`Error processing ${task.action} on file ${task.file}:`, error);
        fileProcess.state = 'failed';
      } finally {
        this.requestsManager.getFileMap().set(task.file, fileProcess);
        this.requestsManager.printFileProcess(task.file);

        if (task.action === "Kai") {
          this.activeKaiTasks.delete(task.file);
        } else if (task.action === "Kantra") {
          this.activeKantraTasks.delete(task.file);
        }
        this.dequeue(task.file);
      }
    }
  }

  private async fileOperation(file: string, action: string, controller: AbortController) {
    // Todo: Redo this with proper call to the fileops component
    return new Promise<void>((resolve, reject) => {
      const signal = controller.signal;
      const timeout = setTimeout(() => {
        resolve();
      }, 2000); // todo: change this

      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new Error("Operation aborted"));
      });
    });
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private dequeue(file: string) {
    this.requestsManager.dequeue(file); // Dequeue the specific file task
    this.processQueue(); // Continue processing the next task in the queue
  }
}
