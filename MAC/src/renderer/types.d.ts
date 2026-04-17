import type { FrondaApi } from "@main/preload";

declare global {
  interface Window {
    fronda: FrondaApi;
  }
}

export {};
