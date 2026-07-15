import type { Order, Status } from './types';

export function summarize(order: Order, status: Status): string {
    return `${order.id}:${status}`;
}
