// ORT_MODEL_INTEGRITY describes the packaged .ort build and pairs with
// MODEL_INTEGRITY (in model.ts), which describes the source ONNX file of the
// same export. Both must be regenerated together; changing one alone means the
// other no longer matches the shipped artifact pair.
export const ORT_MODEL_FILENAME = 'yolo26n-640.ort'

export const ORT_MODEL_INTEGRITY = {
  byteLength: 9_914_448,
  sha256: '4e771776d9356679539ffed53ee40ea012394f9b586aa92a76267e8fee38094c',
} as const
