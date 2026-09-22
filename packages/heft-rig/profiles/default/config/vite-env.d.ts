/// <reference types="vite/client" />
/// <reference types="vite/types/importMeta.d.ts" />

// Extend Navigator with modern APIs
interface NavigatorUAData {
  readonly brands: ReadonlyArray<{ brand: string; version: string }>;
  readonly mobile: boolean;
  readonly platform: string;
  getHighEntropyValues(hints: string[]): Promise<{
    architecture?: string;
    bitness?: string;
    formFactor?: string[];
    model?: string;
    platformVersion?: string;
    fullVersionList?: ReadonlyArray<{ brand: string; version: string }>;
    uaFullVersion?: string;
  }>;
  toJSON(): {
    brands: ReadonlyArray<{ brand: string; version: string }>;
    mobile: boolean;
    platform: string;
  };
}

interface Navigator {
  readonly userAgentData?: NavigatorUAData;
  readonly standalone?: boolean;
  readonly deviceMemory?: number;
}

interface WorkerNavigator {
  readonly userAgentData?: NavigatorUAData;
  readonly deviceMemory?: number;
}
