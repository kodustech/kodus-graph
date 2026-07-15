export interface Order {
    id: string;
    total: number;
}

export enum Status {
    Open = 'open',
    Closed = 'closed',
}
