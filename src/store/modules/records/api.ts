import type { AdapterRegistry } from '@/explorer/types';

export function getEntityAdapter(entityId: string, adapters: AdapterRegistry) {
  const adapter = adapters[entityId];
  if (!adapter) throw new Error('Unknown collection');
  return adapter;
}
