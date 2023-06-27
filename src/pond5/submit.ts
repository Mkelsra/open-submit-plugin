import { callPage } from "../common/net";
import { Asset, AssetLink, SubmitContext } from "../common/imstypes";
import { awaitElement, clickOnElement } from "../common/page";
import { awaitTimeout } from "../common/utils";
import { getAssetDateTaken, getAssetDescription, getAssetKeywords, getAssetTitle, isAssetIllustration } from "../common/asset";

type DictionaryDef = {
    countries: {
        [country: string]: string
    }
}

type SettingsDef = {
    clickSubmit: boolean
}

declare const submitContext: SubmitContext<DictionaryDef, SettingsDef>;
declare function switchPage(url: string): void;
declare const assets: Asset[];

const DESTINATION_NAME = 'pond5'

type FoundAsset = {
    asset: Asset,
    stockId: string
}

type FoundRelease = {
    stockId: string,
    rejected: boolean
}

const findAssetsOnPage = (assets: Asset[], root: Document): { found: FoundAsset[], left: Asset[] } => {
    const foundAssetIds = new Set<string>()
    const foundAssets: FoundAsset[] = []

    const rows = root.querySelectorAll<HTMLTableCellElement>('#tech_table .UploadsTable-row')
    for (const row of rows){
        if (foundAssets.length === assets.length) {
            break;
        }
        for (const asset of assets){
            if (!asset.assetId){
                continue;
            }
            if (foundAssetIds.has(asset.assetId)){
                continue;
            }

            const cells = row.querySelectorAll('td')
            for (const cell of cells){
                const cellText = cell.innerText.trim().toLowerCase()
                if (cellText.startsWith(asset.uploadedBasename.trim().toLocaleLowerCase() + ".")){
                    const stockId = row.getAttribute('itemid')
                    if (stockId){
                        asset.log('Asset found with id ' + stockId)
                        foundAssetIds.add(asset.assetId)
                        foundAssets.push({
                            asset,
                            stockId
                        })
                    }
                    break;
                }
            }

        }
    }

    const left = assets.filter(asset => !foundAssetIds.has(asset.assetId))

    return {
        found: foundAssets,
        left
    }
}


const findFailedAssetsOnPage = (assets: Asset[], root: Document): { left: Asset[] } => {

    const processed = new Set<Asset>()    

    const findAssets = (selector: string, callback: (asset: Asset, message: string) => void) => {
        const errorEls = root.querySelectorAll<HTMLElement>(selector)
        for (const errorEl of errorEls){
            const errorElParent = errorEl.parentElement;
            if (!errorElParent) continue;
            const message = errorElParent.innerText;
            const errorTr = errorEl.closest('tr')
            if (!errorTr) continue;
            const nameCandidates = errorTr.querySelectorAll('td')
            for (const nameCandidate of nameCandidates){
                for (const asset of assets){
                    if (asset.processed){
                        continue;
                    }
                    if (nameCandidate.innerText.trim().toLowerCase().startsWith(asset.uploadedBasename.trim().toLocaleLowerCase() + ".")){
                        callback(asset, message)
                        processed.add(asset)
                        break;
                    }
                }
            }
        }
    }

    if (assets.length > 0){
        findAssets('#details_table .kux_processing_failed', (asset, message) => {
            asset.markFailed(message)
        })
        findAssets('#details_table .kux_processing_scheduled', (asset, message) => {
            asset.warn('Processing status on microstock: ' + message)
        })
    }
    const left = assets.filter(asset => !processed.has(asset))

    return {
        left
    }
}

const findMaxPageOnPage = (root: Document): number => {
    const pageSwitchers = [...root.querySelectorAll<HTMLAnchorElement>('form a.Button')]
    if (pageSwitchers.length === 0){
        return 0;
    }
    const res = pageSwitchers.map(a => {
        const m = a.href.match(/&at_page=(\d+)/)
        return m ? parseInt(m[1]) : 0
      }).reduce((a, c) => Math.max(a, c), 0)
    return Math.min(res, 100);
}

const findAssets = async (assets: Asset[]): Promise<FoundAsset[]> => {

    let maxPage = null;
    let page = 0;

    let found: FoundAsset[] = []
    let left = assets;

    while ((maxPage === null || page <= maxPage) && left.length > 0){
        if (page !== 0){
            await awaitTimeout(5000);
        }
        const postdata = new FormData()
        postdata.append('prefs_submit', 'Search');
        postdata.append('kux_filter_search', '');
        postdata.append('in_public_bin', '-1');
        postdata.append('max_per_page', '800');
        postdata.append('status', '21');
        postdata.append('ordby', '108');
        postdata.append('media_type', '-1');
        const document = await callPage(
            "POST",
            '/index.php?page=my_uploads&sub=tech' + (page !== 0 ? '&at_page=' + page : ''),
            undefined,
            postdata
        )

        if (maxPage === null){
            maxPage = findMaxPageOnPage(document)
        }
        const res = findAssetsOnPage(left, document);
        found = [
            ...found,
            ...res.found
        ];
        left = res.left;
        page++;
    }

    if (left.length > 0){
        await awaitTimeout(5000);

        const postdata = new FormData()
        postdata.append('prefs_submit', 'Search');
        postdata.append('kux_filter_search', '');
        postdata.append('in_public_bin', '-1');
        postdata.append('max_per_page', '800');
        postdata.append('ordby', '108');
        postdata.append('media_type', '-1');
        const document = await callPage(
            "POST",
            '/index.php?page=my_uploads&sub=tech',
            undefined,
            postdata
        )
        const res = findAssetsOnPage(left, document);
        found = [
            ...found,
            ...res.found
        ];
        left = res.left
        left = findFailedAssetsOnPage(left, document).left
    }

    for (const asset of left){
        asset.markNotFound();
    }
    return found
}

const findReleaseOnStock = async (releaseName: string): Promise<FoundRelease | null> => { 
    const root = await callPage("GET", "https://www.pond5.com/index.php?page=releases")
    const rows = root.querySelectorAll<HTMLElement>('.UserAccountTable .UserAccountTable-row')
    const releaseNamePrep = releaseName.trim().toLowerCase()
    for (const row of rows){
        const cells = row.querySelectorAll('td');
        const nameCell = cells[3]
        if (!nameCell) continue
        if (nameCell.innerText.trim().toLowerCase() === releaseNamePrep){
            return {
                stockId: cells[1].innerText.trim(),
                rejected: cells[0].innerText.trim() === '✗'
            }
        }
    }
    return null;
}


const uploadReleaseFile = async (file: Blob, name: string, type: string) => {
    let uppy = (window as any).uppyInstance;
    if (!uppy){
        let uploadButton = document.querySelector<HTMLElement>('.js-uploadReleaseModal');
        if (!uploadButton){
            uploadButton = document.createElement('button')
            uploadButton.className = 'js-uploadReleaseModal'
            document.body.appendChild(uploadButton);
        }
        clickOnElement(uploadButton);
        for (let i = 0; i < 240; i++){
            await awaitTimeout(500)
            uppy = (window as any).uppyInstance;
            if (uppy) break;
        }
        if (!uppy) throw new Error('Uppy uploader not found')
    }
    
    uppy.addFile({
        name,
        type,
        data: file,
        meta: {
        },
        source: 'Local', 
        isRemote: false, 
    })
    await uppy.upload();
    
}

const ReleaseAssetIdToReleaseId: { [assetId: string]: string } = {}; // cache of releases
const loadReleases = async (foundAssets: FoundAsset[]) => {
    for (const { asset } of foundAssets){
        if (asset.metadata.releases && asset.metadata.releases.length > 0){
            asset.log('Will upload releases')
            for (const releaseLink of asset.metadata.releases){
                if (ReleaseAssetIdToReleaseId.hasOwnProperty(releaseLink.assetId)){
                    continue;
                }
                try {
                    const releaseAsset = await window.imshost.loadAsset(releaseLink.assetId);
                    const submitMarker = releaseAsset.markers.find(m => m.name === 'submit' && m.subject === DESTINATION_NAME);
                    if (submitMarker && submitMarker.data && submitMarker.data.mid){
                        ReleaseAssetIdToReleaseId[releaseLink.assetId] = submitMarker.data.mid;
                    }
                    else {
                        const releaseMainFile = releaseAsset.mainFile;
                        if (!releaseMainFile){
                            throw new Error('Main file of release not found')
                        }
                        const releaseMainBasename = releaseMainFile.name.replace(/\..*?$/, '')
                        let mid = null
                        if (submitMarker){
                            const stockRelease = await findReleaseOnStock(releaseMainBasename)
                            if (stockRelease) {
                                if (stockRelease.rejected){
                                    asset.log('Release ' + releaseMainFile.name + ' found but was rejected. Will try to upload it again')
                                }
                                else {
                                    mid = stockRelease.stockId;
                                }
                            }
                        }
                        if (!mid){
                            asset.log('Will upload release: ' + releaseMainFile.name)
                            const blob = await releaseMainFile.getBlob();
                            await uploadReleaseFile(blob, releaseMainFile.name, 'image/jpeg')

                            asset.log('Release was uploaded. Will try to find it')
                            for (let i = 0; i < 3; i++){
                                await awaitTimeout(100)
                                const stockRelease = await findReleaseOnStock(releaseMainBasename)
                                if (stockRelease) {
                                    if (stockRelease.rejected){
                                        throw new Error('Release ' + releaseMainFile.name + ' was rejected')
                                    }
                                    mid = stockRelease.stockId;
                                    break;
                                }
                            }
                            if (!mid) throw new Error('Uploaded release not found on stock')
                        }
                        await releaseAsset.addMarker('submit', DESTINATION_NAME, {
                            mid
                        })
                        ReleaseAssetIdToReleaseId[releaseAsset.assetId] = mid;
                    }
                }
                catch (err: any){
                    asset.warn(`Cannot upload release ${releaseLink.title}: ${err.message}`)
                }
            }
        }
    }
}


const MAX_KEYWORDS = 50;
const MAX_TITLE_LEN = 80;
const MAX_DESCRIPTION_LEN = 1000;


const attachRelease = async (foundAsset: FoundAsset, releaseLink: AssetLink) => {
    foundAsset.asset.log('Attach release ' + releaseLink.title)

    if (!ReleaseAssetIdToReleaseId.hasOwnProperty(releaseLink.assetId)){
        throw new Error('Release ' + releaseLink.title + " not found")
    }

    const releaseId = ReleaseAssetIdToReleaseId[releaseLink.assetId];

    const psmt_objectid = await new Promise<string>((res, rej) => {
        (window as any).P5.XHRupdate(
            (window as any).P5._lpp + '/index.php?page=ajax_misc&what=sitem_tmp&where=myuploadsv2', 
            "commasitems=" + foundAsset.stockId, 
            (json: {psmt_objectid: string}) => {
                res(json.psmt_objectid)
            }, 
            (err: any) => {
                rej(err ? err.toString(): 'Failed')
            }
        );
    })

    await callPage('GET', `/index.php`, {
        page: 'my_uploads_html',
        what: 'attrel',
        pf_fullscreen: 1,
        pef_objectid: releaseId,
        psmt_objectid
    })
}

const saveAndSubmitAssets = async (foundAssets: FoundAsset[]): Promise<FoundAsset[]> => {
    const savedAssets = [];
    for (const foundAsset of foundAssets){
        const { asset, stockId } = foundAsset;
        try {
            if (asset.metadata.releases && asset.metadata.releases.length > 0){
                for (const releaseLink of asset.metadata.releases){
                    await attachRelease(foundAsset, releaseLink)
                }
            }

            asset.log('Start save metdata')
            
            const editingPage = await callPage('GET', '/index.php?page=edit_item&itemid=' + stockId);
            const form = editingPage.querySelector<HTMLFormElement>('#editClip');
            if (!form) throw new Error('Edit form not found')
            const formData = new FormData(form);
            const assetKeywords = getAssetKeywords(asset, MAX_KEYWORDS)

            
            if (submitContext.settings.clickSubmit){
                formData.set('submit_what', 'Save and Submit for Review')
            }
            else {
                formData.set('submit_what', 'Save')
            }

            formData.set('keywords', assetKeywords.join(','))
            formData.set('tagskeywords', assetKeywords.join(','))
            formData.set('name', getAssetTitle(asset).substring(0, MAX_TITLE_LEN))
            formData.set('description', getAssetDescription(asset).substring(0, MAX_DESCRIPTION_LEN))
            
            const dateTaken = getAssetDateTaken(asset)
            if (dateTaken){
                formData.set('media_created_at_int_yyyy', dateTaken.getFullYear().toString())
                formData.set('media_created_at_int_mm', (dateTaken.getMonth() + 1).toString())
                formData.set('media_created_at_int_dd', dateTaken.getDate().toString())
            }

            if (isAssetIllustration(asset)){
                formData.set('video_standard', "301")                 
            }
            else if (asset.type === 'photo') {
                formData.set('video_standard', "300")
            }
            else if (asset.type === 'video' || asset.type === 'vector') {
                // Keep default => do nothing
            }
            else {
                throw new Error('Unexpected asset type: ' + asset.type)
            }

            if (!isAssetIllustration(asset) && asset.metadata.editorial){
                formData.set('curator_note', 'Please mark this photo as Editorial Use Only')
            }

            if (asset.metadata.country){
                if (submitContext.dictionaries.countries.hasOwnProperty(asset.metadata.country)){
                    formData.set('location_country', submitContext.dictionaries.countries[asset.metadata.country])
                }
            }

            if (asset.type === 'video' && asset.metadata.looped){
                formData.set('seamless_looping', 'yes')
            }

            if (asset.metadata.price){
                formData.set('price', asset.metadata.price)
                const otherPrices = editingPage.querySelectorAll<HTMLElement>('#otherprices .opitem');
                for (const otherPrice of otherPrices){
                    const label = otherPrice.querySelector<HTMLElement>('label');
                    const input = otherPrice.querySelector<HTMLInputElement>('input');
                    if (!label) continue;
                    if (!input) continue;
                    const percentage = parseInt(label.getAttribute('percentage') ?? '')
                    if (isNaN(percentage)) continue;
                    const elPrice = asset.metadata.price * percentage / 100
                    formData.set(input.name, elPrice.toFixed(1))
                }
            }

            const res = await callPage('POST', '/index.php?r=index.php&page=edit_item&itemid=' + stockId, undefined, formData)
            const resError = res.querySelector<HTMLElement>('.p5_error_message')
            if (resError){
                throw new Error(resError.innerText)
            }

            asset.log(submitContext.settings.clickSubmit ? 'Saved and submitted' : 'Saved')
            savedAssets.push(foundAsset)
        }
        catch(err: any){
            asset.markFailed(err.message)
        }
    }

    
    return savedAssets;
}

const processAssets = async (assets: Asset[]) => {
    if (assets.length === 0){
        return;
    }
    
    // Find assets
    const foundAssets = await findAssets(assets)
    if (foundAssets.length === 0){
        return
    }

    // Load releases
    await loadReleases(foundAssets);

    // Save metadata 
    const doneAssets = await saveAndSubmitAssets(foundAssets)

    // Mark done
    for (const doneAsset of doneAssets){
        doneAsset.asset.markDone({
            mid: doneAsset.stockId
        });
    }

}


if (!/^https:\/\/www.pond5.com\/(.*?\/)?index.php\?page=my_uploads/.test(window.location.toString())){
    for (const asset of assets){
        asset.markUnauthorized();
    }
}
else {
    await processAssets(assets);

}