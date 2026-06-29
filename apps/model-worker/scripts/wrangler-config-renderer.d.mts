declare const testWranglerConfigEnv: {
  MODEL_KEYS_KV_NAMESPACE_ID: string
  MODEL_BUCKET_NAME: string
}

declare function renderWranglerConfig(
  template: string,
  options?: {
    values?: Record<string, string | undefined>
    renderMode?: string
    mainPath?: string
  },
): string

declare function renderWranglerConfigFile(options: {
  templatePath: string
  outputPath: string
  values?: Record<string, string | undefined>
  renderMode?: string
  outputName?: string
  mainPath?: string
}): Promise<string>

export { renderWranglerConfig, renderWranglerConfigFile, testWranglerConfigEnv }
