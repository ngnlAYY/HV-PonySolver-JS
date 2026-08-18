import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

import { ANSWER_CODES } from '@hv-pony-solver/shared/answer'

import { assertMatchingArchiveVerification, verifyPackagedArchive } from './packaged-smoke-artifact.mjs'

const successRecordPattern = /\[([A-Z]{2})\((\d{1,3}(?:\.\d+)?)\)\]/u

export function validatePackagedInferenceObservation(observation, oracle, label = 'Packaged inference observation') {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new Error(`${label} must be an object`)
  }
  if (observation.randomFallbackDisabled !== true) {
    throw new Error(`${label} did not prove random fallback was disabled`)
  }
  if (!Array.isArray(observation.checkedIndexes)) {
    throw new Error(`${label} has no checked checkbox indexes`)
  }
  if (typeof observation.panel !== 'string' || observation.panel.length === 0) {
    throw new Error(`${label} has no status-panel result`)
  }
  if (observation.panel.includes('识别失败，随机选择')) {
    throw new Error(`${label} used random fallback instead of model inference`)
  }
  if (observation.panel.includes('待手动提交')) {
    throw new Error(`${label} recorded a manual result instead of a successful submission`)
  }

  const successMatch = observation.panel.match(successRecordPattern)
  if (!successMatch?.[1] || successMatch[2] === undefined) {
    throw new Error(`${label} has no successful confidence-bearing history record`)
  }
  const classId = ANSWER_CODES.indexOf(successMatch[1])
  const confidence = Number.parseFloat(successMatch[2]) / 100
  if (classId < 0 || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new Error(`${label} has an invalid successful result`)
  }
  if (!isDeepStrictEqual(observation.checkedIndexes, [classId])) {
    throw new Error(`${label} checked the wrong checkbox index`)
  }

  if (oracle) {
    if (classId !== oracle.classId) {
      throw new Error(`${label} classId does not match the fixture oracle`)
    }
    const displayedOracleConfidence = Number.parseFloat((oracle.confidence * 100).toFixed(1)) / 100
    if (confidence !== displayedOracleConfidence) {
      throw new Error(`${label} confidence does not match the fixture oracle`)
    }
  }
  return {
    type: 'success',
    classId,
    answerCode: ANSWER_CODES[classId],
    confidence,
    checkedIndexes: [...observation.checkedIndexes],
  }
}

export async function createPackagedE2eRecord({
  target,
  packagedArtifact,
  archiveVerification,
  browserVersion,
  driverVersion,
  observations,
}) {
  if (target !== packagedArtifact.target) {
    throw new Error('Packaged E2E target does not match artifact metadata')
  }
  if (typeof browserVersion !== 'string' || browserVersion.trim().length === 0) {
    throw new Error(`${target} packaged E2E browser version is absent`)
  }
  if (!Array.isArray(observations) || observations.length < 2) {
    throw new Error(`${target} packaged E2E requires at least two inference observations`)
  }
  assertMatchingArchiveVerification(packagedArtifact, archiveVerification)
  const currentArchiveVerification = await verifyPackagedArchive(packagedArtifact)
  if (
    !isDeepStrictEqual(currentArchiveVerification.archive, archiveVerification.archive) ||
    !isDeepStrictEqual(currentArchiveVerification.tree, archiveVerification.tree)
  ) {
    throw new Error(`${target} archive changed between browser execution and evidence creation`)
  }
  const results = observations.map((observation, index) =>
    validatePackagedInferenceObservation(
      observation,
      packagedArtifact.oracle,
      `${target} packaged inference run ${index + 1}`,
    ),
  )
  return {
    schemaVersion: 2,
    kind: 'packaged-browser-e2e',
    target,
    passed: true,
    fixture: packagedArtifact.artifact.fixture === true,
    model: packagedArtifact.artifact.model,
    ...(packagedArtifact.oracle ? { oracle: packagedArtifact.oracle } : {}),
    archive: currentArchiveVerification.archive,
    tree: currentArchiveVerification.tree,
    inference: {
      randomFallback: false,
      runCount: results.length,
      results,
    },
    browserVersion,
    ...(driverVersion ? { driverVersion } : {}),
  }
}

export async function writePackagedE2eEvidence(directory, options) {
  const record = await createPackagedE2eRecord(options)
  if (!directory) {
    return null
  }
  await mkdir(directory, { recursive: true })
  const evidencePath = path.join(directory, `${options.target}.json`)
  await writeFile(evidencePath, `${JSON.stringify(record, null, 2)}\n`)
  return evidencePath
}
