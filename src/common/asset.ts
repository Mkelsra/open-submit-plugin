import { Asset } from "./imstypes"

export function getAssetKeywords(asset: Asset, max?: number): string[] {
    if (!Array.isArray(asset.metadata.keywords)) return [];
    if (max === undefined) asset.metadata.keywords;
    return asset.metadata.keywords.slice(0, max);
}

export function getAssetTitle(asset: Asset): string {
    if (!asset.metadata.title) return '';
    return asset.metadata.title.toString()
}

export function getAssetDescription(asset: Asset): string {
    if (!asset.metadata.description) return '';
    return asset.metadata.description.toString()
}

export function getAssetDateTaken(asset: Asset): Date | null {
    if (!asset.metadata.dateTaken) return null;
    const date = new Date(asset.metadata.dateTaken);
    return !isNaN(date.getTime()) ? date : null;
}

export function isAssetIllustration(asset: Asset): boolean {
    return asset.type === 'photo' && (
                asset.metadata.asIllustration ||
                asset.metadata.aiGenerated ||
                asset.metadata.render3d
            ) || 
            asset.type === 'illustration'
}