// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as crypto from 'crypto';
import { inject, injectable, named } from 'inversify';
import * as fs from 'fs-extra';
import * as path from '../../../platform/vscode-path/path';
import * as uriPath from '../../../platform/vscode-path/resources';
import { CancellationToken, Memento, Uri } from 'vscode';
import { IFileSystem, IPlatformService } from '../../../platform/common/platform/types';
import { IFileSystemNode } from '../../../platform/common/platform/types.node';
import { ignoreLogging, logValue, logger } from '../../../platform/logging';
import {
    IDisposableRegistry,
    IMemento,
    GLOBAL_MEMENTO,
    IExtensionContext,
    Resource
} from '../../../platform/common/types';
import { tryGetRealPath } from '../../../platform/common/utils.node';
import { ICustomEnvironmentVariablesProvider } from '../../../platform/common/variables/types';
import { debugDecorator } from '../../../platform/logging';
import { OSType } from '../../../platform/common/utils/platform.node';
import { noop } from '../../../platform/common/utils/misc';
import { PythonEnvironment } from '../../../platform/pythonEnvironments/info';
import { TraceOptions } from '../../../platform/logging/types';
import { IPythonExecutionFactory } from '../../../platform/interpreter/types.node';
import { getDisplayPath } from '../../../platform/common/platform/fs-paths';
import { StopWatch } from '../../../platform/common/utils/stopWatch';
import { ResourceMap, ResourceSet } from '../../../platform/common/utils/map';
import { getPythonEnvDisplayName, getSysPrefix } from '../../../platform/interpreter/helpers';
import { getExtensionTempDir } from '../../../platform/common/temp';

const winJupyterPath = path.join('AppData', 'Roaming', 'jupyter', 'kernels');
const linuxJupyterPath = path.join('.local', 'share', 'jupyter', 'kernels');
const macJupyterPath = path.join('Library', 'Jupyter', 'kernels');
const winJupyterRuntimePath = path.join('AppData', 'Roaming', 'jupyter', 'runtime');
const macJupyterRuntimePath = path.join('Library', 'Jupyter', 'runtime');

export const baseKernelPath = path.join('share', 'jupyter', 'kernels');
const CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH = 'CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH.';
export const CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS = 'CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS_.';

/**
 * Finds locations to search for jupyter kernels.
 */
@injectable()
export class JupyterPaths {
    private cachedKernelSpecRootPath?: Promise<Uri | undefined>;
    private cachedJupyterKernelPaths?: Promise<Uri[]>;
    private cachedJupyterPaths?: Promise<Uri[]>;
    private cachedDataDirs = new Map<string, Promise<Uri[]>>();
    constructor(
        @inject(IPlatformService) private platformService: IPlatformService,
        @inject(ICustomEnvironmentVariablesProvider)
        private readonly envVarsProvider: ICustomEnvironmentVariablesProvider,
        @inject(IDisposableRegistry) disposables: IDisposableRegistry,
        @inject(IMemento) @named(GLOBAL_MEMENTO) private readonly globalState: Memento,
        @inject(IFileSystemNode) private readonly fs: IFileSystem,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
        @inject(IPythonExecutionFactory) private readonly pythonExecFactory: IPythonExecutionFactory
    ) {
        this.envVarsProvider.onDidEnvironmentVariablesChange(
            () => {
                this.cachedJupyterKernelPaths = undefined;
                this.cachedJupyterPaths = undefined;
            },
            this,
            disposables
        );
    }

    /**
     * Contains the name of the directory where the Jupyter extension will temporary register Kernels when using non-raw.
     * (this way we don't register kernels in global path).
     * This path needs to be writable, as we store the kernelspecs here when we spawn kernels using Jupyter Server.
     */
    public async getKernelSpecTempRegistrationFolder() {
        const dir = uriPath.joinPath(await getExtensionTempDir(this.context), 'jupyter', 'kernels');
        await this.fs.createDirectory(dir);
        return dir;
    }
    /**
     * This should return a WRITABLE place that jupyter will look for a kernel as documented
     * here: https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
     */
    public async getKernelSpecRootPath(): Promise<Uri | undefined> {
        const cachedRootPath = this.getCachedRootPath();
        if (cachedRootPath || this.cachedKernelSpecRootPath) {
            return cachedRootPath || this.cachedKernelSpecRootPath;
        }
        this.cachedKernelSpecRootPath = (async () => {
            const userHomeDir = this.platformService.homeDir;
            if (userHomeDir) {
                if (this.platformService.isWindows) {
                    // On windows the path is not correct if we combine those variables.
                    // It won't point to a path that you can actually read from.
                    return tryGetRealPath(uriPath.joinPath(userHomeDir, winJupyterPath));
                } else if (this.platformService.isMac) {
                    return uriPath.joinPath(userHomeDir, macJupyterPath);
                } else {
                    return uriPath.joinPath(userHomeDir, linuxJupyterPath);
                }
            }
        })();
        this.cachedKernelSpecRootPath
            .then((value) => {
                logger.trace(`Getting Jupyter KernelSpec Root Path ${value?.toString()}`);
                this.updateCachedRootPath(value);
            })
            .catch(noop);
        return this.cachedKernelSpecRootPath;
    }
    /**
     * Returns the value for `JUPYTER_RUNTIME_DIR`, location where Jupyter stores runtime files.
     * Such as kernel connection files.
     * This path needs to be writable, as we store the connection files in here.
     */
    public async getRuntimeDir(): Promise<Uri> {
        const runtimeDir = await this.getRuntimeDirImpl();
        if (runtimeDir) {
            return runtimeDir;
        }

        // Run time directory doesn't exist or no permissions.
        const extensionRuntimeDir = Uri.joinPath(await getExtensionTempDir(this.context), 'jupyter', 'runtime');
        await fs.ensureDir(extensionRuntimeDir.fsPath);
        logger.trace(`Using extension runtime directory ${extensionRuntimeDir.fsPath}`);
        return extensionRuntimeDir;
    }

    private runtimeDirIsWritable = false;
    private async getRuntimeDirImpl(): Promise<Uri | undefined> {
        let runtimeDir: Uri | undefined;
        const userHomeDir = this.platformService.homeDir;
        if (process.env['JUPYTER_RUNTIME_DIR']) {
            runtimeDir = Uri.file(path.normalize(process.env['JUPYTER_RUNTIME_DIR']));
        } else if (userHomeDir) {
            if (this.platformService.isWindows) {
                // On windows the path is not correct if we combine those variables.
                // It won't point to a path that you can actually read from.
                runtimeDir = await tryGetRealPath(uriPath.joinPath(userHomeDir, winJupyterRuntimePath));
            } else if (this.platformService.isMac) {
                runtimeDir = uriPath.joinPath(userHomeDir, macJupyterRuntimePath);
            } else {
                runtimeDir = process.env['XDG_RUNTIME_DIR']
                    ? Uri.file(path.join(process.env['XDG_RUNTIME_DIR'], 'jupyter', 'runtime'))
                    : uriPath.joinPath(userHomeDir, '.local', 'share', 'jupyter', 'runtime');
            }
        }
        if (!runtimeDir) {
            logger.error(`Failed to determine Jupyter runtime directory`);
            return;
        }

        try {
            // Make sure the directory exists and is writable.
            await this.fs.createDirectory(runtimeDir);
            if (!this.runtimeDirIsWritable) {
                // Ensure this folder is writable as well, we've found cases where this folder is not writable.
                const tempFileName = `temp-test-write-access-${crypto.randomBytes(20).toString('hex')}.txt`;
                const tempFile = uriPath.joinPath(runtimeDir, tempFileName);
                // If this fails, then thats find, at least we know the folder is not writable, even if it exists.
                await fs.writeFile(tempFile.fsPath, '');
                await fs.unlink(tempFile.fsPath).catch(noop);
            }
            return runtimeDir;
        } catch (ex) {
            logger.error(`Failed to create/or verify write access to runtime directory ${runtimeDir}`, ex);
        }
    }
    /**
     * Gets the DATA_DIR folder for Jupyter.
     * Source for priority & paths can be found in jupyter_path function in site-packages/jupyter_core/paths.py
     * Documentation can be found here https://docs.jupyter.org/en/latest/use/jupyter-directories.html#data-files
     */
    public async getDataDirs(options: { resource: Resource; interpreter?: PythonEnvironment }): Promise<Uri[]> {
        const key = options.interpreter ? options.interpreter.uri.toString() : '';
        if (!this.cachedDataDirs.has(key)) {
            this.cachedDataDirs.set(key, this.getDataDirsImpl(options.resource, options.interpreter));
        }
        return this.cachedDataDirs.get(key)!;
    }

    @debugDecorator('getDataDirsImpl', TraceOptions.BeforeCall | TraceOptions.Arguments | TraceOptions.ReturnValue)
    private async getDataDirsImpl(
        resource: Resource,
        @logValue<PythonEnvironment>('id') interpreter?: PythonEnvironment
    ): Promise<Uri[]> {
        // When adding paths keep distinct values and preserve the order.
        const dataDir = new ResourceMap<number>();

        // 1. Add the JUPYTER_PATH
        const jupyterPaths = await this.getJupyterPaths();
        for (const jupyterPathItem of jupyterPaths) {
            if (jupyterPathItem && !dataDir.has(jupyterPathItem)) {
                dataDir.set(jupyterPathItem, dataDir.size);
            }
        }

        // 2. Add the paths based on ENABLE_USER_SITE
        if (interpreter) {
            try {
                logger.ci(`Getting Jupyter Data Dir for ${interpreter.uri.fsPath}`);
                const factory = await this.pythonExecFactory.createActivatedEnvironment({
                    interpreter,
                    resource
                });
                const pythonFile = Uri.joinPath(this.context.extensionUri, 'pythonFiles', 'printJupyterDataDir.py');
                const result = await factory.exec([pythonFile.fsPath], {});
                if (result.stdout.trim().length) {
                    const sitePath = Uri.file(result.stdout.trim());
                    if (await this.fs.exists(sitePath)) {
                        if (!dataDir.has(sitePath)) {
                            dataDir.set(sitePath, dataDir.size);
                        }
                    }
                } else {
                    logger.debug(`Got an empty Jupyter Data Dir from ${interpreter.id}, stderr = ${result.stderr}`);
                }
            } catch (ex) {
                logger.error(
                    `Failed to get DataDir based on ENABLE_USER_SITE for ${getPythonEnvDisplayName(interpreter)}`,
                    ex
                );
            }
        }

        // 3. Add the paths based on user and env data directories
        let sysPrefix: string | undefined;
        if (interpreter) {
            sysPrefix = await getSysPrefix(interpreter);
        }
        const possibleEnvJupyterPath = sysPrefix ? Uri.joinPath(Uri.file(sysPrefix), 'share', 'jupyter') : undefined;

        const systemDataDirectories = this.getSystemJupyterPaths();
        const envJupyterPath = possibleEnvJupyterPath
            ? new ResourceSet(systemDataDirectories).has(possibleEnvJupyterPath)
                ? undefined
                : possibleEnvJupyterPath
            : undefined;
        const userDataDirectory = this.getJupyterDataDir();
        // If the JUPYTER_PREFER_ENV_PATH environment variable is set, the environment-level
        // directories will have priority over user-level directories.
        const jupyterPreferEnvPath = (process.env.JUPYTER_PREFER_ENV_PATH || 'no').toLowerCase();
        // Using same logic from path.py (as this env variable is specific to Jupyter).
        // An environment variable is considered set if it is assigned to a value
        // other than 'no', 'n', 'false', 'off', '0', or '0.0' (case insensitive)
        if (['no', 'n', 'false', 'off', '0', '0.0'].includes(jupyterPreferEnvPath)) {
            [userDataDirectory, envJupyterPath].forEach((item) => {
                if (item && !dataDir.has(item)) {
                    dataDir.set(item, dataDir.size);
                }
            });
        } else {
            [envJupyterPath, userDataDirectory].forEach((item) => {
                if (item && !dataDir.has(item)) {
                    dataDir.set(item, dataDir.size);
                }
            });
        }

        // 4. Add the system data directories
        systemDataDirectories.forEach((item) => {
            if (item && !dataDir.has(item)) {
                dataDir.set(item, dataDir.size);
            }
        });

        const sortedEntries = Array.from(dataDir.entries()).sort((a, b) => a[1] - b[1]);
        return sortedEntries.map((item) => item[0]);
    }
    private getJupyterConfigDir() {
        if (process.env['JUPYTER_CONFIG_DIR']) {
            return Uri.file(path.normalize(process.env['JUPYTER_CONFIG_DIR']));
        }
        return this.platformService.homeDir ? Uri.joinPath(this.platformService.homeDir, '.jupyter') : undefined;
    }
    private getSystemJupyterPaths() {
        if (this.platformService.isWindows) {
            const programData = process.env['PROGRAMDATA'] ? path.normalize(process.env['PROGRAMDATA']) : undefined;
            return programData ? [Uri.joinPath(Uri.file(programData), 'jupyter')] : [];
        } else {
            return [Uri.file('/usr/local/share/jupyter'), Uri.file('/usr/share/jupyter')];
        }
    }
    private getJupyterDataDir() {
        if (process.env['JUPYTER_DATA_DIR']) {
            return Uri.file(path.normalize(process.env['JUPYTER_DATA_DIR']));
        }
        if (!this.platformService.homeDir) {
            return;
        }
        switch (this.platformService.osType) {
            case OSType.OSX:
                return Uri.joinPath(this.platformService.homeDir, 'Library', 'Jupyter');
            case OSType.Windows:
                const appData = process.env['APPDATA'] ? Uri.file(path.normalize(process.env['APPDATA'])) : '';
                if (appData) {
                    return Uri.joinPath(appData, 'jupyter');
                }
                const configDir = this.getJupyterConfigDir();
                if (configDir) {
                    return Uri.joinPath(configDir, 'data');
                }
                return Uri.joinPath(this.platformService.homeDir, 'Library', 'Jupyter');
            default: {
                // Linux, non-OS X Unix, AIX, etc.
                const xdgDataHome = process.env['XDG_DATA_HOME']
                    ? Uri.file(path.normalize(process.env['XDG_DATA_HOME']))
                    : Uri.joinPath(this.platformService.homeDir, '.local', 'share');
                return Uri.joinPath(xdgDataHome, 'jupyter');
            }
        }
    }
    private cachedKernelSpecRootPaths?: { promise: Promise<Uri[]>; stopWatch: StopWatch };
    /**
     * This list comes from the docs here:
     * https://jupyter-client.readthedocs.io/en/stable/kernels.html#kernel-specs
     */
    public async getKernelSpecRootPaths(cancelToken: CancellationToken): Promise<Uri[]> {
        if (this.cachedKernelSpecRootPaths?.promise && this.cachedKernelSpecRootPaths.stopWatch.elapsedTime <= 60_000) {
            return this.cachedKernelSpecRootPaths.promise;
        }
        const stopWatch = new StopWatch();
        const promise = this.getKernelSpecRootPathsImpl(cancelToken);
        this.cachedKernelSpecRootPaths = { promise, stopWatch };
        const disposable = cancelToken.onCancellationRequested(() => {
            if (this.cachedKernelSpecRootPaths?.promise === promise) {
                this.cachedKernelSpecRootPaths = undefined;
            }
        }, this);
        promise.finally(() => disposable.dispose()).catch(noop);
        return promise;
    }
    private async getKernelSpecRootPathsImpl(cancelToken: CancellationToken): Promise<Uri[]> {
        // Paths specified in JUPYTER_PATH are supposed to come first in searching
        const paths = new ResourceSet(await this.getJupyterPathKernelPaths(cancelToken));
        if (cancelToken.isCancellationRequested) {
            return [];
        }
        if (this.platformService.isWindows) {
            const winPath = await this.getKernelSpecRootPath();
            if (cancelToken.isCancellationRequested) {
                return [];
            }
            if (winPath) {
                paths.add(winPath);
            }

            if (process.env.PROGRAMDATA) {
                paths.add(Uri.file(path.join(process.env.PROGRAMDATA, 'jupyter', 'kernels')));
            }
        } else {
            // Unix based
            const secondPart = this.platformService.isMac ? macJupyterPath : linuxJupyterPath;

            paths.add(Uri.file(path.join('/', 'usr', 'share', 'jupyter', 'kernels')));
            paths.add(Uri.file(path.join('/', 'usr', 'local', 'share', 'jupyter', 'kernels')));
            if (this.platformService.homeDir) {
                paths.add(uriPath.joinPath(this.platformService.homeDir, secondPart));
            }
        }

        logger.debug(
            `Kernel Spec Root Paths, ${Array.from(paths)
                .map((uri) => getDisplayPath(uri))
                .join(', ')}`
        );
        return Array.from(paths);
    }

    private async getJupyterPathKernelPaths(@ignoreLogging() cancelToken?: CancellationToken): Promise<Uri[]> {
        this.cachedJupyterKernelPaths =
            this.cachedJupyterKernelPaths || this.getJupyterPathSubPaths(cancelToken, 'kernels');
        this.cachedJupyterKernelPaths.then((value) => {
            if (value.length > 0) {
                this.updateCachedPaths(value).then(noop, noop);
            }
        }, noop);
        return this.getCachedPaths().length > 0 ? this.getCachedPaths() : this.cachedJupyterKernelPaths;
    }

    private async getJupyterPaths(cancelToken?: CancellationToken): Promise<Uri[]> {
        this.cachedJupyterPaths = this.cachedJupyterPaths || this.getJupyterPathSubPaths(cancelToken);
        return this.cachedJupyterPaths;
    }

    /**
     * Find any paths associated with the JUPYTER_PATH env var. Can be a list of dirs.
     * We need to look at the 'kernels' sub-directory and these paths are supposed to come first in the searching
     * https://jupyter.readthedocs.io/en/latest/projects/jupyter-directories.html#envvar-JUPYTER_PATH
     */
    private async getJupyterPathSubPaths(cancelToken?: CancellationToken, subDir?: string): Promise<Uri[]> {
        const paths = new ResourceSet();
        const vars = await this.envVarsProvider.getEnvironmentVariables(undefined, 'RunPythonCode');
        if (cancelToken?.isCancellationRequested) {
            return [];
        }
        const jupyterPathVars = vars.JUPYTER_PATH
            ? vars.JUPYTER_PATH.split(path.delimiter).map((jupyterPath) => {
                  return subDir ? path.join(jupyterPath, subDir) : jupyterPath;
              })
            : [];

        if (jupyterPathVars.length > 0) {
            // Preserve the order of the items.
            const jupyterPaths = await Promise.all(
                jupyterPathVars.map(async (jupyterPath) => tryGetRealPath(Uri.file(jupyterPath)))
            );
            jupyterPaths.forEach((jupyterPath) => {
                if (jupyterPath) {
                    paths.add(jupyterPath);
                }
            });
        }

        logger.debug(`Jupyter Paths ${getDisplayPath(subDir)}: ${Array.from(paths).map((uri) => getDisplayPath(uri))}`);
        return Array.from(paths);
    }

    private getCachedPaths(): Uri[] {
        return this.globalState.get<string[]>(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, []).map((s) => Uri.parse(s));
    }

    private async updateCachedPaths(paths: Uri[]) {
        const currentValue = this.globalState.get<string[]>(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, []);
        const newValue = paths.map(Uri.toString);
        if (currentValue.join(',') !== newValue.join(',')) {
            await this.globalState.update(CACHE_KEY_FOR_JUPYTER_KERNEL_PATHS, newValue);
        }
    }

    private getCachedRootPath(): Uri | undefined {
        if (this.globalState.get(CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH)) {
            const cached = this.globalState.get<string>(CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH);
            if (cached) {
                return Uri.parse(cached);
            }
        }
    }

    private updateCachedRootPath(path: Uri | undefined) {
        if (path) {
            this.globalState.update(CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH, path.toString()).then(noop, noop);
        } else {
            this.globalState.update(CACHE_KEY_FOR_JUPYTER_KERNELSPEC_ROOT_PATH, undefined).then(noop, noop);
        }
    }
}
