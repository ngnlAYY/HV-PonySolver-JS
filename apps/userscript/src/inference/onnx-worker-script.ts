export function createOnnxWorkerScript(): string {
  return `
            'use strict';

            let sessionPromise = null;
            let session = null;
            let preprocessCanvas = null;
            let preprocessContext = null;
            let preprocessSize = 0;

            async function ensureSession() {
                if (session) {
                    return session;
                }
                if (!sessionPromise) {
                    throw new Error('ONNX Session 未初始化');
                }
                session = await sessionPromise;
                return session;
            }

            function ensurePreprocessResources(size) {
                if (preprocessCanvas && preprocessContext && preprocessSize === size) {
                    return preprocessContext;
                }
                preprocessCanvas = new OffscreenCanvas(size, size);
                preprocessContext = preprocessCanvas.getContext('2d', { willReadFrequently: true });
                if (!preprocessContext) {
                    throw new Error('无法创建 2D canvas 上下文');
                }
                preprocessSize = size;
                return preprocessContext;
            }

            async function preprocessImage(imageBuffer, size) {
                if (typeof createImageBitmap !== 'function') {
                    throw new Error('当前环境不支持 createImageBitmap');
                }
                if (typeof OffscreenCanvas !== 'function') {
                    throw new Error('当前环境不支持 OffscreenCanvas');
                }

                const blob = new Blob([imageBuffer]);
                const bitmap = await createImageBitmap(blob);
                try {
                    const context = ensurePreprocessResources(size);
                    context.fillStyle = 'rgb(114, 114, 114)';
                    context.fillRect(0, 0, size, size);
                    const scale = Math.min(size / bitmap.height, size / bitmap.width);
                    const newHeight = Math.max(1, Math.trunc(bitmap.height * scale));
                    const newWidth = Math.max(1, Math.trunc(bitmap.width * scale));
                    const yOffset = Math.trunc((size - newHeight) / 2);
                    const xOffset = Math.trunc((size - newWidth) / 2);
                    context.drawImage(bitmap, xOffset, yOffset, newWidth, newHeight);
                    const imageData = context.getImageData(0, 0, size, size).data;
                    const plane = size * size;
                    const input = new Float32Array(plane * 3);
                    for (let index = 0, offset = 0; index < plane; index++, offset += 4) {
                        input[index] = imageData[offset] / 255;
                        input[plane + index] = imageData[offset + 1] / 255;
                        input[plane * 2 + index] = imageData[offset + 2] / 255;
                    }
                    return input;
                } finally {
                    bitmap.close();
                }
            }

            async function handleInit(message) {
                if (!self.ort) {
                    try {
                        importScripts(message.ortScriptUrl);
                    } catch (error) {
                        throw new Error('onnxruntime-web 加载失败: ' + (error && error.message ? error.message : String(error)));
                    }
                }
                if (!self.ort) {
                    throw new Error('onnxruntime-web 未加载');
                }
                self.ort.env.wasm.wasmPaths = message.wasmPath;
                self.ort.env.wasm.numThreads = 1;
                if (!sessionPromise) {
                    sessionPromise = self.ort.InferenceSession.create(message.modelBuffer, {
                        executionProviders: ['wasm'],
                    });
                }
                session = await sessionPromise;
                return { type: 'response', requestId: message.requestId };
            }

            async function handleDetect(message) {
                const currentSession = await ensureSession();
                const input = await preprocessImage(message.imageBuffer, message.size);
                const tensor = new self.ort.Tensor('float32', input, [1, 3, message.size, message.size]);
                const results = await currentSession.run({ images: tensor });
                const firstOutput = results[Object.keys(results)[0]];
                if (!firstOutput || !firstOutput.data) {
                    throw new Error('ONNX 输出为空');
                }
                const output = firstOutput.data.buffer.slice(
                    firstOutput.data.byteOffset,
                    firstOutput.data.byteOffset + firstOutput.data.byteLength,
                );
                return { type: 'response', requestId: message.requestId, output };
            }

            self.onmessage = async (event) => {
                const message = event.data || {};
                try {
                    if (message.type === 'init') {
                        const response = await handleInit(message);
                        self.postMessage(response);
                        return;
                    }
                    if (message.type === 'detect') {
                        const response = await handleDetect(message);
                        self.postMessage(response, [response.output]);
                        return;
                    }
                    throw new Error('未知消息类型: ' + message.type);
                } catch (error) {
                    self.postMessage({
                        type: 'error',
                        requestId: message.requestId,
                        message: error && error.message ? error.message : String(error),
                    });
                }
            };
        `
}
