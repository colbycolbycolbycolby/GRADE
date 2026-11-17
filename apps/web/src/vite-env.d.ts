/// <reference types="vite/client" />

declare const __GRADE_BUILD_ID__: string;

declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component;
  export default component;
}
