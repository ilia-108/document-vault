import { configureStore } from '@reduxjs/toolkit';
import type { AdapterRegistry } from '@/explorer/types';
import { recordsReducer } from './modules/records/slice';
import { documentVersionsReducer } from './modules/documentVersions/slice';

export const createAppStore = (adapters: AdapterRegistry) =>
  configureStore({
    reducer: {
      records: recordsReducer,
      documentVersions: documentVersionsReducer,
    },
    middleware: getDefaultMiddleware =>
      getDefaultMiddleware({ thunk: { extraArgument: adapters } }),
  });
export type AppStore = ReturnType<typeof createAppStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
