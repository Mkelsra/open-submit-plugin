
export function awaitTimeout<T>(time: number, res: T): Promise<T>
export function awaitTimeout<T>(time: number): Promise<void>

export function awaitTimeout<T>(time: number, res?: T): Promise<T> {
    return new Promise((res) => setTimeout(res, time))
}

export class AuthError extends Error {
    constructor(message?: string) {
        super(message ?? 'Unauthorized');
    }
}