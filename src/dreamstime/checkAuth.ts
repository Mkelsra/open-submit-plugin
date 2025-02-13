import { Asset } from "../common/imstypes";
declare const assets: Asset[];

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
    for (const asset of assets) {
        asset.markDone();
    }
}