import type { Order } from './types';

export function checkout(order: Order): number {
    return order.total;
}
