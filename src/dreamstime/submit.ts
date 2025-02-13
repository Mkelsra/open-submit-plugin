import { parseCSV } from "../common/csv";
import { Asset, AssetLink, SubmitContext } from "../common/imstypes";
import { HttpMethod } from "../common/net";
import { AuthError } from "../common/utils";

type DictionaryDef = {
    countries: {
        [country: string]: string
    }
}

type SettingsDef = {
    clickSubmit: boolean
}

declare global {
    interface Window {
        securitycheck: string;
    }
}

declare const submitContext: SubmitContext<DictionaryDef, SettingsDef>;
declare const assets: Asset[];

const DESTINATION_NAME = 'dreamstime'

type FoundAsset = {
    asset: Asset,
    stockId: string
}

type FoundRelease = {
    stockId: string,
    rejected: boolean
}

async function callTextWithCaptchaCheck(method: HttpMethod, endpoint: string, params?: any, data?: BodyInit | null): Promise<{ text: string; captcha: boolean; }> {
    const params_str = params ? new URLSearchParams(params).toString() : '';
    const response = await fetch(endpoint + (params_str ? '?' + params_str : ''), {
        method,
        body: data
    })
    const result = await response.text();
    return {
        text: result,
        captcha: result.indexOf('/captcha.js') >= 0
    }
}

async function callPageWithCaptchaCheck(method: HttpMethod, endpoint: string, params?: any, data?: BodyInit | null): Promise<{ text: string, document: Document; captcha: boolean; }> {
    const res = await callTextWithCaptchaCheck(method, endpoint, params, data);
    const parser = new DOMParser();
    const document = parser.parseFromString(res.text, 'text/html');
    return {
        document: document,
        text: res.text,
        captcha: res.captcha
    }
}

const findAssetViaFTPHistory = async (assets: Asset[]): Promise<{ left: Asset[], found: FoundAsset[] }> => {

    const upload_history = await callTextWithCaptchaCheck('GET', 'https://www.dreamstime.com/ajax/upload/upload_ajax_page_history.php', {
        history: 1,
        securitycheck: window.securitycheck
    });
    if (upload_history.captcha) {
        throw new AuthError();
    }

    const found: FoundAsset[] = []
    const left: Asset[] = [];
    const csv_data = parseCSV(upload_history.text);

    // Note: 0th row is header
    const file_to_status = new Map<string, string>();
    for (let row = 1; row < csv_data.length; row++) {
        const original_filename = csv_data[row][2]
        const status = csv_data[row][3]
        const without_ext = original_filename.replace(/\..+$/, '').trim();
        file_to_status.set(without_ext, status);
    }

    for (const asset of assets) {
        const main_file_name_without_ext = asset.mainFile?.name?.replace(/\..+$/, '')?.trim();
        if (!main_file_name_without_ext) {
            left.push(asset);
            continue;
        }
        const status = file_to_status.get(main_file_name_without_ext);
        if (!status) {
            left.push(asset);
            continue;
        }
        const proccessed = status.match(/Processed with image ID (\d+)/);
        if (proccessed) {
            found.push({
                asset: asset,
                stockId: proccessed[1]
            })
        }
        else {
            asset.markFailed(status)
        }
    }
    return {
        left,
        found
    }
}

const findAssetViaSitePage = async (assets: Asset[]): Promise<{ left: Asset[], found: FoundAsset[] }> => {

    debugger;
    const found: FoundAsset[] = []
    let left: Asset[] = assets;

    let p = 1;
    while (true) {

        const formData = new FormData();
        formData.set('unfinished', '1');
        formData.set('pg', `${p}`);
        formData.set('sortingtype', 'sort0');
        formData.set('reload', '0');
        formData.set('securitycheck', window.securitycheck);
        const unfinished = await callPageWithCaptchaCheck('POST', 'https://www.dreamstime.com/ajax/upload/upload_ajax_unfinished.php', {}, formData)
        if (unfinished.captcha) {
            throw new AuthError();
        }

        const file_elements = unfinished.document.querySelectorAll('.upload-item');
        if (file_elements.length === 0) break

        for (const file_element of file_elements) {
            const filename_el = file_element.querySelector<HTMLElement>('.js-filenamefull');
            if (!filename_el) continue;

            const filename = filename_el.innerText.replace(/\..+$/, '')?.trim();

            const new_left: Asset[] = [];
            for (const asset of left) {
                const main_file_name_without_ext = asset.mainFile?.name?.replace(/\..+$/, '')?.trim();
                if (!main_file_name_without_ext) {
                    new_left.push(asset);
                    continue;
                }

                if (main_file_name_without_ext.startsWith(filename)) {
                    found.push({
                        asset: asset,
                        stockId: file_element.id
                    })
                }
                else {
                    new_left.push(asset);
                }
            }
            left = new_left;

            if (left.length === 0) break;
        }

        if (left.length === 0) break;

        const max_page_match = unfinished.text.match(/unfishedMaxPage = (\d+);/);
        if (max_page_match) {
            const max_page = parseInt(max_page_match[1]);
            if (p >= max_page) break;
        }

        p++;
    }

    return {
        left,
        found
    }
}


const findAssets = async (assets: Asset[]): Promise<FoundAsset[]> => {
    let res: FoundAsset[] = [];
    let left_assets = assets;

    const found_in_ftp = await findAssetViaFTPHistory(left_assets);
    left_assets = found_in_ftp.left;
    res = [...res, ...found_in_ftp.found];

    const found_in_page = await findAssetViaSitePage(left_assets);
    left_assets = found_in_page.left;
    res = [...res, ...found_in_page.found];

    for (const asset of left_assets) {
        asset.markNotFound();
    }

    return res;
}

const findReleaseOnStock = async (releaseName: string): Promise<FoundRelease | null> => {
    return null;
}


const uploadReleaseFile = async (file: Blob, name: string, type: string) => {


}

const ReleaseAssetIdToReleaseId: { [assetId: string]: string } = {}; // cache of releases
const loadReleases = async (foundAssets: FoundAsset[]) => {

}


const MAX_KEYWORDS = 50;
const MAX_TITLE_LEN = 80;
const MAX_DESCRIPTION_LEN = 1000;


const attachRelease = async (foundAsset: FoundAsset, releaseLink: AssetLink) => {


}

const saveAndSubmitAssets = async (foundAssets: FoundAsset[]): Promise<FoundAsset[]> => {
    return [];
}

const processAssets = async (assets: Asset[]) => {
    if (assets.length === 0) {
        return;
    }

    // Find assets
    const foundAssets = await findAssets(assets)
    if (foundAssets.length === 0) {
        return
    }

    // Load releases
    await loadReleases(foundAssets);

    // Save metadata 
    const doneAssets = await saveAndSubmitAssets(foundAssets)

    // Mark done
    for (const doneAsset of doneAssets) {
        doneAsset.asset.markDone({
            mid: doneAsset.stockId
        });
    }

}

await new Promise((res) => setTimeout(res, 4000));
debugger;

const captcha = !!document.querySelector('.px-captcha-container');
if (!/^https:\/\/(www\.)?dreamstime.com\/upload/.test(window.location.toString()) || captcha) {
    if (captcha) {
        for (const asset of assets) {
            asset.log('Captcha found');
        }
    }
    for (const asset of assets) {
        asset.markUnauthorized();
    }
}
else {

    if (!window.securitycheck) {
        for (const asset of assets) {
            asset.markFailed("Security check code not found");
        }
    }
    else {
        try {
            await processAssets(assets);
        }
        catch (err) {
            if (err instanceof AuthError) {
                for (const asset of assets) {
                    asset.markUnauthorized();
                }
            }
            else throw err;
        }
    }
}