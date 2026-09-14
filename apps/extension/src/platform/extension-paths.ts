/** Package-root paths shared by the builder, runtime and browser tooling. */
export const EXTENSION_PATHS = {
  backgroundScript: 'background/background.js',
  contentScript: 'content/content.js',
  optionsPage: 'options/options.html',
  optionsScript: 'options/options.js',
  optionsStyles: 'options/options.css',
  offscreenPage: 'offscreen/offscreen.html',
  offscreenScript: 'offscreen/offscreen.js',
  inferenceWorker: 'runtime/inference-worker.js',
} as const
