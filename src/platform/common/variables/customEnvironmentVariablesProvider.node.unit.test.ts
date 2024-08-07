// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/* eslint-disable @typescript-eslint/no-explicit-any */
import { assert } from 'chai';
import { EventEmitter, FileSystemWatcher, Uri, WorkspaceConfiguration } from 'vscode';
import { dispose } from '../utils/lifecycle';
import { IDisposable } from '../types';
import { CustomEnvironmentVariablesProvider } from './customEnvironmentVariablesProvider.node';
import { IEnvironmentVariablesService } from './types';
import * as fs from 'fs-extra';
import dedent from 'dedent';
import { IPythonApiProvider, IPythonExtensionChecker } from '../../api/types';
import { logger } from '../../logging';
import { anything, instance, mock, when } from 'ts-mockito';
import { clearCache } from '../utils/cacheUtils';
import { EnvironmentVariablesService } from './environment.node';
import { FileSystem } from '../platform/fileSystem.node';
import * as sinon from 'sinon';
import { PythonExtension } from '@vscode/python-extension';
import { EXTENSION_ROOT_DIR_FOR_TESTS } from '../../../test/constants.node';
import { createEventHandler } from '../../../test/common';
import { mockedVSCodeNamespaces } from '../../../test/vscode-mock';

suite('Custom Environment Variables Provider', () => {
    let customEnvVarsProvider: CustomEnvironmentVariablesProvider;
    let envVarsService: IEnvironmentVariablesService;
    let disposables: IDisposable[] = [];
    let pythonExtChecker: IPythonExtensionChecker;
    let pythonApiProvider: IPythonApiProvider;
    let pythonApi: PythonExtension;
    const envFile = Uri.joinPath(Uri.file(EXTENSION_ROOT_DIR_FOR_TESTS), 'src', 'test', 'datascience', '.env');
    let contentsOfOldEnvFile: string;
    let customPythonEnvFile = Uri.joinPath(
        Uri.file(EXTENSION_ROOT_DIR_FOR_TESTS),
        'src',
        'test',
        'datascience',
        '.env.python'
    );
    let onFSEvent: EventEmitter<Uri>;
    let fsWatcher: FileSystemWatcher;
    const workspaceUri = Uri.joinPath(Uri.file(EXTENSION_ROOT_DIR_FOR_TESTS), 'src', 'test', 'datascience');
    const workspaceFolder = { index: 0, name: 'workspace', uri: workspaceUri };
    setup(async function () {
        logger.info(`Start Test ${this.currentTest?.title}`);
        clearCache();
        envVarsService = new EnvironmentVariablesService(new FileSystem());
        pythonExtChecker = mock<IPythonExtensionChecker>();
        when(pythonExtChecker.isPythonExtensionInstalled).thenReturn(true);
        pythonApiProvider = mock<IPythonApiProvider>();
        pythonApi = mock<PythonExtension>();
        (instance(pythonApi) as any).then = undefined;
        when(pythonApiProvider.getNewApi()).thenResolve(instance(pythonApi));
        contentsOfOldEnvFile = fs.readFileSync(envFile.fsPath).toString();
        onFSEvent = new EventEmitter<Uri>();
        disposables.push(onFSEvent);
        fsWatcher = mock<FileSystemWatcher>();
        when(fsWatcher.dispose()).thenReturn();
        when(fsWatcher.onDidChange).thenReturn(onFSEvent.event);
        when(fsWatcher.onDidCreate).thenReturn(onFSEvent.event);
        when(fsWatcher.onDidDelete).thenReturn(onFSEvent.event);
        when(mockedVSCodeNamespaces.workspace.workspaceFolders).thenReturn([workspaceFolder]);
        when(mockedVSCodeNamespaces.workspace.getWorkspaceFolder(anything())).thenCall(() => workspaceFolder);
        when(mockedVSCodeNamespaces.workspace.getConfiguration(anything(), anything())).thenCall(() => {
            const workspaceConfig = mock<WorkspaceConfiguration>();
            when(workspaceConfig.get<string>('envFile')).thenReturn('${workspaceFolder}/.env.python');
            return instance(workspaceConfig);
        });
        // when(mockedVSCodeNamespaces.workspace.getWorkspaceFolderIdentifier(anything())).thenCall(() => workspaceFolder.uri.fsPath);
        when(
            mockedVSCodeNamespaces.workspace.createFileSystemWatcher(anything(), anything(), anything(), anything())
        ).thenReturn(instance(fsWatcher));
    });
    teardown(async function () {
        logger.info(`Ended Test ${this.currentTest?.title}`);
        disposables = dispose(disposables);
        if (fs.existsSync(customPythonEnvFile.fsPath)) {
            fs.unlinkSync(customPythonEnvFile.fsPath);
        }
        fs.writeFileSync(envFile.fsPath, contentsOfOldEnvFile);
        sinon.restore();
        logger.info(`Ended Test (completed) ${this.currentTest?.title}`);
    });

    function createProvider(cacheDuration?: number) {
        customEnvVarsProvider = new CustomEnvironmentVariablesProvider(
            envVarsService,
            disposables,
            pythonExtChecker,
            instance(pythonApiProvider),
            cacheDuration
        );
    }
    test('Loads .env file', async () => {
        const fsSpy = sinon.spy(FileSystem.prototype, 'readFile');
        const envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR
                    `;
        logger.info('Write to env file', envFile.fsPath);
        fs.writeFileSync(envFile.fsPath, envVars);
        createProvider();
        const vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');

        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR'
        });

        // Reading again doesn't require a new read of the file.
        const originalCalLCount = fsSpy.callCount;
        const vars2 = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');

        assert.strictEqual(fsSpy.callCount, originalCalLCount);
        assert.deepEqual(vars2, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR'
        });
    });
    test('Detects changes to .env file', async () => {
        let envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR
                    `;
        logger.info('Write to env file1', envFile.fsPath);
        fs.writeFileSync(envFile.fsPath, envVars);
        createProvider();
        let vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');

        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR'
        });

        // Change the .env file.
        const changeDetected = createEventHandler(
            customEnvVarsProvider,
            'onDidEnvironmentVariablesChange',
            disposables
        );
        envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO2
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR2
                    `;
        logger.info('Write to env file2', envFile.fsPath);
        fs.writeFileSync(envFile.fsPath, envVars);
        onFSEvent.fire(envFile);

        // Detect the change.
        await changeDetected.assertFired(5_000);

        // Ensure the new vars are different.
        vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');
        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO2',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR2'
        });
    });
    test('Detects creation of the .env file', async () => {
        logger.info('Delete to env file', envFile.fsPath);
        fs.unlinkSync(envFile.fsPath);
        createProvider();
        let vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');
        assert.isEmpty(vars || {});

        // Create the .env file.
        const changeDetected = createEventHandler(
            customEnvVarsProvider,
            'onDidEnvironmentVariablesChange',
            disposables
        );
        const envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO2
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR2
                    `;
        logger.info('Create env file', envFile.fsPath);
        fs.writeFileSync(envFile.fsPath, envVars);
        onFSEvent.fire(envFile);

        // Detect the change.
        await changeDetected.assertFired(5_000);

        // Ensure the new vars are different.
        vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');
        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO2',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR2'
        });
    });
    test('Loads python.env file', async () => {
        const envVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=FOO
                    VSCODE_JUPYTER_ENV_TEST_VAR2=BAR
                    `;
        logger.info('Write to env file', envFile.fsPath);
        fs.writeFileSync(envFile.fsPath, envVars);
        const pythonEnvVars = dedent`
                    VSCODE_JUPYTER_ENV_TEST_VAR1=PYTHON_FOO
                    VSCODE_JUPYTER_ENV_TEST_VAR2=PYTHON_BAR
                    `;
        logger.info('Write to python env file', customPythonEnvFile.fsPath);
        fs.writeFileSync(customPythonEnvFile.fsPath, pythonEnvVars);
        const environments = mock<PythonExtension['environments']>();
        when(environments.getEnvironmentVariables(anything())).thenReturn({
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'PYTHON_FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'PYTHON_BAR'
        });
        when(pythonApi.environments).thenReturn(instance(environments));
        createProvider();
        const vars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunNonPythonCode');
        const pythonVars = await customEnvVarsProvider.getCustomEnvironmentVariables(undefined, 'RunPythonCode');

        assert.deepEqual(vars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'BAR'
        });
        assert.deepEqual(pythonVars, {
            VSCODE_JUPYTER_ENV_TEST_VAR1: 'PYTHON_FOO',
            VSCODE_JUPYTER_ENV_TEST_VAR2: 'PYTHON_BAR'
        });
    });
});
