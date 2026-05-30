const ENGINE_BASE_URL = import.meta.env.VITE_AUDIO_ENGINE_URL || 'http://127.0.0.1:18000';
const REQUEST_TIMEOUT_MS = 8000;
const START_TIMEOUT_MS = 20000;
const AUDIO_STOP_SETTLE_MS = 900;
const DEFAULT_CHUNK_SIZE = 128;
const LEGACY_MIN_CHUNK_SIZE = 1;
const LEGACY_MAX_CHUNK_SIZE = 1024;
const LOW_CPU_PITCH_DETECTOR = 'pm';
const LEGACY_READY_STABLE_MS = 2600;
const IMPORT_SLOT_START = 20;
const IMPORT_SLOT_END = 499;

type VoiceQualityMode = 'conversation';

const VOICE_QUALITY_PROFILES: Record<
  VoiceQualityMode,
  {
    chunkSize: number;
    extraConvertSize: number;
    crossFadeOverlapSize: number;
    truncateRatio: number;
    extraFrameSec: number;
    crossfadeSec: number;
    solaSearchFrameSec: number;
    inputGain: number;
    outputGain: number;
    noiseGate: number;
    chunkSec: number;
    vqNeighborCount: number;
  }
> = {
  conversation: {
    chunkSize: DEFAULT_CHUNK_SIZE,
    extraConvertSize: 12288,
    crossFadeOverlapSize: 2048,
    truncateRatio: 1,
    extraFrameSec: 0.08,
    crossfadeSec: 0.08,
    solaSearchFrameSec: 0.02,
    inputGain: 1,
    outputGain: 1,
    noiseGate: -90,
    chunkSec: 0.12,
    vqNeighborCount: 4,
  },
};

type ModelConfig = {
  slot: number;
  dstId: number;
};

type EngineApiMode = 'vcclient-2' | 'legacy-rvc';

type StartEngineOptions = {
  modelId: string;
  inputDeviceId?: string | number;
  outputDeviceId?: string | number;
  monitorOutputDeviceId?: string | number;
  pitch?: number;
  formant?: number;
  chunkSize?: number;
  mutePhysicalOutput?: boolean;
  qualityMode?: VoiceQualityMode;
};

type ImportRvcModelOptions = {
  modelFile: File;
  indexFile?: File | null;
  displayName?: string;
};

export type AvailableVoiceModel = {
  id: string;
  slot: number;
  speaker: number;
  name: string;
  accent: string;
  voiceChangerType: string;
  modelName: string;
  runtimeLabel: string;
  isCpuOptimized: boolean;
  voiceFamily: 'beatrice' | 'rvc' | 'other';
  voiceFamilyLabel: string;
  voiceGender: 'female' | 'male' | 'unknown';
  voiceGenderLabel: string;
  voiceGenderConfidence: 'explicit' | 'estimated' | 'unknown';
  averagePitch?: number;
};

const MODEL_CONFIG: Record<string, ModelConfig> = {
  'british-male': { slot: 0, dstId: 0 },
  'american-female': { slot: 0, dstId: 1 },
  'anime-voice': { slot: 0, dstId: 2 },
  'cinema-villain': { slot: 0, dstId: 3 },
  'radio-host': { slot: 0, dstId: 4 },
  'robotic-ai': { slot: 0, dstId: 5 },
};

function voiceFamilyForSlot(slot: any) {
  const type = `${slot?.voiceChangerType || slot?.voice_changer_type || ''}`.toLowerCase();

  if (type.includes('beatrice')) {
    return { voiceFamily: 'beatrice' as const, voiceFamilyLabel: 'Beatrice' };
  }

  if (type === 'rvc' || type.includes('rvc')) {
    return { voiceFamily: 'rvc' as const, voiceFamilyLabel: 'RVC' };
  }

  return { voiceFamily: 'other' as const, voiceFamilyLabel: 'Other' };
}

function rvcGenderForSlot(slot: any, displayName: string) {
  const text = [
    displayName,
    slot?.name,
    slot?.description,
    slot?.modelFile,
    slot?.model_file,
    slot?.zip_file,
    slot?.params?.modelFile,
    slot?.params?.model_file,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (text.includes('female') || text.includes('femal-voice') || text.includes('voice nell') || text.includes('future - 2700')) {
    return { voiceGender: 'female' as const, voiceGenderLabel: 'Female', voiceGenderConfidence: 'explicit' as const };
  }

  if (text.includes('male') || text.includes('elon') || text.includes('obama')) {
    return { voiceGender: 'male' as const, voiceGenderLabel: 'Male', voiceGenderConfidence: 'explicit' as const };
  }

  return { voiceGender: 'unknown' as const, voiceGenderLabel: 'Unlabeled', voiceGenderConfidence: 'unknown' as const };
}

function beatriceToneForPitch(averagePitch: number) {
  if (!Number.isFinite(averagePitch)) {
    return { voiceGender: 'unknown' as const, voiceGenderLabel: 'Unlabeled Tone', voiceGenderConfidence: 'unknown' as const };
  }

  return averagePitch >= 54
    ? { voiceGender: 'female' as const, voiceGenderLabel: 'Female Tone', voiceGenderConfidence: 'estimated' as const }
    : { voiceGender: 'male' as const, voiceGenderLabel: 'Male Tone', voiceGenderConfidence: 'estimated' as const };
}

function voiceClassification(slot: any, displayName: string, averagePitch?: number) {
  const family = voiceFamilyForSlot(slot);

  if (family.voiceFamily === 'rvc') {
    return { ...family, ...rvcGenderForSlot(slot, displayName) };
  }

  if (family.voiceFamily === 'beatrice') {
    return { ...family, ...beatriceToneForPitch(Number(averagePitch)) };
  }

  return {
    ...family,
    voiceGender: 'unknown' as const,
    voiceGenderLabel: 'Unlabeled',
    voiceGenderConfidence: 'unknown' as const,
  };
}

let activeModelId = 'american-female';
let lastPitch = 0;
let lastFormant = 0;
let activeQualityMode: VoiceQualityMode = 'conversation';
let detectedApiMode: EngineApiMode | null = null;
let configurationQueue = Promise.resolve();
let legacyRuntimeSnapshot: any = null;
const v2SlotCache = new Map<number, any>();

export class AudioEngineError extends Error {
  code: string;

  constructor(message: string, code = 'ENGINE_OFFLINE') {
    super(message);
    this.name = 'AudioEngineError';
    this.code = code;
  }
}

function buildUrl(path: string) {
  return `${ENGINE_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

async function requestJson(path: string, options: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (window.electronAPI?.engineRequest) {
    try {
      const response = await window.electronAPI.engineRequest(path, options, timeoutMs);

      if (!response.ok) {
        throw new AudioEngineError(`Voice engine rejected ${path}.`, 'ENGINE_REQUEST_FAILED');
      }

      return response.text ? JSON.parse(response.text) : null;
    } catch (error) {
      if (error instanceof AudioEngineError) {
        throw error;
      }

      throw new AudioEngineError('Engine Offline');
    }
  }

  if (typeof window.fetch !== 'function') {
    throw new AudioEngineError('Engine Offline');
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildUrl(path), {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      throw new AudioEngineError(`Voice engine rejected ${path}.`, 'ENGINE_REQUEST_FAILED');
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    if (error instanceof AudioEngineError) {
      throw error;
    }

    throw new AudioEngineError('Engine Offline');
  } finally {
    window.clearTimeout(timeout);
  }
}

function legacyFormValue(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return String(value);
}

async function requestForm(path: string, fields: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS) {
  const body = new URLSearchParams();

  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      body.set(key, legacyFormValue(value));
    }
  });

  return requestJson(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
    timeoutMs
  );
}

async function uploadEngineFile(file: File, filename: string, timeoutMs = 180_000) {
  if (window.electronAPI?.engineUploadFile) {
    const data = await file.arrayBuffer();
    const response = await window.electronAPI.engineUploadFile(filename, data, timeoutMs);

    if (!response.ok) {
      throw new AudioEngineError(`Voice engine rejected upload ${filename}.`, 'MODEL_UPLOAD_FAILED');
    }

    return response.text ? JSON.parse(response.text) : null;
  }

  const body = new FormData();
  body.set('filename', filename);
  body.set('file', file, filename);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(buildUrl('/upload_file'), {
      method: 'POST',
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AudioEngineError(`Voice engine rejected upload ${filename}.`, 'MODEL_UPLOAD_FAILED');
    }

    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    if (error instanceof AudioEngineError) {
      throw error;
    }

    throw new AudioEngineError('Model upload failed.', 'MODEL_UPLOAD_FAILED');
  } finally {
    window.clearTimeout(timeout);
  }
}

async function detectEngineApiMode(): Promise<EngineApiMode> {
  if (detectedApiMode) {
    return detectedApiMode;
  }

  try {
    await requestJson('/api/server-properties/properties', {}, 2500);
    detectedApiMode = 'vcclient-2';
    return detectedApiMode;
  } catch {
    // Fall through to the legacy RVC server probe.
  }

  try {
    await requestJson('/info', {}, 2500);
    detectedApiMode = 'legacy-rvc';
    return detectedApiMode;
  } catch {
    throw new AudioEngineError('Engine Offline');
  }
}

function modelConfigFor(modelId: string) {
  const config = MODEL_CONFIG[modelId];

  if (!config) {
    const dynamicConfig = /^slot-(\d+)-speaker-(\d+)$/.exec(modelId);

    if (dynamicConfig) {
      return {
        slot: Number(dynamicConfig[1]),
        dstId: Number(dynamicConfig[2]),
      };
    }

    throw new AudioEngineError(`Unknown model: ${modelId}`, 'MODEL_NOT_FOUND');
  }

  return config;
}

function normalizeDevice(device: any) {
  return {
    ...device,
    index: Number(device.index ?? device.id ?? -1),
    name: device.name || '',
    hostAPIName: device.host_api || device.hostAPIName || device.hostAPI || '',
    hostAPI: device.host_api || device.hostAPI || device.hostAPIName || '',
    maxInputChannels: device.max_input_channels ?? device.maxInputChannels ?? 0,
    maxOutputChannels: device.max_output_channels ?? device.maxOutputChannels ?? 0,
    defaultSamplerate: device.default_samplerate ?? device.defaultSamplerate ?? -1,
    availableSamplerates: device.available_samplerates ?? device.availableSamplerates ?? [],
  };
}

function normalizeSlot(slot: any) {
  const modelFile = slot.zip_file || slot.toml_file || slot.modelFile || slot.name || '';

  return {
    ...slot,
    slotIndex: Number(slot.slot_index ?? slot.slotIndex ?? -1),
    voiceChangerType: slot.voice_changer_type || slot.voiceChangerType,
    name: slot.name || '',
    modelFile,
    isONNX: booleanValue(slot.isONNX) || `${modelFile}`.toLowerCase().endsWith('.onnx'),
  };
}

function cacheV2Slots(slots: any[]) {
  slots.forEach((slot) => {
    const slotIndex = Number(slot?.slot_index ?? slot?.slotIndex);
    if (Number.isFinite(slotIndex)) {
      v2SlotCache.set(slotIndex, slot);
    }
  });
}

function isUsableSlot(slot: any) {
  return Boolean(slot?.voiceChangerType && slot?.modelFile);
}

function isOnnxSlot(slot: any) {
  return Boolean(slot?.isONNX) || `${slot?.modelFile || ''}`.toLowerCase().endsWith('.onnx');
}

function runtimeLabelForSlot(slot: any) {
  if (slot?.voiceChangerType === 'LLVC') {
    return 'LLVC CPU streaming';
  }

  if (slot?.voiceChangerType === 'Beatrice' || slot?.voiceChangerType === 'Beatrice_v2') {
    return 'Beatrice low-latency';
  }

  if (slot?.voiceChangerType === 'RVC' && isOnnxSlot(slot)) {
    return 'RVC ONNX';
  }

  if (slot?.voiceChangerType === 'RVC') {
    return 'RVC PyTorch';
  }

  return slot?.voiceChangerType || 'Local model';
}

function isCpuOptimizedSlot(slot: any) {
  return slot?.voiceChangerType === 'LLVC' || slot?.voiceChangerType === 'Beatrice' || slot?.voiceChangerType === 'Beatrice_v2' || (slot?.voiceChangerType === 'RVC' && isOnnxSlot(slot));
}

function uniqueSlotsByIndex(slots: any[]) {
  const seen = new Set<number | string>();
  return slots.filter((slot) => {
    const key = slot?.slotIndex ?? slot?.name;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function slotForModel(info: any, modelId: string) {
  const config = modelConfigFor(modelId);
  return (info?.modelSlots || []).find((slot: any) => Number(slot.slotIndex) === config.slot);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampLegacyChunkSize(value: number) {
  return clamp(Math.round(value), LEGACY_MIN_CHUNK_SIZE, LEGACY_MAX_CHUNK_SIZE);
}

function clampChunkSizeForSlot(slot: any, value: number) {
  return clamp(Math.round(value), LEGACY_MIN_CHUNK_SIZE, LEGACY_MAX_CHUNK_SIZE);
}

function safeUploadFilename(file: File, slot: number) {
  const original = file.name || `model-${slot}`;
  const extension = original.toLowerCase().endsWith('.index') ? '.index' : original.toLowerCase().endsWith('.onnx') ? '.onnx' : '.pth';
  const stem = original.replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || `model-${slot}`;

  return `morphly-${slot}-${stem}${extension}`;
}

function displayNameFromFile(file: File) {
  return (file.name || 'Imported RVC').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Imported RVC';
}

function findAvailableImportSlot(info: any) {
  const usedSlots = new Set(
    (info?.modelSlots || [])
      .filter(isUsableSlot)
      .map((slot: any) => Number(slot.slotIndex))
      .filter((slot: number) => Number.isFinite(slot))
  );

  for (let slot = IMPORT_SLOT_START; slot <= IMPORT_SLOT_END; slot += 1) {
    if (!usedSlots.has(slot)) {
      return slot;
    }
  }

  throw new AudioEngineError('No empty model import slots are available.', 'MODEL_IMPORT_FAILED');
}

function numericValue(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  if (value === undefined || value === null) {
    return fallback;
  }

  return Number(value) === 1;
}

function legacyConfiguration(info: any) {
  const inputSampleRate = numericValue(info?.serverInputAudioSampleRate ?? info?.serverAudioSampleRate, 48000);
  const outputSampleRate = numericValue(info?.serverOutputAudioSampleRate ?? info?.serverAudioSampleRate, inputSampleRate);
  const monitorSampleRate = numericValue(info?.serverMonitorAudioSampleRate, -1);
  const readChunkSize = numericValue(info?.serverReadChunkSize, DEFAULT_CHUNK_SIZE);

  return {
    current_slot_index: numericValue(info?.modelSlotIndex, -1),
    voice_changer_input_mode: numericValue(info?.enableServerAudio, 0) === 1 ? 'server' : 'client',
    pass_through: booleanValue(info?.passThrough),
    audio_input_device_index: numericValue(info?.serverInputDeviceId, -1),
    audio_output_device_index: numericValue(info?.serverOutputDeviceId, -1),
    audio_monitor_device_index: numericValue(info?.serverMonitorDeviceId, -1),
    audio_input_device_sample_rate: inputSampleRate,
    audio_output_device_sample_rate: outputSampleRate,
    audio_monitor_device_sample_rate: monitorSampleRate,
    input_sample_rate: inputSampleRate,
    output_sample_rate: outputSampleRate,
    monitor_sample_rate: monitorSampleRate,
    audio_input_device_gain: numericValue(info?.serverInputAudioGain, 1),
    audio_output_device_gain: numericValue(info?.serverOutputAudioGain, 1),
    audio_monitor_device_gain: numericValue(info?.serverMonitorAudioGain, 0),
    server_device_trancate_buffer_ratio: clamp(readChunkSize / 256, 0.5, 4),
    gpu_device_id_int: numericValue(info?.gpu, -1),
  };
}

function legacyInfoToRuntime(info: any, includeDevices = true) {
  const configuration = legacyConfiguration(info);
  const serverAudioStated = numericValue(info?.serverAudioStated, 0);

  return {
    ...info,
    status: 'ok',
    apiVersion: 'legacy-rvc',
    serverProperties: {
      application_name: 'w-okada voice-changer',
      available_voice_changer_types: ['RVC'],
    },
    configuration,
    localInterface: {
      local_voice_changer_interface_active: serverAudioStated === 1,
    },
    modelSlotIndex: configuration.current_slot_index,
    enableServerAudio: numericValue(info?.enableServerAudio, 0),
    serverAudioStated,
    passThrough: configuration.pass_through,
    serverAudioInputDevices: includeDevices ? (info?.serverAudioInputDevices || []).map(normalizeDevice) : [],
    serverAudioOutputDevices: includeDevices ? (info?.serverAudioOutputDevices || []).map(normalizeDevice) : [],
    modelSlots: (info?.modelSlots || []).map(normalizeSlot),
  };
}

async function getLegacyInfo(includeDevices = true) {
  const info = await requestJson(includeDevices ? '/info' : '/info?reloadDevices=false');
  const runtimeInfo = legacyInfoToRuntime(info, includeDevices);
  legacyRuntimeSnapshot = runtimeInfo;
  return runtimeInfo;
}

async function getConfiguration() {
  return requestJson('/api/configuration-manager/configuration');
}

async function updateLegacySetting(key: string, val: unknown) {
  return requestForm('/update_settings', { key, val });
}

function legacyValueMatches(current: unknown, next: unknown) {
  if (typeof next === 'boolean') {
    return booleanValue(current) === next;
  }

  if (typeof next === 'number') {
    const currentNumber = Number(current);
    return Number.isFinite(currentNumber) && Math.abs(currentNumber - next) < 0.000001;
  }

  return String(current) === String(next);
}

async function updateLegacySettings(settings: Record<string, unknown>, currentInfo: any = legacyRuntimeSnapshot, forceKeys = new Set<string>()) {
  let latest: any = null;
  const baseline = currentInfo || legacyRuntimeSnapshot;

  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined && value !== null) {
      if (!forceKeys.has(key) && baseline && legacyValueMatches(baseline[key], value)) {
        continue;
      }

      latest = await updateLegacySetting(key, value);
      legacyRuntimeSnapshot = legacyInfoToRuntime(latest, false);
    }
  }

  if (latest) {
    return legacyRuntimeSnapshot;
  }

  if (baseline) {
    return legacyInfoToRuntime(baseline, false);
  }

  return getLegacyInfo(false);
}

function legacySettingsFromConfigurationPatch(patch: Record<string, unknown>) {
  const settings: Record<string, unknown> = {};

  if (patch.current_slot_index !== undefined) {
    settings.modelSlotIndex = patch.current_slot_index;
  }

  if (patch.pass_through !== undefined) {
    settings.passThrough = patch.pass_through;
  }

  if (patch.voice_changer_input_mode === 'server') {
    settings.enableServerAudio = 1;
  } else if (patch.voice_changer_input_mode === 'client') {
    settings.enableServerAudio = 0;
  }

  if (patch.audio_input_device_index !== undefined) {
    settings.serverInputDeviceId = patch.audio_input_device_index;
  }

  if (patch.audio_output_device_index !== undefined) {
    settings.serverOutputDeviceId = patch.audio_output_device_index;
  }

  if (patch.audio_monitor_device_index !== undefined) {
    settings.serverMonitorDeviceId = patch.audio_monitor_device_index;
  }

  const inputSampleRate = patch.audio_input_device_sample_rate ?? patch.input_sample_rate;
  const outputSampleRate = patch.audio_output_device_sample_rate ?? patch.output_sample_rate;
  const monitorSampleRate = patch.audio_monitor_device_sample_rate ?? patch.monitor_sample_rate;
  const serverSampleRate = inputSampleRate ?? outputSampleRate;

  if (serverSampleRate !== undefined) {
    settings.serverAudioSampleRate = serverSampleRate;
  }
  if (inputSampleRate !== undefined) {
    settings.serverInputAudioSampleRate = inputSampleRate;
  }
  if (outputSampleRate !== undefined) {
    settings.serverOutputAudioSampleRate = outputSampleRate;
  }
  if (monitorSampleRate !== undefined) {
    settings.serverMonitorAudioSampleRate = monitorSampleRate;
  }

  if (patch.audio_output_device_gain !== undefined) {
    settings.serverOutputAudioGain = patch.audio_output_device_gain;
  }

  if (patch.audio_monitor_device_gain !== undefined) {
    settings.serverMonitorAudioGain = patch.audio_monitor_device_gain;
  }

  if (patch.gpu_device_id_int !== undefined) {
    settings.gpu = patch.gpu_device_id_int;
  }

  if (patch.server_device_trancate_buffer_ratio !== undefined) {
    const chunkSize = Math.round(numericValue(patch.server_device_trancate_buffer_ratio, 1) * 256);
    settings.serverReadChunkSize = clampLegacyChunkSize(chunkSize);
  }

  return settings;
}

function availableGpus(info: any) {
  return Array.isArray(info?.gpus) ? info.gpus : [];
}

function preferredGpuId(info: any) {
  const gpu = availableGpus(info)[0];
  const id = Number(gpu?.id);

  return Number.isFinite(id) ? id : -1;
}

function preferredPitchDetector(info: any, slot?: any) {
  return LOW_CPU_PITCH_DETECTOR;
}

function voiceQualityProfile(mode: VoiceQualityMode = activeQualityMode) {
  return VOICE_QUALITY_PROFILES[mode] || VOICE_QUALITY_PROFILES.conversation;
}

async function updateConfiguration(patch: Record<string, unknown>) {
  const run = async () => {
    const mode = await detectEngineApiMode();

    if (mode === 'legacy-rvc') {
      const info = await updateLegacySettings(legacySettingsFromConfigurationPatch(patch));
      return info.configuration;
    }

    const current = await getConfiguration();
    const next = { ...current, ...patch };

    await requestJson('/api/configuration-manager/configuration', {
      method: 'PUT',
      body: JSON.stringify(next),
    });

    return next;
  };

  const result = configurationQueue.then(run, run);
  configurationQueue = result.then(
    () => undefined,
    () => undefined
  );

  return result;
}

async function getSlot(slotIndex: number, reload = false) {
  const cached = v2SlotCache.get(slotIndex);

  if (cached && !reload) {
    return cached;
  }

  const slot = await requestJson(`/api/slot-manager/slots/${slotIndex}${reload ? '?reload=true' : ''}`);
  cacheV2Slots([slot]);
  return slot;
}

async function updateSlot(slotIndex: number, patch: Record<string, unknown> | ((slot: any) => Record<string, unknown>)) {
  const current = await getSlot(slotIndex);
  const resolvedPatch = typeof patch === 'function' ? patch(current) : patch;
  const next = { ...current, ...resolvedPatch };

  await requestJson(`/api/slot-manager/slots/${slotIndex}`, {
    method: 'PUT',
    body: JSON.stringify(next),
  });

  cacheV2Slots([next]);
  return next;
}

async function waitForEngineState(predicate: (info: any) => boolean, timeoutMs = START_TIMEOUT_MS, stableMs = 0) {
  const startedAt = Date.now();
  let stableStartedAt = 0;
  let lastInfo: any = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      lastInfo = await getRuntimeInfo();
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      continue;
    }

    if (predicate(lastInfo)) {
      if (!stableMs) {
        return lastInfo;
      }

      stableStartedAt = stableStartedAt || Date.now();

      if (Date.now() - stableStartedAt >= stableMs) {
        return lastInfo;
      }
    } else {
      stableStartedAt = 0;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 450));
  }

  return lastInfo;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function stopLocalInterface() {
  try {
    await requestJson('/api/local-voice-changer-interface/operation/stop', { method: 'POST', body: JSON.stringify(null) });
  } catch {
    // A failed stop request usually means the local audio stream already exited.
  }
}

function deviceById(devices: any[], id?: string | number) {
  if (id === undefined || id === '') {
    return null;
  }

  const numericId = Number(id);
  return devices.find((device) => Number(device.index) === numericId) || null;
}

function selectedAudioDevice(devices: any[], id: string | number | undefined, kind: 'input' | 'output') {
  const device = deviceById(devices, id);

  if (!device || !hasDeviceIndex(device) || !hasAudioChannels(device, kind) || isUnsafeWindowsEndpoint(device)) {
    return null;
  }

  if (kind === 'input' && isLoopbackInputDevice(device)) {
    return null;
  }

  return device;
}

function audioDeviceName(device: any) {
  return `${device?.name || ''}`.toLowerCase();
}

function isUnsafeWindowsEndpoint(device: any) {
  const name = audioDeviceName(device);

  return name.includes('sound mapper') || name.includes('primary sound');
}

function isLoopbackInputDevice(device: any) {
  const name = audioDeviceName(device);
  const loopbackMarkers = [
    'stereo mix',
    'what u hear',
    'what you hear',
    'wave out',
    'loopback',
    'monitor',
    'speaker output',
    'speakers output',
    'cable output',
    'voicemeeter output',
    'vb-audio output',
  ];

  return loopbackMarkers.some((marker) => name.includes(marker));
}

function hasAudioChannels(device: any, kind: 'input' | 'output') {
  const channelCount =
    kind === 'input'
      ? Number(device?.maxInputChannels ?? device?.max_input_channels ?? 0)
      : Number(device?.maxOutputChannels ?? device?.max_output_channels ?? 0);

  return channelCount > 0;
}

function hasDeviceIndex(device: any) {
  const index = Number(device?.index);

  return Number.isFinite(index) && index >= 0;
}

function isLikelyVirtualOutputDevice(device: any) {
  const name = audioDeviceName(device);
  const virtualMarkers = [
    'virtual',
    'cable',
    'vb-audio',
    'voicemeeter',
    'blackhole',
    'soundflower',
    'splitcam',
    'obs',
    'ndi',
  ];

  return virtualMarkers.some((marker) => name.includes(marker));
}

function isLikelyHeadphoneOutputDevice(device: any) {
  const name = audioDeviceName(device);
  return ['headphone', 'headphones', 'headset', 'earbuds', 'earphones'].some((marker) => name.includes(marker));
}

function outputGainForDevice(device: any, mutePhysicalOutput = false) {
  return 1.0;
}

function monitorDevicePatch(monitorDevice: any, preferredSampleRate: number) {
  if (!monitorDevice) {
    return {
      audio_monitor_device_index: -1,
      audio_monitor_device_sample_rate: -1,
      audio_monitor_device_gain: 0.0,
      monitor_sample_rate: -1,
    };
  }

  const monitorIndex = Number(monitorDevice?.index);
  const monitorSampleRate = supportsSampleRate(monitorDevice, preferredSampleRate) ? preferredSampleRate : sampleRateFor(monitorDevice);

  if (!Number.isFinite(monitorIndex) || monitorIndex < 0) {
    throw new AudioEngineError('The selected monitor speaker has an invalid backend device index.', 'AUDIO_DEVICE_NOT_FOUND');
  }

  return {
    audio_monitor_device_index: monitorIndex,
    audio_monitor_device_sample_rate: monitorSampleRate,
    audio_monitor_device_gain: 0.7,
    monitor_sample_rate: monitorSampleRate,
  };
}

function deviceConfigurationPatch(inputDevice: any, outputDevice: any, monitorDevice: any = null, mutePhysicalOutput = false) {
  const profile = voiceQualityProfile();
  const sharedSampleRate = sharedSampleRateFor(inputDevice, outputDevice);
  const inputIndex = Number(inputDevice?.index);
  const outputIndex = Number(outputDevice?.index);

  if (!Number.isFinite(inputIndex) || inputIndex < 0) {
    throw new AudioEngineError('The selected microphone has an invalid backend device index.', 'AUDIO_DEVICE_NOT_FOUND');
  }

  if (!Number.isFinite(outputIndex) || outputIndex < 0) {
    throw new AudioEngineError('The selected speaker has an invalid backend device index.', 'AUDIO_DEVICE_NOT_FOUND');
  }

  return {
    voice_changer_input_mode: 'server',
    audio_input_device_index: inputIndex,
    audio_input_device_sample_rate: sharedSampleRate,
    input_sample_rate: sharedSampleRate,
    audio_output_device_index: outputIndex,
    audio_output_device_sample_rate: sharedSampleRate,
    output_sample_rate: sharedSampleRate,
    audio_input_device_gain: profile.inputGain,
    audio_output_device_gain: outputGainForDevice(outputDevice, mutePhysicalOutput),
    ...monitorDevicePatch(monitorDevice, sharedSampleRate),
    server_device_trancate_buffer_ratio: profile.truncateRatio,
    extra_frame_sec: profile.extraFrameSec,
    crossfade_sec: profile.crossfadeSec,
    sola_search_frame_sec: profile.solaSearchFrameSec,
    noise_gate: profile.noiseGate,
    enable_high_pass_filter: false,
    enable_low_pass_filter: false,
    wasapi_exclude_emabled: false,
  };
}

function sampleRateFor(device: any) {
  const rate = Number(device?.defaultSamplerate ?? device?.default_samplerate ?? -1);
  return rate > 0 ? rate : 48000;
}

function sampleRatesFor(device: any) {
  const explicitRates = device?.availableSamplerates ?? device?.available_samplerates ?? [];
  const rates = Array.isArray(explicitRates) ? explicitRates.map((rate) => Number(rate)).filter((rate) => rate > 0) : [];
  const defaultRate = sampleRateFor(device);

  return Array.from(new Set([defaultRate, ...rates])).filter((rate) => rate > 0);
}

function supportsSampleRate(device: any, rate: number) {
  const rates = sampleRatesFor(device);
  return rates.length === 0 || rates.includes(rate);
}

function sharedSampleRateFor(inputDevice: any, outputDevice: any) {
  const preferredRates = [48000, 44100, sampleRateFor(inputDevice), sampleRateFor(outputDevice)];

  for (const rate of Array.from(new Set(preferredRates))) {
    if (supportsSampleRate(inputDevice, rate) && supportsSampleRate(outputDevice, rate)) {
      return rate;
    }
  }

  return sampleRateFor(inputDevice);
}

function arrayWithValue(values: unknown, index: number, value: number, fallback = 0, minimumLength = 1) {
  const next = Array.isArray(values) ? values.map((item) => numericValue(item, fallback)) : [];
  const length = Math.max(next.length, minimumLength, index + 1);

  while (next.length < length) {
    next.push(fallback);
  }

  next[index] = value;
  return next;
}

function beatriceVoiceCount(slot: any, speakerIndex: number) {
  const modelVoices = slot?.model_info?.voice || slot?.modelInfo?.voice || {};
  const speakers = slot?.speakers || {};

  return Math.max(
    Object.keys(modelVoices).length,
    Object.keys(speakers).length,
    Array.isArray(slot?.pitch_shifts) ? slot.pitch_shifts.length : 0,
    Array.isArray(slot?.formant_shifts) ? slot.formant_shifts.length : 0,
    speakerIndex + 1,
    1
  );
}

function chunkSecForChunkSize(chunkSize: number, profile = voiceQualityProfile()) {
  const normalizedChunk = clamp(Math.round(chunkSize), 64, 512);
  return Number(clamp((normalizedChunk / profile.chunkSize) * profile.chunkSec, 0.06, 0.24).toFixed(3));
}

function vqNeighborCountForChunkSize(chunkSize: number, profile = voiceQualityProfile()) {
  const normalizedChunk = clamp(Math.round(chunkSize), 64, 512);
  const ratio = (normalizedChunk - 64) / (512 - 64);
  return clamp(Math.round(profile.vqNeighborCount + ratio * 4), 3, 8);
}

function slotPatchForModel(slot: any, modelId: string, pitch = lastPitch, formant = lastFormant, chunkSize = DEFAULT_CHUNK_SIZE) {
  const config = modelConfigFor(modelId);
  const profile = voiceQualityProfile();
  const speakerIndex = config.dstId;
  const speakerCount = beatriceVoiceCount(slot, speakerIndex);
  const patch: Record<string, unknown> = {
    dst_id: speakerIndex,
    pitch_shift: pitch,
    formant_shift: formant,
    chunk_sec: chunkSecForChunkSize(chunkSize, profile),
    vq_neighbor_count: vqNeighborCountForChunkSize(chunkSize, profile),
    auto_pitch_shift: false,
  };

  if (slot?.use_merged_speaker_embedding) {
    const mergedSpeakerIndex = Math.max(0, Math.round(numericValue(slot?.merged_speaker_id, 0)));

    patch.merged_speaker_pitch_shifts = arrayWithValue(slot?.merged_speaker_pitch_shifts, mergedSpeakerIndex, pitch, 0, mergedSpeakerIndex + 1);
    patch.merged_speaker_formant_shifts = arrayWithValue(slot?.merged_speaker_formant_shifts, mergedSpeakerIndex, formant, 0, mergedSpeakerIndex + 1);
  } else {
    patch.pitch_shifts = arrayWithValue(slot?.pitch_shifts, speakerIndex, pitch, 0, speakerCount);
    patch.formant_shifts = arrayWithValue(slot?.formant_shifts, speakerIndex, formant, 0, speakerCount);
  }

  return patch;
}

async function getV2Info() {
  try {
    const [properties, configuration, slots, localInterface] = await Promise.all([
      requestJson('/api/server-properties/properties'),
      requestJson('/api/configuration-manager/configuration'),
      requestJson('/api/slot-manager/slots'),
      requestJson('/api/local-voice-changer-interface/information'),
    ]);
    cacheV2Slots(slots || []);
    const reloadDevices = !localInterface?.local_voice_changer_interface_active;
    const reloadParam = reloadDevices ? '?reload=true' : '';
    const [inputDevices, outputDevices] = await Promise.all([
      requestJson(`/api/audio-device-manager/input_devices${reloadParam}`),
      requestJson(`/api/audio-device-manager/output_devices${reloadParam}`),
    ]);

    return {
      status: 'ok',
      apiVersion: 'vcclient-2',
      serverProperties: properties,
      configuration,
      localInterface,
      modelSlotIndex: configuration.current_slot_index,
      enableServerAudio: configuration.voice_changer_input_mode === 'server' ? 1 : 0,
      serverAudioStated: localInterface.local_voice_changer_interface_active ? 1 : 0,
      passThrough: configuration.pass_through,
      serverAudioInputDevices: (inputDevices || []).map(normalizeDevice),
      serverAudioOutputDevices: (outputDevices || []).map(normalizeDevice),
      modelSlots: (slots || []).map(normalizeSlot),
    };
  } catch (error) {
    if (error instanceof AudioEngineError) {
      throw error;
    }

    throw new AudioEngineError('Engine Offline');
  }
}

async function getV2RuntimeInfo() {
  try {
    const [properties, configuration, localInterface] = await Promise.all([
      requestJson('/api/server-properties/properties'),
      requestJson('/api/configuration-manager/configuration'),
      requestJson('/api/local-voice-changer-interface/information'),
    ]);
    const currentSlot = Number(configuration.current_slot_index);

    return {
      status: 'ok',
      apiVersion: 'vcclient-2',
      serverProperties: properties,
      configuration,
      localInterface,
      modelSlotIndex: configuration.current_slot_index,
      enableServerAudio: configuration.voice_changer_input_mode === 'server' ? 1 : 0,
      serverAudioStated: localInterface.local_voice_changer_interface_active ? 1 : 0,
      passThrough: configuration.pass_through,
      serverAudioInputDevices: [],
      serverAudioOutputDevices: [],
      modelSlots: Number.isFinite(currentSlot)
        ? [
            {
              slotIndex: currentSlot,
              voiceChangerType: 'vcclient-2',
              modelFile: 'active-slot',
            },
          ]
        : [],
    };
  } catch (error) {
    if (error instanceof AudioEngineError) {
      throw error;
    }

    throw new AudioEngineError('Engine Offline');
  }
}

export async function getInfo() {
  const mode = await detectEngineApiMode();

  try {
    return await (mode === 'legacy-rvc' ? getLegacyInfo() : getV2Info());
  } catch (error) {
    detectedApiMode = null;

    if (error instanceof AudioEngineError) {
      throw error;
    }

    throw new AudioEngineError('Engine Offline');
  }
}

async function getRuntimeInfo() {
  const mode = await detectEngineApiMode();

  return mode === 'legacy-rvc' ? getLegacyInfo(false) : getV2RuntimeInfo();
}

export function getAvailableVoiceModels(info: any): AvailableVoiceModel[] {
  const loadedSlots = (info?.modelSlots || []).filter(isUsableSlot);
  const cpuOptimizedSlots = loadedSlots.filter(isCpuOptimizedSlot);
  const voiceModeSlots = loadedSlots.filter((slot: any) => {
    const description = `${slot.description || ''}`.toLowerCase();
    return description.includes('backend/voice-mode') || (slot.slotIndex >= 10 && slot.voiceChangerType === 'RVC');
  });
  const visibleSlots = voiceModeSlots.length ? uniqueSlotsByIndex([...cpuOptimizedSlots, ...voiceModeSlots]) : loadedSlots;

  return visibleSlots.flatMap((slot: any) => {
    const slotIndex = Number(slot.slotIndex);
    const modelName = slot.name || `Slot ${slotIndex}`;
    const voiceChangerType = slot.voiceChangerType || 'Voice model';
    const runtimeLabel = runtimeLabelForSlot(slot);
    const isCpuOptimized = isCpuOptimizedSlot(slot);
    const modelInfoVoices = slot.model_info?.voice || slot.modelInfo?.voice;
    const explicitSpeakers = slot.speakers || {};
    const voiceEntries = modelInfoVoices
      ? Object.entries(modelInfoVoices)
      : Object.entries(explicitSpeakers).map(([speakerId, name]) => [speakerId, { name }]);

    if (!voiceEntries.length) {
      const speaker = Number(slot.dst_id ?? slot.dstId ?? 0);
      const classification = voiceClassification(slot, modelName);

      return [
        {
          id: `slot-${slotIndex}-speaker-${speaker}`,
          slot: slotIndex,
          speaker,
          name: modelName,
          accent: `${classification.voiceFamilyLabel} - ${classification.voiceGenderLabel} - ${runtimeLabel}`,
          voiceChangerType,
          modelName,
          runtimeLabel,
          isCpuOptimized,
          ...classification,
        },
      ];
    }

    return voiceEntries.map(([speakerId, voice]: [string, any]) => {
      const speaker = Number(speakerId);
      const voiceName = voice?.name || `${modelName} ${speaker}`;
      const averagePitch = Number(voice?.average_pitch);
      const pitchText = Number.isFinite(averagePitch) ? `avg pitch ${averagePitch.toFixed(1)}` : voiceChangerType;
      const classification = voiceClassification(slot, voiceName, averagePitch);

      return {
        id: `slot-${slotIndex}-speaker-${speaker}`,
        slot: slotIndex,
        speaker,
        name: voiceName,
        accent: `${classification.voiceFamilyLabel} - ${classification.voiceGenderLabel} - ${pitchText} - ${runtimeLabel}`,
        voiceChangerType,
        modelName,
        runtimeLabel,
        isCpuOptimized,
        averagePitch: Number.isFinite(averagePitch) ? averagePitch : undefined,
        ...classification,
      };
    });
  });
}

export async function ensureModelLoaded(modelId: string) {
  const info = await getInfo();
  const slot = slotForModel(info, modelId);

  if (!isUsableSlot(slot)) {
    throw new AudioEngineError('Selected voice slot is not loaded.', 'MODEL_NOT_LOADED');
  }

  return info;
}

export async function loadSampleModel(modelId: string) {
  return ensureModelLoaded(modelId);
}

export async function importAndOptimizeRvcModel({ modelFile, indexFile = null, displayName = '' }: ImportRvcModelOptions) {
  const mode = await detectEngineApiMode();

  if (mode !== 'legacy-rvc') {
    throw new AudioEngineError('RVC model import requires the Python w-okada backend.', 'MODEL_IMPORT_FAILED');
  }

  if (!modelFile?.name?.toLowerCase().endsWith('.pth')) {
    throw new AudioEngineError('Choose a .pth RVC model file.', 'MODEL_IMPORT_FAILED');
  }

  if (indexFile && !indexFile.name.toLowerCase().endsWith('.index')) {
    throw new AudioEngineError('The optional index file must end with .index.', 'MODEL_IMPORT_FAILED');
  }

  const info = await getInfo();
  const slot = findAvailableImportSlot(info);
  const modelFilename = safeUploadFilename(modelFile, slot);
  const indexFilename = indexFile ? safeUploadFilename(indexFile, slot) : '';
  const modelName = displayName.trim() || displayNameFromFile(modelFile);

  await uploadEngineFile(modelFile, modelFilename);

  if (indexFile) {
    await uploadEngineFile(indexFile, indexFilename);
  }

  const files = [{ name: modelFilename, kind: 'rvcModel', dir: '' }];

  if (indexFilename) {
    files.push({ name: indexFilename, kind: 'rvcIndex', dir: '' });
  }

  await requestForm(
    '/load_model',
    {
      slot,
      isHalf: false,
      params: JSON.stringify({
        voiceChangerType: 'RVC',
        slot,
        isSampleMode: false,
        sampleId: '',
        files,
        params: {},
      }),
    },
    180_000
  );

  const optimized = await requestForm(
    '/optimize_model',
    {
      slot,
      name: modelName,
    },
    300_000
  );

  if (!optimized || optimized.status !== 'ok') {
    throw new AudioEngineError(optimized?.message || 'Model optimization failed.', 'MODEL_IMPORT_FAILED');
  }

  detectedApiMode = null;
  legacyRuntimeSnapshot = null;
  activeModelId = `slot-${slot}-speaker-0`;

  return {
    slot,
    modelId: activeModelId,
    optimized,
    info: await getInfo(),
  };
}

async function updateLegacyModel(modelId: string) {
  const config = modelConfigFor(modelId);
  const info = await ensureModelLoaded(modelId);
  const selectedSlot = slotForModel(info, modelId);
  const profile = voiceQualityProfile();
  const pipelineMissing = Number(info.modelSlotIndex) === config.slot && info.pipelineInfo === 'None';
  const selectedSlotIsOnnx = isOnnxSlot(selectedSlot);
  const gpu = selectedSlotIsOnnx ? -1 : preferredGpuId(info);
  const settings: Record<string, unknown> = {
    dstId: config.dstId,
    tran: lastPitch,
    passThrough: false,
    f0Detector: preferredPitchDetector(info, selectedSlot),
    gpu,
    extraConvertSize: profile.extraConvertSize,
    crossFadeOverlapSize: profile.crossFadeOverlapSize,
    indexRatio: selectedSlotIsOnnx ? 0 : undefined,
  };
  const forceKeys = new Set<string>();

  activeModelId = modelId;

  if (!isUsableSlot(selectedSlot)) {
    throw new AudioEngineError('Selected voice slot is not loaded.', 'MODEL_NOT_LOADED');
  }

  if (Number(info.modelSlotIndex) !== config.slot) {
    settings.modelSlotIndex = config.slot;
  } else if (pipelineMissing) {
    forceKeys.add('gpu');
  }

  await updateLegacySettings(settings, info, forceKeys);

  return getInfo();
}

export async function updateModel(modelId: string) {
  const mode = await detectEngineApiMode();

  if (mode === 'legacy-rvc') {
    return updateLegacyModel(modelId);
  }

  const config = modelConfigFor(modelId);

  activeModelId = modelId;
  await ensureModelLoaded(modelId);
  await updateSlot(config.slot, (slot) => slotPatchForModel(slot, modelId));
  await updateConfiguration({
    current_slot_index: config.slot,
    voice_changer_input_mode: 'server',
    pass_through: false,
  });

  return getInfo();
}

export async function updateSettings(pitch: number, chunkSize: number, formant = lastFormant, qualityMode: VoiceQualityMode = activeQualityMode, modelId = activeModelId) {
  activeModelId = modelId || activeModelId;
  lastPitch = pitch;
  lastFormant = formant;
  activeQualityMode = qualityMode;
  const profile = voiceQualityProfile(qualityMode);

  const mode = await detectEngineApiMode();

  if (mode === 'legacy-rvc') {
    const activeSlot = slotForModel(legacyRuntimeSnapshot, activeModelId);
    const activeSlotIsOnnx = isOnnxSlot(activeSlot);

    await updateLegacySettings({
      tran: pitch,
      serverReadChunkSize: clampChunkSizeForSlot(activeSlot, chunkSize),
      f0Detector: LOW_CPU_PITCH_DETECTOR,
      gpu: activeSlotIsOnnx ? -1 : undefined,
      extraConvertSize: profile.extraConvertSize,
      crossFadeOverlapSize: profile.crossFadeOverlapSize,
      indexRatio: activeSlotIsOnnx ? 0 : undefined,
    });
    return;
  }

  const config = modelConfigFor(activeModelId);
  const normalizedChunk = clamp(chunkSize, 64, 512);
  const truncateRatio = clamp(normalizedChunk / profile.chunkSize, 0.5, 4);
  const extraFrameSec = clamp(normalizedChunk / 1600, profile.extraFrameSec / 2, 0.16);

  await Promise.all([
    updateSlot(config.slot, (slot) => slotPatchForModel(slot, activeModelId, pitch, formant, normalizedChunk)),
    updateConfiguration({
      server_device_trancate_buffer_ratio: truncateRatio,
      extra_frame_sec: extraFrameSec,
      crossfade_sec: profile.crossfadeSec,
      sola_search_frame_sec: profile.solaSearchFrameSec,
      audio_input_device_gain: profile.inputGain,
      audio_output_device_gain: profile.outputGain,
      noise_gate: profile.noiseGate,
      enable_high_pass_filter: false,
      enable_low_pass_filter: false,
    }),
  ]);
}

export async function updateInputDevice(deviceId: string | number) {
  const info = await getInfo();
  const device = selectedAudioDevice(info.serverAudioInputDevices, deviceId, 'input');

  if (!device) {
    throw new AudioEngineError('Choose a usable microphone device before starting.', 'AUDIO_DEVICE_NOT_FOUND');
  }

  const sampleRate = sampleRateFor(device);
  const index = Number(device.index);

  if (!Number.isFinite(index) || index < 0) {
    throw new AudioEngineError('The selected microphone has an invalid backend device index.', 'AUDIO_DEVICE_NOT_FOUND');
  }

  return updateConfiguration({
    voice_changer_input_mode: 'server',
    audio_input_device_index: index,
    audio_input_device_sample_rate: sampleRate,
    input_sample_rate: sampleRate,
    wasapi_exclude_emabled: false,
  });
}

export async function updateOutputDevice(deviceId: string | number) {
  const info = await getInfo();
  const device = selectedAudioDevice(info.serverAudioOutputDevices, deviceId, 'output');

  if (!device) {
    throw new AudioEngineError('Choose a usable speaker device before starting.', 'AUDIO_DEVICE_NOT_FOUND');
  }

  const sampleRate = sampleRateFor(device);
  const index = Number(device.index);

  if (!Number.isFinite(index) || index < 0) {
    throw new AudioEngineError('The selected speaker has an invalid backend device index.', 'AUDIO_DEVICE_NOT_FOUND');
  }

  return updateConfiguration({
    voice_changer_input_mode: 'server',
    audio_output_device_index: index,
    audio_output_device_sample_rate: sampleRate,
    output_sample_rate: sampleRate,
    audio_output_device_gain: outputGainForDevice(device),
    audio_monitor_device_index: -1,
    audio_monitor_device_sample_rate: -1,
    audio_monitor_device_gain: 0.0,
    monitor_sample_rate: -1,
    wasapi_exclude_emabled: false,
  });
}

async function startLegacyEngine(options: StartEngineOptions) {
  const { modelId, inputDeviceId, outputDeviceId, monitorOutputDeviceId, pitch = lastPitch, formant = lastFormant, chunkSize = DEFAULT_CHUNK_SIZE, mutePhysicalOutput = false, qualityMode = activeQualityMode } = options;
  const config = modelConfigFor(modelId);

  activeModelId = modelId;
  lastPitch = pitch;
  lastFormant = formant;
  activeQualityMode = qualityMode;

  await ensureModelLoaded(modelId);
  await updateLegacySettings({ serverAudioStated: 0 });
  await delay(AUDIO_STOP_SETTLE_MS);
  await updateLegacyModel(modelId);
  await updateSettings(pitch, chunkSize, formant, qualityMode, modelId);

  const startupInfo = await getInfo();
  const inputDevice = selectedAudioDevice(startupInfo.serverAudioInputDevices, inputDeviceId, 'input');
  const outputDevice = selectedAudioDevice(startupInfo.serverAudioOutputDevices, outputDeviceId, 'output');
  const monitorDevice = selectedAudioDevice(startupInfo.serverAudioOutputDevices, monitorOutputDeviceId, 'output');
  const selectedSlot = slotForModel(startupInfo, modelId);

  if (!inputDevice) {
    throw new AudioEngineError('Choose a usable microphone device before starting.', 'AUDIO_DEVICE_NOT_FOUND');
  }

  if (!outputDevice) {
    throw new AudioEngineError('Choose a usable speaker device before starting.', 'AUDIO_DEVICE_NOT_FOUND');
  }

  const sampleRate = sharedSampleRateFor(inputDevice, outputDevice);
  const isReady = (info: any) =>
    Number(info?.modelSlotIndex) === config.slot &&
    Number(info?.enableServerAudio) === 1 &&
    Number(info?.serverAudioStated) === 1 &&
    info?.passThrough === false &&
    isUsableSlot(slotForModel(info, modelId));

  await updateLegacySettings({
    serverInputDeviceId: Number(inputDevice.index),
    serverOutputDeviceId: Number(outputDevice.index),
    serverMonitorDeviceId: monitorDevice ? Number(monitorDevice.index) : -1,
    serverAudioSampleRate: sampleRate,
    serverInputAudioSampleRate: sampleRate,
    serverOutputAudioSampleRate: sampleRate,
    serverMonitorAudioSampleRate: monitorDevice ? (supportsSampleRate(monitorDevice, sampleRate) ? sampleRate : sampleRateFor(monitorDevice)) : -1,
    serverOutputAudioGain: outputGainForDevice(outputDevice, mutePhysicalOutput),
    serverMonitorAudioGain: monitorDevice ? 0.7 : 0,
    serverReadChunkSize: clampChunkSizeForSlot(selectedSlot, chunkSize),
    enableServerAudio: 1,
    passThrough: false,
    serverAudioStated: 1,
  }, startupInfo);

  const readyInfo = await waitForEngineState(isReady, 15000, LEGACY_READY_STABLE_MS);

  if (readyInfo && isReady(readyInfo)) {
    return readyInfo;
  }

  await stopEngine();
  throw new AudioEngineError('Voice engine could not keep the selected microphone/output pair open.', 'ENGINE_START_FAILED');
}

export async function startEngine(options: StartEngineOptions) {
  const { modelId, inputDeviceId, outputDeviceId, monitorOutputDeviceId, pitch = lastPitch, formant = lastFormant, chunkSize = DEFAULT_CHUNK_SIZE, mutePhysicalOutput = false, qualityMode = activeQualityMode } = options;
  const mode = await detectEngineApiMode();

  if (mode === 'legacy-rvc') {
    return startLegacyEngine(options);
  }

  const config = modelConfigFor(modelId);

  activeModelId = modelId;
  activeQualityMode = qualityMode;
  await ensureModelLoaded(modelId);
  await updateModel(modelId);
  await updateSettings(pitch, chunkSize, formant, qualityMode, modelId);

  const startupInfo = await getInfo();
  const inputDevice = selectedAudioDevice(startupInfo.serverAudioInputDevices, inputDeviceId, 'input');
  const outputDevice = selectedAudioDevice(startupInfo.serverAudioOutputDevices, outputDeviceId, 'output');
  const monitorDevice = selectedAudioDevice(startupInfo.serverAudioOutputDevices, monitorOutputDeviceId, 'output');
  const selectedSlot = slotForModel(startupInfo, modelId);
  const gpu = isOnnxSlot(selectedSlot) ? -1 : preferredGpuId(startupInfo);
  const startupPatch = {
    current_slot_index: config.slot,
    voice_changer_input_mode: 'server',
    pass_through: false,
    recording_started: false,
    gpu_device_id_int: gpu,
    wasapi_exclude_emabled: false,
  };
  const isReady = (info: any) =>
    Number(info?.modelSlotIndex) === config.slot &&
    Number(info?.enableServerAudio) === 1 &&
    Number(info?.serverAudioStated) === 1 &&
    info?.passThrough === false &&
    isUsableSlot(slotForModel(info, modelId));

  if (!inputDevice) {
    throw new AudioEngineError('Choose a usable microphone device before starting.', 'AUDIO_DEVICE_NOT_FOUND');
  }

  if (!outputDevice) {
    throw new AudioEngineError('Choose a usable speaker device before starting.', 'AUDIO_DEVICE_NOT_FOUND');
  }

  await stopLocalInterface();
  await delay(AUDIO_STOP_SETTLE_MS);
  await updateConfiguration({
    ...startupPatch,
    ...deviceConfigurationPatch(inputDevice, outputDevice, monitorDevice, mutePhysicalOutput),
  });

  try {
    await requestJson('/api/local-voice-changer-interface/operation/start', { method: 'POST', body: JSON.stringify(null) }, START_TIMEOUT_MS);

    const readyInfo = await waitForEngineState(isReady, 12000, 2200);

    if (readyInfo && isReady(readyInfo)) {
      return readyInfo;
    }
  } catch {
    // The backend reports startup failures asynchronously; the readiness check below
    // turns those into a single clear UI error instead of cycling devices.
  }

  await stopLocalInterface();
  throw new AudioEngineError('Voice engine could not keep the selected microphone/output pair open.', 'ENGINE_START_FAILED');
}

export async function stopEngine() {
  const mode = await detectEngineApiMode();

  if (mode === 'legacy-rvc') {
    await updateLegacySettings({
      serverAudioStated: 0,
      enableServerAudio: 0,
      passThrough: true,
    });
    return getInfo();
  }

  await stopLocalInterface();
  await updateConfiguration({ pass_through: true });
  return getInfo();
}

export const AudioEngineService = {
  getInfo,
  getAvailableVoiceModels,
  startEngine,
  stopEngine,
  updateModel,
  importAndOptimizeRvcModel,
  ensureModelLoaded,
  loadSampleModel,
  updateSettings,
  updateInputDevice,
  updateOutputDevice,
};
