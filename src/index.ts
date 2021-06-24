#!/usr/bin/env node
import { ChildProcessByStdio, spawn } from "child_process";
import { Writable } from "stream";
import chowkidar from 'chokidar'
import path from 'path';
import treeKill from "tree-kill";

type restartEvent = "Manual reload" | "File change";

class Denode {
    private processExited: boolean = false;
    private nodeProcessRef!: ChildProcessByStdio<Writable, null, null>;
    private prevReload: undefined | NodeJS.Timeout;
    private pathsBeingWatched = [
        path.join(process.cwd(), "/**/*.js"),
        path.join(process.cwd(), "/**/*.json"),
        path.join(process.cwd(), "/**/*.env.*"),
    ]

    constructor() {
        if (process.argv.length != 3) {
            console.error("Expected atleast 1 argument");
        } else this.init();
    }

    init = async () => {
        this.nodeProcessRef = await this.startProcess();
        this.watchFiles();
        process.on("SIGINT", async () => await this.exitHandler("SIGINT"));
        process.on("SIGTERM", async () => await this.exitHandler("SIGTERM"));
        process.stdin.on("data", async (chunk) => {
            const str = chunk.toString();
            if (str === "rs\n") await this.reload("Manual reload");
        });
    }

    private startProcess = () => {
        const nodeProcessRef = spawn("node", [process.argv[2]], {
            stdio: ["pipe", process.stdout, process.stderr]
        });
        this.processExited = false;

        process.stdin.pipe(nodeProcessRef.stdin);

        nodeProcessRef.stdin.on('close', () => {
            process.stdin.unpipe(nodeProcessRef.stdin);
            process.stdin.resume();
        });

        nodeProcessRef.on('error', (err) => {
            this.processExited = true;
            this.print("log", `Failed to start process ${process.argv[2]}`);
        });

        nodeProcessRef.on('close', (code, signal) => {
            this.processExited = true;
            this.print('log', `Process ${process.argv[2]} exited with ${code ? `code ${code}` : `signal ${signal}`}`);
        });

        return nodeProcessRef;
    }

    private watchFiles = () => {
        chowkidar.watch(this.pathsBeingWatched, {
            ignored: "**/node_modules/*",
            ignoreInitial: true
        }).on('all', async () => {
            let timeoutKey = setTimeout(async () => {
                if (this.prevReload) clearTimeout(this.prevReload);
                await this.reload("File change");
            }, 1000);
            this.prevReload = timeoutKey;
        });
    }

    private reload = async (event: restartEvent) => {
        this.print("info", `${event} detected. Restarting process`);
        await this.stopProcess();
        this.nodeProcessRef = this.startProcess();
    }

    private stopProcess = async () => {
        if (this.processExited) return true;
        return new Promise<boolean>((resolve, reject) => {
            treeKill(this.nodeProcessRef.pid!, "SIGTERM", (err) => {
                if (err) treeKill(this.nodeProcessRef.pid!, "SIGKILL", () => { });
            });
            const key = setInterval(() => {
                if (this.processExited) {
                    clearInterval(key);
                    resolve(true);
                }
            }, 500);
        })
    }

    private exitHandler = async (signal: string) => {
        this.print("debug", `Detected signal ${signal}. Exiting...`);
        await this.stopProcess();
        process.exit();
    }

    private print = (type: keyof Console, message: string) => {
        console[type](`[DENODE]:${message}`);
    }

}

export default new Denode();