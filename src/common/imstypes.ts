export type Asset = {
    assetId: string,
    title: string,
    uploadedBasename: string,
    type: string,
    metadata: { [prop: string]: any },
    files: AssetFile[],
    get mainFile(): AssetFile | undefined,
    markers: AssetMarker[],
    addMarker: (markerName: string, subject: string | null, data?: object) => Promise<void>
    processed: boolean,
    log: (message: string) => void,
    warn: (message: string) => void,
    progress: (progress: number, prepare: boolean) => void,
    markFailed: (message: string) => void,
    markNotFound: () => void,
    markDone: (data?: object) => void,
    markUnauthorized: () => void,
    markPostponed: () => void,
}

export type AssetLink = {
    title: string,
    name: string,
    assetId: string
}

export type AssetFile = {
    name: string,
    role: string
    getBlob: () => Promise<Blob>
}

export type AssetMarker = {
    name: string,
    subject: string | null,
    data: any
}

export type SubmitContext<D, S> = {

    // Настройки процесса сабмита
    settings: S,

    // Переданные в процесс сабмита словари
    dictionaries: D

}

interface IImsHost {
    loadAsset(assetId: string): Promise<Asset>,

    getProcessSharedState(): Promise<{
        [step: string]: { [prop: string]: any }
    }>

    window: {
        setShowState(val: boolean): void;
        setInstruction(instruction: { text: string, link?: string, linkText?: string }): void;
        clearSession(): void
    }
}

declare global {
    interface Window {
        imshost: IImsHost;
    }
}
