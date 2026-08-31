/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_MES_FACADE_URL?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_TENANT_ID?: string;
  readonly VITE_API_KEY?: string;
  readonly VITE_USER_ROLE?: string;
  readonly VITE_USER_ID?: string;
  readonly VITE_FACTORY_ID?: string;
  readonly VITE_SCOPE?: string;
  readonly VITE_SESSION_ID?: string;
  readonly VITE_REALTIME_URL?: string;
  readonly VITE_REALTIME_PROTOCOL?: string;
  readonly VITE_MES_SOURCE_NAME?: string;
}
