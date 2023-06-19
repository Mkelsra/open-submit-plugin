export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'


export async function callPage(method: HttpMethod, endpoint: string, params?: any, data?: BodyInit | null) {
    const params_str = params ? new URLSearchParams(params).toString() : '';
    const response = await fetch(endpoint + (params_str ? '?' + params_str : ''), {
        method,
        body: data
     })
    const html = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
}