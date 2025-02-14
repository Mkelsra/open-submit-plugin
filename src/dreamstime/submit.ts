import { parseCSV } from "../common/csv";
import { Asset, AssetLink, SubmitContext } from "../common/imstypes";
import { HttpMethod } from "../common/net";
import { AuthError, awaitTimeout } from "../common/utils";

type DictionaryDef = {
    categories: {
        [cat: string]: string
    },
    countries: {
        [cat: string]: string
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
const CATS = submitContext.dictionaries.categories;
const COUNTRIES = submitContext.dictionaries.countries;

type FoundAsset = {
    asset: Asset,
    stockId: string
}

type FoundRelease = {
    stockId: string,
    rejected: boolean
}

async function callTextWithCaptchaCheck(method: HttpMethod, endpoint: string, params?: any, data?: BodyInit | null): Promise<{ text: string; captcha: boolean; }> {
    await awaitTimeout(100 + Math.round(Math.random() * 500))
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
        const type = csv_data[row][1]
        if (type === 'additional') {
            continue;
        }
        const original_filename = csv_data[row][2]
        const status = csv_data[row][3]
        const without_ext = original_filename.replace(/\..+$/, '').trim();
        file_to_status.set(without_ext, status.trim());
    }

    for (const asset of assets) {
        const main_file_name_without_ext = asset.mainFile?.name?.replace(/\..+$/, '')?.trim();
        if (!main_file_name_without_ext) {
            left.push(asset);
            continue;
        }
        const status = file_to_status.get(main_file_name_without_ext);
        if (!status || status === 'n/a') {
            left.push(asset);
            continue;
        }

        const proccessed = status.match(/Processed with (image|video) ID (\d+)/);
        if (proccessed) {
            const stock_id = proccessed[2];
            const stock_id_exists = await checkStockIdExists(stock_id)
            if (stock_id_exists) {
                found.push({
                    asset: asset,
                    stockId: stock_id
                })
            }
            else {
                left.push(asset);
                continue;
            }
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

            const status = file_element.querySelector<HTMLElement>('.status');
            if (status && status.innerText === 'Processing...') {
                continue;
            }

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

    if (left_assets.length > 0) {
        const found_in_ftp = await findAssetViaFTPHistory(left_assets);
        left_assets = found_in_ftp.left;
        res = [...res, ...found_in_ftp.found];
    }

    if (left_assets.length > 0) {
        const found_in_page = await findAssetViaSitePage(left_assets);
        left_assets = found_in_page.left;
        res = [...res, ...found_in_page.found];
    }

    for (const asset of left_assets) {
        asset.markNotFound();
    }

    return res;
}

const findReleaseOnStock = async (_releaseName: string, releaseMetadata: Record<string, any>, submitStockId: string): Promise<FoundRelease | null> => {
    const type: 'MR' | 'PR' = releaseMetadata.releaseType;
    const form_data = new FormData();
    form_data.set('releasestype', type === 'MR' ? 'mr' : 'pr');
    form_data.set('securitycheck', window.securitycheck);
    form_data.set('imageid', submitStockId);
    form_data.set('sorting', 'lastadded');
    form_data.set('filter', type == 'MR' ? releaseMetadata.modelLastName : releaseMetadata.propertyName);
    form_data.set('location', 'submit');

    const release_search = await callPageWithCaptchaCheck(
        'POST',
        'https://www.dreamstime.com/ajax/upload/upload_ajax_releases.php',
        {},
        form_data
    )
    if (release_search.captcha) {
        throw new AuthError()
    }

    const search_name = (
        type === 'MR' ?
            `${releaseMetadata.modelLastName} ${releaseMetadata.modelFirstName}` :
            `${releaseMetadata.propertyName}`
    ).trim().toLowerCase();

    const release_elements = release_search.document.querySelectorAll('.release-item');
    for (const elem of release_elements) {
        const check = elem.querySelector<HTMLElement>('input[type="checkbox"]');
        if (!check) continue;

        const check_name = (check.dataset.name ?? '').trim().toLowerCase();
        if (check_name === search_name) {
            return {
                rejected: false,
                stockId: check.id
            }
        }
    }

    return null;
}


const uploadReleaseFile = async (file: Blob, name: string, releaseMetadata: Record<string, any>) => {
    const type: 'MR' | 'PR' = releaseMetadata.releaseType;
    const form_data = new FormData();
    form_data.set('securitycheck', window.securitycheck)
    if (type === 'MR') {
        if (!releaseMetadata.modelFirstName) {
            throw new Error('Release ' + name + " has no model firstname");
        }
        if (!releaseMetadata.modelLastName) {
            throw new Error('Release ' + name + " has no model lastname");
        }
        form_data.set('fname', releaseMetadata.modelFirstName)
        form_data.set('lname', releaseMetadata.modelLastName)
        form_data.set('gender', releaseMetadata.gender === 'FEMALE' ? '2' : '1');

        let ethnics = '6';
        switch (releaseMetadata.modelEthnicity) {

            case "CN":
            case "EA":
            case "JA":
            case "SA":
            case "SE":
                ethnics = "1";
                break;

            case "AF":
            case "AA":
            case "BL":
                ethnics = "2";
                break;

            case "WH":
            case "ME":
                ethnics = "3";
                break;

            case "BR":
            case "LA":
                ethnics = "4";
                break;

            case "NA":
            case "PI":
            case "OT":
                ethnics = "6";
                break;

        }
        form_data.set('ethnics', ethnics);

        let age = '';
        const timeFrom = releaseMetadata.modelBirthdate ? new Date(releaseMetadata.modelBirthdate) : null;
        if (timeFrom) {
            const timeTo = releaseMetadata.shootDate ? new Date(releaseMetadata.shootDate) : new Date()
            const years = Math.floor((timeTo.getTime() - timeFrom.getTime()) / 365.26 / 24 / 3600 / 1000);
            if (years <= 1) age = '1'
            else if (years <= 4) age = '2'
            else if (years <= 9) age = '3'
            else if (years <= 15) age = '4'
            else if (years <= 20) age = '5'
            else if (years <= 30) age = '6'
            else if (years <= 45) age = '7'
            else if (years <= 65) age = '8'
            else age = '9'
        }
        if (!age) {
            throw new Error('Release ' + name + " has no date of birth");
        }
        form_data.set('agegroup', age);

        const country = COUNTRIES.hasOwnProperty(releaseMetadata.country) && COUNTRIES[releaseMetadata.country] && COUNTRIES[releaseMetadata.country] !== '0' ?
            COUNTRIES[releaseMetadata.country] : null;
        if (!country) {
            throw new Error('Release ' + name + " has no country");
        }
        form_data.set('country', country);
    }
    else {
        if (!releaseMetadata.propertyName) {
            throw new Error('Release ' + name + " has no property name");
        }
        form_data.set('name', releaseMetadata.propertyName)
    }

    form_data.set('action', 'add');
    form_data.set('file-0', file, name)
    const upload = await callTextWithCaptchaCheck('POST', `https://www.dreamstime.com/ajax/account_${type === "MR" ? 'mr' : 'pr'}-library.php`, {}, form_data)
    if (upload.captcha) {
        throw new AuthError();
    }
}

const ReleaseAssetIdToReleaseId: { [assetId: string]: string } = {}; // cache of releases
const ReleaseAssetIdToType: { [assetId: string]: 'MR' | 'PR' } = {}; // cache of releases
const loadReleases = async (foundAssets: FoundAsset[]) => {
    for (const { asset, stockId } of foundAssets) {
        if (asset.metadata.releases && asset.metadata.releases.length > 0) {
            asset.log('Will upload releases')
            for (const releaseLink of asset.metadata.releases) {
                if (ReleaseAssetIdToReleaseId.hasOwnProperty(releaseLink.assetId)) {
                    continue;
                }
                try {
                    const releaseAsset = await window.imshost.loadAsset(releaseLink.assetId);
                    ReleaseAssetIdToType[releaseLink.assetId] = releaseAsset.metadata.releaseType;

                    const submitMarker = releaseAsset.markers.find(m => m.name === 'submit' && m.subject === DESTINATION_NAME);
                    if (submitMarker && submitMarker.data && submitMarker.data.mid) {
                        ReleaseAssetIdToReleaseId[releaseLink.assetId] = submitMarker.data.mid;
                    }
                    else {
                        const releaseMainFile = releaseAsset.mainFile;
                        if (!releaseMainFile) {
                            throw new Error('Main file of release not found')
                        }
                        const releaseMainBasename = releaseMainFile.name.replace(/\..*?$/, '')
                        let mid = null
                        if (submitMarker) {
                            const stockRelease = await findReleaseOnStock(releaseMainBasename, releaseAsset.metadata, stockId)
                            if (stockRelease) {
                                if (stockRelease.rejected) {
                                    asset.log('Release ' + releaseMainFile.name + ' found but was rejected. Will try to upload it again')
                                }
                                else {
                                    mid = stockRelease.stockId;
                                }
                            }
                        }
                        if (!mid) {
                            asset.log('Will upload release: ' + releaseMainFile.name)
                            const blob = await releaseMainFile.getBlob();
                            await uploadReleaseFile(blob, releaseMainFile.name, releaseAsset.metadata)

                            asset.log('Release was uploaded. Will try to find it')
                            for (let i = 0; i < 3; i++) {
                                await awaitTimeout(100)
                                const stockRelease = await findReleaseOnStock(releaseMainBasename, releaseAsset.metadata, stockId)
                                if (stockRelease) {
                                    if (stockRelease.rejected) {
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
                catch (err: any) {
                    asset.warn(`Cannot upload release ${releaseLink.title}: ${err.message}`)
                }
            }
        }
    }
}

const getAssetCategories = (categories: string[]): string[] => {
    if (!Array.isArray(categories)) return [];
    const res: string[] = []
    for (const category of categories) {
        if (CATS.hasOwnProperty(category) && CATS[category] !== null) {
            res.push(CATS[category])
        }
    }
    return res;
}

const stockIdExistCache = new Map<string, boolean>();
async function checkStockIdExists(stockId: string): Promise<boolean> {
    const was_checked = stockIdExistCache.get(stockId);
    if (was_checked !== undefined) {
        return was_checked;
    }

    const edit_page_data = new FormData();
    edit_page_data.set('section', 'js-edit');
    edit_page_data.set('pg', '1');
    edit_page_data.set('editImageId', stockId);
    edit_page_data.set('securitycheck', window.securitycheck);
    const edit_page = await callTextWithCaptchaCheck(
        'POST',
        'https://www.dreamstime.com/ajax/upload/upload_ajax_pages.php',
        {},
        edit_page_data
    )
    if (edit_page.captcha) {
        throw new AuthError();
    }

    const check_result = edit_page.text.indexOf('This media is not available for editing') < 0;
    stockIdExistCache.set(stockId, check_result);

    return check_result;
}

const attachRelease = async (foundAsset: FoundAsset, releaseLink: AssetLink) => {
    foundAsset.asset.log('Attach release ' + releaseLink.title)

    if (!ReleaseAssetIdToReleaseId.hasOwnProperty(releaseLink.assetId)) {
        throw new Error('Release ' + releaseLink.title + " not found")
    }
    if (!ReleaseAssetIdToType.hasOwnProperty(releaseLink.assetId)) {
        throw new Error('Release ' + releaseLink.title + " has invalid type")
    }

    const releaseId = ReleaseAssetIdToReleaseId[releaseLink.assetId];
    const type = ReleaseAssetIdToType[releaseLink.assetId];
    const attach_form_data = new FormData();
    attach_form_data.set('addremovereleases', '1');
    attach_form_data.set('imageid', foundAsset.stockId);
    attach_form_data.set('releasetype', type === 'MR' ? 'mr' : 'pr');
    attach_form_data.set('action', 'add');
    attach_form_data.set('value', releaseId);
    attach_form_data.set('securitycheck', window.securitycheck);
    const attach_form = await callTextWithCaptchaCheck('POST', 'https://www.dreamstime.com/ajax/upload/upload_ajax_releases.php', {}, attach_form_data);
    if (attach_form.captcha) {
        throw new AuthError();
    }
}

async function generateAiCategories(stockId: string): Promise<string[]> {
    const form_data = new FormData();
    form_data.set('ai', 'categories');
    form_data.set('donetypetitle', '0');
    form_data.set('imageid', stockId);
    form_data.set('securitycheck', window.securitycheck);
    const res = await callTextWithCaptchaCheck(
        'POST',
        'https://www.dreamstime.com/ajax/upload/upload_ajax_autofill.php',
        {},
        form_data
    )
    if (res.captcha) {
        throw new AuthError();
    }
    const parsed_ai = JSON.parse(res.text);
    return [
        parsed_ai.cat1.toString(),
        parsed_ai.cat2.toString(),
        parsed_ai.cat3.toString(),
    ]
}


async function saveAsset(foundAsset: FoundAsset, submit: boolean, set_categories?: string[]): Promise<void> {
    foundAsset.asset.log('Will ' + (submit ? 'submit' : 'save'))

    const saving_data = new FormData();
    saving_data.set('mediasubmit', '1');

    const saving_data_info = {
        "mediaid": foundAsset.stockId,
        "title": foundAsset.asset.metadata.title ?? '',
        "description": foundAsset.asset.metadata.description ?? '',
        "keywords": foundAsset.asset.metadata.keywords ? foundAsset.asset.metadata.keywords.join(' ') : '',
        "cat1": "0",
        "cat2": "0",
        "cat3": "0",
        "newsroom": '0',
        "license": 0,
        "sr_price": "",
        "usereco": false,
        "customprice": false,
        "resubmission": "0",
        "notifyadmins": "",
        "rfll": 0,
        "newsworthy": 0,
        "exclusive": 0,
        "digitallymodel": 0,
        "mediaType": foundAsset.asset.type === 'video' ? 'video' : 'image'
    }

    if (foundAsset.asset.metadata.editorial) {
        saving_data_info.newsroom = '1';
        saving_data_info.license = 16;
        saving_data_info.sr_price = ''
        saving_data_info.usereco = false;
        saving_data_info.customprice = false;
    }
    else {
        saving_data_info.newsroom = '0'
        const licenseWEl = foundAsset.asset.metadata.licenseWEl !== false
        const licensePEl = foundAsset.asset.metadata.licensePEl !== false && (foundAsset.asset.type === 'photo' || foundAsset.asset.type === 'illustration' || foundAsset.asset.type === 'vector');
        const licenseSREl = foundAsset.asset.metadata.licenseSREl !== false

        const license_key = `${licenseWEl ? '1' : '0'}${licensePEl ? '1' : '0'}${licenseSREl ? '1' : '0'}`
        saving_data_info.license = ({
            '000': 16,
            '001': 17,
            '010': 18,
            '011': 19,
            '100': 20,
            '101': 21,
            '110': 22,
            '111': 23
        } as { [key: string]: number })[license_key];
        if (saving_data_info.license === 17 || saving_data_info.license === 19 ||
            saving_data_info.license === 21 || saving_data_info.license === 23
        ) {
            if (foundAsset.asset.metadata.licenseSRElPrice) {
                saving_data_info.sr_price = foundAsset.asset.metadata.licenseSRElPrice;
                saving_data_info.usereco = false;
                saving_data_info.customprice = true;
            }
            else {
                saving_data_info.sr_price = '';
                saving_data_info.usereco = true;
                saving_data_info.customprice = false;
            }
        }
    }

    let cats = set_categories ? set_categories : getAssetCategories(foundAsset.asset.metadata.categories);
    const cats_arr = cats.slice(0, 3);
    if (foundAsset.asset.metadata.aiGenerated) {
        cats_arr[Math.max(cats_arr.length - 1, 0)] = '212' // AI Generated
    }
    saving_data_info.cat1 = cats_arr[0] ?? '0';
    saving_data_info.cat2 = cats_arr[1] ?? '0';
    saving_data_info.cat3 = cats_arr[2] ?? '0';

    saving_data.set('jsonSMLD', encodeURIComponent(JSON.stringify(saving_data_info)))
    saving_data.set('madiastatus', '1');
    saving_data.set('saveall', submit ? '0' : '1');
    saving_data.set('openeditem', foundAsset.stockId);
    saving_data.set('securitycheck', window.securitycheck);

    const save = await callTextWithCaptchaCheck(
        'POST',
        'https://www.dreamstime.com/ajax/upload/upload_ajax_submit.php',
        {},
        saving_data
    )
    if (save.captcha) {
        throw new AuthError();
    }

    if (save.text.indexOf('saved successfully') < 0 && save.text.indexOf('submitted successfully') < 0) {
        throw new Error(save.text);
    }
}

const saveAndSubmitAssets = async (foundAssets: FoundAsset[]): Promise<FoundAsset[]> => {
    const doneAssets: FoundAsset[] = []
    for (const foundAsset of foundAssets) {

        if (foundAsset.asset.metadata.releases && foundAsset.asset.metadata.releases.length > 0) {
            for (const releaseLink of foundAsset.asset.metadata.releases) {
                await attachRelease(foundAsset, releaseLink)
            }
        }

        try {
            let is_done = false;
            let set_categories: string[] | undefined = undefined;
            if (!foundAsset.asset.metadata.categories || foundAsset.asset.metadata.categories.length === 0) {
                await saveAsset(foundAsset, false)
                foundAsset.asset.log('Generate categories')
                set_categories = await generateAiCategories(foundAsset.stockId);
                is_done = !submitContext.settings.clickSubmit
            }

            if (!is_done) {
                await saveAsset(foundAsset, submitContext.settings.clickSubmit, set_categories)
            }
            doneAssets.push(foundAsset)
        }
        catch (err: any) {
            if (err instanceof AuthError) {
                throw err;
            }
            foundAsset.asset.markFailed(err.message);
        }
    }

    return doneAssets
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

async function initPage() {
    for (let attempt = 0; attempt < 100; attempt++) {
        await awaitTimeout(250);
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
            return;
        }
        else if (window.securitycheck) {
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
            return;
        }
    }
    throw new Error("Security check code not found")
}

await initPage();