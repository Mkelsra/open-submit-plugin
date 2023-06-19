import { awaitTimeout } from "./utils";

export function clickOnElement(element: HTMLElement, ev: string = 'click'){
    let event = new MouseEvent(ev, {
        bubbles: true,
        cancelable: true,
        view: window
    });
    element.dispatchEvent(event);
}

export async function awaitElement<T extends Element>(selector: string): Promise<T> {
    for (let i = 0; i < 500; i++){
        const element = document.querySelector<T>(selector);
        if (element) return element
        await awaitTimeout(500)
    }
    throw new Error('Element cannot be found on page: ' + selector);
}
