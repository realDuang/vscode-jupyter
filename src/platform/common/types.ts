// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ConfigurationTarget, Disposable, Event, ExtensionContext, OutputChannel, Uri, Range } from 'vscode';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { CommandIds } from '../../commands';
import { ISystemVariables } from './variables/types';

export const IsDevMode = Symbol('IsDevMode');
export const IOutputChannel = Symbol('IOutputChannel');
export interface IOutputChannel extends OutputChannel {}
export const IsWindows = Symbol('IS_WINDOWS');
export const IDisposableRegistry = Symbol('IDisposableRegistry');
export type IDisposableRegistry = Disposable[];
export const IMemento = Symbol('IGlobalMemento');
export const GLOBAL_MEMENTO = Symbol('IGlobalMemento');
export const WORKSPACE_MEMENTO = Symbol('IWorkspaceMemento');

export type Resource = Uri | undefined;
export interface IPersistentState<T> {
    readonly value: T;
    updateValue(value: T): Promise<void>;
}

export type ReadWrite<T> = {
    -readonly [P in keyof T]: T[P];
};

export enum BannerType {
    InsidersNotebookSurvey,
    ExperimentNotebookSurvey
}

export const IPersistentStateFactory = Symbol('IPersistentStateFactory');

export interface IPersistentStateFactory {
    createGlobalPersistentState<T>(key: string, defaultValue?: T, expiryDurationMs?: number): IPersistentState<T>;
    createWorkspacePersistentState<T>(key: string, defaultValue?: T, expiryDurationMs?: number): IPersistentState<T>;
}

export const IRandom = Symbol('IRandom');
export interface IRandom {
    getRandomInt(min?: number, max?: number): number;
}

export interface IJupyterSettings {
    readonly experiments: IExperiments;
    readonly allowUnauthorizedRemoteConnection: boolean;
    readonly jupyterInterruptTimeout: number;
    readonly jupyterLaunchTimeout: number;
    readonly jupyterLaunchRetries: number;
    readonly notebookFileRoot: string;
    readonly useDefaultConfigForJupyter: boolean;
    readonly enablePythonKernelLogging: boolean;
    readonly sendSelectionToInteractiveWindow: boolean;
    readonly splitRunFileIntoCells: boolean;
    readonly markdownRegularExpression: string;
    readonly codeRegularExpression: string;
    readonly errorBackgroundColor: string;
    readonly variableExplorerExclude: string;
    readonly decorateCells: 'currentCell' | 'allCells' | 'disabled';
    readonly enableCellCodeLens: boolean;
    askForLargeDataFrames: boolean;
    readonly enableAutoMoveToNextCell: boolean;
    readonly askForKernelRestart: boolean;
    readonly codeLenses: string;
    readonly debugCodeLenses: string;
    readonly debugpyDistPath: string;
    readonly stopOnFirstLineWhileDebugging: boolean;
    readonly magicCommandsAsComments: boolean;
    readonly pythonExportMethod: 'direct' | 'commentMagics' | 'nbconvert';
    readonly stopOnError: boolean;
    readonly addGotoCodeLenses: boolean;
    readonly runStartupCommands: string | string[];
    readonly debugJustMyCode: boolean;
    readonly defaultCellMarker: string;
    readonly verboseLogging: boolean;
    readonly themeMatplotlibPlots: boolean;
    readonly disableJupyterAutoStart: boolean;
    readonly development: boolean;
    readonly jupyterCommandLineArguments: string[];
    readonly widgetScriptSources: WidgetCDNs[];
    readonly interactiveWindowMode: InteractiveWindowMode;
    readonly pythonCellFolding: boolean;
    readonly interactiveWindowViewColumn: InteractiveWindowViewColumn;
    readonly disableZMQSupport: boolean;
    readonly forceIPyKernelDebugger?: boolean;
    readonly showVariableViewWhenDebugging: boolean;
    readonly newCellOnRunLast: boolean;
    readonly logKernelOutputSeparately: boolean;
    readonly poetryPath: string;
    readonly excludeUserSitePackages: boolean;
    readonly enableExtendedPythonKernelCompletions: boolean;
    readonly formatStackTraces: boolean;
    /**
     * Trigger characters for Jupyter completion, per language.
     * This excludes the trigger characters for python.
     * TODO: in debt to merge the two settings.
     */
    readonly completionTriggerCharacters?: Record<string, string[]>;
    readonly interactiveReplNotebook: boolean;
}

export interface IWatchableJupyterSettings extends IJupyterSettings {
    readonly onDidChange: Event<void>;
    createSystemVariables(resource: Resource): ISystemVariables;
}

export interface IExperiments {
    /**
     * Return `true` if experiments are enabled, else `false`.
     */
    readonly enabled: boolean;
    /**
     * Experiments user requested to opt into manually
     */
    readonly optInto: string[];
    /**
     * Experiments user requested to opt out from manually
     */
    readonly optOutFrom: string[];
}

export type InteractiveWindowMode = 'perFile' | 'single' | 'multiple';

export type InteractiveWindowViewColumn = 'beside' | 'active' | 'secondGroup';

export type WidgetCDNs = 'unpkg.com' | 'jsdelivr.com';

export const IConfigurationService = Symbol('IConfigurationService');
export interface IConfigurationService {
    getSettings(resource?: Uri): IWatchableJupyterSettings;
    updateSetting(setting: string, value?: {}, resource?: Uri, configTarget?: ConfigurationTarget): Promise<void>;
    updateSectionSetting(
        section: string,
        setting: string,
        value?: {},
        resource?: Uri,
        configTarget?: ConfigurationTarget
    ): Promise<void>;
}

export type DownloadOptions = {
    /**
     * Prefix for progress messages displayed.
     *
     * @type {('Downloading ... ' | string)}
     */
    progressMessagePrefix: 'Downloading ... ' | string;
    /**
     * Output panel into which progress information is written.
     *
     * @type {IOutputChannel}
     */
    outputChannel?: IOutputChannel;
    /**
     * Extension of file that'll be created when downloading the file.
     *
     * @type {('tmp' | string)}
     */
    extension: 'tmp' | string;
};

export interface IHttpClient {
    downloadFile(uri: string): Promise<Response>;
    /**
     * Returns the url is valid (i.e. return status code of 200).
     */
    exists(uri: string): Promise<boolean>;
}

export const IExtensionContext = Symbol('ExtensionContext');
export interface IExtensionContext extends ExtensionContext {}

export const IExtensions = Symbol('IExtensions');
export interface IExtensions {
    determineExtensionFromCallStack(stack?: string): { extensionId: string; displayName: string };
}

export const IJupyterExtensionBanner = Symbol('IJupyterExtensionBanner');
export interface IJupyterExtensionBanner {
    isEnabled(type: BannerType): boolean;
    showBanner(type: BannerType): Promise<void>;
}

export type DeprecatedSettingAndValue = {
    setting: string;
    values?: {}[];
};

export type DeprecatedFeatureInfo = {
    doNotDisplayPromptStateKey: string;
    message: string;
    moreInfoUrl: string;
    commands?: CommandIds[];
    setting?: DeprecatedSettingAndValue;
};

export interface IFeatureSet {}

export const IFeaturesManager = Symbol('IFeaturesManager');

export interface IFeaturesManager extends Disposable {
    readonly features: IFeatureSet;
    readonly onDidChangeFeatures: Event<void>;
    initialize(): void;
    registerDeprecation(deprecatedInfo: DeprecatedFeatureInfo): void;
}

export interface IDisposable {
    dispose(): void | undefined;
}
export interface IAsyncDisposable {
    dispose(): Promise<void>;
}

/**
 * Interface used to implement cryptography tools
 */
export const ICryptoUtils = Symbol('ICryptoUtils');
export interface ICryptoUtils {
    /**
     * Creates hash using the data and encoding specified
     * @returns hash as number, or string
     * @param data The string to hash
     * @param [algorithm] Defaults to SHA-256
     */
    createHash(data: string, algorithm?: 'SHA-512' | 'SHA-256'): Promise<string>;
}

export const IAsyncDisposableRegistry = Symbol('IAsyncDisposableRegistry');
export interface IAsyncDisposableRegistry extends IAsyncDisposable {
    push(disposable: IDisposable | IAsyncDisposable): void;
}

export enum Experiments {
    DataViewerContribution = 'DataViewerContribution',
    DoNotWaitForZmqPortsToBeUsed = 'DoNotWaitForZmqPortsToBeUsed',
    DataViewerDeprecation = 'DataViewerDeprecation'
}

/**
 * Experiment service leveraging VS Code's experiment framework.
 */
export const IExperimentService = Symbol('IExperimentService');
export interface IExperimentService {
    activate(): Promise<void>;
    inExperiment(experimentName: Experiments): boolean;
    getExperimentValue<T extends boolean | number | string>(experimentName: Experiments): Promise<T | undefined>;
}

export type InterpreterUri = Resource | PythonEnvironment;

export const IDataScienceCommandListener = Symbol('IDataScienceCommandListener');
export interface IDataScienceCommandListener {
    register(): void;
}

export interface IDisplayOptions {
    disableUI: boolean;
    onDidChangeDisableUI: Event<void>;
}

// Basic structure for a cell from a notebook
// CellRange is used as the basis for creating new ICells.
// Was only intended to aggregate together ranges to create an ICell
// However the "range" aspect is useful when working with plain text document
// Ultimately, it would probably be ideal to be ICell and change line to range.
// Specifically see how this is being used for the ICodeLensFactory to
// provide cells for the CodeWatcher to use.
export interface ICellRange {
    range: Range;
    cell_type: string;
}

export const IVariableScriptGenerator = Symbol('IVariableScriptGenerator');

type ScriptCode = {
    /**
     * Code that must be executed to initialize the environment.
     */
    initializeCode?: string;
    /**
     * Actual code that will produce the required information.
     */
    code: string;
    /**
     * Code that will be executed to re-set the environment, eg. remove variables/functions introduced into the users environment.
     */
    cleanupCode?: string;
};
export type ParentOptions = {
    root: string;
    propertyChain: (string | number)[];
    startIndex: number;
};
export interface IVariableScriptGenerator {
    generateCodeToGetVariableInfo(options: { isDebugging: boolean; variableName: string }): Promise<ScriptCode>;
    generateCodeToGetVariableProperties(options: {
        isDebugging: boolean;
        variableName: string;
        stringifiedAttributeNameList: string;
    }): Promise<ScriptCode>;
    generateCodeToGetVariableTypes(options: { isDebugging: boolean }): Promise<ScriptCode>;
    generateCodeToGetAllVariableDescriptions(parentOptions: ParentOptions | undefined): Promise<string>;
    generateCodeToGetVariableValueSummary(variableName: string): Promise<string>;
}
export const IDataFrameScriptGenerator = Symbol('IDataFrameScriptGenerator');
export interface IDataFrameScriptGenerator {
    generateCodeToGetDataFrameInfo(options: { isDebugging: boolean; variableName: string }): Promise<ScriptCode>;
    generateCodeToGetDataFrameRows(options: {
        isDebugging: boolean;
        variableName: string;
        startIndex: number;
        endIndex: number;
    }): Promise<ScriptCode>;
}
