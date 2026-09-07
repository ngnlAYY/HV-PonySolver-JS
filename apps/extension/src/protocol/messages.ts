// Public protocol facade. Keep consumers on this module while guards and
// payload logic remain grouped by Port, Offscreen, and image responsibilities.
export { CONTENT_PORT_NAME, OFFSCREEN_MESSAGE_TYPE, OPTIONS_PORT_NAME, PROTOCOL_VERSION } from './protocol-validation'

export type {
  CancelRequest,
  ClearKeyRequest,
  DetectRequest,
  DownloadModelRequest,
  HostErrorKind,
  HostErrorResponse,
  HostRequest,
  HostResponse,
  HostStatusUpdate,
  HostSuccessResponse,
  KeyIntentRequest,
  ModelCredentialsChangedMessage,
  PortStatusMessage,
  PrepareRequest,
  QueryModelQuotaRequest,
  SerializedModelRequest,
  VerifyKeyRequest,
} from './port-messages'
export {
  cancelRequestFor,
  errorResponse,
  isCancelRequest,
  isHostRequest,
  isHostResponse,
  isHostStatusUpdate,
  isModelAccessKey,
  isModelCredentialsChangedMessage,
  isPortStatusMessage,
  modelCredentialsChangedMessage,
  portStatusMessage,
  successResponse,
} from './port-messages'

export type {
  OffscreenCancelRequest,
  OffscreenClaimRequest,
  OffscreenClaimResponse,
  OffscreenIdleConfirmationRequest,
  OffscreenIdleConfirmationResponse,
  OffscreenIdleMessage,
  OffscreenMessage,
  OffscreenRequest,
  OffscreenStatusMessage,
} from './offscreen-messages'
export {
  isOffscreenCancelRequest,
  isOffscreenClaimRequest,
  isOffscreenClaimResponse,
  isOffscreenIdleConfirmationRequest,
  isOffscreenIdleConfirmationResponse,
  isOffscreenIdleMessage,
  isOffscreenMessage,
  isOffscreenRequest,
  isOffscreenStatusMessage,
  offscreenStatusMessage,
} from './offscreen-messages'

export { decodeImage, encodeImage, MAX_IMAGE_BYTE_LENGTH } from './image-payload'
